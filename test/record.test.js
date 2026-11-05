// The record: how each story ended and the lasting facts that left, kept in the save, written by the written story's
// flags and by the AI's two checked actions, shown on the Quests page, and read by the AI in its state.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-record-"));
process.env.GAME_DATA_DIR = dataDir;

const { SYSTEM_PROMPT } = await import("../src/ai.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { FACTS_PER_TURN, clearFact, endingOf, recordEnding, recordFact, recordLines, recordOf, recordView } = await import("../src/record.js");
const { aiSnapshot, publicState } = await import("../src/rules.js");
const { parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { threadNotes } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");

const FUEL = "main_two_weeks_of_fuel";
const newGame = (seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = "captain";
  const game = createGameFromDraft(draft);
  game.mode = "written";
  return game;
};
const tool = (game, name, input, turn = newTurnLimits()) => runTool(game, name, input, turn);

test("a fact has a short name and a line, sets its flag, and keeps its first words", () => {
  const game = newGame();
  const { entry, known } = recordFact(game, { id: "kessara_closed", text: "Kessara Drift is closed to the fleet.", from: "thread_main_two_weeks_of_fuel" });
  assert.equal(known, false);
  assert.equal(game.flags.kessara_closed, true);
  assert.equal(entry.day, 1);
  const again = recordFact(game, { id: "kessara_closed", text: "Different words." });
  assert.equal(again.known, true);
  assert.equal(again.entry.text, "Kessara Drift is closed to the fleet.", "the first words are kept");
  assert.equal(recordOf(game).facts.length, 1);
  const bare = recordFact(game, { id: "nobody_declares_this" });
  assert.equal(bare.entry.text, null);
  assert.throws(() => recordFact(game, { id: "Bad Name" }), /lowercase letters/);
  assert.throws(() => recordFact(game, { id: "x" }), /lowercase letters/);
  clearFact(game, "kessara_closed");
  assert.equal(game.flags.kessara_closed, undefined);
  assert.equal(recordOf(game).facts.length, 1);
  const view = recordView(game);
  assert.deepEqual(view.facts.map((fact) => fact.text), ["nobody declares this"], "a fact without words shows its name, spaced out");
});

test("a story's ending goes on the record by its name, and the page and the AI's state read it", () => {
  const game = newGame();
  assert.throws(() => recordEnding(game, { id: "no_such_story", summary: "x" }), /no story/);
  assert.throws(() => recordEnding(game, { id: FUEL, ending: "no_such_ending", summary: "x" }), /no ending called no_such_ending/);
  const ending = recordEnding(game, { id: FUEL, ending: "sign_with_quill", summary: "Signed with Mother Quill: forty-one markers, to be named later." });
  assert.equal(ending.day, 1);
  assert.equal(endingOf(game, FUEL).ending, "sign_with_quill");
  recordEnding(game, { id: FUEL, ending: "raid_depot", summary: "Another." });
  assert.equal(endingOf(game, FUEL).ending, "sign_with_quill", "the first ending is the one that's kept");
  recordFact(game, { id: "signed_with_quill", text: "The fleet signed Mother Quill's page.", from: "thread_main_two_weeks_of_fuel" });
  const lines = recordLines(game);
  assert.ok(lines.includes("Story ended, Two Weeks of Fuel (main_two_weeks_of_fuel), sign_with_quill: Signed with Mother Quill: forty-one markers, to be named later."), lines.join("\n"));
  assert.ok(lines.includes("Fact signed_with_quill: The fleet signed Mother Quill's page."));
  const state = aiSnapshot(game);
  assert.match(state, /Story ended, Two Weeks of Fuel/);
  assert.match(state, /Fact signed_with_quill: The fleet signed Mother Quill's page\./);
  const shown = publicState(game).story.record;
  assert.equal(shown.endings[0].title, "Two Weeks of Fuel");
  assert.equal(shown.endings[0].ending, "sign_with_quill");
  assert.equal(shown.endings[0].failed, false);
  assert.equal(shown.endings[0].summary, "Signed with Mother Quill: forty-one markers, to be named later.");
  assert.deepEqual(shown.facts[0], { id: "signed_with_quill", text: "The fleet signed Mother Quill's page.", from: "Two Weeks of Fuel", day: 1 });
});

test("the AI's two actions are checked: names, lengths, three facts a turn, and one ending a story", () => {
  const game = newGame();
  assert.ok(TOOL_DEFS.some((def) => def.name === "note_fact") && TOOL_DEFS.some((def) => def.name === "end_story"));
  const turn = newTurnLimits();
  const noted = tool(game, "note_fact", { id: "Voss_Trusts_The_Captain", text: "Commander Voss trusts the captain now." }, turn);
  assert.equal(noted.isError, undefined, noted.result);
  assert.match(noted.notice, /^\[RECORD\] Commander Voss trusts the captain now\./);
  assert.equal(game.flags.voss_trusts_the_captain, true, "the name is lowered");
  const again = tool(game, "note_fact", { id: "voss_trusts_the_captain", text: "Other words." }, turn);
  assert.match(again.result, /already on the record/);
  assert.equal(again.notice, undefined);
  assert.equal(tool(game, "note_fact", { id: "bad name", text: "Something." }, turn).isError, true);
  assert.equal(tool(game, "note_fact", { id: "too_short", text: "No" }, turn).isError, true);
  tool(game, "note_fact", { id: "third_fact", text: "A third fact for the turn." }, turn);
  const fourth = tool(game, "note_fact", { id: "fourth_fact", text: "One too many for the turn." }, turn);
  assert.equal(fourth.isError, true);
  assert.match(fourth.result, /enough facts for one turn/);
  assert.equal(turn.facts, FACTS_PER_TURN);
  assert.equal(game.flags.fourth_fact, undefined);

  tool(game, "add_quest", { id: FUEL, title: "Two Weeks of Fuel", description: "Fuel.", objective: "Find fuel." });
  assert.equal(tool(game, "end_story", { id: "no_such_story", ending: "sign_with_quill", summary: "It ended." }).isError, true);
  const wrong = tool(game, "end_story", { id: FUEL, ending: "no_such_ending", summary: "It ended." });
  assert.equal(wrong.isError, true);
  assert.match(wrong.result, /sign_with_quill, raid_depot, take_corvanes_fuel, settle_cinder_reach, or other/);
  assert.equal(tool(game, "end_story", { id: FUEL, ending: "sign_with_quill", summary: "No" }).isError, true);
  const ended = tool(game, "end_story", { id: FUEL, ending: "Take Corvanes Fuel", summary: "The Hegemony's fuel, free, with a transponder on every tank." });
  assert.equal(ended.isError, undefined, ended.result);
  assert.match(ended.notice, /^\[STORY\] Two Weeks of Fuel has ended: The Hegemony's fuel/);
  assert.equal(endingOf(game, FUEL).ending, "take_corvanes_fuel", "the name is read the way the AI is likely to write it");
  const quest = game.quests.find((q) => q.id === FUEL);
  assert.equal(quest.status, "completed");
  assert.equal(quest.objective, "The Hegemony's fuel, free, with a transponder on every tank.");
  assert.equal(game.story.threads[FUEL], "done", "the Leads menu and the clock know it's over");
  const twice = tool(game, "end_story", { id: FUEL, ending: "sign_with_quill", summary: "Again." });
  assert.equal(twice.isError, true);
  assert.match(twice.result, /already ended/);
  const other = tool(game, "end_story", { id: "main_visiting_hours", ending: "other", summary: "It ended another way: nobody will say how." });
  assert.equal(other.isError, undefined, other.result);
  assert.equal(endingOf(game, "main_visiting_hours").ending, null);
});

test("a story's quest settled the old way still records its ending, and in a written part no fact can be noted", () => {
  const game = newGame();
  tool(game, "add_quest", { id: FUEL, title: "Two Weeks of Fuel", description: "Fuel.", objective: "Find fuel." });
  tool(game, "update_quest", { id: FUEL, status: "completed", objective: "Signed with Mother Quill." });
  assert.equal(endingOf(game, FUEL).summary, "Signed with Mother Quill.");
  assert.equal(endingOf(game, FUEL).ending, null);
  tool(game, "add_quest", { id: "main_visiting_hours", title: "Visiting Hours", description: "x", objective: "y" });
  tool(game, "update_quest", { id: "main_visiting_hours", status: "failed", objective: "Lost." });
  assert.equal(endingOf(game, "main_visiting_hours").failed, true);
  tool(game, "add_quest", { id: "the_beacon_two", title: "Not a story", description: "x", objective: "y" });
  tool(game, "update_quest", { id: "the_beacon_two", status: "failed", objective: "Over." });
  assert.equal(Object.keys(recordOf(game).endings).length, 2, "a quest that isn't a story isn't an ending");
  const fit = { ...newTurnLimits(), scene: { choices: [], followed: undefined } };
  const refused = tool(game, "note_fact", { id: "made_up", text: "Something the AI made up in a written part." }, fit);
  assert.equal(refused.isError, true);
  assert.match(refused.result, /written in advance/);
  assert.equal(game.flags.made_up, undefined);
});

test("the written story's flags join the record, with words when the line has them, and the checker names a bad flag", () => {
  assert.deepEqual(parseEffect("flag kessara_closed: Kessara is closed to the fleet").do, { set: "kessara_closed", text: "Kessara is closed to the fleet" });
  assert.deepEqual(parseEffect("flag told_the_fleet").do, { set: "told_the_fleet" });
  assert.deepEqual(parseEffect("unflag told_the_fleet").do, { clear: "told_the_fleet" });
  const { scene, problems } = parseSceneText(`== start\nThe depot's gone.\n* flag kessara_closed: Kessara is closed to the fleet\n* flag raided_the_depot_alone\n> Go on -> after\n== after\nLater.\n* unflag raided_the_depot_alone\nEND`);
  assert.deepEqual(problems, []);
  const game = newGame();
  const scenes = { thread_test: scene };
  const emit = () => {};
  const log = (role, text) => game.transcript.push({ role, text });
  writtenTurn({ game, playerText: "I look into this", threadId: "test", emit, log, scenes });
  const facts = recordView(game).facts;
  assert.deepEqual(facts.map((fact) => fact.text), ["Kessara is closed to the fleet", "raided the depot alone"]);
  assert.equal(game.flags.kessara_closed, true);
  writtenTurn({ game, playerText: "Go on", emit, log, scenes });
  assert.equal(game.flags.raided_the_depot_alone, undefined);
  assert.deepEqual(recordView(game).facts.map((fact) => fact.id), ["kessara_closed"]);
  const bad = parseSceneText("== start\nText.\n* flag Bad Name\nEND").scene;
  assert.ok(sceneProblems(bad, "t").some((problem) => /flag's name is lowercase/.test(problem)), sceneProblems(bad, "t").join(" | "));
});

test("an older save's flags join the record when it's read, and the record doesn't repeat them", () => {
  const game = newGame();
  game.flags = { old_flag_one: true, old_flag_two: true };
  delete game.story.record;
  const record = recordOf(game);
  assert.deepEqual(record.facts.map((fact) => fact.id), ["old_flag_one", "old_flag_two"]);
  assert.equal(record.facts[0].text, null);
  recordOf(game);
  assert.equal(recordOf(game).facts.length, 2);
  assert.deepEqual(recordView(game).facts.map((fact) => fact.text), ["old flag one", "old flag two"]);
  assert.ok(recordLines(game).includes("Fact old_flag_one: old flag one"));
});

test("the AI is told about the record, and a story's notes say how the story before it ended", () => {
  assert.match(SYSTEM_PROMPT, /THE RECORD/);
  assert.match(SYSTEM_PROMPT, /call end_story with the name of the ending/);
  assert.match(SYSTEM_PROMPT, /call note_fact/);
  assert.match(SYSTEM_PROMPT, /campaign you didn't write/);
  const game = newGame();
  const before = threadNotes("main_chain_of_command", game);
  assert.match(before, /end_story, with the ending's name, when it ends/);
  assert.doesNotMatch(before, /Before it,/);
  recordEnding(game, { id: "main_the_old_scholar", ending: "tharel_kept_safe_trusts_captain", summary: "Tharel showed the two layers, and trusts the captain." });
  const after = threadNotes("main_chain_of_command", game);
  assert.match(after, /Before it, The Warm Room ended \(tharel_kept_safe_trusts_captain\): Tharel showed the two layers, and trusts the captain\./);
});
