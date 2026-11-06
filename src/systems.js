// Each place's own systems: power, air, lights, doors, cameras, the alarm, comms, and on ships the engines and
// navigation, on stations the docking clamps, and any system a place's file adds. None of them reaches another
// place. Every part is a thing in a room, on a wall or standing on the floor, and it can be worked by hand through
// the check windows, or from a computer that runs it. What they do: a room with no power goes dark and its cameras,
// vents, speakers and screens stop; air that stops moving goes bad over minutes, people leave, and the player is
// hurt; a locked door stops anyone walking through; a camera that sees the player tampering raises the alarm, which
// brings the guards, locks the doors the file says, and costs standing with whoever holds the place. The place's
// engineers fix what's broken, and its people switch back what the player switched off, in time. Nothing here uses
// the AI, which hears one line about anything that isn't working.
//
// world/systems/<place>.txt is a place's own file, read by public/systems-text.js. A place without one gets what
// world/systems/_defaults.json says, worked out from its rooms and things. The save holds only what's different
// from normal, under game.systems[place], and showing the game changes nothing.

import { SKILLS } from "./character-data.js";
import { LOCATIONS } from "./data.js";
import { startCheck } from "./checks.js";
import { genericKindOf, writtenAtThing } from "./computers.js";
import { livesHere, peopleAboard } from "./life.js";
import { recordFact } from "./record.js";
import { isCaptain } from "./role.js";
import { changeStanding, changeStress, hoursNow } from "./rules.js";
import { holderOf } from "./daily.js";
import { atPost, mapFor } from "./walk.js";
import { SYSTEMS_DEFAULTS, SYSTEMS_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_COMPUTERS, WORLD_LIFE, WORLD_SYSTEMS } from "./world.js";
import { KNOWN_SYSTEMS, SYSTEM_TITLES, readComputerLine, readDoorLine, readLocksLine, readPartLine, slugOf } from "../public/systems-text.js";

const D = () => SYSTEMS_DEFAULTS ?? {};
const NORMAL = Object.freeze({});
const BIG_CLASSES = ["hard", "very_hard", "nearly_impossible"];
// Parts that work with no power: the boxes the power comes through, and the clamps' levers.
const NEEDS_NO_POWER = new Set(["junction box", "docking clamps"]);
const plain = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
const lowerFirst = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");
const upperFirst = (text) => (text ? text[0].toUpperCase() + text.slice(1) : "");

// ---- The kinds of part ---------------------------------------------------------------------------

const kindsTable = () => D().parts ?? {};
export function kindOf(name, system) {
  const words = plain(name);
  const table = kindsTable();
  const named = (key, spec) => [key, ...(spec.names ?? [])];
  for (const [key, spec] of Object.entries(table)) if (named(key, spec).includes(words)) return key;
  for (const [key, spec] of Object.entries(table)) if (named(key, spec).some((one) => words.endsWith(` ${one}`))) return key;
  return D().systems?.[system] ?? D().systems?.other ?? "machine";
}
const kindSpec = (kind) => kindsTable()[kind] ?? kindsTable().machine ?? {};
const wordFor = (kind, state) => kindSpec(kind).words?.[state] ?? state;

function numbersOf(file) {
  const base = D().numbers ?? {};
  const pick = (own, fallback, dflt) => (Number.isFinite(own) && own > 0 ? own : Number.isFinite(base[fallback]) ? base[fallback] : dflt);
  return {
    alarm: pick(file.numbers?.alarm, "alarm rings", 30),
    air: pick(file.numbers?.air, "air goes bad", 20),
    airBack: pick(null, "air comes back", 10),
    repair: pick(file.numbers?.repair, "repairs take", 3),
    back: pick(null, "switched back", 6),
  };
}
const airLimits = () => ({ thin: D().air?.thin ?? 60, bad: D().air?.bad ?? 30, stress: D().air?.stress ?? 2, health: D().air?.health ?? 2 });

// ---- Where parts can go --------------------------------------------------------------------------

// Wall squares with the room in front of them: the back walls, facing the room, and the left-hand walls. The walls
// nearest the viewer are drawn low so the room can be seen, so nothing goes on those.
export function wallSpots(level, claimed = new Set()) {
  const spots = [];
  const walkable = (x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(`${x},${y}`);
  const wall = (x, y) => level.layers.walls[y]?.[x] === "#";
  const nearExit = (x, y) => level.exits.some((exit) => Math.abs(exit.x - x) <= 1 && Math.abs(exit.y - y) <= 1);
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) if (wall(x, y) && !nearExit(x, y) && !claimed.has(`${x},${y}`) && walkable(x, y + 1)) spots.push({ x, y, face: "back" });
  }
  for (let x = 0; x < level.width; x += 1) {
    for (let y = 0; y < level.height; y += 1) if (wall(x, y) && !nearExit(x, y) && !claimed.has(`${x},${y}`) && !walkable(x, y + 1) && walkable(x + 1, y)) spots.push({ x, y, face: "side" });
  }
  return spots;
}

// Rooms with no such walls get a standing unit on the floor instead, at the edge, where it can't block the way.
function floorSpot(level, taken, index, count, claimed = new Set()) {
  const walkable = (x, y) => Boolean(level.open[y]?.[x]) && !level.solid.has(`${x},${y}`) && !taken.has(`${x},${y}`) && !claimed.has(`${x},${y}`);
  const homes = new Set(level.homes.map((home) => `${home.x},${home.y}`));
  const nearExit = (x, y) => level.exits.some((exit) => Math.abs(exit.x - x) + Math.abs(exit.y - y) <= 2);
  const candidates = [];
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      if (!walkable(x, y) || homes.has(`${x},${y}`) || (x === level.start.x && y === level.start.y) || nearExit(x, y)) continue;
      if ([[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => !level.open[y + dy]?.[x + dx])) candidates.push({ x, y });
    }
  }
  if (!candidates.length) return null;
  const first = Math.floor(((index + 0.5) * candidates.length) / Math.max(1, count));
  for (let k = 0; k < candidates.length; k += 1) {
    const spot = candidates[(first + k) % candidates.length];
    if (staysConnected(level, taken, spot)) return spot;
  }
  return null;
}

// Whether everywhere that could be walked to still can be, with one more square taken.
function staysConnected(level, taken, spot) {
  const blocked = (x, y) => !level.open[y]?.[x] || level.solid.has(`${x},${y}`) || taken.has(`${x},${y}`) || (x === spot.x && y === spot.y);
  let total = 0;
  let from = null;
  for (let y = 0; y < level.height; y += 1) {
    for (let x = 0; x < level.width; x += 1) {
      if (blocked(x, y)) continue;
      total += 1;
      from ??= { x, y };
    }
  }
  if (!from) return false;
  const seen = new Set([`${from.x},${from.y}`]);
  const queue = [from];
  for (let i = 0; i < queue.length; i += 1) {
    const { x, y } = queue[i];
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const key = `${x + dx},${y + dy}`;
      if (seen.has(key) || blocked(x + dx, y + dy)) continue;
      seen.add(key);
      queue.push({ x: x + dx, y: y + dy });
    }
  }
  // Exits sit in the walls, so each one needs a square beside it that can still be reached.
  const reached = (mark) => [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => seen.has(`${mark.x + dx},${mark.y + dy}`));
  // The same for every thing in the room, and every part already placed, since each has to be walked up to.
  const placed = [...taken].map((key) => key.split(",").map(Number)).map(([x, y]) => ({ x, y }));
  return seen.size === total && level.exits.every(reached) && level.things.every(reached) && placed.every(reached);
}

// The squares names are written on: the ways out's, the room names', and the names of people at their posts or at
// the places their days take them. A part on one would cover a name.
function claimedSquares(place, level) {
  const out = new Set();
  const run = (x, y, length, side = "right") => {
    for (let i = 0; i < length; i += 1) out.add(`${side === "left" ? x - i : x + i},${y}`);
  };
  for (const exit of level.exits) run(exit.x, exit.y, String(exit.label ?? "").length + 2, exit.side);
  for (const label of level.labels) run(label.x, label.y, label.text.length);
  for (const home of level.homes) run(home.x, home.y, String(home.label ?? home.id ?? "").length + 2, home.side);
  out.add(`${level.start.x},${level.start.y}`);
  const life = WORLD_LIFE[place];
  if (life) {
    const longest = Math.max(8, ...Object.values(mapFor(place)?.levels ?? {}).flatMap((one) => one.homes.map((home) => String(home.label ?? "").length))) + 2;
    for (const [lvl, x, y, side] of Object.values(life.spots ?? {})) if (lvl === level.id) run(x, y, longest, side);
    for (const entries of Object.values(life.groups ?? {})) {
      for (const entry of entries) {
        if (Array.isArray(entry)) {
          if (entry[0] === level.id) run(entry[1], entry[2], longest);
        } else if (entry.level === level.id) {
          for (let x = entry.from; x <= entry.to; x += entry.step ?? 1) run(x, entry.y, longest);
        }
      }
    }
  }
  return out;
}

// The squares one room's parts take up, for anyone placing people so their names cover nothing.
export function partSquares(place, room) {
  const model = systemsOf(place);
  return (model?.partsIn[room] ?? []).map((id) => model.parts[id]).filter((part) => part && !part.unplaced).map((part) => `${part.x},${part.y}`);
}

// ---- What a place has, from its file or the defaults --------------------------------------------

function roomFinder(map) {
  const levels = Object.values(map.levels);
  return (name) => {
    const want = plain(name);
    return levels.find((level) => plain(level.name) === want || level.id === want || (level.aliases ?? []).some((alias) => plain(alias) === want)) ?? null;
  };
}
const waysInto = (map, room) => Object.values(map.levels).flatMap((level) => level.exits.filter((exit) => exit.to === room && !exit.back));
const storyClosedInto = (map, room) => waysInto(map, room).some((exit) => exit.closed);

// The rooms in the order they're reached from the way in, in groups of a few, each group on one junction box.
function sectionsOf(map, ids, size) {
  const wanted = new Set(ids);
  const order = [];
  const seen = new Set([map.start]);
  const queue = [map.start];
  while (queue.length) {
    const id = queue.shift();
    if (wanted.has(id)) order.push(id);
    for (const exit of map.levels[id]?.exits ?? []) {
      if (seen.has(exit.to) || !map.levels[exit.to]) continue;
      seen.add(exit.to);
      queue.push(exit.to);
    }
  }
  for (const id of ids) if (!order.includes(id)) order.push(id);
  const groups = [];
  for (let i = 0; i < order.length; i += size) groups.push(order.slice(i, i + size));
  return groups;
}

const classWord = (text) => String(text ?? "").trim().toLowerCase().replace(/\s+/g, "_");

// A place with no file of its own: the same shape as a file, so what's shown on the board can be saved as one.
export function defaultFileFor(place, map) {
  const d = D();
  const levels = Object.values(map.levels);
  const value = { name: LOCATIONS[place]?.name ?? map.name ?? place, numbers: {}, systems: [], computers: [], defaults: true };
  if ((d["no systems"] ?? []).includes(place)) return value;
  const open = (d["open air"] ?? []).includes(place);
  const inside = open ? levels.filter((level) => wallSpots(level).length >= 4) : levels;
  if (!inside.length) return value;
  const names = (list) => list.map((level) => level.name).join(", ");
  const everywhere = open ? names(inside) : "every room";
  const start = map.levels[map.start];
  const sections = sectionsOf(map, inside.map((level) => level.id), 3).map((ids) => ids.map((id) => map.levels[id]));
  value.systems.push({ name: "Power", id: "power", lines: sections.map((group) => ({ text: `junction box in ${group[0].name}${group.length > 1 ? ` for ${names(group)}` : ""}` })) });
  if (!open) {
    const words = d["plant rooms"] ?? [];
    const plant = levels.find((level) => words.some((word) => level.name.toLowerCase().includes(word))) ?? levels.at(-1);
    value.systems.push({ name: "Air", id: "air", lines: [{ text: `air plant in ${plant.name}` }, { text: "vent in every room" }] });
  }
  value.systems.push({ name: "Lights", id: "lights", lines: [{ text: `light switch in ${everywhere}` }] });
  const doors = inside.filter((level) => level.id !== map.start && waysInto(map, level.id).length && !storyClosedInto(map, level.id));
  if (doors.length) value.systems.push({ name: "Doors", id: "doors", lines: doors.map((level) => ({ text: `door to ${level.name}` })) });
  const watchedEverywhere = (d["cameras everywhere"] ?? []).includes(place);
  const cameraRooms = watchedEverywhere ? inside : [inside.includes(start) ? start : inside[0]];
  value.systems.push({ name: "Cameras", id: "cameras", lines: [{ text: `camera in ${watchedEverywhere && !open ? "every room" : names(cameraRooms)}` }] });
  value.systems.push({ name: "Alarm", id: "alarm", lines: [{ text: `speaker in ${everywhere}` }] });
  // Every computer at the place runs what's in its own room, and a big one runs everything.
  for (const level of levels) {
    for (const thing of level.things) {
      const written = writtenAtThing(place, level.id, thing);
      const generic = !written && genericKindOf(thing) && !thing.used && !thing.usedOther;
      if (!written && !generic) continue;
      const big = (written && BIG_CLASSES.includes(classWord(WORLD_COMPUTERS[written].class))) || genericKindOf(thing) === "server";
      value.computers.push({ text: `${thing.name} in ${level.name}: ${big ? "everything" : `everything in ${level.name}`}` });
    }
  }
  for (const [id, computer] of Object.entries(WORLD_COMPUTERS)) {
    if (computer.place !== place || computer.thing || computer.door) continue;
    if (BIG_CLASSES.includes(classWord(computer.class))) value.computers.push({ text: `${id}: everything` });
  }
  return value;
}

// Everyone a place's file could name as a guard or an engineer: the people with days there, and the ones at their posts.
function peopleAt(place, map) {
  const life = WORLD_LIFE[place] ?? {};
  const people = [];
  const add = (key, name) => { if (key && !people.some((one) => one.key === key)) people.push({ key, name: name ?? key }); };
  for (const id of Object.keys(life.people ?? {})) add(id, WORLD_CHARACTERS[id]?.name);
  for (const group of life.crowd ?? []) for (const [name] of group.names) add(name, name);
  for (const level of Object.values(map.levels)) for (const home of level.homes) add(home.id, home.label ?? WORLD_CHARACTERS[home.id]?.name);
  return people;
}

// The people at a place, for the board's lists of guards and engineers.
export const placePeople = (place) => (mapFor(place) ? peopleAt(place, mapFor(place)) : []);

function peopleFor(place, map, list, wordsKey, what, at) {
  const known = peopleAt(place, map);
  if (Array.isArray(list)) {
    return list.map((one) => {
      const want = plain(one);
      const found = known.find((person) => plain(person.key) === want || plain(person.name) === want || plain(person.name).split(" ").includes(want));
      if (!found) at(null, `${what}: ${one} isn't anyone with a day or a post at this place`);
      return found?.key ?? null;
    }).filter(Boolean);
  }
  const words = D()[wordsKey] ?? [];
  const life = WORLD_LIFE[place] ?? {};
  const matches = (day) => day.some((block) => words.some((word) => String(block.doing ?? "").toLowerCase().includes(word)));
  const keys = Object.entries(life.people ?? {}).filter(([, day]) => matches(day)).map(([id]) => id);
  for (const group of life.crowd ?? []) if (matches(group.day)) keys.push(...group.names.map(([name]) => name));
  return keys;
}

const models = new Map();
const compiling = new Set();

// Read again after a file changes. The maps are made again too, because parts on the floor are part of the map.
export function clearSystems() {
  models.clear();
}

export function systemsOf(place) {
  if (!place) return null;
  if (models.has(place)) return models.get(place);
  if (compiling.has(place)) return null;
  compiling.add(place);
  try {
    models.set(place, compileSystems(place));
  } catch (err) {
    console.error(`The systems at ${place} can't be used: ${err.message}`);
    models.set(place, null);
  } finally {
    compiling.delete(place);
  }
  return models.get(place);
}

function compileSystems(place) {
  const map = mapFor(place);
  if (!map) return null;
  const own = WORLD_SYSTEMS[place];
  const file = own ?? defaultFileFor(place, map);
  const name = LOCATIONS[place]?.name ?? map.name ?? place;
  const problems = [];
  const at = (line, message) => problems.push({ line: line ?? null, message });
  const findRoom = roomFinder(map);
  const levels = Object.values(map.levels);
  const model = {
    place, name, written: Boolean(own), file, numbers: numbersOf(file),
    systems: [], parts: {}, partsIn: {}, doors: {}, circuits: {}, alarmLocks: [], computers: [], guards: [], engineers: [], problems,
  };
  const roomsFor = (list, line) => list.map((one) => findRoom(one) ?? (at(line, `${name} has no room called ${one}`), null)).filter(Boolean);
  const addPart = (system, partName, level, extra = {}) => {
    const base = `${system}:${slugOf(partName)}:${level.id}`;
    let id = base;
    for (let n = 2; model.parts[id]; n += 1) id = `${base}:${n}`;
    const part = { id, system, name: partName, kind: extra.kind ?? kindOf(partName, system), room: level.id, ...extra };
    model.parts[id] = part;
    (model.partsIn[level.id] ??= []).push(id);
    return part;
  };
  for (const system of file.systems ?? []) {
    if (model.systems.some((one) => one.id === system.id)) continue;
    const entry = { id: system.id, name: system.name, title: SYSTEM_TITLES[system.id] ?? upperFirst(system.name), known: KNOWN_SYSTEMS.includes(system.id), parts: [] };
    model.systems.push(entry);
    for (const raw of system.lines ?? []) {
      const text = typeof raw === "string" ? raw : raw.text;
      const line = raw.line ?? null;
      if (entry.id === "doors") {
        const door = readDoorLine(text);
        if (door.problem) {
          at(line, door.problem);
          continue;
        }
        for (const level of roomsFor(door.rooms, line)) {
          if (model.doors[level.id]) at(line, `the door to ${level.name} is written twice`);
          else if (!waysInto(map, level.id).length) at(line, `nothing leads into ${level.name}, so it has no door to lock`);
          else {
            model.doors[level.id] = { id: `door:${level.id}`, to: level.id, look: door.look, story: storyClosedInto(map, level.id) };
            entry.parts.push(model.doors[level.id].id);
          }
        }
        continue;
      }
      if (entry.id === "alarm") {
        const locks = readLocksLine(text);
        if (locks) {
          for (const level of roomsFor(locks.rooms, line)) model.alarmLocks.push(level.id);
          continue;
        }
      }
      const parsed = readPartLine(text);
      if (parsed.problem) {
        at(line, parsed.problem);
        continue;
      }
      if (parsed.feeds && entry.id !== "power") at(line, "only a power part has for and the rooms it powers");
      for (const level of parsed.every ? levels : roomsFor(parsed.rooms, line)) {
        const feeds = entry.id === "power" ? (parsed.feeds ? roomsFor(parsed.feeds, line) : [level]) : null;
        const part = addPart(entry.id, parsed.part, level, { look: parsed.look, ...(feeds ? { feeds: feeds.map((one) => one.id) } : {}) });
        entry.parts.push(part.id);
        for (const fed of feeds ?? []) {
          const had = model.circuits[fed.id];
          if (had) at(line, `${fed.name} is already powered by the ${model.parts[had].name} in ${map.levels[model.parts[had].room].name}`);
          else model.circuits[fed.id] = part.id;
        }
      }
    }
  }
  for (const id of model.alarmLocks) if (!model.doors[id]) at(null, `the alarm locks the door to ${map.levels[id].name}, which needs to be under Doors too`);
  model.guards = peopleFor(place, map, file.guards, "guard words", "guards", at);
  model.engineers = peopleFor(place, map, file.engineers, "engineer words", "engineers", at);
  for (const raw of file.computers ?? []) {
    const text = typeof raw === "string" ? raw : raw.text;
    const line = raw.line ?? null;
    const c = readComputerLine(text);
    if (c.problem) {
      at(line, c.problem);
      continue;
    }
    for (const sid of c.systems) if (sid !== "everything" && !model.systems.some((one) => one.id === sid)) at(line, `${name} has no system called ${sid}`);
    const systems = c.systems.includes("everything") ? model.systems.map((one) => one.id) : c.systems.filter((sid) => model.systems.some((one) => one.id === sid));
    const rooms = c.rooms ? roomsFor(c.rooms, line).map((one) => one.id) : null;
    if (c.classKey && !["easy", "moderate", ...BIG_CLASSES].includes(c.classKey)) at(line, `a console's class is easy, moderate, hard, very hard or nearly impossible, not ${c.classKey}`);
    let ref = null;
    if (c.room) {
      const level = findRoom(c.room);
      if (!level) {
        at(line, `${name} has no room called ${c.room}`);
        continue;
      }
      const thing = level.things.find((one) => plain(one.name) === plain(c.ref));
      if (thing) ref = { kind: "thing", thing: thing.id, room: level.id, name: thing.name };
      else {
        const part = addPart("computers", c.ref, level, { kind: "console", classKey: c.classKey ?? "moderate" });
        ref = { kind: "console", part: part.id, room: level.id, name: part.name };
      }
    } else if (WORLD_COMPUTERS[c.ref]) ref = { kind: "written", id: c.ref, room: null, name: WORLD_COMPUTERS[c.ref].name };
    else {
      for (const level of levels) {
        const thing = level.things.find((one) => plain(one.name) === plain(c.ref));
        if (thing) {
          ref = { kind: "thing", thing: thing.id, room: level.id, name: thing.name };
          break;
        }
      }
    }
    if (!ref) {
      at(line, `"${c.ref}" isn't a computer in world/computers or a thing at ${name}. To put a new console in a room, write it as a console in and the room's name`);
      continue;
    }
    model.computers.push({ ref, systems, rooms, line });
  }
  // Every part gets its square: on a wall where there's one free, else standing on the floor where it blocks nothing.
  for (const [room, ids] of Object.entries(model.partsIn)) {
    const level = map.levels[room];
    const claimed = claimedSquares(place, level);
    const walls = wallSpots(level, claimed);
    const taken = new Set();
    ids.forEach((id, i) => {
      const part = model.parts[id];
      let spot = null;
      if (walls.length) {
        const first = Math.floor(((i + 0.5) * walls.length) / ids.length);
        for (let k = 0; k < walls.length && !spot; k += 1) {
          const one = walls[(first + k) % walls.length];
          if (!taken.has(`${one.x},${one.y}`)) spot = one;
        }
      }
      spot ??= floorSpot(level, taken, i, ids.length, claimed);
      if (!spot) {
        at(null, `there's no room left in ${level.name} for the ${part.name}`);
        part.unplaced = true;
        return;
      }
      taken.add(`${spot.x},${spot.y}`);
      Object.assign(part, { x: spot.x, y: spot.y, mount: spot.face ? "wall" : "floor", face: spot.face ?? null });
      if (!spot.face) level.solid.add(`${spot.x},${spot.y}`);
    });
  }
  return model;
}

// The parts of one system, in one room or all of them.
export const partsOf = (model, system, room = null) => (model?.systems.find((one) => one.id === system)?.parts ?? [])
  .map((id) => model.parts[id])
  .filter((part) => part && !part.unplaced && (!room || part.room === room));
const hasSystem = (model, system) => Boolean(model?.systems.some((one) => one.id === system));
const roomNameOf = (place, room) => mapFor(place)?.levels[room]?.name ?? room;

// ---- The state, in the save ------------------------------------------------------------------------

function stateOf(game, place, make = false) {
  if (!make) return game.systems?.[place] ?? null;
  game.systems ??= {};
  return (game.systems[place] ??= { at: hoursNow(game), parts: {}, doors: {}, air: {}, alarm: {}, noted: {} });
}
const partState = (game, place, id) => game.systems?.[place]?.parts?.[id] ?? NORMAL;
const doorState = (game, place, room) => game.systems?.[place]?.doors?.[room] ?? NORMAL;
const alarmState = (game, place) => game.systems?.[place]?.alarm ?? NORMAL;

// What's back to normal is dropped, and a place that's all normal leaves nothing in the save.
function tidy(game, place) {
  const state = game.systems?.[place];
  if (!state) return;
  for (const [id, s] of Object.entries(state.parts)) if (s.on !== false && !s.damage) delete state.parts[id];
  for (const [room, s] of Object.entries(state.doors)) if (!s.locked && !s.forced) delete state.doors[room];
  for (const [room, q] of Object.entries(state.air)) if (q >= 100) delete state.air[room];
  if (!state.alarm.ringing && !state.alarm.disarmed) state.alarm = {};
  for (const key of Object.keys(state.noted)) if (state.air[key.split(":")[1]] === undefined) delete state.noted[key];
  const empty = !Object.keys(state.parts).length && !Object.keys(state.doors).length && !Object.keys(state.air).length && !state.alarm.ringing && !state.alarm.disarmed;
  if (empty) delete game.systems[place];
  if (game.systems && !Object.keys(game.systems).length) delete game.systems;
}

// The captain's own ship is theirs to run, so nobody switches back what they do there.
export const ownedBy = (game, place) => place === "meridian" && isCaptain(game);

// ---- What's working --------------------------------------------------------------------------------

export function roomPowered(game, place, room) {
  const box = systemsOf(place)?.circuits[room];
  if (!box) return true;
  const s = partState(game, place, box);
  return s.on !== false && !s.damage;
}

export function partWorks(game, place, part) {
  const s = partState(game, place, part.id);
  if (s.on === false || s.damage) return false;
  return NEEDS_NO_POWER.has(part.kind) || roomPowered(game, place, part.room);
}

export function roomDark(game, place, room) {
  const model = systemsOf(place);
  if (!model) return false;
  const switches = partsOf(model, "lights", room);
  if (switches.length) return !switches.some((part) => partWorks(game, place, part));
  return Boolean(model.circuits[room]) && !roomPowered(game, place, room);
}

export function airFlows(game, place, room) {
  const model = systemsOf(place);
  if (!hasSystem(model, "air")) return true;
  const all = partsOf(model, "air");
  const plants = all.filter((part) => part.kind === "air plant");
  if (plants.length && !plants.some((part) => partWorks(game, place, part))) return false;
  const vents = all.filter((part) => part.kind !== "air plant" && part.room === room);
  return !vents.length || vents.some((part) => partWorks(game, place, part));
}
export const airIn = (game, place, room) => game.systems?.[place]?.air?.[room] ?? 100;

export const watched = (game, place, room) => partsOf(systemsOf(place), "cameras", room).some((part) => partWorks(game, place, part));

export function alarmCanRing(game, place) {
  const model = systemsOf(place);
  if (!hasSystem(model, "alarm") || alarmState(game, place).disarmed) return false;
  return partsOf(model, "alarm").some((part) => partWorks(game, place, part));
}
export const alarmRinging = (game, place) => alarmState(game, place).ringing ?? null;

export function commsUp(game, place) {
  const relays = partsOf(systemsOf(place), "comms");
  return !relays.length || relays.some((part) => partWorks(game, place, part));
}

export function doorLocked(game, place, room) {
  const s = doorState(game, place, room);
  return Boolean(s.locked && !s.forced);
}

// An exit is shut when the door into the room it leads to is locked, or the door of the room it's in.
export function exitLocked(game, place, levelId, exit) {
  if (exit.back || !systemsOf(place)) return false;
  return doorLocked(game, place, exit.to) || doorLocked(game, place, levelId);
}

// Where the player is standing, if it's somewhere with systems.
export function playerSpot(game) {
  const place = game.location;
  const map = mapFor(place);
  if (!map || !systemsOf(place)) return null;
  const walk = game.walk?.place === place ? game.walk : null;
  if (walk?.room) return null;
  return { place, room: walk?.level && map.levels[walk.level] ? walk.level : map.start };
}

// ---- Changing things ---------------------------------------------------------------------------------

const backAfter = (game, place, model, by) => (by !== "player" || ownedBy(game, place) || (!model.guards.length && !model.engineers.length) ? null : hoursNow(game) + model.numbers.back);

export function switchPart(game, place, id, on, { by = "player" } = {}) {
  const model = systemsOf(place);
  if (!model?.parts[id]) throw new Error("There's no such part.");
  const state = stateOf(game, place, true);
  const s = (state.parts[id] ??= {});
  if (on) {
    delete s.on;
    delete s.backAt;
  } else {
    Object.assign(s, { on: false, by, since: hoursNow(game) });
    const back = backAfter(game, place, model, by);
    if (back) s.backAt = back;
    else delete s.backAt;
  }
  return settleChange(game, place);
}

export function damagePart(game, place, id, damage = "broken", { by = "player" } = {}) {
  const model = systemsOf(place);
  if (!model?.parts[id]) throw new Error("There's no such part.");
  const state = stateOf(game, place, true);
  const s = (state.parts[id] ??= {});
  Object.assign(s, { damage, by, since: hoursNow(game) });
  if (model.engineers.length) s.fixAt = hoursNow(game) + model.numbers.repair;
  else delete s.fixAt;
  return settleChange(game, place);
}

export function repairPart(game, place, id) {
  const s = game.systems?.[place]?.parts?.[id];
  if (s) {
    delete s.damage;
    delete s.fixAt;
  }
  return settleChange(game, place);
}

// Locking needs the door's panel to have power, unless it's the story doing it. A forced door won't lock at all.
export function setDoor(game, place, room, how, { by = "player" } = {}) {
  const model = systemsOf(place);
  const door = model?.doors[room];
  if (!door) throw new Error("That door isn't one the place's systems run.");
  const state = stateOf(game, place, true);
  const s = (state.doors[room] ??= {});
  const lines = [];
  const name = roomNameOf(place, room);
  if (how === "locked") {
    if (s.forced) lines.push(`[DOOR] The door to ${name} has been forced, and won't lock.`);
    else {
      Object.assign(s, { locked: true, by, since: hoursNow(game) });
      const back = backAfter(game, place, model, by);
      if (back) s.backAt = back;
      lines.push(`[DOOR] The door to ${name} is locked.`);
    }
  } else if (how === "unlocked") {
    delete s.locked;
    delete s.backAt;
    lines.push(`[DOOR] The door to ${name} is unlocked.`);
  } else if (how === "forced") {
    Object.assign(s, { forced: true, by, since: hoursNow(game) });
    delete s.locked;
    delete s.backAt;
    if (model.engineers.length) s.fixAt = hoursNow(game) + model.numbers.repair;
  } else if (how === "fixed") {
    delete s.forced;
    delete s.fixAt;
  }
  // A story door that's opened stays open for the story too.
  if (how === "opened" || (how === "unlocked" && door.story)) {
    game.opened ??= {};
    game.opened[place] ??= [];
    if (!game.opened[place].includes(room)) game.opened[place].push(room);
    if (how === "opened") lines.push(`[DOOR] The way to ${name} is open.`);
  }
  lines.push(...settleChange(game, place));
  return lines;
}

// Whoever holds the place hears about it, and it goes on the record for the stories.
function seenCost(game, place, model) {
  const lines = [];
  const standing = changeStanding(game, holderOf(game, place), D().seen?.standing ?? -2, `You were seen tampering with the systems at ${model.name}.`);
  if (standing) lines.push(standing);
  try {
    recordFact(game, { id: `seen_tampering_at_${place}`.slice(0, 40), text: `You were seen tampering with the systems at ${model.name}.`, from: "systems" });
  } catch {
    // A full record keeps what it has.
  }
  return lines;
}

export function soundAlarm(game, place, room, { seen = false, by = "player" } = {}) {
  const model = systemsOf(place);
  const lines = [];
  if (!model) return lines;
  if (!alarmCanRing(game, place)) {
    if (seen) lines.push(...seenCost(game, place, model));
    return lines;
  }
  const state = stateOf(game, place, true);
  const had = state.alarm.ringing;
  state.alarm.ringing = { room: room ?? had?.room ?? null, since: had?.since ?? hoursNow(game), seen: Boolean(seen || had?.seen), by };
  if (!had) {
    lines.push(`[ALARM] The alarm is ringing at ${model.name}${room ? `, in ${roomNameOf(place, room)}` : ""}.`);
    for (const to of model.alarmLocks) {
      const s = (state.doors[to] ??= {});
      if (s.forced || s.locked || !roomPowered(game, place, to)) continue;
      Object.assign(s, { locked: true, by: "alarm", since: hoursNow(game) });
      lines.push(`[DOOR] The door to ${roomNameOf(place, to)} locks.`);
    }
  }
  if (seen && !had?.seen) lines.push(...seenCost(game, place, model));
  return lines;
}

export function silenceAlarm(game, place, { quiet = false } = {}) {
  const state = game.systems?.[place];
  if (!state?.alarm?.ringing) return [];
  delete state.alarm.ringing;
  for (const s of Object.values(state.doors)) {
    if (s.by === "alarm" && s.locked) delete s.locked;
  }
  tidy(game, place);
  return quiet ? [] : [`[ALARM] The alarm at ${systemsOf(place)?.name ?? place} stops.`];
}

export function armAlarm(game, place, armed, { by = "player" } = {}) {
  const model = systemsOf(place);
  const state = stateOf(game, place, true);
  const lines = [];
  if (armed) {
    delete state.alarm.disarmed;
    delete state.alarm.backAt;
    lines.push(`[ALARM] The alarm at ${model.name} is armed.`);
  } else {
    lines.push(...silenceAlarm(game, place, { quiet: true }));
    const again = stateOf(game, place, true);
    again.alarm.disarmed = true;
    again.alarm.by = by;
    const back = backAfter(game, place, model, by);
    if (back) again.alarm.backAt = back;
    lines.push(`[ALARM] The alarm at ${model.name} is disarmed.`);
  }
  tidy(game, place);
  return lines;
}

// Anything that has to follow at once: an alarm with nothing left to ring through stops.
function settleChange(game, place) {
  const lines = [];
  if (alarmRinging(game, place) && !alarmCanRing(game, place)) lines.push(...silenceAlarm(game, place));
  tidy(game, place);
  return lines;
}

// ---- Time going by ---------------------------------------------------------------------------------

// What the game calls someone: the short name on their post, or their name, or the crowd name they go by.
const personName = (place, key) => Object.values(mapFor(place)?.levels ?? {}).flatMap((level) => level.homes).find((home) => home.id === key)?.label ?? WORLD_CHARACTERS[key]?.name ?? key;

// Called whenever the clock moves. Only places where something isn't normal have anything to do.
export function advanceSystems(game) {
  const lines = [];
  if (!game.systems) return lines;
  const t = hoursNow(game);
  for (const place of Object.keys(game.systems)) {
    const model = systemsOf(place);
    const state = game.systems[place];
    if (!model) {
      delete game.systems[place];
      continue;
    }
    const minutes = Math.max(0, (t - (state.at ?? t)) * 60);
    state.at = t;
    const here = place === game.location;
    const say = (...text) => { if (here) lines.push(...text); };
    // What the place's people put right, once it's due.
    for (const [id, s] of Object.entries(state.parts)) {
      const part = model.parts[id];
      if (!part) {
        delete state.parts[id];
        continue;
      }
      const where = roomNameOf(place, part.room);
      if (s.fixAt && s.fixAt <= t) {
        delete s.damage;
        delete s.fixAt;
        say(`[SYSTEMS] ${personName(place, model.engineers[0] ?? "Someone")} has fixed the ${part.name} in ${where}.`);
      }
      if (s.backAt && s.backAt <= t) {
        delete s.on;
        delete s.backAt;
        say(`[SYSTEMS] Someone at ${model.name} has put the ${part.name} in ${where} back on.`);
      }
    }
    for (const [room, s] of Object.entries(state.doors)) {
      if (s.fixAt && s.fixAt <= t) {
        delete s.forced;
        delete s.fixAt;
        say(`[SYSTEMS] ${personName(place, model.engineers[0] ?? "Someone")} has fixed the door to ${roomNameOf(place, room)}.`);
      }
      if (s.backAt && s.backAt <= t) {
        delete s.locked;
        delete s.backAt;
        say(`[DOOR] Someone at ${model.name} has unlocked the door to ${roomNameOf(place, room)} again.`);
      }
    }
    if (state.alarm.backAt && state.alarm.backAt <= t) {
      delete state.alarm.disarmed;
      delete state.alarm.backAt;
      say(`[ALARM] Someone at ${model.name} has armed the alarm again.`);
    }
    // The alarm stops by itself after a while, or as soon as nothing can ring it.
    const ringing = state.alarm.ringing;
    if (ringing && (!alarmCanRing(game, place) || t - ringing.since >= model.numbers.alarm / 60)) say(...silenceAlarm(game, place, { quiet: !here }));
    if (game.systems?.[place] && minutes > 0 && hasSystem(model, "air")) say(...driftAir(game, model, game.systems[place], minutes, here));
    tidy(game, place);
  }
  return lines;
}

// Each room's air moves toward good while it's flowing and toward bad while it isn't. The player feels it.
function driftAir(game, model, state, minutes, here) {
  const lines = [];
  const place = model.place;
  const limits = airLimits();
  for (const level of Object.values(mapFor(place).levels)) {
    const q = state.air[level.id] ?? 100;
    const flowing = airFlows(game, place, level.id);
    const next = flowing ? Math.min(100, q + (100 / model.numbers.airBack) * minutes) : Math.max(0, q - (100 / model.numbers.air) * minutes);
    if (next >= 100) delete state.air[level.id];
    else state.air[level.id] = Math.round(next * 10) / 10;
  }
  const spot = here ? playerSpot(game) : null;
  if (!spot) return lines;
  const q = state.air[spot.room] ?? 100;
  const name = roomNameOf(place, spot.room);
  const thinKey = `thin:${spot.room}`;
  const badKey = `bad:${spot.room}`;
  if (q < limits.bad && !state.noted[badKey]) {
    state.noted[badKey] = true;
    state.noted[thinKey] = true;
    lines.push(`[AIR] The air in ${name} is bad. Get out, or get it moving again.`);
  } else if (q < limits.thin && !state.noted[thinKey]) {
    state.noted[thinKey] = true;
    lines.push(`[AIR] The air in ${name} is getting thin.`);
  } else if (q >= limits.thin && state.noted[thinKey]) {
    delete state.noted[thinKey];
    delete state.noted[badKey];
    lines.push(`[AIR] The air in ${name} is good again.`);
  }
  if (q >= limits.thin) {
    state.harm = 0;
    return lines;
  }
  state.harm = (state.harm ?? 0) + minutes;
  const ticks = Math.floor(state.harm / 10);
  state.harm -= ticks * 10;
  if (!ticks) return lines;
  const stress = limits.stress * ticks;
  lines.push(...changeStress(game, stress), `[STRESS] +${stress}: The thin air in ${name}.`);
  if (q < limits.bad) {
    const was = game.hp;
    game.hp = Math.max(1, game.hp - limits.health * ticks);
    if (game.hp < was) lines.push(`[HEALTH] -${was - game.hp}: The bad air in ${name}.${game.hp === 1 ? " You're close to passing out." : ""}`);
  }
  return lines;
}

// Where someone goes instead of where their day sends them: the guards to the alarm, an engineer to what's due to be
// fixed, and anyone headed for a room with bad air to the nearest room with good air. Asleep, people only notice
// once it's bad. src/life.js asks this for each person, with the room their day has them going to.
export function detourFor(game, place) {
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return null;
  const t = hoursNow(game);
  const limits = airLimits();
  const ringing = state.alarm?.ringing?.room && commsUp(game, place) ? state.alarm.ringing.room : null;
  const due = Object.entries(state.parts).filter(([id, s]) => s.fixAt && s.fixAt - t <= 1 && model.parts[id]).sort((a, b) => a[1].fixAt - b[1].fixAt);
  const fixing = {};
  due.forEach(([id], i) => {
    const key = model.engineers[i % Math.max(1, model.engineers.length)];
    if (key && !fixing[key]) fixing[key] = model.parts[id];
  });
  const map = mapFor(place);
  const goodAirFrom = (room) => {
    const seen = new Set([room]);
    const queue = [room];
    while (queue.length) {
      const id = queue.shift();
      if ((state.air[id] ?? 100) >= limits.thin && id !== room) return id;
      for (const exit of map.levels[id]?.exits ?? []) {
        if (seen.has(exit.to) || !map.levels[exit.to]) continue;
        seen.add(exit.to);
        queue.push(exit.to);
      }
    }
    return null;
  };
  return (key, room, asleep) => {
    if (ringing && model.guards.includes(key)) return { where: `@${ringing}`, doing: `answering the alarm in ${lowerFirst(roomNameOf(place, ringing))}` };
    if (fixing[key]) return { where: `@${fixing[key].room}`, doing: `fixing the ${fixing[key].name}` };
    const q = room ? state.air[room] ?? 100 : 100;
    if (q >= limits.thin || (asleep && q >= limits.bad)) return null;
    const away = goodAirFrom(room);
    return away ? { where: `@${away}`, doing: `getting out of the bad air in ${lowerFirst(roomNameOf(place, room))}` } : null;
  };
}

// ---- What it does to checks, to the AI, to a jump ------------------------------------------------------

// A dark room helps a sneak and hurts a lookout, and a camera on the player makes sneaking harder.
export function roomEdge(game, skill) {
  const spot = playerSpot(game);
  if (!spot || !skill) return [];
  const parts = [];
  const dark = D().dark ?? {};
  const seen = D().watched ?? {};
  if (dark[skill] && roomDark(game, spot.place, spot.room)) parts.push({ label: "in the dark", value: dark[skill] });
  if (seen[skill] && watched(game, spot.place, spot.room)) parts.push({ label: "a camera on you", value: seen[skill] });
  return parts;
}

// One line for the AI about whatever isn't working where the player is, and nothing when everything is.
export function systemsLine(game) {
  const place = game.location;
  const model = systemsOf(place);
  const state = game.systems?.[place];
  if (!model || !state) return null;
  const limits = airLimits();
  const map = mapFor(place);
  const rooms = Object.values(map.levels);
  const bits = [];
  const list = (levels) => levels.map((level) => level.name).join(", ");
  const unpowered = rooms.filter((level) => !roomPowered(game, place, level.id));
  if (unpowered.length) bits.push(`no power in ${list(unpowered)}`);
  const dark = rooms.filter((level) => roomPowered(game, place, level.id) && roomDark(game, place, level.id));
  if (dark.length) bits.push(`lights out in ${list(dark)}`);
  const badAir = rooms.filter((level) => airIn(game, place, level.id) < limits.bad);
  const thinAir = rooms.filter((level) => airIn(game, place, level.id) < limits.thin && !badAir.includes(level));
  if (badAir.length) bits.push(`the air is bad in ${list(badAir)}`);
  if (thinAir.length) bits.push(`the air is thin in ${list(thinAir)}`);
  const sleeping = livesHere(place) ? [...badAir, ...thinAir].flatMap((level) => peopleAboard(game, place, level.id).filter((one) => one.asleep && !one.crowd).map((one) => `${one.label ?? one.name} in ${level.name}`)) : [];
  if (sleeping.length) bits.push(`asleep in that air: ${sleeping.join(", ")}`);
  const blind = partsOf(model, "cameras").filter((part) => !partWorks(game, place, part)).map((part) => roomNameOf(place, part.room));
  if (blind.length) bits.push(`cameras not working in ${[...new Set(blind)].join(", ")}`);
  const ringing = state.alarm.ringing;
  if (ringing) bits.push(`the alarm is ringing${ringing.room ? ` in ${roomNameOf(place, ringing.room)}` : ""}${ringing.seen ? ", because a camera saw the player tampering" : ""}`);
  if (state.alarm.disarmed) bits.push("the alarm is disarmed");
  for (const [room, s] of Object.entries(state.doors)) {
    if (s.forced) bits.push(`the door to ${roomNameOf(place, room)} has been forced`);
    else if (s.locked) bits.push(`the door to ${roomNameOf(place, room)} is locked`);
  }
  if (!commsUp(game, place)) bits.push("comms are jammed");
  for (const system of model.systems.filter((one) => !["power", "lights", "air", "cameras", "alarm", "doors", "comms"].includes(one.id))) {
    const down = partsOf(model, system.id).filter((part) => !partWorks(game, place, part));
    if (down.length) bits.push(`${lowerFirst(system.title)} down (${down.map((part) => `the ${part.name} in ${roomNameOf(place, part.room)}`).join(", ")})`);
  }
  return bits.length ? `Systems at ${model.name}: ${bits.join("; ")}. Everything else is working.` : null;
}

// The Meridian can't jump with her engines down, and the fleet can't leave a station that has its clamps locked.
export function jumpBlocked(game) {
  if (!isCaptain(game)) return null;
  const ship = systemsOf("meridian");
  const engines = partsOf(ship, "engines");
  if (engines.length && !engines.every((part) => partWorks(game, "meridian", part))) return "The Meridian's engines are down, so the fleet can't jump until they're running again.";
  const at = game.fleet?.at;
  const dock = at ? systemsOf(at) : null;
  if (partsOf(dock, "docking").some((part) => !partWorks(game, at, part))) return `The docking clamps at ${dock.name} are locked, so the fleet can't leave until they're released.`;
  return null;
}

// With the Meridian's navigation down, every jump is plotted by hand: slower, and a fuel more.
export function navigationDown(game) {
  const nav = partsOf(systemsOf("meridian"), "navigation");
  return nav.length > 0 && !nav.every((part) => partWorks(game, "meridian", part));
}

export function airBadHere(game) {
  const spot = playerSpot(game);
  return Boolean(spot) && airIn(game, spot.place, spot.room) < airLimits().bad;
}

// What people say about it, for anyone without a conversation of their own.
export function systemsTalk(game) {
  const place = game.location;
  const ringing = alarmRinging(game, place);
  if (ringing) return `The alarm's going${ringing.room ? ` in ${roomNameOf(place, ringing.room)}` : ""}.${ringing.seen ? " Somebody got caught on camera, they're saying." : " Nobody's saying why."}`;
  const spot = playerSpot(game);
  if (spot && roomDark(game, place, spot.room)) return "Who put the lights out?";
  if (spot && airIn(game, place, spot.room) < airLimits().thin) return "Can you feel that? The air's going.";
  return null;
}

// ---- Working a part by hand ---------------------------------------------------------------------------

function detailOf(action) {
  if (!action.check) return "free";
  const [skill, difficulty] = action.check.split(":");
  return `${SKILLS[skill]?.name ?? skill} check, ${String(difficulty).replace("_", " ")}`;
}

export function partActions(game, place, part) {
  if (part.kind === "console") return [{ id: "use", label: "Use it" }];
  const spec = kindSpec(part.kind);
  const s = partState(game, place, part.id);
  const out = [];
  if (s.damage) {
    if (spec.fix) out.push({ id: "fix", label: spec.fix.label, check: spec.fix.check ?? null });
    return out;
  }
  if (spec.switch) out.push(s.on === false ? { id: "on", label: spec.switch.on } : { id: "off", label: spec.switch.off, tampering: Boolean(spec.switch.tampering) });
  if (spec.break) out.push({ id: "break", label: spec.break.label, check: spec.break.check ?? null, tampering: true, unseen: Boolean(spec.break.unseen) });
  return out;
}

// An alarm's part that works says it's ringing while the alarm rings, instead of saying it's quiet.
const ringingNow = (game, place, part) => part.system === "alarm" && Boolean(alarmRinging(game, place));

export function lookAt(game, place, part) {
  const spec = kindSpec(part.kind);
  const s = partState(game, place, part.id);
  const works = partWorks(game, place, part);
  const state = s.damage ? spec.damaged ?? "It's broken." : s.on === false ? spec.off ?? "It's off." : !works ? "It's dead. There's no power in here." : ringingNow(game, place, part) ? "It's ringing." : spec.on ?? "It's working.";
  return `${part.look ?? spec.look ?? `The ${part.name}.`} ${state}`;
}

function stateWord(game, place, part) {
  const s = partState(game, place, part.id);
  if (s.damage) return s.damage;
  if (s.on === false) return wordFor(part.kind, "off");
  if (!partWorks(game, place, part)) return "no power";
  if (ringingNow(game, place, part)) return "ringing";
  return wordFor(part.kind, "on");
}

// What a tampering hand does where a camera can see it: the alarm, and whoever holds the place hears about it.
function caught(game, place, room) {
  return soundAlarm(game, place, room, { seen: true });
}

function doWork(game, place, part, action, success) {
  const spec = kindSpec(part.kind);
  // On the captain's own ship, nothing the captain does is tampering.
  const seen = Boolean(action.tampering) && !ownedBy(game, place) && watched(game, place, part.room) && !(action.unseen && success);
  const lines = [];
  if (success) {
    if (action.id === "off") {
      lines.push(`[SYSTEMS] You ${lowerFirst(spec.switch.off)}. ${spec.off ?? ""}`.trim(), ...switchPart(game, place, part.id, false, { by: "player" }));
    } else if (action.id === "on") {
      lines.push(`[SYSTEMS] You ${lowerFirst(spec.switch.on)}. ${spec.on ?? ""}`.trim(), ...switchPart(game, place, part.id, true, { by: "player" }));
    } else if (action.id === "break") {
      lines.push(`[SYSTEMS] ${spec.break.done ?? "Done."}`, ...damagePart(game, place, part.id, spec.break.damage ?? "broken", { by: "player" }));
    } else if (action.id === "fix") {
      lines.push(`[SYSTEMS] ${spec.fix.done ?? "It's working again."}`, ...repairPart(game, place, part.id));
    }
  } else lines.push(`[SYSTEMS] ${(action.id === "fix" ? spec.fix?.failed : spec.break?.failed) ?? "Nothing gives."}`);
  if (seen) lines.push(...caught(game, place, part.room));
  return lines;
}

// Everything a locked door offers: forcing it, or getting into its panel.
export function doorActions(game, place, levelId, exit) {
  if (!exitLocked(game, place, levelId, exit)) return [];
  const doors = D().doors ?? {};
  const room = doorLocked(game, place, exit.to) ? exit.to : levelId;
  const out = [{ id: "force", label: doors.force?.label ?? "Force the door", check: doors.force?.check ?? "athletics:moderate", tampering: true }];
  if (roomPowered(game, place, room)) out.push({ id: "hack", label: doors.hack?.label ?? "Hack the door panel", check: `hacking:${doors.hack?.class ?? "easy"}`, tampering: true });
  return out.map((one) => ({ ...one, room, detail: detailOf(one) }));
}

// The locked door can be the one into the next room or the one into this room, and either way the player sees the way
// out, so it's named by where it goes.
export function doorLook(game, place, levelId, exit) {
  const doors = D().doors ?? {};
  const room = doorLocked(game, place, exit.to) ? exit.to : levelId;
  const door = systemsOf(place)?.doors[room];
  return `${door?.look ?? String(doors.look ?? "The door to {room}.").replaceAll("{room}", roomNameOf(place, exit.to))} ${doors.locked ?? "It's locked."}`;
}

// The player works a part in the room they're in. Something free happens at once; anything else opens a check, and
// settlePart finishes it when the check is over.
export function workOnPart(game, key, how) {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const { place, room } = spot;
  const model = systemsOf(place);
  const part = model.parts[String(key).replace(/^part:/, "")];
  if (!part || part.room !== room) throw new Error("That isn't here.");
  const action = partActions(game, place, part).find((one) => one.id === how);
  if (!action) throw new Error("That can't be done to it now.");
  if (action.check) {
    const [skill, difficulty] = action.check.split(":");
    startCheck(game, { skill, difficulty, reason: `${action.label}: the ${part.name} in ${roomNameOf(place, room)}`, scene: lookAt(game, place, part), source: "part", target: `thing:part:${part.id}` });
    game.partAsked = { place, part: part.id, how };
    return { check: true };
  }
  const said = doWork(game, place, part, action, true);
  return { said: said.join("\n") };
}

export function workOnDoor(game, levelId, exit, how) {
  const spot = playerSpot(game);
  if (!spot) throw new Error("There's nothing like that here.");
  const action = doorActions(game, spot.place, levelId, exit).find((one) => one.id === how);
  if (!action) throw new Error("That door isn't locked.");
  const [skill, difficulty] = action.check.split(":");
  startCheck(game, { skill, difficulty, reason: `${action.label}: the door to ${roomNameOf(spot.place, action.room)}`, scene: doorLook(game, spot.place, levelId, exit), source: "part", target: `exit:${exit.key}` });
  game.partAsked = { place: spot.place, door: action.room, how, from: spot.room };
  return { check: true };
}

// A check on a part or a door is over. Returns the lines it left in the story, or null if it wasn't one. A door's
// panel that was hacked opens as a computer, through enterPanel, which src/computers.js passes in.
export function settlePart(game, outcome, enterPanel = null) {
  const asked = game.partAsked;
  if (!asked) return null;
  game.partAsked = null;
  if (!outcome || outcome.training) return null;
  const model = systemsOf(asked.place);
  if (!model) return null;
  let lines = [];
  if (asked.door) {
    const doors = D().doors ?? {};
    const seen = !ownedBy(game, asked.place) && watched(game, asked.place, asked.from ?? asked.door);
    if (asked.how === "force") {
      if (outcome.success) lines.push(`[SYSTEMS] ${doors.force?.done ?? "The door gives."}`, ...setDoor(game, asked.place, asked.door, "forced", { by: "player" }).filter((line) => !/^\[DOOR\] The door to .* is (un)?locked\.$/.test(line)));
      else lines.push(`[SYSTEMS] ${doors.force?.failed ?? "The door doesn't give."}`);
    } else if (asked.how === "hack" && outcome.success && enterPanel) {
      enterPanel(asked.place, asked.door, outcome.hack);
    }
    if (seen) lines.push(...caught(game, asked.place, asked.from ?? asked.door));
  } else {
    const part = model.parts[asked.part];
    if (!part) return null;
    const spec = kindSpec(part.kind);
    const action = asked.how === "break" ? { id: "break", tampering: true, unseen: Boolean(spec.break?.unseen) } : { id: asked.how };
    lines = doWork(game, asked.place, part, action, outcome.success);
  }
  if (lines.length) game.transcript?.push({ role: "notice", text: lines.join("\n") });
  game.pendingEvents?.push(`The player worked on the systems at ${model.name} by hand: ${outcome.reason ?? "something"}, ${outcome.success ? "and managed it" : "and failed"}. ${lines.filter((line) => /^\[(ALARM|FACTION)\]/.test(line)).join(" ")} Bring it into the story only if it matters.`.trim());
  return lines;
}

// ---- What the page gets to see --------------------------------------------------------------------------

// The parts in the room the player's in, as things they can walk up to and work.
export function partThings(game, place, room) {
  const model = systemsOf(place);
  if (!model) return [];
  return (model.partsIn[room] ?? []).map((id) => model.parts[id]).filter((part) => part && !part.unplaced).map((part) => {
    const works = partWorks(game, place, part);
    return {
      id: `part:${part.id}`,
      name: upperFirst(part.kind === "console" ? part.name : `the ${part.name}`),
      look: lookAt(game, place, part),
      x: part.x,
      y: part.y,
      have: false,
      written: true,
      part: {
        kind: part.kind,
        system: part.system,
        mount: part.mount,
        face: part.face,
        works,
        word: stateWord(game, place, part),
        ...(part.system === "alarm" && alarmRinging(game, place) && works ? { ringing: true } : {}),
      },
      actions: partActions(game, place, part).map((action) => ({ id: action.id, label: action.label, detail: detailOf(action) })),
    };
  });
}

// How the room the player's in is: dark, its air, a camera on them, the alarm.
export function roomView(game, place, room) {
  const model = systemsOf(place);
  if (!model) return null;
  const ringing = alarmRinging(game, place);
  const air = airIn(game, place, room);
  return {
    dark: roomDark(game, place, room),
    air: Math.round(air),
    thin: air < airLimits().thin,
    watched: watched(game, place, room),
    ...(ringing ? { alarm: { room: ringing.room ? roomNameOf(place, ringing.room) : null, here: ringing.room === room } } : {}),
  };
}

// ---- Computers that run systems ---------------------------------------------------------------------------

// What a computer runs, from the place's Computers lines: by its file's id, the thing it's on, the console the file
// put there, or a door's panel, which runs that door.
export function controlsFor(place, ref) {
  const model = systemsOf(place);
  if (!model) return [];
  if (ref.door) return model.doors[ref.door] ? [{ systems: ["doors"], rooms: [ref.door] }] : [];
  return model.computers.filter((c) => {
    const r = c.ref;
    if (ref.written && r.kind === "written" && r.id === ref.written) return true;
    if (ref.thing && r.kind === "thing" && r.thing === ref.thing) return true;
    if (ref.console && r.kind === "console" && r.part === ref.console) return true;
    return Boolean(ref.written && r.kind === "thing" && writtenAtThing(place, r.room, { name: r.name }) === ref.written);
  }).map((c) => ({ systems: c.systems, rooms: c.rooms }));
}

// Whether a thing in a room has been made a computer by the place's file, even if its map line says otherwise.
export const runsSystems = (place, thingId) => Boolean(systemsOf(place)?.computers.some((c) => c.ref.kind === "thing" && c.ref.thing === thingId));

const CONTROL_WORDS = {
  "junction box": ["Cut the power", "Restore the power"],
  "air plant": ["Shut it down", "Start it up"],
  vent: ["Close the vent", "Open the vent"],
  "light switch": ["Lights out", "Lights on"],
  camera: ["Switch it off", "Switch it on"],
  speaker: ["Switch it off", "Switch it on"],
  relay: ["Jam the comms", "Restore the comms"],
  engines: ["Shut down the engines", "Start the engines"],
  "nav core": ["Lock the navigation", "Unlock the navigation"],
  "docking clamps": ["Lock the clamps", "Release the clamps"],
  machine: ["Switch it off", "Switch it on"],
};

function peopleSeenIn(game, place, room) {
  const level = mapFor(place)?.levels[room];
  if (!level) return [];
  const here = livesHere(place) ? peopleAboard(game, place, room) : level.homes.filter((home) => atPost(game, home.id));
  return here.map((one) => one.label ?? WORLD_CHARACTERS[one.id]?.name ?? one.name).filter(Boolean);
}

function partRow(game, place, part) {
  const s = partState(game, place, part.id);
  const where = roomNameOf(place, part.room);
  const name = part.kind === "junction box" ? `Power to ${(part.feeds ?? [part.room]).map((room) => roomNameOf(place, room)).join(", ")}`
    : part.kind === "light switch" ? `Lights in ${where}`
      : part.kind === "vent" ? `Air in ${where}`
        : part.kind === "camera" ? `Camera in ${where}`
          : `${upperFirst(`the ${part.name}`)} in ${where}`;
  const words = CONTROL_WORDS[part.kind] ?? CONTROL_WORDS.machine;
  const reachable = NEEDS_NO_POWER.has(part.kind) || roomPowered(game, place, part.room);
  const actions = s.damage || !reachable ? [] : s.on === false ? [{ to: "on", label: words[1] }] : [{ to: "off", label: words[0] }];
  const row = { id: part.id, name, detail: part.kind === "junction box" ? `junction box in ${where}` : null, word: stateWord(game, place, part), works: partWorks(game, place, part), actions };
  if (part.kind === "vent") row.detail = `air ${Math.round(airIn(game, place, part.room))}%`;
  if (part.kind === "camera" && row.works) row.feed = peopleSeenIn(game, place, part.room);
  return row;
}

function doorRow(game, place, door) {
  const s = doorState(game, place, door.to);
  const name = `The door to ${roomNameOf(place, door.to)}`;
  const opened = game.opened?.[place]?.includes(door.to);
  const panel = roomPowered(game, place, door.to);
  const actions = [];
  if (!s.forced && panel) actions.push(s.locked ? { to: "unlocked", label: "Unlock it" } : { to: "locked", label: "Lock it" });
  if (door.story && !opened && panel) actions.push({ to: "opened", label: "Open it" });
  return { id: door.id, name, word: s.forced ? "forced" : s.locked ? "locked" : door.story && !opened ? "shut" : "open", works: !s.locked, actions };
}

function alarmRow(game, place, model, room) {
  const s = alarmState(game, place);
  const ringing = s.ringing;
  const can = alarmCanRing(game, place);
  const actions = [];
  if (ringing) actions.push({ to: "quiet", label: "Silence it" });
  else if (!s.disarmed && can) actions.push({ to: "ringing", label: "Sound it" });
  actions.push(s.disarmed ? { to: "armed", label: "Arm it" } : { to: "disarmed", label: "Disarm it" });
  const word = ringing ? "ringing" : s.disarmed ? "disarmed" : can ? "armed" : "dead";
  return { id: "alarm", name: `The alarm${ringing?.room ? `, ringing in ${roomNameOf(place, ringing.room)}` : ""}`, word, works: !s.disarmed && can, actions, room };
}

// The systems a computer runs, each a list of rows with the state and what can be done about it from here.
export function controlsView(game, place, controls, { room = null } = {}) {
  const model = systemsOf(place);
  if (!model || !controls?.length) return [];
  const out = [];
  for (const system of model.systems) {
    const scopes = controls.filter((c) => c.systems.includes(system.id));
    if (!scopes.length) continue;
    const inScope = (one) => scopes.some((c) => !c.rooms || c.rooms.includes(one));
    const rows = [];
    if (system.id === "doors") {
      for (const door of Object.values(model.doors)) if (inScope(door.to)) rows.push(doorRow(game, place, door));
    } else if (system.id === "alarm") {
      const rooms = scopes.some((c) => !c.rooms) ? null : scopes.flatMap((c) => c.rooms);
      rows.push(alarmRow(game, place, model, room && (!rooms || rooms.includes(room)) ? room : rooms?.[0] ?? room ?? partsOf(model, "alarm")[0]?.room ?? null));
    } else {
      for (const id of system.parts) {
        const part = model.parts[id];
        if (part && !part.unplaced && inScope(part.room)) rows.push(partRow(game, place, part));
      }
    }
    if (rows.length) out.push({ id: system.id, title: system.title, rows });
  }
  return out;
}

// Something done to a system from a computer, or from the Ship menu. It has to be one of the things the computer's
// screen offers right now.
export function controlSystem(game, place, controls, rowId, to, { by = "player", room = null } = {}) {
  const offered = controlsView(game, place, controls, { room }).flatMap((system) => system.rows).find((row) => row.id === rowId);
  const action = offered?.actions.find((one) => one.to === to);
  if (!action) throw new Error("That can't be done from here, not as things stand.");
  if (rowId === "alarm") {
    if (to === "quiet") return silenceAlarm(game, place);
    if (to === "ringing") return soundAlarm(game, place, offered.room, { by });
    return armAlarm(game, place, to === "armed", { by });
  }
  const model = systemsOf(place);
  const door = Object.values(model.doors).find((one) => one.id === rowId);
  if (door) return setDoor(game, place, door.to, to, { by });
  const part = model.parts[rowId];
  const lines = switchPart(game, place, part.id, to === "on", { by });
  return [`[SYSTEMS] ${action.label}: ${offered.name}.`, ...lines];
}

// Everything at a place, for the Ship menu: the captain runs the Meridian's systems from there.
export function shipSystemsView(game) {
  if (!isCaptain(game) || !systemsOf("meridian")) return null;
  return controlsView(game, "meridian", [{ systems: systemsOf("meridian").systems.map((one) => one.id), rooms: null }]);
}

// ---- The written story's words for it ---------------------------------------------------------------------

function roomIn(game, place, room) {
  if (!room) return null;
  if (room === "here") return playerSpot(game)?.place === place ? playerSpot(game).room : undefined;
  const map = mapFor(place);
  return map ? roomFinder(map)(room)?.id : undefined;
}

// Whether "power off in The Docks", "alarm ringing at haven" and the rest hold now.
export function systemHolds(game, term) {
  const place = term.place ?? game.location;
  const model = systemsOf(place);
  const room = roomIn(game, place, term.room);
  if (term.room && !room) return false;
  const rooms = room ? [room] : Object.keys(mapFor(place)?.levels ?? {});
  const limits = airLimits();
  const off = ["off", "jammed", "locked", "broken", "bad", "thin", "ringing", "dark"].includes(term.state);
  if (!model) return !off;
  switch (term.system) {
    case "power": return term.state === "off" ? rooms.some((one) => !roomPowered(game, place, one)) : rooms.every((one) => roomPowered(game, place, one));
    case "lights": return term.state === "off" || term.state === "dark" ? rooms.some((one) => roomDark(game, place, one)) : rooms.every((one) => !roomDark(game, place, one));
    case "air":
      if (term.state === "bad") return rooms.some((one) => airIn(game, place, one) < limits.bad);
      if (term.state === "thin") return rooms.some((one) => airIn(game, place, one) < limits.thin);
      if (term.state === "good") return rooms.every((one) => airIn(game, place, one) >= limits.thin);
      if (term.state === "off") return rooms.some((one) => !airFlows(game, place, one));
      return rooms.every((one) => airFlows(game, place, one));
    case "cameras": return term.state === "on" ? rooms.some((one) => watched(game, place, one)) : !rooms.some((one) => watched(game, place, one));
    case "alarm":
      if (term.state === "ringing") return Boolean(alarmRinging(game, place));
      if (term.state === "quiet") return !alarmRinging(game, place);
      if (term.state === "off") return hasSystem(model, "alarm") && Boolean(alarmState(game, place).disarmed);
      return hasSystem(model, "alarm") && !alarmState(game, place).disarmed;
    case "door": return term.state === "locked" ? Boolean(room) && doorLocked(game, place, room) : Boolean(room) && !doorLocked(game, place, room);
    case "comms": return term.state === "on" ? commsUp(game, place) : !commsUp(game, place);
    default: {
      const parts = partsOf(model, term.system, room);
      return off ? parts.some((part) => !partWorks(game, place, part)) : parts.length > 0 && parts.every((part) => partWorks(game, place, part));
    }
  }
}

// "* power off in The Docks", "* alarm ringing", "* door locked The Hook", "* fix everything" and the rest.
export function applySystemsEffect(game, effect, { by = "story" } = {}) {
  const place = effect.place ?? game.location;
  const model = systemsOf(place);
  if (!model) return [`[SYSTEMS] ${LOCATIONS[place]?.name ?? place} has no systems for that.`];
  const room = roomIn(game, place, effect.room);
  if (effect.room && !room) return [`[SYSTEMS] ${model.name} has no room called ${effect.room}.`];
  const lines = [];
  const on = ["on", "released", "open", "unlocked", "good"].includes(effect.state);
  const switchAll = (parts) => {
    for (const part of parts) lines.push(...switchPart(game, place, part.id, on, { by }));
  };
  switch (effect.system) {
    case "power": switchAll(room ? [model.parts[model.circuits[room]]].filter(Boolean) : partsOf(model, "power")); break;
    case "lights": switchAll(partsOf(model, "lights", room)); break;
    case "air": switchAll(room ? partsOf(model, "air", room).filter((part) => part.kind !== "air plant") : partsOf(model, "air").filter((part) => part.kind === "air plant")); break;
    case "cameras": switchAll(partsOf(model, "cameras", room)); break;
    case "comms": switchAll(partsOf(model, "comms", room)); break;
    case "alarm":
      if (effect.state === "ringing") lines.push(...soundAlarm(game, place, room ?? null, { by }));
      else if (effect.state === "quiet") lines.push(...silenceAlarm(game, place));
      else lines.push(...armAlarm(game, place, effect.state === "on", { by }));
      break;
    case "door":
      if (!room) return [`[SYSTEMS] Which door? Write the room it leads into.`];
      if (!model.doors[room]) return [`[SYSTEMS] The door to ${roomNameOf(place, room)} isn't one ${model.name}'s systems run.`];
      lines.push(...setDoor(game, place, room, effect.state === "locked" ? "locked" : "unlocked", { by }));
      break;
    case "fix": {
      const parts = Object.values(model.parts).filter((part) => (!effect.what || effect.what === "everything" || part.system === effect.what) && (!room || part.room === room));
      for (const part of parts) {
        repairPart(game, place, part.id);
        switchPart(game, place, part.id, true, { by });
      }
      if (!effect.what || effect.what === "everything" || effect.what === "doors") for (const door of Object.keys(model.doors)) if (!room || door === room) setDoor(game, place, door, "fixed", { by });
      if (!effect.what || effect.what === "everything" || effect.what === "alarm") {
        lines.push(...silenceAlarm(game, place, { quiet: true }));
        if (alarmState(game, place).disarmed) armAlarm(game, place, true, { by });
      }
      lines.push(`[SYSTEMS] ${effect.what && effect.what !== "everything" ? upperFirst(effect.what) : "Everything"} at ${model.name}${room ? ` in ${roomNameOf(place, room)}` : ""} is working again.`);
      break;
    }
    case "break": {
      const parts = Object.values(model.parts).filter((part) => part.system === effect.what && (!room || part.room === room));
      for (const part of parts) lines.push(...damagePart(game, place, part.id, "broken", { by }));
      lines.push(`[SYSTEMS] ${upperFirst(effect.what)} at ${model.name}${room ? ` in ${roomNameOf(place, room)}` : ""} is broken.`);
      break;
    }
    default: switchAll(partsOf(model, effect.system, room));
  }
  return lines;
}

// ---- The checker -------------------------------------------------------------------------------------------

// How many places have systems, for check-story to say.
export const placesWithSystems = () => Object.keys(LOCATIONS).filter((id) => systemsOf(id)?.systems.length).length;

export function systemsProblems() {
  const problems = [...SYSTEMS_FILE_PROBLEMS];
  for (const place of Object.keys(WORLD_SYSTEMS)) if (!mapFor(place)) problems.push(`systems/${place}.txt: there's no map of a place called ${place} in world/maps`);
  for (const place of Object.keys(LOCATIONS)) {
    const model = systemsOf(place);
    if (!model) continue;
    const file = model.written ? `systems/${place}.txt` : `the systems ${place} gets by default`;
    for (const one of model.problems) problems.push(`${file}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
  }
  return problems;
}
