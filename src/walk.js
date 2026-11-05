// Walking around a place that has levels, and talking to the people there. All of it runs on this
// computer. Walking doesn't move the clock by itself, though the clock runs beside it where people
// live their days (see src/life.js). The game master gets one compact line about where the captain
// is, and moves them with set_scene. Each line said in a talk is a normal AI turn, which runTurn in
// src/ai.js sends with a <talk> tag.
//
// world/maps/ has each place's levels, one to a room, and a file's name is the id of the place it's
// for. world/rooms.json has the kinds of room the game can draw for anywhere that isn't on a map,
// and a campaign can keep its own rooms in its folder, so they stay the same from then on.

import { allCharacters, campaignRooms, findCampaignRoom, findCharacter, fullName, saveCampaignRoom } from "./campaign.js";
import { startCheck, startChoiceCheck } from "./checks.js";
import { ITEMS, LOCATIONS } from "./data.js";
import { hasADay, livesHere, peopleAboard } from "./life.js";
import { isCaptain, toOutsider } from "./role.js";
import { addItem, audienceBonus, clockRuns } from "./rules.js";
import { conditionHolds } from "./scene-text.js";
import { recordFact } from "./record.js";
import { rumorsFrom } from "./story-library.js";
import { colorForName, parseNarration } from "../public/story.js";
import { COMBAT_ART, LOOKS, ROOM_KINDS, ROOM_TALK, WORLD_MAPS } from "./world.js";

const STEPS = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const DOOR = "+";
const WALL = "#";
const START = "@";
const FLOOR = ".";
const SNAP_DISTANCE = 3;
const MAX_PEOPLE = 8;
const MAX_NAME = 60;
const MAX_THINGS = 4;
const MAX_LABEL = 14;
const MAX_RECORD = 20;
// How fast the clock can run, in minutes of the game to each real minute.
const CLOCK_RATES = [10, 60, 300];
const LONGEST_TICK = 2000;

const spotKey = (x, y) => `${x},${y}`;
const nextTo = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;

// The squares a mark and its name take up, on whichever side of it the name goes.
function runSquares(x, y, length, side = "right") {
  return Array.from({ length: length + 2 }, (_, i) => spotKey(side === "left" ? x - i : x + i, y));
}

// ---- The levels ---------------------------------------------------------

// Turns one level from its file into what the game works with: where can be walked, and what's where.
function compileLevel(id, file, districts = []) {
  const width = Math.max(...file.plan.map((row) => row.length));
  const rows = file.plan.map((row) => row.padEnd(width));
  const floors = new Set(file.floor ?? FLOOR);
  const floorMark = [...floors][0];
  const open = rows.map(() => Array(width).fill(false));
  const homes = [];
  const things = [];
  const exits = [];
  const doors = new Set();
  let start = null;
  const isMark = (ch) => ch === START || file.people?.[ch] || file.things?.[ch] || file.exits?.[ch];
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (floors.has(ch)) open[y][x] = true;
    else if (ch === DOOR) {
      open[y][x] = true;
      doors.add(spotKey(x, y));
    } else if (ch === START) {
      open[y][x] = true;
      start = { x, y };
    } else if (file.people?.[ch]) {
      open[y][x] = true;
      homes.push({ ...file.people[ch], x, y });
    } else if (file.things?.[ch]) things.push({ id: `${id}:${ch}`, ...file.things[ch], x, y });
    else if (file.exits?.[ch]) exits.push({ key: ch, ...file.exits[ch], x, y });
  }));
  // Words on the walls take the place of whatever's under them, gaps and all, so they can be read.
  const written = rows.map(() => Array(width).fill(" "));
  const covered = new Set();
  for (const [x, y, text] of file.writing ?? []) {
    [...text].forEach((ch, i) => {
      if (written[y]?.[x + i] === undefined) return;
      written[y][x + i] = ch;
      covered.add(spotKey(x + i, y));
    });
  }
  const layer = (pick) => rows.map((row, y) => [...row].map((ch, x) => (covered.has(spotKey(x, y)) ? " " : pick(ch))).join(""));
  return {
    id,
    name: file.name,
    desc: file.desc ?? districts.find((district) => district.name === (file.district ?? file.name))?.desc ?? "",
    aliases: file.aliases ?? [],
    width,
    height: rows.length,
    colors: file.colors ?? {},
    open,
    homes,
    things,
    exits,
    doors,
    solid: new Set(things.map((thing) => spotKey(thing.x, thing.y))),
    start: start ?? { x: 1, y: 1 },
    labels: (file.labels ?? []).map((label) => ({ text: label.text, x: label.at[0], y: label.at[1] })),
    // The squares are drawn in layers, so that walls, floors and scenery can each have their own color.
    layers: {
      floor: layer((ch) => (floors.has(ch) ? ch : ch === START || file.people?.[ch] ? floorMark : " ")),
      doors: layer((ch) => (ch === DOOR ? DOOR : " ")),
      walls: layer((ch) => (ch === WALL ? WALL : " ")),
      scenery: layer((ch) => (ch === WALL || ch === DOOR || floors.has(ch) || isMark(ch) ? " " : ch)),
      writing: written.map((row) => row.join("")),
      // What's under the words, for anything that needs to know: f is floor, w is wall, d is a door, and s is scenery.
      under: covered.size ? rows.map((row, y) => [...row].map((ch, x) => {
        if (!covered.has(spotKey(x, y)) || ch === " ") return " ";
        return floors.has(ch) || ch === START || file.people?.[ch] ? "f" : ch === WALL ? "w" : ch === DOOR ? "d" : "s";
      }).join("")) : [],
    },
  };
}

// Which way an exit points, from where it is in the level's walls, and which side its name goes.
function settleExit(exit, level, label) {
  const glyph = exit.x === 0 ? "<" : exit.x === level.width - 1 ? ">" : exit.y === 0 ? "^" : "v";
  const side = exit.side ?? (exit.x + label.length + 2 > level.width ? "left" : "right");
  return { ...exit, label, glyph, side };
}

function compileMap(file, districts = []) {
  const levels = Object.fromEntries(Object.entries(file.levels).map(([id, level]) => [id, compileLevel(id, level, districts)]));
  for (const level of Object.values(levels)) {
    level.exits = level.exits.map((exit) => settleExit(exit, level, exit.label ?? levels[exit.to]?.name ?? exit.to));
  }
  const overview = file.overview ? compileLevel("overview", { name: file.name, plan: file.overview.plan, floor: Object.keys(file.overview.floors).join("") }) : null;
  return { name: file.name ?? "", start: file.start, levels, overview: overview && { ...overview, title: file.overview.title ?? "Map", floors: file.overview.floors, rooms: file.overview.rooms }, talk: { ...ROOM_TALK, ...file.talk } };
}

const maps = new Map();

// A map with a mistake in it is skipped, so that place just stays in the classic view.
export function mapFor(place) {
  if (!maps.has(place)) {
    let map = null;
    try {
      if (WORLD_MAPS[place]) map = compileMap(WORLD_MAPS[place], LOCATIONS[place]?.gm?.districts);
    } catch (err) {
      console.error(`The levels for ${place} can't be used: ${err.message}`);
    }
    maps.set(place, map);
  }
  return maps.get(place);
}

export const canStand = (level, x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(spotKey(x, y));

// ---- Doors only the story can open --------------------------------------

// Some ways in are for the story to decide: a guard, a locked door, a picket line. The player can
// ask at the door, which is a normal AI turn. Once the story has taken the captain in, it stays open.
const isClosed = (game, exit) => Boolean(exit.closed) && !game.opened?.[game.location]?.includes(exit.to);

function openDoorsTo(game, id) {
  game.opened ??= {};
  game.opened[game.location] ??= [];
  if (!game.opened[game.location].includes(id)) game.opened[game.location].push(id);
}

// Without an AI, asking at a closed door goes by the rule written in the map file, under closed.ask:
// an answer that leaves it closed, a condition that opens it, or a check whose result decides.
export function askAtDoor(game, key) {
  const walk = walkOf(game);
  const level = levelOf(game, walk, mapFor(game.location));
  const exit = level.exits.find((one) => one.key === key);
  if (!exit || !isClosed(game, exit)) throw new Error("That door isn't closed.");
  const rule = exit.closed.ask ?? {};
  const open = (said) => {
    openDoorsTo(game, exit.to);
    if (rule.flag) recordFact(game, { id: rule.flag });
    return { said: said ?? "The way is open.", opened: true };
  };
  // In order: a condition that opens it, a check whose result decides, a door that simply opens when asked, or an answer that leaves it closed.
  if (rule.if) {
    if (conditionHolds(game, rule.if, { attr: () => 0, skillRank: () => 0, maxHp: () => 1 })) return open(rule.opens);
    if (!rule.check) return { said: rule.else ?? "Not this way, not yet." };
  }
  if (rule.check) {
    const [skill, difficulty, audience] = rule.check.split(":");
    startCheck(game, { skill, difficulty, audience: audience ?? null, reason: rule.reason ?? `Get through: ${exit.label}`, scene: exit.closed.look, source: "door" });
    game.doorAsked = { place: game.location, to: exit.to, pass: rule.pass ?? "The way is open.", fail: rule.fail ?? "The way stays closed.", flag: rule.flag ?? null };
    return { check: true };
  }
  if (rule.opens) return open(rule.opens);
  return { said: rule.answer ?? "Asking gets you nowhere, for now. The story will have to take you through." };
}

// A door's check is done, and this says how it went, opening the door if it passed.
export function answerDoor(game, success) {
  const asked = game.doorAsked;
  game.doorAsked = null;
  if (!asked) return "Nothing more is written here for now.";
  if (success && game.location === asked.place) {
    game.opened ??= {};
    game.opened[asked.place] ??= [];
    if (!game.opened[asked.place].includes(asked.to)) game.opened[asked.place].push(asked.to);
    if (asked.flag) recordFact(game, { id: asked.flag });
  }
  return success ? asked.pass : asked.fail;
}

// Without an AI, using a thing is what its file says it is: something to pick up, a written result, or nothing much.
export function useThing(game, key) {
  const walk = walkOf(game);
  const level = levelOf(game, walk, mapFor(game.location));
  const thing = level.things.find((one) => one.id === key);
  if (!thing) throw new Error("That isn't here.");
  if (thing.item && !game.inventory?.[thing.item]) {
    addItem(game, thing.item);
    return { said: `[ITEM] Received: ${ITEMS[thing.item]?.name ?? thing.item}. ${thing.used ?? ""}`.trim() };
  }
  if (thing.item) return { said: "You've already got one." };
  const written = (!isCaptain(game) && thing.usedOther) || thing.used;
  return { said: written ?? "Nothing more comes of it, for now." };
}

// Where the captain can get to from here without the story's help.
function roomsInReach(game, walk, map) {
  const reach = new Set([walk.level]);
  for (const id of reach) {
    for (const exit of map.levels[id]?.exits ?? []) if (!isClosed(game, exit)) reach.add(exit.to);
  }
  return reach;
}

// ---- Somewhere that isn't on the map ------------------------------------

export function seedFrom(text) {
  let seed = 7;
  for (const ch of String(text).toLowerCase()) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// If nothing says what a room is, this goes by what it's called and what the codex says about it.
function kindFromWords(game, name) {
  const lore = (game.lore ?? []).find((entry) => entry.name.toLowerCase() === String(name).toLowerCase())?.text ?? "";
  const counts = (text, word) => (text.match(new RegExp(`(?<![\\p{L}\\p{N}])${word}`, "giu")) ?? []).length;
  let best = "plain";
  let score = 0;
  for (const [id, kind] of Object.entries(ROOM_KINDS)) {
    // The room's own name says more than anything in its description.
    const found = (kind.words ?? []).reduce((sum, word) => sum + counts(String(name), word) * 3 + counts(lore, word), 0);
    if (found > score) {
      best = id;
      score = found;
    }
  }
  return best;
}

const PLAIN_ROOM = {
  floor: FLOOR,
  layouts: [{
    label: [3, 1],
    plan: [
      "##############################################",
      "#............................................#",
      "#............................................#",
      "#...1................2.......................#",
      "#...3................4.......................#",
      "#...5................6.......................#",
      "#...7................8.......................#",
      "#.@..........................................#",
      "##0###########################################",
    ],
  }],
  things: [],
};

// Builds the level for somewhere off the map: the room's own drawing if the campaign has one, and
// otherwise a drawing of its kind. Its name decides which way up that is, so two of a kind differ.
function roomLevel(game, walk, map) {
  const { room } = walk;
  const saved = findCampaignRoom(game.campaign, room.name, game.location);
  const kind = ROOM_KINDS[saved?.kind ?? room.kind] ?? ROOM_KINDS.plain ?? PLAIN_ROOM;
  const seed = seedFrom(room.name);
  const own = Boolean(saved?.plan);
  const layout = own ? saved : kind.layouts[seed % kind.layouts.length];
  const flipped = !own && (seed >> 3) % 2 === 1;
  const drawing = flipped ? [...layout.plan].reverse() : layout.plan;
  const floor = saved?.floor ?? kind.floor ?? FLOOR;
  const spots = {};
  const plan = drawing.map((row, y) => [...row].map((ch, x) => {
    if (!/[1-8a-h]/.test(ch)) return ch;
    spots[ch] = { x, y };
    return floor[0];
  }).join(""));
  const backTo = map.levels[saved?.exitTo] ?? map.levels[walk.level] ?? map.levels[map.start];
  const label = layout.label ?? [3, 1];
  const level = compileLevel("room", {
    name: room.name,
    desc: saved?.desc ?? (game.lore ?? []).find((entry) => entry.name.toLowerCase() === room.name.toLowerCase())?.text ?? kind.desc ?? map.talk?.offPlan ?? "",
    floor,
    colors: saved?.colors ?? kind.colors,
    plan,
    writing: saved?.writing,
    labels: [{ text: room.name.toUpperCase().slice(0, 30), at: [label[0], flipped ? drawing.length - 1 - label[1] : label[1]] }],
    exits: { 0: { back: true, to: backTo.id } },
  });
  level.exits = level.exits.map((exit) => settleExit(exit, level, saved?.exitLabel ?? `Back to ${backTo.name}`));

  // People go to the spot the room's file gives them, and otherwise to the next one free.
  const free = Object.keys(spots).filter((key) => /[1-8]/.test(key)).sort();
  const wanted = saved?.spots ?? {};
  const taken = new Set(room.people.map((person) => wanted[person.id ?? person.name]).filter(Boolean));
  const open = free.filter((key) => !taken.has(key));
  level.homes = room.people.map((person) => {
    const key = wanted[person.id ?? person.name] ?? open.shift();
    const spot = spots[key];
    return spot ? { ...person, label: person.name.slice(0, MAX_LABEL), ...spot } : null;
  }).filter(Boolean);

  // What the game master said is here comes first, then whatever suits this kind of room.
  const named = (saved?.things ?? room.things ?? []).map((thing) => ({ ...thing, use: thing.use ?? `I go over to ${thing.name.replace(/^The /, "the ")} and take a closer look.` }));
  const usual = (kind.things ?? []).map((thing) => ({ ...thing, use: thing.use ?? `I go over to ${thing.name.replace(/^[AT]/, (first) => first.toLowerCase())} and take a closer look.` }));
  const places = Object.keys(spots).filter((key) => /[a-h]/.test(key)).sort();
  const fixed = named.filter((thing) => thing.spot && spots[thing.spot]);
  const loose = places.filter((key) => !fixed.some((thing) => thing.spot === key));
  const rest = [...named.filter((thing) => !thing.spot || !spots[thing.spot]), ...(own ? [] : usual)];
  level.things = [
    ...fixed.map((thing) => ({ ...thing, id: `room:${thing.spot}`, ...spots[thing.spot] })),
    ...loose.map((key, i) => (rest[i] ? { ...rest[i], id: `room:${key}`, ...spots[key] } : null)).filter(Boolean),
  ];
  level.solid = new Set(level.things.map((thing) => spotKey(thing.x, thing.y)));
  return level;
}

// ---- Where the captain is -----------------------------------------------

const newWalk = (place, map) => {
  const { start } = map.levels[map.start];
  return { place, level: map.start, x: start.x, y: start.y, walked: false, with: [], withLevel: null, room: null };
};

// Wherever the captain arrives, they start from that place's way in. Places without levels have nothing here.
// Only looking at this changes nothing, so showing the game can't change the save.
function walkAt(game) {
  const map = mapFor(game.location);
  if (!map) return null;
  return game.walk?.place === game.location ? game.walk : newWalk(game.location, map);
}

// Someone who starts out at their job starts in the room they work in.
export function startInRoom(game, room) {
  const map = mapFor(game.location);
  if (!map?.levels[room]) return;
  const { start } = map.levels[room];
  game.walk = { ...newWalk(game.location, map), level: room, x: start.x, y: start.y };
}

// The same, for something that's about to move the captain.
export function walkOf(game) {
  game.walk = walkAt(game);
  return game.walk;
}

const levelOf = (game, walk, map) => (walk.room ? roomLevel(game, walk, map) : map.levels[walk.level] ?? map.levels[map.start]);

const contactOf = (game, name) => game.contacts?.find((contact) => contact.name.toLowerCase() === name.toLowerCase());

// Someone stands at their post unless the story has put them somewhere else, or they're gone.
export function atPost(game, id) {
  const person = findCharacter(game.campaign, id);
  if (!person) return false;
  // Whoever could have had the chair is only here if they do.
  if (person.chair && game.fleet?.chair?.id !== id) return false;
  const status = contactOf(game, person.name)?.status;
  return !status || status === "alive";
}

// Where the story has put someone beats wherever their day would have them.
function peopleOnLevel(game, walk, level) {
  if (level.id === "room") return level.homes;
  const moved = new Set([...walk.with, ...(game.walk?.room?.people ?? [])].map(keyOf));
  const posted = level.homes.filter((home) => !moved.has(home.id) && atPost(game, home.id) && !hasADay(walk.place, home.id));
  const living = livesHere(walk.place) ? peopleAboard(game, walk.place, level.id).filter((one) => !moved.has(keyOf(one))) : [];
  return [...posted, ...living, ...(walk.withLevel === level.id ? walk.with : [])];
}

const keyOf = (entry) => entry.id ?? entry.name;
const shortName = (game, entry) => entry.label ?? (entry.id ? findCharacter(game.campaign, entry.id)?.name : null) ?? entry.name;

// ---- Finding the way ----------------------------------------------------

// The shortest way from one square to any square that counts as there, not counting the start.
export function findPath(level, blocked, from, isThere) {
  const seen = new Set([spotKey(from.x, from.y)]);
  const queue = [{ x: from.x, y: from.y, back: null }];
  for (let i = 0; i < queue.length; i += 1) {
    const here = queue[i];
    if (isThere(here)) {
      const path = [];
      for (let at = here; at.back; at = at.back) path.unshift({ x: at.x, y: at.y });
      return path;
    }
    for (const [dx, dy] of STEPS) {
      const x = here.x + dx;
      const y = here.y + dy;
      const key = spotKey(x, y);
      if (seen.has(key) || blocked.has(key) || !canStand(level, x, y)) continue;
      seen.add(key);
      queue.push({ x, y, back: here });
    }
  }
  return null;
}

// The captain walks around people if there's a way, and squeezes past them in a narrow duct if there isn't.
function route(level, people, from, isThere) {
  const blocked = new Set(people.map((person) => spotKey(person.x, person.y)));
  return findPath(level, blocked, from, isThere) ?? findPath(level, new Set(), from, isThere);
}

function nearestFloor(level, people, x, y) {
  const taken = new Set(people.map((person) => spotKey(person.x, person.y)));
  for (let distance = 0; distance <= SNAP_DISTANCE; distance += 1) {
    for (let dy = -distance; dy <= distance; dy += 1) {
      const dx = distance - Math.abs(dy);
      for (const cx of dx ? [x - dx, x + dx] : [x]) {
        if (canStand(level, cx, y + dy) && !taken.has(spotKey(cx, y + dy))) return { x: cx, y: y + dy };
      }
    }
  }
  return null;
}

// What's being clicked or walked into: someone to talk to, something to look at, or a way out.
function markAt(game, walk, level, x, y) {
  const person = peopleOnLevel(game, walk, level).find((one) => one.x === x && one.y === y);
  if (person) return { kind: "person", key: keyOf(person), x, y, passing: person.walking };
  const thing = level.things.find((one) => one.x === x && one.y === y);
  if (thing) return { kind: "thing", key: thing.id, x, y };
  const exit = level.exits.find((one) => one.x === x && one.y === y);
  return exit ? { kind: "exit", key: exit.key, x, y, exit } : null;
}

function findMark(game, walk, level, target) {
  const [kind, ...rest] = String(target).split(":");
  const key = rest.join(":");
  if (kind === "person") {
    const person = peopleOnLevel(game, walk, level).find((one) => keyOf(one) === key);
    return person ? { kind, key, x: person.x, y: person.y } : null;
  }
  if (kind === "exit") {
    const exit = level.exits.find((one) => one.key === key);
    return exit ? { kind, key, x: exit.x, y: exit.y, exit } : null;
  }
  const thing = kind === "thing" ? level.things.find((one) => one.id === key) : null;
  return thing ? { kind, key, x: thing.x, y: thing.y } : null;
}

const isWhole = (cell, level) => Number.isInteger(cell?.x) && Number.isInteger(cell?.y) && canStand(level, cell.x, cell.y);

// Puts the captain in a level. Coming through a door, they stand beside the door they came out of.
function enterLevel(game, walk, map, id, viaKey = null) {
  const next = map.levels[id];
  const door = next.exits.find((exit) => exit.key === viaKey);
  const people = peopleOnLevel(game, { ...walk, room: null }, next);
  const taken = new Set(people.map((person) => spotKey(person.x, person.y)));
  const beside = door && STEPS.map(([dx, dy]) => ({ x: door.x + dx, y: door.y + dy })).find((spot) => canStand(next, spot.x, spot.y) && !taken.has(spotKey(spot.x, spot.y)));
  const spot = beside ?? next.start;
  walk.room = null;
  walk.level = id;
  walk.x = spot.x;
  walk.y = spot.y;
  walk.walked = true;
}

function takeExit(game, walk, map, exit) {
  if (exit.back) {
    if (exit.to === walk.level) {
      walk.room = null;
      walk.walked = true;
    } else enterLevel(game, walk, map, exit.to);
    return;
  }
  enterLevel(game, walk, map, exit.to, exit.via);
}

// Everything the player can do by walking. It's all free, and it can't change anything else.
export function walkCommand(game, body) {
  const walk = walkOf(game);
  if (!walk) throw new Error("There's no map of this place.");
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const people = peopleOnLevel(game, walk, level);
  // A click partway through a walk carries on from wherever the captain has got to.
  const spot = walk.room ?? walk;
  const from = isWhole(body.from, level) ? { x: body.from.x, y: body.from.y } : { x: spot.x, y: spot.y };
  const answer = (path, arrived = null, message = null) => ({ walk: walkView(game), path, arrived, message });
  const stand = (path, arrived = null, message = null) => {
    const end = path.at(-1) ?? from;
    spot.x = end.x;
    spot.y = end.y;
    return answer(path, arrived, message);
  };
  const goToMark = (mark, path = route(level, people, from, (here) => nextTo(here, mark))) => {
    if (!path) return stand([], null, "You can't find a way there.");
    if (mark.kind !== "exit") return stand(path, { kind: mark.kind, key: mark.key });
    if (isClosed(game, mark.exit)) return stand(path, { kind: "door", key: mark.key });
    takeExit(game, walk, map, mark.exit);
    return answer(path, { kind: "exit", key: mark.key });
  };

  switch (body.action) {
    case "go": {
      if (body.to) {
        const mark = findMark(game, walk, level, body.to);
        if (!mark) throw new Error("They aren't there any more.");
        return goToMark(mark);
      }
      if (!Number.isInteger(body.x) || !Number.isInteger(body.y)) throw new Error("Choose somewhere to walk to.");
      const mark = markAt(game, walk, level, body.x, body.y);
      if (mark) return goToMark(mark);
      const target = nearestFloor(level, people, body.x, body.y);
      if (!target) return stand([], null, "You can't walk there.");
      const path = route(level, people, from, (here) => here.x === target.x && here.y === target.y);
      return path ? stand(path) : stand([], null, "You can't find a way there.");
    }
    case "step": {
      const dx = Math.sign(Number(body.dx) || 0);
      const dy = dx ? 0 : Math.sign(Number(body.dy) || 0);
      const x = from.x + dx;
      const y = from.y + dy;
      const mark = markAt(game, walk, level, x, y);
      if (mark?.kind === "exit") return goToMark(mark, []);
      // Nobody gets stopped for a talk by accident, just by crossing paths in a corridor.
      if (mark && !mark.passing) return stand([], { kind: mark.kind, key: mark.key });
      return stand(canStand(level, x, y) ? [{ x, y }] : []);
    }
    // The map of the place: straight to a room, or back to somewhere the story has already been.
    case "room": {
      const to = String(body.to ?? "");
      if (to.startsWith("elsewhere:")) {
        const known = findCampaignRoom(game.campaign, to.slice("elsewhere:".length), game.location);
        if (!known) throw new Error("You don't know the way there.");
        putInRoom(game, walk, known.name, peopleNamed(game, known.regulars ?? []), known);
        walk.walked = true;
      } else {
        if (!map.levels[to]) throw new Error("That room isn't on the map.");
        if (!roomsInReach(game, walk, map).has(to)) throw new Error("There's a closed door on the way. You'd have to ask at it.");
        enterLevel(game, walk, map, to);
      }
      return answer([]);
    }
    // Using a thing or asking at a door, without the AI. The page shows what came of it.
    case "use":
      return useThing(game, String(body.key ?? ""));
    case "ask":
      return askAtDoor(game, String(body.key ?? ""));
    default:
      throw new Error("Unknown order.");
  }
}

// ---- The game master keeps the map true to the story --------------------

const plainName = (text) => String(text).toLowerCase().replace(/\s+/g, " ").replace(/^\s*the /, "").trim();

function findOnMap(map, name) {
  const wanted = plainName(name);
  return Object.values(map.levels).find((level) => [level.name, ...level.aliases].some((alias) => plainName(alias) === wanted)) ?? null;
}

function peopleNamed(game, names) {
  const seen = new Set();
  const people = [];
  for (const raw of names) {
    const given = String(raw).trim();
    if (!given) continue;
    if (given.length > MAX_NAME) throw new Error("That's too long for a name. Use what people call them.");
    if (given.toLowerCase() === game.name?.toLowerCase()) continue;
    const person = findCharacter(game.campaign, given);
    const entry = person ? { id: person.id, name: person.name } : { id: null, name: given };
    if (seen.has(keyOf(entry))) continue;
    seen.add(keyOf(entry));
    people.push(entry);
  }
  return people.slice(0, MAX_PEOPLE);
}

const markSquares = (game, entry, x, y) => runSquares(x, y, shortName(game, entry).length, entry.side);

// Puts each person as close to where the captain arrives as they'll fit, without covering anyone else's name.
function standNear(game, level, entry, people) {
  const moved = new Set(people.map((person) => person.id).filter(Boolean));
  const living = livesHere(game.location) ? peopleAboard(game, game.location, level.id).filter((one) => !one.crowd && !moved.has(one.id)) : [];
  const taken = new Set([
    ...[...level.homes.filter((home) => !moved.has(home.id) && atPost(game, home.id)), ...living].flatMap((home) => markSquares(game, home, home.x, home.y)),
    ...level.things.map((thing) => spotKey(thing.x, thing.y)),
    ...level.exits.flatMap((exit) => runSquares(exit.x, exit.y, exit.label.length, exit.side)),
    ...level.labels.flatMap((label) => runSquares(label.x, label.y, label.text.length - 2)),
    ...level.layers.writing.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === " " ? [] : [spotKey(x, y)]))),
    spotKey(entry.x, entry.y),
  ]);
  const near = [];
  findPath(level, new Set(), entry, (here) => {
    near.push(here);
    return false;
  });
  return people.map((one) => {
    // On the plan, someone with a post goes by the same short name wherever they are.
    const home = level.homes.find((other) => other.id === one.id) ?? Object.values(mapFor(game.location)?.levels ?? {}).flatMap((other) => other.homes).find((other) => other.id === one.id);
    const person = home?.label ? { ...one, label: home.label } : one;
    const squares = (spot) => markSquares(game, person, spot.x, spot.y);
    const inside = (key) => {
      const [x, y] = key.split(",").map(Number);
      return x >= 0 && x < level.width && y >= 0 && y < level.height;
    };
    const fits = (spot) => squares(spot).every((key) => !taken.has(key) && inside(key));
    // Best of all is open floor with room for their name, out of the doorways.
    const open = (spot) => !level.doors.has(spotKey(spot.x, spot.y)) && squares(spot).every((key) => {
      const [x, y] = key.split(",").map(Number);
      return level.open[y]?.[x] && !level.doors.has(key);
    });
    const spot = near.find((here) => fits(here) && open(here)) ?? near.find(fits) ?? entry;
    squares(spot).forEach((key) => taken.add(key));
    return { ...person, x: spot.x, y: spot.y };
  });
}

function putOnLevel(game, walk, level, people) {
  openDoorsTo(game, level.id);
  walk.room = null;
  walk.level = level.id;
  walk.walked = false;
  walk.x = level.start.x;
  walk.y = level.start.y;
  walk.with = standNear(game, level, level.start, people);
  walk.withLevel = level.id;
  walk.withUntil = null;
}

function putInRoom(game, walk, name, people, given = {}) {
  const map = mapFor(game.location);
  const saved = findCampaignRoom(game.campaign, name, game.location);
  walk.room = {
    name: saved?.name ?? name,
    kind: ROOM_KINDS[given.kind] ? given.kind : saved?.kind ?? kindFromWords(game, name),
    things: given.things?.length ? given.things : saved?.things ?? [],
    people,
    x: 0,
    y: 0,
  };
  const { start } = roomLevel(game, walk, map);
  walk.room.x = start.x;
  walk.room.y = start.y;
  walk.walked = false;
  walk.with = [];
  walk.withLevel = null;
}

const cleanThings = (things) => (Array.isArray(things) ? things.slice(0, MAX_THINGS).map((thing) => ({ name: String(thing.name).trim().slice(0, MAX_NAME), look: String(thing.look).trim().slice(0, 300) })).filter((thing) => thing.name && thing.look) : []);

// The story has moved the captain, or changed who's with them. A name that isn't on the map gets
// its own room, drawn to suit, so the map can't claim the captain is somewhere they're not. What
// the game master says about a new room is saved with the campaign, so it stays that way.
export function setScene(game, area, names = [], { kind = null, things = [] } = {}) {
  const walk = walkOf(game);
  if (!walk) return "There's no map of this place, so nothing changed.";
  const name = String(area ?? "").trim();
  if (!name || name.length > MAX_NAME) throw new Error(`Give the place a name of up to ${MAX_NAME} characters.`);
  const people = peopleNamed(game, names);
  const map = mapFor(game.location);
  const level = findOnMap(map, name);
  const company = people.map((person) => person.name).join(", ");
  if (level) {
    putOnLevel(game, walk, level, people);
    return `The map now shows the player at ${level.name}${company ? `, with ${company}` : ""}.`;
  }
  const given = { kind, things: cleanThings(things) };
  const saved = findCampaignRoom(game.campaign, name, game.location);
  const regulars = peopleNamed(game, saved?.regulars ?? []);
  putInRoom(game, walk, name, people.length ? people : regulars, given);
  if (game.campaign) {
    saveCampaignRoom(game.campaign, {
      ...saved,
      name: walk.room.name,
      place: game.location,
      kind: walk.room.kind,
      ...(given.things.length || saved?.things ? { things: walk.room.things } : {}),
      regulars: saved?.regulars ?? people.map(keyOf),
    });
  }
  return `The map now shows the player off the map, at ${walk.room.name}, in a room of the kind "${walk.room.kind}"${company ? `, with ${company}` : ""}.`;
}

// One compact line in the state block, with what everyone's doing where they live their own days.
export function walkLine(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  if (walk.room) {
    const names = walk.room.people.map((person) => person.name).join(", ");
    return `Map: player off the map, at ${walk.room.name}.${names ? ` With: ${names}.` : ""}`;
  }
  const map = mapFor(game.location);
  const level = map.levels[walk.level] ?? map.levels[map.start];
  const people = peopleOnLevel(game, walk, level);
  const named = people.filter((one) => !one.crowd).map((one) => (one.doing ? `${shortName(game, one)} (${one.doing})` : shortName(game, one)));
  const others = people.length - named.length;
  const here = [...named, ...(others ? [`${others} other ${others === 1 ? "person" : "people"}`] : [])];
  return `Map: player ${walk.walked ? "walked to" : "at"} ${level.name}.${here.length ? ` Nearby: ${here.join(", ")}.` : ""}`;
}

// ---- Saves from before there were levels --------------------------------

function lastMention(text, names) {
  let best = null;
  for (const { name, level } of names) {
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu"))) {
      if (!best || match.index > best.index) best = { index: match.index, name, level };
    }
  }
  return best;
}

function speakersIn(game, scenes) {
  const names = new Set();
  for (const scene of scenes) {
    for (const block of parseNarration(scene.text)) {
      if (block.type === "speech" && !block.voice) names.add(block.speaker);
    }
  }
  const everyone = allCharacters(game.campaign);
  return [...names].filter((name) => Object.values(everyone).some((person) => person.name === name || fullName(person) === name));
}

// A save from before this place had a map was written before the story could say where the captain
// is, so this goes by the latest scenes: the last place they name is where the captain must be.
export function walkFromStory(game) {
  const map = mapFor(game.location);
  if (!map) return null;
  const walk = newWalk(game.location, map);
  const scenes = (game.transcript ?? []).filter((entry) => entry.role === "narrator").slice(-2);
  const onMap = Object.values(map.levels).flatMap((level) => [level.name, ...level.aliases].map((name) => ({ name, level })));
  const invented = (game.lore ?? []).filter((entry) => entry.kind === "place").map((entry) => ({ name: entry.name, level: null }));
  const names = [...onMap, ...invented];
  let found = null;
  // A choice can mention anywhere, so only the scene itself counts.
  for (const scene of [...scenes].reverse()) {
    found = lastMention(stripChoices(scene.text), names);
    if (found) break;
  }
  if (!found) return walk;
  const people = peopleNamed(game, speakersIn(game, scenes));
  if (found.level) putOnLevel(game, walk, found.level, people);
  else putInRoom(game, walk, (game.lore ?? []).find((entry) => entry.name.toLowerCase() === found.name.toLowerCase())?.name ?? found.name, people);
  return walk;
}

// A save from when the whole ship was one plan keeps its room. The deck plan has the same shape, and its floor says which room is which.
export function walkFromOnePlan(game) {
  const old = game.walk;
  if (!old) return walkFromStory(game);
  const map = mapFor(game.location);
  if (!map) return null;
  const walk = newWalk(game.location, map);
  const floorAt = map.overview?.floors?.[WORLD_MAPS[game.location]?.overview?.plan?.[old.y]?.[old.x]];
  if (floorAt) enterLevel(game, walk, map, floorAt);
  walk.walked = false;
  if (old.room) {
    const saved = findCampaignRoom(game.campaign, old.room.name, game.location);
    const names = [...(old.room.people ?? []).map(keyOf), ...(saved?.regulars ?? [])];
    putInRoom(game, walk, old.room.name, peopleNamed(game, names));
  }
  return walk;
}

// ---- What the browser gets to see ---------------------------------------

function personView(game, entry) {
  const person = entry.id ? findCharacter(game.campaign, entry.id) : null;
  const name = person ? fullName(person) : entry.name;
  return {
    key: keyOf(entry),
    name,
    short: shortName(game, entry),
    color: person?.color ?? colorForName(name),
    x: entry.x,
    y: entry.y,
    side: entry.side ?? "right",
    ...(entry.doing ? { doing: entry.doing } : {}),
    ...(entry.walking ? { walking: true } : {}),
    ...(entry.asleep ? { asleep: true } : {}),
    ...(entry.crowd ? { crowd: true } : {}),
  };
}

const thingView = (game, thing) => ({
  id: thing.id,
  name: thing.name,
  look: (!isCaptain(game) && thing.lookOther) || thing.look,
  use: (!isCaptain(game) && thing.useOther) || thing.use,
  x: thing.x,
  y: thing.y,
  have: Boolean(thing.item && game.inventory?.[thing.item]),
  // Something to pick up or a written result answers from the file, even with an AI, so the page knows it's free.
  written: Boolean(thing.item || thing.used || (!isCaptain(game) && thing.usedOther)),
});

function exitView(game, exit) {
  const { key, x, y, label, glyph, side } = exit;
  if (!isClosed(game, exit)) return { key, x, y, label, glyph, side };
  return { key, x, y, label, glyph: "x", side, closed: true, look: exit.closed.look, use: exit.closed.use, written: Boolean(exit.closed.ask) };
}

function overviewView(game, walk, map) {
  const { overview } = map;
  if (!overview) return null;
  const reach = roomsInReach(game, walk, map);
  // Nobody can see who's behind a door they can't get through.
  const inRoom = (room) => (map.levels[room.level] && reach.has(room.level) ? peopleOnLevel(game, { ...walk, room: null }, map.levels[room.level]) : []);
  return {
    title: overview.title,
    cols: overview.width,
    lines: overview.height,
    layers: overview.layers,
    floors: overview.floors,
    rooms: overview.rooms.map((room) => {
      const people = inRoom(room);
      return {
        id: room.level,
        name: map.levels[room.level]?.name ?? room.level,
        text: room.text,
        x: room.at[0],
        y: room.at[1],
        here: !walk.room && walk.level === room.level,
        closed: !reach.has(room.level),
        people: people.filter((one) => !one.crowd).map((one) => shortName(game, one)),
        others: people.filter((one) => one.crowd).length,
      };
    }),
    // The places the story has been that aren't on the map.
    elsewhere: Object.values(campaignRooms(game.campaign)).filter((room) => (room.place ?? game.location) === game.location).map((room) => ({ name: room.name, here: walk.room?.name === room.name })),
  };
}

// What a room's made of and how it's lit, for the isometric view. Nothing else needs to know.
export function lookOf(place, levelName) {
  const { levels = {}, ...general } = LOOKS.places[place] ?? {};
  return { ...LOOKS.default, ...general, ...levels[levelName] };
}

export function walkView(game) {
  const walk = walkAt(game);
  if (!walk) return null;
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const spot = walk.room ?? walk;
  return {
    offPlan: Boolean(walk.room),
    cols: level.width,
    lines: level.height,
    layers: level.layers,
    labels: level.labels,
    colors: level.colors,
    look: lookOf(game.location, level.name),
    captain: { x: spot.x, y: spot.y },
    here: { id: walk.room ? walk.room.name : level.id, name: level.name, desc: level.desc },
    people: peopleOnLevel(game, walk, level).map((entry) => personView(game, entry)),
    things: level.things.map((thing) => thingView(game, thing)),
    exits: level.exits.map((exit) => exitView(game, exit)),
    overview: overviewView(game, walk, map),
    ...(livesHere(walk.place) ? { life: true } : {}),
  };
}

// Just who's in the room with the captain and where they've got to, because this is twice a second.
function peopleNow(game) {
  const walk = walkAt(game);
  const level = levelOf(game, walk, mapFor(game.location));
  return { here: walk.room ? walk.room.name : level.id, people: peopleOnLevel(game, walk, level).map((entry) => personView(game, entry)) };
}

// The clock running by itself, while the player explores somewhere people live their days. It waits
// for anything with its own window, because time stands still for those, and everywhere else it stays still.
export function walkTick(game, body) {
  if (game.combat || game.check || game.talk || game.fleet?.raid) return { held: true };
  if (!walkAt(game) || !livesHere(game.location)) return { still: true };
  if (!CLOCK_RATES.includes(body.rate)) throw new Error("That isn't one of the clock's speeds.");
  const ms = Math.max(0, Math.min(Number(body.ms) || 0, LONGEST_TICK));
  const notes = clockRuns(game, (ms / 60000) * body.rate);
  return { notes, ...peopleNow(game) };
}

// ---- Talking ------------------------------------------------------------

function needTalk(game) {
  if (!game.talk) throw new Error("You're not talking to anyone right now.");
  return game.talk;
}

function openTalk(game, key) {
  const walk = walkOf(game);
  if (!walk) throw new Error("There's nobody to walk up to here.");
  if (game.talk) throw new Error("Finish the talk you're in first.");
  if (!game.transcript?.length) throw new Error("Start the story first.");
  const map = mapFor(game.location);
  const level = levelOf(game, walk, map);
  const entry = peopleOnLevel(game, walk, level).find((one) => keyOf(one) === key);
  if (!entry) throw new Error("They aren't here right now.");
  const person = entry.id ? findCharacter(game.campaign, entry.id) : null;
  const name = person ? fullName(person) : entry.name;
  const short = shortName(game, entry);
  const greetings = map.talk?.greetings ?? {};
  const feeling = contactOf(game, person?.name ?? entry.name)?.attitude ?? "unmet";
  const greeting = (entry.asleep ? greetings.asleep : null) ?? entry.greeting ?? greetings[feeling] ?? "{name} looks up.";
  game.talk = {
    id: Date.now(),
    key,
    personId: entry.id ?? null,
    name,
    short,
    where: level.name,
    doing: entry.doing ?? null,
    log: [{ role: "aside", text: greeting.replaceAll("{name}", short) }],
    lastReply: null,
    said: 0,
    told: [],
    unheard: [],
  };
}

function namesFor(talk, person) {
  return [talk.short, ...(person ? [person.name, ...(person.aliases ?? [])] : [talk.name])];
}

function rumorsLeft(game, talk) {
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  return rumorsFrom(game, talk.key, namesFor(talk, person)).filter((rumor) => !talk.told.includes(rumor));
}

// A free line: what's going around, from the place's file, which goes nowhere near the AI.
function tellRumor(game) {
  const talk = needTalk(game);
  const [rumor] = rumorsLeft(game, talk);
  if (!rumor) throw new Error("They've told you all they've heard for now.");
  talk.told.push(rumor);
  talk.unheard.push(rumor);
  talk.said += 1;
  const asked = mapFor(game.location)?.talk?.rumorAsked ?? "What have you heard lately?";
  talk.log.push({ role: "player", text: asked }, { role: "narrator", text: `@${talk.name}: "${rumor.replaceAll('"', "'")}"`, free: true });
}

function stripChoices(text) {
  return text.split("\n").filter((line) => !line.trim().startsWith(">")).join("\n").trim();
}

function lastWords(talk) {
  const last = [...talk.log].reverse().find((line) => line.role === "narrator" && !line.free);
  if (!last) return null;
  const speech = parseNarration(stripChoices(last.text)).filter((block) => block.type === "speech").at(-1);
  const quote = speech?.parts.filter((part) => part.kind === "quote").at(-1)?.text.replace(/^["“]|["”]$/g, "").replace(/\s+/g, " ").trim();
  if (!quote) return null;
  return quote.length > 90 ? `${quote.slice(0, 90).replace(/\s+\S*$/, "")}...` : quote;
}

// What was said, kept with the note in the story, so it survives if the AI's memory has to restart.
const talkRecord = (talk) => talk.log
  .filter((line) => line.role === "player" || line.role === "narrator")
  .slice(-MAX_RECORD)
  .map((line) => ({ role: line.role, text: stripChoices(line.text) }));

// The talk is over, and the story gets one line about it. The game master already heard every word.
export function closeTalk(game) {
  const talk = game.talk;
  if (!talk) return;
  game.talk = null;
  if (!talk.said) return;
  const words = lastWords(talk);
  const where = talk.where.replace(/^The /, "the ");
  game.transcript.push({ role: "notice", text: `[TALK] You talked with ${talk.name} at ${where}.${words ? ` Last word: "${words}"` : ""}`, talk: talkRecord(talk) });
}

// A choice with a check on it plays out in its own window, which ends the talk.
function checkFromTalk(game, label) {
  const talk = needTalk(game);
  if (!startChoiceCheck(game, label, [{ role: "narrator", text: talk.lastReply ?? "" }])) throw new Error("That choice isn't on offer any more.");
  talk.log.push({ role: "player", text: label });
  talk.said += 1;
  closeTalk(game);
}

// Everything in a talk that doesn't need the AI.
export function talkCommand(game, body) {
  switch (body.action) {
    case "open": return openTalk(game, body.person);
    case "rumor": return tellRumor(game);
    case "check": return checkFromTalk(game, body.label);
    case "close": return closeTalk(game);
    default: throw new Error("Unknown order.");
  }
}

export function talkSaid(game, text) {
  const talk = needTalk(game);
  talk.log.push({ role: "player", text });
  talk.said += 1;
}

export function talkHeard(game, text, role = "narrator") {
  const talk = game.talk;
  if (!talk) return;
  talk.log.push({ role, text });
  if (role === "narrator") talk.lastReply = text;
}

// A fight or a check has its own window, so it takes over from the talk.
export function talkLineOver(game) {
  if (game.combat || game.check || game.fleet?.raid) closeTalk(game);
}

// What runTurn needs for one line of a talk. In a written conversation, the AI fits the line to the written ones instead of answering freely.
export function talkBrief(game, { written = false } = {}) {
  const talk = needTalk(game);
  const free = talk.unheard.splice(0);
  const told = free.length ? ` Since your last line, they also passed on what people are saying: ${free.map((rumor) => `"${rumor}"`).join(" ")}` : "";
  const soFar = talkRecord(talk).map((line) => (line.role === "player" ? `${isCaptain(game) ? "Captain" : game.name}: ${line.text}` : line.text)).join(" ");
  // The reminder is on every line, because a long story sets a habit of writing long scenes.
  const asked = written
    ? "This conversation is written in advance: fit what the player said to one of the numbered lines in the written_scene block with follow_scene, or answer only as them in one to three sentences with 0, and write no > choices."
    : "Answer only as them, in one to three sentences, then 2 or 3 short > choices.";
  return { name: talk.name, lastReply: talk.lastReply, tag: `<talk with="${talk.name}" at="${talk.where}"${talk.doing ? ` doing="${talk.doing}"` : ""}>${asked}${told}</talk>`, soFar };
}

export function talkView(game) {
  const talk = game.talk;
  if (!talk) return null;
  const person = talk.personId ? findCharacter(game.campaign, talk.personId) : null;
  const contact = contactOf(game, person?.name ?? talk.name);
  const map = mapFor(game.location);
  const home = Object.values(map?.levels ?? {}).flatMap((level) => level.homes).find((one) => one.id === talk.personId);
  const own = (!isCaptain(game) && home?.asksOther) || home?.asks || [];
  const said = new Set(talk.log.filter((line) => line.role === "player").map((line) => line.text));
  // In a written conversation, the things to say are its own, and the map's asks have nobody to answer them: without an AI that's
  // every talk, and with one it's the people with a conversation of their own. typed says whether there's a line to type on.
  const written = game.mode === "written" || Boolean(talk.written);
  return {
    written,
    typed: game.mode !== "written",
    id: talk.id,
    key: talk.key,
    name: talk.name,
    short: talk.short,
    where: talk.where,
    doing: talk.doing ?? null,
    role: toOutsider(game, person?.role) ?? null,
    note: toOutsider(game, person?.note) ?? null,
    color: person?.color ?? colorForName(talk.name),
    art: COMBAT_ART[person?.combat?.art] ?? COMBAT_ART.civilian ?? [],
    attitude: contact?.attitude ?? null,
    relationship: person ? audienceBonus(game, person.id) : 0,
    log: talk.log,
    lastReply: talk.lastReply,
    asks: written ? [] : [...own, ...(map?.talk?.asks ?? [])].filter((ask) => !said.has(ask)),
    rumors: rumorsLeft(game, talk).length,
    rumorLabel: map?.talk?.rumor ?? "Ask what they've heard",
    goodbyeLabel: map?.talk?.goodbye ?? "Say goodbye",
  };
}
