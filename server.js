// The game's local server. It only accepts connections from this computer.
// It holds the game and your API key, and the browser page talks to it.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { AiError, CLAUDE_MODELS, callCost, listOllamaModels, runTurn, testClaude } from "./src/ai.js";
import { ensureContactFiles, newCampaignId, saveCaptainSheet } from "./src/campaign.js";
import { SKILLS } from "./src/character-data.js";
import { checkCommand, startCheck, startChoiceCheck } from "./src/checks.js";
import { simulatorFollowers } from "./src/combat.js";
import { buildCharacter, createGameFromDraft, creatorSetup, randomDraft } from "./src/creator.js";
import { fleetCommand } from "./src/fleet.js";
import { noteLoreSeen } from "./src/lore.js";
import { openingFor } from "./src/role.js";
import { migrateGame } from "./src/migrate.js";
import { dataDir, projectDir } from "./src/paths.js";
import {
  buy, buyPerk, captainSheet, clockFor, combatAction, equip, notePeopleSeen, publicState, raiseSkill, raiseStat, rest, sell, setDifficulty, startCombat, useItem, workShift,
} from "./src/rules.js";
import { closeTalk, talkBrief, talkCommand, talkHeard, talkLineOver, talkSaid, walkCommand, walkTick } from "./src/walk.js";

const savesDir = path.join(dataDir(), "saves");
const settingsFile = path.join(dataDir(), "settings.json");
const publicDir = path.join(projectDir, "public");
const PORT = Number(process.env.PORT) || 3210;
// "previous" keeps the last game when a new one starts, in case that was a mistake.
const SAVE_SLOTS = ["autosave", "previous", "slot1", "slot2", "slot3"];

fs.mkdirSync(savesDir, { recursive: true });

// ---- Settings -----------------------------------------------------------

const DEFAULT_SETTINGS = { provider: "claude", model: "claude-opus-5-5", effort: "medium", apiKey: "" };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();

const saveSettings = () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
const hasKey = () => Boolean(settings.apiKey || process.env.ANTHROPIC_API_KEY);

async function settingsView() {
  return {
    provider: settings.provider,
    model: settings.model,
    effort: settings.effort,
    hasKey: hasKey(),
    claudeModels: CLAUDE_MODELS,
    ollama: await listOllamaModels(),
    spending,
  };
}

// ---- What the AI has cost -----------------------------------------------

const usageFile = path.join(dataDir(), "usage.jsonl");

function spentSoFar() {
  try {
    return fs.readFileSync(usageFile, "utf8").split("\n").filter(Boolean).reduce((total, line) => total + JSON.parse(line).cost, 0);
  } catch {
    return 0;
  }
}

const spending = { lastTurn: null, session: 0, calls: 0, total: spentSoFar() };

// Keeps a record of every call, which also shows how well the ways of saving money are working.
function recordUsage({ model, usage }) {
  const cost = callCost(model, usage);
  spending.session += cost;
  spending.total += cost;
  spending.calls += 1;
  fs.appendFileSync(usageFile, `${JSON.stringify({
    at: new Date().toISOString(),
    model,
    input: usage.input_tokens,
    written: usage.cache_creation_input_tokens,
    read: usage.cache_read_input_tokens,
    output: usage.output_tokens,
    thinking: usage.output_tokens_details?.thinking_tokens,
    cost,
  })}\n`);
  return cost;
}

// ---- Saves --------------------------------------------------------------

const savePath = (slot) => path.join(savesDir, `${slot}.json`);

// Written to one side and then swapped in, so a crash or a full disk can't leave half a save.
function writeSave(slot, data) {
  if (!SAVE_SLOTS.includes(slot)) throw new Error("Unknown save slot.");
  const file = savePath(slot);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
  fs.renameSync(`${file}.tmp`, file);
}

// Keeps the game being left, in case leaving was a mistake. A game nobody's played yet isn't worth losing an older one for.
function keepAsPrevious() {
  if (game && (game.turn > 0 || !fs.existsSync(savePath("previous")))) writeSave("previous", game);
}

function listSaves() {
  return SAVE_SLOTS.map((slot) => {
    try {
      const data = migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8")));
      return { slot, name: data.name, level: data.level, location: publicState(data).location.name, savedAt: fs.statSync(savePath(slot)).mtime };
    } catch {
      return { slot, empty: true };
    }
  });
}

function readSave(slot) {
  if (!SAVE_SLOTS.includes(slot)) throw new Error("Unknown save slot.");
  try {
    return migrateGame(JSON.parse(fs.readFileSync(savePath(slot), "utf8")));
  } catch {
    throw new Error("That save slot is empty or unreadable.");
  }
}

// ---- The current game ---------------------------------------------------

let game = null;
try {
  game = migrateGame(JSON.parse(fs.readFileSync(savePath("autosave"), "utf8")));
  ensureContactFiles(game);
} catch (err) {
  // No autosave yet: the player starts on the title screen. A broken one is kept, so a new game can't overwrite it.
  if (err.code !== "ENOENT" && !game) {
    fs.copyFileSync(savePath("autosave"), `${savePath("autosave")}.broken`);
    console.error(`Your last autosave couldn't be read. A copy is at ${savePath("autosave")}.broken`);
  }
}

let busy = false;

const log = (role, text) => game.transcript.push({ role, text });

function autosave() {
  writeSave("autosave", game);
  if (game.campaign) saveCaptainSheet(game.campaign, captainSheet(game));
}

// Walking can be a step per key press, so the save waits until the captain stops for a moment.
let walkSave = null;
function saveWalk() {
  walkSave = null;
  if (game && !busy) autosave();
}
function saveAfterWalking() {
  clearTimeout(walkSave);
  walkSave = setTimeout(saveWalk, 1000);
}

// The clock can run for hours, so it's saved every so often rather than at every moment.
let clockSave = null;
function saveClock() {
  clockSave = null;
  if (game && !busy) autosave();
}
function saveInAWhile() {
  clockSave ??= setTimeout(saveClock, 15000);
}

// For the app, which stops the game when its window closes, so nothing's left waiting to be saved.
export function finishSaving() {
  if (walkSave) {
    clearTimeout(walkSave);
    saveWalk();
  }
  if (clockSave) {
    clearTimeout(clockSave);
    saveClock();
  }
}

export const gameIsBusy = () => busy;

// ---- Streaming an AI turn to the browser --------------------------------

async function streamTurn(res, { playerText, gameEvent, threadId, talking = false }) {
  res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
  const send = (obj) => res.write(`${JSON.stringify(obj)}\n`);
  const before = structuredClone(game);
  busy = true;
  spending.lastTurn = 0;
  try {
    const talk = talking ? talkBrief(game) : null;
    if (talking) talkSaid(game, playerText);
    else if (playerText) log("player", playerText);
    // Narration and game messages are kept in the order they happened.
    const pieces = [];
    await runTurn({
      game,
      settings,
      playerText,
      gameEvent,
      threadId,
      talk,
      emit: (e) => {
        if (e.type === "text") {
          const last = pieces.at(-1);
          if (last?.role === "narrator") last.text += e.text;
          else pieces.push({ role: "narrator", text: e.text });
          send({ type: "text", text: e.text });
        }
        if (e.type === "notice") {
          pieces.push({ role: "notice", text: e.text });
          send({ type: "notice", text: e.text });
        }
        if (e.type === "state") send({ type: "state", state: publicState(game) });
        if (e.type === "usage") spending.lastTurn += recordUsage(e);
      },
    });
    for (const piece of pieces) {
      const text = piece.text.trim();
      if (!text) continue;
      // What's said in a talk stays in its window. What it changes in the game goes in the story too.
      if (talking) talkHeard(game, text, piece.role);
      if (!talking || piece.role !== "narrator") log(piece.role, text);
      if (piece.role === "narrator") {
        noteLoreSeen(game, text);
        notePeopleSeen(game, text);
      }
    }
    if (talking) talkLineOver(game);
    else game.turn += 1;
    autosave();
    send({ type: "done", state: publicState(game), spending });
  } catch (err) {
    // Put the game back, so a failed AI call doesn't change the story.
    game = before;
    const message = err instanceof AiError ? err.message : `Unexpected error: ${err.message}`;
    send({ type: "error", message, state: publicState(game), spending });
  } finally {
    busy = false;
    res.end();
  }
}

// ---- Routes -------------------------------------------------------------

const json = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
};

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const requireGame = () => {
  if (!game) throw new Error("No game in progress.");
  return game;
};

// Nothing else can happen while a raid's waiting on the captain's order.
const RAID_WAITING = "The fleet's under attack. Give your orders first.";
// The clock stands still during a talk, so anything that could move it waits until it's over.
const TALK_WAITING = "Finish the talk first.";

function menuAction(body) {
  const g = requireGame();
  // Sleeping lets time pass, and that has to wait until the raid's been answered.
  if (g.fleet?.raid && (body.action === "rest" || body.action === "work")) throw new Error(RAID_WAITING);
  if (g.talk && (body.action === "rest" || body.action === "work")) throw new Error(TALK_WAITING);
  switch (body.action) {
    case "equip": equip(g, body.id); return null;
    case "use": return useItem(g, body.id);
    case "buy": return buy(g, body.id);
    case "sell": return sell(g, body.id);
    case "perk": return buyPerk(g, body.id);
    case "stat": return raiseStat(g, body.id);
    case "skill": return raiseSkill(g, body.id);
    case "rest": return rest(g, { rough: Boolean(body.rough) });
    case "work": return workShift(g);
    case "difficulty": return setDifficulty(g, body.id);
    default: throw new Error("Unknown action.");
  }
}

async function handleApi(req, res, route) {
  if (req.method === "GET" && route === "/api/state") {
    let shown = null;
    try {
      shown = game ? publicState(game) : null;
    } catch (err) {
      // Something in this save doesn't match the world's files. The title screen still has to work.
      console.error(`The current game can't be shown: ${err.message}`);
    }
    return json(res, 200, {
      busy,
      game: shown,
      saves: listSaves(),
      setup: creatorSetup(),
      settings: await settingsView(),
    });
  }
  if (req.method === "GET" && route === "/api/settings") return json(res, 200, await settingsView());

  if (req.method !== "POST") return json(res, 404, { error: "Not found." });
  const body = await readBody(req);

  if (route === "/api/settings") {
    if (typeof body.apiKey === "string" && body.apiKey.trim()) settings.apiKey = body.apiKey.trim();
    if (body.clearKey) settings.apiKey = "";
    if (body.effort === "medium" || body.effort === "low") settings.effort = body.effort;
    if (body.provider === "claude") {
      if (!CLAUDE_MODELS.some((m) => m.id === body.model)) throw new Error("Unknown Claude model.");
      settings.provider = "claude";
      settings.model = body.model;
    } else if (body.provider === "ollama") {
      if (typeof body.model !== "string" || !body.model) throw new Error("Choose a local model.");
      settings.provider = "ollama";
      settings.model = body.model;
    }
    saveSettings();
    return json(res, 200, await settingsView());
  }
  if (route === "/api/settings/test") {
    if (settings.provider === "claude") {
      if (!hasKey()) return json(res, 200, { ok: false, message: "No API key yet. Paste one above first." });
      return json(res, 200, await testClaude(settings));
    }
    const { running, models } = await listOllamaModels();
    if (!running) return json(res, 200, { ok: false, message: "Ollama isn't running." });
    return json(res, 200, models.includes(settings.model)
      ? { ok: true, message: `Connected. ${settings.model} is ready.` }
      : { ok: false, message: `${settings.model} isn't installed in Ollama.` });
  }

  if (route === "/api/creator/preview") return json(res, 200, buildCharacter(body.draft).view);
  if (route === "/api/creator/random") {
    const draft = randomDraft({ archetype: body.archetype, keep: body.keep ?? {}, anyone: Boolean(body.anyone) });
    return json(res, 200, buildCharacter(draft).view);
  }

  if (busy) return json(res, 409, { error: "The game master is still writing. Wait a moment." });

  if (route === "/api/new") {
    const created = createGameFromDraft(body.draft);
    created.campaign = newCampaignId(created.name);
    // People from the captain's past get their files now.
    ensureContactFiles(created);
    keepAsPrevious();
    game = created;
    autosave();
    return json(res, 200, { game: publicState(game), saves: listSaves() });
  }
  if (route === "/api/load") {
    const loaded = readSave(body.slot);
    ensureContactFiles(loaded);
    if (body.slot !== "autosave") keepAsPrevious();
    game = loaded;
    autosave();
    return json(res, 200, { game: publicState(game), saves: listSaves() });
  }
  if (route === "/api/save") {
    writeSave(body.slot, requireGame());
    return json(res, 200, { saves: listSaves() });
  }
  if (route === "/api/action") {
    if (requireGame().combat) throw new Error("Finish the fight first. You can use items from the combat buttons.");
    if (game.check) throw new Error("Finish the check first.");
    const message = menuAction(body);
    if (message) log("notice", message);
    autosave();
    return json(res, 200, { game: publicState(game), message });
  }
  // The Fleet menu, the star map and raids all run here. The AI hears about them with its next message.
  if (route === "/api/fleet") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.talk) throw new Error(TALK_WAITING);
    const { message, notes = [], report = null, moved = false } = fleetCommand(game, body);
    if (notes.length) log("notice", notes.join("\n"));
    autosave();
    return json(res, 200, { game: publicState(game), message, report, moved });
  }
  // Fights happen right here. No request goes to the AI until the player continues the story.
  if (route === "/api/combat") {
    const outcome = combatAction(requireGame(), body);
    // The blow-by-blow stays in the fight window. The story only records how it ended,
    // and a simulated fight leaves no trace in the story at all.
    if (outcome.over && !outcome.training) {
      game.transcript.push({ role: "combat", tag: "COMBAT", text: outcome.summary, tone: outcome.tone, ...(outcome.math ? { math: outcome.math } : {}) });
      for (const note of outcome.notes) log("notice", note);
    }
    autosave();
    return json(res, 200, { game: publicState(game), outcome });
  }
  // A check plays out here too, and the AI only hears about it once it's over.
  if (route === "/api/check/start") {
    if (requireGame().fleet?.raid) throw new Error(RAID_WAITING);
    if (game.talk) throw new Error(TALK_WAITING);
    if (body.practice) {
      if (!SKILLS[body.practice]) throw new Error("Unknown skill.");
      startCheck(game, { skill: body.practice, difficulty: body.difficulty ?? "moderate", reason: `Practice: ${SKILLS[body.practice].name}`, source: "practice" });
    } else {
      const label = typeof body.label === "string" ? body.label : "";
      if (!startChoiceCheck(game, label)) throw new Error("That choice isn't on offer any more.");
      log("player", label);
    }
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  if (route === "/api/check") {
    const reply = checkCommand(requireGame(), body.command);
    if (reply.over) autosave();
    return json(res, 200, { game: publicState(game), ...reply });
  }
  if (route === "/api/sim") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.fleet?.raid) throw new Error(RAID_WAITING);
    if (game.talk) throw new Error(TALK_WAITING);
    if (!publicState(game).location.rest) throw new Error("The simulator is aboard the Meridian.");
    startCombat(game, body.enemy, { training: true, ...(body.followers ? simulatorFollowers(game, body.enemy) : {}) });
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  // The clock running by itself while the player explores. Nothing here goes near the AI. The reply
  // is small, because this is twice a second, unless something's happened that the whole screen needs.
  if (route === "/api/tick") {
    const before = Math.floor(requireGame().clock.hours / 2);
    const { notes = [], ...reply } = walkTick(game, body);
    if (reply.held || reply.still) return json(res, 200, reply);
    if (notes.length) log("notice", notes.join("\n"));
    // A raid needs the whole screen, even if it hasn't got a line in the story yet.
    const news = notes.length > 0 || Boolean(game.fleet?.raid);
    if (news) autosave();
    else saveInAWhile();
    const passed = news || Math.floor(game.clock.hours / 2) !== before;
    return json(res, 200, { ...reply, clock: clockFor(game), ...(passed ? { game: publicState(game), news } : {}) });
  }
  // Walking runs here, without the AI. The reply is small, because this can be every key press.
  if (route === "/api/walk") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.fleet?.raid) throw new Error(RAID_WAITING);
    if (game.talk) throw new Error(TALK_WAITING);
    const reply = walkCommand(game, body);
    saveAfterWalking();
    return json(res, 200, reply);
  }
  // A talk: opening it, closing it and free lines stay here, and each thing said goes to the AI like any other turn.
  if (route === "/api/talk") {
    if (requireGame().combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.fleet?.raid) throw new Error(RAID_WAITING);
    if (body.action === "say") {
      if (!game.talk) throw new Error("You're not talking to anyone right now.");
      const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
      if (!text) throw new Error("Choose something to say.");
      return streamTurn(res, { playerText: text, talking: true });
    }
    talkCommand(game, body);
    autosave();
    return json(res, 200, { game: publicState(game) });
  }
  if (route === "/api/chat") {
    requireGame();
    if (game.combat) throw new Error("Finish the fight first.");
    if (game.check) throw new Error("Finish the check first.");
    if (game.fleet?.raid) throw new Error(RAID_WAITING);
    // Anything that would move the story on leaves the talk first.
    closeTalk(game);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    if (body.event === "start" && !game.transcript.length) {
      return streamTurn(res, { gameEvent: openingFor(game) });
    }
    if (body.event === "start" || body.event === "continue") return streamTurn(res, { gameEvent: "Continue the story from here." });
    if (!text) throw new Error("Type what you want to do.");
    // A lead picked from the menu comes with its story thread.
    return streamTurn(res, { playerText: text, threadId: typeof body.thread === "string" ? body.thread : null });
  }
  return json(res, 404, { error: "Not found." });
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

function serveFile(res, route) {
  const relative = route === "/" ? "index.html" : route.slice(1);
  const file = path.resolve(publicDir, relative);
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // Refuse requests that come from other websites open in your browser.
  const host = req.headers.host ?? "";
  const allowed = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  const origin = req.headers.origin;
  if (!allowed.includes(host) || (origin && !allowed.includes(origin.replace(/^https?:\/\//, "")))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  const route = new URL(req.url, `http://${host}`).pathname;
  try {
    if (route.startsWith("/api/")) await handleApi(req, res, route);
    else serveFile(res, route);
  } catch (err) {
    if (res.headersSent) return res.end();
    json(res, 400, { error: err.message });
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`The game seems to be running already. Open http://localhost:${PORT} in your browser.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`The Last Meridian is running at http://localhost:${PORT}`);
  console.log("Leave this window open while you play. Close it to stop the game.");
});
