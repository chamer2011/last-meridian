// Conversations without the AI. Someone with a file called talk_<their id>.txt in world/scenes answers in
// their own written words, in the same parts and choices as a scene. Everyone else gets stock lines, put
// together from who they are and what they're doing, from the templates in world/rooms.json. Either way
// the clock stays still, nothing goes to the AI, and the person's words come up in the talk window the
// same as the AI's would.

import { findCharacter } from "./campaign.js";
import { clearFact, recordFact } from "./record.js";
import { toOutsider } from "./role.js";
import { HELPERS, StoryError, loadScenes, matchChoice, openChoices, partText, ruleThatHolds, withoutChoices } from "./scenes.js";
import { newTurnLimits, runTool } from "./tools.js";
import { seedFrom, talkHeard, walkView } from "./walk.js";
import { ROOM_TALK } from "./world.js";
import { systemsTalk } from "./systems.js";

const helpersFor = (talk) => ({ ...HELPERS, seen: talk.written?.seen ?? [] });

const pick = (list, seed) => (Array.isArray(list) && list.length ? list[seed % list.length] : null);
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : text);
const fill = (text, values) => String(text).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");

// ---- Stock lines, for anyone without a conversation of their own ---------------

// A small conversation made from what the game knows: how they feel about the player, what they do, and where this is.
export function stockTalk(game, talk) {
  const stock = ROOM_TALK.stock ?? {};
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  const seed = seedFrom(talk.name);
  const contact = game.contacts?.find((one) => one.name.toLowerCase() === (person?.name ?? talk.name).toLowerCase());
  const feeling = talk.asleep ? "neutral" : contact?.attitude ?? "unmet";
  const role = toOutsider(game, person?.role) ?? null;
  const values = { name: talk.short, role: role ? lowerFirst(role) : "", doing: talk.doing ? lowerFirst(talk.doing) : "", desc: walkView(game)?.here?.desc ?? "" };
  const asks = stock.asks ?? {};
  const answers = [];
  if (role && asks.work && stock.work) answers.push(["work", asks.work, `@${talk.name}: "${fill(pick(stock.work, seed), values)}"`]);
  if (talk.doing && asks.doing && stock.doing) answers.push(["doing", asks.doing, `@${talk.name}: "${fill(pick(stock.doing, seed + 1), values)}"`]);
  if (values.desc && asks.place && stock.place) answers.push(["place", asks.place, fill(pick(stock.place, seed + 2), values)]);
  // When the alarm's ringing or the lights are out, that's what everyone wants to talk about.
  const news = systemsTalk(game);
  if (news) answers.push(["systems", asks.systems ?? "What's going on?", `@${talk.name}: "${news}"`]);
  const choices = answers.map(([id, say]) => ({ say, to: id, if: `not seen ${id}` }));
  const greet = fill(pick(stock.greet?.[feeling] ?? stock.greet?.neutral ?? ['"Yes?"'], seed + 3), values);
  const parts = { start: { text: [`@${talk.name}: ${greet}`], choices } };
  for (const [id, , text] of answers) parts[id] = { text: [text], choices };
  return { title: `Talking with ${talk.name}`, start: "start", parts };
}

// ---- Playing a conversation --------------------------------------------------------

function sceneOf(game, talk) {
  if (talk.written?.stock) return talk.written.stock;
  const scene = loadScenes().scenes[talk.written?.id];
  if (!scene) throw new StoryError(`The conversation file ${talk.written?.id} has gone, or can't be read any more. Run npm run check-story to see why.`);
  return scene;
}

// Says one part: its text and choices go in the window, and what it changes goes through the same tools as the AI.
function enterTalkPart(game, talk, scene, id, emit, hops = 0) {
  const part = scene.parts[id];
  if (!part) throw new Error(`The conversation ${talk.written.id ?? "with " + talk.name} has no part called ${id}.`);
  const rule = ruleThatHolds(part, game, helpersFor(talk));
  if (rule) {
    if (hops > 20) throw new Error(`The conversation ${talk.written.id} goes round in circles from ${id}.`);
    return enterTalkPart(game, talk, scene, rule.to, emit, hops + 1);
  }
  talk.written.part = id;
  if (!talk.written.seen.includes(id)) talk.written.seen.push(id);
  const text = partText(part, game, helpersFor(talk));
  if (text) emit({ type: "text", text });
  if (part.note) emit({ type: "notice", text: part.note });
  game.flags ??= {};
  const turn = { ...newTurnLimits(), talking: true };
  for (const step of part.do ?? []) {
    const { tool, set, clear, line: _line, ...input } = step;
    if (set) {
      recordFact(game, { id: set, text: step.text ?? null, from: talk.written?.id ?? null });
      continue;
    }
    if (clear) {
      clearFact(game, clear);
      continue;
    }
    // Only a story's own scene ends it, and the checker says so; a conversation's * ending line does nothing.
    if (step.ending) continue;
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`In the conversation ${talk.written.id}, part ${id}, ${tool} failed: ${outcome.result}`);
    if (outcome.narration) emit({ type: "text", text: outcome.narration });
    if (outcome.notice) emit({ type: "notice", text: outcome.notice });
  }
  emit({ type: "state" });
}

// The talk window has just opened. The person speaks first, in their written words or in stock ones. With an AI game
// master (filesOnly), only someone with a conversation of their own speaks from a file, and the AI plays everyone
// else, so this says whether anyone spoke.
export function openWrittenTalk(game, { filesOnly = false } = {}) {
  const talk = game.talk;
  if (!talk) return false;
  const id = talk.personId ? `talk_${talk.personId}` : null;
  const { scenes, broken } = loadScenes();
  const own = id ? scenes[id] ?? null : null;
  if (filesOnly && !own) return false;
  talk.written = { id: own ? id : null, part: null, seen: [], stock: own ? null : stockTalk(game, talk) };
  if (id && broken[id]) talkHeard(game, `[STORY] The conversation file ${id} can't be read: ${broken[id]}. Stock lines are used instead.`, "notice");
  const emit = (e) => {
    if (e.type === "text") talkHeard(game, e.text);
    if (e.type === "notice") talkHeard(game, e.text, "notice");
  };
  enterTalkPart(game, talk, own ?? talk.written.stock, (own ?? talk.written.stock).start, emit);
  return true;
}

// One thing said in a written conversation. emit() streams the answer, the way an AI turn would.
export function writtenTalkTurn({ game, playerText, emit }) {
  const talk = game.talk;
  if (!talk?.written) throw new StoryError("This conversation didn't start in writing. Close it and open it again.");
  const scene = sceneOf(game, talk);
  const part = scene.parts[talk.written.part];
  if (!part) throw new StoryError("The conversation has lost its place. Close it and open it again.");
  const choice = matchChoice(playerText, openChoices(part, game, helpersFor(talk)));
  if (!choice) throw new StoryError("That isn't one of the things to say here. Pick one from the list.");
  if (choice.check) throw new StoryError("A conversation can't open a check. That's a mistake in the file: run npm run check-story.");
  enterTalkPart(game, talk, scene, choice.to, emit);
}

// ---- With an AI game master on top --------------------------------------------------

// Who answers a line in a talk with an AI game master: the written conversation, when the line is one of its own
// ("written"); the AI fitting the player's words to it ("fit"); or the AI by itself, for anyone without a conversation
// of their own ("ai"). Without an AI it's always written.
export function talkTurnKind(game, playerText) {
  if (game.mode !== "ai") return "written";
  const talk = game.talk;
  if (!talk?.written) return "ai";
  const part = sceneOf(game, talk).parts[talk.written.part];
  if (!part) return "written";
  return matchChoice(playerText, openChoices(part, game, helpersFor(talk))) ? "written" : "fit";
}

// What the AI is told about a written conversation when the player types their own words in it: what the person
// has just said, the writer's notes for the AI, and the lines the player could say, which it answers by number.
export function talkSceneBrief(game) {
  const talk = game.talk;
  if (!talk?.written) return null;
  const scene = sceneOf(game, talk);
  const part = scene.parts[talk.written.part];
  if (!part) return null;
  const helpers = helpersFor(talk);
  return { title: scene.title ?? `Talking with ${talk.name}`, talk: true, text: withoutChoices(partText(part, game, helpers)), notes: part.ai ?? null, choices: openChoices(part, game, helpers), followed: undefined };
}

// The AI has fitted what the player said to one of the written lines, and the person answers it as written.
export function followTalkChoice(game, choice, emit) {
  const talk = game.talk;
  enterTalkPart(game, talk, sceneOf(game, talk), choice.to, emit);
}
