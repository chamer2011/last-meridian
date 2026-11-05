// The stories' notes: every ending has a name, a story can name the facts it leaves and what on the record
// changes it, the written story ends a story by name, scenes can ask how a story ended, and the checker reads it all.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-notes-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { endStory, endedWith, endingOf, recordFact, recordLines, recordView } = await import("../src/record.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { allStoryProblems, factsLeft, loadScenes, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { notesProblems, threadNotes } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { FACT_LINES, WORLD_THREADS, endingsOf } = await import("../src/world.js");

const FUEL = "main_two_weeks_of_fuel";
const newGame = (seed = 23) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.mode = "written";
  return game;
};
const quiet = (game) => ({ emit: () => {}, log: (role, text) => game.transcript.push({ role, text }) });

test("every story's endings have names, and the notes of all the stories pass the checker with the scenes", () => {
  for (const [id, thread] of Object.entries(WORLD_THREADS)) {
    const names = endingsOf(thread).map((one) => one.id);
    assert.ok(names.length >= 1, id);
    assert.equal(new Set(names).size, names.length, `${id} has two endings with one name`);
    for (const name of names) assert.match(name, /^[a-z][a-z0-9_]{1,39}$/, `${id}: ${name}`);
  }
  assert.deepEqual(endingsOf(WORLD_THREADS[FUEL]).map((one) => one.id), ["sign_with_quill", "raid_depot", "take_corvanes_fuel", "settle_cinder_reach"]);
  assert.deepEqual(endingsOf({ gm: { outcomes: ["Plain words"] } }), [{ id: "ending_1", text: "Plain words" }], "an outcome without a name gets its number");
  assert.deepEqual(notesProblems(), []);
  const { count, stories, problems } = allStoryProblems();
  assert.deepEqual(problems, []);
  assert.equal(stories, Object.keys(WORLD_THREADS).length);
  assert.ok(count >= 24);
  assert.equal(FACT_LINES.kessara_closed, "Kessara Drift is closed to the fleet since the depot.");
});

test("the checker names what's wrong in a story's notes, in plain words", () => {
  WORLD_THREADS.test_bad = {
    title: "Bad", kind: "crew", places: [], after: null, people: [], factions: [], lead: "x",
    gm: {
      outcomes: ["No name", { id: "Bad Name", text: "x" }, { id: "fine", text: "" }, { id: "twice", text: "a" }, { id: "twice", text: "b" }],
      facts: { "Bad": "line", fine_name: "" },
      reacts: [{ to: "flag nothing_leaves_this", then: "x" }, { to: "ended no_such_story", then: "x" }, { to: "ended main_two_weeks_of_fuel no_such_ending", then: "x" }, { to: "chance 50", then: "x" }, { to: "seen start", then: "y" }, { then: "no condition" }, { to: "flag kessara_closed and ended main_two_weeks_of_fuel raid_depot", then: "fine" }],
    },
  };
  try {
    const problems = notesProblems(factsLeft(loadScenes().scenes));
    assert.ok(!problems.some((one) => !one.startsWith("test_bad")), "the real stories are sound");
    const expect = (pattern) => assert.ok(problems.some((one) => pattern.test(one)), `${pattern}\n${problems.join("\n")}`);
    expect(/test_bad, outcome 1 needs a name/);
    expect(/test_bad, outcome 2: an ending's name is lowercase/);
    expect(/test_bad, outcome 3 \(fine\) has no text/);
    expect(/test_bad, outcome 5: two endings are called twice/);
    expect(/test_bad, facts: a fact's name is lowercase letters, digits and underscores, not Bad/);
    expect(/test_bad, facts: fine_name needs a line/);
    expect(/test_bad, reacts 1: nothing leaves the fact nothing_leaves_this/);
    expect(/test_bad, reacts 2: there's no story called no_such_story/);
    expect(/test_bad, reacts 3: main_two_weeks_of_fuel has no ending called no_such_ending\. Its endings are sign_with_quill/);
    expect(/test_bad, reacts 4: a story can't react to "chance"/);
    expect(/test_bad, reacts 5: a story can't react to "seen"/);
    expect(/test_bad, reacts 6 is written/);
    assert.ok(!problems.some((one) => /reacts 7/.test(one)), problems.join("\n"));
    assert.equal(problems.filter((one) => one.startsWith("test_bad")).length, 12, problems.join("\n"));
  } finally {
    delete WORLD_THREADS.test_bad;
  }
});

test("a scene can ask how a story ended, by name or any way, and the game answers from the record", () => {
  assert.ok(parseCondition("ended no_such_story").problems.some((one) => /no story called no_such_story/.test(one)));
  assert.ok(parseCondition("ended main_two_weeks_of_fuel no_such_ending").problems.some((one) => /no ending called no_such_ending/.test(one)));
  assert.ok(parseCondition("ended main_two_weeks_of_fuel raid_depot extra").problems.some((one) => /takes a story's id/.test(one)));
  assert.deepEqual(parseCondition("ended main_two_weeks_of_fuel raid_depot").problems, []);
  assert.deepEqual(parseCondition("not ended main_two_weeks_of_fuel and flag kessara_closed").problems, []);
  const game = newGame();
  assert.equal(conditionHolds(game, "ended main_two_weeks_of_fuel"), false);
  assert.equal(conditionHolds(game, "not ended main_two_weeks_of_fuel"), true);
  endStory(game, { id: FUEL, ending: "raid_depot", summary: "The depot, taken clean." });
  assert.equal(conditionHolds(game, "ended main_two_weeks_of_fuel"), true);
  assert.equal(conditionHolds(game, "ended main_two_weeks_of_fuel raid_depot"), true);
  assert.equal(conditionHolds(game, "ended main_two_weeks_of_fuel sign_with_quill"), false);
  assert.equal(conditionHolds(game, "not ended main_two_weeks_of_fuel sign_with_quill"), true);
  assert.equal(endedWith(game, "main_visiting_hours"), false);
  game.story.threads.main_visiting_hours = "done";
  assert.equal(endedWith(game, "main_visiting_hours"), true, "a story the clock ran out on is over, any way");
  assert.equal(endedWith(game, "main_visiting_hours", "wens_transfers_come_out"), false);
});

test("the written story ends its story by name: the record, the quest and the Leads menu agree, and the checker knows the names", () => {
  assert.deepEqual(parseEffect("ending sign_with_quill: Signed with Mother Quill.").do, { ending: "sign_with_quill", text: "Signed with Mother Quill." });
  assert.deepEqual(parseEffect("ending ignored failed: You let it run.").do, { ending: "ignored", failed: true, text: "You let it run." });
  assert.ok(parseEffect("ending: no name").problem);
  assert.ok(parseEffect("ending sign_with_quill").problem);
  assert.ok(parseEffect("ending sign_with_quill badly: words").problem);
  const { scene, problems } = parseSceneText("== start\nThe page.\n* ending sign_with_quill: Signed with Mother Quill.\nEND");
  assert.deepEqual(problems, []);
  assert.deepEqual(sceneProblems(scene, `thread_${FUEL}`), []);
  assert.ok(sceneProblems(scene, "thread_main_visiting_hours").some((one) => /main_visiting_hours has no ending called sign_with_quill/.test(one)));
  assert.ok(sceneProblems(scene, "opening_captain").some((one) => /story's own scene/.test(one)));
  assert.ok(sceneProblems(scene, "talk_marrow", { talk: true }).some((one) => /story's own scene/.test(one)));

  const game = newGame();
  runTool(game, "add_quest", { id: FUEL, title: "Two Weeks of Fuel", description: "Fuel.", objective: "Find fuel." }, newTurnLimits());
  const notices = [];
  writtenTurn({ game, playerText: "I look into this", threadId: FUEL, emit: (line) => { if (line.type === "notice") notices.push(line.text); }, log: quiet(game).log, scenes: { [`thread_${FUEL}`]: scene } });
  assert.equal(endingOf(game, FUEL).ending, "sign_with_quill");
  assert.equal(endingOf(game, FUEL).summary, "Signed with Mother Quill.");
  const quest = game.quests.find((one) => one.id === FUEL);
  assert.equal(quest.status, "completed");
  assert.equal(quest.objective, "Signed with Mother Quill.");
  assert.equal(game.story.threads[FUEL], "done");
  assert.ok(notices.includes("[STORY] Two Weeks of Fuel has ended: Signed with Mother Quill."), notices.join("\n"));
  assert.ok(recordLines(game).includes("Story ended, Two Weeks of Fuel (main_two_weeks_of_fuel), sign_with_quill: Signed with Mother Quill."));

  const lost = parseSceneText("== start\nThe vent.\n* ending ignored failed: You let it run.\nEND").scene;
  const other = newGame();
  runTool(other, "add_quest", { id: "crew_naomi_under_crew", title: "The Downstairs Crew", description: "x", objective: "y" }, newTurnLimits());
  writtenTurn({ other, game: other, playerText: "I look into this", threadId: "crew_naomi_under_crew", ...quiet(other), scenes: { thread_crew_naomi_under_crew: lost } });
  assert.equal(other.quests.find((one) => one.id === "crew_naomi_under_crew").status, "failed");
  assert.equal(endingOf(other, "crew_naomi_under_crew").failed, true);
  assert.equal(publicStateEnding(other), "ignored");
});

const publicStateEnding = (game) => recordView(game).endings[0].ending;

test("the AI ends a story by its ending's name, and its notes list the names, the facts it can leave, and what the record changes", () => {
  const def = TOOL_DEFS.find((one) => one.name === "end_story");
  assert.ok(def.input_schema.properties.ending, "the action takes the ending's name");
  assert.equal(def.input_schema.properties.outcome, undefined);
  const game = newGame();
  const notes = threadNotes("main_chain_of_command", game);
  assert.match(notes, /Where it can end up, by the ending's name:\n- voss_arrested: If Voss is arrested/);
  assert.match(notes, /Facts it can leave, with note_fact:\n- tarrow_resigned: Lieutenant Tarrow resigned over Commander Voss\./);
  assert.doesNotMatch(notes, /What's on the record changes it/, "nothing on the record yet");
  endStory(game, { id: FUEL, ending: "take_corvanes_fuel", summary: "Corvane's fuel." });
  const changed = threadNotes("main_chain_of_command", game);
  assert.match(changed, /What's on the record changes it:\n- The fleet runs on Corvane's fuel/);
  assert.doesNotMatch(changed, /at war with the Syndicate/, "only the reactions that hold");
  recordFact(game, { id: "said_dont_know", from: "thread_main_the_council" });
  assert.match(threadNotes("main_chain_of_command", game), /- The captain told the council they don't know/);
  const council = threadNotes("main_the_council", newGame());
  assert.match(council, /The tanks aren't filled yet/, "a reaction to a story not ended yet");
  assert.doesNotMatch(threadNotes("main_the_council", game), /The tanks aren't filled yet/);
});

test("a fact a scene leaves without words shows the line the story's notes give it", () => {
  const game = newGame();
  recordFact(game, { id: "kessara_closed", from: `thread_${FUEL}` });
  assert.equal(recordView(game).facts.find((fact) => fact.id === "kessara_closed").text, FACT_LINES.kessara_closed);
  assert.ok(recordLines(game).includes(`Fact kessara_closed: ${FACT_LINES.kessara_closed}`));
  recordFact(game, { id: "tannis_owes", text: "The scene's own words win.", from: `thread_${FUEL}` });
  assert.equal(recordView(game).facts.find((fact) => fact.id === "tannis_owes").text, "The scene's own words win.");
});
