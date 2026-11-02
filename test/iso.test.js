// The isometric view works out what's on each square, and how high it stands, before it draws anything,
// so every room in the world can be checked here without a screen.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { CELL_WIDTH, FLOOR_COLORS, WALL_COLORS, buildScene, cellAt, cellCentre, project } from "../public/iso.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { runTool, newTurnLimits } from "../src/tools.js";
import { lookOf, mapFor, walkView } from "../src/walk.js";
import { LOOKS, WORLD_MAPS } from "../src/world.js";

const viewOf = (level) => ({ cols: level.width, lines: level.height, layers: level.layers, labels: level.labels, colors: level.colors, things: level.things, exits: level.exits, people: [], here: { id: level.id } });
const everyLevel = () => Object.keys(WORLD_MAPS).flatMap((place) => Object.values(mapFor(place)?.levels ?? {}).map((level) => ({ place, level })));
const sceneOf = (place, id) => buildScene(viewOf(mapFor(place).levels[id]));
const firstLevel = (place, name) => Object.values(mapFor(place).levels).find((level) => level.name === name);

test("there's a level for every room, and every one of them can be worked out", () => {
  const levels = everyLevel();
  assert.ok(levels.length >= 121, `${levels.length} levels`);
  for (const { place, level } of levels) {
    const where = `${place}/${level.id}`;
    const scene = buildScene(viewOf(level));
    assert.ok(scene.ground.length > 0, where);
    for (const value of Object.values(scene.bounds)) assert.ok(Number.isFinite(value), where);
    assert.ok(scene.bounds.maxU > scene.bounds.minU && scene.bounds.maxV > scene.bounds.minV, where);
    for (const color of Object.values(scene.colors)) assert.match(color, /^#[0-9a-fA-F]{6}$/, where);
    // Painted from the back of the room to the front.
    for (let i = 1; i < scene.blocks.length; i += 1) assert.ok(scene.blocks[i].depth >= scene.blocks[i - 1].depth, where);
    for (const block of scene.blocks) assert.ok(block.h > 0 && block.style, where);
  }
});

test("everywhere you can walk has floor under it, and nothing standing on it", () => {
  for (const { place, level } of everyLevel()) {
    const scene = buildScene(viewOf(level));
    level.open.forEach((row, y) => row.forEach((open, x) => {
      if (!open) return;
      const where = `${place}/${level.id} ${x},${y}`;
      assert.ok(["floor", "door"].includes(scene.kinds[y][x]), `${where} is ${scene.kinds[y][x]}`);
      assert.equal(scene.heights[y][x], 0, where);
    }));
    for (const thing of level.things) assert.equal(scene.kinds[thing.y][thing.x], "thing");
    for (const exit of level.exits) assert.equal(scene.kinds[exit.y][exit.x], "exit");
    for (const exit of level.exits) assert.equal(scene.heights[exit.y][exit.x], 0, `${place}/${level.id}: a way out has to be a gap`);
  }
});

test("a wall between the camera and the room is cut down, so that nobody on the floor is hidden by one", () => {
  for (const { place, level } of everyLevel()) {
    const scene = buildScene(viewOf(level));
    const tall = (x, y) => scene.kinds[y]?.[x] === "wall" && scene.heights[y][x] > 1;
    level.open.forEach((row, y) => row.forEach((open, x) => {
      if (open) assert.ok(!tall(x, y + 1) && !tall(x + 1, y) && !tall(x + 1, y + 1), `${place}/${level.id} ${x},${y}`);
    }));
  }
  // And the walls at the back of the room stand up.
  const docks = sceneOf("haven", firstLevel("haven", "The Manifest Docks").id);
  assert.ok(docks.heights[0][1] > 1);
  assert.ok(docks.heights.at(-1)[1] < 0.5);
});

test("a click lands on the square it's over, anywhere in any room", () => {
  for (const { level } of everyLevel().filter((_, i) => i % 5 === 0)) {
    for (let y = 0; y < level.height; y += 1) {
      for (let x = 0; x < level.width; x += 1) {
        const { wx, wy } = cellCentre(x, y);
        const { u, v } = project(wx, wy);
        assert.deepEqual(cellAt(u, v), { x, y });
      }
    }
  }
  // A square's corners are half a tile across, and a whole tile along.
  assert.equal(CELL_WIDTH, 0.5);
  assert.deepEqual(cellAt(...Object.values(project(0.26, 0.5))), { x: 0, y: 0 });
  assert.deepEqual(cellAt(...Object.values(project(0.76, 1.5))), { x: 1, y: 1 });
});

test("words go where they were painted: along a wall, or on top of what they're on", () => {
  const docks = sceneOf("haven", firstLevel("haven", "The Manifest Docks").id);
  const sign = docks.runs.find((run) => run.text.startsWith("DOCKING BY THE HOUR"));
  assert.equal(sign.on, "wall");
  for (let i = 0; i < sign.length; i += 1) assert.equal(docks.kinds[sign.y][sign.x + i], "wall", "no holes in the wall where the words are");
  const cradles = sceneOf("korrath", firstLevel("korrath", "The Cradles").id);
  const hull = cradles.runs.find((run) => run.text === "HULL 41");
  assert.equal(hull.on, "roof");
  assert.ok(cradles.heights[hull.y][hull.x] > 0.5);
});

test("what's drawn in outline stands up as something solid, and water is water", () => {
  // The hull in its slip is a block with its name on, not a hole in the floor.
  const cradles = sceneOf("korrath", firstLevel("korrath", "The Cradles").id);
  assert.equal(cradles.kinds[4][5], "inside");
  assert.ok(cradles.heights[4][5] > 0.7);
  assert.ok(cradles.heights[4][2] >= cradles.heights[4][5], "its outline is as high as it is");

  const rafts = sceneOf("maris", firstLevel("maris", "The Rafts").id);
  assert.ok(rafts.water.length > 200);
  assert.equal(rafts.kinds[0][0], "water");
  assert.equal(rafts.kinds[0][1], "water", "the gaps between the waves too");
  // A wave on its own is a wisp of something, in the sky over Tessen.
  const commons = sceneOf("frontier", firstLevel("frontier", "The Commons").id);
  assert.equal(commons.water.length, 0, "and nothing beside it is water either");
  assert.ok(commons.sparks.length > 0);

  // Open space that's beside the floor isn't a building.
  const docks = sceneOf("haven", firstLevel("haven", "The Manifest Docks").id);
  assert.equal(docks.kinds[3][10], "dim");
  // A berth is.
  assert.equal(docks.kinds[2][5], "inside");
});

test("it works from what the real game sends, including rooms the story has made up", () => {
  const game = createGameFromDraft(randomDraft({ seed: 7, archetype: "officer" }));
  const here = walkView(game);
  const scene = buildScene(here);
  assert.equal(scene.cols, here.cols);
  assert.ok(scene.blocks.length > 0);
  const story = runTool(game, "set_scene", { area: "A Cold Chapel", kind: "chapel", things: [{ name: "A cracked bell", look: "It hasn't rung in a long time." }] }, newTurnLimits());
  assert.ok(!story.isError, story.result);
  const made = walkView(game);
  assert.equal(made.here.name, "A Cold Chapel");
  const chapel = buildScene(made);
  assert.ok(chapel.ground.length > 0);
  assert.ok(chapel.ground.some((cell) => cell.kind === "thing"));
  for (const color of Object.values(chapel.colors)) assert.match(color, /^#[0-9a-fA-F]{6}$/);
  // A room with no colors of its own still has some.
  assert.match(buildScene({ ...here, colors: undefined }).colors.floor, /^#/);
});

test("every place says what it's made of, in words the view knows, and only about rooms that exist", () => {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const check = (look, where) => {
    if (look.floor) assert.ok(FLOOR_COLORS[look.floor], `${where}: floor ${look.floor}`);
    if (look.walls) assert.ok(WALL_COLORS[look.walls], `${where}: walls ${look.walls}`);
    if (look.rough) assert.ok(["rock", "scrap", "ice", "plants"].includes(look.rough), `${where}: rough ${look.rough}`);
    if (look.ambient) assert.match(look.ambient, hex, where);
    if (look.glow) assert.match(look.glow, hex, where);
    if (look.fire) assert.match(look.fire, hex, where);
    for (const color of look.lights ?? []) assert.match(color, hex, where);
    if (look.lights) assert.ok(look.lights.length > 0, where);
  };
  check(LOOKS.default, "default");
  assert.deepEqual(Object.keys(LOOKS.places).sort(), Object.keys(WORLD_MAPS).sort());
  for (const [place, look] of Object.entries(LOOKS.places)) {
    check(look, place);
    const names = Object.values(mapFor(place).levels).map((level) => level.name);
    for (const [name, room] of Object.entries(look.levels ?? {})) {
      assert.ok(names.includes(name), `${place} has no room called ${name}`);
      check(room, `${place}/${name}`);
      if (room.shape) {
        const level = Object.values(mapFor(place).levels).find((one) => one.name === name);
        assert.equal(room.shape.kind, "wheel", `${place}/${name}`);
        assert.ok(room.shape.from[0] >= 0 && room.shape.from[1] >= 0 && room.shape.to[0] < level.width && room.shape.to[1] < level.height, `${place}/${name}: its corners are off the plan`);
      }
    }
  }
});

test("a room's own look goes over its place's, and the view gets it from the real game", () => {
  assert.equal(lookOf("meridian", "Medbay").floor, "tile");
  assert.equal(lookOf("meridian", "The Bridge").floor, "deck");
  assert.equal(lookOf("nowhere", "Nothing").floor, LOOKS.default.floor);
  const game = createGameFromDraft(randomDraft({ seed: 7, archetype: "officer" }));
  assert.equal(walkView(game).look.floor, lookOf(game.location, walkView(game).here.name).floor);
  assert.equal(buildScene(walkView(game)).look.floor, walkView(game).look.floor);
});

test("every room has light in it, and what a mark is depends on the place it's in", () => {
  for (const { place, level } of everyLevel()) {
    const scene = buildScene({ ...viewOf(level), look: lookOf(place, level.name) });
    assert.ok(scene.lights.length > 0, `${place}/${level.id} is pitch dark`);
    for (const light of scene.lights) {
      assert.match(light.color, /^#[0-9a-fA-F]{6}$/, `${place}/${level.id}`);
      assert.ok(light.radius > 0 && light.power > 0 && Number.isFinite(light.wx) && Number.isFinite(light.wy), `${place}/${level.id}`);
    }
    for (const block of scene.blocks) assert.ok(block.style, `${place}/${level.id}`);
  }
  // The same mark is a console on a ship, and a plain bench where there aren't any.
  const level = firstLevel("haven", "The Manifest Docks");
  const styles = (look) => new Set(buildScene({ ...viewOf(level), look }).blocks.map((block) => block.style));
  assert.ok(styles({}).has("machine"));
  assert.ok(!styles({ machines: false }).has("machine"));
  assert.ok(styles({ machines: false }).has("bench"));
  // Rock is rock, unless it's crops in this place.
  const furrow = firstLevel("sundial", "The Long Furrow");
  const rough = (look) => new Set(buildScene({ ...viewOf(furrow), look }).blocks.filter((block) => block.mark === "%").map((block) => block.style));
  assert.deepEqual([...rough({ rough: "plants" })], ["plants"]);
  assert.deepEqual([...rough({ rough: "rock" })], ["rock"]);
  // Rock in front of the floor is cut down, the same as a wall.
  const warrens = firstLevel("kessara", "The Warrens");
  const scene = buildScene({ ...viewOf(warrens), look: { rough: "rock" } });
  warrens.open.forEach((row, y) => row.forEach((open, x) => {
    if (open && scene.styles[y + 1]?.[x] === "rock") assert.ok(scene.heights[y + 1][x] < 0.5, `${x},${y + 1}`);
  }));
});

test("a row of stars is something burning, and a star on its own is a star", () => {
  const furnaces = firstLevel("korrath", "The Long Furnaces");
  const lit = buildScene({ ...viewOf(furnaces), look: lookOf("korrath", furnaces.name) });
  assert.ok(lit.glows.length > 100);
  assert.ok(lit.lights.length > 15, "and it lights the room");
  const hall = firstLevel("ilun", "The Listening Hall");
  const sky = buildScene({ ...viewOf(hall), look: lookOf("ilun", hall.name) });
  assert.equal(sky.glows.length, 0);
  assert.ok(sky.sparks.length > 5);
  // The reactor's core burns, inside what's built around it.
  const engine = buildScene({ ...viewOf(firstLevel("meridian", "Engineering")), look: lookOf("meridian", "Engineering") });
  assert.ok(engine.glows.length >= 20);
  for (const cell of engine.glows) assert.equal(engine.heights[cell.y][cell.x], 0);
});

test("lamps are on tall walls that face the room, and clutter is only where nobody can walk", () => {
  let lamps = 0;
  for (const { place, level } of everyLevel()) {
    const where = `${place}/${level.id}`;
    const scene = buildScene({ ...viewOf(level), look: lookOf(place, level.name) });
    for (const fixture of scene.fixtures) {
      lamps += 1;
      assert.equal(scene.kinds[fixture.y][fixture.x], "wall", where);
      assert.ok(scene.heights[fixture.y][fixture.x] > 1, where);
      const facing = fixture.face === "left" ? scene.kinds[fixture.y + 1]?.[fixture.x] : scene.kinds[fixture.y]?.[fixture.x + 1];
      assert.ok(["floor", "door", "dim", "thing", "exit"].includes(facing), `${where}: a lamp facing ${facing}`);
      assert.match(fixture.color, /^#[0-9a-fA-F]{6}$/, where);
    }
    for (const cell of scene.junk) {
      assert.equal(scene.kinds[cell.y][cell.x], "dim", where);
      assert.equal(level.open[cell.y][cell.x], false, `${where}: ${cell.x},${cell.y} is in the way`);
    }
  }
  assert.ok(lamps > 100, `${lamps} lamps`);
});

test("with each room's real look on, you can still walk everywhere you could", () => {
  for (const { place, level } of everyLevel()) {
    const scene = buildScene({ ...viewOf(level), look: lookOf(place, level.name) });
    level.open.forEach((row, y) => row.forEach((open, x) => {
      if (!open) return;
      assert.ok(["floor", "door"].includes(scene.kinds[y][x]), `${place}/${level.id} ${x},${y} is ${scene.kinds[y][x]}`);
      assert.equal(scene.heights[y][x], 0, `${place}/${level.id} ${x},${y}`);
    }));
    for (const exit of level.exits) assert.equal(scene.kinds[exit.y][exit.x], "exit", `${place}/${level.id}`);
    for (const thing of level.things) assert.equal(scene.kinds[thing.y][thing.x], "thing", `${place}/${level.id}`);
  }
});

test("the Great Wheel is one round thing on a dais, in place of what's written on its plan", () => {
  const level = firstLevel("wheel", "The Great Wheel");
  const look = lookOf("wheel", level.name);
  const scene = buildScene({ ...viewOf(level), look });
  const wheels = scene.blocks.filter((block) => block.style === "wheel");
  assert.equal(wheels.length, 1);
  const [wheel] = wheels;
  assert.ok(wheel.radius > 2 && wheel.h > 0.3);
  assert.ok(wheel.frontDepth > wheel.depth, "it's drawn after what's under it");
  for (const value of Object.values(wheel.span)) assert.ok(Number.isFinite(value));
  assert.ok(scene.blocks.some((block) => block.style === "dais"));
  // What the plan drew there is gone, and the thing beside it hasn't moved.
  const { from, to } = look.shape;
  for (const block of scene.blocks) {
    if (block.x >= from[0] && block.x <= to[0] && block.y >= from[1] && block.y <= to[1]) assert.ok(["dais", "wheel"].includes(block.style), `${block.x},${block.y} ${block.style}`);
  }
  assert.equal(scene.kinds[5][48], "thing");
  // Without the shape, the same room is just what's on its plan.
  assert.equal(buildScene(viewOf(level)).blocks.filter((block) => block.style === "wheel").length, 0);
  // It stays in order with everything else, for working out who's in front of what.
  for (let i = 1; i < scene.blocks.length; i += 1) assert.ok(scene.blocks[i].depth >= scene.blocks[i - 1].depth);
});

test("the game opens in this view, and a choice made before it went this way doesn't stick", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(app, /const reading = \{[^}]*view: "iso"/);
  assert.match(app, /saved\?\.chosen && /);
  // Choosing one now is remembered.
  assert.match(app, /const reading = \{[^}]*chosen: true/);
  const menus = fs.readFileSync(new URL("../public/menus.js", import.meta.url), "utf8");
  assert.ok(!menus.includes("(test)"));
  assert.ok(!fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").includes("Isometric (test)"));
});

test("working it out doesn't change anything", () => {
  const game = createGameFromDraft(randomDraft({ seed: 9, archetype: "officer" }));
  const before = JSON.stringify(game);
  buildScene(walkView(game));
  assert.equal(JSON.stringify(game), before);
});
