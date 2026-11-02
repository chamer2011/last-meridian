// The walk-around view: each room's level, walking, doors, talking with the clock stopped, the game
// master's set_scene tool, rooms that aren't on a plan, and old saves. None of this calls a real AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, before, beforeEach, test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-walk-"));
process.env.GAME_DATA_DIR = dataDir;

const { SYSTEM_PROMPT, runTurn } = await import("../src/ai.js");
const { findCampaignRoom, saveCampaignCharacter, saveCampaignRoom } = await import("../src/campaign.js");
const { checkCommand } = await import("../src/checks.js");
const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { ITEMS, LOCATIONS } = await import("../src/data.js");
const { fleetCommand, fleetLedger } = await import("../src/fleet.js");
const { migrateGame } = await import("../src/migrate.js");
const { projectDir } = await import("../src/paths.js");
const { aiSnapshot, publicState, rest, travel } = await import("../src/rules.js");
const { rumorsFrom } = await import("../src/story-library.js");
const { TOOL_DEFS, newTurnLimits, runTool } = await import("../src/tools.js");
const { closeTalk, setScene, talkBrief, talkCommand, talkHeard, talkLineOver, talkSaid, walkCommand, walkFromStory, walkLine, walkOf, walkView } = await import("../src/walk.js");
const { ROOM_KINDS, WORLD_MAPS } = await import("../src/world.js");
const { NOTABLES } = await import("../src/character-data.js");
// Whoever could have the chair is only there in a game where the player isn't the captain.
const forAnyGame = (id) => !NOTABLES[id]?.chair;

const newGame = (seed = 21) => {
  const game = createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
  game.transcript.push({ role: "narrator", text: "The story so far." });
  return game;
};
const FILE = WORLD_MAPS.meridian;
const LEVEL_IDS = Object.keys(FILE.levels);
const tool = (game, name, input) => runTool(game, name, input, newTurnLimits());
const spot = (game) => walkView(game).captain;
const person = (game, key) => walkView(game).people.find((one) => one.key === key);
const thing = (game, name) => walkView(game).things.find((one) => one.name === name);
const standOn = (game, x, y) => { Object.assign(walkOf(game), { x, y }); };
const enter = (game, id) => walkCommand(game, { action: "room", to: id }).walk;

// The squares a person, a thing, an exit or a label takes up on a level.
const run = (x, y, length, side = "right") => Array.from({ length }, (_, i) => `${side === "left" ? x - i : x + i},${y}`);
const paved = (view, x, y) => ["floor", "doors"].some((layer) => view.layers[layer][y]?.[x] && view.layers[layer][y][x] !== " ");
const standable = (view) => {
  const cells = [];
  for (let y = 0; y < view.lines; y += 1) {
    for (let x = 0; x < view.cols; x += 1) {
      const taken = [...view.things, ...view.people].some((one) => one.x === x && one.y === y);
      if (paved(view, x, y) && !taken) cells.push({ x, y });
    }
  }
  return cells;
};
function assertNothingOverlaps(view, label) {
  const taken = new Map();
  const claim = (name, squares) => {
    for (const key of squares) {
      assert.ok(!taken.has(key), `${label}: ${name} overlaps ${taken.get(key)} at ${key}`);
      const [x, y] = key.split(",").map(Number);
      assert.ok(x >= 0 && x < view.cols && y >= 0 && y < view.lines, `${label}: ${name} runs off the level at ${key}`);
      taken.set(key, name);
    }
  };
  for (const one of view.labels) claim(one.text, run(one.x, one.y, one.text.length));
  for (const one of view.exits) claim(one.label, run(one.x, one.y, one.label.length + 2, one.side));
  for (const one of view.people.filter((person) => !person.crowd && !person.walking)) claim(one.short, run(one.x, one.y, one.short.length + 2, one.side));
  for (const one of view.things) claim(one.name, run(one.x, one.y, 1));
  // A name can't sit over words on the wall, though a thing can be hung on them.
  view.layers.writing.forEach((row, y) => [...row].forEach((ch, x) => {
    const on = taken.get(`${x},${y}`);
    if (ch !== " ") assert.ok(!on || [...view.things].some((one) => one.name === on), `${label}: ${on} covers the writing at ${x},${y}`);
  }));
  assert.ok(!taken.has(`${view.captain.x},${view.captain.y}`), `${label}: the captain starts on top of ${taken.get(`${view.captain.x},${view.captain.y}`)}`);
}

// ---- The levels ---------------------------------------------------------

test("every room in the place's file has a level, and everyone in it has a post", () => {
  const game = newGame();
  const { gm } = LOCATIONS.meridian;
  for (const district of gm.districts) {
    setScene(game, district.name);
    const view = walkView(game);
    assert.equal(view.offPlan, false, district.name);
    assert.equal(view.here.desc, district.desc, `${district.name} should use the place file's description`);
  }
  const posted = LEVEL_IDS.flatMap((id) => Object.values(FILE.levels[id].people ?? {}).map((one) => one.id)).filter(forAnyGame).sort();
  assert.deepEqual(posted, [...gm.people].sort());
  for (const id of gm.people) assert.ok(LEVEL_IDS.some((level) => enter(structuredClone(game), level).people.some((one) => one.key === id)), `${id} isn't on any level`);
});

test("every item the place's file mentions is in a room, and each room has things in it of its own", () => {
  const items = LEVEL_IDS.flatMap((id) => Object.values(FILE.levels[id].things ?? {})).map((one) => one.item).filter(Boolean).sort();
  assert.deepEqual(items, [...LOCATIONS.meridian.gm.items].sort());
  const seen = new Set();
  for (const id of LEVEL_IDS) {
    const things = Object.values(FILE.levels[id].things ?? {});
    assert.ok(things.length >= 3, `${id} only has ${things.length} things in it`);
    for (const one of things) {
      assert.ok(one.name && one.look && one.use, `${id}: ${one.name}`);
      assert.ok(one.use.startsWith("I "), `${one.name}'s use should read as what the player does`);
      assert.ok(!seen.has(one.name), `${one.name} is in two rooms`);
      seen.add(one.name);
    }
  }
});

test("all the levels are different, and each one looks like its room", () => {
  const levels = LEVEL_IDS.map((id) => FILE.levels[id]);
  assert.ok(levels.length >= 7, "the Bridge, the Mess, Engineering, the Aft Holds, the Bulkhead, the Medbay and the Crawlways");
  assert.equal(new Set(levels.map((one) => `${one.plan[0].length}x${one.plan.length}`)).size, levels.length, "every room has its own size");
  assert.equal(new Set(levels.map((one) => JSON.stringify(one.colors))).size, levels.length, "every room has its own colors");
  for (const one of levels) assert.ok(one.colors.floor && one.colors.walls && one.colors.scenery && one.colors.writing, one.name);
  // Laid over each other, no two rooms have the same walls in the same places.
  const walls = (one) => new Set(one.plan.flatMap((row, y) => [...row].map((ch, x) => (ch === "#" ? `${x},${y}` : null)).filter(Boolean)));
  for (let i = 0; i < levels.length; i += 1) {
    for (let j = i + 1; j < levels.length; j += 1) {
      const [a, b] = [walls(levels[i]), walls(levels[j])];
      const shared = [...a].filter((key) => b.has(key)).length;
      assert.ok(shared / Math.max(a.size, b.size) < 0.6, `${levels[i].name} and ${levels[j].name} have nearly the same walls`);
    }
  }
  // The things each room's known for are drawn into it.
  const art = (id) => FILE.levels[id].plan.join("\n");
  assert.match(art("engineering"), /\*\*\*\*\*/, "the reactor");
  assert.match(art("mess"), /=======================/, "the long tables");
  assert.match(art("bridge"), /\*[^\n]*'/, "stars through the viewport");
  assert.match(art("aft"), /\[\]\[\]\[\]/, "the crates");
  assert.ok(FILE.levels.names.writing.flat().join(" ").includes("OLD PETE"), "names in chalk");
  assert.ok(FILE.levels.crawlways.plan.filter((row) => row.includes("~")).length >= 10, "ducts");
});

test("every letter and every square of a level means something, and its rows line up", () => {
  for (const id of LEVEL_IDS) {
    const level = FILE.levels[id];
    assert.equal(new Set(level.plan.map((row) => row.length)).size, 1, `${id}: the rows should all be the same length`);
    const text = level.plan.join("");
    for (const letter of new Set(text.match(/\p{L}/gu))) assert.ok(level.people?.[letter] || level.things?.[letter], `${id}: ${letter} isn't listed`);
    for (const mark of [...Object.keys(level.people ?? {}), ...Object.keys(level.things ?? {}), ...Object.keys(level.exits ?? {})]) {
      assert.equal(text.split(mark).length - 1, 1, `${id}: ${mark} should be on the plan exactly once`);
    }
    assert.equal(text.split("@").length - 1, 1, `${id}: where does the captain stand?`);
  }
});

test("every square of every level can be walked to, and everyone and everything in it can be reached", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    const cells = standable(view);
    assert.ok(cells.length > 40, id);
    for (const target of cells) {
      const fresh = structuredClone(game);
      const reply = walkCommand(fresh, { action: "go", ...target });
      assert.deepEqual(reply.walk.captain, target, `${id}: can't reach ${target.x},${target.y}`);
    }
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `person:${one.key}` }).arrived?.kind, "person", `${id}: ${one.key}`);
    for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `thing:${one.id}` }).arrived?.kind, "thing", `${id}: ${one.name}`);
    for (const one of view.exits) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `exit:${one.key}` }).arrived?.kind, "exit", `${id}: ${one.label}`);
  }
});

test("in every level, people's names, room names and the ways out don't cover each other", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) assertNothingOverlaps(enter(game, id), id);
});

test("words on a wall can be read, because nothing else is drawn under them", () => {
  const view = enter(newGame(), "mess");
  const row = view.layers.writing[0];
  const at = row.indexOf("SITTINGS");
  assert.ok(at > 0);
  assert.equal(view.layers.walls[0][at], " ");
  assert.equal(view.layers.walls[0][at - 3], "#");
  const gap = at + "SITTINGS:".length;
  assert.equal(row[gap], " ");
  assert.equal(view.layers.walls[0][gap], " ", "and that goes for the gaps between words");
});

test("the deck plan has every room on it, and clicking one goes there", () => {
  const game = newGame();
  const { overview } = walkView(game);
  assert.deepEqual(overview.rooms.map((room) => room.id).sort(), [...LEVEL_IDS].sort());
  assert.equal(overview.rooms.find((room) => room.here).id, "bridge");
  assert.ok(overview.rooms.find((room) => room.id === "bridge").people.includes("Voss"));
  for (const room of overview.rooms) {
    assert.ok(Object.values(overview.floors).includes(room.id), `no floor on the plan is ${room.id}`);
    const view = enter(game, room.id);
    assert.equal(view.here.id, room.id);
    assert.deepEqual(view.captain, walkOf(game).level === room.id ? { x: walkOf(game).x, y: walkOf(game).y } : null);
  }
  assert.throws(() => walkCommand(game, { action: "room", to: "the moon" }), /isn't on the map/);
  assert.throws(() => walkCommand(game, { action: "room", to: "elsewhere:the moon" }), /don't know the way/);
});

// A place someone adds to world/places without drawing it stays in the classic view.
const withUnmappedPlace = (run) => {
  LOCATIONS.nowhere = structuredClone(LOCATIONS.haven);
  try {
    run();
  } finally {
    delete LOCATIONS.nowhere;
  }
};

test("a place with no levels has no walk-around view at all", () => {
  withUnmappedPlace(() => {
    const game = newGame();
    game.location = "nowhere";
    assert.equal(walkView(game), null);
    assert.equal(walkLine(game), null);
    assert.equal(publicState(game).walk, null);
    assert.throws(() => walkCommand(game, { action: "go", x: 1, y: 1 }), /no map/);
  });
});

// ---- Every place ---------------------------------------------------------

const PLACE_IDS = Object.keys(LOCATIONS);
const LEVELS = PLACE_IDS.flatMap((place) => Object.entries(WORLD_MAPS[place]?.levels ?? {}).map(([id, file]) => ({ place, id, file, where: place + "/" + id })));
const at = (place, seed = 21) => {
  const game = newGame(seed);
  game.location = place;
  return game;
};
// Puts the captain in any level at all, whether its door is closed or not.
const inLevel = ({ place, file }) => {
  const game = at(place);
  setScene(game, file.name);
  return game;
};
const plainName = (text) => text.toLowerCase().replace(/\s+/g, " ").replace(/^\s*the /, "").trim();

test("every place in the world has a map, and the captain arrives at its way in", () => {
  assert.ok(PLACE_IDS.length >= 24);
  for (const place of PLACE_IDS) {
    assert.ok(WORLD_MAPS[place], place + " has no map");
    const game = at(place);
    const view = walkView(game);
    assert.equal(view.here.id, WORLD_MAPS[place].start, place);
    assert.equal(view.offPlan, false);
    assert.ok(view.overview.title, place);
    assert.match(walkLine(game), /^Map: player at /);
    assert.doesNotThrow(() => publicState(game));
    assert.equal(game.walk, null, "only looking doesn't change the save");
  }
});

test("every part of every place's file is on its map, with everyone and everything the file mentions", () => {
  for (const place of PLACE_IDS) {
    const { gm } = LOCATIONS[place];
    const file = WORLD_MAPS[place];
    const game = at(place);
    for (const district of gm.districts) {
      setScene(game, district.name);
      assert.equal(walkView(game).offPlan, false, place + ": " + district.name);
    }
    const levels = Object.values(file.levels);
    const posted = levels.flatMap((level) => Object.values(level.people ?? {}).map((one) => one.id)).filter(forAnyGame);
    assert.deepEqual([...posted].sort(), [...gm.people].sort(), place + ": who has a post, and nobody has two");
    const things = levels.flatMap((level) => Object.values(level.things ?? {}));
    for (const item of gm.items) assert.ok(things.some((one) => one.item === item), place + ": " + item + " isn't in any room");
    for (const one of things) {
      if (one.item) assert.ok(ITEMS[one.item], place + ": there's no such item as " + one.item);
      assert.ok(one.name && one.look && one.use, place + ": " + one.name);
      assert.ok(one.use.startsWith("I "), one.name + "'s use should read as what the player does");
    }
    assert.equal(new Set(things.map((one) => one.name)).size, things.length, place + ": each thing has its own name");
  }
});

test("in every level in the game, the rows line up, every letter means something, and it's small enough to read", () => {
  assert.ok(LEVELS.length > 100);
  for (const { where, file } of LEVELS) {
    assert.equal(new Set(file.plan.map((row) => row.length)).size, 1, where + ": the rows should all be the same length");
    assert.ok(file.plan[0].length <= 78 && file.plan.length <= 18, where + " is too big to read");
    const text = file.plan.join("");
    for (const letter of new Set(text.match(/\p{L}/gu))) assert.ok(file.people?.[letter] || file.things?.[letter], where + ": " + letter + " isn't listed");
    for (const mark of [...Object.keys(file.people ?? {}), ...Object.keys(file.things ?? {}), ...Object.keys(file.exits ?? {})]) {
      assert.equal(text.split(mark).length - 1, 1, where + ": " + mark + " should be on the plan exactly once");
    }
    assert.equal(text.split("@").length - 1, 1, where + ": where does the captain stand?");
    assert.ok(file.colors.floor && file.colors.walls && file.colors.scenery && file.colors.writing, where);
  }
});

test("in every level in the game, everything can be walked to, and nothing covers anything else", () => {
  for (const level of LEVELS) {
    const game = inLevel(level);
    const view = walkView(game);
    assert.ok(view.here.desc, level.where + " has nothing for the player to read");
    assertNothingOverlaps(view, level.where);
    // This goes by the drawing, because a floor with words painted on it is still floor.
    const floors = new Set(level.file.floor ?? ".");
    const open = new Set();
    level.file.plan.forEach((row, y) => [...row].forEach((ch, x) => {
      if (floors.has(ch) || ch === "+" || ch === "@" || level.file.people?.[ch]) open.add(x + "," + y);
    }));
    const seen = new Set([view.captain.x + "," + view.captain.y]);
    const queue = [view.captain];
    for (let i = 0; i < queue.length; i += 1) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = (queue[i].x + dx) + "," + (queue[i].y + dy);
        if (open.has(key) && !seen.has(key)) {
          seen.add(key);
          queue.push({ x: queue[i].x + dx, y: queue[i].y + dy });
        }
      }
    }
    assert.equal(seen.size, open.size, level.where + ": some of the floor can't be walked to");
    assert.ok(open.size >= 40, level.where + " is too small to walk around");
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "person:" + one.key }).arrived?.kind, "person", level.where + ": " + one.key);
    for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "thing:" + one.id }).arrived?.kind, "thing", level.where + ": " + one.name);
  }
});

test("in every level in the game, a crowd the story brings along fits in without covering anything", () => {
  const crew = ["voss", "marrow", "pell", "tarrow", "halm", "seven", "tobin", "iven"];
  for (const level of LEVELS) {
    const game = at(level.place);
    const posted = Object.values(level.file.people ?? {}).map((one) => one.id);
    const reply = tool(game, "set_scene", { area: level.file.name, people: crew.filter((one) => !posted.includes(one)) });
    assert.ok(!reply.isError, level.where);
    const view = walkView(game);
    assert.equal(view.here.id, level.id, level.where);
    assertNothingOverlaps(view, level.where + " with a crowd");
    for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: "person:" + one.key }).arrived?.kind, "person", level.where + ": " + one.key);
  }
});

test("every way out in the game leads where it says, and comes back to the door it left by", () => {
  for (const level of LEVELS) {
    const { place, id, file, where } = level;
    assert.ok(Object.keys(file.exits).length > 0, where + " has no way out");
    for (const [key, exit] of Object.entries(file.exits)) {
      const back = WORLD_MAPS[place].levels[exit.to]?.exits?.[exit.via];
      assert.ok(back, where + ": exit " + key + " goes nowhere");
      assert.equal(back.to, id, where + ": exit " + key + " doesn't lead back");
      assert.equal(back.via, key, where + ": exit " + key + " doesn't come back to the same door");
      assert.ok(!(exit.closed && back.closed), where + ": a door closed from both sides would trap the captain");
      if (exit.closed) assert.ok(exit.closed.look && exit.closed.use.startsWith("I "), where + ": exit " + key);
      const game = inLevel(level);
      const reply = walkCommand(game, { action: "go", to: "exit:" + key });
      if (exit.closed && !game.opened[place]?.includes(exit.to)) {
        assert.equal(reply.arrived.kind, "door", where);
        assert.equal(reply.walk.here.id, id, where + ": a closed door doesn't let you through");
      } else {
        assert.equal(reply.walk.here.id, exit.to, where + ": exit " + key);
        const door = reply.walk.exits.find((one) => one.key === exit.via);
        assert.equal(Math.abs(door.x - reply.walk.captain.x) + Math.abs(door.y - reply.walk.captain.y), 1, exit.to + ": you should come out beside the door");
      }
    }
  }
  // The way in never needs the story's help to leave by, wherever the story has put the captain.
  for (const place of PLACE_IDS) {
    const { levels, start } = WORLD_MAPS[place];
    const reach = new Set([start]);
    for (const id of reach) for (const exit of Object.values(levels[id].exits)) reach.add(exit.to);
    assert.equal(reach.size, Object.keys(levels).length, place + ": some rooms can't be reached at all");
  }
});

test("no two rooms in the game are the same, and each place's rooms all look different from each other", () => {
  assert.equal(new Set(LEVELS.map(({ file }) => file.plan.join("\n"))).size, LEVELS.length, "every drawing is its own");
  for (const place of PLACE_IDS) {
    const levels = Object.values(WORLD_MAPS[place].levels);
    assert.equal(new Set(levels.map((one) => one.plan[0].length + "x" + one.plan.length)).size, levels.length, place + ": every room has its own size");
    assert.equal(new Set(levels.map((one) => JSON.stringify(one.colors))).size, levels.length, place + ": every room has its own colors");
    // Laid over each other, no two rooms have what's solid in the same places.
    const solid = (one) => new Set(one.plan.flatMap((row, y) => [...row].map((ch, x) => (ch !== " " && !(one.floor ?? ".").includes(ch) ? x + "," + y : null)).filter(Boolean)));
    for (let i = 0; i < levels.length; i += 1) {
      for (let j = i + 1; j < levels.length; j += 1) {
        const [a, b] = [solid(levels[i]), solid(levels[j])];
        const shared = [...a].filter((key) => b.has(key)).length;
        assert.ok(shared / new Set([...a, ...b]).size < 0.7, place + ": " + levels[i].name + " and " + levels[j].name + " have nearly the same shape");
      }
    }
  }
});

test("the game master can use a room's name or anything else it's called, and no two rooms answer to the same one", () => {
  for (const place of PLACE_IDS) {
    const names = new Map();
    const game = at(place);
    for (const [id, level] of Object.entries(WORLD_MAPS[place].levels)) {
      for (const name of [level.name, ...(level.aliases ?? [])]) {
        assert.ok(!names.has(plainName(name)) || names.get(plainName(name)) === id, place + ": " + name + " could mean " + id + " or " + names.get(plainName(name)));
        names.set(plainName(name), id);
        setScene(game, name);
        assert.equal(walkView(game).here.id, id, place + ": " + name);
        assert.equal(walkView(game).offPlan, false, place + ": " + name);
      }
    }
  }
});

test("every place's map has all of its rooms on it, and clicking one goes there", () => {
  for (const place of PLACE_IDS) {
    const { levels } = WORLD_MAPS[place];
    const { overview } = walkView(at(place));
    assert.deepEqual(overview.rooms.map((room) => room.id).sort(), Object.keys(levels).sort(), place);
    for (const room of overview.rooms) {
      assert.ok(Object.values(overview.floors).includes(room.id), place + ": no floor on the map is " + room.id);
      assert.ok(room.x + room.text.length <= overview.cols && room.y < overview.lines, place + ": " + room.text + " runs off the map");
      assert.ok(overview.layers.floor.join("").includes(Object.keys(overview.floors).find((ch) => overview.floors[ch] === room.id)), place + ": " + room.id + "'s floor isn't drawn");
      if (room.closed) {
        assert.throws(() => walkCommand(at(place), { action: "room", to: room.id }), /closed door/, place + ": " + room.id);
        assert.deepEqual(room.people, [], place + ": nobody can see who's behind a closed door");
      } else {
        assert.equal(walkCommand(at(place), { action: "room", to: room.id }).walk.here.id, room.id, place);
      }
    }
  }
});

test("a closed door can be walked up to, but only the story can open it", () => {
  const game = at("foundry");
  const door = walkView(game).exits.find((exit) => exit.closed);
  assert.ok(door.look && door.use.startsWith("I "));
  assert.equal(door.glyph, "x");
  const before1 = structuredClone(game);
  const reply = walkCommand(game, { action: "go", to: "exit:" + door.key });
  assert.deepEqual(reply.arrived, { kind: "door", key: door.key });
  assert.equal(reply.walk.here.id, "gate", "still outside");
  const stood = reply.walk.captain;
  assert.equal(Math.abs(door.x - stood.x) + Math.abs(door.y - stood.y), 1);
  assert.deepEqual({ ...game, walk: null }, { ...before1, walk: null }, "walking up to it changes nothing else");
  // Walking into it with the arrow keys is the same.
  const dx = Math.sign(door.x - stood.x);
  const dy = Math.sign(door.y - stood.y);
  const bump = walkCommand(game, { action: "step", dx, dy });
  assert.deepEqual(bump.arrived, { kind: "door", key: door.key });
  assert.deepEqual(bump.path, []);
  // And nobody gets round it from the map of the place.
  assert.throws(() => walkCommand(game, { action: "room", to: "floor" }), /closed door/);
  assert.throws(() => walkCommand(game, { action: "room", to: "rack" }), /closed door/, "what's behind it is closed too");
  const shut = walkView(game).overview.rooms;
  assert.equal(shut.find((room) => room.id === "floor").closed, true);
  assert.deepEqual(shut.find((room) => room.id === "floor").people, []);
  assert.equal(shut.find((room) => room.id === "gate").closed, false);

  // The story takes the captain through.
  assert.ok(!tool(game, "set_scene", { area: "The Assembly Floor" }).isError);
  assert.equal(walkView(game).here.id, "floor");
  assert.deepEqual(game.opened.foundry, ["floor"]);
  const open = walkView(game).overview.rooms;
  assert.equal(open.find((room) => room.id === "rack").closed, false, "what was behind it is open now");
  assert.equal(open.find((room) => room.id === "sublevels").closed, true, "and the next closed door is still closed");
  // From then on it's free in both directions.
  const out = walkCommand(game, { action: "go", to: "exit:1" });
  assert.equal(out.walk.here.id, "gate");
  assert.equal(out.walk.exits.find((exit) => exit.key === door.key).closed, undefined);
  assert.equal(out.walk.exits.find((exit) => exit.key === door.key).glyph, ">");
  assert.equal(walkCommand(game, { action: "go", to: "exit:" + door.key }).walk.here.id, "floor");
});

test("a door the story has opened stays open after leaving and coming back, and each place keeps its own", () => {
  const game = at("wheel");
  game.ship.fuel = 12;
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "velvet").closed, true);
  setScene(game, "The Velvet Deck");
  travel(game, "cinder");
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "stack").closed, true, "a door somewhere else is still closed");
  travel(game, "wheel");
  assert.equal(walkView(game).here.id, "docks", "you arrive at the way in again");
  assert.equal(walkView(game).overview.rooms.find((room) => room.id === "velvet").closed, false);
  assert.deepEqual(JSON.parse(JSON.stringify(game)).opened, { wheel: ["velvet"] }, "it's in the save");
});

test("the Meridian has no closed doors, because it's your ship", () => {
  for (const level of Object.values(WORLD_MAPS.meridian.levels)) for (const exit of Object.values(level.exits)) assert.equal(exit.closed, undefined);
});

test("a talk somewhere else works just the same, with that place's own rumors", () => {
  const game = at("haven");
  setScene(game, "The Neutral Ground");
  assert.match(walkLine(game), /^Map: player at The Neutral Ground\. Nearby: Sable \(polishing a glass\)(, \d+ other (person|people))?\.$/);
  talkCommand(game, { action: "open", person: "sable" });
  const talk = publicState(game).talk;
  assert.equal(talk.where, "The Neutral Ground");
  assert.ok(talk.asks.includes("What's the word on the station, Sable?"), "their own things to ask come first");
  assert.ok(talk.asks.includes("What should I know that I don't?"), "and then what anyone could be asked");
  talkCommand(game, { action: "rumor" });
  const said = publicState(game).talk.log.at(-1).text;
  assert.ok(LOCATIONS.haven.rumors.some((rumor) => said.includes(rumor.replaceAll('"', "'"))), "it's one of Haven's");
  closeTalk(game);
  assert.match(game.transcript.at(-1).text, /^\[TALK\] You talked with .* at the Neutral Ground\.$/);
});

test("someone who isn't really standing there says so when you come over", () => {
  const game = at("asterion");
  setScene(game, "The Exchange");
  talkCommand(game, { action: "open", person: "echo" });
  assert.match(publicState(game).talk.log[0].text, /^A cord slides home/);
  assert.match(publicState(game).talk.log[0].text, /Echo is already on the line/);
});

test("two places can each have a room of the same name, and each keeps its own", () => {
  const game = newGame();
  game.campaign = "walk-two-back-rooms";
  tool(game, "set_scene", { area: "The Back Room", kind: "cabin" });
  game.location = "haven";
  game.walk = null;
  assert.deepEqual(walkView(game).overview.elsewhere, [], "the Meridian's isn't listed at Haven");
  tool(game, "set_scene", { area: "The Back Room", kind: "hold" });
  assert.equal(walkOf(game).room.kind, "hold");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "meridian").kind, "cabin");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "haven").kind, "hold");
  assert.deepEqual(walkView(game).overview.elsewhere, [{ name: "The Back Room", here: true }]);
  game.location = "meridian";
  game.walk = null;
  tool(game, "set_scene", { area: "The Back Room" });
  assert.equal(walkOf(game).room.kind, "cabin");
  assert.equal(findCampaignRoom(game.campaign, "The Back Room", "sarn"), null);
});

test("somewhere the story makes up at another place gets a room too, with a way back to where the captain was", () => {
  const game = at("kessara");
  game.campaign = "walk-made-up-at-kessara";
  setScene(game, "The Warrens");
  tool(game, "set_scene", { area: "Rook's Back Office", kind: "cabin", people: ["tannis"] });
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.deepEqual(view.people.map((one) => one.key), ["tannis"]);
  assert.match(walkLine(game), /^Map: player off the map, at Rook's Back Office\. With: /);
  assert.equal(findCampaignRoom(game.campaign, "Rook's Back Office", "kessara").place, "kessara");
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.here.id, "warrens");
});

// ---- Walking ------------------------------------------------------------

test("clicking a floor spot walks the shortest way there, one square at a time", () => {
  const game = newGame();
  const from = spot(game);
  const target = { x: from.x + 3, y: from.y - 1 };
  const reply = walkCommand(game, { action: "go", ...target });
  assert.deepEqual(reply.walk.captain, target);
  assert.equal(reply.path.length, 4, "in an open room, the way is exactly as long as it looks");
  let at = from;
  for (const step of reply.path) {
    assert.equal(Math.abs(step.x - at.x) + Math.abs(step.y - at.y), 1, "every step is one square");
    at = step;
  }
});

test("in every level, the way never goes through walls or things, and it really is the shortest", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    const open = new Set(standable(view).map((one) => `${one.x},${one.y}`));
    // Breadth-first over the same level, written separately, to check the answer.
    const distance = (a, b) => {
      const seen = new Set([`${a.x},${a.y}`]);
      let edge = [a];
      for (let steps = 0; edge.length; steps += 1) {
        const next = [];
        for (const here of edge) {
          if (here.x === b.x && here.y === b.y) return steps;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const key = `${here.x + dx},${here.y + dy}`;
            if (!seen.has(key) && open.has(key)) {
              seen.add(key);
              next.push({ x: here.x + dx, y: here.y + dy });
            }
          }
        }
        edge = next;
      }
      return null;
    };
    const cells = [...open].map((key) => key.split(",").map(Number)).map(([x, y]) => ({ x, y }));
    for (let i = 0; i < 12; i += 1) {
      const a = cells[(i * 37) % cells.length];
      const b = cells[(i * 53 + 11) % cells.length];
      standOn(game, a.x, a.y);
      const reply = walkCommand(game, { action: "go", ...b });
      assert.deepEqual(reply.walk.captain, b);
      assert.equal(reply.path.length, distance(a, b), `${id}: ${a.x},${a.y} to ${b.x},${b.y}`);
      for (const step of reply.path) assert.ok(open.has(`${step.x},${step.y}`), `${id}: walked through something at ${step.x},${step.y}`);
    }
  }
});

test("a click on a wall walks to the nearest floor, and a click out in space does nothing", () => {
  const game = newGame();
  const reply = walkCommand(game, { action: "go", x: 42, y: 11 });
  assert.ok(reply.path.length > 0);
  assert.ok(Math.abs(reply.walk.captain.x - 42) + Math.abs(reply.walk.captain.y - 11) <= 3);
  const before1 = spot(game);
  const space = walkCommand(game, { action: "go", x: 0, y: 0 });
  assert.deepEqual(space.path, []);
  assert.deepEqual(spot(game), before1);
  assert.match(space.message, /can't walk/);
});

test("the arrow keys move one square, stop at walls, and walking into someone means talking to them", () => {
  const game = newGame();
  const voss = person(game, "voss");
  standOn(game, voss.x - 1, voss.y);
  const start = spot(game);
  const up = walkCommand(game, { action: "step", dx: -1, dy: 0 });
  assert.deepEqual(up.walk.captain, { x: start.x - 1, y: start.y });
  walkCommand(game, { action: "step", dx: 1, dy: 0 });
  const bump = walkCommand(game, { action: "step", dx: 1, dy: 0 });
  assert.deepEqual(bump.path, []);
  assert.deepEqual(bump.arrived, { kind: "person", key: "voss" });
  assert.deepEqual(spot(game), start, "bumping into someone doesn't move you");
  standOn(game, 2, 9);
  const wall = walkCommand(game, { action: "step", dx: -1, dy: 0 });
  assert.deepEqual(wall.path, []);
  assert.deepEqual(wall.walk.captain, { x: 2, y: 9 });
  const chair = thing(game, "The captain's chair");
  standOn(game, chair.x, chair.y + 1);
  assert.equal(walkCommand(game, { action: "step", dx: 0, dy: -1 }).arrived.kind, "thing");
});

test("clicking someone walks up beside them, and clicking a thing does the same", () => {
  const game = newGame();
  enter(game, "engineering");
  const marrow = person(game, "marrow");
  const reply = walkCommand(game, { action: "go", to: "person:marrow" });
  assert.deepEqual(reply.arrived, { kind: "person", key: "marrow" });
  assert.equal(Math.abs(reply.walk.captain.x - marrow.x) + Math.abs(reply.walk.captain.y - marrow.y), 1);
  const gauges = thing(game, "Reactor gauges");
  const again = walkCommand(game, { action: "go", to: `thing:${gauges.id}` });
  assert.equal(again.arrived.kind, "thing");
  assert.equal(Math.abs(again.walk.captain.x - gauges.x) + Math.abs(again.walk.captain.y - gauges.y), 1);
});

test("a click partway through a walk carries on from wherever the captain has got to", () => {
  const game = newGame();
  const first = walkCommand(game, { action: "go", x: 10, y: 14 });
  const midway = first.path[5];
  const reply = walkCommand(game, { action: "go", x: midway.x, y: midway.y - 1, from: midway });
  assert.equal(reply.path.length, 1);
  // Somewhere that makes no sense is ignored.
  const fine = walkCommand(game, { action: "go", x: 25, y: 14, from: { x: 0, y: 0 } });
  assert.deepEqual(fine.walk.captain, { x: 25, y: 14 });
});

test("every way out leads where it says, and comes back to the door it left by", () => {
  const game = newGame();
  for (const id of LEVEL_IDS) {
    const { exits } = enter(game, id);
    assert.ok(exits.length > 0, `${id} has no way out`);
    for (const exit of exits) {
      enter(game, id);
      const spec = FILE.levels[id].exits[exit.key];
      const out = walkCommand(game, { action: "go", to: `exit:${exit.key}` });
      assert.equal(out.arrived.kind, "exit");
      assert.equal(out.walk.here.id, spec.to, `${id} exit ${exit.key}`);
      const door = out.walk.exits.find((one) => one.key === spec.via);
      assert.ok(door, `${spec.to} has no exit ${spec.via}`);
      assert.equal(FILE.levels[spec.to].exits[spec.via].to, id, `${spec.to} exit ${spec.via} should lead back to ${id}`);
      assert.equal(FILE.levels[spec.to].exits[spec.via].via, exit.key, `${spec.to} exit ${spec.via} should come out at exit ${exit.key}`);
      assert.equal(Math.abs(door.x - out.walk.captain.x) + Math.abs(door.y - out.walk.captain.y), 1, `${spec.to}: you should come out beside the door`);
      const back = walkCommand(game, { action: "go", to: `exit:${spec.via}` });
      assert.equal(back.walk.here.id, id);
    }
  }
});

test("walking through a door with the arrow keys works too, and the path is still in the room being left", () => {
  const game = newGame();
  const { exits } = walkView(game);
  const door = exits.find((one) => one.key === "1");
  standOn(game, door.x, door.y - 1);
  const through = walkCommand(game, { action: "step", dx: 0, dy: 1 });
  assert.equal(through.arrived.kind, "exit");
  assert.equal(through.walk.here.id, "names");
  assert.match(walkLine(game), /walked to The Names Bulkhead/);
});

test("walking changes nothing but where the captain is: not the clock, not the fleet, not the AI", () => {
  const game = newGame();
  game.clock.hours = 23;
  game.fleet.day = 0;
  const before1 = structuredClone(game);
  for (const id of LEVEL_IDS) {
    const view = enter(game, id);
    for (const exit of view.exits) walkCommand(structuredClone(game), { action: "go", to: `exit:${exit.key}` });
    for (let i = 0; i < 20; i += 1) walkCommand(game, { action: "step", dx: i % 2 ? 1 : -1, dy: 0 });
    walkCommand(game, { action: "go", to: `exit:${view.exits[0].key}` });
  }
  const { walk: _walk, ...rest1 } = game;
  const { walk: _before, ...rest2 } = before1;
  assert.deepEqual(rest1, rest2);
  assert.equal(game.clock.hours, 23);
});

test("showing the game changes nothing in the save", () => {
  const game = newGame();
  const before1 = structuredClone(game);
  publicState(game);
  aiSnapshot(game);
  assert.deepEqual(game, before1);
});

test("nobody who's dead or gone stands at their post", () => {
  const game = newGame();
  game.contacts.find((contact) => contact.name === "Ilya Voss").status = "dead";
  assert.equal(person(game, "voss"), undefined);
  assert.ok(person(game, "pell"));
});

// ---- The game master's tool ---------------------------------------------

test("set_scene moves the captain to a room, by its name or anything else people call it", () => {
  const game = newGame();
  for (const [name, level] of [["The Long Mess", "mess"], ["the mess", "mess"], ["BRIDGE", "bridge"], ["Engineering and the Aft Holds", "engineering"], ["the aft hold", "aft"], ["The Crawlways", "crawlways"], ["medbay", "medbay"], ["The Names Bulkhead", "names"]]) {
    const { result, isError } = tool(game, "set_scene", { area: name });
    assert.ok(!isError, result);
    assert.equal(walkView(game).here.id, level, name);
    assert.equal(walkView(game).offPlan, false);
    assert.deepEqual(spot(game), walkOf(game) && { x: walkOf(game).x, y: walkOf(game).y });
  }
  assert.ok(TOOL_DEFS.some((def) => def.name === "set_scene"));
});

test("set_scene puts who's present beside the captain, and everyone else goes back to their post", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Long Mess", people: ["Commander Voss", "marrow"] });
  const voss = person(game, "voss");
  assert.ok(voss, "she's here now");
  assert.ok(person(game, "marrow"), "and so is he");
  assert.equal(voss.short, "Voss", "she goes by the same name wherever she is");
  for (const one of [voss, person(game, "marrow")]) {
    assert.equal(walkView(game).layers.doors[one.y][one.x], " ", `${one.key} is standing in a doorway`);
    for (let i = 0; i < one.short.length + 2; i += 1) assert.notEqual(walkView(game).layers.walls[one.y][one.x + i], "#", `${one.key}'s name runs over a wall`);
  }
  assert.equal(enter(structuredClone(game), "bridge").people.filter((one) => one.key === "voss").length, 0, "she isn't in two places");
  tool(game, "set_scene", { area: "The Long Mess" });
  assert.equal(person(game, "voss"), undefined);
  assert.ok(enter(structuredClone(game), "bridge").people.some((one) => one.key === "voss"), "she's back at her post");
  // They end up clear of anyone else's name, and of the captain, wherever it is.
  for (const id of LEVEL_IDS) {
    const name = FILE.levels[id].name;
    tool(game, "set_scene", { area: name, people: ["voss", "marrow", "pell", "tarrow", "halm", "seven", "tobin", "iven"].filter((one) => !Object.values(FILE.levels[id].people ?? {}).some((home) => home.id === one)) });
    assertNothingOverlaps(walkView(game), name);
  }
});

test("set_scene checks what it's given", () => {
  const game = newGame();
  assert.ok(tool(game, "set_scene", {}).isError);
  assert.ok(tool(game, "set_scene", { area: "" }).isError);
  assert.ok(tool(game, "set_scene", { area: 7 }).isError);
  assert.ok(tool(game, "set_scene", { area: "x".repeat(61) }).isError);
  assert.ok(tool(game, "set_scene", { area: "The Bridge", people: "Voss" }).isError);
  assert.ok(tool(game, "set_scene", { area: "The Bridge", people: ["x".repeat(61)] }).isError);
  assert.ok(tool(game, "set_scene", { area: "Somewhere", kind: "a kind that doesn't exist" }).isError);
  assert.ok(tool(game, "set_scene", { area: "Somewhere", things: [{ name: "No description" }] }).isError);
  const crowd = Array.from({ length: 12 }, (_, i) => `Deckhand ${i}`);
  assert.ok(!tool(game, "set_scene", { area: "A crowded hatchway", people: crowd }).isError);
  assert.equal(walkView(game).people.length, 8);
  // The captain isn't standing next to themselves.
  tool(game, "set_scene", { area: "The Bridge", people: [game.name] });
  assert.ok(!walkView(game).people.some((one) => one.key === game.name));
});

// ---- Rooms that aren't on a plan ----------------------------------------

test("every kind of room can hold eight people with long names, and everything in it can be reached", () => {
  const names = Array.from({ length: 8 }, (_, i) => `Longer Name ${i}xx`.slice(0, 14));
  for (const kind of Object.keys(ROOM_KINDS)) {
    for (const place of ["The Quiet Room", "The Other Room", "Number Three", "Somewhere Else", "A Fifth Place", "Room Six"]) {
      const game = newGame();
      tool(game, "set_scene", { area: place, people: names, kind });
      const view = walkView(game);
      assert.equal(view.offPlan, true);
      assert.equal(view.people.length, 8, `${kind}: everyone should fit`);
      assertNothingOverlaps(view, `${kind}, ${place}`);
      assert.equal(view.exits.length, 1, `${kind} needs a way out`);
      assert.equal(view.things.length, 4, `${kind} should have things in it`);
      for (const cell of standable(view)) assert.deepEqual(walkCommand(structuredClone(game), { action: "go", ...cell }).walk.captain, cell, `${kind}: can't reach ${cell.x},${cell.y}`);
      for (const one of view.people) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `person:${one.key}` }).arrived?.kind, "person", `${kind}: ${one.key}`);
      for (const one of view.things) assert.equal(walkCommand(structuredClone(game), { action: "go", to: `thing:${one.id}` }).arrived?.kind, "thing", `${kind}: ${one.name}`);
      assert.equal(walkCommand(structuredClone(game), { action: "go", to: `exit:${view.exits[0].key}` }).walk.offPlan, false, `${kind}: the way out should lead back`);
    }
  }
});

test("the kinds of room are all different from each other, and each has its own things", () => {
  const kinds = Object.values(ROOM_KINDS);
  assert.ok(kinds.length >= 12);
  assert.equal(new Set(kinds.map((kind) => kind.layouts[0].plan.join("\n"))).size, kinds.length);
  assert.equal(new Set(kinds.flatMap((kind) => kind.things.map((one) => one.name))).size, kinds.flatMap((kind) => kind.things).length);
  for (const kind of kinds) {
    assert.ok(kind.things.length >= 4);
    for (const one of kind.things) assert.ok(one.name && one.look);
    for (const layout of kind.layouts) assert.equal(new Set(layout.plan.map((row) => row.length)).size, 1, "the rows should line up");
  }
});

test("somewhere that isn't on the plan looks like what it is, never like a wrong map", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "Frame Thirty", people: ["voss"], kind: "ducts" });
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Frame Thirty");
  assert.deepEqual(view.people.map((one) => one.key), ["voss"]);
  assert.equal(view.labels[0].text, "FRAME THIRTY");
  assert.ok(view.layers.floor.join("").includes("~"), "ducts have a duct's floor");
  assert.ok(!JSON.stringify(view.things).includes("captain's chair"));
  // Nearly the name of a room on the plan isn't that room.
  tool(game, "set_scene", { area: "The Bridge of the Ember Day" });
  assert.equal(walkView(game).offPlan, true);
  tool(game, "set_scene", { area: "The Bridge" });
  assert.equal(walkView(game).offPlan, false);
});

test("with nothing said about a room, the game goes by its name and what the codex says about it", () => {
  const game = newGame();
  const kindOf = () => walkOf(game).room.kind;
  for (const [name, kind] of [["The Brig", "cells"], ["Hangar Two", "hangar"], ["Father Roe's Chapel", "chapel"], ["Her Quarters", "cabin"], ["The Cannon Deck", "gundeck"], ["The Hydroponics Ward", "garden"], ["Somewhere Nobody's Named", "plain"]]) {
    tool(game, "set_scene", { area: name });
    assert.equal(kindOf(), kind, name);
  }
  game.lore.push({ id: "custom:0", name: "The Warren", kind: "place", text: "A block of ductwork and dead space deep in the crawlways." });
  tool(game, "set_scene", { area: "The Warren" });
  assert.equal(kindOf(), "ducts");
  assert.match(walkView(game).here.desc, /ductwork/, "the codex says what it is");
});

test("the things the game master says are in a room are there to look at, and using one goes to the story", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "The Old Galley", kind: "workshop", things: [{ name: "A cracked oven", look: "It hasn't been lit since the Fall." }, { name: "Someone's apron", look: "Folded, with a name sewn into it." }] });
  const view = walkView(game);
  const oven = view.things.find((one) => one.name === "A cracked oven");
  assert.equal(oven.look, "It hasn't been lit since the Fall.");
  assert.match(oven.use, /^I go over to A cracked oven/);
  assert.equal(view.things.length, 4, "the room's usual things fill in the rest");
  assert.equal(walkCommand(game, { action: "go", to: `thing:${oven.id}` }).arrived.kind, "thing");
  const tooMany = Array.from({ length: 9 }, (_, i) => ({ name: `Thing ${i}`, look: "It's there." }));
  tool(game, "set_scene", { area: "A Busy Room", things: tooMany });
  assert.equal(walkOf(game).room.things.length, 4);
});

test("a room stays the way it was first described, for good, and can be gone back to from the deck plan", () => {
  const game = newGame();
  game.campaign = "walk-rooms-for-good";
  tool(game, "set_scene", { area: "The Old Galley", kind: "workshop", people: ["voss"], things: [{ name: "A cracked oven", look: "It hasn't been lit since the Fall." }] });
  const saved = findCampaignRoom(game.campaign, "the old galley");
  assert.equal(saved.kind, "workshop");
  assert.equal(saved.place, "meridian");
  assert.deepEqual(saved.regulars, ["voss"]);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "campaigns", "walk-rooms-for-good", "rooms", "old-galley.json"), "utf8"));
  assert.equal(onDisk.things[0].name, "A cracked oven");

  walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(walkView(game).offPlan, false);
  const elsewhere = walkView(game).overview.elsewhere;
  assert.deepEqual(elsewhere, [{ name: "The Old Galley", here: false }]);
  const back = walkCommand(game, { action: "room", to: "elsewhere:The Old Galley" }).walk;
  assert.equal(back.offPlan, true);
  assert.equal(back.here.name, "The Old Galley");
  assert.ok(back.things.some((one) => one.name === "A cracked oven"));
  assert.deepEqual(back.people.map((one) => one.key), ["voss"]);
  assert.match(walkLine(game), /off the map, at The Old Galley/);

  // Coming back in the story, with nothing more said, it's the same room.
  walkCommand(game, { action: "go", to: "exit:0" });
  tool(game, "set_scene", { area: "the old galley" });
  assert.equal(walkOf(game).room.kind, "workshop");
  assert.ok(walkView(game).things.some((one) => one.name === "A cracked oven"));
  assert.deepEqual(walkView(game).people.map((one) => one.key), ["voss"], "whoever's usually there");
});

test("a campaign's room file can have its own drawing, with people and things where they belong", () => {
  const game = newGame();
  game.campaign = "walk-own-drawing";
  saveCampaignRoom(game.campaign, {
    name: "The Long Gallery",
    place: "meridian",
    kind: "ducts",
    desc: "A dead-space gallery between two frames.",
    floor: ".",
    colors: { floor: "#123456" },
    label: [2, 1],
    exitTo: "crawlways",
    exitLabel: "The Cold Elbow",
    regulars: ["voss", "the children"],
    spots: { "the children": "2", voss: "1" },
    plan: [
      "##############################",
      "#............................#",
      "0.........................b..#",
      "#..@..1.......................#".slice(0, 30),
      "#............................#",
      "#.....2..................a...#",
      "##############################",
    ],
    writing: [[12, 0, "NOBODY GETS LEFT"]],
    things: [{ spot: "a", name: "The painted laws", look: "Careful letters.", use: "I read the laws." }],
  });
  tool(game, "set_scene", { area: "The Long Gallery" });
  const view = walkView(game);
  assert.equal(view.here.desc, "A dead-space gallery between two frames.");
  assert.equal(view.colors.floor, "#123456");
  assert.deepEqual(view.captain, { x: 3, y: 3 });
  assert.deepEqual(person(game, "voss") && [person(game, "voss").x, person(game, "voss").y], [6, 3], "she has her own spot");
  assert.deepEqual([person(game, "the children").x, person(game, "the children").y], [6, 5]);
  assert.deepEqual(view.things.map((one) => one.name), ["The painted laws"], "only what's in its file");
  assert.equal(view.things[0].use, "I read the laws.");
  assert.equal(view.exits[0].label, "The Cold Elbow");
  assert.equal(view.layers.writing[0].slice(12, 28), "NOBODY GETS LEFT");
  assertNothingOverlaps(view, "The Long Gallery");
  assert.equal(walkCommand(game, { action: "go", to: "exit:0" }).walk.here.id, "crawlways", "its way out goes where the file says");
});

test("the captain can walk around a room like that, and get back out by clicking", () => {
  const game = newGame();
  const before1 = spot(game);
  tool(game, "set_scene", { area: "Frame Thirty", people: ["voss", "Someone without a file"], kind: "plain" });
  const open = standable(walkView(game));
  const reply = walkCommand(game, { action: "go", ...open[10] });
  assert.deepEqual(reply.walk.captain, open[10]);
  const talkTo = walkCommand(game, { action: "go", to: "person:Someone without a file" });
  assert.equal(talkTo.arrived.key, "Someone without a file");
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.offPlan, false);
  assert.deepEqual(back.walk.captain, before1, "back where they were");
  assert.match(walkLine(game), /walked to The Bridge/);
});

test("the state has one compact line about where the captain is, which only changes with the room", () => {
  const game = newGame();
  const first = walkLine(game);
  assert.equal(first, "Map: player at The Bridge. Nearby: Voss (on the bridge), Pell (at the helm), Sorel (on comms), Vey (in the sensor pit).");
  assert.ok(aiSnapshot(game).split("\n").includes(first));
  walkCommand(game, { action: "go", x: 10, y: 14 });
  assert.equal(walkLine(game), first, "walking around the same room isn't news");
  walkCommand(game, { action: "go", to: "exit:1" });
  assert.match(walkLine(game), /^Map: player walked to The Names Bulkhead\. Nearby: Roe \(sitting with the names\)(, \d+ other (person|people))?\.$/);
  assert.ok(walkLine(game).length < 200);
  tool(game, "set_scene", { area: "Section Fourteen", people: ["voss"] });
  assert.equal(walkLine(game), "Map: player off the map, at Section Fourteen. With: Ilya Voss.");
  // Somewhere without levels has no line at all, so it costs nothing.
  withUnmappedPlace(() => {
    game.location = "nowhere";
    assert.ok(!aiSnapshot(game).includes("Map: player"));
    assert.match(setScene(game, "The Soup Line"), /no map/);
  });
});

test("leaving and coming back starts from the way in, even from somewhere off the plan", () => {
  const game = newGame();
  tool(game, "set_scene", { area: "Section Fourteen" });
  const first = travel(game, "sundial");
  assert.ok(first.message);
  assert.equal(walkView(game).here.id, "furrow", "wherever they go, they arrive at its way in");
  travel(game, "meridian");
  const view = walkView(game);
  assert.equal(view.offPlan, false);
  assert.equal(view.here.id, "bridge");
});

// ---- The player's own campaign: somewhere the AI invented ----------------

function sectionFourteen(campaign = "walk-test-campaign") {
  const game = newGame(40);
  game.campaign = campaign;
  for (const [name, role, archetype] of [["Dot Harrow", "Doctor of the Downstairs Crew, age ten", "civilian"], ["Tobiah Wren", "Chief engineer of the Downstairs Crew, age nine", "engineer"]]) {
    saveCampaignCharacter(game.campaign, { name, pronouns: "they/them", role, public: role, personality: "Serious.", voice: "Exact.", archetype, threat: 1 });
  }
  game.contacts.push({ id: "dot-harrow", name: "Dot Harrow", attitude: "wary", note: "Held the line." });
  game.lore.push({ id: "custom:0", name: "Section Fourteen", kind: "place", text: "A block of ductwork and dead space deep in the Meridian's crawlways." });
  game.transcript = [
    { role: "narrator", text: 'You climb down from the bridge.\n\n@Naomi Cass: "Mind your head."' },
    { role: "narrator", text: '@Dot Harrow: "I\'m handling it."\n\n@Tobiah Wren: "Knocking is for doors."\n\nThe children laugh, and it\'s the first sound in Section Fourteen that doesn\'t sound frightened.\n\n> Sign the treaty\n> Go up to the bridge meeting' },
  ];
  return game;
}

test("Section Fourteen, with its children who aren't in any file of the world, gets a room of its own", () => {
  const game = sectionFourteen();
  const reply = tool(game, "set_scene", { area: "Section Fourteen", people: ["Dot Harrow", "Tobiah", "Naomi Cass", "the children"] });
  assert.ok(!reply.isError, reply.result);
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Section Fourteen");
  assert.equal(walkOf(game).room.kind, "ducts", "the codex says it's ductwork");
  assert.deepEqual(view.people.map((one) => one.short), ["Dot Harrow", "Tobiah Wren", "Naomi Cass", "the children"]);
  assertNothingOverlaps(view, "Section Fourteen");
  assert.doesNotThrow(() => publicState(game));
});

test("someone from Section Fourteen can be talked to, with their own art and how they feel", () => {
  const game = sectionFourteen();
  tool(game, "set_scene", { area: "Section Fourteen", people: ["Dot Harrow", "Tobiah Wren", "the children"] });
  talkCommand(game, { action: "open", person: "dot-harrow" });
  const dot = publicState(game).talk;
  assert.equal(dot.name, "Dot Harrow");
  assert.equal(dot.attitude, "wary");
  assert.equal(dot.where, "Section Fourteen");
  assert.ok(dot.art.join("\n").includes("|oo)"));
  closeTalk(game);
  talkCommand(game, { action: "open", person: "tobiah-wren" });
  assert.equal(publicState(game).talk.attitude, null, "no contact yet means they haven't met");
  assert.ok(publicState(game).talk.art.join("\n").includes("[|oo)"), "Tobiah's an engineer, and looks like one");
  closeTalk(game);
  // Nobody with a file is still somebody you can talk to.
  talkCommand(game, { action: "open", person: "the children" });
  const crowd = publicState(game).talk;
  assert.equal(crowd.name, "the children");
  assert.equal(crowd.role, null);
  assert.ok(crowd.art.length > 0);
});

// ---- Talking: everything that doesn't need the AI -----------------------

test("opening and closing a talk costs nothing, and a talk where nothing was said leaves no note", () => {
  const game = newGame();
  const lines = game.transcript.length;
  talkCommand(game, { action: "open", person: "voss" });
  const view = publicState(game).talk;
  assert.equal(view.name, "Commander Ilya Voss");
  assert.equal(view.where, "The Bridge");
  assert.ok(view.asks.length >= 2);
  assert.ok(view.asks.includes("What's our real situation, Commander?"), "her own things to ask come first");
  assert.equal(view.log[0].role, "aside");
  assert.throws(() => talkCommand(game, { action: "open", person: "pell" }), /Finish the talk/);
  talkCommand(game, { action: "close" });
  assert.equal(game.talk, null);
  assert.equal(game.transcript.length, lines);
  assert.equal(publicState(game).talk, null);
});

test("you can't talk to someone who isn't here, or before the story has started", () => {
  const game = newGame();
  assert.throws(() => talkCommand(game, { action: "open", person: "Someone Else" }), /aren't here/);
  assert.throws(() => talkCommand(game, { action: "open", person: "marrow" }), /aren't here/, "he's in Engineering");
  tool(game, "set_scene", { area: "Frame Thirty", people: ["marrow"] });
  assert.throws(() => talkCommand(game, { action: "open", person: "voss" }), /aren't here/);
  const fresh = createGameFromDraft(randomDraft({ seed: 4, archetype: "officer" }));
  assert.throws(() => talkCommand(fresh, { action: "open", person: "voss" }), /Start the story/);
});

test("rumors come from the place's file for free, and nobody gossips about themselves", () => {
  const game = newGame();
  const all = LOCATIONS.meridian.rumors;
  for (const name of ["Voss", "Marrow", "Pell"]) {
    const told = rumorsFrom(game, name.toLowerCase(), [name]);
    assert.ok(told.length > 0);
    for (const rumor of told) {
      assert.ok(all.includes(rumor));
      assert.ok(!rumor.includes(name), `${name} shouldn't be saying: ${rumor}`);
    }
  }
  talkCommand(game, { action: "open", person: "voss" });
  const count = publicState(game).talk.rumors;
  assert.ok(count > 0);
  talkCommand(game, { action: "rumor" });
  const view = publicState(game).talk;
  assert.equal(view.rumors, count - 1);
  assert.equal(view.log.at(-1).role, "narrator");
  assert.match(view.log.at(-1).text, /^@Commander Ilya Voss: "/);
  assert.equal(view.lastReply, null, "only what the AI said can offer choices");
  while (publicState(game).talk.rumors > 0) talkCommand(game, { action: "rumor" });
  assert.throws(() => talkCommand(game, { action: "rumor" }), /all they've heard/);
  assert.equal(game.ai.messages.length, 0, "nothing went to the AI");
});

test("closing a talk leaves one line in the story, and what was said is kept with it", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "How are you holding up?");
  talkHeard(game, '@Commander Ilya Voss: "Nine minutes, Captain." She doesn\'t look up.\n\n> Ask what happens in nine minutes\n> Let it go');
  talkHeard(game, "[RELATION] Ilya Voss: neutral -> wary", "notice");
  closeTalk(game);
  const note = game.transcript.at(-1);
  assert.equal(note.role, "notice");
  assert.ok(!note.text.includes("\n"), "it's one line");
  assert.match(note.text, /^\[TALK\] You talked with Commander Ilya Voss at the Bridge\. Last word: "Nine minutes, Captain\."$/);
  assert.deepEqual(note.talk.map((line) => line.role), ["player", "narrator"]);
  assert.ok(!note.talk[1].text.includes(">"), "the choices don't need keeping");
  // A rumor passed along isn't anybody's last word.
  talkCommand(game, { action: "open", person: "pell" });
  talkCommand(game, { action: "rumor" });
  closeTalk(game);
  assert.match(game.transcript.at(-1).text, /^\[TALK\] You talked with Ensign Pell Asante at the Bridge\.$/);
});

test("a choice with a check on it, offered in a talk, opens the check's window and ends the talk", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Tell me about the Tarn.");
  talkHeard(game, '@Commander Ilya Voss: "No."\n\n> [persuasion:hard:voss] Press her on it\n> Let it go');
  assert.throws(() => talkCommand(game, { action: "check", label: "Something she never offered" }), /on offer/);
  assert.equal(game.check, null);
  talkCommand(game, { action: "check", label: "Press her on it" });
  assert.equal(game.talk, null);
  assert.equal(game.check.skill, "persuasion");
  assert.equal(game.check.source, "choice");
  assert.equal(game.check.audience, "voss");
  const hours = game.clock.hours;
  checkCommand(game, "run");
  assert.equal(game.clock.hours, hours);
  assert.equal(game.pendingEvents.length, 1);
});

test("a fight or a check that starts during a talk takes over from it", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Stand down, Commander.");
  tool(game, "start_combat", { enemy: "dock_thug", lead_in: "It goes badly." });
  talkLineOver(game);
  assert.equal(game.talk, null);
  assert.ok(game.combat);
});

test("something the captain is already carrying can't be used again, and everything else can", () => {
  const game = newGame();
  enter(game, "mess");
  assert.equal(thing(game, "Ration crate").have, false);
  game.inventory.ration_pack = 1;
  assert.equal(thing(game, "Ration crate").have, true);
  assert.equal(thing(game, "Soup kettle").have, false);
});

// ---- A stand-in for Anthropic's API, to check what actually gets sent ---

let server;
let requests = [];
let replies = [];

function respond(res, body, reply) {
  if (reply.status) {
    res.writeHead(reply.status, { "content-type": "application/json" });
    res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: reply.message } }));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } });
  reply.blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: reply.stop ?? "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  send("message_stop", {});
  res.end();
}

before(async () => {
  server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    respond(res, body, replies.shift() ?? { blocks: [{ type: "text", text: '@Someone: "Nothing more."' }] });
  });
  await new Promise((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  delete process.env.ANTHROPIC_BASE_URL;
  server.closeAllConnections();
  server.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

beforeEach(() => {
  requests = [];
  replies = [];
});

const settings = { provider: "claude", model: "claude-opus-5-5", apiKey: "test-key-not-real" };
const lastMessageText = () => {
  const { content } = requests.at(-1).messages.at(-1);
  return typeof content === "string" ? content : content.map((part) => part.text ?? part.content ?? "").join("\n");
};
const allToolResults = (game) => game.ai.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).filter((block) => block.type === "tool_result");
const saySomething = async (game, text, reply) => {
  if (reply) replies.push(...[reply].flat());
  const talk = talkBrief(game);
  talkSaid(game, text);
  const narration = await runTurn({ game, settings, playerText: text, talk, emit: () => {} });
  talkHeard(game, narration);
  return narration;
};

test("a line in a talk goes through the normal turn, with its tag, and the same instructions and tools", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  const normal = requests.at(-1);
  talkCommand(game, { action: "open", person: "voss" });
  const reply = await saySomething(game, "How are you holding up?", { blocks: [{ type: "text", text: '@Commander Ilya Voss: "Fine."\n\n> Ask again\n> Leave it' }] });
  assert.match(reply, /Fine/);
  const request = requests.at(-1);
  assert.match(lastMessageText(), /<talk with="Commander Ilya Voss" at="The Bridge" doing="on the bridge">Answer only as them, in one to three sentences, then 2 or 3 short > choices\.<\/talk>/);
  assert.match(lastMessageText(), /The player writes: How are you holding up\?/);
  // The instructions and tools can't change for a talk, or Claude would have to reload the whole story, line by line.
  assert.equal(request.system, normal.system);
  assert.deepEqual(request.tools, normal.tools);
  assert.deepEqual(request.cache_control, normal.cache_control);
  assert.match(SYSTEM_PROMPT, /<talk> tag/);
  assert.match(SYSTEM_PROMPT, /one to three sentences/);
});

test("taking a choice the person offered goes back with its tags", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "Report.", { blocks: [{ type: "text", text: '@Commander Ilya Voss: "Fine."\n\n> [mercy] Tell her to rest\n> Leave it' }] });
  await saySomething(game, "Tell her to rest");
  assert.match(lastMessageText(), /takes this choice from your last message: > \[mercy\] Tell her to rest/);
});

test("the AI can't move the clock from inside a talk, so a talk can never use up a fleet day", async () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  game.clock.hours = 23;
  game.fleet.day = 0;
  const food = game.fleet.food;
  const pursuit = game.fleet.pursuit;
  const fatigue = game.needs.fatigue;
  const hours = game.clock.hours;
  for (let i = 0; i < 5; i += 1) {
    await saySomething(game, `Line ${i}`, [
      { blocks: [{ type: "tool_use", id: `t${i}a`, name: "pass_time", input: { hours: 24, activity: "active", reason: "A long talk" } }, { type: "tool_use", id: `t${i}b`, name: "travel", input: { destination: "haven" } }, { type: "tool_use", id: `t${i}c`, name: "set_scene", input: { area: "The Long Mess" } }], stop: "tool_use" },
      { blocks: [{ type: "text", text: '@Commander Ilya Voss: "No."' }] },
    ]);
  }
  assert.equal(game.clock.hours, hours);
  assert.equal(game.fleet.day, 0);
  assert.equal(game.fleet.food, food);
  assert.equal(game.fleet.pursuit, pursuit);
  assert.equal(game.needs.fatigue, fatigue);
  assert.equal(game.location, "meridian");
  assert.equal(walkView(game).here.id, "bridge");
  const results = allToolResults(game);
  assert.equal(results.length, 15);
  for (const result of results) {
    assert.equal(result.is_error, true);
    assert.match(result.content, /clock is stopped/);
  }
});

test("the same tools still work in the story, outside a talk", async () => {
  const game = newGame();
  game.clock.hours = 10;
  replies = [
    { blocks: [{ type: "tool_use", id: "t1", name: "pass_time", input: { hours: 2, activity: "active", reason: "A long talk" } }, { type: "tool_use", id: "t2", name: "set_scene", input: { area: "The Long Mess", people: ["voss"] } }], stop: "tool_use" },
    { blocks: [{ type: "text", text: "Later, in the mess." }] },
  ];
  await runTurn({ game, settings, playerText: "We head to the mess.", emit: () => {} });
  assert.equal(game.clock.hours, 12);
  assert.equal(walkView(game).here.id, "mess");
  assert.ok(person(game, "voss"));
  for (const result of allToolResults(game)) assert.ok(!result.is_error, result.content);
});

test("everything else the AI can do still works in a talk, within the same limits", async () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "I trust you.", [
    { blocks: [{ type: "tool_use", id: "t1", name: "note_contact", input: { name: "Ilya Voss", attitude: "friendly", note: "Trusted her." } }], stop: "tool_use" },
    { blocks: [{ type: "text", text: '@Commander Ilya Voss: "Noted."' }] },
  ]);
  assert.equal(publicState(game).talk.attitude, "friendly");
});

test("the person's file goes out the first time they're talked to, and only then", async () => {
  const game = newGame();
  game.ai.sentCharacters = ["pell"];
  game.ai.messages = [{ role: "user", content: "Earlier." }, { role: "assistant", content: [{ type: "text", text: "Earlier." }] }];
  game.ai.provider = "claude";
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "Report.", { blocks: [{ type: "text", text: '@Commander Ilya Voss: "Ask Tarrow."' }] });
  assert.match(lastMessageText(), /<character_files>[\s\S]*Ilya Voss/);
  // Someone the person only mentions doesn't add to the bill. Someone the player asks about does.
  await saySomething(game, "Anything else?");
  assert.ok(!lastMessageText().includes("<character_files>"));
  await saySomething(game, "What about Marrow?");
  assert.match(lastMessageText(), /<character_files>[\s\S]*Dunn Marrow/);
});

test("however long a talk goes on, no line of it brings on the whole state", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  game.ai.stateAge = 11;
  talkCommand(game, { action: "open", person: "voss" });
  for (let i = 0; i < 20; i += 1) {
    await saySomething(game, `Line ${i}`);
    assert.ok(!lastMessageText().includes("Attributes:"), `line ${i} sent the whole state`);
    assert.equal(game.ai.stateAge, 11);
  }
  closeTalk(game);
  await runTurn({ game, settings, playerText: "I go on.", emit: () => {} });
  assert.equal(game.ai.stateAge, 12);
  await runTurn({ game, settings, playerText: "And on.", emit: () => {} });
  assert.match(lastMessageText(), /Attributes:/);
});

test("news about the fleet waits until the talk's over, instead of being wasted on a line of small talk", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  game.fleet.unheard.push({ about: "food", text: "The fleet is out of food." });
  game.story.lastNews = null;
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "Report.");
  assert.ok(!lastMessageText().includes("<fleet_report>"));
  assert.ok(!lastMessageText().includes("<fleet_news>"));
  assert.equal(game.fleet.unheard.length, 1);
  closeTalk(game);
  await runTurn({ game, settings, playerText: "I go on.", emit: () => {} });
  assert.match(lastMessageText(), /<fleet_report>/);
});

test("a talk costs very little beyond the line itself", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "Report.");
  await saySomething(game, "Anything else?");
  const message = lastMessageText();
  assert.ok(!message.includes("Map: player"), "standing still doesn't resend the line");
  assert.ok(message.length < 300, `a quiet line sends only ${message.length} characters`);
});

test("walking within a room adds nothing to the next message, and changing rooms adds one short line", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  walkCommand(game, { action: "go", x: 10, y: 14 });
  await runTurn({ game, settings, playerText: "Still looking.", emit: () => {} });
  assert.match(lastMessageText(), /Nothing has changed since your last update/);
  walkCommand(game, { action: "go", to: "exit:1" });
  await runTurn({ game, settings, playerText: "What's this?", emit: () => {} });
  assert.match(lastMessageText(), /Map: player walked to The Names Bulkhead/);
});

test("the game master can describe a new room as it goes there, and the map shows it at once", async () => {
  const game = newGame();
  game.campaign = "walk-described-room";
  const states = [];
  replies = [
    { blocks: [{ type: "tool_use", id: "t1", name: "set_scene", input: { area: "The Cannon Deck", kind: "gundeck", people: ["voss"], things: [{ name: "A fresh scorch mark", look: "It wasn't there yesterday." }] } }], stop: "tool_use" },
    { blocks: [{ type: "text", text: "You climb up to the guns." }] },
  ];
  await runTurn({ game, settings, playerText: "I go up to the cannon deck.", emit: (e) => { if (e.type === "state") states.push(walkView(game).here.name); } });
  assert.deepEqual(states, ["The Cannon Deck"], "the room's there before the story's finished arriving");
  assert.ok(walkView(game).things.some((one) => one.name === "A fresh scorch mark"));
  assert.match(allToolResults(game)[0].content, /off the map, at The Cannon Deck, in a room of the kind "gundeck", with Ilya Voss/);
  assert.equal(findCampaignRoom(game.campaign, "The Cannon Deck").kind, "gundeck");
  assert.match(requests[0].tools.find((def) => def.name === "set_scene").description, /walk-around map/);
  assert.match(SYSTEM_PROMPT, /keeps it for good/);
});

test("if the AI's memory restarts, a finished talk is in the record, and so is the one still going", async () => {
  const game = newGame();
  await runTurn({ game, settings, playerText: "I look around.", emit: () => {} });
  talkCommand(game, { action: "open", person: "voss" });
  await saySomething(game, "What happened to the Tarn?", { blocks: [{ type: "text", text: '@Commander Ilya Voss: "Nothing I can talk about."' }] });
  closeTalk(game);
  talkCommand(game, { action: "open", person: "pell" });
  await saySomething(game, "Who taught you to fly?", { blocks: [{ type: "text", text: '@Ensign Pell Asante: "A cargo hauler."' }] });
  // Switching provider is one of the things that restarts it from the record.
  game.ai.provider = "something-else";
  await saySomething(game, "And after that?");
  const message = lastMessageText();
  assert.match(message, /A TALK IN ITS OWN WINDOW: Player: What happened to the Tarn\? @Commander Ilya Voss: "Nothing I can talk about\."/);
  assert.match(message, /Said in this talk so far: Captain: Who taught you to fly\?/);
});

test("the Fleet menu and sleep can't move the clock during a talk", () => {
  // The server refuses these. This says why: both of them really would use up time.
  const game = newGame();
  const hours = game.clock.hours;
  fleetCommand(game, { action: "wait", days: 1 });
  assert.ok(game.clock.hours > hours);
  rest(game);
  assert.ok(fleetLedger(game));
});

// ---- Old saves ----------------------------------------------------------

const oldSave = (game = newGame(), version = 7) => {
  const save = JSON.parse(JSON.stringify({ ...game, version }));
  if (version < 8) {
    delete save.walk;
    delete save.talk;
  }
  if (version < 10) delete save.opened;
  return save;
};

test("a save from before there was any map loads, with the captain in a room", () => {
  const game = migrateGame(oldSave());
  assert.equal(game.version, 14);
  assert.equal(game.talk, null);
  assert.equal(game.walk.place, "meridian");
  assert.equal(walkView(game).here.id, "bridge");
  assert.doesNotThrow(() => publicState(game));
  assert.match(aiSnapshot(game), /Map: player at The Bridge/);
});

test("loading a save twice changes nothing the second time", () => {
  const once = migrateGame(oldSave());
  const twice = migrateGame(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
});

test("the captain starts wherever the latest scene says they are", () => {
  const onPlan = newGame();
  onPlan.transcript = [{ role: "narrator", text: 'You push through to the Long Mess. @Odessa Brandt: "Ask in writing."\n\n@Odessa Brandt: "I mean it."' }];
  const game = migrateGame(oldSave(onPlan));
  assert.equal(walkView(game).here.id, "mess");
  assert.equal(walkView(game).offPlan, false);
  assert.ok(person(game, "odessa"), "she's on her level");
  const aft = newGame();
  aft.transcript = [{ role: "narrator", text: "Marrow takes you past engineering, down to the aft hold." }];
  assert.equal(walkView(migrateGame(oldSave(aft))).here.id, "aft");
});

test("a save in the middle of Section Fourteen opens there, with the people from the scene, and not on a wrong map", () => {
  const game = migrateGame(oldSave(sectionFourteen("walk-test-from-story")));
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(view.here.name, "Section Fourteen");
  assert.equal(walkOf(game).room.kind, "ducts");
  assert.deepEqual(view.people.map((one) => one.short).sort(), ["Dot Harrow", "Naomi Cass", "Tobiah Wren"]);
  assert.match(aiSnapshot(game), /Map: player off the map, at Section Fourteen\. With: .*Dot Harrow/);
  // The story's choices are still on offer, and walking back out is one click.
  const back = walkCommand(game, { action: "go", to: "exit:0" });
  assert.equal(back.walk.offPlan, false);
});

test("a save from when the ship was one plan keeps the captain in the same room", () => {
  for (const [x, y, level] of [[17, 9, "bridge"], [40, 5, "mess"], [40, 10, "names"], [28, 14, "medbay"], [60, 5, "engineering"], [60, 15, "aft"], [50, 12, "crawlways"], [0, 0, "bridge"]]) {
    const old = oldSave(newGame(), 8);
    old.walk = { place: "meridian", x, y, walked: false, with: [{ id: "voss", name: "Ilya Voss", x: 41, y: 5 }], room: null };
    const game = migrateGame(old);
    assert.equal(game.version, 14);
    assert.equal(walkOf(game).level, level, `${x},${y}`);
    assert.deepEqual(walkOf(game).with, [], "everyone's back at their posts");
    assert.equal(walkView(game).offPlan, false);
    assert.doesNotThrow(() => publicState(game));
  }
});

test("a save from when Section Fourteen was a plain room comes back to it, drawn properly", () => {
  const base = sectionFourteen("walk-test-plain-room");
  const old = oldSave(base, 8);
  old.walk = { place: "meridian", x: 17, y: 9, walked: false, with: [], room: { name: "Section Fourteen", x: 24, y: 7, people: [{ id: "dot-harrow", name: "Dot Harrow" }, { id: null, name: "the children" }] } };
  const game = migrateGame(old);
  const view = walkView(game);
  assert.equal(view.offPlan, true);
  assert.equal(walkOf(game).room.kind, "ducts");
  assert.deepEqual(view.people.map((one) => one.key), ["dot-harrow", "the children"]);
  assert.ok(standable(view).some((cell) => cell.x === view.captain.x && cell.y === view.captain.y), "the captain's somewhere they can stand");
  assert.equal(walkOf(game).level, "bridge");
});

test("a save somewhere else opens wherever its latest scene says, from any older version", () => {
  for (const version of [7, 8, 9]) {
    const away = newGame();
    away.location = "haven";
    away.transcript = [{ role: "narrator", text: 'You push through the door of the Neutral Ground.\n\n@Jun Sable: "Weapons in the rack."' }];
    const game = migrateGame(oldSave(away, version));
    assert.equal(game.version, 14);
    assert.equal(walkView(game).here.id, "bar", `from version ${version}`);
    assert.ok(person(game, "sable"), "whoever's in the scene is there");
    assert.doesNotThrow(() => publicState(game));
    assert.equal(walkFromStory(game).level, "bar");
  }
  // With nothing to go on, the captain's at the way in.
  const plain = newGame();
  plain.location = "sarn";
  plain.transcript = [{ role: "narrator", text: "Nothing in particular happens." }];
  assert.equal(walkView(migrateGame(oldSave(plain, 9))).here.id, "deposit");
  // A scene that's already behind a closed door has opened it.
  const inside = newGame();
  inside.location = "wheel";
  inside.transcript = [{ role: "narrator", text: "She receives you on the Velvet Deck, without getting up." }];
  const game = migrateGame(oldSave(inside, 9));
  assert.equal(walkView(game).here.id, "velvet");
  assert.deepEqual(game.opened.wheel, ["velvet"]);
});

test("a save that's already got a place keeps it, and gains an empty list of opened doors", () => {
  const game = newGame();
  walkCommand(game, { action: "go", to: "exit:1" });
  const loaded = migrateGame(oldSave(game, 9));
  assert.equal(walkView(loaded).here.id, "names");
  assert.deepEqual(loaded.opened, {});
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(loaded))), loaded);
});

test("a save from any older version gets here too", () => {
  const save = oldSave();
  save.version = 6;
  delete save.fleet;
  const game = migrateGame(save);
  assert.equal(game.version, 14);
  assert.ok(game.fleet);
  assert.doesNotThrow(() => publicState(game));
  assert.equal(newGame().version, 14);
});

test("a save made while talking carries on talking", () => {
  const game = newGame();
  talkCommand(game, { action: "open", person: "voss" });
  talkSaid(game, "Report.");
  const loaded = migrateGame(JSON.parse(JSON.stringify(game)));
  assert.equal(publicState(loaded).talk.name, "Commander Ilya Voss");
  assert.equal(publicState(loaded).talk.log.at(-1).text, "Report.");
});

// ---- The real server, over its real routes --------------------------------

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-walk-server-"));
let child;
let port;

async function post(route, body = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  // A line in a talk streams its reply a line at a time.
  if (res.headers.get("content-type")?.includes("ndjson")) return { status: res.status, lines: text.split("\n").filter(Boolean).map((line) => JSON.parse(line)) };
  return { status: res.status, ...JSON.parse(text) };
}

before(async () => {
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify(settings));
  const save = oldSave();
  save.pendingEvents = [];
  fs.writeFileSync(path.join(serverData, "saves", "autosave.json"), JSON.stringify(save));
  // A port nobody's using: this asks the system for one, and lets it go again.
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
  try {
    fs.rmSync(serverData, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

test("over the real server: walking, talking and closing never move the clock, and the save keeps up", async () => {
  const start = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const hours = start.game.clock.hours;
  assert.equal(start.game.walk.here.id, "bridge");

  const walked = await post("/api/walk", { action: "go", to: "exit:1" });
  assert.equal(walked.status, 200);
  assert.equal(walked.walk.here.id, "names");
  assert.ok(walked.path.length > 0);
  assert.equal(walked.game, undefined, "walking gets a small reply, not the whole game");

  const toRoe = await post("/api/walk", { action: "go", to: "person:bastian" });
  assert.deepEqual(toRoe.arrived, { kind: "person", key: "bastian" });

  const opened = await post("/api/talk", { action: "open", person: "bastian" });
  assert.equal(opened.game.talk.short, "Roe");

  // While a talk is open, anything that could move the clock waits.
  for (const [route, body] of [["/api/fleet", { action: "wait", days: 1 }], ["/api/fleet", { action: "evade" }], ["/api/action", { action: "rest" }], ["/api/sim", { enemy: "dock_thug" }], ["/api/walk", { action: "go", x: 50, y: 2 }], ["/api/check/start", { practice: "persuasion" }]]) {
    const refused = await post(route, body);
    assert.equal(refused.status, 400, route);
    assert.match(refused.error, /talk first/);
  }

  replies = [
    { blocks: [{ type: "tool_use", id: "s1", name: "pass_time", input: { hours: 30, activity: "active", reason: "A long talk" } }], stop: "tool_use" },
    { blocks: [{ type: "text", text: '@Father Bastian Roe: "Weak tea and strong doubts."\n\n> Ask about the doubts' }] },
  ];
  const line = await post("/api/talk", { action: "say", text: "How are people holding up, Father?" });
  assert.equal(line.status, 200);
  const done = line.lines.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.state.clock.hours, hours);
  assert.equal(done.state.talk.lastReply.includes("Weak tea"), true);
  assert.ok(line.lines.some((entry) => entry.type === "text"));
  assert.ok(!done.state.transcript.some((entry) => entry.text?.includes("Weak tea")), "what's said stays in its window");

  const rumor = await post("/api/talk", { action: "rumor" });
  assert.equal(rumor.game.talk.log.at(-1).role, "narrator");
  assert.ok(rumor.game.clock.hours === hours);

  // A rumor goes along with the next line, so the game master knows it was said.
  replies = [{ blocks: [{ type: "text", text: '@Father Bastian Roe: "People say a lot of things."' }] }];
  await post("/api/talk", { action: "say", text: "Do you believe that?" });
  assert.match(lastMessageText(), /they also passed on what people are saying/);

  const closed = await post("/api/talk", { action: "close" });
  assert.equal(closed.game.talk, null);
  assert.equal(closed.game.clock.hours, hours);
  const note = closed.game.transcript.at(-1);
  assert.match(note.text, /^\[TALK\] You talked with Father Bastian Roe at the Names Bulkhead/);
  const notes = closed.game.transcript.filter((entry) => entry.text.startsWith("[TALK]"));
  assert.equal(notes.length, 1);

  const onDisk = JSON.parse(fs.readFileSync(path.join(serverData, "saves", "autosave.json"), "utf8"));
  assert.equal(onDisk.version, 14);
  assert.equal(onDisk.talk, null);
  assert.equal(onDisk.clock.hours, hours);
});

test("over the real server: a failed AI call puts everything back, including what was said", async () => {
  await post("/api/talk", { action: "open", person: "bastian" });
  const before1 = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  replies = [{ status: 400, message: "Something went wrong at the other end." }];
  const line = await post("/api/talk", { action: "say", text: "This won't get through." });
  const failed = line.lines.at(-1);
  assert.equal(failed.type, "error");
  assert.deepEqual(failed.state.talk.log, before1.game.talk.log);
  assert.equal(failed.state.clock.hours, before1.game.clock.hours);
  await post("/api/talk", { action: "close" });
});

test("over the real server: typing an action still goes to the story, and closes any talk that's open", async () => {
  await post("/api/talk", { action: "open", person: "bastian" });
  replies = [{ blocks: [{ type: "text", text: "You leave him to it.\n\n> Go on" }] }];
  const turn = await post("/api/chat", { text: "I head back to the bridge." });
  const done = turn.lines.at(-1);
  assert.equal(done.type, "done");
  assert.equal(done.state.talk, null);
  assert.equal(done.state.transcript.at(-1).text, "You leave him to it.\n\n> Go on");
  assert.equal(done.state.transcript.at(-2).text, "I head back to the bridge.");
});

test("over the real server: during a fight, a check or a raid, nobody walks or talks", async () => {
  const practice = await post("/api/check/start", { practice: "persuasion" });
  assert.equal(practice.status, 200);
  assert.match((await post("/api/walk", { action: "go", x: 41, y: 2 })).error, /check first/);
  assert.match((await post("/api/talk", { action: "open", person: "bastian" })).error, /check first/);
  await post("/api/check", { command: "run" });
  const sim = await post("/api/sim", { enemy: "dock_thug" });
  assert.equal(sim.status, 200);
  assert.match((await post("/api/walk", { action: "go", x: 41, y: 2 })).error, /fight first/);
  assert.match((await post("/api/talk", { action: "open", person: "bastian" })).error, /fight first/);
});
