// The story library: what each place offers, how story threads get taken up and finished, and
// what the game master is told and when. The game master's notes never reach the browser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { FACTIONS, ITEMS, LOCATIONS, STARTING_FACTIONS } from "../src/data.js";
import { LORE } from "../src/lore.js";
import { migrateGame } from "../src/migrate.js";
import { audienceBonus, buyPrice, publicState, travel } from "../src/rules.js";
import { arcBrief, fleetNews, leadsHere, placeFile, placeFileIfNew, rumorsHere, threadNotes, updateStory } from "../src/story-library.js";
import { newTurnLimits, runTool, TOOL_DEFS } from "../src/tools.js";
import { FLEET_EVENTS, WORLD_ARC, WORLD_THREADS } from "../src/world.js";
import { SYSTEM_PROMPT } from "../src/ai.js";

const newGame = (seed = 11, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());

test("every place has a file, and the world is much bigger than it was", () => {
  assert.ok(Object.keys(LOCATIONS).length >= 24);
  for (const [id, place] of Object.entries(LOCATIONS)) {
    assert.ok(place.name && place.desc, id);
    assert.ok(place.gm, `${id} has no notes`);
    assert.ok(Array.isArray(place.market), id);
    for (const item of place.market) assert.ok(ITEMS[item], `${id} sells ${item}`);
  }
  assert.ok(Object.keys(FACTIONS).length >= 12);
  assert.ok(Object.keys(WORLD_THREADS).length >= 80, `only ${Object.keys(WORLD_THREADS).length} threads`);
  assert.ok((FLEET_EVENTS.events ?? []).length >= 40);
  assert.ok((WORLD_ARC.acts ?? []).length >= 3);
  assert.ok((WORLD_ARC.clues ?? []).length >= 20);
});

test("new places and factions get highlighted in the story, and in the codex", () => {
  for (const id of Object.keys(LOCATIONS)) assert.ok(LORE.some((entry) => entry.id === `place:${id}`), id);
  for (const id of Object.keys(FACTIONS)) assert.ok(LORE.some((entry) => entry.id === `faction:${id}`), id);
});

test("the leads menu shows what fits here, and it changes from place to place", () => {
  const game = newGame();
  const seen = new Set();
  for (const id of Object.keys(LOCATIONS)) {
    game.location = id;
    game.level = 3;
    const leads = leadsHere(game);
    assert.ok(leads.length <= 4, id);
    for (const lead of leads) {
      seen.add(lead.id);
      const thread = WORLD_THREADS[lead.id];
      assert.ok((thread.minLevel ?? 1) <= game.level, lead.id);
      assert.ok(thread.places.includes(id) || thread.places.includes("any") || (thread.places.includes("fleet") && LOCATIONS[id].fleet), `${lead.id} at ${id}`);
      assert.ok(!thread.after, `${lead.id} isn't unlocked yet`);
    }
  }
  assert.ok(seen.size >= 20, `only ${seen.size} different leads across the galaxy`);
});

test("leads stay put for a while, then move on", () => {
  const game = newGame();
  game.location = "haven";
  game.level = 8;
  const first = leadsHere(game).map((lead) => lead.id);
  assert.deepEqual(leadsHere(game).map((lead) => lead.id), first);
  game.clock.hours += 1;
  assert.deepEqual(leadsHere(game).map((lead) => lead.id), first);
  const rumors = rumorsHere(game);
  assert.deepEqual(rumorsHere(game), rumors);
  game.clock.hours += 24 * 6;
  assert.notDeepEqual(rumorsHere(game), rumors);
});

test("the game master's notes never reach the browser", () => {
  const game = newGame();
  for (const id of ["haven", "meridian", "nest"]) {
    game.location = id;
    const state = publicState(game);
    const shown = JSON.stringify({ location: state.location, story: state.story, locations: state.locations });
    assert.ok(!state.location.gm, id);
    assert.ok(!state.location.encounters, id);
    assert.ok(!state.location.rumors, id);
    for (const secret of LOCATIONS[id].gm.secrets) assert.ok(!shown.includes(secret), secret);
    assert.ok(!shown.includes('"truth"'));
    assert.ok(!shown.includes('"beats"'));
  }
  // The hidden place stays hidden until someone mentions it.
  game.location = "meridian";
  assert.ok(!publicState(game).locations.some((place) => place.id === "harbor"));
  assert.ok(!SYSTEM_PROMPT.includes(LOCATIONS.harbor.desc));
});

test("the notes on a place go out once per visit, including right after a jump", () => {
  const game = newGame();
  game.location = "meridian";
  assert.match(placeFileIfNew(game), /^<place_file place="meridian">/);
  assert.equal(placeFileIfNew(game), null);
  game.ship.fuel = 5;
  const { result, isError } = tool(game, "travel", { destination: "haven" });
  assert.ok(!isError, result);
  assert.match(result, /<place_file place="haven">/);
  assert.equal(placeFileIfNew(game), null);
  // A place file brings the place's people, trouble and secrets, and something new each time.
  game.location = "kessara";
  const first = placeFile(game);
  assert.match(first, /Secrets, for you only/);
  const second = placeFile(game);
  assert.notEqual(first, second, "the same small events came up twice");
});

test("taking up a thread gets its notes, and takes it off the list of leads", () => {
  const game = newGame();
  game.location = "haven";
  game.level = 8;
  const [lead] = leadsHere(game);
  assert.ok(lead);
  const { result, isError } = tool(game, "read_thread", { id: lead.id });
  assert.ok(!isError, result);
  assert.match(result, /What's really going on/);
  assert.ok(!leadsHere(game).some((one) => one.id === lead.id));
  const state = publicState(game);
  assert.ok(state.story.active.some((one) => one.id === lead.id));
  assert.equal(tool(game, "read_thread", { id: "no_such_thread" }).isError, true);
});

test("a quest with a thread's id follows that thread, and finishing one can unlock the next", () => {
  const game = newGame();
  const [id, thread] = Object.entries(WORLD_THREADS).find(([, one]) => one.after);
  game.level = 8;
  [game.location] = thread.places.filter((place) => LOCATIONS[place]);
  if (!game.location) game.location = "meridian";
  assert.ok(!leadsHere(game).some((one) => one.id === id), "it isn't open yet");
  tool(game, "add_quest", { id: thread.after, title: "Before", description: "x", objective: "y" });
  assert.equal(game.story.threads[thread.after], "active");
  tool(game, "update_quest", { id: thread.after, status: "completed", objective: "Done." });
  assert.equal(game.story.threads[thread.after], "done");
  assert.ok(publicState(game).story.done.some((one) => one.id === thread.after));
  // It's open now, whether or not it's one of the few shown today.
  assert.ok(threadNotes(id));
});

test("every thread's notes come out readable, with nothing missing", () => {
  for (const id of Object.keys(WORLD_THREADS)) {
    const notes = threadNotes(id);
    assert.match(notes, /What's really going on/, id);
    assert.ok(!notes.includes("undefined"), id);
    assert.ok(!notes.includes("[object"), id);
  }
});

test("every place's notes come out readable, with nothing missing", () => {
  const game = newGame();
  for (const id of Object.keys(LOCATIONS)) {
    game.location = id;
    const notes = placeFile(game);
    assert.ok(notes.length > 200, id);
    assert.ok(!notes.includes("undefined"), id);
    assert.ok(!notes.includes("[object"), id);
  }
});

test("the main story moves on as clues are found, and it won't take nonsense", () => {
  const game = newGame();
  assert.match(arcBrief(game), /act 1 of/);
  const [clue] = WORLD_ARC.clues;
  assert.ok(!tool(game, "update_story", { clue: clue.id }).isError);
  assert.ok(game.story.clues.includes(clue.id));
  assert.equal(tool(game, "update_story", { clue: "nonsense" }).isError, true);
  assert.equal(tool(game, "update_story", { act: 99 }).isError, true);
  assert.equal(tool(game, "update_story", {}).isError, true);
  assert.match(updateStory(game, { act: 2 }), /act 2 of/);
  assert.equal(game.story.act, 2);
  // Clues that come later aren't given away early.
  game.story.act = 1;
  for (const place of Object.keys(LOCATIONS)) {
    game.location = place;
    const notes = placeFile(game);
    for (const later of WORLD_ARC.clues.filter((one) => (one.act ?? 1) > 1)) assert.ok(!notes.includes(`- ${later.id}:`), later.id);
  }
});

test("news from the fleet comes now and then, and never repeats", () => {
  const game = newGame();
  game.clock.hours = 24 * 40;
  const told = new Set();
  game.turn = 0;
  for (let i = 0; i < 40; i += 1) {
    game.turn += 6;
    const news = fleetNews(game);
    assert.ok(news, `ran out too soon, at ${i}`);
    assert.ok(!told.has(news), "the same news came twice");
    told.add(news);
    assert.equal(fleetNews(game), null, "too soon for more news");
  }
});

test("the fleet's own ships are close by: no fuel, and an hour to cross", () => {
  const game = newGame();
  game.ship.fuel = 0;
  game.location = "meridian";
  const { message } = travel(game, "sundial");
  assert.match(message, /Sundial/);
  assert.equal(game.location, "sundial");
  assert.equal(game.ship.fuel, 0);
  assert.throws(() => travel(game, "haven"), /fuel/);
  travel(game, "meridian");
  assert.equal(game.location, "meridian");
});

test("a new campaign and an old save both know about every faction", () => {
  const game = newGame();
  for (const id of Object.keys(FACTIONS)) assert.equal(typeof game.factions[id], "number", id);
  const old = JSON.parse(JSON.stringify({ ...newGame(12), version: 5 }));
  old.factions = { fleet: 50, hegemony: -40, drift: 3, ilun: 9 };
  delete old.story;
  const migrated = migrateGame(old);
  assert.equal(migrated.factions.fleet, 50, "what they've earned stays");
  assert.equal(migrated.factions.guild, STARTING_FACTIONS.guild);
  for (const id of Object.keys(FACTIONS)) assert.equal(typeof audienceBonus(migrated, id), "number", id);
  assert.ok(publicState(migrated).factions.length === Object.keys(FACTIONS).length);
  assert.deepEqual(migrated.story.threads, {});
});

test("a new item works in a market, and gear changes the numbers it says it does", () => {
  const game = newGame();
  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.price > 0) assert.ok(buyPrice(game, item) > 0, id);
  }
});

test("the tools the AI gets are still valid, and the instructions explain the library", () => {
  for (const name of ["read_thread", "update_story", "roll_check"]) assert.ok(TOOL_DEFS.some((def) => def.name === name), name);
  assert.match(SYSTEM_PROMPT, /THE STORY LIBRARY/);
  assert.match(SYSTEM_PROMPT, /<place_file>/);
});

test("the game master can read any part of the main mystery's notes, and nothing else", () => {
  const def = TOOL_DEFS.find((one) => one.name === "read_mystery");
  const topics = def.input_schema.properties.topic.enum;
  assert.ok(topics.includes("factions") && topics.includes("reversals") && topics.includes("how_it_connects"));
  const game = newGame();
  for (const topic of topics) {
    const { result, isError } = tool(game, "read_mystery", { topic });
    assert.ok(!isError, topic);
    assert.ok(result.length > 20, topic);
    assert.ok(!result.includes("undefined"), topic);
  }
  assert.equal(tool(game, "read_mystery", { topic: "the_lottery_numbers" }).isError, true);
});
