// The systems played together over the real server, the way a player would: the written story, using things, working
// the place's parts and their checks with the clock running, computers, picking pockets and a fight, the alarm, midnight
// with a check open, handing the game to the AI and back, a jump to Haven, and a life that isn't the captain's. What
// must always hold is looked at after every step: never a check and a fight at once, never a computer with either,
// credits and health that are numbers and not below nothing, standing within -100 to 100, a clock that never goes back,
// nobody in a room twice, and every line of the story a line of text. The AI is a stand-in that costs nothing.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-together-"));
const { randomDraft } = await import("../src/creator.js");
const { projectDir } = await import("../src/paths.js");

// The stand-in AI tells a little and offers two choices, and keeps what it was sent.
const asked = [];
const standIn = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  asked.push(body);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  send("content_block_delta", { index: 0, delta: { type: "text_delta", text: "The deck hums. Someone laughs two rooms away.\n\n> 1. Walk on\n> 2. Wait and listen" } });
  send("content_block_stop", { index: 0 });
  send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", {});
  res.end();
});

let server;
let address;
before(async () => {
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-together-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key", story: "written" }));
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  address = `http://127.0.0.1:${port}`;
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port), ANTHROPIC_BASE_URL: `http://127.0.0.1:${standIn.address().port}` };
  delete env.ANTHROPIC_API_KEY;
  server = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    server.on("exit", () => reject(new Error("The server stopped.")));
  });
});
after(() => {
  server?.kill();
  standIn.close();
});

// ---- Playing ------------------------------------------------------------------------------------

const problems = [];
const problem = (where, what) => problems.push(`${where}: ${what}`);

async function call(route, body = {}) {
  const res = await fetch(address + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if ((res.headers.get("content-type") ?? "").includes("ndjson")) {
    const lines = (await res.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const error = lines.find((line) => line.type === "error")?.message ?? null;
    if (error && /Unexpected error|TypeError|ReferenceError|Cannot read|is not a function/.test(error)) problem(route, error);
    return { status: res.status, error };
  }
  const reply = { status: res.status, ...(await res.json()) };
  if (reply.status >= 500) problem(`${route} ${JSON.stringify(body).slice(0, 80)}`, reply.error);
  return reply;
}
const state = async () => (await (await fetch(`${address}/api/state`)).json()).game;
const tick = async (times) => {
  for (let i = 0; i < times; i += 1) await call("/api/tick", { ms: 2000, rate: 300 });
};

let lastHours = -Infinity;
async function holds(where) {
  const g = await state();
  if (g.check && g.combat) problem(where, "a check and a fight at once");
  if (g.computer && (g.check || g.combat)) problem(where, "a computer open with a check or a fight");
  if (!Number.isFinite(g.credits) || g.credits < 0) problem(where, `credits are ${g.credits}`);
  if (!Number.isFinite(g.hp) || g.hp < 0) problem(where, `health is ${g.hp}`);
  if (g.clock.hours + 1e-6 < lastHours) problem(where, `the clock went back from ${lastHours} to ${g.clock.hours}`);
  lastHours = g.clock.hours;
  for (const one of g.factions) if (!Number.isFinite(one.value) || one.value < -100 || one.value > 100) problem(where, `standing with ${one.id} is ${one.value}`);
  const keys = new Set();
  for (const person of g.walk?.people ?? []) {
    if (keys.has(person.key)) problem(where, `${person.key} is in the room twice`);
    keys.add(person.key);
  }
  for (const entry of g.transcript) if (typeof entry.text !== "string") problem(where, "a line of the story that isn't text");
  return g;
}

async function finishCheck() {
  for (let i = 0; i < 6 && (await state()).check; i += 1) {
    const { check } = await state();
    await call("/api/check", { command: check.decided ? "disconnect" : "run" });
  }
}
async function finishFight() {
  for (let i = 0; i < 60 && (await state()).combat; i += 1) await call("/api/combat", { type: i > 40 ? "flee" : "attack" });
}
async function logOff() {
  if ((await state()).computer) await call("/api/computer", { action: "logoff" });
}

// Everything that can be done in the room: things used, the place's parts worked, pockets picked, and a fight. Who's
// in a room depends on how the dice went earlier, so what was done is counted over the whole game.
const done = { used: 0, worked: 0, pockets: 0, fights: 0 };
async function workTheRoom(where) {
  let g = await holds(`${where}, arriving`);
  if (!g.walk) return;
  for (const thing of g.walk.things.filter((one) => !one.part).slice(0, 4)) {
    await call("/api/walk", { action: "go", to: `thing:${thing.id}` });
    const used = await call("/api/walk", { action: "use", key: thing.id });
    if (used.status === 200) done.used += 1;
    if (used.check) await finishCheck();
    if ((await state()).computer) {
      await tick(3);
      await call("/api/computer", { action: "home" });
      await logOff();
    }
    await holds(`${where}, after using ${thing.name}`);
  }
  g = await state();
  for (const part of g.walk.things.filter((one) => one.part).slice(0, 6)) {
    for (const action of part.actions ?? []) {
      const reply = await call("/api/walk", { action: "work", key: part.id, how: action.id });
      if (reply.status === 200) done.worked += 1;
      if (reply.check) {
        await tick(4);
        await holds(`${where}, during ${action.label} on ${part.name}`);
        await finishCheck();
      }
      await logOff();
      await holds(`${where}, after ${action.label} on ${part.name}`);
    }
  }
  g = await state();
  const people = g.walk.people.slice(0, 2);
  for (const person of people) {
    const picked = await call("/api/walk", { action: "pickpocket", key: person.key });
    if (!picked.check) continue;
    done.pockets += 1;
    await tick(2);
    await finishCheck();
    await holds(`${where}, after picking ${person.short}'s pocket`);
    const again = await call("/api/walk", { action: "pickpocket", key: person.key });
    if (again.status !== 400) problem(where, `${person.short}'s pocket could be picked twice running`);
  }
  if (people.length) {
    const attacked = await call("/api/walk", { action: "attack", key: people.at(-1).key });
    if (attacked.combat) {
      done.fights += 1;
      await finishFight();
    }
    await holds(`${where}, after the fight`);
  }
}

test("the captain's written opening plays, and the bridge's things, parts, pockets and a fight all work together", async () => {
  await call("/api/new", { draft: randomDraft({ seed: 7, archetype: "officer" }) });
  assert.equal((await state()).mode, "written");
  const opening = await call("/api/chat", { event: "start" });
  assert.equal(opening.error, null);
  for (let i = 0; i < 4; i += 1) {
    const g = await state();
    const options = (g.transcript.filter((one) => one.role === "narrator").at(-1)?.text ?? "").split("\n").filter((line) => line.trim().startsWith(">"));
    if (!options.length) break;
    await call("/api/chat", { text: options[0].replace(/^>\s*\d*\.?\s*/, "").replace(/\s*\[[^\]]*\]\s*$/, "").trim() });
    await finishCheck();
    await holds("after a written choice");
  }
  await workTheRoom("the bridge");
  assert.ok(done.used > 0 && done.worked > 0, JSON.stringify(done));
  assert.equal(asked.length, 0, "the written story never calls the AI");
  assert.deepEqual(problems, []);
});

test("midnight comes with a check open, and the alarm rings and stops, with nothing breaking", async () => {
  await call("/api/check/start", { practice: "engineering", difficulty: "moderate" });
  const dayOf = (g) => Math.floor(g.clock.hours / 24);
  const day = dayOf(await state());
  for (let i = 0; i < 40 && dayOf(await state()) === day; i += 1) await tick(5);
  const g = await holds("after midnight with a check open");
  assert.notEqual(dayOf(g), day, "midnight came");
  if (g.fleet.raid) {
    const refused = await call("/api/fleet", { action: "raid", id: "voss" });
    assert.equal(refused.status, 400, "a raid waits for the check");
  }
  await finishCheck();
  if ((await state()).fleet.raid) await call("/api/fleet", { action: "raid", id: "voss" });
  await call("/api/systems", { row: "alarm", to: "ringing" });
  await tick(6);
  await workTheRoom("the bridge with the alarm ringing");
  await call("/api/systems", { row: "alarm", to: "quiet" });
  assert.deepEqual(problems, []);
});

test("handed to the AI, it's told the written story once, and handed back, the written story carries on without it", async () => {
  const toAi = await call("/api/story", { mode: "ai" });
  assert.equal(toAi.game.mode, "ai");
  await call("/api/chat", { text: "I look around the bridge." });
  assert.equal(asked.length, 1);
  assert.match(JSON.stringify(asked[0].messages), /written_story/);
  await call("/api/chat", { text: "Walk on" });
  assert.equal(asked.length, 2);
  assert.doesNotMatch(JSON.stringify(asked[1].messages.at(-1)), /written_story/, "told once");
  const back = await call("/api/story", { mode: "written" });
  assert.equal(back.game.mode, "written");
  await call("/api/chat", { text: "Wait and listen" });
  await call("/api/chat", { event: "continue" });
  assert.equal(asked.length, 2, "the written story doesn't call the AI");
  await holds("after the switch");
  assert.deepEqual(problems, []);
});

test("the fleet jumps to Haven, and its rooms work the same", async () => {
  const course = await call("/api/fleet", { action: "course", id: "haven" });
  assert.equal(course.status, 200, course.error);
  await call("/api/chat", { event: "continue" });
  const g = await holds("at Haven");
  assert.equal(g.location.id, "haven");
  for (const room of (g.walk.overview?.rooms ?? []).filter((one) => !one.closed).slice(0, 2)) {
    await call("/api/walk", { action: "room", to: room.id });
    await tick(3);
    await workTheRoom(`Haven: ${room.name}`);
  }
  assert.deepEqual(problems, []);
});

test("someone who isn't the captain starts, works a shift, sleeps, and can't run the Meridian's systems", async () => {
  const draft = randomDraft({ seed: 11, archetype: "officer" });
  draft.start = "engine_hand";
  await call("/api/new", { draft });
  lastHours = -Infinity;
  const opening = await call("/api/chat", { event: "start" });
  assert.equal(opening.error, null);
  const g = await holds("the engine hand's start");
  assert.equal(g.role.captain, false);
  await workTheRoom("the engine hand's room");
  await call("/api/action", { action: "work" });
  await holds("after a shift");
  await call("/api/action", { action: "rest" });
  await holds("after sleeping");
  const refused = await call("/api/systems", { row: "alarm", to: "ringing" });
  assert.equal(refused.status, 400);
  assert.ok(done.pockets > 0 && done.fights > 0, `pockets were picked and fights fought along the way: ${JSON.stringify(done)}`);
  assert.deepEqual(problems, []);
});
