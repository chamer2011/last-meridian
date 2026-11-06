// Each place's own systems: the files and the defaults, where the parts go, what power, air, lights, doors, cameras
// and the alarm do, working parts by hand and from computers, the people answering it all, the written story's
// words for it, the AI's one line, jumps, and that showing the game changes nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-systems-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const sys = await import("../src/systems.js");
const { clearMaps, mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { aiSnapshot, checkParts, passTime, publicState, travel } = await import("../src/rules.js");
const { checkCommand } = await import("../src/checks.js");
const { computerCommand, screenGoesDark } = await import("../src/computer-use.js");
const { enterComputer, enterDoorPanel, useComputer } = await import("../src/computers.js");
const { conditionHolds, parseCondition, parseEffect } = await import("../src/scene-text.js");
const { peopleAboard } = await import("../src/life.js");
const { jumpCost } = await import("../src/fleet.js");
const { stockTalk } = await import("../src/talks.js");
const { LOCATIONS } = await import("../src/data.js");
const { SYSTEMS_DEFAULTS, WORLD_SYSTEMS } = await import("../src/world.js");
const { parseSystemsText, readComputerLine, readPartLine, writeSystemsText } = await import("../public/systems-text.js");

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  return createGameFromDraft(draft);
};
// The player stands in a room of a place, as if they'd walked there.
function standIn(game, place, room) {
  game.location = place;
  game.walk = null;
  const map = mapFor(place);
  walkCommand(game, { action: "room", to: map.start });
  game.walk.level = room;
  const level = map.levels[room];
  Object.assign(game.walk, { x: level.start.x, y: level.start.y });
  return game.walk;
}
const partNamed = (place, kind, room) => Object.values(sys.systemsOf(place).parts).find((part) => part.kind === kind && (!room || part.room === room));
// Settles a check on a part the way the server does, with the result decided here instead of by dice.
function settleAs(game, success) {
  const reason = game.check?.reason;
  game.check = null;
  return sys.settlePart(game, { success, reason, training: false });
}

// ---- The files ------------------------------------------------------------------------------------

test("a systems file reads into its systems and computers, and writes back the same", () => {
  for (const id of ["meridian", "haven", "frontier"]) {
    const text = fs.readFileSync(new URL(`../world/systems/${id}.txt`, import.meta.url), "utf8");
    const { value, problems } = parseSystemsText(text, id);
    assert.deepEqual(problems, [], id);
    assert.equal(writeSystemsText(value), text, `${id} writes back word for word`);
  }
  const { value } = parseSystemsText(fs.readFileSync(new URL("../world/systems/haven.txt", import.meta.url), "utf8"), "haven");
  assert.deepEqual(value.guards, ["Docker Renko", "Docker Bo"]);
  assert.equal(value.numbers.alarm, 30);
  assert.deepEqual(value.systems.map((one) => one.id), ["power", "air", "lights", "doors", "cameras", "alarm", "comms", "docking"]);
  const bad = parseSystemsText("# Somewhere\nweather: wet\n\nPower:\nnot a part\n", "x");
  assert.ok(bad.problems.some((one) => one.line === 2 && /guards, engineers/.test(one.message)), JSON.stringify(bad.problems));
  assert.ok(bad.problems.some((one) => one.line === 5 && /starts with -/.test(one.message)));
  // The words of a line.
  assert.deepEqual(readPartLine("junction box in The Docks for The Docks, The Hook: A grey box."), { part: "junction box", every: false, rooms: ["The Docks"], feeds: ["The Docks", "The Hook"], look: "A grey box." });
  assert.equal(readPartLine("vent in every room").every, true);
  assert.match(readPartLine("a vent").problem, /needs to say where/);
  assert.deepEqual(readComputerLine("a watch console in The Neutral Ground: cameras, alarm, class very hard"), { ref: "a watch console", room: "The Neutral Ground", systems: ["cameras", "alarm"], rooms: null, classKey: "very_hard" });
  assert.deepEqual(readComputerLine("haven_berth_board: docking, cameras in The Manifest Docks").rooms, ["The Manifest Docks"]);
});

test("every place with a map has systems, its own or by default, and the checker has nothing against any of them", () => {
  assert.deepEqual(sys.systemsProblems(), []);
  for (const place of Object.keys(LOCATIONS)) {
    if (!mapFor(place)) continue;
    const model = sys.systemsOf(place);
    assert.ok(model, place);
    if ((SYSTEMS_DEFAULTS["no systems"] ?? []).includes(place)) {
      assert.equal(model.systems.length, 0, `${place} has no systems`);
      continue;
    }
    assert.ok(model.systems.some((one) => one.id === "power"), `${place} has power`);
    assert.equal(model.systems.some((one) => one.id === "air"), !(SYSTEMS_DEFAULTS["open air"] ?? []).includes(place), `${place}'s air`);
  }
  assert.ok(sys.systemsOf("meridian").written && sys.systemsOf("haven").written && sys.systemsOf("frontier").written);
  assert.equal(sys.systemsOf("kessara").written, false);
  // A sealed place has a vent and a light switch in every room.
  const kessara = sys.systemsOf("kessara");
  for (const room of Object.keys(mapFor("kessara").levels)) {
    assert.ok(sys.partsOf(kessara, "air", room).length >= 1, `kessara/${room} has a vent`);
    assert.ok(sys.partsOf(kessara, "lights", room).length === 1, `kessara/${room} has a light switch`);
  }
});

test("every part is on a wall facing its room, or standing on the floor where it blocks nothing", () => {
  for (const place of Object.keys(LOCATIONS)) {
    const model = sys.systemsOf(place);
    if (!model) continue;
    const map = mapFor(place);
    for (const part of Object.values(model.parts)) {
      assert.ok(!part.unplaced, `${place}: the ${part.name} in ${part.room} has a place`);
      const level = map.levels[part.room];
      const open = (x, y) => Boolean(level.open[y]?.[x]);
      if (part.mount === "wall") {
        assert.equal(level.layers.walls[part.y][part.x], "#", `${place}/${part.room}: the ${part.name} is on a wall`);
        assert.ok(part.face === "back" ? open(part.x, part.y + 1) : open(part.x + 1, part.y), `${place}/${part.room}: the ${part.name} faces the room`);
      } else {
        assert.ok(open(part.x, part.y) && level.solid.has(`${part.x},${part.y}`), `${place}/${part.room}: the ${part.name} stands on the floor`);
      }
      assert.ok(!level.things.some((thing) => thing.x === part.x && thing.y === part.y), `${place}/${part.room}: the ${part.name} isn't on a thing`);
    }
    const squares = Object.values(model.parts).map((part) => `${part.room}:${part.x},${part.y}`);
    assert.equal(new Set(squares).size, squares.length, `${place}: no two parts on one square`);
  }
});

// ---- Power, lights and the dark ----------------------------------------------------------------------

test("a cut junction box darkens the rooms it feeds and stops what's in them, and the dark changes checks", () => {
  const game = newGame();
  standIn(game, "haven", "docks");
  const box = sys.systemsOf("haven").parts[sys.systemsOf("haven").circuits.docks];
  assert.deepEqual(box.feeds, ["docks", "hook"]);
  assert.equal(sys.roomDark(game, "haven", "docks"), false);
  assert.equal(sys.watched(game, "haven", "docks"), true);
  const before = checkParts(game, { skill: "stealth" }).total;
  assert.ok(checkParts(game, { skill: "stealth" }).parts.some((part) => part.label === "a camera on you" && part.value === -2));
  sys.damagePart(game, "haven", box.id, "cut", { by: "story" });
  for (const room of ["docks", "hook"]) {
    assert.equal(sys.roomPowered(game, "haven", room), false);
    assert.equal(sys.roomDark(game, "haven", room), true);
  }
  assert.equal(sys.roomDark(game, "haven", "bar"), false, "the bar's on the other box");
  assert.equal(sys.watched(game, "haven", "docks"), false, "the camera's dead");
  assert.equal(sys.airFlows(game, "haven", "docks"), false, "and so is the vent");
  const view = walkView(game);
  assert.equal(view.room.dark, true);
  assert.equal(view.things.find((thing) => thing.part?.kind === "junction box").part.word, "cut");
  const stealth = checkParts(game, { skill: "stealth" });
  assert.ok(stealth.parts.some((part) => part.label === "in the dark" && part.value === 2));
  assert.equal(stealth.total, before + 4, "out of the camera's sight and into the dark");
  assert.ok(checkParts(game, { skill: "awareness" }).parts.some((part) => part.label === "in the dark" && part.value === -2));
  // The berth board, in the dark room, can't be used.
  const board = useComputer(game, { place: "haven", levelId: "docks", thing: { id: "docks:b", name: "The berth board" } });
  assert.match(board.said, /no power/);
  assert.equal(game.check, null);
});

test("the light switch is worked by hand for free, and nobody minds", () => {
  const game = newGame();
  standIn(game, "haven", "bar");
  const lights = partNamed("haven", "light switch", "bar");
  const before = JSON.stringify(game.factions);
  const off = walkCommand(game, { action: "work", key: `part:${lights.id}`, how: "off" });
  assert.match(off.said, /Switch the lights off|switch the lights off/i);
  assert.equal(sys.roomDark(game, "haven", "bar"), true);
  assert.equal(sys.alarmRinging(game, "haven"), null, "turning a light off isn't tampering");
  assert.equal(JSON.stringify(game.factions), before);
  walkCommand(game, { action: "work", key: `part:${lights.id}`, how: "on" });
  assert.equal(sys.roomDark(game, "haven", "bar"), false);
  assert.equal(game.systems, undefined, "back to normal leaves nothing in the save");
});

// ---- The alarm -------------------------------------------------------------------------------------------

test("tampering where a camera sees it rings the alarm, costs standing, goes on the record, locks doors and brings the guards", () => {
  const game = newGame();
  standIn(game, "haven", "row");
  const holder = game.world?.places?.haven?.holder ?? LOCATIONS.haven.faction;
  const standing = game.factions[holder];
  const relay = partNamed("haven", "relay", "row");
  // Switching the relay off by hand is tampering, and the Row has a camera.
  const reply = walkCommand(game, { action: "work", key: `part:${relay.id}`, how: "off" });
  assert.match(reply.said, /\[ALARM\] The alarm is ringing at Haven Station, in The Consulate Row/);
  assert.equal(game.factions[holder], standing - 2);
  assert.ok(game.flags.seen_tampering_at_haven);
  assert.equal(sys.doorLocked(game, "haven", "row"), true, "the alarm locks the Row");
  assert.ok(conditionHolds(game, "alarm ringing at haven"));
  // With the relay off, comms are down, so the guards don't hear it.
  assert.equal(sys.commsUp(game, "haven"), false);
  assert.equal(sys.detourFor(game, "haven")("Docker Renko", "docks", false), null);
  walkCommand(game, { action: "work", key: `part:${relay.id}`, how: "on" });
  assert.deepEqual(sys.detourFor(game, "haven")("Docker Renko", "docks", false), { where: "@row", doing: "answering the alarm in the Consulate Row" });
  // The AI hears it, in one line.
  assert.match(aiSnapshot(game), /Systems at Haven Station: .*the alarm is ringing in The Consulate Row, because a camera saw the player tampering/);
  // People talk about it.
  const talk = stockTalk(game, { name: "Sable", short: "Sable", personId: null, doing: null });
  assert.ok(Object.values(talk.parts).some((part) => part.text.some((line) => /alarm's going in The Consulate Row/.test(line))));
  // It stops by itself, and the doors it locked open again.
  const notes = passTime(game, 0.6);
  assert.ok(notes.some((note) => /\[ALARM\] The alarm at Haven Station stops/.test(note)), notes.join(" | "));
  assert.equal(sys.alarmRinging(game, "haven"), null);
  assert.equal(sys.doorLocked(game, "haven", "row"), false);
});

test("a ringing alarm's speaker says it's ringing, and a door locked from inside is named by where it goes", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const speakerNow = () => walkView(game).things.find((thing) => thing.part?.kind === "speaker");
  assert.equal(speakerNow().part.word, "on");
  assert.match(speakerNow().look, /It's quiet, and it's working\.$/);
  sys.soundAlarm(game, "meridian", "bridge", { by: "story" });
  const speaker = speakerNow();
  assert.equal(speaker.part.word, "ringing");
  assert.equal(speaker.part.ringing, true);
  assert.match(speaker.look, /a red lamp in the middle\. It's ringing\.$/);
  assert.doesNotMatch(speaker.look, /quiet/);
  // The alarm locks the bridge's own door, and from inside, each way out is named by where it goes, not "the door to
  // The Bridge".
  const locked = walkView(game).exits.filter((exit) => exit.locked);
  assert.ok(locked.length > 0, "the alarm locks the bridge");
  for (const exit of locked) {
    assert.ok(exit.look.startsWith(`The door to ${exit.label}. It's locked`), exit.look);
    assert.doesNotMatch(exit.look, /The Bridge/);
  }
  // With the power cut, a speaker is dead, and says so instead of ringing.
  const box = partNamed("meridian", "junction box", "bridge");
  walkCommand(game, { action: "work", key: `part:${box.id}`, how: "off" });
  assert.equal(speakerNow().part.word, "no power");
  assert.doesNotMatch(speakerNow().look, /ringing/);
  walkCommand(game, { action: "work", key: `part:${box.id}`, how: "on" });
  sys.silenceAlarm(game, "meridian");
  assert.equal(speakerNow().part.word, "on");
});

test("the captain's own ship doesn't call the captain a tamperer, and covering a camera unseen works", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const box = sys.systemsOf("meridian").parts[sys.systemsOf("meridian").circuits.bridge];
  walkCommand(game, { action: "work", key: `part:${box.id}`, how: "off" });
  assert.equal(sys.alarmRinging(game, "meridian"), null);
  assert.equal(sys.roomDark(game, "meridian", "bridge"), true);
  walkCommand(game, { action: "work", key: `part:${box.id}`, how: "on" });
  // Somewhere else, covering the camera takes a Stealth check: done well, nobody saw a thing.
  standIn(game, "haven", "docks");
  const camera = partNamed("haven", "camera", "docks");
  const asked = walkCommand(game, { action: "work", key: `part:${camera.id}`, how: "break" });
  assert.equal(asked.check, true);
  assert.equal(game.check.skill, "stealth");
  const lines = settleAs(game, true);
  assert.ok(lines.some((line) => /rag over the lens/.test(line)), lines.join(" | "));
  assert.equal(sys.watched(game, "haven", "docks"), false);
  assert.equal(sys.alarmRinging(game, "haven"), null, "unseen");
  assert.equal(walkView(game).things.find((thing) => thing.id === `part:${camera.id}`).part.word, "covered");
  // Uncovering it is free.
  walkCommand(game, { action: "work", key: `part:${camera.id}`, how: "fix" });
  assert.equal(sys.watched(game, "haven", "docks"), true);
  // Done badly, the lens got a good look.
  walkCommand(game, { action: "work", key: `part:${camera.id}`, how: "break" });
  const failed = settleAs(game, false);
  assert.ok(failed.some((line) => /\[ALARM\]/.test(line)), failed.join(" | "));
  assert.equal(sys.watched(game, "haven", "docks"), true);
});

// ---- Air ------------------------------------------------------------------------------------------------

test("air that stops goes bad over minutes, hurts the player, keeps them from resting, and comes back", () => {
  const game = newGame();
  standIn(game, "meridian", "mess");
  const hp = game.hp;
  sys.applySystemsEffect(game, parseEffect("air off").do.systems);
  assert.equal(sys.airFlows(game, "meridian", "mess"), false);
  const notes = [];
  for (let i = 0; i < 6; i += 1) notes.push(...passTime(game, 5 / 60));
  assert.ok(notes.some((note) => /The air in The Long Mess is getting thin/.test(note)), notes.join(" | "));
  assert.ok(notes.some((note) => /The air in The Long Mess is bad/.test(note)));
  assert.ok(notes.some((note) => /^\[HEALTH\] -\d+: The bad air/.test(note)));
  assert.ok(game.hp < hp && game.hp >= 1);
  assert.equal(sys.airBadHere(game), true);
  assert.ok(conditionHolds(game, "air bad here") && conditionHolds(game, "air off in The Long Mess"));
  // Hours of it never kill.
  passTime(game, 6);
  assert.equal(game.hp, 1);
  // People leave a room whose air has gone, unless they're asleep and it's only thin.
  const detour = sys.detourFor(game, "meridian");
  assert.equal(detour("halm", "mess", false), null, "nowhere has good air, so there's nowhere to go");
  sys.applySystemsEffect(game, parseEffect("fix everything").do.systems);
  passTime(game, 10 / 60);
  assert.ok(sys.airIn(game, "meridian", "mess") >= 99);
  assert.ok(!conditionHolds(game, "air bad here"));
});

test("people head out of a room with bad air, and the guards and engineers go where they're needed", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const vent = partNamed("meridian", "vent", "mess");
  sys.damagePart(game, "meridian", vent.id, "sealed", { by: "story" });
  passTime(game, 20 / 60);
  assert.ok(sys.airIn(game, "meridian", "mess") < 30);
  const detour = sys.detourFor(game, "meridian");
  const away = detour("halm", "mess", false);
  assert.ok(away && away.where !== "@mess" && /bad air in the Long Mess/.test(away.doing), JSON.stringify(away));
  assert.ok(detour("halm", "mess", true), "asleep, once it's bad, they wake and go too");
  assert.equal(detour("halm", "bridge", false), null, "the bridge is fine");
  // Marrow, the first engineer, walks over within the hour before the seal's due to come off.
  game.systems.meridian.parts[vent.id].fixAt = game.clock.hours + 0.5;
  assert.deepEqual(sys.detourFor(game, "meridian")("marrow", "engineering", false), { where: "@mess", doing: "fixing the vent" });
  const notes = passTime(game, 0.6);
  assert.ok(notes.some((note) => /Marrow has fixed the vent in The Long Mess/.test(note)), notes.join(" | "));
  // What the life simulation shows for people in the room uses the same turn.
  assert.ok(Array.isArray(peopleAboard(game, "meridian", "mess")));
});

// ---- Doors -----------------------------------------------------------------------------------------------

test("a locked door stops the walk both ways, can be forced, and stays forced until the engineers fix it", () => {
  const game = newGame();
  standIn(game, "haven", "docks");
  sys.setDoor(game, "haven", "hook", "locked", { by: "story" });
  const exits = walkView(game).exits;
  const toHook = exits.find((exit) => /Hook/.test(exit.label));
  assert.equal(toHook.locked, true);
  assert.deepEqual(toHook.actions.map((one) => one.id), ["force", "hack"]);
  assert.match(toHook.look, /locked/);
  assert.equal(walkCommand(game, { action: "go", to: `exit:${toHook.key}` }).arrived.kind, "door");
  assert.throws(() => walkCommand(game, { action: "room", to: "hook" }), /closed door/);
  assert.ok(conditionHolds(game, "door locked The Hook"));
  // Forcing it is a check; once it gives, it won't lock again until it's fixed.
  walkCommand(game, { action: "work", key: toHook.key, how: "force" });
  assert.equal(game.check.skill, "athletics");
  settleAs(game, true);
  assert.equal(sys.doorLocked(game, "haven", "hook"), false);
  assert.ok(walkView(game).exits.find((exit) => exit.key === toHook.key).closed !== true);
  sys.setDoor(game, "haven", "hook", "locked", { by: "story" });
  assert.equal(sys.doorLocked(game, "haven", "hook"), false, "a forced door won't lock");
  const notes = passTime(game, 3.2);
  assert.ok(notes.some((note) => /fixed the door to The Hook/.test(note)), notes.join(" | "));
  // Hacking the panel opens it as a computer that runs that door.
  sys.setDoor(game, "haven", "hook", "locked", { by: "story" });
  enterDoorPanel(game, "haven", "hook", { classKey: "easy", trace: 0, maxTrace: 5 });
  const panel = publicState(game).computer;
  assert.deepEqual(panel.systems.map((one) => one.id), ["doors"]);
  const row = panel.systems[0].rows[0];
  assert.equal(row.word, "locked");
  computerCommand(game, { action: "system", system: "doors", row: row.id, to: "unlocked" });
  assert.equal(sys.doorLocked(game, "haven", "hook"), false);
  assert.equal(game.computer.trace, 1, "a switch on a hacked computer costs a point of trace");
  computerCommand(game, { action: "logoff" });
});

// ---- Computers -------------------------------------------------------------------------------------------

test("a computer runs what the place's file says, and one that cuts its own power goes dark", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  enterComputer(game, { id: "meridian_plot_table" });
  let view = publicState(game).computer;
  assert.deepEqual(view.systems.map((one) => one.id), ["doors", "cameras", "alarm", "comms", "navigation"]);
  const camera = view.systems.find((one) => one.id === "cameras").rows.find((row) => /Bridge/.test(row.name));
  assert.equal(camera.word, "watching");
  assert.ok(Array.isArray(camera.feed));
  computerCommand(game, { action: "show", id: "cameras" });
  computerCommand(game, { action: "system", system: "cameras", row: camera.id, to: "off" });
  assert.equal(sys.watched(game, "meridian", "bridge"), false);
  view = publicState(game).computer;
  assert.equal(view.screen.kind, "system");
  assert.equal(view.systems.find((one) => one.id === "cameras").rows.find((row) => row.id === camera.id).word, "off");
  assert.equal(game.computer.trace, 0, "no trace on the captain's own machine");
  assert.throws(() => computerCommand(game, { action: "system", system: "power", row: "power:junction_box:bridge", to: "off" }), /can't be done from here/);
  computerCommand(game, { action: "logoff" });
  assert.equal(game.systems.meridian.parts[camera.id].backAt, undefined, "the captain's own changes stay");
  // The reactor gauges run the power, and cutting Engineering's own takes the gauges with it.
  standIn(game, "meridian", "engineering");
  enterComputer(game, { id: "meridian_reactor_gauges" });
  const power = publicState(game).computer.systems.find((one) => one.id === "power").rows.find((row) => /Engineering/.test(row.name));
  const reply = computerCommand(game, { action: "system", system: "power", row: power.id, to: "off" });
  assert.equal(reply.over, true);
  assert.equal(game.computer, null);
  assert.match(game.transcript.at(-1).text, /The screen goes dark: you've cut its own power/);
  // The Ship menu runs everything aboard, for the captain.
  const ship = publicState(game).shipSystems;
  assert.ok(ship.find((one) => one.id === "power").rows.some((row) => row.word === "off" && row.actions.some((action) => action.to === "on")));
});

test("a computer goes dark when its room's power is cut from the Ship menu, and logging off counts only time the clock hasn't run", () => {
  const game = newGame();
  standIn(game, "meridian", "engineering");
  enterComputer(game, { id: "meridian_reactor_gauges" });
  assert.equal(screenGoesDark(game, "the power's off in here"), null, "still on");
  const all = [{ systems: sys.systemsOf("meridian").systems.map((one) => one.id), rooms: null }];
  const power = publicState(game).computer.systems.find((one) => one.id === "power").rows.find((row) => /Engineering/.test(row.name));
  sys.controlSystem(game, "meridian", all, power.id, "off", { by: "owner" });
  assert.equal(screenGoesDark(game, "the power's off in here").over, true);
  assert.equal(game.computer, null);
  assert.match(game.transcript.at(-1).text, /The screen goes dark: the power's off in here/);
  sys.controlSystem(game, "meridian", all, power.id, "on", { by: "owner" });
  // Ten things done take twenty minutes at least. Half an hour on the running clock covers them; five minutes leaves fifteen.
  for (const [ran, added] of [[0.5, 0], [5 / 60, 15 / 60]]) {
    enterComputer(game, { id: "meridian_reactor_gauges" });
    game.computer.actions = 10;
    game.clock.hours += ran;
    const before = game.clock.hours;
    computerCommand(game, { action: "logoff" });
    assert.ok(Math.abs(game.clock.hours - before - added) < 1e-9, `${ran * 60} minutes on the clock adds ${added * 60} more`);
  }
});

test("someone else's place puts back what the player switched off, and what the story did stays", () => {
  const game = newGame();
  standIn(game, "haven", "bar");
  const lights = partNamed("haven", "light switch", "hook");
  sys.switchPart(game, "haven", lights.id, false, { by: "player" });
  const story = partNamed("haven", "light switch", "warm");
  sys.switchPart(game, "haven", story.id, false, { by: "story" });
  const notes = passTime(game, 6.2);
  assert.ok(notes.some((note) => /has put the light switch in The Hook back on/.test(note)), notes.join(" | "));
  assert.equal(sys.roomDark(game, "haven", "hook"), false);
  assert.equal(sys.roomDark(game, "haven", "warm"), true);
});

// ---- The written story ---------------------------------------------------------------------------------

test("conditions and effects in the scenes' words read the systems and change them", () => {
  for (const words of ["power off here", "lights on in The Docks", "air thin at haven", "cameras off in The Manifest Docks at haven", "alarm ringing at haven", "door locked The Hook at haven", "comms jammed", "engines off at meridian", "docking locked at haven", "system water off at frontier", "not alarm quiet"]) {
    assert.deepEqual(parseCondition(words).problems, [], words);
  }
  assert.match(parseCondition("power sideways").problems[0], /power needs one of on, off/);
  assert.match(parseCondition("alarm ringing at nowhere").problems[0], /no place called nowhere/);
  assert.match(parseCondition("door locked").problems[0], /door needs the room/);
  for (const words of ["power off in The Docks", "lights on", "air off", "cameras off in The Docks at haven", "alarm ringing in The Docks", "alarm quiet", "door locked The Hook", "door unlocked The Hook", "comms jammed", "engines off", "docking released at haven", "fix everything", "fix power in The Docks", "break engines at meridian", "system water off at frontier"]) {
    assert.ok(parseEffect(words).do?.systems, `${words}: ${parseEffect(words).problem}`);
  }
  assert.match(parseEffect("power off: why").problem, /no colon/);
  assert.deepEqual(parseEffect("door sublevels").do, { door: "sublevels" }, "the old way to open a story door still works");
  const game = newGame();
  standIn(game, "frontier", "commons");
  assert.ok(conditionHolds(game, "system water on"));
  sys.applySystemsEffect(game, parseEffect("system water off at frontier").do.systems);
  assert.ok(conditionHolds(game, "system water off"));
  assert.match(aiSnapshot(game), /Systems at Tessen Colony: water down \(the pump in The Well-Head, the windpump in The Far Homesteads\)/);
  sys.applySystemsEffect(game, parseEffect("fix everything").do.systems);
  assert.ok(conditionHolds(game, "system water on"));
  assert.equal(game.systems, undefined);
});

// ---- Jumps -----------------------------------------------------------------------------------------------

test("the Meridian can't jump with her engines down, plots by hand with her navigation down, and can't leave locked clamps", () => {
  const game = newGame();
  const destination = Object.keys(LOCATIONS).find((id) => id !== game.location && jumpCost(game, id).jump);
  const normal = jumpCost(game, destination);
  sys.applySystemsEffect(game, parseEffect("navigation off at meridian").do.systems);
  const byHand = jumpCost(game, destination);
  assert.equal(byHand.fuel, normal.fuel + 1);
  assert.ok(byHand.hours > normal.hours && byHand.byHand);
  sys.applySystemsEffect(game, parseEffect("navigation on at meridian").do.systems);
  sys.applySystemsEffect(game, parseEffect("engines off at meridian").do.systems);
  assert.throws(() => travel(game, destination), /engines are down/);
  sys.applySystemsEffect(game, parseEffect("engines on at meridian").do.systems);
  game.fleet.at = "haven";
  sys.applySystemsEffect(game, parseEffect("docking locked at haven").do.systems);
  assert.match(sys.jumpBlocked(game), /docking clamps at Haven Station are locked/);
  sys.applySystemsEffect(game, parseEffect("docking released at haven").do.systems);
  assert.equal(sys.jumpBlocked(game), null);
});

// ---- Nothing changes by being looked at ------------------------------------------------------------------

test("showing the game, the AI's state and the board's views of the systems changes nothing in the save", () => {
  const game = newGame();
  standIn(game, "haven", "docks");
  sys.damagePart(game, "haven", partNamed("haven", "vent", "hook").id, "sealed", { by: "story" });
  passTime(game, 0.25);
  const before = JSON.stringify(game);
  publicState(game);
  walkView(game);
  aiSnapshot(game);
  sys.systemsLine(game);
  sys.detourFor(game, "haven");
  peopleAboard(game, "haven", "hook");
  checkParts(game, { skill: "stealth" });
  conditionHolds(game, "air bad in The Hook");
  assert.equal(JSON.stringify(game), before);
  // With nothing wrong, the AI hears nothing at all about the systems.
  const fresh = newGame();
  assert.ok(!/Systems at/.test(aiSnapshot(fresh)));
  assert.equal(fresh.systems, undefined);
});

test("the checker catches a systems file with a room, a system or a computer the place hasn't got", () => {
  const had = WORLD_SYSTEMS.haven;
  try {
    WORLD_SYSTEMS.haven = parseSystemsText("# Haven Station\nguards: nobody_at_all\n\nPower:\n- junction box in The Moon\n\nAlarm:\n- speaker in every room\n- locks the door to The Hook\n\nComputers:\n- ghost_terminal: power\n- haven_harbor_office: weather\n", "haven").value;
    sys.clearSystems();
    clearMaps();
    const problems = sys.systemsProblems().filter((one) => one.startsWith("systems/haven.txt"));
    for (const words of [/no room called The Moon/, /nobody_at_all isn't anyone/, /door to The Hook, which needs to be under Doors/, /"ghost_terminal" isn't a computer/, /no system called weather/]) {
      assert.ok(problems.some((one) => words.test(one)), `${words}: ${problems.join(" | ")}`);
    }
  } finally {
    WORLD_SYSTEMS.haven = had;
    sys.clearSystems();
    clearMaps();
  }
  assert.deepEqual(sys.systemsProblems(), []);
});
