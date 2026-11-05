// Skill checks that play out in their own window. Each skill has its own little game, which runs
// entirely on this computer. In most of them, playing well improves the odds of the final roll;
// in a decided one, like hacking, what happens in the window is the result, with no roll on top.
// Either way the result goes to the game master along with what happened, so the AI isn't called
// until it's over.

import { findCharacter } from "./campaign.js";
import { CONTEXTS, FACTION_BELIEFS, POLES, SKILLS } from "./character-data.js";
import { STATS } from "./data.js";
import { CHECK_TEXT } from "./world.js";
import { recordFact } from "./record.js";
import { DIFFICULTY, DIFFICULTY_LEARNING, attrMod, audienceBonus, checkParts, clamp, fxOf, oddsFor, practice, skillCheck, skillRank } from "./rules.js";
import { isCaptain, startOf } from "./role.js";
import { buildVocab, parseOption } from "../public/story.js";
import { closest, say } from "./check-games/kit.js";
import appeal from "./check-games/appeal.js";
import balance from "./check-games/balance.js";
import codebreak from "./check-games/codebreak.js";
import cover from "./check-games/cover.js";
import crack, { allClasses } from "./check-games/crack.js";
import duel from "./check-games/duel.js";
import haggle from "./check-games/haggle.js";
import plain from "./check-games/plain.js";
import push from "./check-games/push.js";
import route from "./check-games/route.js";
import runner from "./check-games/runner.js";
import scan from "./check-games/scan.js";
import sneak from "./check-games/sneak.js";
import switches from "./check-games/switches.js";
import target from "./check-games/target.js";
import tune from "./check-games/tune.js";

export const CHECK_GAMES = { appeal, balance, codebreak, cover, crack, duel, haggle, plain, push, route, runner, scan, sneak, switches, target, tune };

const LEVELS = { easy: 0, moderate: 1, hard: 2, very_hard: 3, nearly_impossible: 4 };
// How much the player's work in the window can move the final roll. Each point is worth 5%.
export const MAX_EDGE = 6;
export const MIN_EDGE = -4;
const MAX_LOG = 200;
const RUN_WORDS = new Set(["run", "commit", "execute", "exec", "go!", "finish", "roll", "done"]);

// What a raw attribute check plays like, when no skill is involved.
const ATTRIBUTE_SKILLS = { might: "athletics", endurance: "survival", agility: "athletics", perception: "awareness", intellect: "science", willpower: "composure", presence: "persuasion", resonance: "attunement" };

// How much a character's training helps, from 0 (untrained) to 4 (a master).
export function tierFor(game, skill, attribute) {
  if (!skill) {
    const mod = attrMod(game, attribute);
    return clamp(mod <= 0 ? 0 : mod <= 2 ? 1 : mod <= 4 ? 2 : 3, 0, 4);
  }
  const trained = skillRank(game, skill) + Math.min(4, Math.max(0, fxOf(game, "skills", skill)));
  const tier = trained <= 0 ? 0 : trained <= 2 ? 1 : trained <= 5 ? 2 : trained <= 8 ? 3 : 4;
  return clamp(tier + fxOf(game, "windowTier", skill), 0, 4);
}

function textFor(skill, attribute) {
  const id = skill ?? ATTRIBUTE_SKILLS[attribute];
  return { id, ...(CHECK_TEXT.skills?.[id] ?? { game: "plain", theme: "green", window: `${SKILLS[id]?.name ?? "Skill"} Check` }) };
}

// Everything a game needs to know about the check it's running.
function contextFor(game, check) {
  const text = textFor(check.skill, check.attribute);
  const person = check.audience ? findCharacter(game.campaign, check.audience) : null;
  return {
    level: LEVELS[check.difficulty],
    difficulty: check.difficulty,
    tier: check.tier,
    text,
    check,
    relationship: check.audience ? audienceBonus(game, check.audience) : 0,
    audienceName: person?.name ?? null,
    hasGear: (id) => Boolean(game.inventory?.[id]),
    polesFor: (id) => (POLES[id] ? { axis: POLES[id].axis, sign: POLES[id].sign } : null),
    audienceBeliefs: () => {
      if (!check.audience) return null;
      return FACTION_BELIEFS[check.audience] ?? person?.beliefs ?? null;
    },
  };
}

const gameFor = (check) => CHECK_GAMES[check.game] ?? plain;

function refreshEdge(check, ctx) {
  check.edge = clamp(gameFor(check).edge(check.state, ctx), MIN_EDGE, MAX_EDGE);
}

// Opens the window for a check. source says where it came from: a tagged choice the player
// clicked, the game master asking for one, or practice, which doesn't count for anything.
export function startCheck(game, { skill = null, attribute = null, difficulty, context = [], audience = null, reason, scene = null, choice = null, source = "tool", computer = null }) {
  if (game.check) throw new Error("Finish the check you're in the middle of first.");
  if (game.combat) throw new Error("Finish the fight first.");
  if (game.computer) throw new Error("Log off the computer first.");
  // A hack has no audience: a third word on its tag names the computer it's for, so getting in opens that one.
  if (skill === "hacking" && audience) {
    computer ??= audience;
    audience = null;
  }
  if (!(difficulty in DIFFICULTY)) throw new Error(`Unknown difficulty: ${difficulty}`);
  if (skill && !SKILLS[skill]) throw new Error(`Unknown skill: ${skill}`);
  if (!skill && !STATS[attribute]) throw new Error("A check needs a skill or an attribute.");
  const text = textFor(skill, attribute);
  const check = {
    id: Date.now(),
    skill,
    attribute,
    difficulty,
    context: context.filter((id) => CONTEXTS[id]),
    audience,
    reason: reason || text.window,
    scene,
    choice,
    source,
    game: CHECK_GAMES[text.game] ? text.game : "plain",
    tier: tierFor(game, skill, attribute),
    edge: 0,
    log: [],
    state: null,
    decided: Boolean(CHECK_GAMES[text.game]?.decided),
    played: false,
    computer,
  };
  const ctx = contextFor(game, check);
  const engine = gameFor(check);
  check.state = engine.start(ctx);
  check.log.push(...engine.intro(check.state, ctx));
  if (check.decided) check.log.push(say("What you do here decides it. Get in and you've succeeded; let the trace complete and you're caught. Disconnect gives up.", "dim"));
  else check.log.push(say(`The better you do here, the better your odds. "${text.runLabel ?? "Commit"}" makes the final roll, whenever you're ready.`, "dim"));
  refreshEdge(check, ctx);
  game.check = check;
  return check;
}

// The classes of computer a hack can be up against, for the practice picker.
export const hackingClasses = () => allClasses(CHECK_TEXT.skills?.hacking).map(({ difficulty, name }) => ({ difficulty, name }));

// The player clicked a choice that's tagged with a check. Whatever they clicked has to be on offer
// right now, and its tags come from what the game master wrote, not from the browser.
export function startChoiceCheck(game, label, entries = game.transcript) {
  const vocab = buildVocab(SKILLS);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry.role === "player" || entry.role === "combat") break;
    if (entry.role !== "narrator") continue;
    for (const raw of entry.text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith(">"))) {
      const option = parseOption(raw.slice(1).trim(), vocab);
      if (option.label !== label) continue;
      const tag = option.tags.find((one) => one.kind === "check" && one.difficulty);
      if (!tag) return null;
      return startCheck(game, { skill: tag.skill, difficulty: tag.difficulty, audience: tag.audience ?? null, reason: label, choice: raw, source: "choice" });
    }
  }
  return null;
}

const breakdown = (parts) => parts.map((p) => `${p.value < 0 ? "-" : "+"} ${p.label} ${Math.abs(p.value)}`).join(" ");

const resultLabel = (r) => (r.success ? (r.die === 20 ? "CRITICAL SUCCESS" : "SUCCESS") : r.die === 1 ? "CRITICAL FAILURE" : "FAILURE");

// A short name for a fact on the record, from a class of computer: "Ship's main system" becomes ships_main_system.
const slug = (words) => String(words).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

// The result of a decided game, read from how it ended: no die, and the skill still learns from it.
function decidedResult(game, check, practiceOnly) {
  const { state } = check;
  const success = Boolean(state.cracked);
  const { parts, total: bonus } = checkParts(game, { skill: check.skill, attribute: check.attribute, context: check.context, audience: check.audience });
  const notes = [];
  if (!practiceOnly && check.skill) notes.push(...practice(game, check.skill, (success ? 3 : 2) * DIFFICULTY_LEARNING[check.difficulty]));
  const pct = Math.round((state.trace / Math.max(1, state.maxTrace)) * 100);
  const label = success ? "ACCESS GRANTED" : state.quit ? "DISCONNECTED" : "TRACED";
  return { die: null, parts, bonus, total: null, dc: DIFFICULTY[check.difficulty], success, margin: 0, critical: false, notes, label, math: `trace ${pct}%` };
}

// Closes the window's game and records what happened: a decided game by how it ended, any other by
// the final roll.
function finishCheck(game) {
  const check = game.check;
  const ctx = contextFor(game, check);
  refreshEdge(check, ctx);
  const practiceOnly = check.source === "practice";
  const decided = Boolean(check.decided && check.state.done);
  const r = decided ? decidedResult(game, check, practiceOnly) : skillCheck(game, {
    skill: check.skill, attribute: check.attribute, difficulty: check.difficulty, context: check.context, audience: check.audience, edge: check.edge, practiceOnly,
  });
  const label = decided ? r.label : resultLabel(r);
  const math = decided ? r.math : `${r.die} ${breakdown(r.parts)} = ${r.total} vs ${r.dc}`;
  const story = gameFor(check).story(check.state, ctx);
  const titles = ctx.text.results ?? {};
  // A completed trace on an important computer leaves a mark that the stories can read.
  if (decided && !r.success && !check.state.quit && check.state.mark && !practiceOnly) {
    const id = `traced_on_${slug(check.state.className)}`;
    try {
      recordFact(game, { id, text: `The trace on a ${String(check.state.className).toLowerCase()} has your name on it.`, from: "hacking" });
      r.notes.push(`[RECORD] The trace has your name: ${id.replaceAll("_", " ")}.`);
    } catch {
      // A full record keeps its facts; the check still ended the same way.
    }
  }
  const outcome = {
    id: check.id,
    success: r.success,
    critical: r.critical,
    decided,
    die: r.die,
    total: r.total,
    dc: r.dc,
    margin: r.margin,
    label,
    math,
    title: r.success ? titles.success ?? "SUCCESS" : titles.failure ?? "FAILURE",
    line: r.success ? titles.successLine ?? "" : decided && check.state.quit ? titles.quitLine ?? titles.failureLine ?? "" : titles.failureLine ?? "",
    story,
    reason: check.reason,
    training: practiceOnly,
    skill: check.skill,
    difficulty: check.difficulty,
    classLabel: check.state?.className ?? null,
    log: check.log,
    theme: ctx.text.theme,
    window: ctx.text.window,
    notes: r.notes,
    // A hack that got in opens the computer: which one, and how much of the trace is left for inside.
    hack: decided && check.skill === "hacking" ? { computer: check.computer ?? null, source: check.source, classKey: check.difficulty, trace: check.state.trace, maxTrace: check.state.maxTrace } : null,
  };
  game.check = null;
  if (practiceOnly) return { over: true, outcome };
  // Work on a part of the place's systems is settled by src/systems.js, which says what came of it; neither the written
  // story nor the AI is waiting on it.
  if (check.source === "part") {
    game.transcript.push({ role: "notice", text: [decided ? `[HACK] ${check.reason}: ${label}, ${math}` : `[ROLL] ${check.reason}: ${math}: ${label}`, ...r.notes].join("\n") });
    return { over: true, outcome };
  }
  // The written story reads this to decide where it goes next. The AI reads the event below instead.
  game.lastCheck = { id: check.id, skill: check.skill, difficulty: check.difficulty, success: r.success, reason: check.reason, source: check.source, used: false };
  const taken = check.choice ? `The player took this choice from your last message: ${check.choice}\nThe game ran the check in its own window, so don't call roll_check for it.` : `The check you asked for is done: ${check.reason}.`;
  if (decided) {
    game.transcript.push({ role: "notice", text: [`[HACK] ${check.reason}: ${label}, ${math}`, ...r.notes].join("\n") });
    game.pendingEvents.push(`${taken} Result: ${r.success ? "SUCCESS" : "FAILURE"} (${label.toLowerCase()}). How it went: ${story} Narrate this outcome faithfully.`);
    return { over: true, outcome };
  }
  game.transcript.push({ role: "notice", text: [`[ROLL] ${check.reason}: ${math}: ${label}`, ...r.notes].join("\n") });
  const margin = `by ${Math.abs(r.margin)}`;
  game.pendingEvents.push(`${taken} Result: ${label} ${margin}. Rolled ${math}. How it went: ${story} Narrate this outcome faithfully, and let a large margin make it more dramatic.`);
  return { over: true, outcome };
}

// Does one command from the console, typed or clicked.
export function checkCommand(game, raw) {
  const check = game.check;
  if (!check) throw new Error("There's no check going on.");
  const text = String(raw ?? "").trim().slice(0, 80);
  if (!text) return { over: false };
  const ctx = contextFor(game, check);
  const engine = gameFor(check);
  const words = text.toLowerCase().split(/\s+/);
  check.log.push({ you: text });
  if (RUN_WORDS.has(words[0])) {
    // A decided game has no roll once it's under way. Before anything's been done, "roll" is the
    // player's choice of a plain roll instead of the game, which Settings offers.
    if (check.decided && !check.state.done && check.played) {
      check.log.push(say("There's no roll here. Find the password, or type disconnect to give up.", "dim"));
      return { over: false };
    }
    return finishCheck(game);
  }
  if (words[0] === "help" || words[0] === "?") {
    const { commands } = engine.view(check.state, ctx);
    const names = commands.map((entry) => entry.label).join(", ");
    const ending = check.decided ? "Get in and it's done. Type disconnect to give up." : "Type run, or press the button at the bottom, when you're ready to make the final roll.";
    check.log.push(say(ctx.text.help ?? "Click what you want to do, or type it.", "info"), say(`${names ? `Commands: ${names}. ` : ""}${ending}`, "dim"));
    return { over: false };
  }
  if (words[0] === "clear" || words[0] === "cls") {
    check.log = [];
    return { over: false };
  }
  // Words every plain object answers to would look like commands to the games that look words up.
  let lines = words[0] in Object.prototype ? null : engine.act(check.state, ctx, words);
  if (lines === null) {
    // What's on the buttons should work when it's typed, even if only part of it is.
    const shown = engine.view(check.state, ctx).commands.filter((entry) => !entry.disabled);
    const match = closest(text, [...new Set(shown.flatMap((entry) => [entry.label, entry.command]))]);
    const entry = shown.find((one) => one.label === match || one.command === match);
    if (entry) lines = engine.act(check.state, ctx, entry.command.toLowerCase().split(/\s+/));
  }
  if (lines === null) {
    check.log.push(say(`command not found: ${words[0]}. Type help, or click one of the commands.`, "dim"));
    return { over: false };
  }
  check.log.push(...lines);
  if (check.log.length > MAX_LOG) check.log.splice(0, check.log.length - MAX_LOG);
  check.played = true;
  refreshEdge(check, ctx);
  if (check.state.forced) return finishCheck(game);
  return { over: false };
}

// What the browser gets to see. The game's state stays here, so the answer can't leak out.
export function checkView(game) {
  const check = game.check;
  if (!check) return null;
  const ctx = contextFor(game, check);
  const engine = gameFor(check);
  const { parts, total: bonus } = checkParts(game, { skill: check.skill, attribute: check.attribute, context: check.context, audience: check.audience });
  const shown = engine.view(check.state, ctx);
  const dc = DIFFICULTY[check.difficulty];
  return {
    id: check.id,
    skill: check.skill ?? check.attribute,
    skillName: SKILLS[check.skill]?.name ?? STATS[check.attribute],
    theme: ctx.text.theme ?? "green",
    window: ctx.text.window ?? "Skill Check",
    runLabel: ctx.text.runLabel ?? "Commit",
    prompt: (isCaptain(game) ? ctx.text.prompt : ctx.text.promptOther ?? ctx.text.prompt) ?? (isCaptain(game) ? "captain@meridian:~$" : `${startOf(game).short.replaceAll(" ", "-")}@${game.location.replaceAll("_", "-")}:~$`),
    reason: check.reason,
    scene: check.scene,
    difficulty: check.difficulty,
    classLabel: check.state?.className ?? null,
    decided: Boolean(check.decided),
    training: check.source === "practice",
    source: check.source,
    tier: check.tier,
    tierName: (CHECK_TEXT.tierNames ?? ["untrained", "novice", "trained", "expert", "master"])[check.tier],
    dc,
    bonus,
    parts,
    edge: check.edge,
    odds: oddsFor(bonus + check.edge, dc),
    baseOdds: oddsFor(bonus, dc),
    done: Boolean(check.state.done),
    log: check.log,
    panels: shown.panels,
    commands: shown.commands,
    typedNumbers: Boolean(shown.typedNumbers),
    meters: shown.meters,
    hints: shown.hints ?? [],
  };
}
