// Skill checks that play out in their own window. Each skill has its own little game, which runs
// entirely on this computer. Playing it well improves the odds of the final roll, and the
// result goes to the game master along with what happened, so the AI isn't called until it's over.

import { findCharacter } from "./campaign.js";
import { CONTEXTS, FACTION_BELIEFS, POLES, SKILLS } from "./character-data.js";
import { STATS } from "./data.js";
import { CHECK_TEXT } from "./world.js";
import { DIFFICULTY, attrMod, audienceBonus, checkParts, clamp, fxOf, oddsFor, skillCheck, skillRank } from "./rules.js";
import { isCaptain, startOf } from "./role.js";
import { buildVocab, parseOption } from "../public/story.js";
import { closest, say } from "./check-games/kit.js";
import appeal from "./check-games/appeal.js";
import balance from "./check-games/balance.js";
import codebreak from "./check-games/codebreak.js";
import cover from "./check-games/cover.js";
import crack from "./check-games/crack.js";
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
export function startCheck(game, { skill = null, attribute = null, difficulty, context = [], audience = null, reason, scene = null, choice = null, source = "tool" }) {
  if (game.check) throw new Error("Finish the check you're in the middle of first.");
  if (game.combat) throw new Error("Finish the fight first.");
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
  };
  const ctx = contextFor(game, check);
  const engine = gameFor(check);
  check.state = engine.start(ctx);
  check.log.push(...engine.intro(check.state, ctx));
  check.log.push(say(`The better you do here, the better your odds. "${text.runLabel ?? "Commit"}" makes the final roll, whenever you're ready.`, "dim"));
  refreshEdge(check, ctx);
  game.check = check;
  return check;
}

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

// Makes the final roll, closes the window's game, and records what happened.
function finishCheck(game) {
  const check = game.check;
  const ctx = contextFor(game, check);
  refreshEdge(check, ctx);
  const practiceOnly = check.source === "practice";
  const r = skillCheck(game, {
    skill: check.skill, attribute: check.attribute, difficulty: check.difficulty, context: check.context, audience: check.audience, edge: check.edge, practiceOnly,
  });
  const label = resultLabel(r);
  const math = `${r.die} ${breakdown(r.parts)} = ${r.total} vs ${r.dc}`;
  const story = gameFor(check).story(check.state, ctx);
  const titles = ctx.text.results ?? {};
  const outcome = {
    id: check.id,
    success: r.success,
    critical: r.critical,
    die: r.die,
    total: r.total,
    dc: r.dc,
    margin: r.margin,
    label,
    math,
    title: r.success ? titles.success ?? "SUCCESS" : titles.failure ?? "FAILURE",
    line: r.success ? titles.successLine ?? "" : titles.failureLine ?? "",
    story,
    reason: check.reason,
    training: practiceOnly,
    skill: check.skill,
    difficulty: check.difficulty,
    log: check.log,
    theme: ctx.text.theme,
    window: ctx.text.window,
    notes: r.notes,
  };
  game.check = null;
  if (practiceOnly) return { over: true, outcome };
  // The written story reads this to decide where it goes next. The AI reads the event below instead.
  game.lastCheck = { id: check.id, skill: check.skill, difficulty: check.difficulty, success: r.success, reason: check.reason, source: check.source, used: false };
  game.transcript.push({ role: "notice", text: [`[ROLL] ${check.reason}: ${math}: ${label}`, ...r.notes].join("\n") });
  const margin = `by ${Math.abs(r.margin)}`;
  const taken = check.choice ? `The player took this choice from your last message: ${check.choice}\nThe game ran the check in its own window, so don't call roll_check for it.` : `The check you asked for is done: ${check.reason}.`;
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
  if (RUN_WORDS.has(words[0])) return finishCheck(game);
  if (words[0] === "help" || words[0] === "?") {
    const { commands } = engine.view(check.state, ctx);
    const names = commands.map((entry) => entry.label).join(", ");
    check.log.push(say(ctx.text.help ?? "Click what you want to do, or type it.", "info"), say(`${names ? `Commands: ${names}. ` : ""}Type run, or press the button at the bottom, when you're ready to make the final roll.`, "dim"));
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
    training: check.source === "practice",
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
  };
}
