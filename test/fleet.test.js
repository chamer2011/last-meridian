// The fleet layer: the ships, the daily drain, shortages, pursuit, raids, the player's decisions,
// the star map, what the game master hears, and old saves. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { runTurn } from "../src/ai.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { FLEET_SHIPS, answerRaid, councilOf, fleetCommand, fleetLedger, fleetLine, fleetReport, fleetView, jumpCost } from "../src/fleet.js";
import { LOCATIONS } from "../src/data.js";
import { LORE } from "../src/lore.js";
import { migrateGame } from "../src/migrate.js";
import { worldDir } from "../src/paths.js";
import { aiSnapshot, passTime, publicState, rest, travel, useItem } from "../src/rules.js";
import { fleetNews, leadsHere } from "../src/story-library.js";
import { newTurnLimits, runTool } from "../src/tools.js";
import { FLEET_DATA, STAR_MAP, STORY_CLOCK } from "../src/world.js";

// The officers and the council have their own tests, in stories.test.js. Here it's only the fleet.
const newGame = (seed = 21, archetype = "officer") => {
  const game = createGameFromDraft(randomDraft({ seed, archetype }));
  councilOf(game.fleet).off = true;
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const people = (game) => Object.values(game.fleet.ships).reduce((sum, ship) => sum + ship.aboard, 0);
const activeShips = (game) => Object.entries(game.fleet.ships).filter(([, ship]) => ship.status === "active").map(([id]) => id);
const supply = (game, id) => fleetView(game).supplies.find((entry) => entry.id === id);

// Passes whole days from midnight to midnight.
function days(game, count, activity = "routine") {
  game.clock.hours = Math.ceil(game.clock.hours / 24) * 24;
  game.fleet.day = game.clock.hours / 24;
  const notes = [];
  for (let i = 0; i < count; i += 1) notes.push(...passTime(game, 24, activity));
  return notes;
}

// ---- The ships ----------------------------------------------------------

test("the fleet is 41 ships and 30,000 people, each with what the Fleet menu shows", () => {
  const ships = FLEET_DATA.ships;
  assert.equal(ships.length, 41);
  assert.equal(ships.reduce((sum, ship) => sum + ship.aboard, 0), 30000);
  assert.equal(new Set(ships.map((ship) => ship.id)).size, 41, "two ships share an id");
  assert.equal(new Set(ships.map((ship) => ship.name)).size, 41, "two ships share a name");
  for (const ship of ships) {
    for (const field of ["name", "class", "role", "captain", "note"]) assert.ok(ship[field], `${ship.id} has no ${field}`);
    assert.ok(ship.aboard > 0 && ship.condition > 0 && ship.condition <= 100, ship.id);
    for (const id of [...Object.keys(ship.produces ?? {}), ...Object.keys(ship.uses ?? {})]) assert.ok(FLEET_DATA.supplies[id], `${ship.id} uses ${id}`);
    if (!ship.story) assert.ok(ship.strip, `${ship.id} can be stripped, so it needs to say what for`);
    if (ship.place) assert.ok(LOCATIONS[ship.place], `${ship.id} is at an unknown place`);
  }
});

function storyText() {
  const parts = [fs.readFileSync(path.join(worldDir, "arc.json"), "utf8"), fs.readFileSync(path.join(worldDir, "fleet-events.json"), "utf8")];
  for (const folder of ["stories", "places", "characters"]) {
    for (const file of fs.readdirSync(path.join(worldDir, folder))) parts.push(fs.readFileSync(path.join(worldDir, folder, file), "utf8"));
  }
  return parts.join("\n");
}

test("every ship the story names is in the fleet, and raids can't take away a ship the story needs", () => {
  const text = storyText();
  const named = ["Meridian", "Sundial", "Anselm's Mercy", "Harrow's Bounty", "Second Thursday", "Wintermere", "Vesper Landing", "Tollan Arms", "Little Marigold", "Anneke's Promise", "Bright Tomorrow", "Slow Harriet", "Ashgrove", "Patience of Ostra", "Tolliver's Ark", "Widow's Lantern"];
  for (const name of named) {
    assert.ok(text.includes(name), `the story no longer mentions ${name}`);
    const ship = FLEET_DATA.ships.find((entry) => entry.name.includes(name));
    assert.ok(ship, `${name} isn't in the fleet`);
    assert.ok(ship.story, `${name} is named in the story, so it needs "story": true`);
  }
  // The other way round: a ship that can be lost must not be one that a story depends on.
  for (const ship of FLEET_DATA.ships.filter((entry) => !entry.story)) {
    assert.ok(!text.includes(ship.name.replace(/^The /, "")), `${ship.name} is in the story's files, so it can't be allowed to die`);
  }
});

test("ships that aren't part of the 41 stay out of it", () => {
  const names = FLEET_DATA.ships.map((ship) => ship.name).join("|");
  for (const name of ["Honest Mistake", "Kindly Hour", "Perrin's Vow", "Halloway", "Tarn", "Parallel", "Halcyon Promise", "Second Opinion", "Long Patience", "Ember Day"]) {
    assert.ok(!names.includes(name), `${name} isn't one of the fleet's 41 ships`);
  }
  assert.ok(!JSON.stringify(publicState(newGame()).fleet).includes("Honest Mistake"));
});

test("the fleet's ships get highlighted in the story, and in the codex", () => {
  const ids = new Set(LORE.map((entry) => entry.id));
  for (const ship of FLEET_DATA.ships) assert.ok(ship.place ? ids.has(`place:${ship.place}`) : ids.has(`ship:${ship.id}`), ship.id);
});

test("the Meridian's condition in the Fleet menu is her hull, not a second number", () => {
  const game = newGame();
  game.ship.hull = 40;
  assert.equal(fleetView(game).ships.find((ship) => ship.id === "meridian").condition, 40);
  assert.match(fleetView(game).ships.find((ship) => ship.id === "meridian").captain, new RegExp(game.name));
});

// ---- The daily drain ----------------------------------------------------

test("supplies drain at midnight, and only then", () => {
  const game = newGame();
  const food = game.fleet.food;
  game.clock.hours = 1;
  game.fleet.day = 0;
  passTime(game, 2);
  assert.equal(game.fleet.food, food, "nothing's gone until the day turns over");
  const { net } = fleetLedger(game);
  game.clock.hours = 23;
  passTime(game, 2);
  assert.equal(game.fleet.food, Math.round((food + net.food) * 10) / 10);
  assert.equal(game.fleet.day, 1);
});

test("passing many days at once runs each one", () => {
  const one = newGame();
  const three = newGame();
  days(one, 1);
  days(one, 1);
  days(one, 1);
  days(three, 3);
  assert.equal(three.fleet.food, one.fleet.food);
  assert.equal(three.fleet.medicine, one.fleet.medicine);
  assert.equal(three.fleet.pursuit, one.fleet.pursuit);
});

test("left alone, the story's numbers hold: about two weeks of fuel, and medicine until about day 41", () => {
  const game = newGame();
  const view = fleetView(game);
  const left = Object.fromEntries(view.supplies.map((entry) => [entry.id, entry.days]));
  assert.ok(left.fuel >= 12 && left.fuel <= 16, `fuel lasts ${left.fuel} days`);
  assert.ok(left.medicine >= 38 && left.medicine <= 45, `medicine lasts ${left.medicine} days`);
  assert.ok(left.food >= 20 && left.food <= 30, `food lasts ${left.food} days`);
  assert.ok(left.parts >= 40, `parts last ${left.parts} days`);
});

test("fuel is one number: the tank the jumps use, and it burns in whole units", () => {
  const game = newGame();
  game.ship.fuel = 6;
  days(game, 3);
  assert.ok(Number.isInteger(game.ship.fuel));
  assert.ok(game.ship.fuel < 6);
  assert.equal(supply(game, "fuel").stock, game.ship.fuel);
  game.inventory.fuel_cell = 1;
  const before = game.ship.fuel;
  useItem(game, "fuel_cell");
  assert.equal(supply(game, "fuel").stock, before + 3);
});

test("smaller fleets use less, and damaged ships make less", () => {
  const game = newGame();
  const { used, made } = fleetLedger(game);
  game.fleet.ships.cartwrights_folly.condition = 15;
  assert.ok(fleetLedger(game).made.parts < made.parts);
  game.fleet.ships.sparrows_rest.status = "gone";
  game.fleet.ships.sparrows_rest.aboard = 0;
  assert.ok(fleetLedger(game).used.food < used.food);
  assert.ok(fleetLedger(game).used.parts < used.parts);
});

// ---- Shortages ----------------------------------------------------------

test("a shortage warns first, then hits, and shows up in the story as lines", () => {
  const game = newGame();
  game.fleet.food = 60;
  const warned = days(game, 4).filter((line) => line.startsWith("[SUPPLY]") && /Food is down/.test(line));
  assert.equal(warned.length, 1, "the warning comes once");
  const out = days(game, 3).filter((line) => /out of food/.test(line));
  assert.equal(out.length, 1, "running out is said once");
  assert.ok(game.fleet.out.food >= 1);
  assert.deepEqual(fleetView(game).shortages.includes("food"), true);
});

test("no food pulls morale and health down, and the captain goes hungry too", () => {
  const game = newGame();
  game.fleet.food = 0;
  const morale = game.ship.morale;
  const health = game.fleet.health;
  const notes = days(game, 5);
  assert.ok(game.ship.morale < morale - 2, `morale ${morale} became ${game.ship.morale}`);
  assert.ok(game.fleet.health < health - 2, `health ${health} became ${game.fleet.health}`);
  assert.ok(game.conditions.some((c) => c.id === "underfed"));
  assert.ok(notes.some((line) => line.includes("Underfed")));
  // A long stretch of time all at once doesn't have the captain recover and go hungry again.
  const later = passTime(game, 72, "routine");
  assert.ok(!later.some((line) => line.includes("recovered: Underfed")), later.join(" "));
  assert.ok(!later.some((line) => line.includes("Underfed")), later.join(" "));
});

test("no parts wears ships out much faster, and a ship that fails is lost, with her people saved", () => {
  const game = newGame();
  const healthy = game.fleet.ships.kittiwake.condition;
  days(game, 1);
  const normalWear = healthy - game.fleet.ships.kittiwake.condition;
  game.fleet.parts = 0;
  days(game, 2);
  const before = game.fleet.ships.kittiwake.condition;
  days(game, 1);
  assert.ok(before - game.fleet.ships.kittiwake.condition > normalWear * 2);

  const total = people(game);
  game.fleet.ships.kittiwake.condition = 0.2;
  const notes = days(game, 1);
  assert.equal(game.fleet.ships.kittiwake.status, "lost");
  assert.equal(people(game), total, "her people moved to other ships");
  assert.ok(notes.some((line) => /Kittiwake has broken down/.test(line)));
});

test("a ship the story needs limps on rather than breaking down for good", () => {
  const game = newGame();
  game.fleet.parts = 0;
  game.fleet.ships.wintermere.condition = 0.2;
  const notes = days(game, 1);
  assert.equal(game.fleet.ships.wintermere.status, "active");
  assert.ok(game.fleet.ships.wintermere.condition > 0);
  assert.ok(notes.some((line) => /Wintermere has broken down/.test(line)));
});

test("no fuel means no jumps, slower crews and a colder fleet", () => {
  const game = newGame();
  const work = fleetLedger(game).work;
  game.ship.fuel = 0;
  days(game, 1);
  assert.ok(game.fleet.out.fuel);
  assert.ok(fleetLedger(game).work < work);
  assert.throws(() => travel(game, "haven"), /out of fuel/);
});

test("no medicine: health falls, wounds heal slower, and people start dying", () => {
  const game = newGame();
  game.fleet.medicine = 0;
  days(game, 1);
  game.conditions.push({ id: "shaken", hoursLeft: 100 });
  passTime(game, 10, "routine");
  assert.equal(game.conditions.find((c) => c.id === "shaken").hoursLeft, 95);
  game.fleet.food = 0;
  game.fleet.health = 12;
  const total = people(game);
  const notes = days(game, 6);
  assert.ok(people(game) < total, "nobody died");
  assert.ok(game.fleet.record.dead > 0);
  assert.ok(notes.some((line) => /have died/.test(line)));
});

test("restocking ends a shortage, and says so", () => {
  const game = newGame();
  game.fleet.food = 0;
  days(game, 2);
  assert.ok(game.fleet.out.food);
  const { notice } = tool(game, "change_fleet", { food: 50, reason: "A grain deal" });
  assert.match(notice, /There's food again/);
  assert.ok(!game.fleet.out.food);
});

test("morale and health settle where the rations and work orders put them", () => {
  const game = newGame();
  game.ship.morale = 20;
  game.fleet.health = 20;
  days(game, 120);
  const ledger = fleetLedger(game);
  assert.ok(Math.abs(game.ship.morale - ledger.moraleTarget) <= 2);
  assert.ok(Math.abs(game.fleet.health - ledger.healthTarget) <= 2);
});

// ---- Pursuit ------------------------------------------------------------

test("pursuit climbs with time, and a jump drops it, more for a longer jump", () => {
  const game = newGame();
  const start = game.fleet.pursuit;
  days(game, 2);
  assert.ok(game.fleet.pursuit > start);

  const near = newGame();
  near.fleet.pursuit = 60;
  near.ship.fuel = 12;
  near.skills.navigation = 6;
  const cost = jumpCost(near, "haven");
  assert.equal(cost.fuel, 1);
  near.clock.hours = 0;
  travel(near, "haven");
  assert.equal(near.fleet.pursuit, 60 - FLEET_DATA.rules.jumpShakes[1], "a jump inside one day only drops it");

  const far = newGame();
  far.fleet.pursuit = 60;
  far.ship.fuel = 12;
  far.skills.navigation = 6;
  far.clock.hours = 0;
  assert.equal(jumpCost(far, "vantor").fuel, 2);
  travel(far, "vantor");
  assert.equal(far.fleet.pursuit, 60 - FLEET_DATA.rules.jumpShakes[2]);
});

test("crossing to a ship in the fleet doesn't shake anything off", () => {
  const game = newGame();
  game.fleet.pursuit = 60;
  game.clock.hours = 0;
  travel(game, "sundial");
  assert.equal(game.fleet.pursuit, 60);
});

test("dangerous places draw the Choir faster, and quiet ones hide the fleet", () => {
  const game = newGame();
  game.fleet.at = "lumen";
  const quiet = fleetLedger(game).pursuitRate;
  game.fleet.at = "asterion";
  const deadly = fleetLedger(game).pursuitRate;
  game.fleet.at = null;
  const open = fleetLedger(game).pursuitRate;
  assert.ok(quiet < open && open < deadly);
});

test("when pursuit fills, a raid starts, and only one at a time", () => {
  const game = newGame();
  game.fleet.pursuit = 97;
  const notes = days(game, 1);
  assert.ok(game.fleet.raid, "no raid");
  assert.ok(notes.some((line) => line.startsWith("[RAID]")));
  const raid = game.fleet.raid;
  days(game, 2);
  assert.equal(game.fleet.raid, raid, "a second raid started over the first");
  assert.equal(game.fleet.pursuit, 100);
});

// ---- Raids --------------------------------------------------------------

const raided = (seed) => {
  const game = newGame(seed);
  game.fleet.pursuit = 99;
  days(game, 1);
  assert.ok(game.fleet.raid);
  return game;
};

test("a raid can cost ships and lives, and the people who got off move to other ships", () => {
  let losses = 0;
  for (let seed = 1; seed <= 30; seed += 1) {
    const game = raided(seed);
    game.fleet.record.raids = 5;
    const total = people(game);
    const { report, notes } = answerRaid(game, "scatter");
    assert.equal(game.fleet.raid, null);
    const dead = report.lost.reduce((sum, ship) => sum + ship.dead, 0);
    assert.equal(people(game), total - dead, "people went missing");
    assert.equal(activeShips(game).length, 41 - report.lost.length);
    for (const ship of report.lost) {
      const entry = FLEET_DATA.ships.find((candidate) => candidate.name === ship.name);
      assert.ok(!entry.story, `${ship.name} is in the story`);
      assert.equal(game.fleet.ships[entry.id].status, "lost");
    }
    assert.ok(notes.some((line) => line.startsWith("[RAID]")));
    assert.equal(game.pendingEvents.length, 1, "the story should hear about it once");
    assert.match(game.pendingEvents[0], /Choir raid/);
    losses += report.lost.length;
  }
  assert.ok(losses > 20, `only ${losses} ships lost in 30 bad raids`);
});

test("each order has its real cost, and its own result", () => {
  const jump = raided(3);
  const fuel = jump.ship.fuel;
  answerRaid(jump, "jump");
  assert.equal(jump.ship.fuel, fuel - 1);
  assert.equal(jump.fleet.pursuit, FLEET_DATA.raid.responses.jump.pursuitAfter);

  const fight = raided(3);
  const hull = fight.ship.hull;
  const parts = fight.fleet.parts;
  answerRaid(fight, "fight");
  assert.ok(fight.ship.hull < hull);
  assert.ok(fight.fleet.parts < parts);
  assert.equal(fight.fleet.pursuit, FLEET_DATA.raid.responses.fight.pursuitAfter);

  const scatter = raided(3);
  const morale = scatter.ship.morale;
  const stock = scatter.ship.fuel;
  const clock = scatter.clock.hours;
  answerRaid(scatter, "scatter");
  assert.ok(scatter.ship.fuel >= stock - 1, "scattering costs no fuel beyond the day's burn");
  assert.ok(scatter.ship.morale < morale);
  assert.equal(scatter.clock.hours, clock + 24, "regrouping takes a day");
  assert.equal(scatter.fleet.pursuit, FLEET_DATA.raid.responses.scatter.pursuitAfter);
});

test("you can't jump without fuel or fight with a wrecked hull, but you can always scatter", () => {
  const game = raided(4);
  game.ship.fuel = 0;
  game.ship.hull = 2;
  assert.throws(() => answerRaid(game, "jump"), /no fuel/);
  assert.throws(() => answerRaid(game, "fight"), /couldn't take/);
  const { responses } = fleetView(game).raid;
  assert.equal(responses.find((entry) => entry.id === "scatter").available, true);
  assert.equal(responses.find((entry) => entry.id === "jump").available, false);
  answerRaid(game, "scatter");
  assert.equal(game.fleet.raid, null);
  assert.throws(() => answerRaid(game, "scatter"), /no raid/);
});

test("the fleet can never be wiped out: with only story ships left, raids cripple them instead", () => {
  const game = raided(5);
  for (const ship of FLEET_DATA.ships) if (!ship.story) game.fleet.ships[ship.id].status = "lost";
  game.fleet.record.raids = 10;
  const before = activeShips(game).length;
  const { report } = answerRaid(game, "scatter");
  assert.equal(report.lost.length, 0);
  assert.ok(report.crippled.length > 0);
  assert.equal(activeShips(game).length, before);
  assert.ok(activeShips(game).includes("meridian"));
});

test("nothing else can happen until a raid is answered", () => {
  const game = raided(6);
  assert.throws(() => fleetCommand(game, { action: "wait" }), /under attack/);
  assert.throws(() => fleetCommand(game, { action: "course", id: "haven" }), /under attack/);
  assert.throws(() => travel(game, "haven"), /under attack/);
  fleetCommand(game, { action: "raid", id: "scatter" });
  assert.doesNotThrow(() => fleetCommand(game, { action: "wait" }));
});

// ---- The player's decisions ---------------------------------------------

test("ration levels have a visible cost and benefit, and do what they say", () => {
  const game = newGame();
  const { rations } = fleetView(game);
  assert.deepEqual(rations.map((r) => r.id), ["generous", "standard", "reduced", "half"]);
  assert.ok(rations[0].foodUsed > rations[1].foodUsed && rations[1].foodUsed > rations[2].foodUsed && rations[2].foodUsed > rations[3].foodUsed);
  assert.ok(rations[0].moraleTarget > rations[1].moraleTarget && rations[1].moraleTarget > rations[3].moraleTarget);

  const food = game.fleet.food;
  const { message, notes } = fleetCommand(game, { action: "rations", id: "half" });
  assert.match(message, /half/);
  assert.ok(notes.length);
  const shown = fleetView(game).rations.find((r) => r.current);
  assert.equal(shown.id, "half");
  days(game, 1);
  assert.ok(food - game.fleet.food < 15, "half rations should nearly hold the food steady");
  assert.equal(fleetLedger(game).moraleTarget, shown.moraleTarget);
  assert.throws(() => fleetCommand(game, { action: "rations", id: "everything" }), /no such/);
});

test("half rations are hard on morale and health, and on the captain", () => {
  const game = newGame();
  fleetCommand(game, { action: "rations", id: "half" });
  days(game, 40);
  assert.ok(game.ship.morale < 35, `morale ${game.ship.morale}`);
  assert.ok(game.fleet.health < 50, `health ${game.fleet.health}`);
  assert.ok(game.conditions.some((c) => c.id === "underfed"));
});

test("each work order shows what it does, and it's what really happens", () => {
  const game = newGame();
  const { crews } = fleetView(game);
  assert.ok(crews.length >= 6);
  for (const crew of crews) {
    assert.ok(crew.name && crew.desc, crew.id);
    if (crew.id !== "upkeep") assert.ok(crew.effects.length > 0, `${crew.id} shows no effect`);
  }
  const upkeep = fleetLedger(game);
  assert.ok(fleetLedger(game, { crews: "farms" }).net.food > upkeep.net.food);
  assert.ok(fleetLedger(game, { crews: "fuel" }).net.fuel > upkeep.net.fuel);
  assert.ok(fleetLedger(game, { crews: "fuel" }).pursuitRate > upkeep.pursuitRate);
  assert.ok(fleetLedger(game, { crews: "salvage" }).net.parts > upkeep.net.parts);
  assert.ok(fleetLedger(game, { crews: "medical" }).net.medicine > upkeep.net.medicine);
  assert.ok(fleetLedger(game, { crews: "silent" }).pursuitRate < upkeep.pursuitRate);
  assert.ok(fleetLedger(game, { crews: "silent" }).net.food < upkeep.net.food, "running silent should cost something");
  assert.ok(fleetLedger(game, { crews: "rest" }).moraleTarget > upkeep.moraleTarget);

  const before = game.fleet.ships.widows_lantern.condition;
  fleetCommand(game, { action: "crews", id: "repairs" });
  days(game, 1);
  assert.ok(game.fleet.ships.widows_lantern.condition > before, "the worst ship should get repaired");
  assert.throws(() => fleetCommand(game, { action: "crews", id: "golf" }), /no such/);
});

test("crews gather what's around them, so where the fleet is matters", () => {
  const game = newGame();
  const open = fleetLedger(game, { crews: "salvage" }).net.parts;
  game.fleet.at = "graveyard";
  assert.ok(fleetLedger(game, { crews: "salvage" }).net.parts > open);
  assert.ok(fleetView(game).gathers.some((entry) => entry.id === "parts"));
  game.fleet.at = "frontier";
  assert.ok(fleetLedger(game, { crews: "farms" }).net.food > 0, "farming at Tessen should feed the fleet");
});

test("waiting passes whole days, stops at a raid, and doesn't tire the captain", () => {
  const game = newGame();
  game.needs.fatigue = 10;
  const start = game.clock.hours;
  const { message } = fleetCommand(game, { action: "wait", days: 3 });
  assert.equal(game.clock.hours, start + 72);
  assert.match(message, /3 days/);
  assert.equal(game.needs.fatigue, 10);
  game.fleet.pursuit = 97;
  const before = game.clock.hours;
  fleetCommand(game, { action: "wait", days: 3 });
  assert.ok(game.fleet.raid);
  assert.ok(game.clock.hours - before < 72, "it should stop when the raid starts");
});

test("a blind jump shakes off pursuit for fuel, and needs fuel", () => {
  const game = newGame();
  game.fleet.pursuit = 50;
  game.clock.hours = 0;
  const fuel = game.ship.fuel;
  fleetCommand(game, { action: "evade" });
  assert.equal(game.ship.fuel, fuel - 1);
  assert.equal(game.fleet.pursuit, 50 - FLEET_DATA.rules.evadeShakes);
  game.ship.fuel = 0;
  assert.throws(() => fleetCommand(game, { action: "evade" }), /fuel/);
});

test("the fleet can buy where something's sold, for real credits", () => {
  const game = newGame();
  assert.deepEqual(fleetView(game).trade, [], "nothing's for sale in open space");
  assert.throws(() => fleetCommand(game, { action: "buy", id: "food" }), /Nobody here/);
  game.fleet.at = "frontier";
  const offer = fleetView(game).trade.find((entry) => entry.id === "food");
  assert.ok(offer);
  game.credits = offer.price;
  const food = game.fleet.food;
  fleetCommand(game, { action: "buy", id: "food" });
  assert.equal(game.credits, 0);
  assert.equal(game.fleet.food, food + FLEET_DATA.supplies.food.lot);
  assert.throws(() => fleetCommand(game, { action: "buy", id: "food" }), /afford/);
  assert.throws(() => fleetCommand(game, { action: "buy", id: "fuel" }), /Nobody here/);
});

test("stripping a ship pays in parts and fuel, costs morale, and can't touch a ship the story needs", () => {
  const game = newGame();
  const total = people(game);
  const morale = game.ship.morale;
  const parts = game.fleet.parts;
  const { strip } = FLEET_SHIPS.merchants_regret;
  game.ship.fuel = 2;
  fleetCommand(game, { action: "strip", id: "merchants_regret" });
  assert.equal(game.fleet.ships.merchants_regret.status, "stripped");
  assert.equal(game.fleet.parts, parts + strip.parts);
  assert.equal(game.ship.fuel, 2 + strip.fuel);
  assert.ok(game.ship.morale < morale);
  assert.equal(people(game), total, "her people moved to other ships");
  assert.throws(() => fleetCommand(game, { action: "strip", id: "merchants_regret" }), /isn't in the fleet/);
  assert.throws(() => fleetCommand(game, { action: "strip", id: "slow_harriet" }), /decision in the story/);
  assert.throws(() => fleetCommand(game, { action: "strip", id: "meridian" }), /decision in the story/);
});

test("no dead ends: a broke, empty fleet in open space can always claw its way back", () => {
  const game = newGame();
  game.credits = 0;
  game.ship.fuel = 0;
  game.fleet.food = 0;
  game.fleet.medicine = 0;
  game.fleet.parts = 0;
  game.ship.morale = 5;
  game.fleet.health = 5;
  days(game, 1);
  fleetCommand(game, { action: "crews", id: "fuel" });
  for (let i = 0; i < 12 && game.ship.fuel < 1; i += 1) {
    fleetCommand(game, { action: "wait", days: 1 });
    if (game.fleet.raid) answerRaid(game, "scatter");
  }
  assert.ok(game.ship.fuel >= 1, "skimming should get the fleet some fuel");
  fleetCommand(game, { action: "course", id: "graveyard" });
  assert.equal(game.fleet.at, "graveyard");
});

test("a whole year of careless play never breaks anything, and never ends the game", () => {
  const orders = ["upkeep", "farms", "fuel", "repairs", "salvage", "medical", "silent", "rest"];
  const rations = ["generous", "standard", "reduced", "half"];
  const places = Object.keys(STAR_MAP.places).filter((id) => !LOCATIONS[id].hidden);
  for (let seed = 1; seed <= 4; seed += 1) {
    const game = newGame(seed);
    let roll = seed * 7919;
    const next = (n) => {
      roll = (Math.imul(roll, 1664525) + 1013904223) >>> 0;
      return (roll >>> 8) % n;
    };
    for (let day = 0; day < 365; day += 1) {
      if (next(6) === 0) fleetCommand(game, { action: "crews", id: orders[next(orders.length)] });
      if (next(9) === 0) fleetCommand(game, { action: "rations", id: rations[next(rations.length)] });
      if (next(5) === 0) {
        try {
          fleetCommand(game, { action: "course", id: places[next(places.length)] });
        } catch (err) {
          assert.match(err.message, /fuel|Already/);
        }
      }
      if (!game.fleet.raid) fleetCommand(game, { action: "wait", days: 1 });
      if (game.fleet.raid) {
        const options = fleetView(game).raid.responses.filter((entry) => entry.available);
        assert.ok(options.length, "there's always something the captain can order");
        answerRaid(game, options[next(options.length)].id);
      }
      for (const key of ["food", "medicine", "parts"]) assert.ok(Number.isFinite(game.fleet[key]) && game.fleet[key] >= 0, key);
      assert.ok(game.fleet.pursuit >= 0 && game.fleet.pursuit <= 100);
      assert.ok(game.ship.morale >= 0 && game.ship.morale <= 100);
      assert.ok(game.fleet.health >= 0 && game.fleet.health <= 100);
      assert.ok(game.ship.fuel >= 0 && game.ship.fuel <= game.ship.maxFuel);
      assert.ok(game.ship.hull >= 1);
      assert.ok(game.hp >= 1);
    }
    const left = activeShips(game);
    // Only a story that says so can lose a ship the stories need.
    const named = new Set(Object.values(STORY_CLOCK.threads).flatMap((entry) => entry.stages.map((stage) => stage.fleet?.named?.id)));
    for (const ship of FLEET_DATA.ships.filter((entry) => entry.story && !named.has(entry.id))) assert.ok(left.includes(ship.id), `${ship.id} was lost`);
    assert.ok(people(game) >= FLEET_DATA.rules.peopleFloor);
    assert.ok(game.fleet.log.length <= 40);
    assert.doesNotThrow(() => publicState(game));
    assert.doesNotThrow(() => aiSnapshot(game));
  }
});

// ---- The star map -------------------------------------------------------

test("every place outside the fleet has a spot on the chart, inside the frame", () => {
  for (const [id, place] of Object.entries(LOCATIONS)) {
    if (place.fleet) continue;
    const spot = STAR_MAP.places[id];
    assert.ok(spot, `${id} isn't on the chart`);
    assert.ok(spot.x > 0 && spot.x < STAR_MAP.cols - 1 && spot.y > 0 && spot.y < STAR_MAP.rows - 1, `${id} is off the chart`);
    assert.ok(spot.short, id);
    assert.ok(Number.isInteger(spot.danger) && spot.danger >= 0 && spot.danger < STAR_MAP.dangerLevels.length, id);
    for (const supplyId of [...Object.keys(spot.yields ?? {}), ...Object.keys(spot.trade ?? {})]) assert.ok(FLEET_DATA.supplies[supplyId], `${id}: ${supplyId}`);
  }
  for (const id of Object.keys(STAR_MAP.places)) assert.ok(LOCATIONS[id], `${id} isn't a place`);
});

test("no two names on the chart overlap, even with every place known", () => {
  const boxes = Object.entries(STAR_MAP.places).map(([id, spot]) => {
    const width = spot.short.length + 2;
    // Near the right-hand edge the name goes on the left of the star, as public/fleet.js draws it.
    const flip = spot.x + spot.short.length + 3 > STAR_MAP.cols;
    const left = flip ? spot.x - spot.short.length - 1 : spot.x;
    return { id, y: spot.y, left, right: left + width };
  });
  for (const box of boxes) {
    assert.ok(box.left >= 0 && box.right <= STAR_MAP.cols, `${box.id} runs off the chart`);
    for (const other of boxes) {
      if (box === other || box.y !== other.y) continue;
      assert.ok(box.right <= other.left || other.right <= box.left, `${box.id} overlaps ${other.id}`);
    }
  }
});

test("the map shows what a jump costs, how dangerous it is and who runs the place", () => {
  const game = newGame();
  const places = publicState(game).locations;
  const haven = places.find((place) => place.id === "haven");
  assert.ok(haven, "Haven should be on every captain's chart");
  assert.equal(haven.fuel, 1);
  assert.ok(haven.hours > 1);
  assert.equal(typeof haven.dangerLabel, "string");
  assert.equal(typeof haven.control, "string");
  assert.equal(haven.canGo, true);
  const vantor = places.find((place) => place.id === "vantor");
  assert.ok(vantor.fuel > haven.fuel && vantor.hours > haven.hours, "further should cost more");
  assert.equal(vantor.control, "Hegemony");
  const own = places.find((place) => place.id === "sundial");
  assert.equal(own.fuel, 0);
  assert.equal(own.hours, 1);
  assert.ok(!places.some((place) => place.id === "harbor"), "the end of the story stays hidden");
  assert.ok(!places.some((place) => place.id === "nest"), "this hasn't come up in the story yet");
  game.seenLore.push("place:nest");
  assert.equal(publicState(game).locations.find((place) => place.id === "nest").control, "The Choir");
});

test("a jump needs all its fuel, says so on the map, and costs fuel in the game", () => {
  const game = newGame();
  game.skills.navigation = 0;
  game.ship.fuel = 1;
  const vantor = publicState(game).locations.find((place) => place.id === "vantor");
  assert.equal(vantor.canGo, false);
  assert.match(vantor.why, /2 fuel/);
  assert.throws(() => travel(game, "vantor"), /2 fuel/);
  assert.equal(game.ship.fuel, 1, "a failed jump costs nothing");
  game.ship.fuel = 5;
  travel(game, "vantor");
  assert.equal(game.ship.fuel, 3);
  assert.equal(game.fleet.at, "vantor");
  assert.equal(jumpCost(game, "vantor").jump, false, "you can't jump to where you already are");
});

test("Set course runs here, and the story hears about it when the player carries on", () => {
  const game = newGame();
  const { message, notes, moved } = fleetCommand(game, { action: "course", id: "haven" });
  assert.equal(moved, true);
  assert.equal(game.location, "haven");
  assert.match(message, /Jumped to Haven Station/);
  assert.match(notes[0], /^\[NAV\]/);
  assert.equal(game.pendingEvents.length, 1);
  assert.match(game.pendingEvents[0], /jumped to Haven Station/);
  assert.equal(publicState(game).pendingEvents, 1);
  // From Haven, the fleet's ships and Haven itself are a short hop.
  fleetCommand(game, { action: "course", id: "meridian" });
  assert.equal(game.fleet.at, "haven");
  const fuel = game.ship.fuel;
  const { message: back } = fleetCommand(game, { action: "course", id: "haven" });
  assert.match(back, /Crossed over/);
  assert.equal(game.ship.fuel, fuel);
});

// ---- What the game master hears -----------------------------------------

test("the game master gets one compact line, rounded so it doesn't change every turn", () => {
  const game = newGame();
  const line = fleetLine(game);
  assert.ok(aiSnapshot(game).split("\n").includes(line));
  assert.ok(line.length < 260, `the fleet line is ${line.length} characters`);
  assert.match(line, /41 ships/);
  assert.match(line, /30,000 people/);
  assert.match(line, /Choir pursuit/);
  game.clock.hours += 3;
  assert.equal(fleetLine(game), line, "nothing's changed, so the line shouldn't");
  const full = aiSnapshot(game).length;
  assert.ok(line.length / full < 0.2, "the line should be a small part of the state");
  game.fleet.ships.fair_exchange.status = "lost";
  game.ship.fuel = 0;
  assert.match(fleetLine(game), /Fair Exchange/);
  assert.match(fleetLine(game), /fuel OUT/);
});

test("the report goes out once, keeps to the newest news, and stays small", () => {
  const game = newGame();
  assert.equal(fleetReport(game), null);
  game.fleet.food = 30;
  days(game, 2);
  days(game, 4);
  const report = fleetReport(game);
  assert.match(report, /^<fleet_report>/);
  assert.match(report, /out of food/);
  assert.ok(!/Food is down to/.test(report), "running low is old news once it's run out");
  assert.ok(report.length < 900, `the report is ${report.length} characters`);
  assert.equal(fleetReport(game), null, "it should only go out once");
});

test("when the AI moves the clock, it hears straight away and not a second time", () => {
  const game = newGame();
  game.fleet.food = 1;
  game.clock.hours = 20;
  const { result, notice } = tool(game, "pass_time", { hours: 48, activity: "active", reason: "A long wait" });
  assert.match(result, /out of food/);
  assert.match(notice, /\[SUPPLY\]/);
  assert.equal(fleetReport(game), null);
});

test("the AI's tools change the fleet only within limits, and its answers are checked", () => {
  const game = newGame();
  const food = game.fleet.food;
  const { result, isError } = tool(game, "change_fleet", { food: 9999, reason: "Too good to be true" });
  assert.ok(!isError, result);
  assert.equal(game.fleet.food, food + 120);
  tool(game, "change_fleet", { pursuit: 25, reason: "A broadcast" });
  assert.equal(game.fleet.pursuit, FLEET_DATA.start.pursuit + 25);
  tool(game, "change_fleet", { pursuit: 200, reason: "Another" });
  tool(game, "change_fleet", { pursuit: 200, reason: "And another" });
  assert.ok(game.fleet.pursuit < 100, "only time can start a raid");
  assert.equal(tool(game, "change_fleet", { reason: 7 }).isError, true);

  assert.match(tool(game, "change_fleet_ship", { ship: "Ninefold", condition: -20, reason: "A bad landing" }).result, /Ninefold/);
  assert.equal(game.fleet.ships.ninefold.condition, FLEET_SHIPS.ninefold.condition - 20);
  assert.match(tool(game, "change_fleet_ship", { ship: "the Patience of Ostra", status: "lost", reason: "Scuttled" }).notice, /is lost/);
  assert.equal(game.fleet.ships.patience_of_ostra.status, "lost");
  assert.equal(game.fleet.ships.patience_of_ostra.aboard, 0);
  assert.equal(tool(game, "change_fleet_ship", { ship: "The Sundial", status: "lost", reason: "No" }).isError, true);
  assert.equal(tool(game, "change_fleet_ship", { ship: "CFS Meridian", status: "gone", reason: "No" }).isError, true);
  assert.equal(tool(game, "change_fleet_ship", { ship: "The Forty-Second", condition: 5, reason: "No" }).isError, true);
  assert.match(tool(game, "change_fleet_ship", { ship: "Patience of Ostra", status: "active", reason: "Found her" }).notice, /back/);
  assert.equal(game.fleet.ships.patience_of_ostra.status, "active");
});

test("the AI can read the roster, or just one ship, which is much smaller", () => {
  const game = newGame();
  const all = tool(game, "read_fleet", {}).result;
  assert.equal(all.split("\n").length, 41);
  const one = tool(game, "read_fleet", { ship: "Wintermere" }).result;
  assert.match(one, /School ship/);
  assert.ok(one.length < 300);
  assert.ok(all.length > one.length * 20);
  assert.equal(tool(game, "read_fleet", { ship: "Honest Mistake" }).isError, true);
});

test("stories don't start from a ship that's gone", () => {
  const game = newGame();
  game.level = 8;
  game.turn = 0;
  game.fleet.ships.patience_of_ostra.status = "lost";
  for (const id of ["meridian", "sundial", "anselm"]) {
    game.location = id;
    assert.ok(!leadsHere(game).some((lead) => lead.id === "main_the_ship_that_sat_down"));
  }
  game.fleet.ships.second_thursday.status = "lost";
  game.clock.hours = 30 * 24;
  for (let turn = 0; turn < 300; turn += 6) {
    game.turn = turn;
    const news = fleetNews(game);
    if (news) assert.ok(!news.includes("Second Thursday"), news);
  }
});

// A stand-in for Anthropic's API, to check what actually gets sent.
let server;
let requests = [];
let replies = [];

function respond(res, body, reply) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  reply.blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: reply.stop ?? "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", {});
  res.end();
}

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    respond(res, body, replies.shift() ?? { blocks: [{ type: "text", text: "Nothing more." }] });
  });
  await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  server.close();
});

const settings = { provider: "claude", model: "claude-opus-5-5", apiKey: "test-key-not-real" };
const lastMessageText = () => {
  const { content } = requests.at(-1).messages.at(-1);
  return typeof content === "string" ? content : content.map((part) => part.text ?? part.content ?? "").join("\n");
};

test("the daily simulation makes no calls at all", async () => {
  requests = [];
  const game = newGame();
  for (const order of [{ action: "wait", days: 3 }, { action: "rations", id: "reduced" }, { action: "crews", id: "fuel" }, { action: "course", id: "haven" }, { action: "evade" }]) fleetCommand(game, order);
  days(game, 30);
  await new Promise((resolve) => { setTimeout(resolve, 10); });
  assert.equal(requests.length, 0);
});

test("a shortage reaches the game master once, with its next message", async () => {
  requests = [];
  replies = [];
  const game = newGame();
  game.fleet.food = 1;
  days(game, 2);
  assert.ok(game.fleet.unheard.length);
  replies = [{ blocks: [{ type: "text", text: "One." }] }, { blocks: [{ type: "text", text: "Two." }] }];
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  assert.match(lastMessageText(), /<fleet_report>/);
  assert.match(lastMessageText(), /out of food/);
  assert.match(lastMessageText(), /Fleet: 41 ships/);
  await runTurn({ game, settings, playerText: "I look around again.", emit: () => {} });
  assert.ok(!lastMessageText().includes("<fleet_report>"));
});

test("a raid set off by the AI's clock ends its turn, and it hears how it went next", async () => {
  requests = [];
  const game = newGame();
  game.fleet.pursuit = 99;
  game.clock.hours = 20;
  replies = [{ blocks: [{ type: "tool_use", id: "t1", name: "pass_time", input: { hours: 24, activity: "active", reason: "A long watch" } }], stop: "tool_use" }];
  await runTurn({ game, settings, playerText: "We wait.", emit: () => {} });
  assert.equal(requests.length, 1, "the AI shouldn't be asked to write until the raid's answered");
  assert.ok(game.fleet.raid);
  const toolResult = game.ai.messages.at(-1).content[0].content;
  assert.match(toolResult, /Choir raid/);
  assert.match(toolResult, /write nothing more/);

  answerRaid(game, "scatter");
  assert.equal(publicState(game).pendingEvents, 1);
  replies = [{ blocks: [{ type: "text", text: "The aftermath." }] }];
  await runTurn({ game, settings, gameEvent: "Continue the story from here.", emit: () => {} });
  assert.match(lastMessageText(), /\[Game event, not written by the player\] A Choir raid hit the fleet/);
  assert.equal(game.pendingEvents.length, 0);
});

test("all of this adds only a little to what each message costs", async () => {
  requests = [];
  replies = [{ blocks: [{ type: "text", text: "One." }] }, { blocks: [{ type: "text", text: "Two." }] }];
  const game = newGame();
  await runTurn({ game, settings, playerText: "Hello.", emit: () => {} });
  await runTurn({ game, settings, playerText: "Hello again.", emit: () => {} });
  const quiet = lastMessageText();
  assert.ok(!quiet.includes("Fleet:"), "the fleet line only goes out when it changes");
  // Well under a hundred tokens on a turn when the fleet's numbers have changed.
  assert.ok(fleetLine(game).length < 260);
});

// ---- Old saves ----------------------------------------------------------

const oldSave = (changes = {}) => {
  const save = JSON.parse(JSON.stringify({ ...newGame(), version: 6, ...changes }));
  delete save.fleet;
  return save;
};

test("a save from before the fleet loads, with nothing charged for the days already gone", () => {
  const save = oldSave({ clock: { hours: 24 * 9 + 5 }, location: "kessara" });
  save.ship = { name: "CFS Meridian", hull: 40, maxHull: 100, fuel: 3, maxFuel: 12, morale: 31 };
  save.transcript = [{ role: "narrator", text: "The story so far.\n\n> Do something" }];
  const game = migrateGame(save);
  assert.equal(game.version, 15);
  assert.equal(game.fleet.day, 9);
  assert.equal(game.fleet.at, "kessara");
  assert.equal(game.fleet.food, FLEET_DATA.start.food);
  assert.equal(activeShips(game).length, 41);
  assert.equal(game.ship.fuel, 3, "fuel stays what it was");
  assert.equal(game.ship.morale, 31, "morale stays what it was");
  assert.equal(game.ship.hull, 40);
  assert.equal(fleetView(game).ships.find((ship) => ship.id === "meridian").condition, 40);
  assert.equal(game.fleet.raid, null);
  assert.equal(game.pendingEvents.length, 0, "the player's choices should still be on screen");
  assert.match(game.transcript.at(-1).text, /Fleet menu/);
  assert.doesNotThrow(() => publicState(game));
  assert.doesNotThrow(() => aiSnapshot(game));
  passTime(game, 24);
  assert.ok(game.fleet.food < FLEET_DATA.start.food);
});

test("loading a save twice changes nothing the second time", () => {
  const once = migrateGame(oldSave());
  const twice = migrateGame(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("a save aboard a fleet ship starts in open space, and one from any older version works", () => {
  assert.equal(migrateGame(oldSave({ location: "sundial" })).fleet.at, null);
  const ancient = { ...oldSave(), version: 3, bestiary: undefined };
  delete ancient.campaign;
  const game = migrateGame(ancient);
  assert.equal(game.version, 15);
  assert.ok(game.fleet);
  assert.doesNotThrow(() => publicState(game));
});

test("ships added to or removed from the file reach a save, and a new save always matches the file", () => {
  const game = newGame();
  game.fleet.ships.old_friend = { condition: 50, aboard: 10, status: "active" };
  delete game.fleet.ships.kittiwake;
  const migrated = migrateGame(JSON.parse(JSON.stringify(game)));
  assert.equal(migrated.fleet.ships.old_friend, undefined);
  assert.ok(migrated.fleet.ships.kittiwake);
  assert.doesNotThrow(() => publicState(migrated));
  assert.equal(newGame().version, 15);
});

test("sleeping pays for the day too", () => {
  const game = newGame();
  game.location = "meridian";
  game.clock.hours = 20;
  const food = game.fleet.food;
  rest(game);
  assert.ok(game.fleet.food < food);
});
