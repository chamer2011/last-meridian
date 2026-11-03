// The world's story material, kept in files: story threads, what's going on at each place, the
// main story's clues, and news from around the fleet. The game master is given these only when
// they become relevant, which keeps every message small. The player can see the leads and rumors
// at wherever they are in a menu, without using the AI at all.

import { fullName } from "./campaign.js";
import { NOTABLES } from "./character-data.js";
import { ENEMIES, FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { worldRumors } from "./daily.js";
import { hasMovedOn, leadNow, movedView, ranItsCourse, whatHappened } from "./story-clock.js";
import { inTheFleet, isCaptain } from "./role.js";
import { writtenThreadIds } from "./scene-files.js";
import { chairOf, lostShipNames } from "./fleet.js";
import { FLEET_EVENTS, WORLD_ARC, WORLD_THREADS } from "./world.js";

const LEADS_SHOWN = 4;
const RUMORS_SHOWN = 3;
const ENCOUNTERS_SENT = 3;
const CLUES_SENT = 3;
// What's going around at a place changes this often, in days.
const NEWS_CYCLE = 2;
// Fleet news comes no more often than this, in AI turns.
const TURNS_BETWEEN_NEWS = 6;

export const emptyStory = () => ({ threads: {}, used: [], clues: [], act: 1, lastNews: null });

export function storyOf(game) {
  game.story ??= emptyStory();
  game.story.threads ??= {};
  game.story.used ??= [];
  game.story.clues ??= [];
  game.story.act ??= 1;
  return game.story;
}

const dayOf = (game) => Math.floor(game.clock.hours / 24);

function seededShuffle(list, text) {
  let seed = 0;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// What's going around at this place right now. It stays the same for a couple of days, then moves on.
const cycleSeed = (game, kind) => `${game.name}|${game.location}|${kind}|${Math.floor(dayOf(game) / NEWS_CYCLE)}`;

function fitsHere(thread, game) {
  const place = LOCATIONS[game.location];
  return (thread.places ?? []).some((id) => id === "any" || id === game.location || (id === "fleet" && place?.fleet));
}

// A story can't start from a ship that's gone.
const namesLostShip = (text, game) => lostShipNames(game).some((name) => text?.includes(name));

function threadOpen(id, thread, game) {
  const { threads } = storyOf(game);
  if (threads[id]) return false;
  // A story with nothing written for anyone else is the captain's own business, and it goes on over everyone's head.
  if (!isCaptain(game) && !thread.anyone) return false;
  if ((thread.minLevel ?? 1) > game.level) return false;
  if (thread.after && threads[thread.after] !== "done" && !ranItsCourse(game, thread.after)) return false;
  if (namesLostShip(leadNow(game, id), game)) return false;
  return fitsHere(thread, game);
}

// A few of the stories that could start here, with a mix of kinds. Main story threads come first, and the
// stories that have been written out come before all of those, in every game: with an AI they're the free ones.
export function leadsHere(game) {
  const open = Object.entries(WORLD_THREADS).filter(([id, thread]) => threadOpen(id, thread, game));
  const shuffled = seededShuffle(open, cycleSeed(game, "leads"));
  shuffled.sort(([, a], [, b]) => Number(b.kind === "main") - Number(a.kind === "main"));
  const written = writtenThreadIds();
  shuffled.sort(([a], [b]) => Number(written.has(b)) - Number(written.has(a)));
  const chosen = [];
  const kinds = new Set();
  for (const entry of shuffled) {
    if (chosen.length >= LEADS_SHOWN) break;
    // One of each kind, except that a story that's written out is never left off for its kind.
    if (kinds.has(entry[1].kind) && !written.has(entry[0])) continue;
    chosen.push(entry);
    kinds.add(entry[1].kind);
  }
  for (const entry of shuffled) {
    if (chosen.length >= LEADS_SHOWN) break;
    if (!chosen.includes(entry)) chosen.push(entry);
  }
  return chosen.map(([id, thread]) => ({ id, title: thread.title, kind: thread.kind, lead: leadNow(game, id), moved: hasMovedOn(game, id), written: written.has(id) }));
}

export function rumorsHere(game) {
  return [...worldRumors(game), ...seededShuffle(LOCATIONS[game.location]?.rumors ?? [], cycleSeed(game, "rumors"))].slice(0, RUMORS_SHOWN);
}

// What one person has heard. Everyone repeats something different, and nobody gossips about themselves.
export function rumorsFrom(game, person, names = []) {
  const about = names.flatMap((name) => String(name).split(/\s+/)).filter((word) => word.length > 2).map((word) => word.toLowerCase());
  const fresh = (LOCATIONS[game.location]?.rumors ?? []).filter((rumor) => {
    const words = rumor.toLowerCase().split(/[^\p{L}\p{N}']+/u);
    return !about.some((word) => words.includes(word));
  });
  return [...worldRumors(game), ...seededShuffle(fresh, cycleSeed(game, `rumors:${person}`))].slice(0, RUMORS_SHOWN);
}

// What the Leads menu shows. Nothing here gives away a thread's notes.
export function storyView(game) {
  const { threads } = storyOf(game);
  const followed = (status) => Object.entries(threads)
    .filter(([id, value]) => value === status && WORLD_THREADS[id])
    .map(([id]) => ({ id, title: WORLD_THREADS[id].title, kind: WORLD_THREADS[id].kind, lead: leadNow(game, id) }));
  return { here: leadsHere(game), rumors: rumorsHere(game), active: followed("active"), done: followed("done"), moved: movedView(game) };
}

const personLine = (id) => {
  const person = NOTABLES[id];
  return person ? `${id} (${fullName(person)}, ${person.role})` : null;
};
const list = (label, items) => (items?.length ? `${label}:\n${items.map((item) => `- ${item}`).join("\n")}` : null);
const inline = (label, items) => (items?.length ? `${label}: ${items.join(", ")}.` : null);

function cluesHere(game) {
  const { clues, act } = storyOf(game);
  return (WORLD_ARC.clues ?? [])
    .filter((clue) => (clue.places ?? []).includes(game.location) && !clues.includes(clue.id) && (clue.act ?? 1) <= act)
    .slice(0, CLUES_SENT);
}

// Everything the game master needs to run the place the player's in.
export function placeFile(game) {
  const story = storyOf(game);
  const place = LOCATIONS[game.location];
  if (!place?.gm) return null;
  const { gm } = place;
  const fresh = (place.encounters ?? []).map((text, i) => ({ text, key: `e:${game.location}:${i}` })).filter((entry) => !story.used.includes(entry.key));
  const encounters = seededShuffle(fresh, cycleSeed(game, "encounters")).slice(0, ENCOUNTERS_SENT);
  story.used.push(...encounters.map((entry) => entry.key));
  game.ai.sentPlace = game.location;
  const leads = leadsHere(game);
  const faction = FACTIONS[place.faction]?.name;
  return [
    `<place_file place="${game.location}">`,
    `${place.name}.${faction ? ` Run by ${faction}.` : ""} ${place.desc}`,
    gm.feel,
    list("Where things happen", gm.districts?.map((district) => `${district.name}: ${district.desc}`)),
    inline("People here, with read_character for their files", gm.people?.map(personLine).filter(Boolean)),
    inline("Enemies that suit this place", gm.enemies?.filter((id) => ENEMIES[id]).map((id) => `${id} (${ENEMIES[id].name})`)),
    inline("Things someone might find here", gm.items?.filter((id) => ITEMS[id])),
    list("What can go wrong here", gm.complications),
    list("Secrets, for you only", gm.secrets),
    list("Small things that could happen on this visit, if they suit the moment", encounters.map((entry) => entry.text)),
    list("What people are saying here, which the player can also read in their Leads menu", rumorsHere(game)),
    list("Stories that could start here, which the player can also see in their Leads menu. Call read_thread for the notes on one if you bring it in", leads.map((lead) => `${lead.id}: ${lead.title}. ${lead.lead}`)),
    list("Clues to the main story that could be found here. Call update_story when one is found", cluesHere(game).map((clue) => `${clue.id}: ${clue.text}${clue.how ? ` How: ${clue.how}` : ""}${clue.points_to ? ` Points to: ${clue.points_to}` : ""}`)),
    "</place_file>",
  ].filter(Boolean).join("\n");
}

// The place's notes go out once per visit, including right at the start of a conversation.
export function placeFileIfNew(game) {
  return game.ai.sentPlace === game.location ? null : placeFile(game);
}

export function threadNotes(id, game = null) {
  const thread = WORLD_THREADS[id];
  if (!thread) return null;
  const { gm } = thread;
  return [
    `<story_thread id="${id}" title="${thread.title}">`,
    "Your notes for this story. Treat them as a starting point: improvise, and let the player's choices change where it goes. Use add_quest with this thread's id as the quest's id when it begins, and update_quest when it ends.",
    game && !isCaptain(game) && `The player isn't the captain, and these notes were written with the captain in mind. Where they say the captain, read the player if it's something they could do from where they stand. Otherwise it's ${chairOf(game)?.name ?? "whoever has the chair"}, and the player will have to get to them, or work around them.`,
    `The lead: ${thread.lead}`,
    game && whatHappened(game, id),
    game && (hasMovedOn(game, id) || !isCaptain(game)) && `How the player heard about it: ${leadNow(game, id)}`,
    gm.truth && `What's really going on: ${gm.truth}`,
    inline("People involved, with read_character for their files", thread.people?.map(personLine).filter(Boolean)),
    list("How it might go", gm.beats),
    list("Ways through", gm.routes),
    inline("Checks that fit", gm.checks),
    list("If it comes to a fight", gm.fights),
    list("Where it can end up", gm.outcomes),
    gm.rewards && `Rewards: ${gm.rewards}`,
    "</story_thread>",
  ].filter(Boolean).join("\n");
}

// The player or the game master has taken up a thread.
export function beginThread(game, id) {
  if (!WORLD_THREADS[id]) return null;
  const { threads } = storyOf(game);
  threads[id] ??= "active";
  return threadNotes(id, game);
}

export function noteThreadStarted(game, id) {
  if (!WORLD_THREADS[id]) return;
  const { threads } = storyOf(game);
  threads[id] ??= "active";
}

export function noteThreadEnded(game, id) {
  if (WORLD_THREADS[id]) storyOf(game).threads[id] = "done";
}

export const threadPeople = (id) => (WORLD_THREADS[id]?.people ?? []).map((person) => NOTABLES[person]?.name).filter(Boolean);

// Where the main story stands. It goes out at the start of a conversation and when an act changes.
export function arcBrief(game) {
  const story = storyOf(game);
  const acts = WORLD_ARC.acts ?? [];
  const act = acts[story.act - 1];
  if (!act) return null;
  game.ai.sentAct = story.act;
  return [
    "<main_story>",
    `Where the main story stands: act ${story.act} of ${acts.length}, ${act.name}. Never tell the player this.`,
    !isCaptain(game) && `All of this is happening around the player, not to them. ${chairOf(game)?.name ?? "Someone else"} has the chair, and these scenes are that person's. The player may only ever see the edges of it, and that's fine. Let them get closer if they go looking, and don't bring it to them.`,
    WORLD_ARC.truth?.how_it_connects && `How it all connects, for you only: ${WORLD_ARC.truth.how_it_connects}`,
    list("How to run the mystery", WORLD_ARC.gm_rules),
    `What the story's doing now: ${act.goal}`,
    act.pressure && `What's getting worse in the background: ${act.pressure}`,
    act.moves_on_when && `It moves on when: ${act.moves_on_when} Then call update_story with the new act.`,
    list("Scenes that could happen in this act", act.beats),
    story.clues.length ? `Clues they've already found: ${story.clues.join(", ")}.` : null,
    story.act >= acts.length - 1 ? list("How it could all end", (WORLD_ARC.endings ?? []).map((ending) => `${ending.name}: ${ending.gm}`)) : null,
    "</main_story>",
  ].filter(Boolean).join("\n");
}

// The rest of the main story's notes are large, so the game master asks for the part it needs.
export const MYSTERY_TOPICS = [...Object.keys(WORLD_ARC.truth ?? {}), "factions", "reversals", "routes_by_build", "timeline"];

export function mysteryNotes(topic) {
  const notes = WORLD_ARC.truth?.[topic] ?? WORLD_ARC[topic];
  if (notes === undefined) throw new Error(`There are no notes on ${topic}.`);
  return typeof notes === "string" ? notes : JSON.stringify(notes, null, 1);
}

export const arcBriefIfNew = (game) => (game.ai.sentAct === storyOf(game).act ? null : arcBrief(game));

export function updateStory(game, { clue, act }) {
  const story = storyOf(game);
  const said = [];
  if (clue) {
    if (!(WORLD_ARC.clues ?? []).some((entry) => entry.id === clue)) throw new Error(`There's no clue called ${clue}.`);
    if (!story.clues.includes(clue)) story.clues.push(clue);
    said.push(`Clue noted: ${clue}.`);
  }
  if (act !== undefined && act !== null) {
    const total = (WORLD_ARC.acts ?? []).length;
    if (act < 1 || act > total) throw new Error(`The acts run from 1 to ${total}.`);
    story.act = act;
    if (story.clock) story.clock.act = null;
    said.push(`The main story is now in act ${act}.`);
    const brief = arcBrief(game);
    if (brief) said.push(brief);
  }
  if (!said.length) throw new Error("Give a clue or an act.");
  return said.join("\n");
}

// Something small happening in the fleet, to bring in when there's a lull.
export function fleetNews(game) {
  if (!inTheFleet(game)) return null;
  const story = storyOf(game);
  if (story.lastNews !== null && game.turn - story.lastNews < TURNS_BETWEEN_NEWS) return null;
  const events = FLEET_EVENTS.events ?? [];
  const day = dayOf(game) + 1;
  const ready = events.filter((event) => !story.used.includes(`n:${event.id}`) && (event.minDay ?? 1) <= day && !namesLostShip(event.text, game));
  const [event] = seededShuffle(ready, `${game.name}|news|${game.turn}`);
  if (!event) return null;
  story.used.push(`n:${event.id}`);
  story.lastNews = game.turn;
  return `<fleet_news>Happening in the fleet right now, which you can bring in when there's a lull, or let pass: ${event.text}</fleet_news>`;
}
