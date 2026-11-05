// The story clock reads the record: a stage can wait on a condition, two stages on one day can be a fork, a
// consequence follows from how a story ended days later, stages and consequences leave facts, and the checker
// reads all of it.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-clock-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { clearFact, endStory, endingOf, recordFact } = await import("../src/record.js");
const { passTime } = await import("../src/rules.js");
const { allStoryProblems } = await import("../src/scenes.js");
const { clockFacts, clockProblems, hasMovedOn, leadNow, whatHappened } = await import("../src/story-clock.js");
const { STORY_CLOCK, WORLD_THREADS } = await import("../src/world.js");

const FUEL = "main_two_weeks_of_fuel";
const COUNCIL = "main_the_council";
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.mode = "written";
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
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
const moved = (game, pattern) => (game.story.clock?.moved ?? []).filter((entry) => pattern.test(entry.text));

test("the clock's conditions, facts and consequences pass the checker, and the examples are in the file", () => {
  assert.deepEqual(clockProblems(), []);
  assert.deepEqual(allStoryProblems().problems, []);
  assert.ok(clockFacts().includes("quill_called_a_marker"), "the checker knows the clock leaves it");
  assert.equal(STORY_CLOCK.threads[FUEL].consequences.length, 3);
  assert.equal(STORY_CLOCK.threads[COUNCIL].stages.filter((stage) => stage.if).length, 2, "the council's second stage is a fork");
});

test("the checker names what's wrong in the clock, in plain words", () => {
  const entry = STORY_CLOCK.threads.main_who_paid;
  entry.stages[0].if = "seen start and flag nothing_leaves_this";
  entry.consequences = [
    { of: "ended no_such_story", after: -1 },
    { of: "flag kessara_closed", after: 3, news: "x", place: "nowhere", facts: { Bad: "" }, ending: "no_such_ending" },
    { after: 3, news: "No condition." },
  ];
  try {
    const problems = clockProblems(new Set(["kessara_closed"]));
    const expect = (pattern) => assert.ok(problems.some((one) => pattern.test(one)), `${pattern}\n${problems.join("\n")}`);
    expect(/^main_who_paid, stage 1: the clock can't look at "seen"/);
    expect(/stage 1: nothing leaves the fact nothing_leaves_this/);
    expect(/consequence 1: there's no story called no_such_story/);
    expect(/consequence 1 needs "after"/);
    expect(/consequence 1 needs "news"/);
    expect(/consequence 2: there's no place called nowhere/);
    expect(/consequence 2: a fact's name is lowercase letters, digits and underscores, not Bad/);
    expect(/consequence 2: the fact Bad needs a line/);
    expect(/consequence 2: main_who_paid has no ending called no_such_ending/);
    expect(/consequence 3 needs "of": a condition, written as in a scene, such as ended main_who_paid /);
    assert.equal(problems.length, 10, problems.join("\n"));
  } finally {
    delete entry.stages[0].if;
    delete entry.consequences;
  }
});

test("a stage with a condition is skipped when it doesn't hold, and the fork's other stage happens the same midnight", () => {
  const start = (game) => {
    game.story.threads.main_the_old_scholar = "done";
    comfortable(game);
  };
  const corvane = newGame();
  start(corvane);
  endStory(corvane, { id: FUEL, ending: "take_corvanes_fuel", summary: "Corvane's fuel." });
  until(corvane, () => (corvane.story.clock?.threads[COUNCIL]?.stage ?? 0) >= 3);
  assert.deepEqual(corvane.story.clock.threads[COUNCIL].skipped, [1], "the vote to follow the Beacon was skipped");
  assert.equal(moved(corvane, /hear Legate Corvane out/).length, 1);
  assert.equal(moved(corvane, /voted to follow the Beacon/).length, 0);
  assert.match(leadNow(corvane, COUNCIL), /hear the Hegemony's terms/);
  assert.match(whatHappened(corvane, COUNCIL), /hear Legate Corvane out/);
  assert.doesNotMatch(whatHappened(corvane, COUNCIL), /voted to follow/, "a skipped stage never happened");
  assert.ok(hasMovedOn(corvane, COUNCIL));

  const quill = newGame(22);
  start(quill);
  endStory(quill, { id: FUEL, ending: "sign_with_quill", summary: "Quill's page." });
  until(quill, () => (quill.story.clock?.threads[COUNCIL]?.stage ?? 0) >= 3);
  assert.deepEqual(quill.story.clock.threads[COUNCIL].skipped, [2], "the other way round");
  assert.equal(moved(quill, /voted to follow the Beacon/).length, 1);
  assert.equal(moved(quill, /hear Legate Corvane out/).length, 0);
  assert.match(leadNow(quill, COUNCIL), /voted to follow the Beacon/);
});

test("a consequence follows from how a story ended, about that many days later, once, and leaves its facts", () => {
  const game = newGame();
  comfortable(game);
  days(game, 10);
  assert.equal(game.story.clock.consequences?.[`${FUEL}:0`], undefined, "nothing's ended yet");
  endStory(game, { id: FUEL, ending: "raid_depot", summary: "The depot, taken clean." });
  until(game, () => game.story.clock.consequences?.[`${FUEL}:0`]?.done !== undefined);
  const fired = game.story.clock.consequences[`${FUEL}:0`];
  assert.ok(fired.done - fired.since >= 5 && fired.done - fired.since <= 9, `about a week later, not ${fired.done - fired.since} days`);
  assert.equal(moved(game, /Kessara Drift's docks are closed/).length, 1);
  assert.equal(game.flags.kessara_closed, true);
  assert.equal(game.story.record.facts.find((fact) => fact.id === "kessara_closed").text, "Kessara Drift is closed to the fleet since the depot.");
  assert.equal(game.story.clock.consequences[`${FUEL}:1`], undefined, "Quill's marker isn't called in: the fleet never signed");
  assert.equal(game.story.clock.threads[FUEL].stage, 0, "a story that's over doesn't move on by itself");
  assert.equal(moved(game, /Quill's depot at Kessara Drift has started selling/).length, 0);
  for (let day = 0; day < 40; day += 1) {
    comfortable(game);
    days(game, 1);
  }
  assert.equal(game.story.clock.consequences[`${FUEL}:0`].done, fired.done, "it happened once, on that day");
  assert.ok(moved(game, /Kessara Drift's docks are closed/).length <= 1, "and never again, though the list of what's moved on only keeps the last thirty");
  assert.equal(moved(game, /transponder bolted/).length, 0);
});

test("a consequence whose condition stops holding starts its count over", () => {
  const entry = STORY_CLOCK.threads.main_who_paid;
  entry.consequences = [{ of: "flag test_fact", after: 5, news: "Test news for the clock, long enough to be read.", facts: { test_fact_followed: "The test fact was followed up." } }];
  try {
    const game = newGame();
    comfortable(game);
    recordFact(game, { id: "test_fact" });
    days(game, 2);
    assert.ok(game.story.clock.consequences["main_who_paid:0"].since >= 0);
    clearFact(game, "test_fact");
    for (let day = 0; day < 12; day += 1) {
      comfortable(game);
      days(game, 1);
    }
    assert.equal(game.story.clock.consequences["main_who_paid:0"], undefined, "the count was dropped");
    assert.equal(moved(game, /Test news/).length, 0);
    recordFact(game, { id: "test_fact" });
    until(game, () => game.story.clock.consequences["main_who_paid:0"]?.done !== undefined, 20);
    assert.equal(moved(game, /Test news/).length, 1);
    assert.equal(game.flags.test_fact_followed, true);
  } finally {
    delete entry.consequences;
  }
});

test("a stage can leave facts and end its story by name, and a story that's taken up stops its clock", () => {
  WORLD_THREADS.test_clock = { title: "A Test Story", kind: "crew", places: ["haven"], minLevel: 1, after: null, people: [], factions: [], lead: "Something's up.", gm: { truth: "x", beats: [], routes: [], checks: [], fights: [], outcomes: [{ id: "settled", text: "It settled itself." }], rewards: "none" } };
  STORY_CLOCK.threads.test_clock = { stages: [{ after: 3, news: "The test story settled itself, with nobody there to see it.", lead: "It's over, and you weren't there. Somebody will want to know why.", facts: { test_story_settled: "The test story settled itself." }, ending: "settled" }] };
  try {
    const game = newGame();
    comfortable(game);
    until(game, () => (game.story.clock?.threads.test_clock?.stage ?? 0) >= 1, 20);
    assert.equal(game.flags.test_story_settled, true);
    assert.equal(endingOf(game, "test_clock").ending, "settled");
    assert.equal(endingOf(game, "test_clock").summary, "The test story settled itself, with nobody there to see it.");
    assert.equal(game.story.threads.test_clock, "done");
    const taken = newGame(23);
    comfortable(taken);
    taken.story.threads.test_clock = "active";
    for (let day = 0; day < 10; day += 1) {
      comfortable(taken);
      days(taken, 1);
    }
    assert.equal(taken.story.clock?.threads.test_clock, undefined, "in the player's hands, so its clock never started");
    assert.equal(endingOf(taken, "test_clock"), null);
  } finally {
    delete WORLD_THREADS.test_clock;
    delete STORY_CLOCK.threads.test_clock;
  }
});
