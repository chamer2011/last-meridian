// Stories that move on without the captain, and a fleet that makes its own decisions. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-stories-"));
process.env.GAME_DATA_DIR = dataDir;

const { SYSTEM_PROMPT } = await import("../src/ai.js");
const { findCharacter } = await import("../src/campaign.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { worldReport } = await import("../src/daily.js");
const { LOCATIONS } = await import("../src/data.js");
const { answerRaid, councilOf, fleetCommand, fleetLedger, fleetView, lostShipNames } = await import("../src/fleet.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { passTime, publicState } = await import("../src/rules.js");
const { clockOf, hasMovedOn, leadNow, ranItsCourse, whatHappened } = await import("../src/story-clock.js");
const { arcBriefIfNew, leadsHere, storyView, threadNotes } = await import("../src/story-library.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { DAILY, FLEET_DATA, STORY_CLOCK, WORLD_ARC, WORLD_THREADS } = await import("../src/world.js");

const COUNCIL = FLEET_DATA.council;
const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const days = (game, count) => passTime(game, 24 * count, "routine");
// Keeps the fleet out of trouble, so that only what's being tested gets a say.
function comfortable(game) {
  game.fleet.food = 9000;
  game.fleet.medicine = 900;
  game.fleet.parts = 900;
  game.ship.fuel = game.ship.maxFuel;
  game.fleet.pursuit = 0;
  game.ship.morale = 60;
  game.fleet.raid = null;
}
// A day at a time until something's happened, with nobody in charge of anything.
function until(game, reached, limit = 400) {
  for (let day = 0; day < limit; day += 1) {
    if (reached()) return day;
    comfortable(game);
    days(game, 1);
  }
  assert.fail(`It still hadn't happened after ${limit} days.`);
}

// ---- What's written down ----------------------------------------------------------

test("every story says what happens if nobody steps in, or why it has to wait", () => {
  const ids = Object.keys(WORLD_THREADS);
  assert.equal(ids.length, 127);
  for (const id of ids) {
    const entry = STORY_CLOCK.threads[id];
    assert.ok(entry, `${id} has nothing written for it`);
    assert.ok(entry.stages.length > 0 || entry.waits, `${id} has no stages, and no reason to wait`);
  }
  for (const id of Object.keys(STORY_CLOCK.threads)) assert.ok(WORLD_THREADS[id], `${id} isn't a story`);
  const waiting = ids.filter((id) => STORY_CLOCK.threads[id].waits).sort();
  assert.deepEqual(waiting, ["deep_past_the_lamp", "main_safe_harbor", "main_the_last_watch"], "only the ones that need the fleet at the Harbor");
});

test("every stage is well formed, and only touches things that exist", () => {
  const fleetKeys = ["morale", "food", "medicine", "parts", "fuel", "pursuit", "ships", "picked", "sat", "named"];
  const check = (where, stage) => {
    assert.ok(Number.isFinite(stage.after) && stage.after > 0, `${where}: when`);
    assert.ok(typeof stage.news === "string" && stage.news.length > 20 && stage.news.length < 300, `${where}: news`);
    if (stage.place) assert.ok(LOCATIONS[stage.place], `${where}: ${stage.place}`);
    for (const hit of stage.places ?? []) {
      const place = DAILY.places[hit.id];
      assert.ok(place, `${where}: ${hit.id} isn't tracked`);
      for (const good of Object.keys(hit.goods ?? {})) assert.ok(place.goods[good] !== undefined, `${where}: ${hit.id} has no ${good}`);
      if (hit.sides) assert.ok(!place.locked, `${where}: nobody can change who holds ${hit.id}`);
      for (const side of Object.keys(hit.sides ?? {})) assert.ok(place.hold?.[side] !== undefined, `${where}: ${hit.id} has no ${side}`);
    }
    for (const key of Object.keys(stage.fleet ?? {})) assert.ok(fleetKeys.includes(key), `${where}: ${key}`);
    const { named } = stage.fleet ?? {};
    if (named) {
      assert.ok(FLEET_DATA.ships.some((ship) => ship.id === named.id), `${where}: ${named.id}`);
      assert.ok(["lost", "gone"].includes(named.status), `${where}: ${named.status}`);
    }
  };
  let stages = 0;
  for (const [id, entry] of Object.entries(STORY_CLOCK.threads)) {
    let last = 0;
    for (const stage of entry.stages) {
      check(id, stage);
      assert.ok(stage.after > last, `${id}: its stages have to come in order`);
      last = stage.after;
      assert.ok(typeof stage.lead === "string" && stage.lead.length > 40, `${id}: every stage changes the lead`);
      assert.notEqual(stage.lead, WORLD_THREADS[id].lead);
      stages += 1;
    }
  }
  assert.ok(stages > 150, `only ${stages} stages`);
  assert.equal(STORY_CLOCK.acts.length, 4, "the last act needs someone to take the fleet there");
  STORY_CLOCK.acts.forEach((act, index) => {
    let last = 0;
    for (const event of act.events) {
      check(`act ${index + 1}`, event);
      assert.ok(event.after > last);
      last = event.after;
    }
    if (index < 3) {
      check(`act ${index + 1} moves on`, act.moves_on);
      assert.ok(act.moves_on.after > last, "it moves on after everything else in the act has had its chance");
    }
  });
});

test("nothing that's told to everyone gives a secret away", () => {
  const secrets = ["the Audience", "the Roster", "Roster", "walker", "Stilling", "Dov Harlan", "Ned Vasek", "Tam Orlo", "Dark Pantry", "Door Warden", "Quartile", "Brother Hob", "Anja", "Gantry", "Orchard", "Ember Day", "Project Plumbline", "palewort"];
  const said = [
    ...Object.entries(STORY_CLOCK.threads).flatMap(([id, entry]) => entry.stages.flatMap((stage) => [[id, stage.news], [id, stage.lead]])),
    ...STORY_CLOCK.acts.flatMap((act, index) => [...act.events, act.moves_on].filter(Boolean).map((event) => [`act ${index + 1}`, event.news])),
  ];
  for (const [where, text] of said) {
    for (const secret of secrets) assert.ok(!text.includes(secret), `${where} gives away ${secret}: ${text}`);
    assert.ok(!/[{}]/.test(text), `${where} has something left unfilled: ${text}`);
  }
});

test("a lead for a ship that can go never says her name, so the story stays open after she's gone", () => {
  for (const [id, entry] of Object.entries(STORY_CLOCK.threads)) {
    entry.stages.forEach((stage, index) => {
      const { named } = stage.fleet ?? {};
      if (!named) return;
      const { name } = FLEET_DATA.ships.find((ship) => ship.id === named.id);
      for (const later of entry.stages.slice(index)) assert.ok(!later.lead.includes(name.replace(/^The /, "")), `${id}: ${later.lead}`);
    });
  }
});

// ---- Stories moving on --------------------------------------------------------------

test("nothing happens straight away, and then the stories start to move", () => {
  const game = newGame();
  days(game, 1);
  assert.deepEqual(clockOf(game).moved, []);
  assert.ok(!hasMovedOn(game, "out_cinder_strike"));
  assert.equal(leadNow(game, "out_cinder_strike"), WORLD_THREADS.out_cinder_strike.lead);
  until(game, () => clockOf(game).moved.length > 3);
  assert.ok(game.story.clock.moved.every((entry) => entry.text && entry.day >= 1));
});

test("when a story's day comes, the world changes, the lead changes, and the news goes round", () => {
  const game = newGame();
  game.fleet.at = "cinder";
  game.location = "cinder";
  game.walk = null;
  const before = {};
  until(game, () => {
    if (hasMovedOn(game, "out_cinder_strike")) return true;
    Object.assign(before, JSON.parse(JSON.stringify(game.world.places.cinder)));
    return false;
  });
  const stage = STORY_CLOCK.threads.out_cinder_strike.stages[0];
  const now = game.world.places.cinder;
  assert.ok(now.goods.fuel < before.goods.fuel - 10, `fuel ${before.goods.fuel} became ${now.goods.fuel}`);
  assert.ok(now.hold.strike > before.hold.strike, "the strikers are stronger");
  assert.equal(leadNow(game, "out_cinder_strike"), stage.lead);
  assert.ok(game.world.news.some((entry) => entry.text === stage.news));
  assert.ok(storyView(game).moved.some((entry) => entry.text === stage.news), "it's on the Leads screen");
  assert.ok(Object.values(now.hold).every((share) => share > 0));
  assert.ok(Math.abs(Object.values(now.hold).reduce((sum, share) => sum + share, 0) - 100) < 1, "the shares still come to the whole place");
});

test("a lead that's moved on says how things stand now, and says that it's moved", () => {
  const game = newGame();
  game.location = "haven";
  game.fleet.at = "haven";
  game.walk = null;
  let lead = null;
  until(game, () => {
    lead = leadsHere(game).find((entry) => entry.moved);
    return lead;
  });
  assert.equal(lead.lead, leadNow(game, lead.id));
  assert.ok(STORY_CLOCK.threads[lead.id].stages.some((stage) => stage.lead === lead.lead));
  assert.notEqual(lead.lead, WORLD_THREADS[lead.id].lead);
  assert.ok(leadsHere(newGame()).every((entry) => !entry.moved), "a new game's leads are all as they were written");
});

test("once someone has taken a story up, it's in their hands and its clock stops", () => {
  const game = newGame();
  tool(game, "read_thread", { id: "out_cinder_strike" });
  assert.equal(game.story.threads.out_cinder_strike, "active");
  const fuel = game.world.places.cinder.goods.fuel;
  until(game, () => clockOf(game).moved.length > 20);
  for (let day = 0; day < 100; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.ok(!hasMovedOn(game, "out_cinder_strike"));
  assert.equal(game.story.clock.threads.out_cinder_strike, undefined);
  assert.ok(!game.story.clock.moved.some((entry) => entry.id === "out_cinder_strike"));
  assert.ok(Number.isFinite(fuel));
});

test("a story that's moved on can still be taken up, and the game master starts from how it stands", () => {
  const game = newGame();
  until(game, () => hasMovedOn(game, "main_two_weeks_of_fuel"));
  const stage = STORY_CLOCK.threads.main_two_weeks_of_fuel.stages[0];
  const { result, isError } = tool(game, "read_thread", { id: "main_two_weeks_of_fuel" });
  assert.ok(!isError, result);
  assert.match(result, /moved on without the captain/);
  assert.ok(result.includes(stage.news));
  assert.ok(result.includes(stage.lead));
  assert.ok(result.includes(WORLD_THREADS.main_two_weeks_of_fuel.lead), "and how it began is still there");
  assert.ok(result.includes(WORLD_THREADS.main_two_weeks_of_fuel.gm.truth.slice(0, 40)), "and nothing's been lost from the notes");
  assert.equal(game.story.threads.main_two_weeks_of_fuel, "active");
  const reached = game.story.clock.threads.main_two_weeks_of_fuel.stage;
  for (let day = 0; day < 100; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.equal(game.story.clock.threads.main_two_weeks_of_fuel.stage, reached, "and it stops where it was");
  assert.ok(whatHappened(game, "main_two_weeks_of_fuel").includes(stage.news));
  assert.equal(threadNotes("main_two_weeks_of_fuel"), threadNotes("main_two_weeks_of_fuel", null));
});

test("a story that hasn't moved on tells the game master nothing new", () => {
  const game = newGame();
  assert.equal(whatHappened(game, "out_cinder_strike"), null);
  const notes = threadNotes("out_cinder_strike", game);
  assert.ok(!notes.includes("moved on without"));
  assert.equal(notes, threadNotes("out_cinder_strike"));
});

test("what follows a story opens once that story has run its course, and only then", () => {
  const game = newGame();
  game.level = 5;
  game.location = "cinder";
  game.fleet.at = "cinder";
  game.walk = null;
  // Only a few leads show at once, so these two get the place to themselves.
  for (const [id, thread] of Object.entries(WORLD_THREADS)) {
    if (thread.places?.includes("cinder") && id !== "out_cinder_strike" && id !== "out_cinder_reactor") game.story.threads[id] = "done";
  }
  const open = () => leadsHere(game).some((lead) => lead.id === "out_cinder_reactor");
  assert.ok(!open());
  assert.equal(clockOf(game).threads.out_cinder_reactor, undefined);
  until(game, () => ranItsCourse(game, "out_cinder_strike"));
  assert.ok(open(), "the reactor story is there to be found");
  comfortable(game);
  days(game, 2);
  assert.ok(game.story.clock.threads.out_cinder_reactor, "and its own clock has started");
});

test("a story waits for the world to reach it", () => {
  const game = newGame();
  const lateOnes = Object.entries(WORLD_THREADS).filter(([, thread]) => (thread.minLevel ?? 1) >= 6 && !thread.after);
  assert.ok(lateOnes.length > 0);
  comfortable(game);
  days(game, 20);
  for (const [id] of lateOnes) assert.equal(game.story.clock.threads[id], undefined, `${id} started too soon`);
});

test("it can't happen to a ship that's gone", () => {
  const game = newGame();
  game.fleet.ships.harrows_bounty.status = "lost";
  game.fleet.ships.harrows_bounty.aboard = 0;
  assert.ok(lostShipNames(game).includes("Harrow's Bounty"));
  until(game, () => (clockOf(game).threads.fleet_bunk_forty_one?.stage ?? 0) >= 1);
  assert.ok(!game.world.news.some((entry) => entry.text.includes("Harrow's Bounty")));
  assert.ok(!game.story.clock.moved.some((entry) => entry.text.includes("Harrow's Bounty")));
});

test("a story can take a ship the stories need, but only if it says so, and only that one", () => {
  const game = newGame();
  const people = () => Object.values(game.fleet.ships).reduce((sum, ship) => sum + ship.aboard, 0);
  let before = 0;
  until(game, () => {
    if (hasMovedOn(game, "fleet_frost_line")) return true;
    before = people();
    return false;
  });
  assert.equal(game.fleet.ships.vesper_landing.status, "lost");
  assert.equal(game.fleet.ships.vesper_landing.aboard, 0);
  assert.ok(people() < before, "some of them went with the Hegemony");
  assert.ok(people() > before - 1100, "and most of them are on other ships");
  game.level = 5;
  assert.ok(!leadNow(game, "fleet_frost_line").includes("Vesper Landing"), "so the lead can still be followed");
  assert.equal(lostShipNames(game).filter((name) => name === "Vesper Landing").length, 1);
});

test("stories that send ships away send the ones with least reason to stay", () => {
  const game = newGame();
  const story = FLEET_DATA.ships.filter((ship) => ship.story && ship.id !== "vesper_landing" && ship.id !== "tollivers_ark");
  until(game, () => game.story.act >= 2);
  for (const ship of story) assert.equal(game.fleet.ships[ship.id].status, "active", ship.id);
});

// ---- The main story -----------------------------------------------------------------

test("the main story's pressure builds, and it moves on if nobody moves it, as far as the last act and no further", () => {
  const game = newGame();
  game.ai = { ...game.ai, sentAct: 1 };
  const act = STORY_CLOCK.acts[0];
  const heard = new Set();
  until(game, () => {
    for (const entry of clockOf(game).moved) heard.add(entry.text);
    return game.story.act === 2;
  });
  for (const event of act.events) assert.ok(heard.has(event.news), event.news);
  assert.ok(game.story.clock.moved.some((entry) => entry.text === act.moves_on.news));
  assert.equal(game.story.clock.act.act, 2);
  const brief = arcBriefIfNew(game);
  assert.ok(brief, "the game master gets told where the story has got to");
  assert.ok(brief.includes(WORLD_ARC.acts[1].name));
  assert.equal(arcBriefIfNew(game), null, "and only once");
  until(game, () => game.story.act === 4, 500);
  for (let day = 0; day < 200; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.equal(game.story.act, 4, "the fleet has to be taken to the last one");
});

test("when the story moves on through the game master, the act's clock starts again from there", () => {
  const game = newGame();
  comfortable(game);
  days(game, 10);
  assert.equal(game.story.clock.act.act, 1);
  const { result, isError } = tool(game, "update_story", { act: 2 });
  assert.ok(!isError, result);
  assert.equal(game.story.clock.act, null);
  const before = game.clock.hours;
  comfortable(game);
  days(game, 1);
  assert.equal(game.story.clock.act.act, 2);
  assert.equal(game.story.clock.act.next, 0);
  assert.equal(game.story.clock.act.from, Math.floor((before + 24) / 24));
});

// ---- Time, saves and the screen --------------------------------------------------------

test("it comes out the same however the time is cut up, and after saving and loading", () => {
  const one = newGame();
  days(one, 90);
  const two = newGame();
  days(two, 30);
  const loaded = JSON.parse(JSON.stringify(two));
  days(loaded, 20);
  for (let day = 0; day < 40; day += 1) days(loaded, 1);
  assert.deepEqual(one.story.clock, loaded.story.clock);
  assert.deepEqual(one.world, loaded.world);
  assert.deepEqual(one.fleet.ships, loaded.fleet.ships);
  assert.equal(one.fleet.food, loaded.fleet.food);
  assert.equal(one.ship.morale, loaded.ship.morale);
  const other = newGame(99);
  other.name = "Somebody Else";
  days(other, 90);
  assert.notDeepEqual(one.story.clock.threads, other.story.clock.threads, "another captain's stories go at their own pace");
});

test("a long wait doesn't flood the screen, but all of it is still in the news", () => {
  const game = newGame();
  const all = Object.values(STORY_CLOCK.threads).flatMap((entry) => entry.stages.map((stage) => stage.news));
  comfortable(game);
  const notes = days(game, 70);
  const told = notes.filter((line) => all.some((news) => line.includes(news)));
  assert.ok(told.length <= 4, `${told.length} story lines came up at once`);
  assert.ok(game.story.clock.moved.length > 20, "plenty happened");
  const day = newGame();
  comfortable(day);
  days(day, 25);
  const oneDay = [];
  for (let i = 0; i < 40; i += 1) {
    comfortable(day);
    const lines = days(day, 1);
    oneDay.push(lines.filter((line) => all.some((news) => line.includes(news))).length);
  }
  assert.ok(Math.max(...oneDay) <= 2, "no more than a couple in a day");
});

test("the game master hears what's happened, once", () => {
  const game = newGame();
  game.fleet.at = "meridian";
  until(game, () => game.world.unheard.some((text) => clockOf(game).moved.some((entry) => entry.text === text)));
  const report = worldReport(game);
  assert.match(report, /^<world_report>/);
  assert.ok(game.story.clock.moved.some((entry) => report.includes(entry.text)));
  assert.equal(worldReport(game), null);
});

test("the Leads screen only shows what the captain could know, newest first and not too many", () => {
  const game = newGame();
  until(game, () => clockOf(game).moved.length > 25);
  const { moved } = storyView(game);
  assert.ok(moved.length > 0 && moved.length <= 10);
  assert.ok(moved.every((entry, index) => index === 0 || entry.day <= moved[index - 1].day));
  clockOf(game).moved.push({ day: 200, id: "deep_the_sublevels", title: "Hidden", text: "Something at Foundry Seven.", place: "foundry" });
  assert.ok(!storyView(game).moved.some((entry) => entry.title === "Hidden"), "nobody's heard of Foundry Seven");
  game.location = "foundry";
  assert.ok(storyView(game).moved.some((entry) => entry.title === "Hidden"), "until they're standing in it");
  assert.ok(game.story.clock.moved.length <= 31);
});

test("looking at it changes nothing in the save", () => {
  const game = newGame();
  until(game, () => clockOf(game).moved.length > 10);
  const before = JSON.stringify(game);
  publicState(game);
  storyView(game);
  fleetView(game);
  leadsHere(game);
  assert.equal(JSON.stringify(game), before);
  const fresh = newGame();
  const clean = JSON.stringify(fresh);
  publicState(fresh);
  assert.equal(JSON.stringify(fresh), clean, "nor in a brand new one");
});

test("an old save picks it all up from today, with nothing happening at once", () => {
  const old = newGame();
  comfortable(old);
  old.clock.hours = 24 * 300;
  old.version = 12;
  delete old.story.clock;
  delete old.fleet.council;
  old.fleet.day = 300;
  old.world.day = 300;
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 14);
  assert.equal(game.story.clock.start, 300);
  assert.equal(game.story.clock.day, 300);
  comfortable(game);
  days(game, 1);
  assert.deepEqual(game.story.clock.moved, []);
  assert.deepEqual(fleetView(game).council, { off: false, recent: [] });
  until(game, () => clockOf(game).moved.length > 0);
  assert.equal(game.version, 14);
  assert.equal(JSON.parse(JSON.stringify(game)).story.clock.start, 300);
});

test("a year of it is quick, and doesn't fill up the save", () => {
  const game = newGame();
  const started = Date.now();
  for (let day = 0; day < 365; day += 1) {
    days(game, 1);
    if (game.fleet.raid) answerRaid(game, "voss");
    game.pendingEvents = [];
  }
  assert.ok(Date.now() - started < 4000, `it took ${Date.now() - started} ms`);
  assert.ok(JSON.stringify(game.story.clock).length < 16000, `${JSON.stringify(game.story.clock).length} characters`);
  assert.ok(JSON.stringify(game.fleet.council).length < 3000);
  assert.ok(Object.values(game.fleet.ships).some((ship) => ship.status === "active"));
  assert.ok(game.ship.morale >= 0 && game.ship.morale <= 100);
  assert.ok(game.fleet.pursuit >= 0 && game.fleet.pursuit <= 100);
});

test("the game master is told that stories don't wait, and the instructions stay the same line to line", () => {
  assert.match(SYSTEM_PROMPT, /Stories don't wait/);
  assert.match(SYSTEM_PROMPT, /officers and the council act by themselves/);
  const game = newGame();
  days(game, 40);
  assert.ok(!SYSTEM_PROMPT.includes(game.name));
});

// ---- The officers and the council ---------------------------------------------------------

// How long a supply's got left, in days.
function left(game, id, count) {
  const net = Math.abs(fleetLedger(game).net[id] ?? 0) || 1;
  game.fleet[id] = net * count;
}

// Each decision, with how things have to stand for it to happen.
const SCENES = {
  half_rations: (game) => { game.fleet.rations = "standard"; left(game, "food", 2.5); },
  cut_rations: (game) => { game.fleet.rations = "standard"; left(game, "food", 6); },
  run: (game) => { game.fleet.pursuit = 92; game.ship.fuel = 6; },
  farm_shifts: (game) => { game.fleet.rations = "reduced"; left(game, "food", 5.9); },
  clinic: (game) => { left(game, "medicine", 4); },
  scrounge: (game) => { left(game, "parts", 4); },
  repair_gangs: (game) => { game.fleet.ships.kittiwake.condition = 8; },
  stand_down: (game) => { game.fleet.rations = "generous"; game.ship.morale = 15; },
  feast: (game) => { game.ship.morale = 20; game.fleet.crews = "rest"; },
  more_food: (game) => { game.fleet.rations = "reduced"; game.ship.morale = 40; },
};

for (const [id, scene] of Object.entries(SCENES)) {
  test(`if nobody deals with it, they do: ${id}`, () => {
    const decision = COUNCIL.decisions.find((one) => one.id === id);
    assert.ok(decision);
    const game = newGame();
    comfortable(game);
    scene(game);
    const notes = [];
    for (let day = 0; day < 8 && !notes.some((line) => line.startsWith("[COUNCIL]")); day += 1) notes.push(...passTime(game, 24, "routine"));
    const said = notes.filter((line) => line.startsWith("[COUNCIL]"));
    assert.ok(said.length >= 1, `nothing happened: ${notes.join(" | ")}`);
    assert.ok(said[0].includes(decision.text.split("{who}").at(-1)), said[0]);
    assert.ok(said[0].includes(decision.name) || !decision.text.includes("{who}"), said[0]);
    const { rations, crews } = decision.set;
    if (rations) assert.equal(game.fleet.rations, rations);
    if (crews) assert.equal(game.fleet.crews, crews);
    assert.ok(fleetView(game).council.recent.length >= 1, "and it's on the Fleet screen");
  });
}

test("if the fuel's running out and the crews are idle, the Chief has them skim for it", () => {
  const decision = COUNCIL.decisions.find((one) => one.id === "skim");
  const game = newGame();
  comfortable(game);
  game.ship.fuel = 0;
  game.fleet.out = {};
  const notes = [];
  for (let day = 0; day < 8; day += 1) {
    game.fleet.parts = 900;
    notes.push(...passTime(game, 24, "routine"));
    game.ship.fuel = Math.min(game.ship.fuel, 1);
    if (game.fleet.crews === "fuel") break;
  }
  assert.equal(game.fleet.crews, "fuel", notes.join(" | "));
  assert.ok(notes.some((line) => line.includes(decision.text.split("{who}").at(-1))));
});

test("a blind jump costs fuel, shakes the Choir off, and isn't something they do every week", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.pursuit = 92;
  game.ship.fuel = 8;
  const notes = [];
  for (let day = 0; day < 4 && !notes.some((line) => line.includes("blind jump")); day += 1) notes.push(...passTime(game, 24, "routine"));
  assert.ok(notes.some((line) => line.includes("blind jump")), notes.join(" | "));
  assert.ok(game.ship.fuel < 8, "it costs fuel");
  assert.ok(game.fleet.pursuit < 92, "and they're further away");
  game.fleet.pursuit = 92;
  const next = [];
  for (let day = 0; day < 3; day += 1) {
    game.fleet.raid = null;
    next.push(...passTime(game, 24, "routine"));
    game.fleet.pursuit = Math.min(game.fleet.pursuit, 92);
  }
  assert.ok(!next.some((line) => line.includes("blind jump")), "the next raid gets through, unless someone else stops it");
});

test("once the worst is over they stand the crews down, and they only undo what they did themselves", () => {
  const game = newGame();
  comfortable(game);
  left(game, "medicine", 4);
  for (let day = 0; day < 6 && game.fleet.crews !== "medical"; day += 1) passTime(game, 24, "routine");
  assert.equal(game.fleet.crews, "medical");
  const notes = [];
  for (let day = 0; day < 8 && game.fleet.crews === "medical"; day += 1) {
    comfortable(game);
    notes.push(...passTime(game, 24, "routine"));
  }
  assert.equal(game.fleet.crews, "upkeep", notes.join(" | "));
  assert.ok(notes.some((line) => line.includes("worst of it's over")));

  const own = newGame();
  comfortable(own);
  fleetCommand(own, { action: "crews", id: "medical" });
  for (let day = 0; day < 12; day += 1) {
    comfortable(own);
    passTime(own, 24, "routine");
  }
  assert.equal(own.fleet.crews, "medical", "that was the captain's order, and it stands");
});

test("generous rations for morale come back off once people are happier, unless they were the captain's idea", () => {
  const game = newGame();
  comfortable(game);
  game.ship.morale = 20;
  game.fleet.crews = "rest";
  for (let day = 0; day < 6 && game.fleet.rations !== "generous"; day += 1) {
    game.fleet.food = 9000;
    passTime(game, 24, "routine");
  }
  assert.equal(game.fleet.rations, "generous");
  const notes = [];
  for (let day = 0; day < 6 && game.fleet.rations === "generous"; day += 1) {
    comfortable(game);
    game.ship.morale = 70;
    notes.push(...passTime(game, 24, "routine"));
  }
  assert.equal(game.fleet.rations, "standard", notes.join(" | "));

  const own = newGame();
  comfortable(own);
  fleetCommand(own, { action: "rations", id: "generous" });
  for (let day = 0; day < 10; day += 1) {
    comfortable(own);
    own.ship.morale = 70;
    passTime(own, 24, "routine");
  }
  assert.equal(own.fleet.rations, "generous", "the captain's order stands");
});

test("they give the captain time first", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.rations = "standard";
  left(game, "food", 6);
  const first = passTime(game, 24, "routine");
  assert.ok(!first.some((line) => line.startsWith("[COUNCIL]")), "not on the first day");
  assert.equal(game.fleet.rations, "standard");
  assert.equal(game.fleet.council.waiting.cut_rations !== undefined, true);
  comfortable(game);
  days(game, 1);
  assert.equal(game.fleet.council.waiting.cut_rations, undefined, "and if it stops being a problem they forget about it");
});

test("an order of the captain's own stands for a while before they'd change it", () => {
  const game = newGame();
  comfortable(game);
  fleetCommand(game, { action: "rations", id: "standard" });
  fleetCommand(game, { action: "rations", id: "generous" });
  const ordered = game.fleet.council.ordered.rations;
  assert.ok(Number.isFinite(ordered));
  const notes = [];
  for (let day = 0; day < COUNCIL.respect - 1; day += 1) {
    left(game, "food", 6);
    notes.push(...passTime(game, 24, "routine"));
  }
  assert.ok(!notes.some((line) => line.startsWith("[COUNCIL]")), notes.join(" | "));
  assert.equal(game.fleet.rations, "generous");
  for (let day = 0; day < 4; day += 1) {
    left(game, "food", 6);
    passTime(game, 24, "routine");
  }
  assert.notEqual(game.fleet.rations, "generous", "but not for ever, if it's going to starve everyone");
});

test("told to wait, they wait, whatever happens, and they can be let go again", () => {
  const game = newGame();
  comfortable(game);
  const { message } = fleetCommand(game, { action: "council", on: false });
  assert.equal(message, COUNCIL.held);
  assert.equal(fleetView(game).council.off, true);
  game.fleet.rations = "standard";
  game.ship.morale = 20;
  const notes = [];
  for (let day = 0; day < 10; day += 1) {
    left(game, "food", 2);
    left(game, "medicine", 2);
    left(game, "parts", 2);
    notes.push(...passTime(game, 24, "routine"));
    game.fleet.raid = null;
  }
  assert.ok(!notes.some((line) => line.startsWith("[COUNCIL]")), notes.join(" | "));
  assert.equal(game.fleet.rations, "standard");
  assert.equal(game.fleet.crews, "upkeep");
  const second = fleetCommand(game, { action: "council", on: false });
  assert.equal(second.message, null, "saying it twice doesn't say it twice");
  fleetCommand(game, { action: "council", on: true });
  assert.equal(fleetView(game).council.off, false);
  const later = [];
  for (let day = 0; day < 4; day += 1) {
    left(game, "food", 2);
    later.push(...passTime(game, 24, "routine"));
  }
  assert.ok(later.some((line) => line.startsWith("[COUNCIL]")));
});

test("one decision a day, because whatever else is wrong will still be wrong tomorrow", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.rations = "standard";
  for (let day = 0; day < 8; day += 1) {
    left(game, "food", 2.5);
    left(game, "medicine", 3);
    left(game, "parts", 3);
    game.fleet.pursuit = 92;
    const said = passTime(game, 24, "routine").filter((line) => line.startsWith("[COUNCIL]"));
    assert.ok(said.length <= 1, said.join(" | "));
    game.fleet.raid = null;
  }
  assert.ok(game.fleet.council.recent.length >= 2);
});

test("someone who's gone can't decide anything, so the council does it instead", () => {
  const game = newGame();
  comfortable(game);
  const person = findCharacter(game.campaign, "odessa");
  assert.ok(person, "Quartermaster Brandt is in the story");
  game.contacts.push({ name: person.name, status: "dead", attitude: "friendly", note: "" });
  game.fleet.rations = "standard";
  left(game, "food", 6);
  const notes = [];
  for (let day = 0; day < 4 && game.fleet.rations === "standard"; day += 1) {
    left(game, "food", 6);
    notes.push(...passTime(game, 24, "routine"));
  }
  const line = notes.find((one) => one.startsWith("[COUNCIL]"));
  assert.ok(line, notes.join(" | "));
  assert.ok(line.includes(`${COUNCIL.anyone} has checked`), line);
  assert.ok(!line.includes("Brandt"));
  for (const decision of COUNCIL.decisions) {
    if (decision.text.includes("{who}")) assert.ok(/^\{who\}|\. \{who\}/.test(decision.text), `${decision.id} has to read properly when it says "${COUNCIL.anyone}"`);
    assert.ok(findCharacter(game.campaign, decision.who), decision.who);
  }
});

test("they don't do anything in the middle of a raid", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.rations = "standard";
  left(game, "food", 6);
  game.fleet.pursuit = 100;
  const notes = [];
  for (let day = 0; day < 4; day += 1) {
    if (!game.fleet.raid) game.fleet.pursuit = 100;
    left(game, "food", 6);
    notes.push(...passTime(game, 24, "routine"));
  }
  assert.ok(game.fleet.raid, "there's a raid on");
  assert.equal(game.fleet.rations, "standard");
});

test("everything they decide is something the fleet can really do", () => {
  for (const decision of COUNCIL.decisions) {
    const { rations, crews } = decision.set;
    if (rations) assert.ok(FLEET_DATA.rations[rations], decision.id);
    if (crews) assert.ok(FLEET_DATA.crews[crews], decision.id);
    for (const list of [decision.when.rations, decision.when.crews]) {
      for (const id of list ?? []) assert.ok(FLEET_DATA.rations[id] || FLEET_DATA.crews[id], `${decision.id}: ${id}`);
    }
    assert.ok(decision.text.length > 20);
    assert.ok(decision.id && decision.name);
  }
});

test("a fleet left to itself doesn't flip back and forth", () => {
  for (const seed of [3, 21, 77]) {
    const game = newGame(seed);
    const said = [];
    for (let day = 0; day < 365; day += 1) {
      said.push(...days(game, 1).filter((line) => line.startsWith("[COUNCIL]")));
      if (game.fleet.raid) answerRaid(game, "voss");
      game.pendingEvents = [];
      assert.ok(FLEET_DATA.rations[game.fleet.rations]);
      assert.ok(FLEET_DATA.crews[game.fleet.crews]);
      assert.ok(game.ship.fuel >= 0);
    }
    assert.ok(said.length > 2, `seed ${seed}: they only did ${said.length} things in a year`);
    assert.ok(said.length < 120, `seed ${seed}: ${said.length} decisions in a year is too many`);
  }
});

test("a well-supplied fleet with nobody following up its stories gets worn down, but it isn't wiped out", () => {
  for (const seed of [3, 21, 77]) {
    const game = newGame(seed);
    let lowest = 100;
    for (let day = 0; day < 100; day += 1) {
      game.fleet.food = Math.max(game.fleet.food, 900);
      game.fleet.medicine = Math.max(game.fleet.medicine, 60);
      game.fleet.parts = Math.max(game.fleet.parts, 60);
      game.ship.fuel = Math.max(game.ship.fuel, 10);
      days(game, 1);
      if (game.fleet.raid) answerRaid(game, "voss");
      game.pendingEvents = [];
      lowest = Math.min(lowest, game.ship.morale);
    }
    const ships = Object.values(game.fleet.ships).filter((ship) => ship.status === "active").length;
    assert.ok(ships >= 18, `seed ${seed}: only ${ships} ships left`);
    assert.ok(game.ship.morale >= 15, `seed ${seed}: morale ${game.ship.morale}`);
    assert.ok(lowest < 60, "and it does feel it");
  }
});

// ---- Leaving a raid to Commander Voss ------------------------------------------------------

test("a raid can be left to Commander Voss, and it goes on her record", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.pursuit = 100;
  passTime(game, 24, "routine");
  assert.ok(game.fleet.raid);
  const view = fleetView(game).raid;
  assert.ok(view.voss);
  const choice = view.responses.find((one) => one.id === view.voss);
  assert.ok(choice?.available, "she'd only order what can be done");
  game.pendingEvents = [];
  const result = answerRaid(game, "voss");
  assert.equal(game.fleet.raid, null);
  assert.ok(result);
  const report = fleetView(game).lastReport ?? game.fleet.lastRaid ?? game.fleet.report ?? result.report;
  assert.ok(report);
  assert.equal(report.byVoss, true);
  assert.equal(report.response, choice.name);
  assert.ok(game.pendingEvents.some((line) => line.includes("left it to Commander Voss")), "the game master knows who gave the order");
});

test("she'd rather fight if she's got the guns, and she runs if she hasn't", () => {
  const game = newGame();
  comfortable(game);
  game.ship.hull = game.ship.maxHull ?? game.ship.hull;
  game.fleet.pursuit = 100;
  passTime(game, 24, "routine");
  assert.equal(fleetView(game).raid.voss, "fight");

  const weak = newGame();
  comfortable(weak);
  for (const ship of FLEET_DATA.ships.filter((one) => one.guns && one.id !== "meridian")) weak.fleet.ships[ship.id].status = "lost";
  weak.ship.hull = 2;
  weak.fleet.pursuit = 100;
  passTime(weak, 24, "routine");
  const { raid } = fleetView(weak);
  assert.ok(raid);
  assert.notEqual(raid.voss, "fight");
  assert.ok(raid.responses.find((one) => one.id === raid.voss).available);
});

test("giving your own order still works, and it says so", () => {
  const game = newGame();
  comfortable(game);
  game.fleet.pursuit = 100;
  passTime(game, 24, "routine");
  game.pendingEvents = [];
  const option = fleetView(game).raid.responses.find((one) => one.available);
  answerRaid(game, option.id);
  assert.ok(game.pendingEvents.some((line) => line.includes("The captain ordered")));
  assert.ok(!game.pendingEvents.some((line) => line.includes("Commander Voss")));
  assert.throws(() => answerRaid(game, "voss"), /no raid/);
});

// ---- Over the real server -------------------------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-stories-server-"));
let child = null;
let port = 0;

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key" }));
  const save = newGame();
  comfortable(save);
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify(save));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: waiting moves the stories on, the Leads and Fleet screens show it, and the council can be told to wait", async () => {
  const held = await post("/api/fleet", { action: "council", on: false });
  assert.equal(held.status, 200);
  assert.equal(held.game.fleet.council.off, true);
  let game = held.game;
  for (let i = 0; i < 12; i += 1) {
    const waited = await post("/api/fleet", { action: "wait", days: 7 });
    if (waited.status !== 200) break;
    game = waited.game;
    if (game.fleet.raid) {
      const answered = await post("/api/fleet", { action: "raid", id: "voss" });
      assert.equal(answered.status, 200, JSON.stringify(answered));
      assert.equal(answered.game.fleet.raid, null);
      game = answered.game;
    }
    if (game.story.moved.length) break;
  }
  assert.ok(game.story.moved.length > 0, "something's moved on");
  assert.ok(game.story.moved[0].title && game.story.moved[0].text && game.story.moved[0].day >= 1);
  const free = await post("/api/fleet", { action: "council", on: true });
  assert.equal(free.game.fleet.council.off, false);
  const state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.ok(state.game.story.moved.length > 0);
  assert.deepEqual(state.game.fleet.council.recent, free.game.fleet.council.recent);
});
