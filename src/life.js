// People living their days: sleeping, eating, working, and walking from room to room. This is the
// start of the world engine. It has no screens and no AI, so it's free to run, and all it knows is
// what time it is and where everyone should be. The clock can move by a moment or by a year, and
// everyone ends up where their day says they should be, with or without the captain. Only the place
// the captain's in gets walked through step by step. Everywhere else, people are simply where their
// day says they are, whenever anyone looks, which is why this costs next to nothing.
//
// world/life/ has one file for each place whose people live their days, named after the place.

import { LOCATIONS } from "./data.js";
import { atPost, canStand, findPath, mapFor, seedFrom } from "./walk.js";
import { detourFor, partSquares } from "./systems.js";
import { WORLD_LIFE } from "./world.js";

const MINUTES_IN_A_DAY = 1440;
const SQUARES_A_MINUTE = 18;
// Over a gap longer than this, nobody's worth walking: they're just where they should be by now.
const LONG_GAP = 30;
const VARIES_BY = 6;
const ROUND_STOP = 20;
// How long the people the story brought together stay with the captain once the clock is running.
const COMPANY_STAYS = 20;

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const NO_ONE = new Set();
const seatKey = (spot) => `${spot.level}:${spot.x},${spot.y}`;

function toMinutes(text) {
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

// ---- Reading the place's file ------------------------------------------------

function expandGroup(entries) {
  return entries.flatMap((entry) => {
    if (Array.isArray(entry)) return [{ level: entry[0], x: entry[1], y: entry[2] }];
    const row = [];
    for (let x = entry.from; x <= entry.to; x += entry.step ?? 1) row.push({ level: entry.level, x, y: entry.y });
    return row;
  });
}

function readLifeFile(file) {
  const spots = Object.fromEntries(Object.entries(file.spots ?? {}).map(([name, [level, x, y, side]]) => [name, { level, x, y, ...(side ? { side } : {}) }]));
  const groups = Object.fromEntries(Object.entries(file.groups ?? {}).map(([name, entries]) => [name, expandGroup(entries)]));
  const roster = [
    ...Object.entries(file.people ?? {}).map(([id, day]) => ({ key: id, id, day, shift: 0 })),
    ...(file.crowd ?? []).flatMap((group) => group.names.map(([name, shift]) => ({ key: name, id: null, name, crowd: true, day: group.day, shift }))),
  ];
  return { spots, groups, roster };
}

const lifeFiles = new Map();

// A file with a mistake in it is skipped, so the people there just stay at their posts.
function lifeFileFor(place) {
  if (!lifeFiles.has(place)) {
    let file = null;
    try {
      if (WORLD_LIFE[place]) file = readLifeFile(WORLD_LIFE[place]);
    } catch (err) {
      console.error(`The days of the people at ${place} can't be used: ${err.message}`);
    }
    lifeFiles.set(place, file);
  }
  return lifeFiles.get(place);
}

// Read again after a place's systems change, since parts on the floor change where people can stand.
export function clearLife() {
  lifeFiles.clear();
  settledAt.clear();
}

export const livesHere = (place) => Boolean(lifeFileFor(place) && mapFor(place));

// Life goes on in these places wherever the captain is.
const livingPlaces = () => Object.keys(WORLD_LIFE).filter(livesHere);

// Someone with no day in the place's file just stays at their post.
export const hasADay = (place, id) => Boolean(lifeFileFor(place)?.roster.some((entry) => entry.id === id));

// ---- What someone's doing at a given time ---------------------------------------

// One person's day, with each thing starting a few minutes differently from one day to the next.
// It's kept with the person's entry in that place's file, because some people are in two files.
function dayOf(entry, day) {
  entry.plans ??= new Map();
  if (!entry.plans.has(day)) {
    if (entry.plans.size > 40) entry.plans.clear();
    const list = entry.day
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !block.every || ((day % block.every) + block.every) % block.every === 0)
      .map(({ block, index }) => {
        const varies = block.exact ? 0 : (seedFrom(`${entry.key}/${day}/${index}`) % (VARIES_BY * 2 + 1)) - VARIES_BY;
        const start = (((toMinutes(block.at) + entry.shift + varies) % MINUTES_IN_A_DAY) + MINUTES_IN_A_DAY) % MINUTES_IN_A_DAY;
        return { block, index, start };
      })
      .sort((a, b) => a.start - b.start);
    entry.plans.set(day, list);
  }
  return entry.plans.get(day);
}

function planAt(entry, hours) {
  const day = Math.floor(hours / 24);
  const minute = (hours - day * 24) * 60;
  const current = dayOf(entry, day).filter((one) => one.start <= minute).at(-1);
  const startDay = current ? day : day - 1;
  const { block, index, start } = current ?? dayOf(entry, startDay).at(-1);
  const elapsed = minute + (current ? 0 : MINUTES_IN_A_DAY) - start;
  const stop = block.rounds ? Math.floor(elapsed / (block.stop ?? ROUND_STOP)) % block.rounds.length : 0;
  const where = block.rounds?.[stop] ?? block.go ?? block.pick?.[seedFrom(`${entry.key}/${startDay}/${index}/pick`) % block.pick.length];
  return { key: `${startDay}.${index}.${stop}`, block, where };
}

// The room a plan sends someone to, so the place's systems can turn them aside: the guards to the alarm, an engineer
// to a repair, anyone headed into bad air somewhere better. detour comes from src/systems.js, and is null when
// nothing's going on.
function levelOfPlan(map, file, entry, plan) {
  const where = plan.where;
  if (!where) return null;
  if (where === "post") return postOf(map, entry.id)?.level ?? null;
  if (/^[@>]/.test(where)) return where.slice(1);
  return file.spots[where]?.level ?? file.groups[where]?.[0]?.level ?? null;
}
function planFor(map, file, entry, hours, detour) {
  const plan = planAt(entry, hours);
  if (!detour) return plan;
  const turn = detour(entry.key, levelOfPlan(map, file, entry, plan), Boolean(plan.block.asleep));
  return turn && map.levels[turn.where.slice(1)] ? { key: `systems:${turn.where}:${turn.doing}`, block: { doing: turn.doing, go: turn.where }, where: turn.where } : plan;
}

const homeOf = (map, id) => Object.values(map.levels).flatMap((level) => level.homes).find((home) => home.id === id);

function postOf(map, id) {
  for (const level of Object.values(map.levels)) {
    const home = level.homes.find((one) => one.id === id);
    if (home) return { level: level.id, x: home.x, y: home.y, ...(home.side ? { side: home.side } : {}) };
  }
  return null;
}

// What someone takes up where they stop: one square, or the whole of their name if it's shown beside
// them. Someone leaving by a door is on their way out of sight, so they don't take up anything.
function squaresOf(map, entry, spot) {
  if (spot.out) return [];
  const label = entry.id ? homeOf(map, entry.id)?.label : null;
  return Array.from({ length: label ? label.length + 2 : 1 }, (_, i) => seatKey({ level: spot.level, y: spot.y, x: spot.side === "left" ? spot.x - i : spot.x + i }));
}

// Squares nobody else stops on: everyone's post, and anything on a level with a name of its own.
function fixedSquares(file, map) {
  if (!file.fixed) {
    file.fixed = new Set(file.roster.filter((entry) => entry.id).flatMap((entry) => {
      const post = postOf(map, entry.id);
      return post ? squaresOf(map, entry, post) : [];
    }));
    for (const level of Object.values(map.levels)) {
      const covers = (x, y, length = 1) => Array.from({ length }, (_, i) => file.fixed.add(seatKey({ level: level.id, x: x + i, y })));
      for (const thing of level.things) covers(thing.x, thing.y);
      for (const key of map.place ? partSquares(map.place, level.id) : []) covers(...key.split(",").map(Number));
      for (const exit of level.exits) covers(exit.side === "left" ? exit.x - exit.label.length - 1 : exit.x, exit.y, exit.label.length + 2);
      for (const label of level.labels) covers(label.x, label.y, label.text.length);
      level.layers.writing.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== " ") covers(x, y);
      }));
    }
  }
  return file.fixed;
}

function fits(map, entry, spot, taken) {
  const squares = squaresOf(map, entry, spot);
  if (!squares.length) return true;
  const [end] = squares.at(-1).split(":")[1].split(",").map(Number);
  return end >= 0 && end < map.levels[spot.level].width && squares.every((key) => !taken.has(key));
}

const standingRoom = new WeakMap();

// The squares of a level where anyone might stop: not in a doorway, and not right in front of a way out.
function squaresToStand(level) {
  if (!standingRoom.has(level)) {
    const squares = [];
    level.open.forEach((row, y) => row.forEach((open, x) => {
      if (open && canStand(level, x, y) && !level.doors.has(`${x},${y}`) && !level.exits.some((exit) => beside({ x, y }, exit))) squares.push({ x, y });
    }));
    standingRoom.set(level, squares);
  }
  return standingRoom.get(level);
}

// A free place somewhere on a level, different each time, with open floor for their name if it can be had.
function somewhereOn(map, entry, plan, levelId, taken) {
  const level = map.levels[levelId];
  const squares = squaresToStand(level);
  // Their own bed, or their own place at the benches, is the same one every day.
  const same = plan.block.stays || plan.block.asleep;
  const first = seedFrom(same ? `${entry.key}/${levelId}` : `${entry.key}/${plan.key}/${levelId}`) % squares.length;
  const inTurn = Array.from({ length: squares.length }, (_, i) => ({ level: levelId, ...squares[(first + i) % squares.length] }));
  const onFloor = (spot) => squaresOf(map, entry, spot).every((key) => {
    const [x, y] = key.split(":")[1].split(",").map(Number);
    return level.open[y]?.[x];
  });
  return inTurn.find((spot) => fits(map, entry, spot, taken) && onFloor(spot)) ?? inTurn.find((spot) => fits(map, entry, spot, taken)) ?? inTurn[0];
}

// Beside the way out of a level that this person always uses, so they can go out of sight through it.
function byTheDoor(map, entry, levelId) {
  const level = map.levels[levelId];
  const door = level.exits[seedFrom(`${entry.key}/${levelId}`) % level.exits.length];
  const spot = STEPS.map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((one) => canStand(level, one.x, one.y));
  return { level: levelId, ...spot, out: true };
}

// Two people can't stop in one place, so the second stops as close as they can get.
function closeTo(map, entry, spot, taken) {
  if (fits(map, entry, spot, taken)) return spot;
  let found = spot;
  findPath(map.levels[spot.level], NO_ONE, spot, (here) => {
    if (!canStand(map.levels[spot.level], here.x, here.y) || !fits(map, entry, { ...spot, x: here.x, y: here.y }, taken)) return false;
    found = { ...spot, x: here.x, y: here.y };
    return true;
  });
  return found;
}

// Where this person goes for what they're doing now. In a group, they take the next place that's free.
function spotFor(file, map, entry, plan, taken) {
  if (plan.where === "post") return postOf(map, entry.id);
  // A level that isn't on the map leaves them where they are, so a typing mistake in the file can't stop the game.
  if (/^[@>]/.test(plan.where) && !map.levels[plan.where.slice(1)]) return null;
  if (plan.where.startsWith("@")) return somewhereOn(map, entry, plan, plan.where.slice(1), taken);
  if (plan.where.startsWith(">")) return byTheDoor(map, entry, plan.where.slice(1));
  if (file.spots[plan.where]) return closeTo(map, entry, file.spots[plan.where], taken);
  const group = file.groups[plan.where] ?? [];
  const first = seedFrom(`${entry.key}/${plan.key}`) % Math.max(1, group.length);
  for (let i = 0; i < group.length; i += 1) {
    const spot = group[(first + i) % group.length];
    if (fits(map, entry, spot, taken)) return spot;
  }
  return group[first] ? closeTo(map, entry, group[first], taken) : null;
}

// ---- Who's where ----------------------------------------------------------------

const atGoal = (state) => state.level === state.goal.level && state.x === state.goal.x && state.y === state.goal.y;

// Everyone exactly where they should be at this moment, as they are after any long gap. Anyone who's
// still doing the same thing as before keeps the place they already had.
function settle(place, hours, before = {}, detour = null) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  const plansNow = file.roster.map((entry) => ({ entry, plan: planFor(map, file, entry, hours, detour) }));
  const stays = ({ entry, plan }) => before[entry.key]?.task === plan.key;
  const taken = new Set(fixedSquares(file, map));
  for (const one of plansNow.filter(stays)) squaresOf(map, one.entry, before[one.entry.key].goal).forEach((key) => taken.add(key));
  const people = {};
  for (const one of plansNow) {
    const { entry, plan } = one;
    const goal = stays(one) ? before[entry.key].goal : spotFor(file, map, entry, plan, taken);
    if (!goal) continue;
    squaresOf(map, entry, goal).forEach((key) => taken.add(key));
    people[entry.key] = { task: plan.key, level: goal.level, x: goal.x, y: goal.y, goal, path: null };
  }
  return people;
}

// A place nobody's in is drawn over and over from the same few moments.
const settledAt = new Map();

function settledPlace(place, hours) {
  const key = `${place}@${hours}`;
  if (!settledAt.has(key)) {
    if (settledAt.size > 100) settledAt.clear();
    settledAt.set(key, settle(place, hours));
  }
  return settledAt.get(key);
}

// Only looking at this changes nothing, so showing the game can't change the save.
const peopleOf = (game, place) => game.life?.places[place] ?? settledPlace(place, game.clock.hours);

// The same, for something that's about to move the clock. The save only ever holds the captain's place.
export function lifeOf(game) {
  game.life ??= { at: game.clock.hours, carry: 0, places: {} };
  if (livesHere(game.location)) game.life.places[game.location] ??= structuredClone(peopleOf(game, game.location));
  return game.life;
}

// ---- Walking ---------------------------------------------------------------------

// The way through a place: the first door to take on the way to another level.
function doorTowards(map, from, to) {
  const seen = new Set([from]);
  const queue = map.levels[from].exits.map((exit) => ({ exit, at: exit.to }));
  for (let i = 0; i < queue.length; i += 1) {
    const { exit, at } = queue[i];
    if (at === to) return exit;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const next of map.levels[at]?.exits ?? []) queue.push({ exit, at: next.to });
  }
  return null;
}

const beside = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// The next stretch of someone's walk: the squares across this level, and a door at the end if
// they're leaving it. The last step can be onto a bench or a bunk, which nobody can walk across.
function nextStretch(map, state) {
  const level = map.levels[state.level];
  const { goal } = state;
  if (goal.level === state.level) {
    const path = findPath(level, NO_ONE, state, (here) => beside(here, goal));
    return path && [...path.map(({ x, y }) => [x, y]), [goal.x, goal.y]];
  }
  const door = doorTowards(map, state.level, goal.level);
  if (!door) return null;
  const path = findPath(level, NO_ONE, state, (here) => beside(here, door));
  const beyond = map.levels[door.to];
  const way = beyond?.exits.find((exit) => exit.key === door.via);
  const out = way && STEPS.map(([dx, dy]) => ({ x: way.x + dx, y: way.y + dy })).find((spot) => canStand(beyond, spot.x, spot.y));
  return path && out ? [...path.map(({ x, y }) => [x, y]), { to: door.to, x: out.x, y: out.y }] : null;
}

function walkOn(map, state, steps) {
  for (let left = steps; left > 0 && !atGoal(state); left -= 1) {
    state.path ??= nextStretch(map, state);
    // Nobody ever gets stuck: if there's no way there, they just turn up there.
    if (!state.path?.length) {
      Object.assign(state, { level: state.goal.level, x: state.goal.x, y: state.goal.y, path: null });
      return;
    }
    const next = state.path.shift();
    if (Array.isArray(next)) [state.x, state.y] = next;
    else Object.assign(state, { level: next.to, x: next.x, y: next.y });
    if (!state.path.length) state.path = null;
  }
}

// ---- The clock moves ---------------------------------------------------------------

// Everyone moves on to whatever's next, and walks a little of the way there.
function moveOn(place, people, hours, steps, detour = null) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  for (const entry of file.roster) {
    const state = people[entry.key];
    if (!state) continue;
    const plan = planFor(map, file, entry, hours, detour);
    if (plan.key !== state.task) {
      // Everyone else's place is taken. Their own isn't, in case what's next happens right there too.
      const others = file.roster.filter((one) => one !== entry && people[one.key]);
      const taken = new Set([...fixedSquares(file, map), ...others.flatMap((one) => squaresOf(map, one, people[one.key].goal))]);
      const goal = spotFor(file, map, entry, plan, taken);
      state.task = plan.key;
      if (goal) {
        state.goal = goal;
        state.path = null;
      }
    }
    walkOn(map, state, steps);
  }
}

// The people the story brought to the captain go back to their day, from wherever they're standing,
// once the captain has moved on or a little time has gone by. Anyone without a day stays until the
// story says otherwise.
function companyMovesOn(game, hours) {
  const walk = game.walk;
  if (!walk?.with?.length || !livesHere(walk.place)) return;
  walk.withUntil ??= hours + COMPANY_STAYS / 60;
  if (walk.level === walk.withLevel && !walk.room && hours < walk.withUntil) return;
  const people = game.life.places[walk.place] ?? {};
  walk.with = walk.with.filter((entry) => {
    const state = people[entry.id ?? entry.name];
    if (state) Object.assign(state, { level: walk.withLevel, x: entry.x, y: entry.y, path: null });
    return !state;
  });
}

// Called whenever the clock moves, by however much, wherever the captain is.
export function advanceLife(game) {
  const life = lifeOf(game);
  const hours = game.clock.hours;
  const gap = (hours - life.at) * 60;
  if (gap <= 0) return;
  life.at = hours;
  life.carry = (life.carry ?? 0) + gap * SQUARES_A_MINUTE;
  const steps = Math.floor(life.carry);
  life.carry -= steps;
  const place = game.location;
  const people = life.places[place];
  const detour = livesHere(place) ? detourFor(game, place) : null;
  if (livesHere(place) && people && gap <= LONG_GAP) moveOn(place, people, hours, steps, detour);
  life.places = livesHere(place) ? { [place]: people && gap <= LONG_GAP ? people : settle(place, hours, people, detour) } : {};
  companyMovesOn(game, hours);
}

// ---- What the rest of the game gets to see --------------------------------------

function seenAs(game, map, entry, state, detour = null) {
  const plan = detour ? planFor(map, lifeFileFor(game.location), entry, game.clock.hours, detour) : planAt(entry, game.clock.hours);
  const settled = atGoal(state);
  // Someone going out of sight can still be seen on their way there.
  if (settled && plan.block.hidden) return null;
  const home = entry.id ? homeOf(map, entry.id) : null;
  const heading = map.levels[state.goal.level]?.name.replace(/^The /, "the ");
  return {
    id: entry.id,
    name: entry.name ?? entry.id,
    ...(home?.label ? { label: home.label } : {}),
    ...(home?.greeting ? { greeting: home.greeting } : {}),
    x: state.x,
    y: state.y,
    doing: settled || plan.block.rounds || plan.block.hidden ? plan.block.doing : `heading for ${heading}`,
    ...(settled ? {} : { walking: true }),
    ...(settled && plan.block.asleep ? { asleep: true } : {}),
    ...(entry.crowd ? { crowd: true } : {}),
    ...(settled && state.goal.side ? { side: state.goal.side } : {}),
  };
}

// Everyone on one level of a place right now, in the order of the place's file.
export function peopleAboard(game, place, levelId) {
  const file = lifeFileFor(place);
  const map = mapFor(place);
  const people = peopleOf(game, place);
  const detour = place === game.location ? detourFor(game, place) : null;
  return file.roster
    .filter((entry) => people[entry.key]?.level === levelId && (!entry.id || atPost(game, entry.id)))
    .map((entry) => seenAs(game, map, entry, people[entry.key], detour))
    .filter(Boolean);
}

// Where someone is right now and what they're doing, in a few words, for anyone whose life is simulated.
export function whereNow(game, id) {
  if ([...(game.walk?.with ?? []), ...(game.walk?.room?.people ?? [])].some((entry) => entry.id === id)) return "with the captain";
  // Someone who's in two places' files is wherever the captain is, if that's one of them.
  for (const place of [game.location, ...livingPlaces()]) {
    if (!livesHere(place)) continue;
    const entry = lifeFileFor(place).roster.find((one) => one.id === id);
    const state = entry && peopleOf(game, place)[entry.key];
    if (!state) continue;
    const map = mapFor(place);
    const seen = seenAs(game, map, entry, state);
    const away = place === game.location ? "" : `, on ${LOCATIONS[place].name}`;
    return seen ? `${seen.doing}, at ${map.levels[state.level].name.replace(/^The /, "the ")}${away}` : `somewhere out of sight${away}`;
  }
  return null;
}
