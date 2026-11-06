// Switching a game between the written story and the AI game master: the AI catches up on what the written story told,
// once, and from where it left off; the AI's old choices aren't offered to the written story; the Settings route does
// both the game being played and new games, refuses in a talk, and won't hand a game to an AI that isn't set up.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-switch-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { switchStory } = await import("../src/scenes.js");
const { latestOptions } = await import("../public/story.js");
const { projectDir } = await import("../src/paths.js");
const { startCheck } = await import("../src/checks.js");

const newGame = (mode) => ({ ...createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" })), mode });

test("handed to the AI, a written game gives it what the story told, once, and from where it left off", () => {
  const game = newGame("written");
  game.transcript.push(
    { role: "narrator", text: "The bridge is quiet.\n> 1. Look around\n> 2. Call Voss" },
    { role: "player", text: "Call Voss" },
    { role: "narrator", text: "Voss looks up from the plot table." },
    { role: "notice", text: "[ITEM] Received: Encrypted Data Chip" },
    { role: "combat", text: "Victory. The dock thug goes down." },
  );
  assert.equal(switchStory(game, "ai"), true);
  assert.equal(game.mode, "ai");
  assert.equal(game.ai.written.length, 2);
  assert.match(game.ai.written[0], /The bridge is quiet\./);
  assert.doesNotMatch(game.ai.written[0], /Look around/, "the choices aren't part of what happened");
  assert.equal(game.ai.written[1], "The player: Call Voss\nVoss looks up from the plot table.\n\nA fight: Victory. The dock thug goes down.");
  assert.equal(switchStory(game, "ai"), false, "already the AI's");
  // Back to the written story: it remembers how far the AI read, and going back to the AI sends only what's new.
  game.ai.written = [];
  switchStory(game, "written");
  assert.equal(game.mode, "written");
  assert.equal(game.ai.seenUpTo, game.transcript.length);
  game.transcript.push({ role: "player", text: "Ask about the chip" }, { role: "narrator", text: "She shrugs." });
  switchStory(game, "ai");
  assert.deepEqual(game.ai.written, ["The player: Ask about the chip\nShe shrugs."]);
  assert.throws(() => switchStory(game, "nobody"), /written story or the AI/);
});

test("the AI's choices aren't offered once the written story has taken over", () => {
  const transcript = [{ role: "narrator", text: "What now?\n> 1. Go left\n> 2. Go right" }];
  assert.equal(latestOptions(transcript).length, 2);
  transcript.push({ role: "notice", text: "[STORY] From here, the written story runs this game, with no AI.", turnover: true });
  assert.deepEqual(latestOptions(transcript), []);
});

// ---- Over the real server -----------------------------------------------------

const servers = [];
async function startServer({ key, begun = true, checking = false }) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-switch-server-"));
  fs.mkdirSync(path.join(data, "saves"), { recursive: true });
  fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: key ? "not-a-real-key" : "" }));
  const game = newGame("written");
  if (begun) game.transcript.push({ role: "narrator", text: "The opening, written.\n> 1. Go on" });
  if (checking) startCheck(game, { skill: "engineering", difficulty: "moderate", reason: "Practice: Engineering", source: "practice" });
  fs.writeFileSync(path.join(data, "saves", "autosave.json"), JSON.stringify(game));
  const port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  const env = { ...process.env, GAME_DATA_DIR: data, PORT: String(port) };
  delete env.ANTHROPIC_API_KEY;
  const child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env, stdio: "pipe" });
  servers.push(child);
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
  const post = async (route, body = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, ...(await res.json()) };
  };
  const get = async (route) => (await fetch(`http://127.0.0.1:${port}${route}`)).json();
  return { post, get, data };
}

after(() => {
  for (const child of servers) child.kill();
});

test("the Settings switch hands the game being played over, from its next turn, and decides new games too", async () => {
  const { post, get, data } = await startServer({ key: true });
  const toAi = await post("/api/story", { mode: "ai" });
  assert.equal(toAi.status, 200);
  assert.equal(toAi.game.mode, "ai");
  assert.equal(toAi.settings.story, "ai");
  assert.match(toAi.game.transcript.at(-1).text, /the AI game master runs this game/);
  const saved = JSON.parse(fs.readFileSync(path.join(data, "saves", "autosave.json"), "utf8"));
  assert.equal(saved.mode, "ai");
  assert.match(saved.ai.written.join("\n"), /The opening, written\./, "the AI will read what the written story told");
  const toWritten = await post("/api/story", { mode: "written" });
  assert.equal(toWritten.game.mode, "written");
  assert.equal(toWritten.game.transcript.at(-1).turnover, true);
  assert.equal((await get("/api/settings")).story, "written");
  assert.equal((await get("/api/state")).game.mode, "written");
  const refused = await post("/api/story", { mode: "nobody" });
  assert.equal(refused.status, 400);
});

test("a game can't be handed to an AI that isn't set up", async () => {
  const { post } = await startServer({ key: false });
  const refused = await post("/api/story", { mode: "ai" });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /Set up an AI first/);
  const fine = await post("/api/story", { mode: "written" });
  assert.equal(fine.status, 200);
  assert.equal(fine.game.mode, "written");
});

test("a game that hasn't begun keeps its Start the story button when it's switched, and a check has to finish first", async () => {
  const fresh = await startServer({ key: true, begun: false });
  const toAi = await fresh.post("/api/story", { mode: "ai" });
  assert.equal(toAi.game.mode, "ai");
  assert.equal(toAi.game.transcript.length, 0, "nothing's been told, so there's nothing to hand over");
  const checking = await startServer({ key: true, checking: true });
  const refused = await checking.post("/api/story", { mode: "ai" });
  assert.equal(refused.status, 400);
  assert.match(refused.error, /Finish the check first/);
  assert.equal((await checking.get("/api/state")).game.mode, "written");
});
