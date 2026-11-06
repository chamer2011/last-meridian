// What changes at each place from one day to the next, whether the captain is there or not: its
// supplies, what they cost, and who has the most say there. It runs at each midnight, on this computer,
// with no AI. The game master gets one short line about wherever the captain is, and hears about
// anything big. world/daily.json has the places, the numbers and the words.
//
// Each place has a level for each of its supplies, where 100 is normal for that place. Levels drift
// back toward normal by themselves, or toward whatever the places it depends on can send it, so a
// shortage at one place reaches the next a few days later, and it all recovers in the end.

import { FACTIONS, ITEMS, LOCATIONS } from "./data.js";
import { isCharted } from "./fleet.js";
import { inTheFleet } from "./role.js";
import { DAILY } from "./world.js";

const PLACES = DAILY.places ?? {};
const GOODS = DAILY.goods ?? {};
const EVENTS = DAILY.events ?? [];
const RECOVERY = 0.06;
// How much of a place's normal level depends on what the places that supply it have got.
const DEPENDS = 0.5;
const SHAKE = 1.2;
const LEAN_KEEPS = 0.92;
const HOLD_SHAKE = 0.12;
const MIN_SHARE = 1;
// A side has to get clearly ahead to take over, so a place doesn't flip back and forth on a close day.
const TAKES_OVER_BY = 3;
// Whoever's in charge gets the blame when things are short.
const BLAME_BELOW = 60;
const BLAME = 0.25;
// Shares drift slowly back toward how they started, so nothing's settled for good.
const SETTLE = 0.004;
const MAX_NEWS = 40;
const REPORT_LINES = 3;
const RUMOR_DAYS = 8;
const ROUND = 10;

const round = (n) => Math.round(n * ROUND) / ROUND;
const clampLevel = (n) => Math.max(0, Math.min(200, n));

function seedFrom(text) {
  let seed = 11;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// The world's own dice, kept in the save, so reloading doesn't change what happens.
function dice(world) {
  world.seed = (Math.imul(world.seed, 1664525) + 1013904223) >>> 0;
  return world.seed / 4294967296;
}

const topOf = (hold) => Object.entries(hold).sort((a, b) => b[1] - a[1])[0][0];

// ---- The world in a saved game --------------------------------------------

function placeStart(file) {
  return {
    goods: Object.fromEntries(Object.keys(file.goods ?? {}).map((good) => [good, 100])),
    hold: { ...file.hold },
    holder: topOf(file.hold),
    events: [],
  };
}

export function newWorld(game) {
  return {
    day: Math.floor(game.clock.hours / 24),
    seed: seedFrom(`${game.name}|world`),
    places: Object.fromEntries(Object.entries(PLACES).map(([id, file]) => [id, placeStart(file)])),
    news: [],
    unheard: [],
  };
}

// A place added to the file later reaches saved games too, and one taken out of it goes.
export function worldOf(game) {
  game.world ??= newWorld(game);
  for (const [id, file] of Object.entries(PLACES)) game.world.places[id] ??= placeStart(file);
  for (const id of Object.keys(game.world.places)) if (!PLACES[id]) delete game.world.places[id];
  return game.world;
}

export const sideName = (place, side) => PLACES[place]?.sides?.[side] ?? FACTIONS[side]?.name ?? side;

export const knownPlace = (game, id) => {
  const place = LOCATIONS[id];
  return Boolean(place) && (id === game.location || (!place.hidden && (isCharted(id) || place.fleet || game.seenLore?.includes(`place:${id}`))));
};

// ---- News -------------------------------------------------------------------

// Everything goes on the list. The captain hears straight away about wherever they or the fleet are,
// and about anything big that happens somewhere they know of.
export function tellNews(game, place, text, notes, big = false) {
  tell(game, worldOf(game), place, text, notes, big);
}

function tell(game, world, place, text, notes, big = false) {
  world.news.push({ day: world.day, place, text });
  if (world.news.length > MAX_NEWS) world.news.splice(0, world.news.length - MAX_NEWS);
  const close = place === game.location || (inTheFleet(game) && place === game.fleet?.at);
  if (!close && !(big && knownPlace(game, place))) return;
  notes.push(`[WORLD] ${text}`);
  world.unheard.push(text);
  if (world.unheard.length > REPORT_LINES) world.unheard.shift();
}

const placeText = (text, place) => text.replaceAll("{place}", LOCATIONS[place]?.name ?? place);

// ---- A day at each place ------------------------------------------------------

function supplyDay(world, id, state) {
  const going = state.events.map((event) => EVENTS.find((one) => one.id === event.id)).filter(Boolean);
  for (const [good, from] of Object.entries(PLACES[id].goods ?? {})) {
    const sources = from.map((other) => world.places[other]?.goods[good]).filter((level) => level !== undefined);
    const usual = sources.length ? 100 * (1 - DEPENDS) + DEPENDS * (sources.reduce((sum, level) => sum + level, 0) / sources.length) : 100;
    const pushed = going.reduce((sum, event) => sum + (event.goods?.[good] ?? 0), 0);
    // Markets don't jump around at random. They lean one way for days at a time, then the other.
    state.lean ??= {};
    state.lean[good] = Math.round(((state.lean[good] ?? 0) * LEAN_KEEPS + (dice(world) - 0.5) * 2 * SHAKE) * 100) / 100;
    state.goods[good] = round(clampLevel(state.goods[good] + (usual - state.goods[good]) * RECOVERY + pushed + state.lean[good]));
  }
}

function holdDay(game, world, id, state, notes) {
  const file = PLACES[id];
  if (file.locked) return;
  const going = state.events.map((event) => EVENTS.find((one) => one.id === event.id)).filter(Boolean);
  const levels = Object.values(state.goods);
  const average = levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 100;
  const blame = average < BLAME_BELOW ? BLAME : 0;
  for (const side of Object.keys(state.hold)) {
    const pushed = going.reduce((sum, event) => sum + (event.sides?.[side] ?? 0), 0);
    const settling = (file.hold[side] - state.hold[side]) * SETTLE;
    state.hold[side] += (file.push?.[side] ?? 0) + pushed + settling + (dice(world) - 0.5) * 2 * HOLD_SHAKE - (side === state.holder ? blame : 0);
    state.hold[side] = Math.max(MIN_SHARE, state.hold[side]);
  }
  const total = Object.values(state.hold).reduce((sum, share) => sum + share, 0);
  for (const side of Object.keys(state.hold)) state.hold[side] = round((state.hold[side] / total) * 100);
  const top = topOf(state.hold);
  if (top !== state.holder && state.hold[top] > state.hold[state.holder] + TAKES_OVER_BY) {
    const old = state.holder;
    state.holder = top;
    state.since = world.day;
    const text = placeText(DAILY.text.taken, id).replaceAll("{new}", sideName(id, top)).replaceAll("{old}", sideName(id, old));
    tell(game, world, id, text, notes, true);
  }
}

function eventsDay(game, world, id, state, notes) {
  for (const event of state.events) event.left -= 1;
  for (const event of state.events.filter((one) => one.left <= 0)) {
    const file = EVENTS.find((one) => one.id === event.id);
    if (file?.done) tell(game, world, id, placeText(file.done, id), notes, file.big);
  }
  state.events = state.events.filter((event) => event.left > 0);
  if (state.events.length) return;
  // Everything that could happen here gets one chance today, in an order that changes.
  const first = Math.floor(dice(world) * EVENTS.length);
  for (let i = 0; i < EVENTS.length; i += 1) {
    const event = EVENTS[(first + i) % EVENTS.length];
    if (!event.places.includes(id) || dice(world) >= event.chance) continue;
    const [least, most] = event.days;
    state.events.push({ id: event.id, left: least + Math.floor(dice(world) * (most - least + 1)) });
    tell(game, world, id, placeText(event.news, id), notes, event.big);
    return;
  }
}

function runDay(game, world, notes) {
  for (const [id, state] of Object.entries(world.places)) {
    eventsDay(game, world, id, state, notes);
    supplyDay(world, id, state);
    holdDay(game, world, id, state, notes);
  }
}

// Called whenever the clock moves. Runs one day of the world for each midnight that's gone by.
export function advanceWorld(game, today = Math.floor(game.clock.hours / 24)) {
  const world = worldOf(game);
  const notes = [];
  while (world.day < today) {
    world.day += 1;
    runDay(game, world, notes);
  }
  return notes;
}

// ---- What things cost ----------------------------------------------------------

export const levelName = (level) => (DAILY.levels ?? []).find((band) => level >= band.from)?.name ?? "normal";

function priceAtLevel(level) {
  const curve = DAILY.prices ?? [[100, 1]];
  const above = curve.findIndex(([at]) => at >= level);
  if (above <= 0) return curve[Math.max(0, above)][1];
  const [lowAt, lowPrice] = curve[above - 1];
  const [highAt, highPrice] = curve[above];
  return lowPrice + ((level - lowAt) / (highAt - lowAt)) * (highPrice - lowPrice);
}

// People charge more if they've got no reason to like you, and a little less if they have.
function standingFactor(game, place) {
  const holder = game.world?.places[place]?.holder;
  const standing = game.factions?.[holder];
  const { hostile, friendly } = DAILY.standing ?? {};
  if (standing === undefined || !hostile) return 1;
  if (standing <= hostile.at) return hostile.price;
  if (standing >= friendly.at) return friendly.price;
  return 1;
}

// How much more or less a supply costs here right now than it usually does.
export function supplyFactor(game, place, good) {
  const level = game.world?.places[place]?.goods[good];
  return (level === undefined ? 1 : priceAtLevel(level)) * standingFactor(game, place);
}

const ITEM_GOODS = new Map(Object.entries(ITEMS).map(([id, item]) => [item, { good: DAILY.items?.[id] ?? (["weapon", "armor"].includes(item.type) ? "parts" : null), share: DAILY.items?.[id] ? 0.6 : 0.3 }]));

// The same for something in a market. It follows the supply it's made of, but less steeply.
export function itemFactor(game, item) {
  const place = game.location;
  if (!game.world?.places[place]) return 1;
  const follows = ITEM_GOODS.get(item);
  if (!follows?.good) return ITEM_GOODS.has(item) ? standingFactor(game, place) : 1;
  const level = game.world.places[place].goods[follows.good];
  const swing = level === undefined ? 1 : 1 + (priceAtLevel(level) - 1) * follows.share;
  return swing * standingFactor(game, place);
}

// What the fleet buying or selling a lot does to what's left there.
export function tradedAt(game, place, good, sold = false) {
  const goods = worldOf(game).places[place]?.goods;
  if (goods?.[good] === undefined) return;
  goods[good] = round(clampLevel(goods[good] + (sold ? DAILY.lots.sold : DAILY.lots.bought)));
}

export const noneLeft = (game, place, good) => (game.world?.places[place]?.goods[good] ?? 100) < DAILY.lots.none;

// ---- What the browser gets to see --------------------------------------------

const going = (id, state) => state.events.map((event) => EVENTS.find((one) => one.id === event.id)).filter(Boolean).map((event) => placeText(event.news, id));

function ranked(state) {
  return Object.entries(state.hold).sort((a, b) => b[1] - a[1]);
}

export const inTrouble = (game, id) => Boolean(game.world?.places[id]?.events.some((event) => EVENTS.find((one) => one.id === event.id)?.trouble));

// What's known about a place today. A place that isn't in the file has nothing to say.
// Which faction holds a place now: whoever has taken it as the world's days went by, or whoever its file starts it with.
export const holderOf = (game, place) => game.world?.places?.[place]?.holder ?? LOCATIONS[place]?.faction ?? null;

export function placeNow(game, id) {
  const state = game.world?.places[id];
  if (!state) return null;
  const [top, second] = ranked(state);
  const close = second && !PLACES[id].locked && top[1] - second[1] <= 15;
  return {
    goods: Object.entries(state.goods).map(([good, level]) => ({ id: good, name: GOODS[good]?.name ?? good, level: levelName(level), low: level < 80, high: level >= 125 })),
    holder: sideName(id, state.holder),
    changed: state.holder !== topOf(PLACES[id].hold),
    since: state.since ?? null,
    rival: close ? sideName(id, second[0]) : null,
    shares: PLACES[id].locked ? [] : ranked(state).map(([side, share]) => ({ name: sideName(id, side), share: Math.round(share) })),
    going: going(id, state),
    trouble: inTrouble(game, id),
  };
}

export const newsView = (game) => (game.world?.news ?? []).filter((entry) => knownPlace(game, entry.place)).slice(-14).reverse()
  .map((entry) => ({ day: entry.day + 1, place: LOCATIONS[entry.place]?.name ?? entry.place, text: entry.text }));

// Which of the places a faction holds that the captain knows of.
export const holdingsOf = (game, faction) => Object.entries(game.world?.places ?? {})
  .filter(([id, state]) => state.holder === faction && knownPlace(game, id))
  .map(([id]) => LOCATIONS[id]?.name ?? id);

// ---- What the game master gets -------------------------------------------------

// Rounded and in plain words, so this line only changes when something's really changed.
export function placeLine(game) {
  const id = game.location;
  const state = game.world?.places[id];
  if (!state) return null;
  const shares = ranked(state).map(([side, share]) => `${side} ${Math.round(share / 5) * 5}`).join(", ");
  const goods = Object.entries(state.goods).map(([good, level]) => `${good} ${levelName(level)}`).join(", ");
  const now = going(id, state);
  return `${LOCATIONS[id].name} today: ${sideName(id, state.holder)} holds it (${shares}). Supplies: ${goods}.${now.length ? ` Going on: ${now.join(" ")}` : ""}`;
}

export function worldReport(game) {
  const world = game.world;
  if (!world?.unheard?.length) return null;
  const lines = world.unheard.splice(0);
  return `<world_report>News since your last message: ${lines.join(" ")} Bring in what matters to the story, or let it pass.</world_report>`;
}

export function markWorldHeard(game) {
  if (game.world) game.world.unheard = [];
}

// How things stand everywhere the captain knows of, or at one place, for when a scene needs it.
export function worldLines(game, place) {
  const line = (id) => {
    const state = game.world.places[id];
    const shares = ranked(state).map(([side, share]) => `${side} ${Math.round(share / 5) * 5}`).join(", ");
    const goods = Object.entries(state.goods).map(([good, level]) => `${good} ${levelName(level)}`).join(", ");
    const now = going(id, state);
    return `${LOCATIONS[id].name} (${id}): ${sideName(id, state.holder)} holds it (${shares}). ${goods ? `Supplies: ${goods}.` : ""}${now.length ? ` Going on: ${now.join(" ")}` : ""}`;
  };
  worldOf(game);
  if (place) {
    if (!game.world.places[place]) throw new Error(`Nothing's tracked at ${place}. These are: ${Object.keys(game.world.places).join(", ")}.`);
    return line(place);
  }
  return Object.keys(game.world.places).filter((id) => knownPlace(game, id)).map(line).join("\n");
}

// What people are passing around, for rumors. It's the freshest news, starting with what's closest to here.
export function worldRumors(game, count = 1) {
  const world = game.world;
  if (!world?.news?.length) return [];
  const fresh = world.news.filter((entry) => world.day - entry.day <= RUMOR_DAYS && knownPlace(game, entry.place)).reverse();
  const here = fresh.filter((entry) => entry.place === game.location);
  return [...new Set([...here, ...fresh].map((entry) => entry.text))].slice(0, count);
}

// ---- The story changes things -----------------------------------------------------

// Something in a story has changed how things stand at a place. It doesn't change hands until the day's over.
export function pushPlace(game, place, { goods = {}, sides = {} }) {
  const state = worldOf(game).places[place];
  if (!state) return;
  for (const [good, change] of Object.entries(goods)) {
    if (state.goods[good] !== undefined) state.goods[good] = round(clampLevel(state.goods[good] + change));
  }
  if (PLACES[place].locked) return;
  for (const [side, change] of Object.entries(sides)) {
    if (state.hold[side] !== undefined) state.hold[side] = Math.max(MIN_SHARE, state.hold[side] + change);
  }
  const total = Object.values(state.hold).reduce((sum, share) => sum + share, 0);
  for (const side of Object.keys(state.hold)) state.hold[side] = round((state.hold[side] / total) * 100);
}

const LEVEL_LIMIT = 60;
const SHARE_LIMIT = 30;

// The game master changes things only through this, after something in the story.
export function changePlace(game, { place, food, fuel, medicine, parts, side, amount = 0, news, reason }) {
  const world = worldOf(game);
  const state = world.places[place];
  if (!state) throw new Error(`Nothing's tracked at ${place}. These are: ${Object.keys(world.places).join(", ")}.`);
  const changes = [];
  for (const [good, change] of Object.entries({ food, fuel, medicine, parts })) {
    if (!change) continue;
    if (state.goods[good] === undefined) throw new Error(`${place} doesn't deal in ${good}.`);
    const applied = Math.max(-LEVEL_LIMIT, Math.min(LEVEL_LIMIT, change));
    state.goods[good] = round(clampLevel(state.goods[good] + applied));
    changes.push(`${good} now ${levelName(state.goods[good])}`);
  }
  const notes = [];
  if (side) {
    if (state.hold[side] === undefined) throw new Error(`There's no side called ${side} at ${place}. These are: ${Object.keys(state.hold).join(", ")}.`);
    if (PLACES[place].locked) throw new Error(`Nobody can take ${place} from ${sideName(place, state.holder)}, not in this story.`);
    const applied = Math.max(-SHARE_LIMIT, Math.min(SHARE_LIMIT, amount));
    state.hold[side] = Math.max(MIN_SHARE, state.hold[side] + applied);
    const total = Object.values(state.hold).reduce((sum, share) => sum + share, 0);
    for (const one of Object.keys(state.hold)) state.hold[one] = round((state.hold[one] / total) * 100);
    const top = topOf(state.hold);
    if (top !== state.holder) {
      const old = state.holder;
      state.holder = top;
      state.since = world.day;
      changes.push(`${sideName(place, top)} now holds it, not ${sideName(place, old)}`);
    } else changes.push(`${sideName(place, side)} now has ${Math.round(state.hold[side])} of the say`);
  }
  if (news) {
    world.news.push({ day: world.day, place, text: String(news).slice(0, 200) });
    if (world.news.length > MAX_NEWS) world.news.splice(0, world.news.length - MAX_NEWS);
  }
  const summary = changes.length ? `${LOCATIONS[place].name}: ${changes.join(", ")}.` : `Nothing changed at ${LOCATIONS[place].name}.`;
  return { summary, notice: `[WORLD] ${LOCATIONS[place].name}: ${reason}`, notes };
}

export const trackedPlaces = () => Object.keys(PLACES);
