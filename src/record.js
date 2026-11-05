// The record: what the player did in each story, and the lasting facts that left, kept in the save so that every
// story that comes after can read it. The written story's flags are facts on it, the AI puts facts and endings
// on it through two checked tools, the Quests menu shows it, and the AI reads it in its state every turn. It's the
// game's memory of consequences, which the journal, being prose, isn't.

import { noteThreadEnded, storyOf } from "./story-library.js";
import { FACT_LINES, WORLD_THREADS, endingsOf } from "./world.js";

export const FACT_ID = /^[a-z][a-z0-9_]{1,39}$/;
export const MAX_FACTS = 300;
export const FACTS_PER_TURN = 3;

// Flags from before the record existed, as facts with no words, so that an older save's flags show on it too.
const flagFacts = (game, facts) => Object.keys(game.flags ?? {})
  .filter((id) => !facts.some((fact) => fact.id === id))
  .map((id) => ({ id, text: null, from: null, day: null }));

// The record as it stands, read without writing anything to the save: showing the game must change nothing.
export function readRecord(game) {
  const record = game.story?.record;
  const facts = record?.facts ?? [];
  return { endings: record?.endings ?? {}, facts: [...facts, ...flagFacts(game, facts)] };
}

// The record in this save, made the first time something's written on it. Older flags join it by name then.
export function recordOf(game) {
  const story = storyOf(game);
  story.record ??= { endings: {}, facts: [] };
  story.record.endings ??= {};
  story.record.facts ??= [];
  story.record.facts.push(...flagFacts(game, story.record.facts));
  return story.record;
}

const dayOf = (game) => Math.floor((game.clock?.hours ?? 0) / 24) + 1;

// Puts a fact on the record: a short name, and a line of plain words if there is one. It sets the flag of the same
// name, which conditions read. Saying a fact again only gives it words it didn't have.
export function recordFact(game, { id, text = null, from = null }) {
  if (!FACT_ID.test(id ?? "")) throw new Error("A fact's name is lowercase letters, digits and underscores, from 2 to 40 characters, like kessara_closed.");
  const record = recordOf(game);
  game.flags ??= {};
  const known = Boolean(game.flags[id]);
  game.flags[id] = true;
  let entry = record.facts.find((fact) => fact.id === id);
  if (!entry) {
    if (record.facts.length >= MAX_FACTS) throw new Error("The record is full, so note only what another story will need.");
    entry = { id, text: null, from, day: dayOf(game) };
    record.facts.push(entry);
  }
  if (text && !entry.text) entry.text = text;
  return { entry, known };
}

// Takes a fact off the record, and its flag with it.
export function clearFact(game, id) {
  const record = recordOf(game);
  if (game.flags) delete game.flags[id];
  record.facts = record.facts.filter((fact) => fact.id !== id);
}

// How a story ended: the name of the ending in its notes that fits, or null for another way, a line for the player,
// and whether the player lost it. The first ending is the one that's kept.
export function recordEnding(game, { id, ending = null, summary, failed = false }) {
  if (!WORLD_THREADS[id]) throw new Error(`There's no story called ${id}.`);
  if (ending && !endingsOf(WORLD_THREADS[id]).some((one) => one.id === ending)) throw new Error(`${id} has no ending called ${ending}.`);
  const record = recordOf(game);
  record.endings[id] ??= { ending, summary, day: dayOf(game), ...(failed ? { failed: true } : {}) };
  return record.endings[id];
}

export const endingOf = (game, id) => readRecord(game).endings[id] ?? null;

// Whether a story is over, or over in one named way. A story the clock ran out on is over, any way it went.
export function endedWith(game, id, ending = null) {
  const got = readRecord(game).endings[id];
  if (ending) return got?.ending === ending;
  return Boolean(got) || game.story?.threads?.[id] === "done";
}

// A story ends: its ending goes on the record, its quest is settled with the same line, and the Leads menu and the
// clock learn it's over. The written story's * ending lines and the AI's end_story both come through here.
export function endStory(game, { id, ending = null, summary, failed = false }) {
  const thread = WORLD_THREADS[id];
  if (!thread) throw new Error(`There's no story called ${id}.`);
  const got = recordEnding(game, { id, ending, summary, failed });
  const quest = game.quests?.find((one) => one.id === id);
  if (quest && quest.status === "active") {
    quest.status = failed ? "failed" : "completed";
    quest.objective = summary;
  }
  noteThreadEnded(game, id);
  return { thread, ending: got };
}

// Plain words for a fact: its own line, the line a story's notes give that name, or the name spaced out.
export const factWords = (fact) => fact.text ?? FACT_LINES[fact.id] ?? fact.id.replaceAll("_", " ");

const titleOf = (id) => WORLD_THREADS[id]?.title ?? id;

// The record as the AI reads it in its state: a line per ending and per fact, so that only what's changed is sent
// again. A very long record keeps its latest facts.
export function recordLines(game) {
  const record = readRecord(game);
  const endings = Object.entries(record.endings).map(([id, ending]) => `Story ended, ${titleOf(id)} (${id})${ending.ending ? `, ${ending.ending}` : ""}: ${ending.summary}`);
  const facts = record.facts.slice(-80).map((fact) => `Fact ${fact.id}: ${factWords(fact)}`);
  return [...endings, ...facts];
}

// The record as the page shows it: the stories that ended, latest first, and the facts, oldest first, each with the
// story it came from when a written scene left it.
export function recordView(game) {
  const record = readRecord(game);
  const storyOfScene = (from) => (from && WORLD_THREADS[from.replace(/^thread_/, "")] ? titleOf(from.replace(/^thread_/, "")) : null);
  return {
    endings: Object.entries(record.endings)
      .map(([id, ending]) => ({ id, title: titleOf(id), ending: ending.ending ?? null, failed: Boolean(ending.failed), summary: ending.summary, day: ending.day }))
      .sort((a, b) => (b.day ?? 0) - (a.day ?? 0)),
    facts: record.facts.map((fact) => ({ id: fact.id, text: factWords(fact), from: storyOfScene(fact.from), day: fact.day })),
  };
}
