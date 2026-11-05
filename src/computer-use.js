// Using a computer the player is on: reading its files, mail and logs, running its programs with the
// effects a scene could cause, reaching another computer over its network, and logging off, or being
// thrown out when the trace completes. Programs run through the same tool code the AI's orders do,
// which is why this sits apart from src/computers.js: that file is read by the rules and the walk,
// and the tools read those.

import { LOCATIONS } from "./data.js";
import { placeNow, worldOf } from "./daily.js";
import { clearFact, recordFact } from "./record.js";
import { passTime } from "./rules.js";
import { newTurnLimits, runTool } from "./tools.js";
import { startCheck } from "./checks.js";
import { closest } from "./check-games/kit.js";
import { WORLD_COMPUTERS, WORLD_PLACES } from "./world.js";
import { applySystemsEffect, controlSystem, controlsView, roomPowered } from "./systems.js";
import { MAX_LOG, MINUTES_PER_ACTION, classKeys, contentOf, knowsPassword, levelNamed, line, memoryOf, openSession, peopleAt, programOffered, sameName, slug, writtenContent } from "./computers.js";

// What a completed trace inside leaves on the record, the same mark a failed hack leaves.
function thrownOut(game, session) {
  const marked = classKeys().indexOf(session.classKey) >= classKeys().indexOf("hard");
  const notes = [`[COMPUTER] TRACE COMPLETE on ${session.name}. The connection drops, and you're out, with the trace at 100%.`];
  if (marked) {
    const id = `traced_on_${slug(session.className)}`;
    try {
      recordFact(game, { id, text: `The trace on a ${String(session.className).toLowerCase()} has your name on it.`, from: "hacking" });
      notes.push(`[RECORD] The trace has your name: ${id.replaceAll("_", " ")}.`);
    } catch {
      // A full record keeps what it has.
    }
  }
  return finish(game, session, notes);
}

// Each action takes a little time, and on a hacked computer the trace notices some of them.
function act(game, session, cost) {
  session.actions += 1;
  if (!session.hacked || !cost) return null;
  session.trace += cost;
  if (session.trace >= session.maxTrace) return thrownOut(game, session);
  if (session.trace === session.maxTrace - 1) session.log.push(line("WARNING: trace nearly complete.", "warn"));
  return null;
}
const readCost = (session) => (classKeys().indexOf(session.classKey) >= classKeys().indexOf("very_hard") ? 1 : 0);

// What the player has read goes into What you know, once.
function learn(game, session, name, text) {
  game.lore ??= [];
  const id = `computer:${session.id}:${slug(name)}`;
  if (game.lore.some((entry) => entry.id === id || entry.name.toLowerCase() === name.toLowerCase())) return;
  game.lore.push({ id, name, kind: "concept", text: `On ${session.name}: ${String(text).slice(0, 240)}` });
}

function showScreen(session, screen) {
  session.screen = screen;
  session.log.push(line(`> ${screen.title}`, "bright"));
  if (session.log.length > MAX_LOG) session.log.splice(0, session.log.length - MAX_LOG);
}

function openFile(game, session, content, id) {
  const file = content.files.find((one) => one.id === id);
  if (!file) return { over: false, said: "No such file." };
  const memory = memoryOf(game, session);
  const first = !memory.read.includes(`file:${id}`);
  if (first) memory.read.push(`file:${id}`);
  if (!session.read.includes(file.name)) session.read.push(file.name);
  learn(game, session, file.name, file.text);
  showScreen(session, { kind: "file", id, title: file.name, lines: [line(file.text, "bright")] });
  const out = act(game, session, first ? readCost(session) : 0);
  return out ?? { over: false };
}

function openMail(game, session, content, id) {
  const entry = content.mail.find((one) => one.id === id);
  if (!entry) return { over: false, said: "No such letter." };
  const memory = memoryOf(game, session);
  const first = !memory.read.includes(`mail:${id}`);
  if (first) memory.read.push(`mail:${id}`);
  const title = entry.to ? `From ${entry.from} to ${entry.to}` : entry.subject ?? entry.from;
  if (!session.read.includes(title)) session.read.push(title);
  learn(game, session, title, entry.text);
  showScreen(session, { kind: "mail", id, title, lines: [line(entry.to ? `From: ${entry.from}\nTo: ${entry.to}` : `Subject: ${entry.subject}`, "dim"), line(entry.text, "bright")] });
  const out = act(game, session, first ? readCost(session) : 0);
  return out ?? { over: false };
}

// The logs the game writes itself, from what it knows of the place and the fleet.
function logLines(game, session, content, log) {
  const place = content.place ?? game.location;
  const placeName = LOCATIONS[place]?.name ?? place;
  switch (log.kind) {
    case "berths": {
      const fleetHere = Boolean(WORLD_PLACES[place]?.fleet) || place === "meridian";
      if (!fleetHere) return [line(`No fleet ships berthed at ${placeName}.`, "dim")];
      const ships = Object.entries(game.fleet?.ships ?? {}).filter(([, ship]) => ship.status === "active");
      if (!ships.length) return [line("The berth log is empty.", "dim")];
      return ships.map(([id, ship]) => line(`${(game.fleet?.names?.[id] ?? id).padEnd(24)} condition ${ship.condition}%  aboard ${ship.aboard}`, "info"));
    }
    case "prices": {
      worldOf(game);
      const now = placeNow(game, place);
      if (!now?.goods?.length) return [line(`Nothing is counted at ${placeName}.`, "dim")];
      return [line(`${placeName}, held by ${now.holder}.`, "dim"), ...now.goods.map((good) => line(`${good.name.padEnd(16)} ${good.level}${good.low ? "  (short)" : good.high ? "  (plenty)" : ""}`, good.low ? "warn" : "info"))];
    }
    case "people": {
      const here = (game.walk?.people ?? []).filter((one) => !one.crowd).map((one) => `${one.name}${one.doing ? `, ${one.doing}` : ""}`);
      const all = peopleAt(place);
      return [line(`In the room: ${here.length ? here.join("; ") : "nobody by name"}.`, "info"), line(`On the books at ${placeName}: ${all.length ? all.join(", ") : "nobody by name"}.`, "dim")];
    }
    case "news": {
      const entries = (game.world?.news ?? []).filter((entry) => entry.place === place).slice(-8).reverse();
      return entries.length ? entries.map((entry) => line(`Day ${entry.day + 1}: ${entry.text}`, "info")) : [line(`Nothing's been heard of ${placeName} lately.`, "dim")];
    }
    case "readouts": {
      const ship = game.fleet?.ships?.meridian;
      const out = [];
      if (ship) out.push(line(`CFS Meridian: condition ${ship.condition}%, ${ship.aboard} aboard.`, "info"));
      const fuel = game.fleet?.supplies?.fuel ?? game.fleet?.fuel;
      if (fuel !== undefined) out.push(line(`Fuel: ${typeof fuel === "number" ? fuel : JSON.stringify(fuel)}.`, "info"));
      out.push(line(`Day ${Math.floor((game.clock?.hours ?? 0) / 24) + 1}, air plant at 140% of design.`, "dim"));
      return out;
    }
    default:
      return [line(log.text ?? "", "info")];
  }
}

function openLog(game, session, content, id) {
  const log = content.logs.find((one) => one.id === id);
  if (!log) return { over: false, said: "No such log." };
  showScreen(session, { kind: "log", id, title: log.name, lines: logLines(game, session, content, log) });
  const out = act(game, session, 0);
  return out ?? { over: false };
}

// Opens a door in this place: the one this computer controls, or the door to a room by its id.
function openDoor(game, content, to) {
  const target = to === "here" ? content.door : to;
  const place = content.place ?? game.location;
  if (!target || !place) return null;
  game.opened ??= {};
  game.opened[place] ??= [];
  if (!game.opened[place].includes(target)) game.opened[place].push(target);
  return levelNamed(place, target)?.name ?? target;
}

function runProgram(game, session, content, id) {
  const program = content.programs.find((one) => one.id === id);
  if (!program) return { over: false, said: "No such program." };
  const memory = memoryOf(game, session);
  if (memory.ran.includes(id)) {
    showScreen(session, { kind: "program", id, title: program.name, lines: [line("It's already been run. There's nothing more it does.", "dim")] });
    return { over: false };
  }
  if (!programOffered(game, program)) {
    showScreen(session, { kind: "program", id, title: program.name, lines: [line("It won't run for you, not as things stand.", "warn")] });
    return { over: false };
  }
  const turn = newTurnLimits();
  const notes = [];
  for (const step of program.effects) {
    if (step.set) {
      recordFact(game, { id: step.set, text: step.text ?? null, from: `computer:${session.id}` });
      notes.push(`[RECORD] ${step.text ?? step.set.replaceAll("_", " ")}`);
      continue;
    }
    if (step.clear) {
      clearFact(game, step.clear);
      continue;
    }
    if (step.door) {
      const opened = openDoor(game, content, step.door);
      notes.push(opened ? `[DOOR] The way to ${opened} is open.` : "[DOOR] Nothing here answers to that.");
      continue;
    }
    if (step.password) {
      game.passwords ??= {};
      game.passwords[step.password] = step.word;
      notes.push(`[COMPUTER] You know the password to ${WORLD_COMPUTERS[step.password]?.name ?? step.password} now.`);
      continue;
    }
    if (step.computer) continue;
    if (step.systems) {
      notes.push(...applySystemsEffect(game, step.systems, { by: session.yours ? "owner" : "player" }));
      continue;
    }
    const { tool, ...input } = step;
    const outcome = runTool(game, tool, input, turn);
    if (outcome.isError) throw new Error(`The program ${program.name} failed: ${outcome.result}`);
    if (outcome.notice) notes.push(outcome.notice);
    if (outcome.narration) notes.push(outcome.narration);
  }
  memory.ran.push(id);
  session.ran.push(program.name);
  if (notes.length) game.transcript?.push({ role: "notice", text: notes.join("\n") });
  showScreen(session, { kind: "program", id, title: program.name, lines: [line(program.text || "Done.", "bright"), ...notes.map((note) => line(note, "good"))] });
  const out = act(game, session, 1);
  return out ?? { over: false };
}

// Reaching another computer over the network: the player's own, or one whose password they know, straight
// away; any other is a hack of its own class, after this session is logged off.
function connectTo(game, session, content, id) {
  const entry = content.network.find((one) => one.id === id);
  const target = entry ? WORLD_COMPUTERS[id] : null;
  if (!entry || !target) return { over: false, said: "No such node on the network." };
  const next = writtenContent(id);
  const summary = finish(game, session, [`[COMPUTER] From ${session.name} you reached for ${next.name}.`]);
  if (next.yours || knowsPassword(game, id)) {
    openSession(game, next, { how: "connected" });
    return { over: true, summary, computer: true };
  }
  startCheck(game, { skill: "hacking", difficulty: next.classKey, reason: `Reach ${next.name} from ${session.name}`, scene: entry.desc || null, source: "computer", computer: id });
  return { over: true, summary, check: true };
}

// Logging off, or being thrown out: one line in the story, one for the game master, and the clock moves on.
function finish(game, session, notes = []) {
  const read = session.read.length;
  const ran = session.ran;
  const pct = session.maxTrace ? Math.round((session.trace / session.maxTrace) * 100) : null;
  const summary = `[COMPUTER] On ${session.name}: ${read ? `read ${read} ${read === 1 ? "thing" : "things"}` : "read nothing"}${ran.length ? `, ran ${ran.join(", ")}` : ""}.${session.hacked && pct !== null && !notes.some((note) => /TRACE COMPLETE/.test(note)) ? ` Logged off with the trace at ${pct}%.` : ""}`;
  game.transcript?.push({ role: "notice", text: [summary, ...notes].join("\n") });
  game.pendingEvents?.push(`The player used a computer, ${session.name} (${session.className.toLowerCase()}), ${session.how === "hacked" ? "after hacking into it" : session.how === "the password" ? "with a password they'd learned" : "which is theirs"}. ${read ? `They read: ${session.read.join("; ")}.` : "They read nothing."}${ran.length ? ` They ran: ${ran.join("; ")}.` : ""}${notes.some((note) => /TRACE COMPLETE/.test(note)) ? " The trace completed and threw them out." : ""} Bring it into the story only if it matters.`);
  if (session.actions) passTime(game, (session.actions * MINUTES_PER_ACTION) / 60);
  game.computer = null;
  return { over: true, summary };
}

function helpLines(content) {
  return [
    line("ls: what's here.  cat <file>: read a file.  mail: the letters, and read <n> opens one.", "dim"),
    line("log <name>: a log.  run <program>: a program.  net: the network, and connect <id> reaches one.  logoff: leave.", "dim"),
    line(`Files: ${content.files.map((one) => one.name).join(", ") || "none"}. Programs: ${content.programs.map((one) => one.name).join(", ") || "none"}.`, "dim"),
  ];
}

function typed(game, session, content, text) {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { over: false };
  session.log.push({ you: text.trim().slice(0, 80) });
  const [verb, ...rest] = words;
  const name = rest.join(" ");
  const byName = (list) => {
    const match = closest(name, list.map((one) => one.name));
    return list.find((one) => one.name === match) ?? null;
  };
  switch (verb) {
    case "ls": case "dir": case "home":
      session.screen = { kind: "home" };
      return { over: false };
    case "help": case "?":
      session.log.push(...helpLines(content));
      return { over: false };
    case "cat": case "read": case "open": case "more": case "type": {
      const file = byName(content.files);
      if (file) return openFile(game, session, content, file.id);
      const index = Number(name);
      const letter = Number.isInteger(index) ? content.mail[index - 1] : byName(content.mail.map((one) => ({ ...one, name: one.to ? `from ${one.from} to ${one.to}` : one.subject ?? one.from })));
      if (letter) return openMail(game, session, content, letter.id);
      session.log.push(line(`${name || "which one"}: no such file. Type ls.`, "dim"));
      return { over: false };
    }
    case "mail": case "letters":
      session.screen = { kind: "mail" };
      return { over: false };
    case "log": case "logs": {
      const log = name ? byName(content.logs) : null;
      if (log) return openLog(game, session, content, log.id);
      session.screen = { kind: "logs" };
      return { over: false };
    }
    case "net": case "network":
      session.screen = { kind: "network" };
      return { over: false };
    case "connect": case "ssh": case "reach": {
      const target = content.network.find((one) => one.id === name || sameName(one.desc, name)) ?? content.network.find((one) => one.id.includes(name));
      if (target) return connectTo(game, session, content, target.id);
      session.log.push(line("No such node. Type net.", "dim"));
      return { over: false };
    }
    case "logoff": case "logout": case "exit": case "quit": case "bye":
      return finish(game, session);
    case "run": case "exec": case "start": {
      const program = byName(content.programs.filter((one) => programOffered(game, one)));
      if (program) return runProgram(game, session, content, program.id);
      session.log.push(line(`${name || "which one"}: no such program. The programs are on the left.`, "dim"));
      return { over: false };
    }
    default: {
      // A program's name, or a file's, typed on its own.
      const program = byName(content.programs.filter((one) => programOffered(game, one)).map((one) => ({ ...one, name: one.name })));
      const guess = closest(words.join(" "), content.programs.map((one) => one.name));
      if (guess) return runProgram(game, session, content, content.programs.find((one) => one.name === guess).id);
      const file = closest(words.join(" "), content.files.map((one) => one.name));
      if (file) return openFile(game, session, content, content.files.find((one) => one.name === file).id);
      void program;
      session.log.push(line(`command not found: ${verb}. Type help.`, "dim"));
      return { over: false };
    }
  }
}

// Switching one of the place's systems from here. On a hacked computer the trace notices it, like a program, and a
// computer that's just cut its own room's power goes dark with everything else.
function runSystem(game, session, content, body) {
  const by = session.yours ? "owner" : "player";
  const notes = controlSystem(game, session.place, content.controls ?? [], String(body.row ?? ""), String(body.to ?? ""), { by, room: session.roomId });
  const system = String(body.system ?? "");
  session.screen = { kind: "system", id: system, title: session.screen?.title ?? system };
  for (const note of notes) session.log.push(line(note.replace(/^\[[A-Z]+\]\s*/, ""), /ALARM/.test(note) ? "bad" : "good"));
  if (session.log.length > MAX_LOG) session.log.splice(0, session.log.length - MAX_LOG);
  const done = notes[0]?.replace(/^\[[A-Z]+\]\s*/, "").replace(/\.$/, "") ?? "a system";
  if (!session.ran.includes(done)) session.ran.push(done);
  if (notes.length) game.transcript?.push({ role: "notice", text: notes.join("\n") });
  const out = act(game, session, session.hacked ? 1 : 0);
  if (out) return out;
  if (session.roomId && !roomPowered(game, session.place, session.roomId)) return finish(game, session, ["[COMPUTER] The screen goes dark: you've cut its own power."]);
  return { over: false };
}

export function computerCommand(game, body) {
  const session = game.computer;
  if (!session) throw new Error("You're not on a computer.");
  const content = contentOf(game, session);
  if (!content) {
    game.computer = null;
    throw new Error("That computer's file has gone.");
  }
  switch (body.action) {
    case "home": session.screen = { kind: "home" }; return { over: false };
    case "file": return openFile(game, session, content, String(body.id ?? ""));
    case "mail": return body.id ? openMail(game, session, content, String(body.id)) : (session.screen = { kind: "mail" }, { over: false });
    case "log": return body.id ? openLog(game, session, content, String(body.id)) : (session.screen = { kind: "logs" }, { over: false });
    case "program": return runProgram(game, session, content, String(body.id ?? ""));
    case "network": return (session.screen = { kind: "network" }, { over: false });
    case "connect": return connectTo(game, session, content, String(body.id ?? ""));
    case "logoff": return finish(game, session);
    case "type": return typed(game, session, content, String(body.text ?? ""));
    case "show": {
      const system = controlsView(game, session.place, content.controls ?? [], { room: session.roomId }).find((one) => one.id === String(body.id ?? ""));
      if (!system) return { over: false, said: "This computer doesn't run that." };
      session.screen = { kind: "system", id: system.id, title: system.title };
      return { over: false };
    }
    case "system": return runSystem(game, session, content, body);
    default: throw new Error("Unknown order.");
  }
}
