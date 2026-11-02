// The player can be anyone: being captain is one way to start, and otherwise someone else has the chair. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-anyone-"));
process.env.GAME_DATA_DIR = dataDir;

const { SYSTEM_PROMPT, runTurn } = await import("../src/ai.js");
const { findCharacter } = await import("../src/campaign.js");
const { NOTABLES, SKILLS } = await import("../src/character-data.js");
const { checkView, startCheck } = await import("../src/checks.js");
const { buildCharacter, createGameFromDraft, creatorSetup, normalizeDraft, randomDraft } = await import("../src/creator.js");
const { FACTIONS, LOCATIONS, STARTING_QUESTS, WORLD_BIBLE } = await import("../src/data.js");
const { answerRaid, chairOf, changeCommand, fleetCommand, fleetLine, fleetReport, fleetView } = await import("../src/fleet.js");
const { peopleAboard } = await import("../src/life.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { START_LIST, inTheFleet, isCaptain, jobHere, openingFor, startOf } = await import("../src/role.js");
const { aiDossier, aiSnapshot, passTime, publicState, rest, restCost, travel, workShift } = await import("../src/rules.js");
const { arcBrief, fleetNews, leadsHere, storyView, threadNotes } = await import("../src/story-library.js");
const { hasMovedOn, leadNow } = await import("../src/story-clock.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { mapFor, walkLine, walkOf, walkView } = await import("../src/walk.js");
const { FLEET_DATA, STAR_MAP, STORY_CLOCK, WORLD_MAPS, WORLD_THREADS } = await import("../src/world.js");

const CHAIR = FLEET_DATA.chair;
const OTHERS = Object.keys(START_LIST).filter((id) => id !== "captain");
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const days = (game, count) => passTime(game, 24 * count, "routine");
const activeShips = (game) => Object.values(game.fleet.ships).filter((ship) => ship.status === "active").length;

// ---- What's written down -----------------------------------------------------------

test("every start is somewhere real, with real people, a real job and something on their mind", () => {
  assert.ok(START_LIST.captain?.captain);
  assert.ok(OTHERS.length >= 15, `only ${OTHERS.length} ways to start`);
  for (const id of OTHERS) {
    const start = START_LIST[id];
    assert.ok(["fleet", "world"].includes(start.group), id);
    for (const field of ["name", "short", "desc", "gm", "opening"]) assert.ok(typeof start[field] === "string" && start[field].length > 3, `${id}: ${field}`);
    assert.ok(LOCATIONS[start.place], `${id}: ${start.place}`);
    assert.ok(mapFor(start.place)?.levels[start.room], `${id}: there's no ${start.room} at ${start.place}`);
    assert.ok(start.job.name && start.job.done && start.job.pay > 0 && SKILLS[start.job.skill], `${id}: the job`);
    for (const person of start.people) assert.ok(NOTABLES[person], `${id}: ${person}`);
    for (const faction of Object.keys(start.factions ?? {})) assert.ok(FACTIONS[faction], `${id}: ${faction}`);
    for (const field of ["id", "title", "desc", "objective"]) assert.ok(start.quest[field], `${id}: the quest's ${field}`);
    assert.ok(!/\b(captain of the Meridian|your fleet|your ship)\b/i.test(start.desc), `${id} sounds like a captain`);
    if (start.group === "fleet") assert.ok(LOCATIONS[start.place].fleet, `${id} is listed with the fleet, and isn't there`);
  }
  assert.equal(new Set(OTHERS.map((id) => START_LIST[id].quest.id)).size, OTHERS.length, "each has a quest of its own");
});

test("nearly every story can reach someone who isn't the captain, in words written for them", () => {
  const ids = Object.keys(WORLD_THREADS);
  const open = ids.filter((id) => WORLD_THREADS[id].anyone);
  assert.ok(open.length >= 110, `only ${open.length} stories`);
  for (const id of open) {
    const text = WORLD_THREADS[id].anyone;
    assert.ok(text.length > 40, id);
    assert.ok(!/\b(you|your|yours)\b/i.test(text), `${id} is talking to the captain: ${text}`);
  }
  for (const id of ids.filter((one) => !WORLD_THREADS[one].anyone)) assert.ok(WORLD_THREADS[id].kind, `${id} is the captain's own`);
});

test("three people could have the chair, each with a file, a post, a day, and their own way of doing it", () => {
  const ids = Object.keys(CHAIR.captains);
  assert.equal(ids.length, 3);
  for (const id of ids) {
    const person = NOTABLES[id];
    assert.ok(person, `${id} has no file`);
    assert.equal(person.chair, true);
    assert.equal(person.listed, false, "the game master doesn't need them unless they're in the chair");
    assert.ok(person.goals && person.secrets && person.voice);
    assert.ok(Object.values(mapFor("meridian").levels).some((level) => level.homes.some((home) => home.id === id)), `${id} has no post`);
    const file = CHAIR.captains[id];
    assert.equal(file.name, `Captain ${person.name.split(" ").at(-1)}`);
    for (const key of ["moveAt", "stockTo", "runAt", "restDays", "risk", "fightGuns"]) assert.ok(Number.isFinite(file[key]), `${id}: ${key}`);
  }
  for (const port of CHAIR.ports) assert.ok(STAR_MAP.places[port] && !LOCATIONS[port].hidden, port);
  for (const crews of Object.values(CHAIR.crews)) assert.ok(FLEET_DATA.crews[crews], crews);
});

test("a captain's game hasn't changed: it starts where it always did, with the people it always had", () => {
  const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
  assert.equal(game.version, 14);
  assert.deepEqual(game.role, { id: "captain", captain: true });
  assert.equal(isCaptain(game), true);
  assert.equal(game.location, "meridian");
  assert.equal(game.fleet.chair, null);
  assert.deepEqual(game.quests.map((quest) => quest.id), STARTING_QUESTS.map((quest) => quest.id));
  assert.ok(game.contacts.some((contact) => contact.name === NOTABLES.voss.name));
  assert.equal(publicState(game).role.captain, true);
  assert.equal(publicState(game).role.job, null);
  assert.equal(chairOf(game), null);
  assert.match(aiSnapshot(game), /^Day 1, 08:00\. Captain /);
  assert.match(fleetLine(game), /^Fleet: 41 ships/);
  assert.match(aiDossier(game), /Their place in the world: The captain of the CFS Meridian/);
  assert.equal(openingFor(game), "The game is starting. Open the story: The Meridian has just picked up the mysterious Beacon signal, and the player has just been made captain. Introduce Commander Voss.");
  assert.match(publicState(game).people.find((person) => person.id === "voss").role, /^Your /);
});

// ---- Starting as someone else -------------------------------------------------------

for (const id of OTHERS) {
  test(`starting as ${START_LIST[id].short}: in the right place, in the right room, with the right people`, () => {
    const start = START_LIST[id];
    const game = newGame(id);
    assert.deepEqual(game.role, { id, captain: false });
    assert.equal(isCaptain(game), false);
    assert.equal(game.location, start.place);
    assert.equal(game.walk.level, start.room);
    assert.equal(walkView(game).here.name, mapFor(start.place).levels[start.room].name);
    assert.ok(game.seenLore.includes(`place:${start.place}`));
    assert.deepEqual(game.quests.map((quest) => quest.id), [start.quest.id]);
    assert.ok(game.contacts.length >= start.people.length);
    for (const person of start.people) assert.ok(game.contacts.some((contact) => contact.name === NOTABLES[person].name), person);
    assert.equal(game.fleet.at, null, "the fleet is wherever it is, and it's not here");
    assert.ok(chairOf(game));
    const shown = publicState(game);
    assert.equal(shown.role.title, start.name);
    assert.equal(shown.role.job.name, start.job.name);
    assert.ok(shown.locations.some((place) => place.here));
    for (const person of start.people) assert.ok(!shown.contacts.find((contact) => contact.name === NOTABLES[person].name).note.includes("Your "), "nobody here is theirs to command");
    assert.ok(aiSnapshot(game).startsWith(`Day 1, 08:00. ${game.name}, ${start.short}, not in command`));
    assert.match(aiDossier(game), /They are not the captain\./);
    assert.ok(aiDossier(game).includes(start.gm));
    assert.ok(openingFor(game).includes(start.opening));
    assert.ok(openingFor(game).startsWith("The game is starting. Open the story:"));
    assert.ok(!openingFor(game).includes("made captain"));
  });
}

test("how someone got through the Fall depends on where they ended up", () => {
  for (const fall of ["last_stand", "evacuated", "fled", "captured", "away"]) {
    const captain = randomDraft({ seed: 5, archetype: "officer" });
    captain.life.fall = fall;
    const other = structuredClone(captain);
    other.start = "docker";
    const told = buildCharacter(captain).view.life;
    const elsewhere = buildCharacter(other).view.life;
    assert.match(told.biography.at(-1), /Meridian/, fall);
    assert.ok(!/Meridian/.test(elsewhere.biography.at(-1)), `${fall}: ${elsewhere.biography.at(-1)}`);
    assert.ok(!/Meridian/.test(elsewhere.fall.text), `${fall}: ${elsewhere.fall.text}`);
    assert.deepEqual(buildCharacter(other).game.stats, buildCharacter(captain).game.stats, "and it's only the words that change");
    assert.equal(told.fall.label, elsewhere.fall.label);
  }
});

test("the creator offers every start, keeps the choice, and won't take a start that doesn't exist", () => {
  const setup = creatorSetup();
  assert.equal(Object.keys(setup.starts).length, Object.keys(START_LIST).length);
  assert.ok(setup.steps.some((step) => step.id === "role"));
  assert.ok(setup.startGroups.fleet && setup.startGroups.world);
  assert.equal(setup.starts.docker.pay, START_LIST.docker.job.pay);
  assert.equal(setup.starts.docker.place, LOCATIONS.haven.name);
  assert.equal(normalizeDraft({}).start, "captain");
  assert.equal(normalizeDraft({ start: "docker" }).start, "docker");
  assert.equal(normalizeDraft({ start: "emperor" }).start, "captain");
  assert.equal(normalizeDraft({ start: "constructor" }).start, "captain");
  const captain = randomDraft({ seed: 9, archetype: "officer" });
  assert.equal(captain.start, "captain");
  assert.equal(buildCharacter(captain).view.start.begin, "Take command of the Meridian");
  assert.equal(randomDraft({ seed: 9, archetype: "officer", keep: { start: "miner" } }).start, "miner");
  const miner = buildCharacter({ ...captain, start: "miner" }).view;
  assert.equal(miner.start.begin, `Begin at ${LOCATIONS.cinder.name}`);
  assert.equal(miner.errors.role.length, 0);
  const seen = new Set();
  for (let seed = 0; seed < 60; seed += 1) seen.add(randomDraft({ seed, anyone: true }).start);
  assert.ok(seen.size > 8, "Surprise me really can be anyone");
});

// ---- What they can and can't do -----------------------------------------------------------

test("someone who isn't the captain can't give the fleet orders, but they can wait, and go places", () => {
  const game = newGame("docker");
  const { rations, crews } = game.fleet;
  for (const order of [{ action: "rations", id: "half" }, { action: "crews", id: "rest" }, { action: "evade" }, { action: "buy", id: "fuel" }, { action: "sell", id: "fuel" }, { action: "strip", id: "kittiwake" }, { action: "council", on: false }, { action: "raid", id: "jump" }]) {
    assert.throws(() => fleetCommand(game, order), /has the chair/, order.action);
  }
  assert.equal(game.fleet.rations, rations);
  assert.equal(game.fleet.crews, crews);
  const waited = fleetCommand(game, { action: "wait", days: 1 });
  assert.match(waited.message, /^You let 1 day go by/);
  assert.ok(game.clock.hours >= 32);
});

test("passage costs credits and time, moves them and nobody else, and doesn't touch the fleet", () => {
  const game = newGame("docker");
  game.credits = 200;
  const { fuel } = game.ship;
  const { pursuit } = game.fleet;
  const at = game.fleet.at;
  const entry = publicState(game).locations.find((place) => place.id === "kessara");
  assert.ok(entry.fare > 0, "it isn't free");
  assert.equal(entry.fuel, 0, "and it's not the fleet's fuel");
  assert.equal(entry.jump, true);
  assert.equal(entry.shakes, 0);
  assert.equal(entry.canGo, true);
  const hours = game.clock.hours;
  const result = fleetCommand(game, { action: "course", id: "kessara" });
  assert.equal(result.moved, true);
  assert.equal(game.location, "kessara");
  assert.equal(game.credits, 200 - entry.fare);
  assert.equal(game.ship.fuel, fuel);
  assert.equal(game.fleet.at, at);
  assert.ok(game.fleet.pursuit >= pursuit, "and nobody's shaken off the Choir by it");
  assert.equal(game.clock.hours, hours + entry.hours);
  assert.equal(game.walk, null);
  assert.ok(game.pendingEvents.some((line) => line.includes("passage to Kessara Drift") && line.includes("alone")));
  assert.match(result.message, /^Took passage/);
});

test("nobody can book a passage they can't pay for, or that nobody runs", () => {
  const game = newGame("docker");
  game.credits = 2;
  const entry = publicState(game).locations.find((place) => place.id === "kessara");
  assert.equal(entry.canGo, false);
  assert.match(entry.why, /Passage costs \d+ credits, and you have 2/);
  assert.throws(() => fleetCommand(game, { action: "course", id: "kessara" }), /costs \d+ credits/);
  assert.equal(game.location, "haven");
  game.credits = 9000;
  game.seenLore.push("place:nest");
  const nest = publicState(game).locations.find((place) => place.id === "nest");
  assert.equal(nest.canGo, false);
  assert.match(nest.why, /Nobody runs a ship there/);
  assert.throws(() => fleetCommand(game, { action: "course", id: "nest" }), /Nobody runs a ship/);
  assert.equal(game.credits, 9000);
});

test("danger and distance make a passage dearer, and the fleet's ships are a short hop only from the fleet", () => {
  const game = newGame("docker");
  game.credits = 500;
  const fare = (id) => publicState(game).locations.find((place) => place.id === id);
  assert.ok(fare("kessara").fare > 0);
  assert.equal(fare("meridian").jump, true, "the fleet isn't here");
  assert.ok(fare("meridian").fare > 0);
  game.fleet.at = "haven";
  assert.equal(inTheFleet(game), true);
  assert.equal(fare("meridian").jump, false, "and now it is");
  assert.equal(fare("meridian").fare, 0);
  assert.equal(fare("meridian").hours, 1);
  const before = game.credits;
  fleetCommand(game, { action: "course", id: "meridian" });
  assert.equal(game.location, "meridian");
  assert.equal(game.credits, before);
  assert.equal(fare("sundial").jump, false, "and from one ship to another");
  assert.equal(fare("haven").jump, false, "and back to the dock");
  game.fleet.at = "cinder";
  game.seenLore.push("place:cinder");
  assert.equal(fare("cinder").jump, false);
  assert.equal(fare("haven").jump, true, "the fleet took them along");
  const cheap = newGame("docker");
  cheap.seenLore.push("place:ghostlight", "place:deepyards");
  const spots = STAR_MAP.places;
  assert.ok(spots.ghostlight.danger > spots.deepyards.danger);
  const quiet = publicState(cheap).locations.find((place) => place.id === "deepyards");
  const risky = publicState(cheap).locations.find((place) => place.id === "ghostlight");
  assert.ok(risky.fare > quiet.fare, `${risky.fare} against ${quiet.fare}`);
  assert.ok(Number.isInteger(quiet.fare) && Number.isInteger(risky.fare));
});

test("if the story takes them somewhere, they go by themselves, and it can't move the fleet", () => {
  const game = newGame("engine_hand");
  const { fuel } = game.ship;
  const { message } = travel(game, "wheel");
  assert.match(message, /Took passage/);
  assert.equal(game.location, "wheel");
  assert.equal(game.ship.fuel, fuel);
  assert.equal(game.fleet.at, null);
  assert.equal(inTheFleet(game), false);
  const { result, isError } = tool(game, "travel", { destination: "korrath" });
  assert.ok(!isError, result);
  assert.equal(game.location, "korrath");
  assert.equal(game.fleet.at, null);
});

test("a shift at their job pays, takes eight hours, tires them out, and practices what it's for", () => {
  const game = newGame("docker");
  const start = startOf(game);
  const credits = game.credits;
  const hours = game.clock.hours;
  const fatigue = game.needs.fatigue;
  assert.equal(publicState(game).role.job.name, start.job.name);
  const said = workShift(game);
  assert.ok(said.includes(start.job.done));
  assert.ok(game.credits >= credits + start.job.pay);
  assert.equal(game.clock.hours, hours + 8);
  assert.ok(game.needs.fatigue > fatigue);
  assert.ok((game.skillXp[start.job.skill] ?? 0) > 0);
  game.needs.fatigue = 90;
  assert.throws(() => workShift(game), /too tired/);
  game.needs.fatigue = 10;
  game.location = "kessara";
  assert.equal(jobHere(game), null);
  assert.throws(() => workShift(game), /no work here/);
  assert.equal(publicState(game).role.job, null);
  assert.equal(publicState(game).role.jobAway.place, LOCATIONS.haven.name);
  assert.throws(() => workShift(newGame()), /no work here/);
  assert.equal(publicState(newGame()).role.jobAway, null);
});

test("they can sleep for nothing where they live and in the fleet, and elsewhere they pay or sleep rough", () => {
  const game = newGame("docker");
  assert.equal(restCost(game), 0);
  game.hp = 1;
  let credits = game.credits;
  assert.match(rest(game), /at Haven Station/);
  assert.equal(game.credits, credits);
  assert.equal(game.hp, publicState(game).maxHp);
  game.location = "kessara";
  game.credits = 50;
  const cost = restCost(game);
  assert.ok(cost > 0);
  assert.match(rest(game), /rented bunk at Kessara Drift/);
  assert.equal(game.credits, 50 - cost);
  game.credits = 1;
  assert.throws(() => rest(game), /A bunk here costs/);
  game.hp = 1;
  game.needs.stress = 0;
  credits = game.credits;
  assert.match(rest(game, { rough: true }), /in a corner of Kessara Drift/);
  assert.equal(game.credits, credits);
  assert.ok(game.hp < publicState(game).maxHp, "it doesn't do you as much good");
  assert.ok(game.needs.stress > 0);
  game.location = "sundial";
  assert.equal(restCost(game), 0);
  assert.throws(() => rest(game, { rough: true }), /no need to sleep rough/);
  const captain = newGame();
  assert.equal(restCost(captain), 0);
  assert.match(rest(captain), /aboard the Meridian/);
  captain.location = "haven";
  assert.equal(restCost(captain), null);
  assert.throws(() => rest(captain), /only rest aboard the Meridian/);
});

// ---- Someone else in the chair ----------------------------------------------------------------

test("whoever has the chair is on the Meridian, and nobody else who could have had it is", () => {
  const game = newGame("engine_hand");
  game.clock.hours = 8;
  const chair = chairOf(game);
  const onBridge = peopleAboard(game, "meridian", "bridge").map((one) => one.id);
  assert.ok(onBridge.includes(chair.id), `${chair.id} isn't on the bridge: ${onBridge}`);
  for (const id of Object.keys(CHAIR.captains)) if (id !== chair.id) assert.ok(!onBridge.includes(id), id);
  assert.ok(onBridge.includes("voss"), "and Commander Voss is still her XO");
  const captain = newGame();
  const captainsBridge = peopleAboard(captain, "meridian", "bridge").map((one) => one.id);
  for (const id of Object.keys(CHAIR.captains)) assert.ok(!captainsBridge.includes(id), `${id} shouldn't be there for a captain`);
  assert.equal(fleetView(game).ships.find((ship) => ship.id === "meridian").captain, chair.name);
  assert.match(fleetView(captain).ships.find((ship) => ship.id === "meridian").captain, new RegExp(captain.name));
  assert.ok(findCharacter(game.campaign, chair.id).chair);
});

test("the same person gets the same captain, a save keeps them, and other people get others", () => {
  assert.equal(chairOf(newGame("docker")).id, chairOf(newGame("docker")).id);
  assert.equal(chairOf(JSON.parse(JSON.stringify(newGame("docker")))).id, chairOf(newGame("docker")).id);
  const seen = new Set();
  for (let seed = 1; seed < 40; seed += 1) seen.add(chairOf(newGame("docker", seed)).id);
  assert.equal(seen.size, 3);
});

test("the fleet goes on by itself: it moves, buys what it needs with its own money, and never asks the player", () => {
  const game = newGame("docker");
  const { credits } = game;
  const funds = game.fleet.chair.funds;
  const places = new Set();
  let bought = false;
  for (let day = 0; day < 120; day += 1) {
    const before = game.fleet.chair.funds;
    days(game, 1);
    if (game.fleet.chair.funds < before + CHAIR.income) bought = true;
    if (game.fleet.at) places.add(game.fleet.at);
    assert.equal(game.fleet.raid, null, "nobody's waiting for the player to answer a raid");
    assert.equal(game.pendingEvents.length, 0, "and nothing's waiting on them");
    assert.equal(game.location, "haven", "and they haven't been taken anywhere");
  }
  assert.equal(game.credits, credits, "none of that came out of their pocket");
  assert.ok(places.size >= 3, `the fleet only went to ${[...places]}`);
  assert.ok(bought, `it never bought anything: ${funds}`);
  for (const place of places) assert.ok(CHAIR.ports.includes(place), place);
  assert.ok(game.fleet.record.raids + places.size > 3);
  assert.ok(activeShips(game) >= 25, `only ${activeShips(game)} ships after 120 days`);
  assert.ok(game.fleet.food > 0 || game.fleet.medicine > 0);
});

test("raids get answered, by whoever has the chair, in their own way", () => {
  const order = (id) => {
    const game = newGame("docker");
    game.fleet.chair.id = id;
    game.fleet.chair.lastJump = 999;
    game.fleet.pursuit = 99.9;
    game.ship.hull = 90;
    game.ship.fuel = 8;
    const report = [];
    for (let day = 0; day < 2 && !game.fleet.record.raids; day += 1) {
      const clock = game.clock.hours;
      days(game, 1);
      report.push(game.clock.hours - clock);
    }
    assert.equal(game.fleet.record.raids, 1, id);
    assert.equal(game.fleet.raid, null, id);
    assert.ok(report.every((hours) => hours === 24), "a raid doesn't take any of the player's time");
    return game;
  };
  const fights = order("marchetti");
  assert.ok(fights.ship.hull < 90, "Captain Marchetti stands and fights");
  assert.ok(fights.fleet.pursuit <= 25, `pursuit ${fights.fleet.pursuit}`);
  const runs = order("reddick");
  assert.ok(runs.ship.fuel < 8, "Captain Reddick runs");
  assert.ok(runs.fleet.pursuit >= 40);
});

test("a raid costs them nothing unless they're there, and the captain's skills aren't theirs to lend", () => {
  const game = newGame("docker");
  game.needs.stress = 10;
  game.fleet.chair.lastJump = 999;
  game.fleet.pursuit = 99.9;
  const notes = days(game, 1);
  assert.equal(game.fleet.record.raids, 1);
  assert.equal(game.needs.stress, 10, "it's a long way off");
  assert.ok(!notes.some((line) => line.startsWith("[RAID]")), notes.join(" | "));
  assert.equal(fleetReport(game), null, "the game master doesn't hear it as the fleet's report");
  const aboard = newGame("engine_hand");
  aboard.fleet.chair.lastJump = 999;
  aboard.fleet.pursuit = 99.9;
  const heard = days(aboard, 1);
  assert.equal(aboard.fleet.record.raids, 1);
  assert.ok(heard.some((line) => line.startsWith("[RAID]")), heard.join(" | "));
  assert.equal(aboard.pendingEvents.length, 0);
  assert.match(fleetReport(aboard), /A Choir raid hit the fleet/);
});

test("if it costs a ship, it's news, wherever they are", () => {
  let told = null;
  for (let seed = 1; seed < 30 && !told; seed += 1) {
    const game = newGame("docker", seed);
    for (let day = 0; day < 40 && !told; day += 1) {
      game.fleet.chair.lastJump = 999;
      game.fleet.pursuit = 99.9;
      const lost = game.fleet.record.shipsLost;
      days(game, 1);
      if (game.fleet.record.shipsLost > lost && game.world.news.some((entry) => /The Choir has hit the Refugee Fleet/.test(entry.text))) told = game;
    }
  }
  assert.ok(told, "nobody heard about a ship being lost");
});

test("someone away from the fleet doesn't go hungry with it, or hear its troubles, or heal slower for them", () => {
  const away = newGame("docker");
  away.fleet.food = 0;
  away.fleet.medicine = 0;
  away.fleet.chair.funds = 0;
  const notes = days(away, 6);
  assert.ok(!away.conditions.some((condition) => condition.id === "underfed"));
  assert.ok(!notes.some((line) => line.startsWith("[SUPPLY]") || line.startsWith("[COUNCIL]")), notes.join(" | "));
  assert.ok(away.fleet.log.length > 0, "it's still happening, and it's in the fleet's own log");
  assert.equal(fleetReport(away), null);
  assert.match(fleetLine(away), /only know what's got around/);
  assert.ok(!fleetLine(away).includes("Left:"), "and the game master isn't reminded of what they can't know");
  const aboard = newGame("engine_hand");
  aboard.fleet.food = 0;
  aboard.fleet.chair.funds = 0;
  aboard.fleet.rations = "half";
  const heard = days(aboard, 6);
  assert.ok(aboard.conditions.some((condition) => condition.id === "underfed"), "aboard, they eat what everyone eats");
  assert.ok(heard.some((line) => line.startsWith("[SUPPLY]")));
  assert.match(fleetLine(aboard), /isn't the player's to command: \d+ ships/);
});

test("whoever's on the dock sees the fleet come and go", () => {
  const game = newGame("docker");
  game.fleet.at = "haven";
  game.fleet.food = 1;
  game.fleet.chair.id = "reddick";
  game.fleet.chair.funds = 0;
  game.world.places.haven.goods.food = 0;
  let notes = [];
  for (let day = 0; day < 12 && game.fleet.at === "haven"; day += 1) notes = days(game, 1);
  assert.notEqual(game.fleet.at, "haven", "they should have gone looking for food");
  assert.ok(notes.some((line) => /The Refugee Fleet has left Haven Station/.test(line)), notes.join(" | "));
  assert.equal(game.location, "haven");
  assert.equal(inTheFleet(game), false);
  assert.ok(game.world.news.some((entry) => /The Refugee Fleet has arrived at/.test(entry.text)));
});

test("a year of it under each of them never breaks anything, and comes out the same however it's cut up", () => {
  for (const id of Object.keys(CHAIR.captains)) {
    const game = newGame("engine_hand");
    game.fleet.chair.id = id;
    for (let day = 0; day < 365; day += 1) {
      days(game, 1);
      assert.equal(game.fleet.raid, null);
      for (const key of ["food", "medicine", "parts"]) assert.ok(Number.isFinite(game.fleet[key]) && game.fleet[key] >= 0, key);
      assert.ok(game.ship.fuel >= 0 && game.ship.fuel <= game.ship.maxFuel, `fuel ${game.ship.fuel}`);
      assert.ok(game.fleet.chair.funds >= 0);
      assert.ok(FLEET_DATA.rations[game.fleet.rations] && FLEET_DATA.crews[game.fleet.crews]);
      assert.ok(game.fleet.at === null || LOCATIONS[game.fleet.at]);
    }
    assert.ok(activeShips(game) >= 14, `${id}: ${activeShips(game)} ships`);
    assert.ok(JSON.stringify(game.fleet.chair).length < 200);
    assert.ok(JSON.stringify(game.fleet.council).length < 3000);
  }
  const one = newGame("docker");
  days(one, 70);
  const two = newGame("docker");
  days(two, 30);
  const loaded = JSON.parse(JSON.stringify(two));
  for (let day = 0; day < 40; day += 1) days(loaded, 1);
  assert.deepEqual(one.fleet.ships, loaded.fleet.ships);
  assert.deepEqual(one.fleet.chair, loaded.fleet.chair);
  assert.equal(one.fleet.at, loaded.fleet.at);
  assert.deepEqual(one.world.places, loaded.world.places);
});

test("a fleet under each of them lasts at least as long as a fleet nobody's looking after", () => {
  for (const seed of [3, 21, 77]) {
    const looked = newGame("docker", seed);
    days(looked, 100);
    assert.ok(activeShips(looked) >= 22, `seed ${seed}: ${activeShips(looked)} ships at day 100`);
    assert.ok(looked.fleet.health >= 25, `seed ${seed}: health ${looked.fleet.health} at day 100`);
    const onItsOwn = newGame("captain", seed);
    onItsOwn.fleet.council = { off: true, ordered: {}, waiting: {}, last: {}, setRations: null, setCrews: null, recent: [] };
    for (let day = 0; day < 100; day += 1) {
      days(onItsOwn, 1);
      if (onItsOwn.fleet.raid) answerRaid(onItsOwn, fleetView(onItsOwn).raid.responses.find((one) => one.available).id);
    }
    assert.ok(looked.fleet.health >= onItsOwn.fleet.health, `seed ${seed}: ${looked.fleet.health} against ${onItsOwn.fleet.health}`);
  }
});

// ---- The chair can change hands ----------------------------------------------------------------

test("the story can put them in the chair, once they're with the fleet, and then it's all theirs", () => {
  const game = newGame("engine_hand");
  const was = chairOf(game);
  const { result, notice, isError } = tool(game, "change_command", { takes: true, reason: "The council voted" });
  assert.ok(!isError, result);
  assert.match(notice, /You have command of the fleet: The council voted/);
  assert.ok(result.includes(was.name));
  assert.equal(isCaptain(game), true);
  assert.equal(chairOf(game), null);
  assert.equal(game.fleet.chair, null);
  fleetCommand(game, { action: "rations", id: "reduced" });
  assert.equal(game.fleet.rations, "reduced");
  game.fleet.pursuit = 99.9;
  days(game, 1);
  assert.ok(game.fleet.raid, "and the raids wait for them now");
  assert.equal(publicState(game).role.captain, true);
  assert.equal(publicState(game).role.job, null);
  assert.ok(!peopleAboard(game, "meridian", "bridge").some((one) => one.id === was.id), "and whoever had it isn't standing there");
  const away = newGame("docker");
  const refused = tool(away, "change_command", { takes: true, reason: "A rumor" });
  assert.equal(refused.isError, true);
  assert.match(refused.result, /have to be with the fleet/);
  assert.equal(isCaptain(away), false);
});

test("the story can take a captain out of the chair, and the world carries on without them in it", () => {
  const game = newGame();
  game.fleet.pursuit = 99.9;
  days(game, 1);
  assert.ok(game.fleet.raid);
  const { result, notice, isError } = tool(game, "change_command", { takes: false, reason: "The Admiral's court" });
  assert.ok(!isError, result);
  assert.match(notice, /has command of the fleet now: The Admiral's court/);
  assert.equal(isCaptain(game), false);
  const chair = chairOf(game);
  assert.ok(chair);
  assert.ok(result.includes(chair.name));
  assert.equal(game.fleet.raid, null);
  const shown = publicState(game).role;
  assert.equal(shown.title, "Former captain of the Meridian");
  assert.equal(shown.short, "former captain");
  assert.equal(shown.job, null);
  assert.equal(shown.chair, chair.name);
  assert.throws(() => fleetCommand(game, { action: "rations", id: "half" }), /has the chair/);
  assert.equal(restCost(game), 0, "they still have a bunk aboard");
  assert.match(aiSnapshot(game), /former captain, not in command/);
  days(game, 30);
  assert.equal(game.fleet.raid, null);
  const already = tool(game, "change_command", { takes: false, reason: "Again" });
  assert.match(already.result, /aren't in command anyway/);
});

// ---- Stories -------------------------------------------------------------------------------------

test("the leads they see are written for them, and the captain's own business isn't among them", () => {
  const game = newGame("engine_hand");
  game.level = 10;
  const leads = leadsHere(game);
  assert.ok(leads.length > 0);
  for (const lead of leads) {
    assert.equal(lead.lead, WORLD_THREADS[lead.id].anyone, lead.id);
    assert.ok(!/\byour?\b/i.test(lead.lead));
  }
  const own = Object.keys(WORLD_THREADS).filter((id) => !WORLD_THREADS[id].anyone);
  const seen = new Set();
  for (let day = 0; day < 40; day += 1) {
    game.clock.hours = day * 48 + 8;
    for (const place of ["meridian", "haven", "ghostlight", "vantor", "wheel", "deepyards", "cinder", "bastion"]) {
      game.location = place;
      for (const lead of leadsHere(game)) seen.add(lead.id);
    }
  }
  for (const id of own) assert.ok(!seen.has(id), `${id} is the captain's own business`);
  assert.ok(seen.size > 30, `only ${seen.size} leads`);
  const captain = newGame();
  captain.level = 10;
  for (const lead of leadsHere(captain)) assert.equal(lead.lead, WORLD_THREADS[lead.id].lead, "a captain's leads are as they were");
});

test("a story that's moved on reads as what's got around, and it can still be taken up", () => {
  const game = newGame("miner");
  game.level = 5;
  for (let day = 0; day < 60 && !hasMovedOn(game, "out_cinder_strike"); day += 1) days(game, 1);
  assert.ok(hasMovedOn(game, "out_cinder_strike"));
  const stage = STORY_CLOCK.threads.out_cinder_strike.stages[game.story.clock.threads.out_cinder_strike.stage - 1];
  assert.equal(leadNow(game, "out_cinder_strike"), stage.news);
  const { result, isError } = tool(game, "read_thread", { id: "out_cinder_strike" });
  assert.ok(!isError, result);
  assert.match(result, /The player isn't the captain/);
  assert.ok(result.includes(chairOf(game).name));
  assert.match(result, /How the player heard about it/);
  assert.ok(result.includes(WORLD_THREADS.out_cinder_strike.gm.truth.slice(0, 40)), "and all the notes are still there");
  assert.equal(game.story.threads.out_cinder_strike, "active");
});

test("the captain's stories go on over their head, and the game master can still bring one in", () => {
  const game = newGame("docker");
  assert.ok(!WORLD_THREADS.main_chain_of_command.anyone);
  for (let day = 0; day < 200 && !hasMovedOn(game, "main_chain_of_command"); day += 1) days(game, 1);
  assert.ok(hasMovedOn(game, "main_chain_of_command"), "it moved on all the same");
  assert.equal(game.story.threads.main_chain_of_command, undefined);
  const { result, isError } = tool(game, "read_thread", { id: "main_chain_of_command" });
  assert.ok(!isError, result);
  assert.match(result, /The player isn't the captain/);
  assert.equal(storyView(game).active.at(-1).lead, leadNow(game, "main_chain_of_command"));
  const notes = threadNotes("out_cinder_strike", newGame());
  assert.ok(!notes.includes("isn't the captain"), "a captain doesn't need telling");
  assert.ok(!notes.includes("How the player heard"));
});

test("the main story's brief tells the game master it's happening around them", () => {
  const game = newGame("docker");
  assert.match(arcBrief(game), /All of this is happening around the player/);
  assert.ok(arcBrief(game).includes(chairOf(game).name));
  assert.ok(!arcBrief(newGame()).includes("happening around the player"));
});

test("news from around the fleet only reaches someone who's with it", () => {
  const away = newGame("docker");
  away.ai = { provider: null, messages: [] };
  assert.equal(fleetNews(away), null);
  const aboard = newGame("engine_hand");
  aboard.clock.hours = 24 * 40;
  assert.match(fleetNews(aboard), /^<fleet_news>/);
});

test("the instructions don't assume the player's the captain, and they say what to do if they aren't", () => {
  assert.ok(!WORLD_BIBLE.includes("The player is its newly appointed captain"));
  assert.match(WORLD_BIBLE, /The player may be that captain, or anyone else in the galaxy/);
  assert.match(SYSTEM_PROMPT, /The player isn't always the captain\./);
  assert.match(SYSTEM_PROMPT, /they travel by paying for passage/);
  assert.match(SYSTEM_PROMPT, /call change_command/);
  assert.ok(!/says where the captain is/.test(SYSTEM_PROMPT));
  assert.ok(!/things the captain could say/.test(SYSTEM_PROMPT));
  assert.match(walkLine(newGame()), /^Map: player at /);
});

test("the Meridian's chair and the people aboard treat someone else as someone else", () => {
  const game = newGame("engine_hand");
  game.walk = null;
  walkOf(game);
  const view = walkView({ ...game });
  const chairThing = view.things.find((thing) => thing.name === "The captain's chair");
  assert.match(chairThing.look, /It isn't yours/);
  assert.match(chairThing.use, /while nobody's watching/);
  const captain = newGame();
  const own = walkView(captain).things.find((thing) => thing.name === "The captain's chair");
  assert.match(own.look, /It's yours now/);
  const voss = newGame("marine");
  assert.match(publicState(voss).people.find((person) => person.id === "voss").role, /^The Meridian's /);
  const map = WORLD_MAPS.meridian;
  assert.ok(Object.values(map.levels.engineering.people).find((person) => person.id === "tobin").asksOther);
});

test("a save from before all this is a captain's, and stays one", () => {
  const old = newGame();
  old.version = 13;
  delete old.role;
  delete old.fleet.chair;
  old.clock.hours = 300;
  old.location = "meridian";
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 14);
  assert.deepEqual(game.role, { id: "captain", captain: true });
  assert.equal(isCaptain(game), true);
  assert.equal(chairOf(game), null);
  assert.equal(publicState(game).role.captain, true);
  fleetCommand(game, { action: "rations", id: "reduced" });
  assert.equal(game.fleet.rations, "reduced");
  // Even one with no role in it at all still counts.
  assert.equal(isCaptain({}), true);
  const same = newGame("docker");
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(same))).role, same.role);
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(same))).fleet.chair, same.fleet.chair);
});

test("looking at it changes nothing in the save", () => {
  const game = newGame("docker");
  days(game, 12);
  const before = JSON.stringify(game);
  publicState(game);
  storyView(game);
  fleetView(game);
  assert.equal(JSON.stringify(game), before);
});

// ---- With the stand-in AI, and over the real server ---------------------------------------------

function respond(res, body, reply) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const usage = { input_tokens: 4, output_tokens: 1 };
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
  send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  send("content_block_delta", { index: 0, delta: { type: "text_delta", text: reply } });
  send("content_block_stop", { index: 0 });
  send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage });
  send("message_stop", {});
  res.end();
}

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-anyone-server-"));
let standIn = null;
let requests = [];
let child = null;
let port = 0;

const freePort = () => new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}

before(async () => {
  standIn = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    respond(res, body, "A stand-in scene.\n\n> Look around");
  });
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${standIn.address().port}`;
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key" }));
  port = await freePort();
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  delete process.env.ANTHROPIC_BASE_URL;
  standIn?.close();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("the game master's told who they are, and it only gets the files for the people they know", async () => {
  requests = [];
  const game = newGame("docker");
  game.transcript = [];
  await runTurn({ game, settings: { provider: "claude", model: "claude-haiku-5-5", apiKey: "test-key-not-real" }, gameEvent: openingFor(game), emit: () => {} });
  assert.equal(requests.length, 1);
  const first = JSON.stringify(requests[0].messages[0].content);
  assert.ok(first.includes("They are not the captain."));
  assert.ok(first.includes(START_LIST.docker.gm));
  assert.ok(first.includes("Mott Jessup"), "the people they know");
  assert.ok(!first.includes("Dunn Marrow"), "and not the Meridian's officers, who they've never met");
  assert.ok(first.includes(START_LIST.docker.opening));
  assert.ok(first.includes("not in command"));
  assert.ok(requests[0].system.length > 1000);
  assert.ok(!JSON.stringify(requests[0].system).includes(game.name), "the instructions are the same for everyone, so they stay cheap");
});

test("over the real server: starting as a dock hand, working, booking passage, and being refused the fleet's orders", async () => {
  const draft = randomDraft({ seed: 42, archetype: "officer" });
  draft.start = "docker";
  const made = await post("/api/new", { draft });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.role.captain, false);
  assert.equal(made.game.location.id, "haven");
  assert.equal(made.game.walk.here.name, "The Manifest Docks");
  assert.equal(made.game.role.job.name, START_LIST.docker.job.name);
  assert.ok(made.game.role.chair);

  const started = await post("/api/chat", { event: "start" });
  assert.equal(started.status, 200);
  const last = requests.at(-1);
  const said = JSON.stringify(last.messages);
  assert.ok(said.includes(START_LIST.docker.opening), "the story opens where they are");
  assert.ok(said.includes("They are not the captain."));
  assert.ok(!said.includes("has just been made captain"));
  assert.ok(last.tools.some((one) => one.name === "change_command"));

  const credits = made.game.credits;
  const worked = await post("/api/action", { action: "work" });
  assert.equal(worked.status, 200, JSON.stringify(worked));
  assert.ok(worked.game.credits > credits);
  assert.ok(worked.message.includes(START_LIST.docker.job.done));

  const refused = await post("/api/fleet", { action: "rations", id: "half" });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /has the chair/);

  const entry = worked.game.locations.find((place) => place.id === "kessara");
  const gone = await post("/api/fleet", { action: "course", id: "kessara" });
  assert.equal(gone.status, 200, JSON.stringify(gone));
  assert.equal(gone.moved, true);
  assert.equal(gone.game.location.id, "kessara");
  assert.equal(gone.game.credits, worked.game.credits - entry.fare);
  assert.ok(gone.game.role.rest > 0, "it's not home");
  const slept = await post("/api/action", { action: "rest", rough: true });
  assert.equal(slept.status, 200, JSON.stringify(slept));
  assert.match(slept.message, /in a corner of Kessara Drift/);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(state.game.role.title, START_LIST.docker.name);
  assert.equal(state.game.role.jobAway.place, LOCATIONS.haven.name);
});

test("a check window doesn't call someone else the captain", () => {
  const open = (game, skill) => {
    startCheck(game, { skill, difficulty: "moderate", reason: "A test", source: "practice" });
    return checkView(game).prompt;
  };
  assert.equal(open(newGame(), "leadership"), "captain:");
  assert.equal(open(newGame("docker"), "leadership"), "you:");
  assert.equal(open(newGame(), "hacking"), "root@meridian:~$");
  assert.equal(open(newGame("docker"), "hacking"), "root@terminal:~$");
  for (const skill of Object.keys(SKILLS)) assert.ok(!/captain|meridian/i.test(open(newGame("docker"), skill)), skill);
});