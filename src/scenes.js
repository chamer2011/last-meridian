// The written story: scenes played from world/scenes, with no AI. A scene is made of parts. Each part
// has text in the same format the game master writes, so the page shows it the same way, and choices
// that lead to other parts. A part can open a skill check or start a fight, and where the story goes
// next depends on how that came out. Whatever a part changes in the game goes through the same tools
// the AI uses, so the rules are the same either way. The files are plain text, read again whenever the
// story needs them, so a change shows up without restarting the game. world/scenes/_how-to-write-a-scene.txt
// explains how to write one.

import fs from "node:fs";
import path from "node:path";
import { SKILLS } from "./character-data.js";
import { startChoiceCheck } from "./checks.js";
import { worldDir } from "./paths.js";
import { DIFFICULTY, attr, maxHp, skillRank } from "./rules.js";
import { conditionHolds, parseCondition, parseSceneText } from "./scene-text.js";
import { clearFact, endStory, recordFact } from "./record.js";
import { clockFacts, clockProblems } from "./story-clock.js";
import { noteThreadStarted, notesProblems } from "./story-library.js";
import { newTurnLimits, runTool, toolProblem } from "./tools.js";
import { answerDoor } from "./walk.js";
import { computerProblems, enterComputer } from "./computers.js";
import { applySystemsEffect, placesWithSystems, systemsProblems } from "./systems.js";
import { FACT_LINES, STORY_FILE_PROBLEMS, WORLD_COMPUTERS, WORLD_FILE_PROBLEMS, WORLD_MAPS, WORLD_THREADS, endingsOf } from "./world.js";

// Something the player did that the written story has no answer to. The turn changes nothing, and they read this.
export class StoryError extends Error {}

const AI_HINT = "With an AI game master, chosen in Settings, you can type anything you like.";
const FIGHT_ENDINGS = { victory: "won", talked: "talked", defeat: "lost", fled: "fled", surrendered: "gaveUp" };
// What conditions need from the rules. A conversation adds what's been said in it, as seen.
export const HELPERS = { attr, skillRank, maxHp };
// Tests point this at a copy, so they can save scenes without touching the real ones.
export const SCENES_DIR = process.env.GAME_SCENES_DIR ?? path.join(worldDir, "scenes");

// ---- Loading the files ------------------------------------------------------------

const cache = new Map();

// Every scene in the folder, read fresh when a file has changed: a .txt file in the written format, or a .json
// one in the shape the game plays. Files whose names start with _ are notes, not scenes. A file with a mistake
// that stops it being read at all is left out, and problems says why, with the line.
export function loadScenes(dir = SCENES_DIR) {
  const scenes = {};
  const problems = [];
  const broken = {};
  if (!fs.existsSync(dir)) return { scenes, problems, broken };
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.startsWith("_") || !/\.(txt|json)$/.test(name)) continue;
    const file = path.join(dir, name);
    const id = name.replace(/\.(txt|json)$/, "");
    let stamp;
    try {
      stamp = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const kept = cache.get(file);
    const entry = kept?.stamp === stamp ? kept : { stamp, ...readScene(file, name) };
    cache.set(file, entry);
    if (entry.scene) scenes[id] = entry.scene;
    else {
      const first = entry.problems[0];
      broken[id] = first ? `${first.line ? `line ${first.line}: ` : ""}${first.message}` : "can't be read";
    }
    for (const found of entry.problems) problems.push({ file: name, ...found });
  }
  return { scenes, problems, broken };
}

function readScene(file, name) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return { scene: null, problems: [{ line: 0, message: `can't be read: ${err.message}` }] };
  }
  if (name.endsWith(".json")) {
    try {
      return { scene: JSON.parse(text), problems: [] };
    } catch (err) {
      return { scene: null, problems: [{ line: 0, message: `isn't valid JSON: ${err.message}` }] };
    }
  }
  const { scene, problems } = parseSceneText(text, name);
  return { scene: Object.keys(scene.parts).length ? scene : null, problems };
}

// How the story opens for this life: its own scene if one's written, or the one that fits anyone. With an AI
// game master, a life without an opening of its own gets the AI's instead, so only its own counts there.
export function openingSceneId(game, scenes = loadScenes().scenes) {
  const own = `opening_${game.role?.id ?? "captain"}`;
  if (scenes[own]) return own;
  return scenes.opening && game.mode !== "ai" ? "opening" : null;
}

// ---- Reading a part ----------------------------------------------------------------

// How a choice reads in the story: its check, its other tags, then its words.
export const choiceLine = (choice) => ["> ", choice.check ? `[${choice.check}] ` : "", ...(choice.tags ?? []).map((tag) => `[${tag}] `), choice.say].join("");

// Text without its > choice lines, for when the choices are given another way, or shouldn't be there at all.
export const withoutChoices = (text) => String(text ?? "").split("\n").filter((line) => !line.trim().startsWith(">")).join("\n").replace(/\n{3,}/g, "\n\n").trim();

// The choices this player gets to see: the ones whose conditions hold.
export const openChoices = (part, game, helpers = HELPERS) => (part.choices ?? []).filter((choice) => !choice.if || conditionHolds(game, choice.if, helpers));

// What the player reads when a part begins, in the game master's own format.
export function partText(part, game = null, helpers = HELPERS) {
  const lines = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
  const choices = (game ? openChoices(part, game, helpers) : part.choices ?? []).map(choiceLine);
  return [lines.join("\n\n"), choices.join("\n")].filter(Boolean).join("\n\n");
}

// The first rule of a part that holds, if any, which sends the story somewhere else instead.
export const ruleThatHolds = (part, game, helpers = HELPERS) => (part.when ?? []).find((one) => !one.if || conditionHolds(game, one.if, helpers)) ?? null;

// ---- Finding the choice the player meant ----------------------------------

const normalize = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

// Words that say nothing about which choice is meant. With an AI, a wrong match here would play a written
// choice the player didn't mean, for free, instead of asking the AI, so these never count as a match.
const FILLER = new Set("the a an and or but of to in on at for with from by as is are was were be been it its this that these those you your yours him his her hers them their they she he we our us me my i do does did what which who whom how why when where not no yes up out off down into about all any some one there here then than so if can will would could should let have has had am just now too very own same more most other again once".split(" "));

// Typing is forgiving: the whole choice, the start of it, or most of its words, with typos in the rest.
export function matchChoice(text, choices) {
  const wanted = normalize(text);
  if (!wanted) return null;
  const exact = choices.find((choice) => normalize(choice.say) === wanted);
  if (exact) return exact;
  const starts = choices.filter((choice) => normalize(choice.say).startsWith(wanted));
  if (starts.length === 1) return starts[0];
  const all = wanted.split(" ").filter((word) => word.length > 2);
  const words = all.filter((word) => !FILLER.has(word));
  // Most of the real words have to be there. A line of nothing but filler, like "go with her now", still means
  // something, so it counts when every one of its words is there.
  const looked = words.length ? words : all;
  const needed = words.length ? Math.max(1, Math.ceil(words.length * 0.6)) : all.length;
  if (!looked.length) return null;
  const scored = choices.map((choice) => {
    const have = normalize(choice.say).split(" ").filter((one) => one.length > 2 && (!words.length || !FILLER.has(one)));
    const hits = looked.filter((word) => have.some((one) => one === word || (word.length >= 4 && (one.startsWith(word) || word.startsWith(one) || sameButOne(one, word))))).length;
    return { choice, hits };
  }).filter((one) => one.hits >= needed).sort((a, b) => b.hits - a.hits);
  if (!scored.length || (scored.length > 1 && scored[0].hits === scored[1].hits)) return null;
  return scored[0].choice;
}

// Two words of the same length that differ in one letter, or that are one letter apart in length.
function sameButOne(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  let j = 0;
  let misses = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    misses += 1;
    if (misses > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return misses + (a.length - i) + (b.length - j) <= 1;
}

// ---- Playing ------------------------------------------------------------

const sceneFor = (game, scenes) => (game.scene ? scenes[game.scene.id] ?? null : null);

function partOf(scene, id, sceneId) {
  const part = scene.parts?.[id];
  if (!part) throw new Error(`The scene ${sceneId} has no part called ${id}.`);
  return part;
}

// Plays a part: its rules for going elsewhere, its text, what it changes, and whatever it opens. A check
// or a fight ends the turn, and the story picks up from its result when the player continues.
function enterPart(game, scene, id, { emit, turn }, hops = 0) {
  const part = partOf(scene, id, game.scene.id);
  // A rule that holds sends the story on without showing this part.
  const rule = ruleThatHolds(part, game);
  if (rule) {
    if (hops > 20) throw new Error(`The scene ${game.scene.id} goes round in circles from ${id}.`);
    return enterPart(game, scene, rule.to, { emit, turn }, hops + 1);
  }
  game.scene.part = id;
  game.scene.pending = null;
  game.scene.seen ??= [];
  if (!game.scene.seen.includes(id)) game.scene.seen.push(id);
  const text = partText(part, game);
  if (text) emit({ type: "text", text });
  if (part.note) emit({ type: "notice", text: part.note });
  game.flags ??= {};
  for (const step of part.do ?? []) {
    const { tool, set, clear, line: _line, ...input } = step;
    if (set) {
      recordFact(game, { id: set, text: step.text ?? null, from: game.scene?.id ?? null });
      continue;
    }
    if (clear) {
      clearFact(game, clear);
      continue;
    }
    if (step.door) {
      // A door in this place opens: the way to that room, by its id.
      const to = step.door === "here" ? null : step.door;
      if (to) {
        game.opened ??= {};
        game.opened[game.location] ??= [];
        if (!game.opened[game.location].includes(to)) game.opened[game.location].push(to);
        emit({ type: "notice", text: `[DOOR] The way to ${WORLD_MAPS[game.location]?.levels?.[to]?.name ?? to} is open.` });
      }
      continue;
    }
    if (step.systems) {
      for (const text of applySystemsEffect(game, step.systems, { by: "story" })) emit({ type: "notice", text });
      continue;
    }
    if (step.password) {
      game.passwords ??= {};
      game.passwords[step.password] = step.word;
      emit({ type: "notice", text: `[COMPUTER] You know the password to ${WORLD_COMPUTERS[step.password]?.name ?? step.password} now.` });
      continue;
    }
    if (step.computer) {
      try {
        enterComputer(game, { id: step.computer, how: "the story" });
      } catch (err) {
        throw new Error(`In the scene ${game.scene.id}, part ${id}, the computer couldn't open: ${err.message}`);
      }
      continue;
    }
    if (step.ending) {
      // The story's own ending, by name: it goes on the record, and the quest is done with the same line.
      const storyId = String(game.scene?.id ?? "").replace(/^thread_/, "");
      try {
        const { thread } = endStory(game, { id: storyId, ending: step.ending, summary: step.text, failed: Boolean(step.failed) });
        emit({ type: "notice", text: `[STORY] ${thread.title} has ended: ${step.text}` });
      } catch (err) {
        throw new Error(`In the scene ${game.scene.id}, part ${id}, the ending failed: ${err.message}`);
      }
      continue;
    }
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, ${tool} failed: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
  }
  if (part.check) {
    const [skill, difficulty, audience] = part.check.split(":");
    const outcome = runTool(game, "roll_check", { skill, difficulty, audience, reason: part.reason ?? part.check, scene: part.scene }, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, the check failed to open: ${outcome.result}`);
    game.scene.pending = { kind: "check", pass: part.pass, fail: part.fail };
  } else if (part.fight) {
    const outcome = runTool(game, "start_combat", part.fight, turn);
    if (outcome.isError) throw new Error(`In the scene ${game.scene.id}, part ${id}, the fight failed to start: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
    game.scene.pending = { kind: "fight", won: part.won, lost: part.lost, fled: part.fled, gaveUp: part.gaveUp, talked: part.talked };
  } else if (part.end) {
    game.scene = null;
  }
  emit({ type: "state" });
}

function startScene(game, id, scenes, context) {
  const scene = scenes[id];
  if (!scene) throw new StoryError("That part of the story hasn't been written yet.");
  game.scene = { id, part: null, pending: null, seen: [] };
  enterPart(game, scene, scene.start, context);
}

// Where a check's or a fight's result takes the story.
function nextAfter(game, pending) {
  if (pending.kind === "check") {
    const check = game.lastCheck;
    if (!check || check.used) return null;
    check.used = true;
    return check.success ? pending.pass : pending.fail;
  }
  const fight = game.lastFight;
  if (!fight || fight.used) return null;
  fight.used = true;
  const ending = FIGHT_ENDINGS[fight.result] ?? "lost";
  return pending[ending] ?? (ending === "talked" ? pending.won : pending.lost);
}

// The player pressed Continue after a check, a fight or something else the game did by itself.
function carryOn(game, scenes, context) {
  // The AI isn't here to read these, so the written story decides what they mean.
  game.pendingEvents.splice(0);
  // Asking at a closed door opened a check. Its result decides whether the door opens.
  if (game.lastCheck && !game.lastCheck.used && game.lastCheck.source === "door" && game.doorAsked) {
    game.lastCheck.used = true;
    context.emit({ type: "notice", text: answerDoor(game, game.lastCheck.success) });
    context.emit({ type: "state" });
    return;
  }
  // The fleet, or the player alone, has just arrived somewhere with a written arrival. A scene already under way comes first.
  if (game.arrived) {
    const place = game.arrived;
    game.arrived = null;
    if (scenes[`arrive_${place}`] && !game.scene) return startScene(game, `arrive_${place}`, scenes, context);
  }
  const scene = sceneFor(game, scenes);
  if (scene) {
    const part = partOf(scene, game.scene.part, game.scene.id);
    // A check chosen from the list opened its window straight away, so the story meets its result here.
    const chosen = game.lastCheck && !game.lastCheck.used && game.lastCheck.source === "choice"
      ? (part.choices ?? []).find((choice) => choice.check && choice.say === game.lastCheck.reason)
      : null;
    const pending = game.scene.pending ?? (chosen ? { kind: "check", pass: chosen.pass, fail: chosen.fail } : null);
    if (pending) {
      const next = nextAfter(game, pending);
      if (next) return enterPart(game, scene, next, context);
    }
    // A part can wait for something, such as the fleet arriving somewhere: its rules are read again now, and one
    // that has come to hold since the part began sends the story on.
    const rule = ruleThatHolds(part, game);
    if (rule) return enterPart(game, scene, rule.to, context);
  }
  context.emit({ type: "notice", text: "[STORY] Nothing more is written here for now." });
  context.emit({ type: "state" });
}

// What's wrong with the scene file the player needs, if it can't be read at all.
function brokenMessage(id, broken) {
  return broken[id] ? `The scene ${id} can't be read: ${broken[id]}. Fix the file in world\\scenes, or run npm run check-story to see every problem.` : null;
}

// One turn of the written story. emit() streams what the player reads, the same as an AI turn does,
// and log() records what the player did, before the story answers it.
export function writtenTurn({ game, playerText, event, threadId, emit, log, scenes = null, broken = {} }) {
  const loaded = scenes ? { scenes, broken } : loadScenes();
  const context = { emit, turn: newTurnLimits() };
  // Whatever was waiting to be told, such as a crossing or a jump, the written story has read: otherwise the page
  // would keep offering Continue the story over a scene that has just begun.
  game.pendingEvents.splice(0);
  if (event === "start") {
    // A life's own opening that can't be read is a mistake to fix, not a reason to play the plain one instead.
    const own = brokenMessage(`opening_${game.role?.id ?? "captain"}`, loaded.broken);
    if (own) throw new StoryError(own);
    const id = openingSceneId(game, loaded.scenes);
    if (!id) throw new StoryError(brokenMessage("opening", loaded.broken) ?? "There's no written opening yet. Choose an AI game master in Settings to start the story.");
    return startScene(game, id, loaded.scenes, context);
  }
  if (event === "continue") return carryOn(game, loaded.scenes, context);
  if (threadId) {
    const id = `thread_${threadId}`;
    if (!loaded.scenes[id]) throw new StoryError(brokenMessage(id, loaded.broken) ?? `This story hasn't been written out yet. For now it plays out by itself, and the Leads menu and the news say how it's going. ${AI_HINT}`);
    log("player", playerText);
    // The story is taken up: the Leads menu lists it as followed, and it stops moving on by itself.
    noteThreadStarted(game, threadId);
    return startScene(game, id, loaded.scenes, context);
  }
  const scene = sceneFor(game, loaded.scenes);
  if (!scene) {
    if (game.scene) throw new StoryError(brokenMessage(game.scene.id, loaded.broken) ?? `The scene ${game.scene.id} has gone from world\\scenes, so the story can't go on from here.`);
    throw new StoryError(`There's no more written story here for now. You can walk around, talk to people about what they've heard, and watch the world go on. ${AI_HINT}`);
  }
  const part = partOf(scene, game.scene.part, game.scene.id);
  const choice = matchChoice(playerText, openChoices(part, game));
  if (!choice) throw new StoryError(`That isn't one of the choices here. Pick one, or type part of it. ${AI_HINT}`);
  if (choice.check) {
    // The check's window opens first, the same as when the choice is clicked, and the story goes on once it's done.
    if (!startChoiceCheck(game, choice.say)) throw new StoryError("That choice isn't on offer any more.");
    log("player", choice.say);
    emit({ type: "state" });
    return;
  }
  log("player", choice.say);
  enterPart(game, scene, choice.to, context);
}

// ---- With an AI game master on top -------------------------------------------

// What the written story told, kept for the AI's next message: each piece is what the player did, if anything, and what
// the story said. A long run is cut to its latest, since the journal, the quests and the record say how the rest came out.
const KEPT_FOR_AI = 30000;
export function keepForAi(game, pieces) {
  game.ai ??= { provider: null, messages: [] };
  const written = (game.ai.written ??= []);
  written.push(...pieces.filter(Boolean));
  while (written.length > 1 && written.reduce((sum, entry) => sum + entry.length, 0) > KEPT_FOR_AI) written.shift();
}

// The game changes hands between the written story and the AI game master, at the player's word, from its next turn.
// Handed to the AI, it gets what the story told since the AI last read it, from the record of play, the way it gets the
// written parts in a game it runs: from the start, in a game that began written. Handed to the written story, the game
// remembers how far the AI had read. Returns whether anything changed.
export function switchStory(game, mode) {
  if (mode !== "written" && mode !== "ai") throw new Error("Choose the written story or the AI game master.");
  if ((game.mode ?? "ai") === mode) return false;
  game.ai ??= { provider: null, messages: [] };
  if (mode === "ai") {
    const runs = [];
    for (const entry of game.transcript.slice(game.ai.seenUpTo ?? 0)) {
      if (entry.role === "player") runs.push({ player: entry.text, said: [] });
      else if (entry.role === "narrator" || entry.role === "combat") {
        if (!runs.length) runs.push({ player: null, said: [] });
        const text = entry.role === "combat" ? `A fight: ${entry.text}` : withoutChoices(entry.text);
        if (text) runs.at(-1).said.push(text);
      }
    }
    keepForAi(game, runs.filter((run) => run.said.length).map((run) => `${run.player ? `The player: ${run.player}\n` : ""}${run.said.join("\n\n")}`));
  } else game.ai.seenUpTo = game.transcript.length;
  game.mode = mode;
  return true;
}

// Who answers a turn of the story in a game with an AI game master: the written story, when it has this moment
// ("written"); the AI by itself ("ai"); or the AI fitting the player's own words to the written part they're in
// ("fit"). Without an AI it's always the written story. A file that can't be read goes to the written story too,
// so that it says what's wrong instead of the AI quietly taking over.
export function storyTurnKind(game, { playerText, event, threadId }, loaded = loadScenes()) {
  if (game.mode !== "ai") return "written";
  const { scenes, broken } = loaded;
  if (event === "start") return broken[`opening_${game.role?.id ?? "captain"}`] || openingSceneId(game, scenes) ? "written" : "ai";
  if (event === "continue") {
    if (game.lastCheck && !game.lastCheck.used && game.lastCheck.source === "door" && game.doorAsked) return "written";
    if (game.arrived && scenes[`arrive_${game.arrived}`] && !game.scene) return "written";
    return game.scene ? "written" : "ai";
  }
  if (threadId) return scenes[`thread_${threadId}`] || broken[`thread_${threadId}`] ? "written" : "ai";
  if (!game.scene) return "ai";
  const part = sceneFor(game, scenes)?.parts?.[game.scene.part];
  if (!part) return "written";
  return matchChoice(playerText, openChoices(part, game)) ? "written" : "fit";
}

// What the AI is told about the part the player is in, when they've typed their own words there: what they've just
// read, without its choice lines, the writer's notes for the AI, and the choices on offer, which it answers by number.
// follow_scene fills in followed.
export function sceneBrief(game, scenes = loadScenes().scenes) {
  const scene = sceneFor(game, scenes);
  const part = scene?.parts?.[game.scene?.part];
  if (!part) return null;
  return { title: scene.title ?? game.scene.id, talk: false, text: withoutChoices(partText(part, game)), notes: part.ai ?? null, choices: openChoices(part, game), followed: undefined };
}

// The AI has fitted the player's words to one of the written choices, and the story goes on as if it had been clicked.
export function followChoice(game, choice, { emit }, scenes = loadScenes().scenes) {
  const scene = sceneFor(game, scenes);
  if (!scene) throw new StoryError(`The scene ${game.scene?.id} has gone from world\\scenes, so the story can't go on from here.`);
  const part = partOf(scene, game.scene.part, game.scene.id);
  if (choice.check) {
    // The player's own words are in the story by now, so the choice's tags are read from the part itself.
    if (!startChoiceCheck(game, choice.say, [{ role: "narrator", text: partText(part, game) }])) throw new StoryError("That choice isn't on offer any more.");
    emit({ type: "state" });
    return;
  }
  enterPart(game, scene, choice.to, { emit, turn: newTurnLimits() });
}

// ---- Checking a scene --------------------------------------------------------

const GOES_TO = ["to", "pass", "fail", "won", "lost", "fled", "gaveUp", "talked"];

function checkProblem(text) {
  const [skill, difficulty, audience] = String(text).split(":");
  if (!SKILLS[skill]) return `unknown skill ${skill}`;
  if (!(difficulty in DIFFICULTY)) return `unknown difficulty ${difficulty}`;
  if (audience !== undefined && !audience) return "an empty audience";
  return null;
}

// Everything wrong with a scene, in plain words, so a mistake is found before anyone plays it. Each
// problem names the file's line when the scene came from a text file. A conversation (talk_<person>)
// has no checks or fights, and a part with nothing more to say is where it ends.
export function sceneProblems(scene, id = "the scene", { talk = false } = {}) {
  const problems = [];
  const parts = scene?.parts ?? {};
  const at = (holder, where) => (holder?.line ? `${where} (line ${holder.line})` : where);
  if (!scene?.start) problems.push(`${id} doesn't say which part it starts at`);
  else if (!parts[scene.start]) problems.push(`${id} starts at ${scene.start}, which isn't a part`);
  const reached = new Set();
  const stack = scene?.start && parts[scene.start] ? [scene.start] : [];
  while (stack.length) {
    const name = stack.pop();
    if (reached.has(name)) continue;
    reached.add(name);
    const part = parts[name];
    for (const key of GOES_TO) if (part[key] && parts[part[key]]) stack.push(part[key]);
    for (const rule of part.when ?? []) if (parts[rule.to]) stack.push(rule.to);
    for (const choice of part.choices ?? []) for (const key of GOES_TO) if (choice[key] && parts[choice[key]]) stack.push(choice[key]);
  }
  const condition = (text, what) => {
    for (const found of parseCondition(text).problems) problems.push(`${what}: ${found}`);
  };
  for (const [name, part] of Object.entries(parts)) {
    const where = at(part, `${id}, part ${name}`);
    if (!reached.has(name)) problems.push(`${where} can't be reached`);
    const text = (Array.isArray(part.text) ? part.text : [part.text]).filter(Boolean);
    const goes = (holder, what) => {
      for (const key of GOES_TO) if (holder[key] !== undefined && !parts[holder[key]]) problems.push(`${what} goes to ${holder[key]}, which isn't a part`);
    };
    goes(part, where);
    for (const rule of part.when ?? []) {
      const what = at(rule, `${where}, rule`);
      if (!parts[rule.to]) problems.push(`${what} goes to ${rule.to}, which isn't a part`);
      if (rule.if) condition(rule.if, what);
    }
    const always = (part.when ?? []).some((rule) => !rule.if);
    // A fight brings its own lead-in, and a check its own window, so those parts can stand without text.
    if (!text.length && !part.note && !always && !part.check && !part.fight) problems.push(`${where} has no text`);
    if (talk && (part.check || part.fight)) problems.push(`${where} has a ${part.check ? "check" : "fight"}, and a conversation can't open one: put it in a scene instead`);
    if (part.check && !talk) {
      const problem = checkProblem(part.check);
      if (problem) problems.push(`${where} has ${problem}`);
      if (!part.pass || !part.fail) problems.push(`${where} has a check, so it needs pass and fail`);
    }
    if (part.fight && !talk) {
      const problem = toolProblem("start_combat", part.fight);
      if (problem) problems.push(`${where}: the fight ${problem}`);
      if (!part.won || !part.lost) problems.push(`${where} has a fight, so it needs won and lost`);
    }
    if (!talk && !part.check && !part.fight && !part.end && !always && !(part.choices ?? []).length) problems.push(`${where} has no choices and doesn't end the scene`);
    for (const [i, step] of (part.do ?? []).entries()) {
      const { tool, set, clear, ending, failed: _failed, text: _text, line: _line, ...input } = step;
      if (ending) {
        const story = !talk && id.startsWith("thread_") ? WORLD_THREADS[id.slice("thread_".length)] : null;
        const names = endingsOf(story).map((one) => one.id);
        if (!story) problems.push(`${at(step, `${where}, effect ${i + 1}`)}: ending belongs in a story's own scene, thread_<story>.txt, and this isn't one`);
        else if (!names.includes(ending)) problems.push(`${at(step, `${where}, effect ${i + 1}`)}: ${id.slice("thread_".length)} has no ending called ${ending}. Its endings are ${names.join(", ")}`);
        continue;
      }
      if (set || clear) {
        if (!/^[a-z][a-z0-9_]{1,39}$/.test(set ?? clear)) problems.push(`${at(step, `${where}, effect ${i + 1}`)}: a flag's name is lowercase letters, digits and underscores, like told_the_fleet`);
        continue;
      }
      const problem = toolProblem(tool, input);
      if (problem) problems.push(`${at(step, `${where}, effect ${i + 1}`)}: ${problem}`);
    }
    for (const [i, choice] of (part.choices ?? []).entries()) {
      const what = at(choice, `${where}, choice ${i + 1}`);
      if (!choice.say) problems.push(`${what} has no words`);
      goes(choice, what);
      if (choice.if) condition(choice.if, what);
      if (choice.check && talk) problems.push(`${what} has a check, and a conversation can't open one: put it in a scene instead`);
      else if (choice.check) {
        const problem = checkProblem(choice.check);
        if (problem) problems.push(`${what} has ${problem}`);
        if (!choice.pass || !choice.fail) problems.push(`${what} has a check, so it needs pass and fail`);
      } else if (!choice.to) problems.push(`${what} doesn't say where it goes`);
    }
  }
  return problems;
}

// Every problem in the whole folder, for the checker and the tests: files that can't be read, and scenes that can.
export function allSceneProblems(dir = SCENES_DIR) {
  const { scenes, problems } = loadScenes(dir);
  const found = problems.map((one) => `${one.file}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  for (const [id, scene] of Object.entries(scenes)) found.push(...sceneProblems(scene, id, { talk: id.startsWith("talk_") }));
  return { count: Object.keys(scenes).length, problems: found };
}

// Every fact something in the world can leave on the record: a story's notes name it, a scene sets it with * flag,
// or a door sets it when the player goes through.
export function factsLeft(scenes) {
  const names = new Set([...Object.keys(FACT_LINES), ...clockFacts()]);
  for (const scene of Object.values(scenes)) for (const part of Object.values(scene.parts ?? {})) for (const step of part.do ?? []) if (step.set) names.add(step.set);
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.flag === "string") names.add(node.flag);
    for (const child of Object.values(node)) walk(child);
  };
  walk(WORLD_MAPS);
  return names;
}

// The scenes and the stories' notes together: what one file says about another is checked here, so a scene can't
// wait on a fact nothing leaves, and a story's notes can't react to one.
export function allStoryProblems(dir = SCENES_DIR) {
  const { count, problems } = allSceneProblems(dir);
  const { scenes } = loadScenes(dir);
  const known = factsLeft(scenes);
  const flagsIn = (text) => parseCondition(text).terms.filter((term) => term.kind === "flag").map((term) => term.id);
  for (const [id, scene] of Object.entries(scenes)) {
    for (const [name, part] of Object.entries(scene.parts ?? {})) {
      const conditions = [...(part.when ?? []).map((rule) => rule.if), ...(part.choices ?? []).map((choice) => choice.if)].filter(Boolean);
      for (const text of conditions) for (const flag of flagsIn(text)) if (!known.has(flag)) problems.push(`${id}, part ${name}: nothing leaves the fact ${flag}. Set it with * flag in a scene, or name it in a story's facts in world/stories`);
    }
  }
  problems.push(...STORY_FILE_PROBLEMS, ...WORLD_FILE_PROBLEMS, ...notesProblems(known), ...clockProblems(known), ...computerProblems(), ...systemsProblems());
  return { count, stories: Object.keys(WORLD_THREADS).length, computers: Object.keys(WORLD_COMPUTERS).length, systems: placesWithSystems(), problems };
}
