// The AI as the layer on top of the written story. In a game with an AI game master, the written parts still play
// themselves, for free, clicking a choice costs nothing, and only the player's own words go to the AI, which fits
// them to a written choice or answers them in a few words. None of this calls a real AI: Claude is a small stand-in
// server on this computer, and the game is told to talk to it.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ai-layer-"));
process.env.GAME_DATA_DIR = dataDir;

// ---- A stand-in for Claude -----------------------------------------------------------

let standIn;
let requests = [];
let replies = [];

// Each reply is { blocks: [...], stop }, in the shape Anthropic streams.
function respond(res, body, reply) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  reply.blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: block.id ?? `tool_${index}`, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: reply.stop ?? (reply.blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn"), stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", {});
  res.end();
}

const says = (text) => ({ blocks: [{ type: "text", text }] });
const follows = (choice, text = null) => ({ blocks: [...(text ? [{ type: "text", text }] : []), { type: "tool_use", name: "follow_scene", input: { choice } }] });
const lastMessage = (request) => {
  const content = request.messages.at(-1).content;
  return typeof content === "string" ? content : content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
};

before(async () => {
  standIn = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    respond(res, body, replies.shift() ?? says("Nothing more."));
  });
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${standIn.address().port}`;
});

beforeEach(() => {
  requests = [];
  replies = [];
});

const { SYSTEM_PROMPT, runTurn } = await import("../src/ai.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { projectDir } = await import("../src/paths.js");
const { publicState } = await import("../src/rules.js");
const { parseSceneText } = await import("../src/scene-text.js");
const { followChoice, loadScenes, openingSceneId, partText, sceneBrief, storyTurnKind, withoutChoices, writtenTurn } = await import("../src/scenes.js");
const { openWrittenTalk, talkSceneBrief, talkTurnKind } = await import("../src/talks.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { talkCommand, talkView } = await import("../src/walk.js");

const settings = { provider: "claude", model: "claude-opus-5-5", apiKey: "test-key-not-real" };
const WORLD = loadScenes();

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.mode = "ai";
  return game;
};

// Plays one written turn the way the server does, with what the story said going in the transcript afterwards.
function play(game, args) {
  const pieces = [];
  const emit = (e) => {
    if (e.type === "state") return;
    const last = pieces.at(-1);
    if (e.type === "text" && last?.role === "narrator") last.text += e.text;
    else pieces.push({ role: e.type === "text" ? "narrator" : "notice", text: e.text });
  };
  writtenTurn({ game, emit, log: (role, text) => game.transcript.push({ role, text }), ...args });
  for (const piece of pieces) game.transcript.push(piece);
  return pieces;
}

function aiTurn(game, args) {
  const events = [];
  return runTurn({ game, settings, emit: (e) => events.push(e), ...args }).then((narration) => ({ narration, events }));
}

// ---- The pieces ----------------------------------------------------------------------

test("an AI: line is a note for the AI alone: kept with the part, and never in what the player reads", () => {
  const { scene, problems } = parseSceneText(`== start\nSable names a price.\nAI: Sable won't go below forty.\nAI: A threat makes her stop talking.\n> Pay -> paid\n== paid\nDone.\nEND`);
  assert.deepEqual(problems, []);
  assert.equal(scene.parts.start.ai, "Sable won't go below forty. A threat makes her stop talking.");
  assert.doesNotMatch(partText(scene.parts.start), /forty/);
  assert.equal(scene.parts.paid.ai, undefined);
});

test("with an AI game master, a life's own written opening plays, and a life without one gets the AI's", () => {
  assert.equal(openingSceneId(newGame("captain"), WORLD.scenes), "opening_captain");
  assert.equal(openingSceneId(newGame("engine_hand"), WORLD.scenes), "opening_engine_hand");
  assert.equal(openingSceneId(newGame("miner"), WORLD.scenes), null, "the plain opening is for games with no AI");
  const written = newGame("miner");
  written.mode = "written";
  assert.equal(openingSceneId(written, WORLD.scenes), "opening");
});

test("who answers a turn with an AI: the written story where it's written, the AI by itself elsewhere, and the AI fitting the player's words in between", () => {
  const game = newGame();
  assert.equal(storyTurnKind(game, { event: "start" }), "written");
  assert.equal(storyTurnKind(newGame("miner"), { event: "start" }), "ai");
  assert.equal(storyTurnKind(game, { playerText: "I look around" }), "ai", "no written part is under way yet");
  play(game, { event: "start" });
  assert.equal(game.scene.part, "bridge");
  assert.equal(storyTurnKind(game, { playerText: "Say nothing, and listen to it" }), "written");
  assert.equal(storyTurnKind(game, { playerText: "say nothing" }), "written", "typing part of a choice is still the choice");
  assert.equal(storyTurnKind(game, { playerText: "I pour myself a coffee and wait" }), "fit");
  assert.equal(storyTurnKind(game, { event: "continue" }), "written");
  assert.equal(storyTurnKind(game, { playerText: "I look into this", threadId: "crew_naomi_under_crew" }), "written");
  assert.equal(storyTurnKind(game, { playerText: "I look into this", threadId: "main_the_walkouts" }), "ai");
  // Arriving somewhere with a written arrival is the written story's, and anywhere else the AI tells it.
  const arrived = newGame();
  arrived.arrived = "haven";
  assert.equal(storyTurnKind(arrived, { event: "continue" }), "written");
  arrived.arrived = "harbor";
  assert.equal(storyTurnKind(arrived, { event: "continue" }), "ai");
  // Without an AI, it's always the written story.
  const written = newGame("miner");
  written.mode = "written";
  assert.equal(storyTurnKind(written, { playerText: "I pour myself a coffee" }), "written");
});

test("follow_scene is the one tool that works in a written part, and it works only there", () => {
  const game = newGame();
  const outside = runTool(game, "follow_scene", { choice: 1 }, newTurnLimits());
  assert.equal(outside.isError, true);
  assert.match(outside.result, /no written scene/);
  const brief = { title: "A test", talk: false, text: "Sable names a price.", notes: null, choices: [{ say: "Pay", to: "paid" }, { say: "Haggle", to: "haggled" }], followed: undefined };
  const turn = { ...newTurnLimits(), scene: brief };
  const tooMany = runTool(game, "follow_scene", { choice: 3 }, turn);
  assert.equal(tooMany.isError, true);
  assert.match(tooMany.result, /numbered 1 to 2/);
  assert.equal(brief.followed, undefined);
  const picked = runTool(game, "follow_scene", { choice: 2 }, turn);
  assert.equal(picked.isError, undefined);
  assert.match(picked.result, /takes choice 2, Haggle/);
  assert.equal(brief.followed, 2);
  const none = runTool(game, "follow_scene", { choice: 0 }, turn);
  assert.match(none.result, /nothing moves on/);
  assert.equal(brief.followed, 0);
  // Nothing else can change the game from a written part.
  const journal = game.journal.length;
  const refused = runTool(game, "add_journal", { entry: "Something the AI made up." }, turn);
  assert.equal(refused.isError, true);
  assert.match(refused.result, /written in advance/);
  assert.equal(game.journal.length, journal);
  const credits = game.credits;
  assert.equal(runTool(game, "change_credits", { amount: 500, reason: "a gift" }, turn).isError, true);
  assert.equal(game.credits, credits);
});

test("the AI is given the written part by number, and its reply ends as soon as it has fitted the player's words", async () => {
  const game = newGame();
  play(game, { event: "start" });
  const brief = sceneBrief(game);
  assert.equal(brief.title, "A Light on Every Band");
  assert.equal(brief.choices.length, 4);
  assert.doesNotMatch(brief.text, /^>/m, "the choice lines are given by number instead");
  assert.match(brief.text, /@Commander Ilya Voss/);

  replies.push(follows(2, "Voss's mouth tightens."));
  const { narration } = await aiTurn(game, { playerText: "I tell her to spit it out", scene: brief });
  assert.equal(narration, "Voss's mouth tightens.");
  assert.equal(requests.length, 1, "one call, not a second round after the tool");
  assert.equal(brief.followed, 2);
  const message = lastMessage(requests[0]);
  assert.match(message, /<written_scene title="A Light on Every Band">/);
  assert.match(message, /1\. \[\+Voss\] Ask her what she'd do/);
  assert.match(message, /2\. \[persuasion:moderate:voss\] Ask what she isn't telling you/);
  assert.match(message, /4\. Say nothing, and listen to it/);
  assert.match(message, /The player writes: I tell her to spit it out/);
  assert.ok(requests[0].tools.some((tool) => tool.name === "follow_scene"));
  assert.equal(requests[0].tools.length, TOOL_DEFS.length);

  // Nothing fits: the AI says so with 0, and then owes the player an answer, so it's asked again once.
  const again = sceneBrief(game);
  replies.push(follows(0), says("Voss doesn't look up from the plot."));
  const second = await aiTurn(game, { playerText: "I pour myself a coffee", scene: again });
  assert.equal(second.narration, "Voss doesn't look up from the plot.");
  assert.equal(requests.length, 3);
  assert.equal(again.followed, 0);
  const result = requests[2].messages.at(-1).content.find((block) => block.type === "tool_result");
  assert.match(result.content, /nothing moves on/);

  // Another tool in the same breath is refused, and the game is as it was.
  const third = sceneBrief(game);
  const journal = game.journal.length;
  replies.push({ blocks: [{ type: "tool_use", id: "a", name: "add_journal", input: { entry: "Made up." } }, { type: "tool_use", id: "b", name: "follow_scene", input: { choice: 0 } }] }, says("She waits."));
  await aiTurn(game, { playerText: "I write in my journal", scene: third });
  assert.equal(game.journal.length, journal);
  const results = requests[4].messages.at(-1).content.filter((block) => block.type === "tool_result");
  assert.equal(results.find((block) => block.tool_use_id === "a").is_error, true);
  assert.equal(results.find((block) => block.tool_use_id === "b").is_error, undefined);
});

test("a fitted choice plays as if it had been clicked: a plain one moves the story on, and one with a check opens the check", () => {
  const game = newGame();
  play(game, { event: "start" });
  const brief = sceneBrief(game);
  const emit = () => {};
  followChoice(game, brief.choices[3], { emit });
  assert.equal(game.scene.part, "listen");
  const back = newGame();
  play(back, { event: "start" });
  // The player's own words are already in the story, after the choices, and the check still opens.
  back.transcript.push({ role: "player", text: "I tell her to spit it out" });
  followChoice(back, sceneBrief(back).choices[1], { emit });
  assert.equal(back.check.skill, "persuasion");
  checkCommand(back, "run");
  play(back, { event: "continue" });
  assert.ok(["voss_pressed_pass", "voss_pressed_fail"].includes(back.scene.part), back.scene.part);
});

test("what the written story played goes to the AI once, in its next message, and then it's forgotten", async () => {
  const game = newGame();
  game.ai.written = ["The player: go on\nThe bridge hums, and Voss says nothing."];
  replies.push(says("The galley is quiet."));
  await aiTurn(game, { playerText: "I walk to the galley" });
  const message = lastMessage(requests[0]);
  assert.match(message, /<written_story>/);
  assert.match(message, /The bridge hums, and Voss says nothing\./);
  assert.match(message, /go on from the end of them without retelling them/);
  assert.deepEqual(game.ai.written, []);
  replies.push(says("Still quiet."));
  await aiTurn(game, { playerText: "I sit down" });
  assert.doesNotMatch(lastMessage(requests[1]), /<written_story>/);
});

test("in a written conversation with an AI, the lines are the file's, the player's own words are fitted, and anyone without a file is the AI's", () => {
  const game = newGame();
  play(game, { event: "start" });
  const voss = publicState(game).walk.people.find((one) => /Voss/.test(one.name));
  talkCommand(game, { action: "open", person: voss.key });
  assert.equal(openWrittenTalk(game, { filesOnly: true }), true);
  const view = talkView(game);
  assert.equal(view.written, true);
  assert.equal(view.typed, true, "with an AI there's a line to type on");
  assert.deepEqual(view.asks, [], "the lines to say are the file's own");
  assert.match(view.lastReply, /@Commander Ilya Voss/);
  assert.equal(talkTurnKind(game, "What's our real situation, Commander?"), "written");
  assert.equal(talkTurnKind(game, "Do you trust Pell?"), "fit");
  // Filler words never make a match: with an AI, a wrong free match would play a line the player didn't mean.
  assert.equal(talkTurnKind(game, "Do you believe that?"), "fit");
  assert.equal(talkTurnKind(game, "How did you get out?"), "written", "the real words of a line still find it");
  const brief = talkSceneBrief(game);
  assert.equal(brief.talk, true);
  assert.equal(brief.choices.length, 4);
  assert.match(brief.text, /Go on/);
  assert.doesNotMatch(brief.text, /^>/m);
  talkCommand(game, { action: "close" });
  // Someone with no conversation of their own: nothing written speaks, and the AI plays them.
  const other = publicState(game).walk.people.find((one) => !/Voss|Sorel|Pell|Vey/.test(one.name));
  if (other) {
    talkCommand(game, { action: "open", person: other.key });
    assert.equal(openWrittenTalk(game, { filesOnly: true }), false);
    assert.equal(talkView(game).written, false);
    assert.equal(talkTurnKind(game, "Hello"), "ai");
    talkCommand(game, { action: "close" });
  }
  // Without an AI, everyone speaks from a file or from stock lines, with nothing to type.
  game.mode = "written";
  talkCommand(game, { action: "open", person: voss.key });
  assert.equal(openWrittenTalk(game), true);
  assert.equal(talkView(game).typed, false);
});

test("the AI's instructions explain the written story, and choice lines come out of text that gives them another way", () => {
  assert.match(SYSTEM_PROMPT, /THE WRITTEN STORY/);
  assert.match(SYSTEM_PROMPT, /<written_scene> block/);
  assert.match(SYSTEM_PROMPT, /<written_story> block/);
  assert.match(SYSTEM_PROMPT, /every tool but follow_scene is refused/);
  assert.ok(TOOL_DEFS.some((tool) => tool.name === "follow_scene"));
  assert.equal(withoutChoices("Voss waits.\n\n> Pay\n> Leave\n\nShe taps the plot."), "Voss waits.\n\nShe taps the plot.");
  assert.equal(withoutChoices("> Pay\n> Leave"), "");
});

// ---- Over the real server ------------------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-ai-layer-server-"));
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
  if (type.includes("ndjson")) {
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    return { status: res.status, lines, text: lines.filter((line) => line.type === "text").map((line) => line.text).join(""), error: lines.find((line) => line.type === "error")?.message ?? null, done: lines.find((line) => line.type === "done")?.state ?? null, spending: lines.find((line) => line.type === "done")?.spending ?? null };
  }
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}
const state = async () => (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json());
const choiceLines = (text) => text.split("\n").filter((line) => line.trim().startsWith(">"));

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  port = await freePort();
  const env = { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) };
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
  delete process.env.ANTHROPIC_BASE_URL;
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server, with an AI: the written opening plays with no AI call, a clicked choice is free, and only the player's own words go to the AI", async () => {
  const settings = await post("/api/settings", { apiKey: "test-key-not-real" });
  assert.equal(settings.hasKey, true);
  assert.equal(settings.storyApplies, "ai", "a key means the AI game master, unless the player chooses otherwise");
  const made = await post("/api/new", { draft: randomDraft({ seed: 42, archetype: "officer" }) });
  assert.equal(made.status, 200, JSON.stringify(made));
  assert.equal(made.game.mode, "ai");

  const opening = await post("/api/chat", { event: "start" });
  assert.equal(opening.error, null, opening.error);
  assert.match(opening.text, /@Commander Ilya Voss/);
  assert.equal(opening.done.scene.part, "bridge");
  assert.equal(requests.length, 0, "the written opening went nowhere near the AI");
  assert.equal(opening.spending.lastTurn, 0);

  // Typing something that isn't a choice: the AI reads the part and answers, and the choices come back.
  replies.push(follows(0, "Voss doesn't look up from the plot."));
  const aside = await post("/api/chat", { text: "I pour myself a coffee and wait" });
  assert.equal(aside.error, null, aside.error);
  assert.equal(requests.length, 1);
  assert.match(aside.text, /Voss doesn't look up from the plot\./);
  assert.equal(choiceLines(aside.text).length, 4, "the written choices are offered again under the AI's words");
  assert.equal(aside.done.scene.part, "bridge", "nothing moved on");
  assert.match(lastMessage(requests[0]), /<written_scene title="A Light on Every Band">/);
  assert.match(lastMessage(requests[0]), /The player writes: I pour myself a coffee and wait/);
  assert.match(lastMessage(requests[0]), /<player_dossier>/, "the first call still opens the AI's conversation properly");
  assert.match(lastMessage(requests[0]), /<written_story>/, "and it's told what the opening said");
  assert.match(lastMessage(requests[0]), /Your orders/);
  const entries = aside.done.transcript;
  assert.equal(entries.at(-2).role, "player");
  assert.equal(entries.at(-2).text, "I pour myself a coffee and wait");
  assert.equal(entries.at(-1).role, "narrator");
  assert.ok(aside.spending.lastTurn > 0, "the player's own words cost one call");

  // Words that mean a choice with a check: the check's window opens, and the story says how the words were taken.
  replies.push(follows(2, "Voss's mouth tightens."));
  const pressed = await post("/api/chat", { text: "I tell her to spit out whatever she's holding back" });
  assert.equal(pressed.error, null, pressed.error);
  assert.equal(requests.length, 2);
  assert.match(pressed.text, /Voss's mouth tightens\./);
  assert.equal(choiceLines(pressed.text).length, 0);
  assert.ok(pressed.done.transcript.some((entry) => entry.role === "notice" && entry.text === "[STORY] Taken as: Ask what she isn't telling you"));
  assert.equal(pressed.done.check.skill, "persuasion");
  const rolled = await post("/api/check", { command: "run" });
  assert.equal(rolled.over, true);
  const carried = await post("/api/chat", { event: "continue" });
  assert.equal(carried.error, null, carried.error);
  assert.ok(["voss_pressed_pass", "voss_pressed_fail"].includes(carried.done.scene.part), JSON.stringify(carried.done.scene));
  assert.equal(requests.length, 2, "carrying on in a written part is the written story's");

  // A choice clicked, which the page sends word for word, is free.
  const on = await post("/api/chat", { text: "Go on" });
  assert.equal(on.error, null, on.error);
  assert.equal(on.done.scene.part, "orders");
  assert.equal(on.spending.lastTurn, 0);
  const over = await post("/api/chat", { text: "Go and see the ship" });
  assert.equal(over.error, null, over.error);
  assert.equal(over.done.scene, null, "the opening is over");
  assert.equal(requests.length, 2);

  // With no written part under way, the AI writes as it always has, and it's told what the written story played.
  replies.push(says("The galley is quiet at this hour.\n\n> Sit down\n> Go back to the bridge"));
  const galley = await post("/api/chat", { text: "I walk to the galley" });
  assert.equal(galley.error, null, galley.error);
  assert.equal(requests.length, 3);
  assert.match(galley.text, /The galley is quiet/);
  const told = lastMessage(requests[2]);
  assert.match(told, /<written_story>/);
  assert.match(told, /Haven Station is one jump/, "the parts played since the AI last wrote are in it");
  assert.match(told, /The player: Go and see the ship/);
  assert.doesNotMatch(told, /Your orders/, "and the opening isn't told twice");
  assert.doesNotMatch(told, /<written_scene/);
  assert.doesNotMatch(told, /^> /m, "the choices aren't");
  replies.push(says("Nobody's about."));
  await post("/api/chat", { text: "I look around" });
  assert.doesNotMatch(lastMessage(requests[3]), /<written_story>/, "it was told once");
});

test("over the real server, with an AI: a written conversation speaks first and its lines are free, and the player's own words are answered in the person's voice", async () => {
  const current = (await state()).game;
  const voss = current.walk.people.find((one) => /Voss/.test(one.name));
  assert.ok(voss, "Voss is on the bridge");
  const calls = requests.length;
  const opened = await post("/api/talk", { action: "open", person: voss.key });
  assert.equal(opened.status, 200, JSON.stringify(opened));
  assert.equal(opened.game.talk.written, true);
  assert.equal(opened.game.talk.typed, true);
  assert.deepEqual(opened.game.talk.asks, []);
  assert.match(opened.game.talk.lastReply, /@Commander Ilya Voss: "Captain\."/);
  assert.equal(requests.length, calls, "she spoke from her file");

  const written = await post("/api/talk", { action: "say", text: "What's our real situation, Commander?" });
  assert.equal(written.error, null, written.error);
  assert.match(written.text, /Fuel for two weeks/);
  assert.equal(requests.length, calls);
  assert.equal(written.spending.lastTurn, 0);

  replies.push(follows(0, '@Commander Ilya Voss: "Pell flies. That\'s what I need from him."'));
  const own = await post("/api/talk", { action: "say", text: "Do you trust Pell?" });
  assert.equal(own.error, null, own.error);
  assert.equal(requests.length, calls + 1);
  assert.match(own.text, /Pell flies/);
  assert.ok(choiceLines(own.text).length >= 3, "her written lines are offered again");
  assert.equal(own.done.talk.log.at(-1).role, "narrator");
  const message = lastMessage(requests.at(-1));
  assert.match(message, /<written_scene title="Talking with Commander Voss">/);
  assert.match(message, /<talk with="Commander Ilya Voss"/);
  assert.match(message, /written in advance/);
  assert.match(message, /The written lines the player can say, by number:/);
  assert.match(message, /<written_story>/, "the AI is told what she said first, and what was said in writing since");
  assert.match(message, /In a talk with Commander Ilya Voss/);

  // Words that come to one of her lines: her written answer follows.
  const lines = choiceLines(own.text).map((line) => line.replace(/^>\s*/, "").trim());
  const goodbye = lines.findIndex((line) => /all for now/.test(line)) + 1;
  assert.ok(goodbye > 0, lines.join(" | "));
  replies.push(follows(goodbye));
  const done = await post("/api/talk", { action: "say", text: "Thank you, Commander, that will do" });
  assert.equal(done.error, null, done.error);
  assert.equal(requests.length, calls + 2);
  assert.match(done.text, /@Commander Ilya Voss/);
  assert.ok(!done.done.transcript.some((entry) => /Taken as: That's all for now/.test(entry.text)), "a talk doesn't put that in the story");
  await post("/api/talk", { action: "close" });
});

test("over the real server, with an AI: a thing with a written result is free, a written story from the Leads menu plays itself, and an unwritten one is the AI's", async () => {
  await post("/api/talk", { action: "close" });
  const calls = requests.length;
  const things = (await state()).game.walk.things;
  const chair = things.find((thing) => /chair/.test(thing.name));
  assert.equal(chair.written, true, "the page is told it's free");
  const sat = await post("/api/walk", { action: "use", key: chair.id });
  assert.match(sat.said, /The chair takes your weight/);
  assert.equal(requests.length, calls);
  assert.ok(things.every((thing) => typeof thing.written === "boolean"));

  const here = (await state()).game.story.here;
  assert.ok(here.every((lead) => typeof lead.written === "boolean"), "the Leads menu knows which stories are written");
  const taken = await post("/api/chat", { text: "I look into this: The Downstairs Crew", thread: "crew_naomi_under_crew" });
  assert.equal(taken.error, null, taken.error);
  assert.match(taken.text, /Section Fourteen will not be vented tomorrow/);
  assert.equal(taken.done.scene.part, "doorway");
  assert.equal(requests.length, calls, "a written story plays itself");

  const unwritten = here.find((one) => !one.written);
  if (unwritten) {
    // Someone else's story first: the written one under way has to be left, and the AI takes the unwritten one as it always has.
    replies.push(says("The lead takes you below.\n\n> Follow it\n> Leave it"));
    const theirs = await post("/api/chat", { text: `I look into this: ${unwritten.title}`, thread: unwritten.id });
    assert.equal(theirs.error, null, theirs.error);
    assert.equal(requests.length, calls + 1);
    assert.match(lastMessage(requests.at(-1)), /<story_thread id="/);
    assert.equal(theirs.done.scene, null, "the written story that was under way is left");
  }
});

test("over the real server, with an AI: a life without a written opening of its own gets the AI's", async () => {
  const draft = randomDraft({ seed: 45, archetype: "officer" });
  draft.start = "miner";
  const made = await post("/api/new", { draft });
  assert.equal(made.status, 200, JSON.stringify(made));
  const calls = requests.length;
  replies.push(says("You wake in the dark of a hold that isn't yours.\n\n> Get up\n> Lie still"));
  const opening = await post("/api/chat", { event: "start" });
  assert.equal(opening.error, null, opening.error);
  assert.equal(requests.length, calls + 1);
  assert.match(opening.text, /You wake in the dark/);
  assert.equal(opening.done.scene, null);
  assert.doesNotMatch(lastMessage(requests.at(-1)), /<written_story>/);
});
