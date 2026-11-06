// Walking freely (public/move.js), worked out without a screen: which way the keys walk, sliding along walls, being
// eased into a corridor's mouth, people and closed doors in the way, and a click's way across a room straightened out.
import assert from "node:assert/strict";
import { test } from "node:test";

const { fits, groundOf, headingOf, smoothed, squareOf, walkBy } = await import("../public/move.js");

// A small room: a wall all round, a pillar, and a corridor one square wide going up out of its top wall at x = 5.
const ROOM = [
  "     .     ",
  "     .     ",
  " ......... ",
  " ......... ",
  " ...# .... ",
  " ......... ",
  "           ",
];
const room = (extra = {}) => ({ floor: ROOM, exits: [], people: [], ...extra });
const near = (a, b, by = 1e-6) => Math.abs(a - b) <= by;

test("the keys walk up the screen seen from an angle, up the plan on it, and two opposite keys cancel out", () => {
  const up = headingOf(["up"], true);
  assert.ok(near(up.wx, -Math.SQRT1_2) && near(up.wy, -Math.SQRT1_2));
  assert.deepEqual(headingOf(["up"], false), { wx: 0, wy: -1 });
  // Up and right together, seen from an angle, walk straight along the room's depth.
  const both = headingOf(["up", "right"], true);
  assert.ok(near(both.wx, 0) && near(both.wy, -1));
  assert.equal(headingOf(["left", "right"], false), null);
});

test("the player walks over floor, stops at a wall, and slides along it when walking into it at a slant", () => {
  const ground = groundOf(room());
  const start = { x: 2, y: 3 };
  assert.ok(fits(ground, start, start));
  const left = walkBy(ground, start, -3, 0);
  assert.ok(left.x < start.x && left.x > 0.5 && near(left.y, 3), `stopped short of the wall at ${JSON.stringify(left)}`);
  assert.equal(squareOf(left).x, 1, "still on the floor");
  // Into the wall at the bottom while walking right: it slides right along it.
  const slant = walkBy(ground, { x: 6, y: 5 }, 1, 1);
  assert.ok(near(slant.x, 7) && slant.y < 5.5, JSON.stringify(slant));
  // Nothing thin is stepped over by a long step.
  assert.equal(squareOf(walkBy(ground, { x: 2, y: 4 }, 4, 0)).x <= 3, true, "the pillar at (4, 4) stops a long step");
});

test("walking straight up a little to one side of a corridor's mouth eases into it", () => {
  const ground = groundOf(room());
  let at = { x: 5.4, y: 2.5 };
  for (let i = 0; i < 40; i += 1) at = walkBy(ground, at, 0, -0.1);
  assert.equal(squareOf(at).x, 5);
  assert.ok(at.y < 1, `went up the corridor to ${JSON.stringify(at)}`);
  // Too far to the side, it's a wall.
  let wide = { x: 7, y: 2.5 };
  for (let i = 0; i < 20; i += 1) wide = walkBy(ground, wide, 0, -0.1);
  assert.ok(wide.y > 1.6, JSON.stringify(wide));
});

test("people and closed doors are in the way, open ways out aren't, and a square someone's walked into doesn't trap anyone", () => {
  const view = room({ people: [{ key: "pell", x: 4, y: 3 }], exits: [{ x: 10, y: 3, closed: true }, { x: 0, y: 3 }] });
  const ground = groundOf(view);
  assert.equal(ground(4, 3), false, "Pell's standing there");
  assert.equal(ground(10, 3), false, "a closed door");
  assert.equal(ground(0, 3), true, "an open way out");
  const blocked = walkBy(ground, { x: 2, y: 3 }, 2, 0);
  assert.ok(blocked.x < 3.5, JSON.stringify(blocked));
  // Pell walks into the player: they can still walk away.
  const squeezed = walkBy(ground, { x: 4, y: 3 }, -1, 0);
  assert.ok(near(squeezed.x, 3), JSON.stringify(squeezed));
  assert.equal(squareOf(walkBy(ground, { x: 1, y: 3 }, -1.2, 0)).x, 0, "out through the open way");
});

test("a click's way across a room, square by square, is straightened into a line where nothing's in the way", () => {
  const ground = groundOf(room());
  const stairs = [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 }];
  assert.deepEqual(smoothed(ground, { x: 1, y: 2 }, stairs), [{ x: 6, y: 3 }]);
  // Round the pillar it keeps the corner it needs.
  const round = [{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 3 }];
  const line = smoothed(ground, { x: 3, y: 4 }, round);
  assert.ok(line.length >= 2 && line.at(-1).x === 5 && line.at(-1).y === 3, JSON.stringify(line));
});
