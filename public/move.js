// Walking freely. With W, A, S and D, or the arrow keys, the player walks smoothly wherever the floor goes, sliding along
// walls and eased round corners, and a click walks them the server's way round just as smoothly. Seen from an angle, W
// walks up the screen; on the plan, up the plan. The server only needs to know which square the player's on, so each
// new square is sent as it's reached, and walking into an open way out takes it, the same as clicking it does.
//
// A position counts from a square's corner, the way the squares do, and the player stands at its middle: at (3, 4)
// they're in the middle of square (3, 4), and at (3.4, 4) a little to its right.

import { CELL_WIDTH } from "./iso.js";

// How fast the player walks, in the room's own measure to a second: a square is CELL_WIDTH across and one deep.
export const SPEED = 6;
// Half the player's width, in the same measure: how close they come to a wall.
const BODY = 0.13;
// How far to one side the player is eased, in squares, when they walk straight at the edge of a doorway or a corner.
const ROUND_CORNERS = 0.5;
// Physical keys first, so W, A, S and D are the same four keys on any keyboard, and the letters too, wherever they are.
const BY_CODE = { KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right", ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const BY_LETTER = { w: "up", s: "down", a: "left", d: "right" };
// Which way each key walks, in the room's own measure: up the screen when it's seen from an angle, up the plan on it.
const ON_SCREEN = { up: [-1, -1], down: [1, 1], left: [-1, 1], right: [1, -1] };
const ON_PLAN = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// ---- The room's floor -----------------------------------------------------------------------------

export const squareOf = (pos) => ({ x: Math.floor(pos.x + 0.5), y: Math.floor(pos.y + 0.5) });
const keyOf = (x, y) => `${x},${y}`;

// What can be walked on in a room: its floor and the ways out that are open, and nowhere anyone's standing.
export function groundOf(view) {
  const open = new Set(view.exits.filter((exit) => !exit.closed).map((exit) => keyOf(exit.x, exit.y)));
  const people = new Set(view.people.map((person) => keyOf(person.x, person.y)));
  return (x, y) => !people.has(keyOf(x, y)) && (view.floor?.[y]?.[x] === "." || open.has(keyOf(x, y)));
}

// The squares the player's body covers at a position.
function covered(pos) {
  const across = BODY / CELL_WIDTH;
  const cx = pos.x + 0.5;
  const cy = pos.y + 0.5;
  const squares = [];
  for (let y = Math.floor(cy - BODY); y <= Math.floor(cy + BODY - 1e-9); y += 1) {
    for (let x = Math.floor(cx - across); x <= Math.floor(cx + across - 1e-9); x += 1) squares.push([x, y]);
  }
  return squares;
}

// Whether the player fits at a position: every square their body would cover can be walked on, or is one they're on
// already, so that nobody who's ended up somewhere odd, or been walked into, is stuck there.
export function fits(ground, from, to) {
  const already = new Set(covered(from).map(([x, y]) => keyOf(x, y)));
  return covered(to).every(([x, y]) => already.has(keyOf(x, y)) || ground(x, y));
}

// One step along one way. Walking straight at the edge of a doorway or a corner, the player is eased to the side it'd
// go on, by no more than the step itself, so that a corridor's mouth is easy to find.
function stepAlong(ground, at, sx, sy) {
  const next = { x: at.x + sx, y: at.y + sy };
  if (fits(ground, at, next)) return next;
  const length = Math.abs(sx) * CELL_WIDTH + Math.abs(sy);
  for (let off = 0.1; off <= ROUND_CORNERS + 1e-9; off += 0.1) {
    for (const side of [1, -1]) {
      const beside = sx ? { x: at.x, y: at.y + side * off } : { x: at.x + side * off, y: at.y };
      if (!fits(ground, at, beside) || !fits(ground, beside, { x: beside.x + sx, y: beside.y + sy })) continue;
      const ease = Math.min(off, sx ? length : length / CELL_WIDTH);
      const toward = sx ? { x: at.x, y: at.y + side * ease } : { x: at.x + side * ease, y: at.y };
      return fits(ground, at, toward) ? toward : at;
    }
  }
  return at;
}

// Walks the player by a step, in squares, sliding along whatever's in the way. A long step is cut up, so nothing thin
// is stepped over.
export function walkBy(ground, pos, dx, dy) {
  let at = { ...pos };
  const parts = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.2));
  for (let i = 0; i < parts; i += 1) {
    if (dx) at = stepAlong(ground, at, dx / parts, 0);
    if (dy) at = stepAlong(ground, at, 0, dy / parts);
  }
  return at;
}

// Whether the player could walk straight from one position to another.
function clearLine(ground, from, to) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) / 0.1));
  for (let i = 1; i <= steps; i += 1) {
    if (!fits(ground, from, { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps })) return false;
  }
  return true;
}

// The server's way, square by square, smoothed: from each point straight on to the furthest point after it that can be
// walked to in a straight line, so that a walk across a room is a line and not a staircase.
export function smoothed(ground, from, points) {
  const out = [];
  let at = from;
  let i = 0;
  while (i < points.length) {
    let far = i;
    for (let j = points.length - 1; j > i; j -= 1) {
      if (clearLine(ground, at, points[j])) {
        far = j;
        break;
      }
    }
    out.push(points[far]);
    at = points[far];
    i = far + 1;
  }
  return out;
}

// The way the held keys walk, as a step of one in the room's own measure, or null when they cancel out.
export function headingOf(directions, angled) {
  const table = angled ? ON_SCREEN : ON_PLAN;
  let wx = 0;
  let wy = 0;
  for (const direction of new Set(directions)) {
    wx += table[direction][0];
    wy += table[direction][1];
  }
  const length = Math.hypot(wx, wy);
  return length ? { wx: wx / length, wy: wy / length } : null;
}

// ---- Walking --------------------------------------------------------------------------------------

const state = {
  hooks: null,
  pos: null,
  level: null,
  // The square the server last agreed the player was on, and whether it's being told about another.
  sent: null,
  pending: false,
  retryAt: 0,
  // A way out has just been walked into: the player waits for the next room.
  leaving: false,
  held: new Map(),
  walking: false,
  // A walk from a click, along the server's way: its points still to go, and what to do at the end.
  route: null,
  last: 0,
};

export const positionNow = () => state.pos;

// A new game, or one loaded: nothing of the last one's walking carries over.
export function resetMoving() {
  Object.assign(state, { pos: null, level: null, sent: null, pending: false, retryAt: 0, leaving: false, walking: false, route: null });
  state.held.clear();
}
export const currentSquare = () => (state.pos ? squareOf(state.pos) : null);
// On the way out of the room: a walk through a way out, or a way out walked into and not yet through.
export const leavingRoom = () => Boolean(state.route?.firm) || state.leaving;

// hooks: view() is the room or null, canMove() whether the player may walk now, angled() whether the room's seen from
// an angle, setOff() puts away what walking puts away, send(body) asks the server, arrived(reply) is a way out or a
// door walked into, placed(pos) shows where the player is.
export function startMoving(hooks) {
  state.hooks = hooks;
  document.addEventListener("keydown", pressed);
  document.addEventListener("keyup", (event) => state.held.delete(event.code));
  window.addEventListener("blur", () => state.held.clear());
  requestAnimationFrame(frame);
}

const typing = (target) => Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));

function pressed(event) {
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || document.getElementById("board")) return;
  const direction = BY_CODE[event.code] ?? BY_LETTER[event.key?.toLowerCase()];
  if (!direction || !state.hooks?.view() || !state.hooks.canMove()) return;
  event.preventDefault();
  state.held.set(event.code, direction);
}

// The room the page has from the server, matched up with where the player's walked to: a new room puts them where the
// server says, and so does the server moving them itself, as the story can, while nothing of theirs is on its way.
export function adopt(view) {
  if (!view) return;
  if (view.here.id !== state.level || !state.pos) {
    // A walk into this room that was still being shown ends now.
    if (state.route && state.pos) finishRoute();
    state.level = view.here.id;
    state.pos = { ...view.captain };
    state.sent = { ...view.captain };
    state.leaving = false;
    state.hooks?.placed(state.pos);
    return;
  }
  if (state.route || state.pending || state.leaving) return;
  if (view.captain.x !== state.sent?.x || view.captain.y !== state.sent?.y) {
    state.pos = { ...view.captain };
    state.sent = { ...view.captain };
    state.hooks?.placed(state.pos);
  }
}

// A walk along the server's way, from a click. serverAt is where the server has put the player already: the end of the
// way. A walk into another room can't be turned aside, since the server's already there; any other can, by the keys.
// point is a position on the last square to finish exactly on, such as the spot that was clicked.
export function follow(path, { serverAt, point = null, firm = false, done, turned = null }) {
  state.held.clear();
  const view = state.hooks.view();
  const ground = view ? groundOf(view) : () => true;
  const end = path.at(-1);
  const exact = point && end && Math.floor(point.x + 0.5) === end.x && Math.floor(point.y + 0.5) === end.y && fits(ground, end, point) ? point : null;
  const points = [...path.map((square) => ({ x: square.x, y: square.y })), ...(exact ? [exact] : [])];
  state.sent = { ...serverAt };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !points.length) {
    if (points.length) state.pos = { ...points.at(-1) };
    state.hooks.placed(state.pos);
    done();
    return;
  }
  state.route = { points: smoothed(ground, state.pos, points), done, firm, turned };
}

function finishRoute() {
  const { route } = state;
  state.route = null;
  state.pos = { ...route.points.at(-1) };
  route.done();
}

// Stops a walk from a click partway, where the player's got to, for the keys to take over.
function turnAside() {
  const { route } = state;
  state.route = null;
  route.turned?.();
}

function along(dt) {
  let left = SPEED * dt;
  const { route } = state;
  while (left > 1e-6 && route.points.length) {
    const goal = route.points[0];
    const wx = (goal.x - state.pos.x) * CELL_WIDTH;
    const wy = goal.y - state.pos.y;
    const distance = Math.hypot(wx, wy);
    if (distance <= left) {
      state.pos = { ...goal };
      left -= distance;
      route.points.shift();
    } else {
      state.pos = { x: state.pos.x + ((wx / distance) * left) / CELL_WIDTH, y: state.pos.y + (wy / distance) * left };
      left = 0;
    }
  }
  if (!route.points.length) {
    state.route = null;
    route.done();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - (state.last || now)) / 1000));
  state.last = now;
  const { hooks } = state;
  const view = hooks?.view();
  if (!view) return;
  adopt(view);
  if (!state.pos) return;
  const heading = state.held.size && hooks.canMove() && !state.leaving ? headingOf([...state.held.values()], hooks.angled()) : null;
  if (state.route) {
    if (heading && !state.route.firm) turnAside();
    else {
      along(dt);
      hooks.placed(state.pos);
      return;
    }
  }
  if (heading) {
    if (!state.walking) hooks.setOff();
    state.walking = true;
    const ground = groundOf(view);
    const next = walkBy(ground, state.pos, (heading.wx * SPEED * dt) / CELL_WIDTH, heading.wy * SPEED * dt);
    if (next.x !== state.pos.x || next.y !== state.pos.y) {
      state.pos = next;
      hooks.placed(state.pos);
    }
  } else state.walking = false;
  sync(view, now);
}

// Tells the server about a new square once it's been reached, one at a time, and a way out as soon as it's walked into.
async function sync(view, now) {
  const { hooks } = state;
  if (state.pending || state.leaving || now < state.retryAt || !hooks.canMove()) return;
  const square = squareOf(state.pos);
  if (square.x === state.sent?.x && square.y === state.sent?.y) return;
  const exit = view.exits.find((one) => !one.closed && one.x === square.x && one.y === square.y);
  state.pending = true;
  if (exit) state.leaving = true;
  let reply;
  try {
    reply = await hooks.send({ action: "move", x: square.x, y: square.y });
  } catch {
    // Most likely a window has just opened. It's tried again in a moment.
    state.pending = false;
    state.leaving = false;
    state.retryAt = performance.now() + 1000;
    return;
  }
  state.pending = false;
  if (reply.walk) {
    // Through a way out, or up to a closed door: the server's room, and its square, from here.
    state.leaving = false;
    state.sent = { ...reply.walk.captain };
    if (reply.walk.here.id === state.level) state.pos = { ...reply.walk.captain };
    hooks.arrived(reply);
    return;
  }
  state.leaving = false;
  if (!reply.moved) {
    state.pos = { ...reply.captain };
    hooks.placed(state.pos);
  }
  state.sent = { ...reply.captain };
  // The page's room says the same as the server from here, so it isn't taken for the server moving the player.
  const shown = hooks.view();
  if (shown?.here.id === state.level) shown.captain = { ...reply.captain };
}
