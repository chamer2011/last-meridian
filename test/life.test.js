// People living their days: the clock that runs by itself, everyone's day on the Meridian, how they
// get around, and how all that reaches the screen and the game master. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-life-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { LOCATIONS } = await import("../src/data.js");
const { findCharacter } = await import("../src/campaign.js");
const { peopleAboard, whereNow } = await import("../src/life.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { aiSnapshot, clockLabel, clockRuns, passTime, publicState, rest } = await import("../src/rules.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { canStand, mapFor, setScene, talkBrief, talkCommand, talkView, walkCommand, walkLine, walkOf, walkTick, walkView } = await import("../src/walk.js");
const { WORLD_LIFE, WORLD_MAPS } = await import("../src/world.js");
const { NOTABLES } = await import("../src/character-data.js");
// Whoever could have the chair is only there in a game where the player isn't the captain.
const forAnyGame = (id) => !NOTABLES[id]?.chair;

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const FILE = WORLD_LIFE.meridian;
const MAP = mapFor("meridian");
const LEVELS = Object.keys(MAP.levels);
const CREW = Object.keys(FILE.people).filter(forAnyGame);
const at = (hours) => {
  const game = newGame();
  game.clock.hours = hours;
  return game;
};
const everyone = (game) => LEVELS.flatMap((level) => peopleAboard(game, "meridian", level).map((one) => ({ ...one, level, key: one.id ?? one.name })));
const find = (game, id) => everyone(game).find((one) => one.key === id);
const standsAt = (game, level, id) => peopleAboard(game, "meridian", level).find((one) => one.id === id);
const homeOf = (id) => {
  for (const level of Object.values(MAP.levels)) {
    const home = level.homes.find((one) => one.id === id);
    if (home) return { level: level.id, x: home.x, y: home.y };
  }
  return null;
};
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());

// ---- The file -------------------------------------------------------------

test("everyone in the Meridian's crew has a day, and every day makes sense", () => {
  assert.deepEqual([...CREW].sort(), [...LOCATIONS.meridian.gm.people].sort());
  const days = [...Object.values(FILE.people), ...FILE.crowd.map((group) => group.day)];
  for (const day of days) {
    for (const block of day) {
      assert.match(block.at, /^\d\d:\d\d$/);
      assert.ok(block.doing, `${block.at} says nothing about what they're doing`);
      const places = [block.go, ...(block.rounds ?? []), ...(block.pick ?? [])].filter(Boolean);
      assert.ok(places.length, `${block.at} ${block.doing} doesn't go anywhere`);
      for (const place of places) assert.ok(place === "post" || FILE.spots[place] || FILE.groups[place], `There's no such place as ${place}`);
    }
  }
});

test("every spot and seat is on a real level, and can be walked up to", () => {
  const near = (level, x, y) => [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => canStand(MAP.levels[level], x + dx, y + dy));
  for (const [name, [level, x, y]] of Object.entries(FILE.spots)) {
    assert.ok(MAP.levels[level], `${name}: no level ${level}`);
    assert.ok(near(level, x, y), `${name} is cut off, at ${level} ${x},${y}`);
  }
  for (const [name, seats] of Object.entries(FILE.groups)) {
    for (const seat of seats) {
      if (Array.isArray(seat)) assert.ok(near(seat[0], seat[1], seat[2]), `${name}: ${seat}`);
      else for (let x = seat.from; x <= seat.to; x += seat.step ?? 1) assert.ok(near(seat.level, x, seat.y), `${name}: ${seat.level} ${x},${seat.y}`);
    }
  }
});

test("nobody in the crowd has the same name as anyone else, or as anyone on the bulkhead of the dead", () => {
  const names = FILE.crowd.flatMap((group) => group.names.map(([name]) => name));
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.length >= 20, "a ship with thirty thousand survivors in its fleet should feel busy");
  const dead = MAP.levels.names.layers.writing.join(" ");
  for (const name of names) assert.ok(!dead.includes(name.split(" ").at(-1).toUpperCase()), `${name} is on the wall of the dead`);
});

test("what someone's doing never gives away a secret", () => {
  const said = JSON.stringify([...Object.values(FILE.people), ...FILE.crowd.map((group) => group.day)].flat().map((block) => block.doing)).toLowerCase();
  for (const word of ["brig", "orchard", "prisoner", "broadcast", "midnight roll", "implant", "baking", "bakes", "flour", "choir"]) assert.ok(!said.includes(word), word);
});

// ---- The clock ------------------------------------------------------------

test("the clock shows real minutes, and a tiny rounding error can't show 08:00 as 07:59", () => {
  const game = newGame();
  assert.equal(clockLabel(game), "Day 1, 08:00");
  game.clock.hours = 10 + 4 / 60;
  assert.equal(clockLabel(game), "Day 1, 10:04");
  game.clock.hours = 8 - 1e-10;
  assert.equal(clockLabel(game), "Day 1, 08:00");
  game.clock.hours = 24 * 3 + 23.99;
  assert.equal(clockLabel(game), "Day 4, 23:59");
});

test("the clock running counts in whole hours for the captain, and days for the fleet", () => {
  const game = at(10);
  game.needs.fatigue = 10;
  game.energy = 1;
  clockRuns(game, 110);
  assert.equal(game.needs.fatigue, 10, "nothing's happened to the captain yet");
  clockRuns(game, 10);
  assert.equal(game.clock.hours, 12);
  assert.ok(game.needs.fatigue > 10, "two hours have gone by");
  assert.ok(Number.isInteger(game.needs.fatigue));
  assert.equal(game.energy, 2);
  const conditions = at(10);
  conditions.conditions = [{ id: "bruised", hoursLeft: 3 }];
  clockRuns(conditions, 125);
  assert.equal(conditions.conditions[0].hoursLeft, 1);

  const night = at(23.5);
  const { day } = night.fleet;
  clockRuns(night, 20);
  assert.equal(night.fleet.day, day, "it isn't midnight yet");
  clockRuns(night, 20);
  assert.equal(night.fleet.day, day + 1, "and now a day of the fleet has gone by");
});

test("the story's time works exactly as it did, and everyone's day moves on with it", () => {
  const game = newGame();
  const fatigue = game.needs.fatigue;
  passTime(game, 4);
  assert.equal(game.clock.hours, 12);
  assert.equal(game.needs.fatigue, fatigue + 6);
  assert.equal(game.life.at, 12);
  rest(game);
  assert.equal(game.clock.hours, 20);
  assert.equal(game.life.at, 20);
});

// ---- Everyone's day ---------------------------------------------------------

test("at eight in the morning everyone's at their post, any day, so the story starts as it always did", () => {
  for (const day of [0, 1, 2, 3, 10, 57]) {
    const game = at(day * 24 + 8);
    for (const id of CREW) {
      const home = homeOf(id);
      const person = standsAt(game, home.level, id);
      assert.ok(person, `${id} isn't in ${home.level} on day ${day}`);
      assert.deepEqual([person.x, person.y], [home.x, home.y], `${id} on day ${day}`);
    }
  }
});

test("a few days a minute at a time: everyone eats, sleeps, walks, and always gets there", () => {
  const game = newGame();
  const seen = Object.fromEntries(CREW.map((id) => [id, { slept: false, ate: false, rooms: new Set(), walking: 0, longest: 0 }]));
  let last = structuredClone(walkOf(game) && everyone(game));
  for (let minute = 0; minute < 3 * 1440; minute += 1) {
    clockRuns(game, 1);
    const now = everyone(game);
    for (const person of now) {
      const before = last.find((one) => one.key === person.key);
      // Nobody moves faster than a walk, except through a door.
      if (before && before.level === person.level) assert.ok(Math.abs(before.x - person.x) + Math.abs(before.y - person.y) <= 19, `${person.key} jumped from ${before.x},${before.y} to ${person.x},${person.y}`);
      const one = seen[person.key];
      if (!one) continue;
      if (person.asleep) one.slept = true;
      if (/\beat|cadging/.test(person.doing)) one.ate = true;
      one.rooms.add(person.level);
      one.walking = person.walking ? one.walking + 1 : 0;
      one.longest = Math.max(one.longest, one.walking);
    }
    last = now;
  }
  for (const [id, one] of Object.entries(seen)) {
    assert.ok(one.longest <= 15, `${id} was still on the way somewhere after ${one.longest} minutes`);
    assert.ok(one.rooms.size >= 2, `${id} never leaves one room`);
    if (id !== "seven") assert.ok(one.ate, `${id} never eats`);
    if (id !== "seven" && id !== "iven") assert.ok(one.slept, `${id} never sleeps`);
  }
  assert.equal(seen.seven.slept, false, "a synthetic has no need of sleep");
  assert.equal(seen.iven.slept, false, "and Sorel can't");
});

test("the crew keep their own habits", () => {
  const scan = at(2 + 55 / 60);
  assert.match(find(scan, "voss").doing, /scan bed/);
  const smallHours = at(3);
  assert.match(find(smallHours, "iven").doing, /small hours/);
  assert.deepEqual([find(smallHours, "iven").level, find(smallHours, "iven").x], ["bridge", homeOf("iven").x]);
  assert.equal(find(at(19.75), "tarrow"), undefined, "Tarrow goes out of sight in the evening");
  assert.equal(find(at(23.75), "bastian"), undefined, "and Father Roe, late at night");
  assert.match(find(at(21.75), "marrow").doing, /aft holds/);
  assert.equal(find(at(4), "seven").level, "medbay");
  assert.equal(find(at(10 * 24 + 19.5), "bastian").doing, "leading the service", "every tenth day");
  assert.notEqual(find(at(11 * 24 + 19.5), "bastian").doing, "leading the service", "but not the day after");
});

test("no two names ever cover each other, or anything else on the level, over several days", () => {
  const game = newGame();
  for (let step = 0; step < 4 * 144; step += 1) {
    clockRuns(game, 10);
    for (const id of LEVELS) {
      const level = MAP.levels[id];
      const taken = new Map();
      const claim = (name, x, y, length = 1) => {
        for (let i = 0; i < length; i += 1) {
          const key = `${x + i},${y}`;
          assert.ok(!taken.has(key), `${name} covers ${taken.get(key)} at ${key} in ${id}, at ${clockLabel(game)}`);
          taken.set(key, name);
        }
      };
      for (const thing of level.things) claim(thing.name, thing.x, thing.y);
      for (const exit of level.exits) claim(exit.label, exit.x, exit.y);
      for (const label of level.labels) claim(label.text, label.x, label.y, label.text.length);
      level.layers.writing.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch !== " " && !taken.has(`${x},${y}`)) claim("the words on the wall", x, y);
      }));
      const people = peopleAboard(game, "meridian", id).filter((one) => !one.walking);
      for (const one of people.filter((person) => !person.crowd)) {
        const length = one.label.length + 2;
        claim(one.label, one.side === "left" ? one.x - length + 1 : one.x, one.y, length);
        assert.ok(one.x + length <= level.width || one.side === "left", `${one.label}'s name runs off ${id}`);
      }
      for (const one of people.filter((person) => person.crowd)) assert.ok(!taken.has(`${one.x},${one.y}`), `${one.name} is on top of ${taken.get(`${one.x},${one.y}`)} in ${id}`);
    }
  }
});

test("going straight from one thing to the next in the same place doesn't move anyone off their bed", () => {
  const game = at(20);
  for (let minute = 0; minute < 8 * 60; minute += 1) clockRuns(game, 1);
  assert.equal(clockLabel(game), "Day 2, 04:00");
  for (const [id, spot] of Object.entries({ voss: "cabin-voss", halm: "cabin-halm", odessa: "cabin-brandt", tarrow: "cabin-tarrow", pell: "rack-pell", lira: "rack-vey", tobin: "rack-hask", marrow: "marrow-cot", bastian: "cabin-roe", aduro: "aduro-cot" })) {
    const [level, x, y] = FILE.spots[spot];
    const person = find(game, id);
    assert.deepEqual([person.level, person.x, person.y, person.asleep], [level, x, y, true], id);
  }
});

test("nobody's ever left standing in a wall, and nobody stands in a doorway once they've arrived", () => {
  const game = newGame();
  for (let step = 0; step < 2 * 144; step += 1) {
    clockRuns(game, 10);
    for (const person of everyone(game)) {
      const level = MAP.levels[person.level];
      assert.ok(person.x >= 0 && person.x < level.width && person.y >= 0 && person.y < level.height, `${person.key} is off ${person.level}`);
      assert.ok(person.walking || !level.doors.has(`${person.x},${person.y}`), `${person.key} stopped in a doorway`);
      assert.ok(!level.exits.some((exit) => exit.x === person.x && exit.y === person.y), `${person.key} is standing in an exit`);
      assert.notEqual(level.layers.walls[person.y][person.x], "#", `${person.key} is inside a wall at ${person.x},${person.y} in ${person.level}`);
    }
  }
});

test("a long gap puts everyone where they should be, the same every time, and a year costs nothing", () => {
  const one = newGame();
  const two = newGame();
  const started = Date.now();
  passTime(one, 24 * 365);
  assert.ok(Date.now() - started < 1500, `a year took ${Date.now() - started} ms`);
  passTime(two, 24 * 365);
  assert.deepEqual(one.life, two.life);
  for (const person of everyone(one)) assert.ok(!person.walking, `${person.key} shouldn't still be on the way after a year`);
  const big = JSON.stringify(one.life).length;
  assert.ok(big < 20000, `the save has ${big} characters of this`);
});

test("walking gives the same result every time, and carries on the same after saving and loading", () => {
  const one = newGame();
  const two = newGame();
  for (let i = 0; i < 300; i += 1) {
    clockRuns(one, 1 / 3);
    clockRuns(two, 1 / 3);
  }
  assert.deepEqual(one.life, two.life);
  const loaded = JSON.parse(JSON.stringify(two));
  for (let i = 0; i < 300; i += 1) {
    clockRuns(one, 1);
    clockRuns(loaded, 1);
  }
  assert.deepEqual(one.life, loaded.life);
});

test("the dead and the gone aren't seen again", () => {
  const game = newGame();
  const contact = game.contacts.find((one) => /Voss/.test(one.name));
  contact.status = "dead";
  assert.equal(find(game, "voss"), undefined);
  clockRuns(game, 600);
  assert.equal(find(game, "voss"), undefined);
  assert.ok(!walkView(game).overview.rooms.some((room) => room.people.includes("Voss")));
});

// ---- Only showing it ----------------------------------------------------------

test("showing the game changes nothing in the save, and a save can have no lives in it yet", () => {
  const game = newGame();
  const before = JSON.stringify(game);
  publicState(game);
  walkView(game);
  walkLine(game);
  aiSnapshot(game);
  whereNow(game, "voss");
  assert.equal(JSON.stringify(game), before);
  assert.equal(game.life, null);
});

test("an older save moves up a version, and everyone starts from wherever this time of day finds them", () => {
  const old = { ...newGame(), version: 10, clock: { hours: 12.5 } };
  delete old.life;
  const game = migrateGame(JSON.parse(JSON.stringify(old)));
  assert.equal(game.version, 14);
  assert.equal(game.life, null);
  assert.equal(find(game, "voss").doing, "eating");
  assert.doesNotThrow(() => publicState(game));
  clockRuns(game, 1);
  assert.ok(game.life.places.meridian.voss);
});

// ---- What the player sees ------------------------------------------------------

test("the room lists who's there and what they're doing, and the deck plan counts everyone else", () => {
  const game = at(12.75);
  setScene(game, "The Long Mess");
  const view = walkView(game);
  const voss = view.people.find((one) => one.key === "voss");
  assert.equal(voss.doing, "eating");
  assert.equal(voss.short, "Voss");
  assert.ok(view.people.some((one) => one.crowd), "and there's a crowd at lunchtime");
  assert.equal(view.life, true);
  const mess = view.overview.rooms.find((room) => room.id === "mess");
  assert.ok(mess.people.includes("Voss"));
  assert.ok(mess.others > 0);
  assert.ok(!mess.people.some((name) => /Deckhand|Cook|Tech/.test(name)), "only people with a name of their own are listed");
  const empty = at(3);
  setScene(empty, "The Long Mess");
  assert.ok(walkView(empty).people.length < view.people.length, "the mess empties out at night");
});

// ---- Every place ---------------------------------------------------------------

const PLACE_IDS = Object.keys(LOCATIONS);
const atPlace = (place, hours = 8) => {
  const game = newGame();
  game.location = place;
  game.fleet.at = LOCATIONS[place].fleet ? null : place;
  game.walk = null;
  game.clock.hours = hours;
  game.fleet.day = Math.floor(hours / 24);
  game.world.day = Math.floor(hours / 24);
  return game;
};
const peopleThere = (game, place) => Object.keys(mapFor(place).levels).flatMap((level) => peopleAboard(game, place, level).map((one) => ({ ...one, level, key: one.id ?? one.name })));

test("every place in the world has a file of days, with everyone who belongs there in it", () => {
  assert.equal(PLACE_IDS.length, 24);
  const levelsOf = (place) => mapFor(place).levels;
  for (const place of PLACE_IDS) {
    const lives = WORLD_LIFE[place];
    assert.ok(lives, `${place} has no file in world/life`);
    assert.deepEqual(Object.keys(lives.people ?? {}).filter(forAnyGame).sort(), [...(LOCATIONS[place].gm.people ?? [])].sort(), `${place}: everyone who belongs there, and nobody else`);
    const days = [...Object.values(lives.people ?? {}), ...(lives.crowd ?? []).map((group) => group.day)];
    assert.ok(days.length > 0, place);
    for (const day of days) {
      for (const block of day) {
        assert.match(block.at, /^\d\d:\d\d$/, place);
        assert.ok(block.doing && block.doing.length <= 52, `${place}: "${block.doing}"`);
        assert.ok(!/—/.test(block.doing), block.doing);
        for (const where of [block.go, ...(block.rounds ?? []), ...(block.pick ?? [])].filter(Boolean)) {
          if (/^[@>]/.test(where)) assert.ok(levelsOf(place)[where.slice(1)], `${place}: there's no level called ${where}`);
          else assert.ok(where === "post" || lives.spots?.[where] || lives.groups?.[where], `${place}: there's nowhere called ${where}`);
        }
      }
    }
    const names = (lives.crowd ?? []).flatMap((group) => group.names.map(([name]) => name));
    assert.equal(new Set(names).size, names.length, `${place}: two people with one name`);
    for (const name of names) assert.equal(findCharacter(null, name), null, `${place}: ${name} is the name of someone who matters`);
  }
});

test("at every place at eight in the morning, whoever works there is at their post", () => {
  for (const place of PLACE_IDS) {
    for (const day of [0, 3, 20]) {
      const game = atPlace(place, day * 24 + 8);
      for (const level of Object.values(mapFor(place).levels)) {
        for (const home of level.homes.filter((one) => forAnyGame(one.id))) {
          const person = peopleAboard(game, place, level.id).find((one) => one.id === home.id);
          assert.ok(person, `${place}: ${home.id} isn't at ${level.id} on day ${day}`);
          assert.deepEqual([person.x, person.y], [home.x, home.y], `${place}: ${home.id} on day ${day}`);
        }
      }
    }
  }
});

test("at every place, over a couple of days, names don't cover anything and nobody gets lost", () => {
  for (const place of PLACE_IDS) {
    const game = atPlace(place);
    const walking = {};
    for (let step = 0; step < 2 * 144; step += 1) {
      clockRuns(game, 10);
      game.fleet.raid = null;
      for (const level of Object.values(mapFor(place).levels)) {
        const taken = new Map();
        const claim = (name, x, y, length = 1) => {
          for (let i = 0; i < length; i += 1) {
            const key = `${x + i},${y}`;
            assert.ok(!taken.has(key), `${place} ${level.id}: ${name} covers ${taken.get(key)} at ${key}, at ${clockLabel(game)}`);
            taken.set(key, name);
          }
        };
        for (const thing of level.things) claim(thing.name, thing.x, thing.y);
        for (const exit of level.exits) claim(exit.label, exit.side === "left" ? exit.x - exit.label.length - 1 : exit.x, exit.y, exit.label.length + 2);
        for (const label of level.labels) claim(label.text, label.x, label.y, label.text.length);
        const people = peopleAboard(game, place, level.id);
        for (const one of people.filter((person) => !person.crowd && !person.walking)) {
          const length = one.label.length + 2;
          const start = one.side === "left" ? one.x - length + 1 : one.x;
          claim(one.label, start, one.y, length);
          assert.ok(start >= 0 && start + length <= level.width, `${place} ${level.id}: ${one.label}'s name runs off the level`);
        }
        for (const one of people) {
          assert.notEqual(level.layers.walls[one.y]?.[one.x], "#", `${place} ${level.id}: ${one.name} is inside a wall`);
          if (!one.walking) {
            assert.ok(!level.doors.has(`${one.x},${one.y}`), `${place} ${level.id}: ${one.name} stopped in a doorway`);
            if (one.crowd) assert.ok(!taken.has(`${one.x},${one.y}`), `${place} ${level.id}: ${one.name} is standing on ${taken.get(`${one.x},${one.y}`)}`);
          }
          const key = one.id ?? one.name;
          walking[key] = one.walking ? (walking[key] ?? 0) + 10 : 0;
          assert.ok(walking[key] <= 30, `${place}: ${one.name} is still walking after ${walking[key]} minutes`);
        }
      }
    }
  }
});

test("the clock runs at every place, and everyone can be walked up to and talked to", () => {
  for (const place of PLACE_IDS) {
    const game = atPlace(place, 12.25);
    const reply = walkTick(game, { ms: 500, rate: 10 });
    assert.ok(reply.people, `${place} has no clock`);
    assert.equal(walkView(game).life, true, place);
    for (const level of Object.values(mapFor(place).levels)) {
      const visit = structuredClone(game);
      setScene(visit, level.name);
      for (const one of walkView(visit).people) {
        const walked = walkCommand(structuredClone(visit), { action: "go", to: `person:${one.key}` });
        assert.equal(walked.arrived?.kind, "person", `${place} ${level.id}: ${one.key}`);
        const talking = structuredClone(visit);
        talkCommand(talking, { action: "open", person: one.key });
        assert.equal(talkView(talking).name, one.name);
      }
    }
  }
});

test("only the captain's own place is kept in the save, and everywhere else is worked out when it's needed", () => {
  const game = atPlace("meridian");
  clockRuns(game, 5);
  assert.deepEqual(Object.keys(game.life.places), ["meridian"]);
  game.location = "haven";
  game.walk = null;
  game.fleet.at = "haven";
  clockRuns(game, 5);
  assert.deepEqual(Object.keys(game.life.places), ["haven"]);
  assert.ok(JSON.stringify(game.life).length < 5000);
  // The ship's people carry on living while the captain's away, even though nobody's walking them around.
  game.clock.hours = 12.75;
  assert.equal(find(game, "voss").doing, "eating");
  assert.equal(whereNow(game, "voss"), "eating, at the Long Mess, on CFS Meridian");
  // Coming back after a while, they're just where they should be.
  passTime(game, 24);
  game.location = "meridian";
  game.walk = null;
  clockRuns(game, 60);
  assert.deepEqual(Object.keys(game.life.places), ["meridian"]);
  assert.equal(game.life.places.meridian.voss.level, find(game, "voss").level);
});

test("someone in two places' files keeps to each place's own day", () => {
  const atBastion = atPlace("bastion", 8);
  assert.equal(peopleAboard(atBastion, "bastion", "anchorage").find((one) => one.id === "jaska").doing, "inspecting a ship's papers");
  const atVantor = atPlace("vantor", 8);
  assert.equal(peopleAboard(atVantor, "vantor", "yards").find((one) => one.id === "jaska").doing, "checking a manifest");
  clockRuns(atBastion, 30);
  clockRuns(atVantor, 30);
  assert.equal(whereNow(atVantor, "jaska"), "checking a manifest, at the Outer Yards");
  assert.equal(whereNow(atBastion, "jaska"), "inspecting a ship's papers, at the Long Anchorage");
});

test("people go home by a door, and someone gone home can't be found until morning", () => {
  const night = atPlace("haven", 3);
  assert.ok(!peopleThere(night, "haven").some((one) => one.id === "corvane"), "Corvane's gone to his rooms");
  assert.equal(whereNow(night, "corvane"), "somewhere out of sight");
  assert.ok(peopleThere(night, "haven").some((one) => one.id === "sable"), "and the Neutral Ground's still open");
  const leaving = atPlace("haven", 21.9);
  for (let i = 0; i < 240 && !peopleThere(leaving, "haven").some((one) => one.id === "corvane" && one.walking); i += 1) clockRuns(leaving, 1 / 6);
  const walker = peopleThere(leaving, "haven").find((one) => one.id === "corvane" && one.walking);
  assert.ok(walker, "he can be seen on his way");
  clockRuns(leaving, 30);
  assert.ok(!peopleThere(leaving, "haven").some((one) => one.id === "corvane"));
  const day = atPlace("haven", 12.5);
  assert.ok(peopleThere(day, "haven").length > peopleThere(night, "haven").length, "the station's busier by day");
});

test("people sleep in the same place each night, and some never leave their spot at all", () => {
  const bed = (day) => {
    const game = atPlace("bastion", day * 24 + 2);
    const one = peopleThere(game, "bastion").find((person) => person.key === "Lusia");
    return [one.level, one.x, one.y, one.asleep];
  };
  assert.deepEqual(bed(4), bed(5));
  assert.equal(bed(4)[3], true);
  const watcher = (day) => {
    const game = atPlace("foundry", day * 24 + 9);
    const one = peopleThere(game, "foundry").find((person) => person.key === "Watcher Ninety");
    return [one.x, one.y];
  };
  assert.deepEqual(watcher(1), watcher(9));
});

test("each place keeps its own hours", () => {
  const key = (place, hours, who) => peopleThere(atPlace(place, hours), place).find((one) => one.key === who);
  assert.equal(key("ghostlight", 24 + 6.2, "okonkwo").doing, "standing for the anthem");
  assert.equal(key("wheel", 20.2, "Broker Vane").doing, "watching the Wheel spin");
  assert.equal(key("wheel", 20.2, "Broker Vane").level, "great");
  assert.equal(key("maris", 6.2, "lenn").level, "shaft");
  assert.equal(key("asterion", 18.5, "echo").level, "walk");
  assert.equal(key("foundry", 12.1, "Ledger").doing, "voting, by standing in a square");
  assert.equal(key("sarn", 12, "Keeper Ivo").level, "door");
  assert.equal(key("sarn", 24 + 2, "Keeper Mesh").level, "door", "there's always somebody on the stool");
  assert.equal(key("pale_gate", 12, "A Gate Warden").crowd, true);
  assert.equal(key("nest", 12, "cantor").level, "heart");
});

test("a place with a map but no file just keeps its people at their posts, with no clock", () => {
  WORLD_MAPS.elsewhere = WORLD_MAPS.sarn;
  LOCATIONS.elsewhere = LOCATIONS.sarn;
  try {
    const game = newGame();
    game.location = "elsewhere";
    game.walk = null;
    const view = walkView(game);
    assert.equal(view.life, undefined);
    assert.ok(view.people.every((one) => !one.doing));
    assert.ok(view.people.some((one) => one.key === "ouma"));
    const clock = game.clock.hours;
    assert.deepEqual(walkTick(game, { ms: 500, rate: 10 }), { still: true });
    assert.equal(game.clock.hours, clock);
    assert.doesNotThrow(() => passTime(game, 5));
    assert.equal(game.clock.hours, clock + 5);
    assert.deepEqual(game.life.places, {});
  } finally {
    delete WORLD_MAPS.elsewhere;
    delete LOCATIONS.elsewhere;
  }
});

test("a typing mistake in someone's day can't stop the game", () => {
  const file = WORLD_LIFE.sarn;
  const saved = file.people.sefu;
  assert.ok(saved);
  const game = atPlace("sarn");
  clockRuns(game, 1);
  game.life.places.sarn.sefu.goal = { level: "deep", x: 1, y: 1 };
  assert.doesNotThrow(() => clockRuns(game, 60));
});

test("someone asleep has to be woken, and someone working is doing something", () => {
  const game = at(4);
  walkCommand(game, { action: "room", to: "bunks" });
  talkCommand(game, { action: "open", person: "voss" });
  assert.match(game.talk.log[0].text, /Voss is asleep/);
  assert.equal(talkView(game).doing, "asleep");
  assert.match(talkBrief(game).tag, /doing="asleep"/);
  talkCommand(game, { action: "close" });
  const awake = newGame();
  talkCommand(awake, { action: "open", person: "pell" });
  assert.doesNotMatch(awake.talk.log[0].text, /asleep/);
  assert.equal(talkView(awake).doing, "at the helm");
});

test("anyone in the crowd can be walked up to and talked to", () => {
  const game = at(12.75);
  setScene(game, "The Long Mess");
  const someone = walkView(game).people.find((one) => one.crowd);
  const reply = walkCommand(game, { action: "go", to: `person:${someone.key}` });
  assert.equal(reply.arrived.kind, "person");
  talkCommand(game, { action: "open", person: someone.key });
  assert.equal(talkView(game).name, someone.name);
  assert.match(talkBrief(game).tag, new RegExp(`with="${someone.name}"`));
});

test("bumping into someone walking past doesn't start a talk, but bumping into someone standing still does", () => {
  const game = at(12.1);
  setScene(game, "The Long Mess");
  let walker = null;
  for (let i = 0; i < 400 && !walker; i += 1) {
    clockRuns(game, 1 / 6);
    walker = walkView(game).people.find((one) => one.walking && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => canStand(MAP.levels.mess, one.x + dx, one.y + dy)));
  }
  assert.ok(walker, "someone should cross the mess around lunchtime");
  const [dx, dy] = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([x, y]) => canStand(MAP.levels.mess, walker.x + x, walker.y + y));
  Object.assign(walkOf(game), { x: walker.x + dx, y: walker.y + dy });
  const passing = walkCommand(structuredClone(game), { action: "step", dx: -dx, dy: -dy });
  assert.notEqual(passing.arrived?.kind, "person");
  const still = walkView(game).people.find((one) => !one.walking && !one.crowd);
  const [ax, ay] = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([x, y]) => canStand(MAP.levels.mess, still.x + x, still.y + y));
  Object.assign(walkOf(game), { x: still.x + ax, y: still.y + ay });
  assert.equal(walkCommand(game, { action: "step", dx: -ax, dy: -ay }).arrived?.kind, "person");
});

// ---- The story and the people around it ------------------------------------------

test("the game master hears who's nearby and what they're doing, in one short line", () => {
  const game = at(12.75);
  setScene(game, "The Long Mess");
  const line = walkLine(game);
  assert.match(line, /^Map: player at The Long Mess\. Nearby: .*Voss \(eating\)/);
  assert.match(line, /\d+ other people\.$/);
  assert.ok(line.length < 500, line);
  assert.ok(aiSnapshot(game).split("\n").includes(line));
  assert.ok(!/Deckhand|Mess Hand/.test(line), "the crowd's just a number");
});

test("the game master can ask where someone is right now", () => {
  const game = newGame();
  const reply = tool(game, "read_character", { name: "Voss" });
  assert.match(reply.result, /Right now: on the bridge, at the Bridge\./);
  game.clock.hours = 19.75;
  assert.equal(whereNow(game, "tarrow"), "somewhere out of sight");
  assert.equal(whereNow(game, "nobody at all"), null);
  tool(game, "set_scene", { area: "The Long Mess", people: ["pell"] });
  assert.equal(whereNow(game, "pell"), "with the captain");
});

test("people the story brings to the captain stay a while, then go back to their day", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Long Mess", people: ["voss"] });
  const stood = walkView(game).people.find((one) => one.key === "voss");
  assert.equal(stood.doing, undefined, "she's with the captain, whatever her day says");
  assert.deepEqual(walkView(game).overview.rooms.filter((room) => room.people.includes("Voss")).map((room) => room.id), ["mess"], "and she isn't in two places");
  clockRuns(game, 1);
  clockRuns(game, 18);
  assert.deepEqual([walkOf(game).with[0].x, walkOf(game).with[0].y], [stood.x, stood.y]);
  clockRuns(game, 3);
  assert.equal(walkOf(game).with.length, 0);
  const leaving = walkView(game).people.find((one) => one.key === "voss");
  assert.ok(leaving.walking, "she sets off from where she stood");
  assert.ok(Math.abs(leaving.x - stood.x) + Math.abs(leaving.y - stood.y) < 12);
  clockRuns(game, 15);
  assert.ok(standsAt(game, "bridge", "voss"), "and she's back at work");
});

test("the story's own time doesn't send anyone away, and neither does anyone without a day", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Long Mess", people: ["voss", "A Stranger"] });
  passTime(game, 6);
  assert.equal(walkOf(game).with.length, 2, "they spent those hours together");
  clockRuns(game, 21);
  assert.deepEqual(walkOf(game).with.map((one) => one.name), ["A Stranger"], "someone with no day of their own stays until the story moves them");
  assert.ok(everyone(game).some((one) => one.key === "voss"));
});

test("someone from the crowd can be brought along by the story too, and isn't there twice", () => {
  const game = at(12.75);
  setScene(game, "The Long Mess");
  tool(game, "set_scene", { area: "The Long Mess", people: ["Cook Imre"] });
  const marks = walkView(game).people.filter((one) => one.key === "Cook Imre");
  assert.equal(marks.length, 1);
  assert.equal(marks[0].crowd, undefined, "the story has put them beside the captain, so they have a name showing");
  clockRuns(game, 1);
  clockRuns(game, 25);
  assert.equal(walkOf(game).with.length, 0);
  assert.equal(walkView(game).people.filter((one) => one.key === "Cook Imre").length, 1);
  assert.equal(walkView(game).people.find((one) => one.key === "Cook Imre").crowd, true);
});

test("a name that happens to be something built into the language isn't taken for a person", async () => {
  const { findCharacter } = await import("../src/campaign.js");
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) assert.equal(findCharacter(null, name), null, name);
  assert.equal(findCharacter(null, "voss").id, "voss");
  assert.equal(findCharacter(null, "Ilya Voss").id, "voss");
});

test("leaving the room lets the company go back to their day straight away", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Long Mess", people: ["voss"] });
  walkCommand(game, { action: "go", to: "exit:1" });
  clockRuns(game, 1);
  assert.equal(walkOf(game).with.length, 0);
});

test("someone in a room off the map with the captain isn't anywhere else as well", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "Section Fourteen", people: ["voss"] });
  assert.ok(walkView(game).people.some((one) => one.key === "voss"));
  const rooms = walkView(game).overview.rooms;
  assert.ok(!rooms.some((room) => room.people.includes("Voss")));
  clockRuns(game, 60);
  assert.ok(walkView(game).people.some((one) => one.key === "voss"), "she stays until the story or the captain moves on");
});

// ---- The clock, from the screen --------------------------------------------------

test("a tick moves the clock and everyone in it, and nothing else", () => {
  const game = newGame();
  const ai = JSON.stringify(game.ai);
  const story = game.transcript.length;
  const reply = walkTick(game, { ms: 500, rate: 10 });
  assert.equal(reply.here, "bridge");
  assert.ok(reply.people.some((one) => one.key === "voss"));
  assert.ok(Math.abs(game.clock.hours - (8 + 5 / 3600)) < 1e-9, `${game.clock.hours}`);
  for (let i = 0; i < 200; i += 1) walkTick(game, { ms: 500, rate: 60 });
  assert.equal(JSON.stringify(game.ai), ai);
  assert.equal(game.transcript.length, story);
  assert.match(walkLine(game), /^Map: player at /, "the map line doesn't say the captain went anywhere");
});

test("a tick can't be used to skip time, and only runs at the clock's own speeds", () => {
  const game = newGame();
  walkTick(game, { ms: 3600000, rate: 300 });
  assert.ok(game.clock.hours - 8 <= (2 / 60) * 300 / 60 + 1e-9, `${game.clock.hours}`);
  for (const rate of [1, 11, 100000, "10", null, undefined]) assert.throws(() => walkTick(game, { ms: 500, rate }), /speeds/);
  const clock = game.clock.hours;
  walkTick(game, { ms: -5000, rate: 10 });
  assert.equal(game.clock.hours, clock);
  walkTick(game, { ms: "lots", rate: 10 });
  assert.equal(game.clock.hours, clock);
});

test("the clock waits for anything with its own window", () => {
  const cases = {
    talk: (game) => talkCommand(game, { action: "open", person: "voss" }),
    fight: (game) => { game.combat = { id: 1 }; },
    check: (game) => { game.check = { id: 1 }; },
    raid: (game) => { game.fleet.raid = { id: 1 }; },
  };
  for (const [name, start] of Object.entries(cases)) {
    const game = newGame();
    start(game);
    const clock = game.clock.hours;
    assert.deepEqual(walkTick(game, { ms: 500, rate: 10 }), { held: true }, name);
    assert.equal(game.clock.hours, clock, name);
  }
});

// ---- Over the real server -----------------------------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-life-server-"));
let child;
let port;

async function post(route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key" }));
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify({ ...newGame(), clock: { hours: 23.97 } }));
  port = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
  });
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  for (const folder of [serverData, dataDir]) {
    try {
      fs.rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // It's a temporary folder, so it doesn't matter if something is still holding on to it.
    }
  }
});

test("over the real server: the clock ticks small, gets the whole game when the fleet's day turns over, and stops for a talk", async () => {
  const first = await post("/api/tick", { ms: 500, rate: 10 });
  assert.equal(first.status, 200);
  assert.ok(first.clock.hours > 23.97);
  assert.equal(first.clock.label, "Day 1, 23:58");
  assert.equal(first.here, "bridge");
  assert.equal(first.game, undefined, "this is twice a second, so it stays small");
  assert.ok(JSON.stringify(first).length < 5000);

  let reply = first;
  for (let i = 0; i < 40 && !reply.game; i += 1) reply = await post("/api/tick", { ms: 500, rate: 60 });
  assert.ok(reply.game, "the day turned over");
  assert.match(reply.clock.label, /^Day 2, 00:0/);
  assert.equal(reply.game.clock.label, reply.clock.label);

  const bad = await post("/api/tick", { ms: 500, rate: 5000 });
  assert.equal(bad.status, 400);

  const person = reply.people.find((one) => !one.crowd) ?? (await post("/api/walk", { action: "room", to: "mess" })).walk.people[0];
  await post("/api/walk", { action: "go", to: `person:${person.key}` });
  const opened = await post("/api/talk", { action: "open", person: person.key });
  assert.equal(opened.status, 200);
  assert.deepEqual(await post("/api/tick", { ms: 500, rate: 10 }), { status: 200, held: true });
  assert.equal((await post("/api/talk", { action: "close" })).game.talk, null);

  const moved = await post("/api/tick", { ms: 500, rate: 10 });
  assert.ok(moved.clock);
  // A save straight after keeps up with the clock.
  await post("/api/save", { slot: "slot1" });
  assert.equal(JSON.parse(fs.readFileSync(path.join(serverData, "saves", "slot1.json"), "utf8")).clock.hours, moved.clock.hours);
});
