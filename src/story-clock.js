// What happens to each story if nobody steps in. Stories don't wait for the captain: each one has
// a few stages, on their own clock, that change the world a little and change what the lead says.
// Nothing's ever lost. A story that's moved on can still be taken up, from wherever it's got to. Once
// someone has taken it up, it's in their hands and its clock stops. All of this runs on this
// computer at each midnight, with no AI. world/story-clock.json has the stages and the words.

import { knownPlace, pushPlace, tellNews } from "./daily.js";
import { LOCATIONS } from "./data.js";
import { lostShipNames, storyHitsFleet } from "./fleet.js";
import { isCaptain } from "./role.js";
import { storyOf } from "./story-library.js";
import { STORY_CLOCK, WORLD_ARC, WORLD_THREADS } from "./world.js";

const THREADS = STORY_CLOCK.threads ?? {};
const ACTS = STORY_CLOCK.acts ?? [];
// A story for someone further along doesn't start moving until the world's had time to get there.
const DAYS_PER_LEVEL = 7;
// The story's last act needs the fleet to get there, so it never starts without someone taking them.
const LAST_ACT_BY_ITSELF = 4;
const MAX_TOLD_A_DAY = 2;
const MAX_TOLD_AT_ONCE = 4;
const MAX_MOVED = 30;

function seedFrom(text) {
  let seed = 13;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// No two captains' worlds run at quite the same pace.
const stretch = (game, key) => 0.8 + (seedFrom(`${game.name}|${key}`) % 41) / 100;
const dayNow = (game) => Math.floor(game.clock.hours / 24);

export function clockOf(game) {
  const story = storyOf(game);
  // They start from the day the game does, however long the first wait turns out to be.
  const day = game.fleet?.day ?? dayNow(game);
  story.clock ??= { day, start: day, threads: {}, act: null, moved: [] };
  return story.clock;
}

// A story that's run its whole course without anyone, which counts as over for whatever comes after it.
export const ranItsCourse = (game, id) => {
  const stages = THREADS[id]?.stages ?? [];
  return stages.length > 0 && (game.story?.clock?.threads[id]?.stage ?? 0) >= stages.length;
};

const isOver = (game, id) => storyOf(game).threads[id] === "done" || ranItsCourse(game, id);

// Where a story's news comes from. Whatever's happening in the fleet is happening aboard the flagship.
function newsPlace(thread) {
  const place = (thread?.places ?? []).find((one) => LOCATIONS[one]);
  return place ?? "meridian";
}

function happen(game, stage, place, notes, told) {
  for (const hit of stage.places ?? []) pushPlace(game, hit.id, hit);
  if (stage.fleet) storyHitsFleet(game, stage.fleet, notes);
  // Plenty can happen in a day, and the story's only got room for some of it. It's all in the news.
  const heard = [];
  tellNews(game, stage.place ?? place, stage.news, heard, stage.big);
  if (heard.length && told.today < MAX_TOLD_A_DAY && told.all < MAX_TOLD_AT_ONCE) {
    told.today += 1;
    told.all += 1;
    notes.push(...heard);
  }
}

// It can't happen to a ship that's gone.
const shipIsGone = (game, news) => lostShipNames(game).some((name) => news.includes(name));

function logMoved(clock, entry) {
  clock.moved.push(entry);
  if (clock.moved.length > MAX_MOVED) clock.moved.splice(0, clock.moved.length - MAX_MOVED);
}

function threadDay(game, clock, id, day, notes, told) {
  const file = THREADS[id];
  const thread = WORLD_THREADS[id];
  if (!thread || storyOf(game).threads[id]) return;
  let state = clock.threads[id];
  if (!state) {
    if (day - clock.start < (file.from ?? (Math.max(1, thread.minLevel ?? 1) - 1) * DAYS_PER_LEVEL)) return;
    if (thread.after && !isOver(game, thread.after)) return;
    state = { from: day, stage: 0 };
    clock.threads[id] = state;
  }
  const stage = file.stages?.[state.stage];
  if (!stage || day - state.from < Math.round(stage.after * stretch(game, id))) return;
  state.stage += 1;
  if (shipIsGone(game, stage.news)) return;
  happen(game, stage, newsPlace(thread), notes, told);
  logMoved(clock, { day, id, title: thread.title, text: stage.news, place: stage.place ?? newsPlace(thread) });
}

// The main story's pressure builds whether anyone's looking or not, and in the end it moves on too.
function actDay(game, clock, day, notes, told) {
  const story = storyOf(game);
  if (clock.act?.act !== story.act) clock.act = { act: story.act, from: day, next: 0 };
  const file = ACTS[story.act - 1];
  if (!file) return;
  const scale = stretch(game, `act${story.act}`);
  const event = file.events?.[clock.act.next];
  if (event && day - clock.act.from >= Math.round(event.after * scale)) {
    clock.act.next += 1;
    if (!shipIsGone(game, event.news)) {
      happen(game, { ...event, big: event.big ?? true }, "meridian", notes, told);
      logMoved(clock, { day, id: null, title: WORLD_ARC.acts?.[story.act - 1]?.name ?? "The Beacon", text: event.news, place: event.place ?? "meridian" });
    }
  }
  if (!file.moves_on || story.act >= LAST_ACT_BY_ITSELF || day - clock.act.from < Math.round(file.moves_on.after * scale)) return;
  happen(game, { ...file.moves_on, big: true }, "meridian", notes, told);
  logMoved(clock, { day, id: null, title: WORLD_ARC.acts?.[story.act - 1]?.name ?? "The Beacon", text: file.moves_on.news, place: "meridian" });
  story.act += 1;
  clock.act = { act: story.act, from: day, next: 0 };
}

// Called whenever the clock moves. Runs one day of the stories for each midnight that's gone by.
export function advanceStories(game, today = dayNow(game), told = { today: 0, all: 0 }) {
  const clock = clockOf(game);
  const notes = [];
  while (clock.day < today) {
    clock.day += 1;
    told.today = 0;
    actDay(game, clock, clock.day, notes, told);
    for (const id of Object.keys(THREADS)) threadDay(game, clock, id, clock.day, notes, told);
  }
  return notes;
}

// ---- How a story stands now ------------------------------------------------------

const stagesReached = (game, id) => (THREADS[id]?.stages ?? []).slice(0, game.story?.clock?.threads[id]?.stage ?? 0);

export const hasMovedOn = (game, id) => stagesReached(game, id).length > 0;

// The lead as it stands today: what it's turned into, if it's moved on, and otherwise what it always was.
export function leadNow(game, id) {
  const reached = stagesReached(game, id);
  // Someone who isn't the captain only knows what's got around.
  if (!isCaptain(game)) return reached.at(-1)?.news ?? WORLD_THREADS[id]?.anyone ?? WORLD_THREADS[id]?.lead;
  return reached.map((stage) => stage.lead).filter(Boolean).at(-1) ?? WORLD_THREADS[id]?.lead;
}

// What the game master gets to know about what's already happened in a story.
export function whatHappened(game, id) {
  const done = stagesReached(game, id);
  if (!done.length) return null;
  return `This story has moved on without the captain, so start from how things stand now, and treat the notes below as how it began. What's happened: ${done.map((stage) => stage.news).join(" ")}`;
}

// What the Leads menu shows, for the places the captain knows of.
export const movedView = (game) => (game.story?.clock?.moved ?? [])
  .filter((entry) => knownPlace(game, entry.place))
  .slice(-10)
  .reverse()
  .map((entry) => ({ day: entry.day + 1, title: entry.title, text: entry.text }));
