// Computers: what they are and how the player gets in. A computer is a plain-text file in
// world/computers, read by public/world-text.js, or a generic one the game makes for a console,
// server, panel or power board in a room, or a door with a hack on it, that nobody has written.
// The player gets in by right (the Meridian's own), with a password they've learned, or by a hack
// of the computer's class, and what they can do once in is src/computer-use.js. Nothing here uses
// the AI. This file is read by the rules and the walk, so it reads nothing that reads the tools.

import { LOCATIONS } from "./data.js";
import { placeNow, worldOf } from "./daily.js";
import { DIFFICULTY } from "./rules.js";
import { conditionHolds, parseCondition, parseEffect } from "./scene-text.js";
import { startCheck, tierFor } from "./checks.js";
import { classOf } from "./check-games/crack.js";
import { fill } from "./check-games/kit.js";
import { CHECK_TEXT, COMPUTER_FLAVOR, WORLD_COMPUTERS, WORLD_MAPS, WORLD_PLACES } from "./world.js";
import { controlsFor, controlsView, partWorks, roomPowered, runsSystems, systemsOf } from "./systems.js";


export const slug = (words) => String(words).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
export const line = (text, tone = "info") => ({ text: String(text), tone });
export const MINUTES_PER_ACTION = 2;
export const MAX_LOG = 120;

// ---- The classes of computer, shared with the hacking game ----------------------------------

export const classKeys = () => Object.keys(DIFFICULTY);
export const classKeyOf = (text) => {
  const key = String(text ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return classKeys().includes(key) ? key : "moderate";
};
export const classNameOf = (classKey) => classOf(CHECK_TEXT.skills?.hacking, classKey).name;

// ---- Reading a computer's file --------------------------------------------------------------

// A program's text is what it says when it runs, then -> and the effects separated by ;, then ? and a condition.
export function programOf(entry) {
  const problems = [];
  let text = String(entry.desc ?? "").trim();
  let condition = null;
  const ask = text.lastIndexOf(" ? ");
  if (ask >= 0) {
    condition = text.slice(ask + 3).trim();
    text = text.slice(0, ask).trim();
  }
  const effects = [];
  const arrow = text.indexOf("->");
  if (arrow >= 0) {
    const tail = text.slice(arrow + 2);
    text = text.slice(0, arrow).trim();
    for (const piece of tail.split(";").map((one) => one.trim().replace(/^\*\s*/, "")).filter(Boolean)) {
      const parsed = parseEffect(piece);
      if (parsed.problem) problems.push(`in the program "${entry.name}", ${parsed.problem}`);
      else effects.push(parsed.do);
    }
  }
  if (condition) {
    const parsed = parseCondition(condition);
    if (parsed?.problem) problems.push(`in the program "${entry.name}", the condition ${parsed.problem}`);
  }
  return { id: slug(entry.name), name: String(entry.name).trim(), text, effects, condition, problems };
}

// "From someone to someone: the letter" or just a subject and the letter.
export function mailOf(entry) {
  const found = String(entry.name).match(/^from\s+(.+?)\s+to\s+(.+)$/i);
  return { from: found ? found[1].trim() : String(entry.name).trim(), to: found ? found[2].trim() : null, subject: found ? null : String(entry.name).trim(), text: String(entry.desc ?? "").trim() };
}

const LOG_KINDS = { berths: "The berth log", prices: "Today's prices", people: "Who's here", news: "What's been heard", readouts: "The ship's readouts" };
const logOf = (text, i) => {
  const key = String(text).trim().toLowerCase();
  return LOG_KINDS[key] ? { id: key, name: LOG_KINDS[key], kind: key } : { id: `log_${i + 1}`, name: String(text).trim().slice(0, 48), kind: "text", text: String(text).trim() };
};

export function writtenContent(id) {
  const c = WORLD_COMPUTERS[id];
  if (!c) return null;
  const yours = Boolean(c.yours);
  return {
    id,
    name: c.name,
    classKey: classKeyOf(c.class),
    yours,
    owner: c.owner ?? null,
    place: c.place ?? null,
    room: c.room ?? null,
    thing: c.thing ?? null,
    door: c.door ?? null,
    user: c.user || (yours ? "captain" : "admin"),
    password: c.password || null,
    flavor: c.flavor || (yours ? "yours" : "default"),
    desc: c.desc ?? "",
    files: (c.files ?? []).map((file) => ({ id: slug(file.name), name: String(file.name).trim(), text: String(file.desc ?? "").trim() })),
    mail: (c.mail ?? []).map((entry, i) => ({ id: `mail_${i + 1}`, ...mailOf(entry) })),
    logs: (c.logs ?? []).map(logOf),
    programs: (c.programs ?? []).map(programOf),
    network: (c.network ?? []).map((entry) => ({ id: String(entry.name).trim(), desc: String(entry.desc ?? "").trim() })),
    roomId: c.place && c.room ? roomIdNamed(c.place, c.room) : null,
    controls: c.place ? controlsFor(c.place, { written: id }) : [],
  };
}

// A room's id from its name, at a place.
function roomIdNamed(place, name) {
  const found = Object.entries(WORLD_MAPS[place]?.levels ?? {}).find(([, level]) => String(level.name).toLowerCase() === String(name).toLowerCase());
  return found?.[0] ?? null;
}

// ---- Computers nobody has written -----------------------------------------------------------

const GENERIC_KINDS = [
  [/\b(server|mainframe|archive)\b/i, "server"],
  [/\b(console|terminal|repeater|readout|relay|transmitter)\b/i, "console"],
  [/\b(keypad|panel)\b/i, "panel"],
  [/\b(power board|restart board|breakers?|power meter)\b/i, "power"],
];
// What a thing in a room is, as a computer, if it's one at all. Things that are items to pick up aren't.
export function genericKindOf(thing) {
  if (!thing || thing.item || /\bdead\b/i.test(thing.name ?? "")) return null;
  for (const [pattern, kind] of GENERIC_KINDS) if (pattern.test(thing.name ?? "")) return kind;
  return null;
}

// The same generic computer comes out the same way every time, from its key.
function seeded(key) {
  let n = 7;
  for (const ch of String(key)) n = (Math.imul(n, 31) + ch.codePointAt(0)) >>> 0;
  return () => {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0;
    return n / 4294967296;
  };
}

const levelsOf = (place) => Object.entries(WORLD_MAPS[place]?.levels ?? {}).map(([id, level]) => ({ id, ...level }));
export const peopleAt = (place) => [...new Set(levelsOf(place).flatMap((level) => Object.values(level.people ?? {}).map((home) => home.label).filter(Boolean)))];

function genericContent(game, { key, name, kind, place, room = null, roomId = null, door = null, classKey = null, ref = null }) {
  const flavor = COMPUTER_FLAVOR ?? {};
  const spec = flavor.kinds?.[kind] ?? flavor.kinds?.console ?? {};
  const roll = seeded(key);
  const pick = (list) => (list?.length ? list[Math.floor(roll() * list.length)] : "");
  const yours = place === "meridian";
  const placeName = LOCATIONS[place]?.name ?? place ?? "here";
  const people = peopleAt(place);
  const person = people.length ? people[Math.floor(roll() * people.length)] : "the night shift";
  const other = people.filter((one) => one !== person)[0] ?? "the day shift";
  worldOf(game);
  const now = placeNow(game, place);
  const goods = now?.goods?.length ? now.goods.map((good) => `${good.name} ${good.level}`).join(", ") : "nothing counted";
  const holder = now?.holder ?? "the management";
  const user = yours ? "captain" : pick(flavor.users ?? ["admin"]) || "admin";
  const values = { place: place ?? "here", placeName, room: room ?? "", holder, person, other, user, goods, people: people.length ? people.join(", ") : "nobody by name", note: fill(pick(flavor.notes ?? ["Nothing of note."]), { person, other }) };
  const files = (spec.files ?? []).map((id) => flavor.files?.[id]).filter(Boolean).map((file) => ({ id: slug(file.name), name: file.name, text: fill(file.text, values) }));
  const mail = (flavor.mail ?? []).slice(0, spec.mail ?? 0).map((entry, i) => ({ id: `mail_${i + 1}`, from: fill(entry.from, values), to: fill(entry.to, values), subject: entry.subject ?? null, text: fill(entry.text, values) }));
  const fleetHere = Boolean(WORLD_PLACES[place]?.fleet) || yours;
  const logs = (spec.logs ?? []).filter((id) => id !== "berths" || fleetHere).map(logOf);
  const programs = (spec.programs ?? []).map((program) => programOf({ name: program.name, desc: fill(program.text, values) }));
  return {
    id: key, name, classKey: classKey ?? classKeyOf(spec.class), yours, owner: null, place, room, thing: null, door, user, password: null, flavor: yours ? "yours" : "default",
    desc: spec.desc ?? "A terminal.", files, mail, logs, programs, network: [],
    roomId, controls: ref ? controlsFor(place, ref) : [],
  };
}

// ---- Where computers are: things, doors and places -------------------------------------------

export const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
export const levelNamed = (place, id) => WORLD_MAPS[place]?.levels?.[id] ?? null;
const roomOf = (place, levelId) => levelNamed(place, levelId)?.name ?? null;

// A written computer attached to a thing in a room, by the names in its file.
export function writtenAtThing(place, levelId, thing) {
  const room = roomOf(place, levelId);
  return Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && sameName(c.room, room) && sameName(c.thing, thing?.name))?.[0] ?? null;
}
export function writtenAtDoor(place, to) {
  return Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && c.door === to)?.[0] ?? null;
}

// What a thing in a room is, as a computer: a written one, a generic one, or nothing. A thing whose map file
// already says what using it does keeps that, so generic is false for those.
export function computerAtThing(game, place, levelId, thing, { generic = true } = {}) {
  if (!thing) return null;
  const written = thing.computer ?? writtenAtThing(place, levelId, thing);
  if (written && WORLD_COMPUTERS[written]) return { id: written };
  // The walk names a thing level:id and the map file just id; the same thing gets the same computer either way.
  const shortId = String(thing.id ?? "").split(":").pop();
  const runs = runsSystems(place, `${levelId}:${shortId}`);
  const kind = genericKindOf(thing) ?? (runs ? "console" : null);
  if (!kind || (!generic && !runs)) return null;
  const hack = typeof thing.check === "string" ? thing.check.split(":") : null;
  const classKey = hack?.[0] === "hacking" && hack[1] ? classKeyOf(hack[1]) : null;
  return { generic: genericContent(game, { key: `${place}:${levelId}:${shortId}`, name: thing.name, kind, place, room: roomOf(place, levelId), roomId: levelId, classKey, ref: { thing: `${levelId}:${shortId}` } }) };
}

// The computer a door answers to: a written one, or a generic panel for that door.
export function computerAtDoor(game, place, to, classKey = "easy") {
  const written = writtenAtDoor(place, to);
  if (written) return { id: written };
  const room = levelNamed(place, to)?.name ?? to;
  return { generic: genericContent(game, { key: `${place}:door:${to}`, name: `${room} door panel`, kind: "panel", place, room: roomOf(place, game.walk?.level), roomId: to, door: to, classKey, ref: { door: to } }) };
}

// A console the place's systems file puts in a room: it runs what the file says, at the class it gives.
export function consoleContent(game, place, part) {
  const name = part.name.charAt(0).toUpperCase() + part.name.slice(1);
  return genericContent(game, { key: `${place}:part:${part.id}`, name, kind: "console", place, room: roomOf(place, part.room), roomId: part.room, classKey: classKeyOf(part.classKey ?? "moderate"), ref: { console: part.id } });
}

// Using one of those consoles: straight in when it's the player's own, else a hack of its class. No power, no screen.
export function useConsolePart(game, place, part) {
  if (!partWorks(game, place, part)) return { said: "Its screen is dark. There's no power to it." };
  const content = consoleContent(game, place, part);
  if (content.yours) {
    openSession(game, content, { how: "sat down" });
    return { said: `You sit down at ${content.name}.`, computer: true };
  }
  startCheck(game, { skill: "hacking", difficulty: content.classKey, reason: `Get into ${content.name}`, scene: null, source: "thing" });
  game.computerAsked = { place, console: part.id };
  return { check: true };
}

// A door's panel that was hacked from the door itself: it opens as a computer that runs that door.
export function enterDoorPanel(game, place, to, hack) {
  const target = computerAtDoor(game, place, to, hack?.classKey ?? "easy");
  const content = target.id ? writtenContent(target.id) : target.generic;
  return openSession(game, content, { hacked: true, trace: hack?.trace ?? 0, maxTrace: hack?.maxTrace ?? 0, how: "hacked" });
}

// The computer a hack at this place lands on when nothing says which: a written one of that class here,
// or a generic one of the class.
export function computerForPlace(game, classKey) {
  const place = game.location;
  const written = Object.entries(WORLD_COMPUTERS).find(([, c]) => c.place === place && classKeyOf(c.class) === classKey && !c.yours)?.[0];
  if (written) return { id: written };
  const kind = classKey === "easy" ? "panel" : classKey === "moderate" ? "console" : "server";
  return { generic: genericContent(game, { key: `${place}:${classKey}`, name: classNameOf(classKey), kind, place, room: roomOf(place, game.walk?.level), classKey }) };
}

// ---- Getting in -------------------------------------------------------------------------------

export const knowsPassword = (game, id) => Boolean(id && game.passwords?.[id]);

export function openSession(game, content, { hacked = false, trace = 0, maxTrace = 0, how = "sat down" }) {
  if (game.combat) throw new Error("Finish the fight first.");
  if (game.computer) throw new Error("Log off the computer you're on first.");
  game.computers ??= {};
  game.computers[content.id] ??= { read: [], ran: [], visits: 0 };
  game.computers[content.id].visits += 1;
  const yours = Boolean(content.yours);
  game.computer = {
    id: content.id,
    name: content.name,
    classKey: content.classKey,
    className: classNameOf(content.classKey),
    user: content.user,
    place: content.place,
    yours,
    hacked: Boolean(hacked) && !yours,
    trace: yours ? 0 : trace,
    maxTrace: yours ? 0 : maxTrace,
    how,
    generic: WORLD_COMPUTERS[content.id] ? null : content,
    screen: { kind: "home" },
    log: [],
    actions: 0,
    read: [],
    ran: [],
    startedAt: game.clock?.hours ?? 0,
    roomId: content.roomId ?? null,
  };
  const session = game.computer;
  const flavor = COMPUTER_FLAVOR?.motd?.[content.flavor] ?? COMPUTER_FLAVOR?.motd?.default ?? [];
  const greeting = hacked && !yours ? "ACCESS GRANTED." : yours ? "Logged in." : "Logged in with the password.";
  session.log.push(line(`${content.name}: ${greeting} Welcome, ${content.user}.`, "good"));
  if (flavor.length) session.log.push(line(flavor[Math.floor(seeded(content.id)() * flavor.length)], "dim"));
  session.log.push(line("Click what's on the left to read it or run it, or type: ls, cat <file>, mail, log <name>, run <program>, net, logoff.", "dim"));
  return session;
}

// The player sits down at a computer by its id: theirs, or one they know the password to, or any, when a scene says so.
export function enterComputer(game, { id = null, generic = null, hacked = false, trace = 0, maxTrace = 0, how = "sat down" } = {}) {
  const content = id ? writtenContent(id) : generic;
  if (!content) throw new Error(`There's no computer called ${id}.`);
  return openSession(game, content, { hacked, trace, maxTrace, how });
}

// Using a thing that's a computer: straight in when it's theirs or the password's known, else a hack of its class.
export function useComputer(game, { place, levelId, thing, look = null, generic = true }) {
  const target = computerAtThing(game, place, levelId, thing, { generic });
  if (!target) return null;
  const content = target.id ? writtenContent(target.id) : target.generic;
  if (!roomPowered(game, place, levelId)) return { said: "The screen's dead. There's no power in here." };
  if (content.yours || knowsPassword(game, target.id)) {
    openSession(game, content, { how: content.yours ? "sat down" : "the password" });
    return { said: `You sit down at ${content.name}.`, computer: true };
  }
  startCheck(game, { skill: "hacking", difficulty: content.classKey, reason: `Get into ${content.name}`, scene: look, source: "thing", computer: target.id ?? null });
  game.computerAsked = { place, levelId, thing: thing.id, name: thing.name };
  return { check: true };
}

// After a hack that got in: the computer the check was for, the door's, the thing's, or this place's.
export function enterAfterHack(game, hack) {
  const asked = game.computerAsked ?? null;
  game.computerAsked = null;
  let target = null;
  if (hack.computer && WORLD_COMPUTERS[hack.computer]) target = { id: hack.computer };
  else if (hack.source === "door" && game.doorAsked) target = computerAtDoor(game, game.doorAsked.place, game.doorAsked.to, hack.classKey);
  else if (asked?.console && systemsOf(asked.place)?.parts[asked.console]) target = { generic: consoleContent(game, asked.place, systemsOf(asked.place).parts[asked.console]) };
  else if (asked) {
    const level = levelNamed(asked.place, asked.levelId);
    const thing = level ? Object.entries(level.things ?? {}).map(([id, one]) => ({ id, ...one })).find((one) => one.id === asked.thing || `${asked.levelId}:${one.id}` === asked.thing || sameName(one.name, asked.name)) : null;
    target = computerAtThing(game, asked.place, asked.levelId, thing) ?? computerForPlace(game, hack.classKey);
  } else target = computerForPlace(game, hack.classKey);
  if (!target) return null;
  const content = target.id ? writtenContent(target.id) : target.generic;
  return openSession(game, content, { hacked: true, trace: hack.trace ?? 0, maxTrace: hack.maxTrace ?? 0, how: "hacked" });
}

// ---- What a session is looking at --------------------------------------------------------------

export const contentOf = (game, session) => (session.generic ? session.generic : writtenContent(session.id));
export const memoryOf = (game, session) => {
  game.computers ??= {};
  game.computers[session.id] ??= { read: [], ran: [], visits: 1 };
  return game.computers[session.id];
};

export const programOffered = (game, program) => !program.condition || conditionHolds(game, program.condition);


// ---- What the browser sees ---------------------------------------------------------------------

function hintsFor(game, session, content, view) {
  const texts = COMPUTER_FLAVOR?.hints ?? {};
  const tier = tierFor(game, "hacking");
  const unread = view.files.filter((one) => !one.read).length;
  const unreadMail = view.mail.filter((one) => !one.read).length;
  const values = {
    unread,
    unreadMail,
    programs: view.programs.length ? view.programs.map((one) => `${one.name}${one.ran ? " (done)" : ""}`).join(", ") : "none",
    trace: session.maxTrace ? Math.round((session.trace / session.maxTrace) * 100) : 0,
    left: session.maxTrace ? Math.max(0, session.maxTrace - session.trace) : "any number of",
    network: view.network.length ? view.network.map((one) => `${one.name} (${one.className.toLowerCase()})`).join(", ") : "nothing reachable from here",
  };
  const lines = [];
  for (let level = 0; level <= tier; level += 1) {
    for (const text of texts[level] ?? texts[String(level)] ?? []) {
      if (!session.hacked && /trace/i.test(text)) continue;
      lines.push(fill(text, values));
    }
  }
  return lines;
}

export function computerView(game) {
  const session = game.computer;
  if (!session) return null;
  const content = contentOf(game, session);
  if (!content) return null;
  const memory = memoryOf(game, session);
  const view = {
    id: session.id,
    name: session.name,
    className: session.className,
    classKey: session.classKey,
    user: session.user,
    prompt: `${session.user}@${slug(session.name) || "node"}:~$`,
    yours: session.yours,
    hacked: session.hacked,
    trace: session.trace,
    maxTrace: session.maxTrace,
    theme: session.yours ? "green" : session.hacked ? "cyan" : "teal",
    desc: content.desc,
    files: content.files.map((one) => ({ id: one.id, name: one.name, read: memory.read.includes(`file:${one.id}`) })),
    mail: content.mail.map((one) => ({ id: one.id, name: one.to ? `From ${one.from} to ${one.to}` : one.subject ?? one.from, read: memory.read.includes(`mail:${one.id}`) })),
    logs: content.logs.map((one) => ({ id: one.id, name: one.name })),
    programs: content.programs.filter((one) => programOffered(game, one)).map((one) => ({ id: one.id, name: one.name, about: one.text, ran: memory.ran.includes(one.id) })),
    network: content.network.filter((one) => WORLD_COMPUTERS[one.id]).map((one) => ({ id: one.id, name: WORLD_COMPUTERS[one.id].name, about: one.desc, className: classNameOf(classKeyOf(WORLD_COMPUTERS[one.id].class)), known: Boolean(WORLD_COMPUTERS[one.id].yours) || knowsPassword(game, one.id) })),
    screen: session.screen,
    log: session.log,
    actions: session.actions,
    tier: tierFor(game, "hacking"),
    tierName: (CHECK_TEXT.tierNames ?? ["untrained", "novice", "trained", "expert", "master"])[tierFor(game, "hacking")],
    // The place's systems this computer runs, each with what can be done about it from here.
    systems: controlsView(game, session.place, content.controls ?? [], { room: session.roomId }),
  };
  view.hints = hintsFor(game, session, content, view);
  return view;
}

// ---- Checking the files -----------------------------------------------------------------------

export function computerProblems() {
  const problems = [];
  for (const [id, c] of Object.entries(WORLD_COMPUTERS)) {
    const at = (message) => problems.push(`computers/${id}.txt: ${message}`);
    if (c.class && !classKeys().includes(String(c.class).trim().toLowerCase().replace(/s+/g, "_"))) at(`the class "${c.class}" isn't one of ${classKeys().join(", ")}`);
    if (c.place && !LOCATIONS[c.place] && !WORLD_MAPS[c.place]) at(`there's no place with the id ${c.place}`);
    const levels = c.place ? levelsOf(c.place) : [];
    const level = c.room ? levels.find((one) => sameName(one.name, c.room)) : null;
    if (c.room && c.place && WORLD_MAPS[c.place] && !level) at(`${LOCATIONS[c.place]?.name ?? c.place} has no room called ${c.room}`);
    if (c.thing && !c.room) at("a thing needs its room: add a room line");
    if (c.thing && level && !Object.values(level.things ?? {}).some((one) => sameName(one.name, c.thing))) at(`${c.room} has nothing called ${c.thing}`);
    if (c.door && c.place && WORLD_MAPS[c.place] && !WORLD_MAPS[c.place].levels?.[c.door]) at(`${c.place} has no room with the id ${c.door} for the door to lead to`);
    for (const program of (c.programs ?? []).map(programOf)) for (const message of program.problems) at(message);
    for (const entry of c.network ?? []) if (!WORLD_COMPUTERS[String(entry.name).trim()]) at(`the network names ${String(entry.name).trim()}, and there's no computer with that id`);
  }
  return problems;
}
