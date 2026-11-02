// Runs real AI turns through the real Anthropic SDK, against a small stand-in server on this computer.

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { SYSTEM_PROMPT, callCost, runTurn, stripThinking } from "../src/ai.js";
import { NOTABLES } from "../src/character-data.js";
import { checkCommand, startChoiceCheck } from "../src/checks.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { combatAction, publicState } from "../src/rules.js";
import { TOOL_DEFS } from "../src/tools.js";

const settings = { provider: "claude", model: "claude-opus-5-5", apiKey: "test-key-not-real" };
const MISMATCH = "messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation. Remove the block, or set `thinking.block_binding.prefix_mismatch_behavior` to \"drop_block\".";

let server;
let requests = [];
let replies = [];

// Each reply is { blocks: [...], stop } or { status, message }.
function respond(res, body, reply) {
  if (reply.status) {
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: reply.message } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  reply.blocks.forEach((block, index) => {
    if (block.type === "thinking") {
      send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      send("content_block_delta", { index, delta: { type: "signature_delta", signature: block.signature } });
    } else if (block.type === "text") {
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
    requests.push(JSON.parse(raw));
    respond(res, body, replies.shift() ?? { blocks: [{ type: "text", text: "Nothing more." }] });
  });
  await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  server.close();
});

beforeEach(() => {
  requests = [];
  replies = [];
});

const newGame = () => createGameFromDraft(randomDraft({ seed: 33, archetype: "officer" }));
const say = (text) => ({ blocks: [{ type: "thinking", signature: "sig-a" }, { type: "text", text }] });

function play(game, playerText = "I look around.", overrides = {}) {
  const events = [];
  const usage = [];
  const emit = (e) => (e.type === "usage" ? usage : events).push(e);
  return runTurn({ game, settings: { ...settings, ...overrides }, playerText, emit }).then((narration) => ({ narration, events, usage }));
}

const thinkingBlocks = (messages) => messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "thinking");

test("a turn reaches Claude with the character, the game state and the writing rules", async () => {
  const game = newGame();
  replies = [say("The bridge hums.")];
  const { narration } = await play(game);
  assert.equal(narration, "The bridge hums.");
  const [request] = requests;
  assert.equal(request.model, "claude-opus-5-5");
  assert.deepEqual(request.cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(request.system, SYSTEM_PROMPT);
  assert.match(request.system, /starting with @/);
  assert.match(request.system, /starting with =>/);
  assert.match(request.system, /\[persuasion:hard\]/);
  assert.ok(request.tools.some((t) => t.name === "add_lore"));
  assert.ok(request.tools.every((t) => t.eager_input_streaming === true));
  assert.equal(request.tools.length, TOOL_DEFS.length);
  const first = request.messages[0].content;
  assert.match(first, /<player_dossier>/);
  assert.match(first, /<game_state>/);
  assert.match(first, /The player writes: I look around\./);
  // A new story has no habits to correct.
  assert.doesNotMatch(first, /<format_reminder>/);
});

test("if the last reply left speech unmarked, the next message reminds Claude of the format", async () => {
  const game = newGame();
  replies = [say("One."), say("Two."), say("Three."), say("Four.")];
  game.transcript.push({ role: "narrator", text: 'Voss looks up. "So it\'s real."' });
  await play(game);
  assert.match(requests[0].messages[0].content, /<format_reminder>.*@Name:.*<\/format_reminder>/);
  // Once it's back on format, the reminder stops.
  game.transcript.push({ role: "narrator", text: '@Ilya Voss: "So it\'s real."\n\nShe looks up.' });
  await play(game, "I nod.");
  assert.doesNotMatch(requests[1].messages.at(-1).content, /<format_reminder>/);
  // A scene with nobody speaking isn't a slip.
  game.transcript.push({ role: "narrator", text: "The lift doors hiss open." });
  await play(game, "I wait.");
  assert.doesNotMatch(requests[2].messages.at(-1).content, /<format_reminder>/);
});

test("after the first message, only what changed in the game state is sent", async () => {
  const game = newGame();
  replies = [say("One."), say("Two."), say("Three."), say("Four.")];
  await play(game);
  const first = requests[0].messages[0].content;
  assert.match(first, /Attributes: /);
  assert.match(first, /Known person: /);

  await play(game, "I wait.");
  const second = requests[1].messages.at(-1).content;
  assert.match(second, /<game_state>Nothing has changed/);
  assert.doesNotMatch(second, /Attributes: /);

  game.credits += 100;
  await play(game, "I count my money.");
  const third = requests[2].messages.at(-1).content;
  assert.match(third, /Changed since your last update/);
  assert.ok(third.includes(`credits ${game.credits}`));
  assert.doesNotMatch(third, /Attributes: /);
  assert.doesNotMatch(third, /Faction standing: /);

  // One person changing doesn't send everyone again.
  const [someone, other] = game.contacts;
  someone.attitude = "hostile";
  await play(game, "I look at them.");
  const fourth = requests[3].messages.at(-1).content;
  assert.ok(fourth.includes(`Known person: ${someone.name} (hostile)`));
  assert.ok(!fourth.includes(`Known person: ${other.name}`));
});

test("the whole game state is sent again every so often", async () => {
  const game = newGame();
  const fullMessages = [];
  for (let i = 0; i < 27; i += 1) {
    replies = [say("Next.")];
    await play(game, `Turn ${i}.`);
    const sent = requests.at(-1).messages.at(-1).content;
    if (/Attributes: /.test(sent)) fullMessages.push(i);
  }
  assert.deepEqual(fullMessages, [0, 13, 26]);
});

test("local models still get the whole state every time", async () => {
  const game = newGame();
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    sent.push(JSON.parse(options.body));
    return new Response(`${JSON.stringify({ message: { role: "assistant", content: "Hello." }, done: true })}\n`);
  };
  try {
    await play(game, "One.", { provider: "ollama", model: "local" });
    await play(game, "Two.", { provider: "ollama", model: "local" });
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.length, 2);
  assert.match(sent[1].messages.at(-1).content, /Attributes: /);
});

test("a game saved before this still gets the whole state first", async () => {
  const game = newGame();
  replies = [say("One."), say("Two.")];
  await play(game);
  delete game.ai.sentState;
  delete game.ai.stateAge;
  await play(game, "I'm back.");
  assert.match(requests[1].messages.at(-1).content, /Attributes: /);
});

test("after a long break, a long story restarts from the record instead of reloading it all", async () => {
  const hours = (n) => Date.now() - n * 60 * 60 * 1000;
  const game = newGame();
  game.transcript.push({ role: "narrator", text: "Earlier, things happened." });
  game.journal.push({ turn: 1, entry: "The fleet found the Beacon." });
  replies = [say("One."), say("Two."), say("Three."), say("Four.")];
  await play(game);

  // A short story just reloads, because that costs less than restarting.
  game.ai.lastPromptTokens = 30000;
  game.ai.lastCallAt = hours(2);
  await play(game, "I'm back.");
  assert.equal(requests[1].messages.length, 3);

  // A long one within the hour is still in Claude's memory, so it carries on.
  game.ai.lastPromptTokens = 80000;
  game.ai.lastCallAt = hours(0.5);
  await play(game, "I'm back again.");
  assert.equal(requests[2].messages.length, 5);

  // A long one after the hour restarts, with everything it needs.
  game.ai.lastPromptTokens = 80000;
  game.ai.lastCallAt = hours(2);
  game.pendingEvents.push("The player won a fight.");
  await play(game, "I'm back at last.");
  const [restart] = requests[3].messages;
  assert.equal(requests[3].messages.length, 1);
  assert.match(restart.content, /<player_dossier>/);
  assert.match(restart.content, /The fleet found the Beacon\./);
  assert.match(restart.content, /Earlier, things happened\./);
  assert.match(restart.content, /Attributes: /);
  assert.match(restart.content, /<character_files>/);
  assert.match(restart.content, /The player won a fight\./);
  assert.match(restart.content, /The player writes: I'm back at last\./);
});

test("the cost of each call is worked out from what Claude reports", async () => {
  // A real call from testing: it wrote 20,377 tokens to the five-minute memory, and generated 1,305.
  const real = { input_tokens: 4, cache_creation_input_tokens: 20377, cache_read_input_tokens: 0, output_tokens: 1305 };
  assert.ok(Math.abs(callCost("claude-opus-5-5", real) - 0.128) < 0.0001);
  // The one-hour memory costs more to write to, and reading from it costs the same.
  const hourly = { ...real, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 20377 } };
  assert.ok(Math.abs(callCost("claude-opus-5-5", hourly) - 0.1892) < 0.0001);
  assert.ok(Math.abs(callCost("claude-sonnet-5-5", { cache_read_input_tokens: 1000000 }) - 0.1) < 1e-9);
  assert.ok(Math.abs(callCost("claude-haiku-5-5", { output_tokens: 1000000 }) - 0.5) < 1e-9);
  assert.equal(callCost("some-local-model", real), 0);

  const game = newGame();
  replies = [say("One.")];
  const { usage } = await play(game);
  assert.equal(usage.length, 1);
  assert.equal(usage[0].model, "claude-opus-5-5");
  assert.equal(usage[0].usage.input_tokens, 10);
  assert.equal(game.ai.lastPromptTokens, 10);
  assert.ok(Date.now() - game.ai.lastCallAt < 5000);
});

test("Claude's thinking level follows the setting", async () => {
  replies = [say("One."), say("Two.")];
  await play(newGame());
  assert.deepEqual(requests[0].output_config, { effort: "medium" });
  await play(newGame(), "I look around.", { effort: "low" });
  assert.deepEqual(requests[1].output_config, { effort: "low" });
});

test("Claude's reasoning is replayed unchanged while the instructions stay the same", async () => {
  const game = newGame();
  replies = [say("One."), say("Two.")];
  await play(game);
  await play(game, "I keep going.");
  const second = requests[1].messages;
  assert.equal(second[1].role, "assistant");
  assert.deepEqual(thinkingBlocks(second).map((b) => b.signature), ["sig-a"]);
  // The character background is only sent when a conversation begins.
  assert.doesNotMatch(second[2].content, /<player_dossier>/);
  assert.match(second[2].content, /<game_state>/);
});

test("the conversation keeps working when saved and reloaded", async () => {
  const game = newGame();
  replies = [say("One."), say("Two.")];
  await play(game);
  const reloaded = JSON.parse(JSON.stringify(game));
  await play(reloaded, "I keep going.");
  assert.deepEqual(requests[1].messages[1], requests[1].messages[1]);
  assert.deepEqual(thinkingBlocks(requests[1].messages).map((b) => b.signature), ["sig-a"]);
});

test("after a game update changes the instructions, old reasoning is removed but the story stays", async () => {
  const game = newGame();
  replies = [say("One."), say("Two.")];
  await play(game);
  game.ai.promptId = "from-an-older-version";
  await play(game, "I keep going.");
  const second = requests[1].messages;
  assert.deepEqual(thinkingBlocks(second), []);
  assert.deepEqual(second[1].content.map((b) => b.text), ["One."]);
  assert.match(second[0].content, /I look around/);
  assert.match(second[2].content, /I keep going/);
  assert.equal(requests.length, 2);
});

test("a save from before this safeguard is treated as out of date", async () => {
  const game = newGame();
  game.ai = {
    provider: "claude",
    messages: [
      { role: "user", content: "Start." },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "old" }, { type: "tool_use", id: "t1", name: "add_journal", input: { entry: "x" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "Journal updated." }] },
      { role: "assistant", content: [{ type: "text", text: "Hello." }] },
    ],
  };
  replies = [say("Continuing.")];
  await play(game);
  const sent = requests[0].messages;
  assert.deepEqual(thinkingBlocks(sent), []);
  assert.deepEqual(sent.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
  assert.equal(sent[1].content[0].type, "tool_use");
  assert.equal(sent[2].content[0].type, "tool_result");
});

test("if Claude still refuses old reasoning, the game removes it and tries once more", async () => {
  const game = newGame();
  replies = [say("One."), { status: 400, message: MISMATCH }, say("Recovered.")];
  await play(game);
  const { narration } = await play(game, "I keep going.");
  assert.equal(narration, "Recovered.");
  assert.equal(requests.length, 3);
  assert.equal(thinkingBlocks(requests[1].messages).length, 1);
  assert.deepEqual(thinkingBlocks(requests[2].messages), []);
});

test("the retry only happens once, and other errors aren't retried", async () => {
  const game = newGame();
  replies = [say("One."), { status: 400, message: MISMATCH }, { status: 400, message: MISMATCH }];
  await play(game);
  await assert.rejects(play(game, "Again."), /AI request failed|Something went wrong/);
  assert.equal(requests.length, 3);

  requests = [];
  replies = [{ status: 400, message: "Your credit balance is too low." }];
  await assert.rejects(play(newGame()), /run out of credit/);
  assert.equal(requests.length, 1);
});

test("narration and game messages stay in the order they happened", async () => {
  const game = newGame();
  replies = [
    { blocks: [{ type: "text", text: "You lean in." }, { type: "tool_use", id: "t1", name: "award_xp", input: { amount: 10, reason: "Good thinking" } }], stop: "tool_use" },
    { blocks: [{ type: "text", text: 'She nods.\n\n> [mercy] Thank her' }] },
  ];
  const { events, narration } = await play(game);
  const order = events.filter((e) => e.type !== "state").map((e) => e.type);
  assert.deepEqual(order, ["text", "notice", "text"]);
  assert.match(events.find((e) => e.type === "notice").text, /^\[XP\] \+10: Good thinking/);
  assert.match(narration, /You lean in\.\n\nShe nods\./);
  const result = requests[1].messages.at(-1).content[0];
  assert.equal(result.type, "tool_result");
  assert.match(result.content, /Awarded/);
});

test("a check the AI asks for ends its turn, and the result goes back with the next message", async () => {
  const game = newGame();
  replies = [
    { blocks: [{ type: "thinking", signature: "sig-a" }, { type: "tool_use", id: "t1", name: "roll_check", input: { skill: "stealth", difficulty: "hard", reason: "Slip past the patrol", scene: "Two guards." } }], stop: "tool_use" },
    say("You slip past."),
  ];
  await play(game);
  // The AI isn't called again until the check's over.
  assert.equal(requests.length, 1);
  assert.equal(game.check.reason, "Slip past the patrol");
  assert.equal(publicState(game).check.scene, "Two guards.");
  assert.equal(checkCommand(game, "run").over, true);
  assert.equal(game.pendingEvents.length, 1);
  await runTurn({ game, settings, gameEvent: "Continue the story from here.", emit: () => {} });
  assert.equal(requests.length, 2);
  const message = requests[1].messages.at(-1);
  assert.equal(message.content[0].type, "tool_result");
  assert.equal(message.content[0].tool_use_id, "t1");
  const text = message.content.at(-1).text;
  assert.match(text, /The check you asked for is done: Slip past the patrol/);
  assert.match(text, /Rolled \d+/);
  assert.equal(game.pendingEvents.length, 0);
});

test("a choice tagged with a check plays out first, so the AI is only called once, with the result", async () => {
  const game = newGame();
  game.transcript.push({ role: "narrator", text: "The server waits.\n\n> [hacking:hard] Slice into the manifest\n> Walk away" });
  assert.ok(startChoiceCheck(game, "Slice into the manifest"));
  assert.equal(requests.length, 0);
  assert.equal(game.check.skill, "hacking");
  assert.equal(game.check.difficulty, "hard");
  checkCommand(game, "run");
  replies = [say("You're in.")];
  await runTurn({ game, settings, gameEvent: "Continue the story from here.", emit: () => {} });
  assert.equal(requests.length, 1);
  const { content } = requests[0].messages.at(-1);
  assert.match(content, /took this choice from your last message: > \[hacking:hard\] Slice into the manifest/);
  assert.match(content, /don't call roll_check/);
});

test("a choice without a difficulty, or one that isn't on offer, doesn't open a window", () => {
  const game = newGame();
  game.transcript.push({ role: "narrator", text: "> [hacking] Have a look\n> Walk away" });
  assert.equal(startChoiceCheck(game, "Have a look"), null);
  assert.equal(startChoiceCheck(game, "Walk away"), null);
  assert.equal(startChoiceCheck(game, "Steal the fleet"), null);
  assert.equal(game.check ?? null, null);
});

const startFight = (enemy = "dock_thug") => ({
  blocks: [{ type: "thinking", signature: "sig-a" }, { type: "tool_use", id: "t1", name: "start_combat", input: { enemy, lead_in: "A thug lunges." } }],
  stop: "tool_use",
});

function winFight(game) {
  game.combat.enemies[0].hp = 1;
  let outcome;
  do {
    game.hp = 100;
    outcome = combatAction(game, { type: "attack" });
  } while (!outcome.over);
  return outcome;
}

test("starting a fight ends the AI's turn, and the whole fight costs no calls", async () => {
  const game = newGame();
  replies = [startFight()];
  const { narration, events } = await play(game, "I fight him.");
  assert.equal(narration, "A thug lunges.");
  assert.ok(game.combat);
  assert.equal(requests.length, 1);
  // The lead-in comes from the tool, so it reaches the player even when text before a tool call doesn't.
  const order = events.filter((e) => e.type !== "state");
  assert.deepEqual(order.map((e) => e.type), ["text", "notice"]);
  assert.equal(order[0].text, "A thug lunges.");
  assert.match(order[1].text, /^\[COMBAT\]/);
  winFight(game);
  assert.equal(requests.length, 1);
});

test("a fight's lead-in stays separate from anything written before it", async () => {
  const game = newGame();
  replies = [{
    blocks: [{ type: "text", text: "The corridor narrows." }, { type: "tool_use", id: "t1", name: "start_combat", input: { enemy: "dock_thug", lead_in: "A thug lunges." } }],
    stop: "tool_use",
  }];
  const { narration } = await play(game, "I fight him.");
  assert.equal(narration, "The corridor narrows.\n\nA thug lunges.");
});

test("a fight's lead-in reads before the results of anything else in that reply", async () => {
  const game = newGame();
  replies = [{
    blocks: [
      { type: "tool_use", id: "t1", name: "add_journal", input: { entry: "Shots fired." } },
      { type: "tool_use", id: "t2", name: "change_stress", input: { amount: 3, reason: "Nerves" } },
      { type: "tool_use", id: "t3", name: "start_combat", input: { enemy: "dock_thug", lead_in: "A thug lunges." } },
    ],
    stop: "tool_use",
  }];
  const { events } = await play(game, "I fight him.");
  const order = events.filter((e) => e.type !== "state");
  assert.deepEqual(order.map((e) => e.type), ["text", "notice", "notice"]);
  assert.equal(order[0].text, "A thug lunges.");
  assert.match(order[1].text, /^\[STRESS\]/);
  assert.match(order[2].text, /^\[COMBAT\] The fight begins: Dock Thug/);
  // Every tool still gets its result back, in order.
  const next = game.ai.messages.at(-1).content;
  assert.deepEqual(next.map((block) => block.tool_use_id), ["t1", "t2", "t3"]);
});

test("a fight can't start without a lead-in", async () => {
  const game = newGame();
  replies = [{ blocks: [{ type: "tool_use", id: "t1", name: "start_combat", input: { enemy: "dock_thug" } }], stop: "tool_use" }, say("Fine.")];
  await play(game, "I fight him.");
  assert.equal(game.combat, null);
  assert.equal(requests[1].messages.at(-1).content[0].is_error, true);
});

test("a choice the AI offered goes back with its tags, so it can do what they promised", async () => {
  const game = newGame();
  replies = [say('She waits.\n\n> [persuasion:hard] [mercy] [-Tarrow] Talk them into surrendering\n> Walk away'), say("Well."), say("Well again.")];
  const { narration } = await play(game);
  // The server keeps this record of the story.
  game.transcript.push({ role: "narrator", text: narration });
  await play(game, "Talk them into surrendering");
  assert.match(requests[1].messages.at(-1).content, /takes this choice from your last message: > \[persuasion:hard\] \[mercy\] \[-Tarrow\] Talk them into surrendering/);
  assert.doesNotMatch(requests[1].messages.at(-1).content, /The player writes:/);
  await play(game, "I do something else entirely.");
  assert.match(requests[2].messages.at(-1).content, /The player writes: I do something else entirely\./);
});

test("the AI hears how the fight went with the player's next message, once", async () => {
  const game = newGame();
  replies = [startFight(), say("You catch your breath."), say("Onward.")];
  await play(game, "I fight him.");
  winFight(game);
  assert.equal(game.pendingEvents.length, 1);

  const { narration } = await play(game, "I search him.");
  assert.equal(narration, "You catch your breath.");
  assert.deepEqual(game.pendingEvents, []);
  const sent = requests[1].messages;
  // The result of start_combat and the new message are one turn, with the result first, as the API requires.
  assert.deepEqual(sent.map((m) => m.role), ["user", "assistant", "user"]);
  const [result, words] = sent[2].content;
  assert.equal(result.type, "tool_result");
  assert.equal(result.tool_use_id, "t1");
  assert.equal(words.type, "text");
  assert.match(words.text, /<game_state>/);
  assert.match(words.text, /\[Game event, not written by the player\] The player won the fight/);
  assert.match(words.text, /The player writes: I search him\./);
  assert.deepEqual(thinkingBlocks(sent).map((b) => b.signature), ["sig-a"]);

  await play(game, "I keep going.");
  assert.doesNotMatch(requests[2].messages.at(-1).content, /won the fight/);
});

test("a failed start_combat lets the AI try again in the same turn", async () => {
  const game = newGame();
  replies = [startFight("invented_monster"), startFight("dock_thug")];
  await play(game, "I fight him.");
  assert.equal(requests.length, 2);
  assert.equal(requests[1].messages.at(-1).content[0].is_error, true);
  assert.ok(game.combat);
});

test("the people in play are sent to the AI once, with their secrets", async () => {
  const game = newGame();
  replies = [say("Tarrow glares."), say("Quiet."), say("Quiet again.")];
  await play(game, "I ask Quill about Halm.");
  const first = requests[0].messages[0].content;
  assert.match(first, /<character_files>/);
  for (const id of ["voss", "marrow", "aduro", "tarrow", "pell", "quill"]) assert.ok(first.includes(NOTABLES[id].secrets), id);
  await play(game, "I say nothing.");
  assert.doesNotMatch(requests[1].messages.at(-1).content, /<character_files>/);
  assert.equal(requests[1].system, requests[0].system);
  assert.deepEqual(requests[1].tools, requests[0].tools);
  await play(game, "I go find Halm.");
  assert.ok(requests[2].messages.at(-1).content.includes(NOTABLES.halm.secrets));
});

test("stripping reasoning leaves everything else alone, and drops messages left empty", () => {
  const messages = [
    { role: "user", content: "Hi" },
    { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "a" }] },
    { role: "user", content: "Again" },
    { role: "assistant", content: [{ type: "redacted_thinking", data: "x" }, { type: "text", text: "Hello" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
  ];
  assert.deepEqual(stripThinking(messages), [
    { role: "user", content: "Hi" },
    { role: "user", content: "Again" },
    { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
  ]);
});

test("switching AI starts a fresh conversation with the character and a recap", async () => {
  const game = newGame();
  game.transcript.push({ role: "narrator", text: "Earlier, things happened." });
  game.lore.push({ id: "custom:0", name: "The Rim", kind: "place", text: "The edge of the map." });
  game.ai = { provider: "ollama", messages: [{ role: "user", content: "Old" }, { role: "assistant", content: "Local reply" }] };
  replies = [say("Back on Claude.")];
  await play(game);
  const sent = requests[0].messages;
  assert.equal(sent.length, 1);
  assert.match(sent[0].content, /<player_dossier>/);
  assert.match(sent[0].content, /Earlier, things happened\./);
  assert.match(sent[0].content, /The Rim: The edge of the map\./);
});
