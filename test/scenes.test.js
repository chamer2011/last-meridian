// The written story: scenes played without the AI, the switch between the two, and the test scene. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-"));
process.env.GAME_DATA_DIR = dataDir;

const { parseNarration, parseOptions, buildVocab } = await import("../public/story.js");
const { POLES, SKILLS } = await import("../src/character-data.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { START_LIST } = await import("../src/role.js");
const { publicState } = await import("../src/rules.js");
const { conditionHolds, parseCondition, parseEffect, parseSceneText } = await import("../src/scene-text.js");
const { StoryError, allSceneProblems, choiceLine, loadScenes, matchChoice, openingSceneId, partText, sceneProblems, writtenTurn } = await import("../src/scenes.js");
const { attr, maxHp, skillRank } = await import("../src/rules.js");
const { talkCommand, talkView } = await import("../src/walk.js");

const WORLD_SCENES = loadScenes().scenes;
const HELPERS = { attr, skillRank, maxHp };

// The page's own vocabulary: every skill, and every belief.
const vocab = buildVocab(SKILLS);
for (const pole of Object.keys(POLES)) vocab.poles[pole] = pole;
const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.mode = "written";
  return game;
};

// Plays one turn the way the server does: what the story says goes in the transcript after the turn, in order.
function play(game, args, scenes) {
  const pieces = [];
  const emit = (e) => {
    if (e.type === "state") return;
    const last = pieces.at(-1);
    if (e.type === "text" && last?.role === "narrator") last.text += e.text;
    else pieces.push({ role: e.type === "text" ? "narrator" : "notice", text: e.text });
  };
  writtenTurn({ game, emit, log: (role, text) => game.transcript.push({ role, text }), scenes, ...args });
  for (const piece of pieces) game.transcript.push(piece);
  return pieces;
}
const lastNarration = (game) => [...game.transcript].reverse().find((entry) => entry.role === "narrator")?.text ?? "";

// ---- The scene files ------------------------------------------------------------

test("every written scene is sound: it reads, it starts somewhere, every part can be reached, and every choice goes somewhere real", () => {
  const { count, problems } = allSceneProblems();
  assert.ok(count >= 2);
  assert.deepEqual(problems, []);
  assert.ok(loadScenes().scenes.opening_captain.title, "the title is read");
});

// ---- The text format ------------------------------------------------------------------

const SAMPLE = `# A test
// a comment
start: first

== first
One line
that runs on.

@Someone: "Speech stands alone."
=> So does a consequence.
NOTE: [STORY] A message.
* journal: Written down.
* flag it_happened
> [+Voss] Go -> second
> [persuasion:hard:voss] [mercy] Talk -> won | lost ? credits >= 20 and not flag done
> Pay [! costs 20 credits] -> second ? has medkit

== second
? flag it_happened -> third
-> first

== third
CHECK engineering:easy
  reason: Open it
  pass -> won
  fail -> lost

== won
FIGHT scrap_rat: Something looks at your boots.
  allies: voss
  why: desperate
  won -> lost
  lost -> lost
  fled -> lost

== lost
Over.
END
`;

test("a scene written as text is read into the parts the game plays, with the line of everything", () => {
  const { scene, problems } = parseSceneText(SAMPLE, "sample");
  assert.deepEqual(problems, []);
  assert.equal(scene.title, "A test");
  assert.equal(scene.start, "first");
  const first = scene.parts.first;
  assert.deepEqual(first.text, ["One line that runs on.", '@Someone: "Speech stands alone."', "=> So does a consequence."]);
  assert.equal(first.note, "[STORY] A message.");
  assert.deepEqual(first.do.map(({ line, ...step }) => step), [{ tool: "add_journal", entry: "Written down." }, { set: "it_happened" }]);
  assert.equal(first.choices.length, 3);
  assert.deepEqual({ ...first.choices[0], line: undefined }, { say: "Go", tags: ["+Voss"], to: "second", line: undefined });
  assert.deepEqual({ ...first.choices[1], line: undefined }, { say: "Talk", tags: ["mercy"], check: "persuasion:hard:voss", pass: "won", fail: "lost", if: "credits >= 20 and not flag done", line: undefined });
  assert.equal(first.choices[2].say, "Pay [! costs 20 credits]", "a tag that isn't at the front stays in the words");
  assert.equal(first.choices[2].if, "has medkit");
  assert.equal(first.choices[0].line, 14);
  assert.deepEqual(scene.parts.second.when.map(({ line, ...rule }) => rule), [{ if: "flag it_happened", to: "third" }, { to: "first" }]);
  assert.deepEqual({ check: scene.parts.third.check, reason: scene.parts.third.reason, pass: scene.parts.third.pass, fail: scene.parts.third.fail }, { check: "engineering:easy", reason: "Open it", pass: "won", fail: "lost" });
  assert.deepEqual(scene.parts.won.fight, { enemy: "scrap_rat", lead_in: "Something looks at your boots.", allies: ["voss"], why: "desperate" });
  assert.deepEqual([scene.parts.won.won, scene.parts.won.lost, scene.parts.won.fled], ["lost", "lost", "lost"]);
  assert.equal(scene.parts.lost.end, true);
  assert.deepEqual(sceneProblems(scene, "sample"), []);
  // What it plays as is the same text the game master would write.
  assert.match(partText(first), /^One line that runs on\.\n\n@Someone: "Speech stands alone\."\n\n=> So does a consequence\.\n\n> \[\+Voss\] Go\n> \[persuasion:hard:voss\] \[mercy\] Talk\n> Pay/);
});

test("a mistake in a text file is reported with its line, in plain words", () => {
  const text = `words before any part
== first
> A choice with no arrow
> [persuasion:hard] One way only -> here
* xp ten: Not a number
* dance
? -> nowhere
CHECK persuasion:hard
  pass -> first
  sideways -> first
== bad name!
Text.
`;
  const { problems } = parseSceneText(text, "broken");
  const lines = Object.fromEntries(problems.map((one) => [one.line, one.message]));
  assert.match(lines[1], /before the first part/);
  assert.match(lines[3], /needs -> and the part/);
  assert.match(lines[4], /two parts after the arrow, pass \| fail/);
  assert.match(lines[5], /xp needs a number/);
  assert.match(lines[6], /isn't an effect the game knows/);
  assert.match(lines[7], /rule is written/);
  assert.match(lines[8], /only has pass and fail, not sideways/);
  assert.match(lines[11], /letters, numbers and underscores/);
});

test("effects are the same calls the AI makes, and say what's wrong when they're not", () => {
  assert.deepEqual(parseEffect(" credits -20: A round").do, { tool: "change_credits", amount: -20, reason: "A round" });
  assert.deepEqual(parseEffect(" item +medkit").do, { tool: "give_item", item: "medkit" });
  assert.deepEqual(parseEffect(" item -medkit").do, { tool: "take_item", item: "medkit" });
  assert.deepEqual(parseEffect(" quest the_beacon done: Found it").do, { tool: "update_quest", id: "the_beacon", status: "completed", objective: "Found it" });
  assert.deepEqual(parseEffect(" new quest find_him: Find Him | He's lost | Look at Haven").do, { tool: "add_quest", id: "find_him", title: "Find Him", description: "He's lost", objective: "Look at Haven" });
  assert.deepEqual(parseEffect(" contact Ilya Voss friendly: She likes you").do, { tool: "note_contact", name: "Ilya Voss", attitude: "friendly", note: "She likes you" });
  assert.deepEqual(parseEffect(" belief mercy 2: Spared him").do, { tool: "shift_ideology", toward: "mercy", amount: 2, reason: "Spared him" });
  assert.deepEqual(parseEffect(" time 8 hours rest: A night").do, { tool: "pass_time", hours: 8, activity: "rest", reason: "A night" });
  assert.deepEqual(parseEffect(' raw add_lore {"term": "The Rim", "kind": "place", "text": "Far out."}').do, { tool: "add_lore", term: "The Rim", kind: "place", text: "Far out." });
  assert.match(parseEffect(" item +pony").problem, /no item called pony/);
  assert.match(parseEffect(" belief kindness 1: x").problem, /belief needs one of/);
  assert.match(parseEffect(" contact Voss: no attitude").problem, /how they feel/);
});

test("conditions read the game, say what's wrong with them, and never hold when they're wrong", () => {
  const game = newGame();
  game.flags = { told: true };
  game.credits = 50;
  game.inventory.medkit = 1;
  game.scene = { id: "x", part: "a", seen: ["a", "b"] };
  const holds = (text) => conditionHolds(game, text, HELPERS);
  assert.equal(holds("has medkit"), true);
  assert.equal(holds("not has medkit"), false);
  assert.equal(holds("credits >= 50 and flag told"), true);
  assert.equal(holds("credits > 50"), false);
  assert.equal(holds("seen b and not seen c"), true);
  assert.equal(holds("captain"), true);
  assert.equal(holds("at meridian"), true);
  assert.equal(holds("quest the_beacon active"), true);
  assert.equal(holds("quest the_beacon done"), false);
  assert.equal(holds("quest nothing_here none"), true);
  assert.equal(holds("met Voss"), true, "the crew are the captain's contacts");
  assert.equal(holds(`skill persuasion >= ${skillRank(game, "persuasion")}`), true);
  assert.equal(holds(`stat presence > ${attr(game, "presence")}`), false);
  assert.equal(holds("day = 1"), true);
  assert.equal(holds("health >= 100"), true);
  assert.equal(holds("chance 100"), true);
  assert.equal(holds("chance 0"), false);
  assert.equal(holds("has pony"), false, "a condition with a mistake never holds");
  assert.deepEqual(parseCondition("has pony and skill flying >= 2 and credits more 3 and wibble").problems, [
    "there's no item called pony",
    "there's no skill called flying",
    '"credits" needs one of >= <= > < = != and a number: "credits more 3"',
    '"wibble" isn\'t a condition the game knows',
  ]);
});

test("a choice with a condition is only offered when it holds, a rule sends the story on, and a flag is remembered", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "tell the fleet the truth" });
  assert.equal(game.flags.told_the_fleet, true);
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  assert.match(lastNarration(game), /> Ask her what she'd do/, "not asked yet, so it's offered");
  play(game, { playerText: "ask her what she'd do" });
  assert.equal(game.scene.part, "voss_answer");
  play(game, { playerText: "go on" });
  assert.doesNotMatch(lastNarration(game), /> Ask her what she'd do/, "asked once, so it's gone");
  assert.throws(() => play(game, { playerText: "ask her what she'd do" }), /isn't one of the choices/);
  play(game, { playerText: "have pell plot" });
  assert.match(lastNarration(game), /The Sundial's asking if you meant it/, "the rule took the story to the part that knows");
  assert.equal(game.scene, null);
  assert.equal(game.flags.told_the_fleet, true, "flags outlive the scene");
});

test("the files are read again when they change, so a writer sees a change without restarting", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-live-"));
  const file = path.join(dir, "opening_captain.txt");
  fs.writeFileSync(file, "== a\nFirst words.\nEND\n");
  assert.equal(loadScenes(dir).scenes.opening_captain.parts.a.text[0], "First words.");
  fs.writeFileSync(file, "== a\nSecond words.\nEND\n");
  const later = new Date(Date.now() + 2000);
  fs.utimesSync(file, later, later);
  assert.equal(loadScenes(dir).scenes.opening_captain.parts.a.text[0], "Second words.");
  // A file that can't be read is left out, and the story says so instead of breaking.
  fs.writeFileSync(file, "nothing here\n");
  fs.utimesSync(file, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  const broken = loadScenes(dir);
  assert.equal(broken.scenes.opening_captain, undefined);
  assert.match(broken.broken.opening_captain, /^line 1: .*before the first part/);
  assert.equal(broken.problems[0].file, "opening_captain.txt");
  // The captain's own opening being broken is said so, rather than quietly playing the plain one.
  fs.writeFileSync(path.join(dir, "opening.txt"), "== a\nPlain.\nEND\n");
  const game = newGame();
  assert.throws(() => writtenTurn({ game, event: "start", emit: () => {}, log: () => {}, scenes: loadScenes(dir).scenes, broken: loadScenes(dir).broken }), (err) => err instanceof StoryError && /opening_captain can't be read: line 1/.test(err.message));
  fs.writeFileSync(path.join(dir, "_notes.txt"), "Not a scene.");
  assert.deepEqual(Object.keys(loadScenes(dir).scenes), ["opening"], "a file starting with _ is a note, and a broken one is left out");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the check-story command says what's wrong, with the line, and exits with 1; and 0 when all is well", async () => {
  const { execFile } = await import("node:child_process");
  const run = (args) => new Promise((resolve) => { execFile(process.execPath, ["src/check-scenes.js", ...args], { cwd: projectDir }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout })); });
  const good = await run([]);
  assert.equal(good.code, 0, good.stdout);
  assert.match(good.stdout, /All \d+ scenes are sound/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-bad-"));
  fs.writeFileSync(path.join(dir, "thread_x.txt"), "== a\nHello.\n> Go -> nowhere\n* xp lots: x\n");
  const bad = await run([dir]);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout, /thread_x\.txt \(line 4\): xp needs a number/);
  assert.match(bad.stdout, /choice 1 \(line 3\) goes to nowhere, which isn't a part/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the captain's opening is written, and every other life has an opening to fall back on", () => {
  assert.ok(WORLD_SCENES.opening_captain);
  for (const id of Object.keys(START_LIST)) {
    const game = newGame(id);
    assert.ok(openingSceneId(game), id);
  }
  assert.equal(openingSceneId(newGame("captain")), "opening_captain");
  assert.equal(openingSceneId(newGame("docker")), "opening_docker");
  assert.equal(openingSceneId(newGame("miner")), "opening");
});

test("the checker finds what's wrong with a scene, in plain words", () => {
  const broken = {
    start: "nowhere",
    parts: {
      a: { text: ["Hello."], choices: [{ say: "Go", to: "nowhere_else" }, { say: "Try", check: "persuasion:brutal", pass: "a" }, { tags: ["+Voss"], to: "a" }] },
      b: { text: [], do: [{ tool: "give_item", item: "a_pony" }, { tool: "make_tea" }] },
      c: { text: ["Lost."], end: true },
    },
  };
  const problems = sceneProblems(broken, "broken");
  for (const expected of ["starts at nowhere", "part c can't be reached", "part b has no text", "part b has no choices", "goes to nowhere_else", "unknown difficulty brutal", "needs pass and fail", "has no words", "effect 1", "Unknown tool: make_tea"]) {
    assert.ok(problems.some((problem) => problem.includes(expected)), `${expected}: ${problems.join(" / ")}`);
  }
});

// ---- Reading a part ----------------------------------------------------------------

test("a part reads the way the game master writes, so the page needs nothing new to show it", () => {
  const part = WORLD_SCENES.opening_captain.parts.bridge;
  const text = partText(part);
  const blocks = parseNarration(text);
  const speakers = blocks.filter((block) => block.type === "speech").map((block) => block.speaker);
  assert.ok(speakers.some((name) => /Voss/.test(name)), speakers.join(", "));
  assert.ok(speakers.some((name) => /Sorel/.test(name)));
  const options = parseOptions(text, vocab);
  assert.equal(options.length, 4);
  const check = options.find((option) => option.tags.some((tag) => tag.kind === "check"));
  assert.deepEqual(check.tags[0], { kind: "check", skill: "persuasion", difficulty: "moderate", audience: "voss" });
  assert.equal(check.label, "Ask what she isn't telling you");
  assert.ok(options.some((option) => option.tags.some((tag) => tag.kind === "approve" && tag.name === "Voss")));
  assert.ok(options.some((option) => option.tags.some((tag) => tag.kind === "belief" && tag.pole === "reason")));
  assert.equal(choiceLine({ say: "Run", check: "athletics:hard", tags: ["!", "-Tarrow"] }), "> [athletics:hard] [!] [-Tarrow] Run");
});

test("typing a choice is forgiving: the start of it, most of its words, or a typo, but never a guess between two", () => {
  const choices = WORLD_SCENES.opening_captain.parts.bridge.choices;
  assert.equal(matchChoice("Say nothing, and listen to it", choices)?.to, "listen");
  assert.equal(matchChoice("say nothing", choices)?.to, "listen");
  assert.equal(matchChoice("ask what she isnt teling you", choices)?.check, "persuasion:moderate:voss");
  assert.equal(matchChoice("tell the fleet the truth", choices)?.to, "truth");
  assert.equal(matchChoice("what would she do if the chair were hers", choices)?.to, "voss_answer");
  assert.equal(matchChoice("ask", choices), null, "two choices start with ask");
  assert.equal(matchChoice("ask her", choices)?.to, "voss_answer", "only one goes on with her");
  assert.equal(matchChoice("fly to the moon", choices), null);
  assert.equal(matchChoice("", choices), null);
});

// ---- Playing ---------------------------------------------------------------------------

test("the captain's opening plays through with no AI: speech, a choice, consequences, and an end", () => {
  const game = newGame();
  const opening = play(game, { event: "start" });
  assert.equal(opening[0].role, "narrator");
  assert.match(opening[0].text, /@Commander Ilya Voss: "Captain\."/);
  assert.deepEqual(game.scene, { id: "opening_captain", part: "bridge", pending: null, seen: ["bridge"] });
  assert.equal(game.transcript.filter((entry) => entry.role === "player").length, 0, "nothing's logged as the player's until they choose");

  const heard = play(game, { playerText: "say nothing" });
  assert.equal(game.transcript.find((entry) => entry.role === "player")?.text, "Say nothing, and listen to it", "the choice is recorded in full, not as typed");
  assert.match(heard[0].text, /@Ensign Lira Vey: "Confirming:/);
  assert.equal(game.journal.length, 1, "the part's do step wrote the journal");
  assert.equal(game.scene.part, "listen");

  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "orders");
  play(game, { playerText: "Have Pell plot the course for Haven" });
  assert.equal(game.scene, null, "the scene is over");
  assert.doesNotMatch(lastNarration(game), /Sundial's asking/, "the fleet wasn't told, so the plain ending plays");
  assert.match(game.quests.find((quest) => quest.id === "the_beacon").objective, /Haven Station is plotted/);
  assert.equal(game.xp, 10);
  assert.ok(game.transcript.some((entry) => entry.role === "notice" && /XP/.test(entry.text)), "the award shows as a game message");
  assert.ok(publicState(game).scene === null && publicState(game).mode === "written");
});

test("a choice with a check opens the check's window, and the story goes on from how it came out", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "Ask what she isn't telling you" });
  assert.ok(game.check, "the window is open");
  assert.equal(game.check.source, "choice");
  assert.equal(game.check.audience, "voss");
  assert.equal(game.transcript.at(-1).text, "Ask what she isn't telling you");
  assert.equal(game.scene.part, "bridge", "the story waits");
  assert.equal(checkCommand(game, "run").over, true);
  assert.equal(game.check, null);
  assert.equal(game.pendingEvents.length, 1, "the page offers Continue the story");
  const expected = game.lastCheck.success ? "voss_pressed_pass" : "voss_pressed_fail";
  play(game, { event: "continue" });
  assert.equal(game.scene.part, expected);
  assert.equal(game.pendingEvents.length, 0);
  assert.ok(game.lastCheck.used, "the same result can't be read twice");
  // Pressing Continue again says so, instead of playing the result again.
  const again = play(game, { event: "continue" });
  assert.equal(game.scene.part, expected);
  assert.match(again[0].text, /Nothing more is written/);
});

test("a part can demand a check or start a fight itself, and the ending decides where the story goes", () => {
  const scenes = {
    opening_captain: {
      start: "a",
      parts: {
        a: { text: ["A locked hatch."], check: "engineering:easy", reason: "Open the hatch", pass: "open", fail: "stuck" },
        open: { text: ["It opens."], choices: [{ say: "Go through", to: "ambush" }] },
        stuck: { text: ["It doesn't."], choices: [{ say: "Kick it", to: "ambush" }] },
        ambush: { text: ["Trouble."], fight: { enemy: "scrap_rat", lead_in: "Something the size of a dog looks at your boots." }, won: "won", lost: "lost", fled: "fled" },
        won: { text: ["You won."], end: true },
        lost: { text: ["You lost."], end: true },
        fled: { text: ["You ran."], end: true },
      },
    },
  };
  assert.deepEqual(sceneProblems(scenes.opening_captain, "test"), []);
  const game = newGame();
  play(game, { event: "start" }, scenes);
  assert.ok(game.check, "the check the story demanded is open");
  assert.equal(game.check.reason, "Open the hatch");
  assert.deepEqual(game.scene.pending, { kind: "check", pass: "open", fail: "stuck" });
  checkCommand(game, "run");
  const expected = game.lastCheck.success ? "open" : "stuck";
  play(game, { event: "continue" }, scenes);
  assert.equal(game.scene.part, expected);
  const fight = play(game, { playerText: game.lastCheck.success ? "go through" : "kick it" }, scenes);
  assert.ok(game.combat, "the fight has started");
  assert.match(fight[0].text, /Trouble\.[\s\S]*size of a dog/);
  assert.equal(game.scene.pending.kind, "fight");
  // The fight's ending is what the fight window records when it's over.
  game.combat = null;
  game.lastFight = { result: "fled", enemies: ["scrap_rat"], summary: "You got away.", used: false };
  game.pendingEvents.push("The player ran.");
  play(game, { event: "continue" }, scenes);
  assert.equal(game.scene, null);
  assert.match(lastNarration(game), /You ran/);
});

test("what the written story can't answer leaves the game exactly as it was, and says why", () => {
  const game = newGame();
  play(game, { event: "start" });
  const before = JSON.stringify(game);
  assert.throws(() => play(game, { playerText: "fly to the moon" }), (err) => err instanceof StoryError && /isn't one of the choices/.test(err.message));
  assert.throws(() => play(game, { playerText: "I look into this", threadId: "crew_marrow_aft_hold" }), (err) => err instanceof StoryError && /hasn't been written out yet/.test(err.message));
  assert.equal(JSON.stringify(game), before);
  // Once the scene is over, typing gets a different answer.
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "see the ship" });
  assert.equal(game.scene, null);
  assert.throws(() => play(game, { playerText: "look around" }), /no more written story here/);
});

test("someone who isn't the captain gets the opening that fits anyone, with a note saying theirs is to come", () => {
  const game = newGame("miner", 5);
  const pieces = play(game, { event: "start" });
  assert.match(pieces[0].text, /The signal is on every band/);
  assert.ok(pieces.some((piece) => piece.role === "notice" && /hasn't been written yet/.test(piece.text)));
  play(game, { playerText: "get on with the day" });
  assert.equal(game.scene, null);
});

test("in a written game, a talk has what people have heard and goodbye, with nothing to type", () => {
  const game = newGame();
  play(game, { event: "start" });
  const voss = publicState(game).walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss, "Voss is on the bridge");
  talkCommand(game, { action: "open", person: voss.key });
  const view = talkView(game);
  assert.equal(view.written, true);
  assert.deepEqual(view.asks, []);
  assert.ok(view.rumors >= 0);
  talkCommand(game, { action: "close" });
  game.mode = "ai";
  talkCommand(game, { action: "open", person: voss.key });
  assert.equal(talkView(game).written, false);
  assert.ok(talkView(game).asks.length > 0, "with an AI, there are things to say");
});

test("an older save keeps its AI game master, and a new game says which it has", () => {
  const old = { ...createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" })), version: 14 };
  delete old.mode;
  delete old.scene;
  const migrated = migrateGame(old);
  assert.equal(migrated.version, 15);
  assert.equal(migrated.mode, "ai");
  assert.equal(migrated.scene, null);
  assert.deepEqual(migrated.flags, {});
  const fresh = createGameFromDraft(randomDraft({ seed: 3, archetype: "officer" }));
  assert.equal(fresh.mode, "ai", "the server decides, from the Settings menu");
  assert.equal(publicState(fresh).mode, "ai");
});

// ---- The Downstairs Crew: one whole story, written out ----------------------------------------

const DOWNSTAIRS = "crew_naomi_under_crew";
// Settles the check that's open, without the dice, the way its window would.
function settleCheck(game, success) {
  assert.ok(game.check, "a check is open");
  game.lastCheck = { id: game.check.id, skill: game.check.skill, difficulty: game.check.difficulty, success, reason: game.check.reason, source: game.check.source, used: false };
  game.check = null;
  game.pendingEvents.push("The check is done.");
}
const roomNow = (game) => publicState(game).walk.here.name;

test("the Downstairs Crew ends every way it can end with the quest settled, and every ending is reachable", () => {
  const scene = WORLD_SCENES[`thread_${DOWNSTAIRS}`];
  assert.ok(scene, "the scene exists");
  const endings = Object.entries(scene.parts).filter(([, part]) => part.end);
  assert.ok(endings.length >= 14, `${endings.length} endings`);
  for (const [name, part] of endings) {
    if (name === "back_up") continue;
    const settled = (part.do ?? []).find((step) => (step.tool === "update_quest" && step.id === DOWNSTAIRS && step.status !== "active") || step.ending);
    assert.ok(settled, `${name} doesn't settle the quest`);
  }
  // The parts that lead to back_up settle it on the way.
  for (const name of ["sworn", "sworn_after_reunion"]) assert.ok(scene.parts[name].do.some((step) => step.ending === "treaty_cadets"), name);
  const words = fs.readFileSync(path.join(projectDir, "world", "scenes", `thread_${DOWNSTAIRS}.txt`), "utf8");
  assert.ok(words.split(/\s+/).length > 4000, "it's a whole story, not a sketch");
});

test("the captain plays the Downstairs Crew through to the treaty, and the game's records follow", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "see the ship" });
  assert.equal(game.scene, null);
  // Taken up from the Leads menu.
  const lead = publicState(game).story.here.find((one) => one.id === DOWNSTAIRS);
  assert.ok(lead, "the lead is on offer aboard the Meridian");
  assert.equal(lead.written, true);
  assert.equal(publicState(game).story.here[0].id, DOWNSTAIRS, "a written story comes first in a written game");
  const opening = play(game, { playerText: `I look into this: ${lead.title}`, threadId: DOWNSTAIRS });
  assert.match(opening[0].text, /Naomi Cass is in your doorway/);
  assert.equal(game.story.threads[DOWNSTAIRS], "active", "the Leads menu lists it as followed");
  assert.ok(game.quests.find((quest) => quest.id === DOWNSTAIRS)?.status === "active");
  assert.equal(game.scene.part, "doorway");

  play(game, { playerText: "ask her what's in section fourteen" });
  play(game, { playerText: "Ask Chief Marrow about the hull work first" });
  assert.equal(roomNow(game), "Engineering", "the map followed the story to Marrow");
  play(game, { playerText: "Ask Quartermaster Brandt" });
  assert.equal(game.flags.brandt_knows, true);
  play(game, { playerText: "Go down through the Cold Elbow" });
  assert.equal(game.scene.part, "which_way");
  // The quiet way: a stealth check, settled as a pass.
  play(game, { playerText: "Take the Whistler" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "crawl");
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "tour");
  assert.equal(roomNow(game), "Section Fourteen", "the story put the player in a room of its own");
  assert.ok(publicState(game).walk.people.some((one) => /Naomi/.test(one.name)));

  play(game, { playerText: "Ask about the coughing" });
  play(game, { playerText: "Send up for Dr. Aduro" });
  assert.equal(game.flags.aduro_knows, true);
  assert.ok(game.contacts.some((one) => /Aduro/.test(one.name) && one.attitude === "friendly"));
  assert.equal(game.scene.part, "aduro_comes");
  play(game, { playerText: "Go back to the council" });
  assert.equal(game.scene.part, "fourteen");
  assert.doesNotMatch(lastNarration(game), /coughing behind the curtain/, "a part already seen isn't offered again");
  play(game, { playerText: "Ask the council what they want" });
  play(game, { playerText: "Ask Naomi about clause nine" });
  assert.equal(game.flags.clause_nine, true);
  play(game, { playerText: "go on" });
  play(game, { playerText: "time to decide" });
  assert.equal(game.scene.part, "decide");
  assert.match(lastNarration(game), /Swear them in as ship's cadets/, "reading the treaty opens the cadets' oath");

  play(game, { playerText: "Put it to their council" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "council_pass");
  play(game, { playerText: "sign" });
  assert.equal(game.scene.part, "sworn");
  assert.equal(game.quests.find((quest) => quest.id === DOWNSTAIRS).status, "completed");
  assert.equal(game.story.threads[DOWNSTAIRS], "done", "the story is finished in the game's records");
  assert.equal(game.contacts.find((one) => /Naomi/.test(one.name)).attitude, "ally");
  assert.equal(game.flags.children_are_crew, true);
  assert.ok(game.xp >= 40);
  assert.match(lastNarration(game), /clause nine/, "clause nine is on the table, because she read the treaty");
  play(game, { playerText: "Tell Naomi the truth" });
  assert.equal(game.flags.naomi_knows_father, true);
  play(game, { playerText: "climb back up" });
  assert.equal(game.scene, null);
  assert.equal(roomNow(game), "Engineering", "back where the wall opens");
  assert.ok(game.journal.length >= 4, `the journal has the story: ${game.journal.length} entries`);
});

test("the Downstairs Crew's other roads: a fight in the deep duct, the council saying no, and giving the order", () => {
  const scenes = loadScenes().scenes;
  const start = (seed) => {
    const game = newGame("captain", seed);
    play(game, { event: "start" });
    play(game, { playerText: "listen" });
    play(game, { playerText: "go on" });
    play(game, { playerText: "see the ship" });
    play(game, { playerText: "I look into this", threadId: DOWNSTAIRS });
    play(game, { playerText: "go with her now" });
    play(game, { playerText: "Take the Cold Elbow" });
    settleCheck(game, true);
    play(game, { event: "continue" });
    assert.equal(game.scene.part, "tour");
    return game;
  };
  // The rats, drawn weapon: a real fight starts, and losing it is survivable.
  const fighter = start(3);
  play(fighter, { playerText: "Ask about the coughing" });
  play(fighter, { playerText: "Draw your weapon" });
  assert.ok(fighter.combat, "the fight is on");
  assert.equal(fighter.combat.enemies.length, 2);
  fighter.combat = null;
  fighter.lastFight = { result: "defeat", enemies: ["scrap_rat"], summary: "You lost.", used: false };
  fighter.pendingEvents.push("The player lost.");
  play(fighter, { event: "continue" });
  assert.equal(fighter.scene.part, "rats_lost");
  play(fighter, { playerText: "go on" });
  assert.equal(fighter.scene.part, "bedside");

  // The council says no, and the choice is gone, but the others remain.
  const talker = start(4);
  play(talker, { playerText: "seen enough" });
  play(talker, { playerText: "Put it to their council" });
  settleCheck(talker, false);
  play(talker, { event: "continue" });
  assert.equal(talker.scene.part, "council_fail");
  play(talker, { playerText: "go on" });
  assert.equal(talker.scene.part, "decide");
  assert.doesNotMatch(lastNarration(talker), /Put it to their council/);
  assert.doesNotMatch(lastNarration(talker), /Swear them in/, "the treaty wasn't read, so there's no oath to swear by");
  assert.match(lastNarration(talker), /Reroute Marrow's hull work/);

  // The order, given and obeyed by some.
  play(talker, { playerText: "Order them out" });
  settleCheck(talker, true);
  play(talker, { event: "continue" });
  assert.equal(talker.scene, null);
  assert.equal(talker.quests.find((quest) => quest.id === DOWNSTAIRS).status, "completed");
  assert.equal(talker.flags.downstairs_enemies, true);
  assert.equal(talker.contacts.find((one) => /Naomi/.test(one.name)).attitude, "hostile");

  // Letting the vent run, from the doorway, fails the quest without a single check.
  const cold = newGame("captain", 5);
  play(cold, { event: "start" });
  play(cold, { playerText: "listen" });
  play(cold, { playerText: "go on" });
  play(cold, { playerText: "see the ship" });
  play(cold, { playerText: "I look into this", threadId: DOWNSTAIRS });
  play(cold, { playerText: "ask her what's in" });
  play(cold, { playerText: "Tell her the vent goes ahead" });
  assert.equal(cold.scene, null);
  assert.equal(cold.quests.find((quest) => quest.id === DOWNSTAIRS).status, "failed");
  assert.equal(cold.story.threads[DOWNSTAIRS], "done");
  assert.ok(Object.keys(scenes).includes(`thread_${DOWNSTAIRS}`));
});

test("someone who isn't the captain gets the smaller story, and can still make it come out right", () => {
  const game = newGame("engine_hand", 8);
  play(game, { event: "start" });
  play(game, { playerText: "Keep your head down" });
  play(game, { playerText: "Get back to work" });
  const lead = publicState(game).story.here.find((one) => one.id === DOWNSTAIRS);
  assert.ok(lead, "the lead reaches an engine hand aboard the Meridian");
  assert.match(lead.lead, /told everyone who'll listen/);
  const opening = play(game, { playerText: "I look into this", threadId: DOWNSTAIRS });
  assert.equal(game.scene.part, "heard", "the rule sent them past the captain's doorway");
  assert.match(opening[0].text, /You're not the Upstairs Captain/);
  play(game, { playerText: "Follow her" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "followed");
  assert.equal(roomNow(game), "Section Fourteen");
  play(game, { playerText: "bring Dr. Aduro down" });
  assert.equal(game.scene, null);
  assert.equal(game.quests.find((quest) => quest.id === DOWNSTAIRS).status, "completed");
  assert.equal(game.flags.downstairs_crew, true);
  assert.match(JSON.stringify(game.journal), /Aduro/, "the journal has the story");
});

// ---- People and things, with no AI ------------------------------------------------------------

const { openWrittenTalk, stockTalk, writtenTalkTurn } = await import("../src/talks.js");
const { askAtDoor, useThing, walkCommand } = await import("../src/walk.js");

// Says one thing in a talk the way the server does: the answer goes in the talk's log.
function sayInTalk(game, text) {
  const { talkHeard, talkSaid } = walkModule;
  talkSaid(game, text);
  const pieces = [];
  writtenTalkTurn({ game, playerText: text, emit: (e) => { if (e.type !== "state") pieces.push(e); } });
  for (const piece of pieces) talkHeard(game, piece.text, piece.type === "text" ? "narrator" : "notice");
  return pieces;
}
const walkModule = await import("../src/walk.js");
const personKey = (game, pattern) => publicState(game).walk.people.find((one) => pattern.test(one.name))?.key;
function openTalkWith(game, pattern) {
  const key = personKey(game, pattern);
  assert.ok(key, `someone matching ${pattern} is in the room`);
  talkCommand(game, { action: "open", person: key });
  openWrittenTalk(game);
  return talkView(game);
}

test("in a written game, someone with a conversation of their own speaks first, and what you say leads on", () => {
  const game = newGame();
  play(game, { event: "start" });
  const view = openTalkWith(game, /Voss/);
  assert.equal(view.written, true);
  assert.match(view.lastReply, /@Commander Ilya Voss: "Captain\."/);
  assert.match(view.lastReply, /> What's our real situation, Commander\?/);
  assert.equal(game.talk.written.id, "talk_voss");
  const said = sayInTalk(game, "what's our real situation");
  assert.match(said[0].text, /Fuel for two weeks/);
  assert.equal(game.talk.written.part, "situation");
  assert.doesNotMatch(talkView(game).lastReply, /> What's our real situation/, "a question asked isn't offered again");
  assert.match(talkView(game).lastReply, /> Is there anything I should be worried about\?/);
  assert.throws(() => sayInTalk(game, "tell me a joke"), (err) => err instanceof StoryError && /isn't one of the things to say/.test(err.message));
  sayInTalk(game, "That's all for now");
  assert.equal(game.talk.written.part, "done");
  assert.doesNotMatch(talkView(game).lastReply, />/, "nothing more to say, so only the free buttons are left");
  talkCommand(game, { action: "close" });
  assert.equal(game.talk, null);
  assert.ok(game.transcript.some((entry) => /\[TALK\] You talked with Commander Ilya Voss/.test(entry.text)));
});

test("a conversation remembers what the story did, through flags, and what's said in it changes the game", () => {
  const game = newGame();
  play(game, { event: "start" });
  game.flags.knows_about_the_list = true;
  const view = openTalkWith(game, /Voss/);
  assert.equal(game.talk.written.part, "start_list", "the rule took her straight to the list");
  assert.match(view.lastReply, /Two more names on it since yesterday/);
  const journalBefore = game.journal.length;
  sayInTalk(game, "which ships are on the list");
  assert.equal(game.journal.length, journalBefore + 1, "the part's effect wrote the journal");
  talkCommand(game, { action: "close" });
  // Someone who isn't the captain gets her other side.
  const hand = newGame("engine_hand", 8);
  play(hand, { event: "start" });
  play(hand, { playerText: "Keep your head down" });
  play(hand, { playerText: "Get back to work" });
  walkCommand(hand, { action: "room", to: "bridge" });
  openTalkWith(hand, /Voss/);
  assert.equal(hand.talk.written.part, "other");
  assert.match(talkView(hand).lastReply, /The captain's shorter/);
});

test("anyone without a conversation of their own gets stock lines, put together from who they are", () => {
  const game = newGame();
  play(game, { event: "start" });
  walkCommand(game, { action: "room", to: "mess" });
  const local = publicState(game).walk.people.find((one) => one.crowd || !/Halm|Brandt|Seven|Roe/.test(one.name));
  assert.ok(local, "someone ordinary is in the mess");
  talkCommand(game, { action: "open", person: local.key });
  openWrittenTalk(game);
  assert.equal(game.talk.written.id, null);
  assert.ok(game.talk.written.stock, "the stock conversation was made when it opened");
  const view = talkView(game);
  assert.match(view.lastReply, new RegExp(`^@${local.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `));
  assert.match(view.lastReply, /> What's it like, here\?/);
  sayInTalk(game, "what's it like here");
  assert.match(talkView(game).lastReply, /One hall, four sittings/, "the room's own description, as what they say");
  assert.doesNotMatch(talkView(game).lastReply, /> What's it like, here\?/);
  const stock = stockTalk(game, game.talk);
  assert.equal(stock.start, "start");
  talkCommand(game, { action: "close" });
});

test("a conversation can't open a check or a fight, and the checker says so", () => {
  const { scene } = parseSceneText("== start\n@Someone: \"Hello.\"\n> [persuasion:hard] Push -> a | b\n== a\nFIGHT scrap_rat: Rats.\n  won -> start\n  lost -> start\n== b\nFine.\nEND\n", "talk_test");
  const problems = sceneProblems(scene, "talk_test", { talk: true });
  assert.ok(problems.some((one) => /choice 1 .* has a check, and a conversation can't open one/.test(one)), problems.join(" / "));
  assert.ok(problems.some((one) => /part a .* has a fight, and a conversation can't open one/.test(one)), problems.join(" / "));
  assert.deepEqual(sceneProblems(scene, "scene_test"), [], "the same file is fine as a scene");
});

test("using a thing with no AI: something to pick up is picked up, and a thing with a written result gives it", () => {
  const game = newGame();
  play(game, { event: "start" });
  const chip = useThing(game, "bridge:d");
  assert.match(chip.said, /^\[ITEM\] Received: .*Data Chip/i);
  assert.equal(game.inventory.data_chip, 1);
  assert.match(useThing(game, "bridge:d").said, /already got one/);
  assert.match(useThing(game, "bridge:c").said, /The chair takes your weight/);
  assert.throws(() => useThing(game, "bridge:zzz"), /isn't here/);
  // Over the walk command, which is what the page calls.
  const reply = walkCommand(game, { action: "use", key: "bridge:a" });
  assert.match(reply.said, /Slow Harriet/);
  // Somewhere with nothing written yet, there's still an answer.
  walkCommand(game, { action: "room", to: "aft" });
  const aft = publicState(game).walk.things.find((thing) => /Coolant/.test(thing.name));
  assert.match(useThing(game, aft.id).said, /Nothing more comes of it/);
});

test("asking at a closed door with no AI: a door that opens when asked, one that needs a flag, and one that opens a check", () => {
  // The picket line at Cinder Reach opens to anyone who crosses it, and it's remembered.
  const miner = newGame("miner", 11);
  play(miner, { event: "start" });
  play(miner, { playerText: "get on with the day" });
  const picket = publicState(miner).walk.exits.find((exit) => exit.closed);
  assert.ok(picket, "the picket line is a closed way out of the Row");
  const crossed = askAtDoor(miner, picket.key);
  assert.match(crossed.said, /They watch you cross/);
  assert.equal(crossed.opened, true);
  assert.equal(miner.flags.crossed_the_picket, true);
  assert.ok(!publicState(miner).walk.exits.find((exit) => exit.key === picket.key).closed, "the way is open now");

  // The Velvet Deck wants an invitation, and takes money otherwise, through a check.
  const dealer = newGame("dealer", 7);
  play(dealer, { event: "start" });
  play(dealer, { playerText: "get on with the day" });
  const lift = publicState(dealer).walk.exits.find((exit) => exit.closed);
  assert.ok(lift);
  const asked = askAtDoor(dealer, lift.key);
  assert.equal(asked.check, true);
  assert.ok(dealer.check, "the check's window is open");
  assert.equal(dealer.check.source, "door");
  assert.equal(dealer.check.skill, "commerce");
  assert.deepEqual(Object.keys(dealer.doorAsked).sort(), ["fail", "flag", "pass", "place", "to"]);
  settleCheck(dealer, true);
  const pieces = play(dealer, { event: "continue" });
  assert.match(pieces[0].text, /the grille does/);
  assert.ok(dealer.opened.wheel?.includes("velvet"), "the door is open");
  assert.equal(dealer.doorAsked, null);
  // The same door, with the invitation in hand, opens without a check.
  const invited = newGame("dealer", 9);
  play(invited, { event: "start" });
  play(invited, { playerText: "get on with the day" });
  invited.flags.velvet_invitation = true;
  const welcome = askAtDoor(invited, publicState(invited).walk.exits.find((exit) => exit.closed).key);
  assert.equal(welcome.opened, true);
  assert.match(welcome.said, /has your invitation/);
  // Asking at a door that's already open is refused.
  assert.throws(() => askAtDoor(miner, picket.key), /isn't closed/);
});

test("every closed door in the world has a written rule, and every rule is sound", async () => {
  const { WORLD_MAPS } = await import("../src/world.js");
  let doors = 0;
  for (const [place, map] of Object.entries(WORLD_MAPS)) {
    for (const [levelId, level] of Object.entries(map.levels)) {
      for (const [key, exit] of Object.entries(level.exits ?? {})) {
        if (!exit.closed) continue;
        doors += 1;
        const rule = exit.closed.ask;
        assert.ok(rule, `${place}:${levelId}:${key} has no rule`);
        const kinds = ["if", "check", "opens", "answer"].filter((field) => rule[field]);
        assert.ok(kinds.length, `${place}:${levelId}:${key} has a rule with nothing in it`);
        if (rule.if) {
          assert.deepEqual(parseCondition(rule.if).problems, [], `${place}:${levelId}:${key}: ${rule.if}`);
          assert.ok(rule.opens, `${place}:${levelId}:${key} needs opens`);
        }
        if (rule.check) {
          const [skill, difficulty] = rule.check.split(":");
          assert.ok(SKILLS[skill] && difficulty, `${place}:${levelId}:${key}: ${rule.check}`);
          assert.ok(rule.pass && rule.fail, `${place}:${levelId}:${key} needs pass and fail`);
        }
      }
    }
  }
  assert.equal(doors, 15);
});

// ---- Act 1, for three lives: arriving at Haven, two more openings, and the Warm Room -------------

const { fleetCommand } = await import("../src/fleet.js");
const WARM = "main_the_old_scholar";
const quest = (game, id) => game.quests.find((one) => one.id === id);

test("a condition can ask which life the player chose", () => {
  assert.deepEqual(parseCondition("life docker").problems, []);
  assert.match(parseCondition("life nobody").problems[0], /no life called nobody/);
  assert.equal(conditionHolds(newGame("docker", 2), "life docker", HELPERS), true);
  assert.equal(conditionHolds(newGame("docker", 2), "life captain", HELPERS), false);
  assert.equal(conditionHolds(newGame(), "life captain and captain", HELPERS), true);
});

test("the engine hand and the dock hand have openings of their own, and they play", () => {
  const hand = newGame("engine_hand", 4);
  assert.equal(openingSceneId(hand), "opening_engine_hand");
  const first = play(hand, { event: "start" });
  assert.match(first[0].text, /The coolant line went at the start of the watch/);
  play(hand, { playerText: "Ask the chief what the bridge is on about" });
  play(hand, { playerText: "Ask what he needs" });
  assert.equal(hand.flags.marrow_wants_a_capacitor, true);
  assert.match(quest(hand, "keep_her_running").objective, /capacitor/);
  play(hand, { playerText: "get back to work" });
  assert.equal(hand.scene, null);

  const docker = newGame("docker", 5);
  assert.equal(openingSceneId(docker), "opening_docker");
  play(docker, { event: "start" });
  play(docker, { playerText: "Take the clipboard back up" });
  assert.equal(docker.flags.asked_about_the_crate, true);
  assert.equal(docker.contacts.find((one) => /Jessup/.test(one.name))?.attitude, "neutral");
  play(docker, { playerText: "get on with the shift" });
  assert.equal(docker.scene, null);
  assert.ok(docker.journal.length >= 1);
});

test("arriving somewhere with a written arrival plays it when the player continues, once at length and then in a line", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "have pell plot" });
  const jump = fleetCommand(game, { action: "course", id: "haven" });
  assert.equal(jump.moved, true);
  assert.equal(game.location, "haven");
  assert.equal(game.arrived, "haven");
  assert.equal(game.pendingEvents.length, 1, "the page offers Continue the story");
  const arrival = play(game, { event: "continue" });
  assert.match(arrival[0].text, /Haven Station comes up on the viewport/);
  assert.equal(game.arrived, null);
  assert.equal(game.flags.arrived_haven, true);
  assert.equal(game.scene, null, "the arrival ends by itself");
  assert.ok(arrival.some((piece) => piece.role === "notice" && /Leads menu/.test(piece.text)));
  // Back and forth: the second arrival is a line.
  fleetCommand(game, { action: "course", id: "meridian" });
  play(game, { event: "continue" });
  fleetCommand(game, { action: "course", id: "haven" });
  const again = play(game, { event: "continue" });
  assert.match(again[0].text, /Haven again/);
  // Someone arriving alone gets their own words.
  const hand = newGame("engine_hand", 6);
  play(hand, { event: "start" });
  play(hand, { playerText: "Keep your head down" });
  play(hand, { playerText: "Get back to work" });
  hand.credits = 200;
  fleetCommand(hand, { action: "course", id: "haven" });
  assert.equal(hand.location, "haven");
  const alone = play(hand, { event: "continue" });
  assert.match(alone[0].text, /Haven Station, on your own/);
});

test("the captain plays the Warm Room through to the reveal: Sable, Tharel's test, Sorel's recording, the stair, and the news", () => {
  const game = newGame();
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "have pell plot" });
  fleetCommand(game, { action: "course", id: "haven" });
  play(game, { event: "continue" });
  const leads = publicState(game).story.here;
  assert.equal(leads[0].id, WARM, "the main story comes first at Haven");
  play(game, { playerText: "I look into this", threadId: WARM });
  assert.equal(game.scene.part, "start");
  assert.equal(quest(game, WARM).status, "active");
  play(game, { playerText: "Ask who else has been paying" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "who_pays");
  assert.equal(game.flags.who_pays_known, true);
  play(game, { playerText: "speak to the Ilari" });
  assert.equal(game.scene.part, "yara");
  play(game, { playerText: "Follow her" });
  assert.equal(game.scene.part, "warm_room");
  assert.equal(roomNow(game), "Tharel's Warm Room");
  play(game, { playerText: "The truth. Always" });
  assert.equal(game.flags.tharel_trusts, true);
  play(game, { playerText: "Ask him what he needs" });
  play(game, { playerText: "Shuttle back across" });
  assert.equal(game.scene.part, "sorel");
  play(game, { playerText: "pull the signal's frame headers" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "headers_pass");
  assert.ok(game.story.clues.includes("two_layers"), "the clue is in the main story's record");
  assert.equal(game.inventory.data_chip, 1);
  play(game, { playerText: "Take it to Tharel" });
  assert.equal(game.scene.part, "back_to_warm_room");
  play(game, { playerText: "Stand in the corridor" });
  settleCheck(game, true);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "held");
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "reveal_trusted", "trust earned, so he gives everything");
  assert.equal(game.inventory.beacon_shard, 1);
  assert.equal(game.contacts.find((one) => /Tharel/.test(one.name)).attitude, "ally");
  play(game, { playerText: "Listen to it with him" });
  settleCheck(game, false);
  play(game, { event: "continue" });
  assert.equal(game.scene.part, "one_voice");
  play(game, { playerText: "what you should tell the fleet" });
  play(game, { playerText: "Announce it to the fleet" });
  assert.equal(game.scene, null);
  assert.equal(quest(game, WARM).status, "completed");
  assert.equal(game.story.threads[WARM], "done");
  assert.equal(game.flags.announced_navy_survivors, true);
});

test("the Warm Room lost: standing aside, Quill's people take him, and Sable sells what he'd have said", () => {
  const game = newGame("captain", 12);
  play(game, { event: "start" });
  play(game, { playerText: "listen" });
  play(game, { playerText: "go on" });
  play(game, { playerText: "have pell plot" });
  fleetCommand(game, { action: "course", id: "haven" });
  play(game, { event: "continue" });
  play(game, { playerText: "I look into this", threadId: WARM });
  game.credits = 100;
  play(game, { playerText: "Pay Sable's forty" });
  assert.equal(game.credits, 60);
  play(game, { playerText: "Go to the Warm Room" });
  play(game, { playerText: "A direction" });
  play(game, { playerText: "Ask him what he needs" });
  play(game, { playerText: "Shuttle back across" });
  play(game, { playerText: "Take the recording to Tharel" });
  play(game, { playerText: "Stand aside" });
  assert.equal(game.scene.part, "let_them");
  play(game, { playerText: "go on" });
  assert.equal(game.scene.part, "taken");
  assert.equal(game.flags.tharel_taken_by_quill, true);
  play(game, { playerText: "Pay Sable's sixty" });
  assert.equal(game.scene, null);
  assert.equal(game.credits, 0);
  assert.ok(game.story.clues.includes("two_layers"));
  assert.equal(game.flags.sable_favor, true);
  assert.match(quest(game, WARM).objective, /Getting Tharel back/);
});

test("the engine hand and the dock hand each get their own way into the Warm Room, and can save the old man", () => {
  const hand = newGame("engine_hand", 6);
  play(hand, { event: "start" });
  play(hand, { playerText: "Keep your head down" });
  play(hand, { playerText: "Get back to work" });
  hand.credits = 200;
  fleetCommand(hand, { action: "course", id: "haven" });
  play(hand, { event: "continue" });
  assert.ok(publicState(hand).story.here.some((one) => one.id === WARM), "the lead reaches a fleet hand who's crossed to Haven");
  play(hand, { playerText: "I look into this", threadId: WARM });
  assert.equal(hand.scene.part, "hand_start", "the rule knew the life");
  play(hand, { playerText: "Offer to fix the boiler" });
  play(hand, { playerText: "Get the boiler running" });
  settleCheck(hand, true);
  play(hand, { event: "continue" });
  assert.equal(hand.scene.part, "hand_fixed");
  assert.equal(hand.flags.tharel_trusts, true);
  play(hand, { playerText: "Sit, and ask him" });
  assert.equal(hand.scene.part, "outsider_warm");
  assert.equal(hand.flags.two_layers_known, true);
  assert.ok(hand.story.clues.includes("two_layers"));
  play(hand, { playerText: "Get him out through the ventilation" });
  settleCheck(hand, true);
  play(hand, { event: "continue" });
  assert.equal(hand.scene, null);
  assert.equal(hand.flags.sable_favor, true);
  assert.equal(quest(hand, WARM).status, "completed");

  const docker = newGame("docker", 5);
  play(docker, { event: "start" });
  play(docker, { playerText: "Count the crates as told" });
  play(docker, { playerText: "get on with the shift" });
  assert.ok(publicState(docker).story.here.some((one) => one.id === WARM), "the lead is local to a dock hand");
  play(docker, { playerText: "I look into this", threadId: WARM });
  assert.equal(docker.scene.part, "dock_start");
  play(docker, { playerText: "Take the crate up" });
  assert.equal(docker.scene.part, "dock_warm");
  play(docker, { playerText: "Sit, and ask him" });
  assert.equal(docker.scene.part, "outsider_warm");
  play(docker, { playerText: "Stand in the doorway" });
  assert.ok(docker.combat, "the snatch team is a real fight");
  docker.combat = null;
  docker.lastFight = { result: "defeat", enemies: ["dock_thug"], summary: "You lost.", used: false };
  docker.pendingEvents.push("The player lost.");
  play(docker, { event: "continue" });
  assert.equal(docker.scene, null);
  assert.equal(docker.flags.tharel_taken_by_quill, true);
  assert.equal(quest(docker, WARM).status, "completed");
});

// ---- Over the real server, with no key and no AI anywhere -------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-scenes-server-"));
let child = null;
let port = 0;
let aiCalls = 0;
let standIn = null;

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
  if (type.includes("ndjson")) {
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { status: res.status, lines, text: lines.filter((line) => line.type === "text").map((line) => line.text).join(""), error: lines.find((line) => line.type === "error")?.message ?? null, done: lines.find((line) => line.type === "done")?.state ?? null };
  }
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}
const state = async () => (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json());

before(async () => {
  // Any call to the AI would land here, and there must be none.
  standIn = http.createServer((req, res) => {
    aiCalls += 1;
    res.writeHead(500);
    res.end();
  });
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  port = await freePort();
  const env = { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port), ANTHROPIC_BASE_URL: `http://127.0.0.1:${standIn.address().port}` };
  delete env.ANTHROPIC_API_KEY;
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  standIn?.close();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: with no key, a new game gets the written story, and the opening plays with no AI call", async () => {
  const settings = (await state()).settings;
  assert.equal(settings.hasKey, false);
  assert.equal(settings.story, null);
  assert.equal(settings.storyApplies, "written");

  const made = await post("/api/new", { draft: randomDraft({ seed: 42, archetype: "officer" }) });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.mode, "written");
  assert.equal(made.game.scene, null);

  const opening = await post("/api/chat", { event: "start" });
  assert.equal(opening.status, 200);
  assert.equal(opening.error, null);
  assert.match(opening.text, /@Commander Ilya Voss/);
  assert.equal(opening.done.scene.part, "bridge");
  assert.equal(opening.done.transcript.at(-1).role, "narrator");

  // Something that isn't a choice changes nothing, and the choices are still on offer.
  const wrong = await post("/api/chat", { text: "fly to the moon" });
  assert.match(wrong.error, /isn't one of the choices/);
  assert.equal(wrong.lines.at(-1).state.transcript.length, 1);

  // A choice with a check, the way the page does it: the window first, then Continue.
  const started = await post("/api/check/start", { label: "Ask what she isn't telling you" });
  assert.equal(started.status, 200, JSON.stringify(started));
  assert.equal(started.game.check.skill, "persuasion");
  const rolled = await post("/api/check", { command: "run" });
  assert.equal(rolled.over, true);
  assert.equal(rolled.game.pendingEvents, 1);
  const carried = await post("/api/chat", { event: "continue" });
  assert.equal(carried.error, null);
  assert.ok(["voss_pressed_pass", "voss_pressed_fail"].includes(carried.done.scene.part), JSON.stringify(carried.done.scene));
  assert.ok(carried.done.transcript.some((entry) => entry.role === "notice" && /\[ROLL\]/.test(entry.text)));

  const on = await post("/api/chat", { text: "go on" });
  assert.equal(on.done.scene.part, "orders");
  const over = await post("/api/chat", { text: "go and see the ship" });
  assert.equal(over.done.scene, null);
  assert.match(over.done.quests.find((quest) => quest.id === "the_beacon").objective, /Haven Station is one jump away/);

  // A story taken up from the Leads menu, the way the page sends it.
  const lead = over.done.story.here.find((one) => one.id === "crew_naomi_under_crew");
  assert.ok(lead?.written, "the written story is on offer");
  const taken = await post("/api/chat", { text: `I look into this: ${lead.title}`, thread: lead.id });
  assert.equal(taken.error, null, taken.error);
  assert.match(taken.text, /Section Fourteen will not be vented tomorrow/);
  assert.equal(taken.done.scene.part, "doorway");
  assert.ok(taken.done.story.active.some((one) => one.id === "crew_naomi_under_crew"), "the Leads menu now lists it as followed");
  assert.ok(taken.done.quests.some((quest) => quest.id === "crew_naomi_under_crew"));
  const unwritten = over.done.story.here.find((one) => !one.written);
  if (unwritten) {
    const refused = await post("/api/chat", { text: `I look into this: ${unwritten.title}`, thread: unwritten.id });
    assert.match(refused.error, /hasn't been written out yet/);
  }
  assert.equal(aiCalls, 0, "nothing went anywhere near the AI");
});

test("over the real server: a talk in a written game is the person's own written words, with nothing to type and no AI", async () => {
  const current = (await state()).game;
  const voss = current.walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss);
  const opened = await post("/api/talk", { action: "open", person: voss.key });
  assert.equal(opened.status, 200, JSON.stringify(opened));
  assert.equal(opened.game.talk.written, true);
  assert.deepEqual(opened.game.talk.asks, []);
  assert.match(opened.game.talk.lastReply, /@Commander Ilya Voss/);
  const said = await post("/api/talk", { action: "say", text: "What's our real situation, Commander?" });
  assert.equal(said.status, 200);
  assert.equal(said.error, null, said.error);
  assert.match(said.text, /Fuel for two weeks/);
  assert.equal(said.done.talk.log.at(-1).role, "narrator");
  const wrong = await post("/api/talk", { action: "say", text: "Dance for me" });
  assert.match(wrong.error, /isn't one of the things to say/);
  await post("/api/talk", { action: "close" });
  assert.equal(aiCalls, 0);
});

test("over the real server: using a thing and asking at a door come back as what happened, with no AI", async () => {
  await post("/api/talk", { action: "close" });
  const chair = (await state()).game.walk.things.find((thing) => /chair/.test(thing.name));
  const sat = await post("/api/walk", { action: "use", key: chair.id });
  assert.equal(sat.status, 200, JSON.stringify(sat));
  assert.match(sat.said, /The chair takes your weight/);
  assert.equal(sat.check, false);
  assert.ok(sat.game.transcript.some((entry) => entry.role === "notice" && /chair takes your weight/.test(entry.text)), "the story keeps a line about it");
  assert.equal(aiCalls, 0);
});

test("over the real server: choosing the AI game master in Settings applies to the next new game, and a key does the same by itself", async () => {
  const chosen = await post("/api/settings", { story: "ai" });
  assert.equal(chosen.story, "ai");
  assert.equal(chosen.storyApplies, "ai");
  const aiGame = await post("/api/new", { draft: randomDraft({ seed: 43, archetype: "officer" }) });
  assert.equal(aiGame.game.mode, "ai");
  await post("/api/save", { slot: "slot1" });
  const back = await post("/api/settings", { story: "written" });
  assert.equal(back.storyApplies, "written");
  const written = await post("/api/new", { draft: randomDraft({ seed: 44, archetype: "officer" }) });
  assert.equal(written.game.mode, "written");
  // The saved game, with its AI game master, is kept as it was.
  const loaded = await post("/api/load", { slot: "slot1" });
  assert.equal(loaded.game.mode, "ai");
});
