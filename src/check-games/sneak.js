// Stealth and Void Ops: cross a grid without being caught in anything's line of sight. It's
// turn-based, so nothing moves until you do. Each puzzle is checked to make sure it can be solved.

import { bar, between, command, meter, panel, randomInt, say, tone } from "./kit.js";

const SIZES = [[7, 5], [8, 5], [8, 6], [9, 6], [10, 6]];
const WATCHERS = [1, 1, 2, 2, 3];
const SIGHT = 2;

const key = (x, y) => `${x},${y}`;

// A watcher walks back and forth along a line, and looks the way it's going.
function positionAt(guard, time) {
  const span = guard.path.length;
  if (span === 1) return { ...guard.path[0], dir: guard.facing };
  const period = 2 * (span - 1);
  const step = (time + guard.offset) % period;
  const forward = step < span - 1;
  const index = forward ? step : period - step;
  const a = guard.path[0];
  const b = guard.path[span - 1];
  const dir = forward ? { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) } : { x: Math.sign(a.x - b.x), y: Math.sign(a.y - b.y) };
  return { ...guard.path[index], dir };
}

function sightCells(guard, time, walls, width, height) {
  const place = positionAt(guard, time);
  const cells = [key(place.x, place.y)];
  let { x, y } = place;
  for (let i = 0; i < SIGHT; i += 1) {
    x += place.dir.x;
    y += place.dir.y;
    if (x < 0 || y < 0 || x >= width || y >= height || walls.has(key(x, y))) break;
    cells.push(key(x, y));
  }
  return cells;
}

function seenAt(state, time, wallSet) {
  const seen = new Set();
  for (const guard of state.guards) for (const cell of sightCells(guard, time, wallSet, state.width, state.height)) seen.add(cell);
  return seen;
}

// The fewest moves from start to exit without ever being seen, or null if it can't be done.
function shortestPath(state, wallSet) {
  const period = state.guards.reduce((lcm, guard) => {
    const span = guard.path.length > 1 ? 2 * (guard.path.length - 1) : 1;
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    return (lcm * span) / gcd(lcm, span);
  }, 1);
  const frontier = [{ x: state.start.x, y: state.start.y, time: 0, moves: 0 }];
  const visited = new Set([`${state.start.x},${state.start.y},0`]);
  while (frontier.length) {
    const now = frontier.shift();
    if (now.x === state.exit.x && now.y === state.exit.y) return now.moves;
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = now.x + dx;
      const y = now.y + dy;
      if (x < 0 || y < 0 || x >= state.width || y >= state.height || wallSet.has(key(x, y))) continue;
      const time = (now.time + 1) % period;
      if (seenAt(state, time, wallSet).has(key(x, y))) continue;
      const mark = `${x},${y},${time}`;
      if (visited.has(mark)) continue;
      visited.add(mark);
      frontier.push({ x, y, time, moves: now.moves + 1 });
    }
  }
  return null;
}

function makeGuard(width, height, walls, keepOut) {
  for (let tries = 0; tries < 30; tries += 1) {
    const horizontal = Math.random() < 0.5;
    const length = between(3, horizontal ? Math.min(5, width) : Math.min(4, height));
    const startX = randomInt(width - (horizontal ? length - 1 : 0));
    const startY = randomInt(height - (horizontal ? 0 : length - 1));
    const path = Array.from({ length }, (_, i) => ({ x: startX + (horizontal ? i : 0), y: startY + (horizontal ? 0 : i) }));
    if (path.some((p) => walls.has(key(p.x, p.y)) || keepOut.has(key(p.x, p.y)))) continue;
    return { path, offset: randomInt(2 * (length - 1)), facing: { x: 1, y: 0 } };
  }
  return null;
}

function makeLevel(ctx) {
  const [width, height] = SIZES[ctx.level];
  const start = { x: 0, y: height - 1 };
  const exit = { x: width - 1, y: 0 };
  const keepOut = new Set([key(start.x, start.y), key(exit.x, exit.y), key(1, height - 1), key(0, height - 2), key(width - 2, 0), key(width - 1, 1)]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const walls = new Set();
    const wallCount = Math.floor(width * height * 0.14);
    for (let i = 0; i < wallCount; i += 1) {
      const wall = key(randomInt(width), randomInt(height));
      if (!keepOut.has(wall)) walls.add(wall);
    }
    const guards = [];
    for (let i = 0; i < WATCHERS[ctx.level]; i += 1) {
      const guard = makeGuard(width, height, walls, keepOut);
      if (guard) guards.push(guard);
    }
    const state = { width, height, start, exit, guards, walls: [...walls] };
    const par = shortestPath(state, walls);
    if (par !== null && par > 0) return { ...state, par };
  }
  // A plain room, in the very unlikely event that nothing else worked.
  const state = { width, height, start, exit, guards: [], walls: [] };
  return { ...state, par: shortestPath(state, new Set()) };
}

export default {
  start(ctx) {
    const level = makeLevel(ctx);
    return {
      ...level,
      x: level.start.x,
      y: level.start.y,
      time: 0,
      moves: 0,
      alerts: 0,
      maxAlerts: 2 + Math.floor(ctx.tier / 2),
      maxMoves: level.par + 4 + ctx.tier,
      reached: false,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Quietly now.", "dim"),
      say(`Reach ${ctx.text.exitName ?? "the exit"} without stepping into anything's line of sight. Nothing moves until you do.`, "info"),
      ...(ctx.tier >= 2 ? [say("You can read the pattern: you can see where they'll be looking next.", "info")] : []),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const walls = new Set(state.walls);
    const seen = seenAt(state, state.time, walls);
    const next = ctx.tier >= 2 ? seenAt(state, state.time + 1, walls) : new Set();
    const watchers = new Map(state.guards.map((guard) => {
      const place = positionAt(guard, state.time);
      return [key(place.x, place.y), place.dir];
    }));
    const arrows = (dir) => (dir.x > 0 ? ">" : dir.x < 0 ? "<" : dir.y > 0 ? "v" : "^");
    const header = [tone(`    ${Array.from({ length: state.width }, (_, x) => String.fromCharCode(97 + x)).join(" ")}`, "dim")];
    const grid = [header];
    for (let y = 0; y < state.height; y += 1) {
      const row = [tone(`${String(y + 1).padStart(2)}  `, "dim")];
      for (let x = 0; x < state.width; x += 1) {
        const cell = key(x, y);
        let piece;
        if (x === state.x && y === state.y) piece = tone(ctx.text.you ?? "@", "bright");
        else if (x === state.exit.x && y === state.exit.y) piece = tone(ctx.text.exit ?? "X", "good");
        else if (walls.has(cell)) piece = tone("#", "dim");
        else if (watchers.has(cell)) piece = tone(arrows(watchers.get(cell)), "bad");
        else if (seen.has(cell)) piece = tone("!", "bad");
        else if (next.has(cell)) piece = tone(":", "warn");
        else piece = tone(".", "dim");
        row.push(piece, tone(x < state.width - 1 ? " " : "", "dim"));
      }
      grid.push(row);
    }
    const blocked = (dx, dy) => {
      const x = state.x + dx;
      const y = state.y + dy;
      return x < 0 || y < 0 || x >= state.width || y >= state.height || walls.has(key(x, y));
    };
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Field Console", [], { terminal: true }),
        panel("map", consoles.map ?? "Map", [
          ...grid,
          [tone(" ", "dim")],
          [tone(`${ctx.text.you ?? "@"} you   ${ctx.text.exit ?? "X"} ${ctx.text.exitName ?? "exit"}`, "dim")],
          [tone("< > ^ v watcher   ! seen", "dim"), ...(next.size ? [tone("   : seen next", "dim")] : [])],
        ], { grid: true }),
      ],
      commands: state.done ? [] : [
        command("left", "left", "", { key: "ArrowLeft", disabled: blocked(-1, 0) }),
        command("up", "up", "", { key: "ArrowUp", disabled: blocked(0, -1) }),
        command("down", "down", "", { key: "ArrowDown", disabled: blocked(0, 1) }),
        command("right", "right", "", { key: "ArrowRight", disabled: blocked(1, 0) }),
        command("wait", "wait", "let them pass"),
      ],
      meters: [
        meter(ctx.text.movesName ?? "TIME", state.maxMoves - state.moves, state.maxMoves, state.moves >= state.maxMoves - 2 ? "bad" : "info", `${bar(state.maxMoves - state.moves, state.maxMoves, 8)} ${state.maxMoves - state.moves} left`),
        meter("ALERT", state.alerts, state.maxAlerts, state.alerts >= state.maxAlerts - 1 ? "bad" : "warn", `${state.alerts}/${state.maxAlerts}`),
      ],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("It's done, one way or another.", "dim")];
    const moves = { left: [-1, 0], l: [-1, 0], a: [-1, 0], west: [-1, 0], right: [1, 0], r: [1, 0], d: [1, 0], east: [1, 0], up: [0, -1], u: [0, -1], w: [0, -1], north: [0, -1], down: [0, 1], s: [0, 1], south: [0, 1], wait: [0, 0], stay: [0, 0], hold: [0, 0] };
    const move = moves[words[0]];
    if (!move) return null;
    const walls = new Set(state.walls);
    const x = state.x + move[0];
    const y = state.y + move[1];
    if (x < 0 || y < 0 || x >= state.width || y >= state.height || walls.has(key(x, y))) return [say("You can't go that way.", "dim")];
    state.x = x;
    state.y = y;
    state.time += 1;
    state.moves += 1;
    const lines = [];
    if (seenAt(state, state.time, walls).has(key(x, y))) {
      state.alerts += 1;
      lines.push(say(ctx.text.seenLine ?? "You've been spotted!", "bad"));
      if (state.alerts >= state.maxAlerts) {
        state.done = true;
        state.forced = true;
        lines.push(say(ctx.text.caughtLine ?? "That's the end of being careful.", "bad"));
        return lines;
      }
    }
    if (x === state.exit.x && y === state.exit.y) {
      state.reached = true;
      state.done = true;
      lines.push(say(state.alerts ? "You made it, though not unnoticed." : "You made it, and nobody knows you were there.", state.alerts ? "warn" : "good"));
    } else if (state.moves >= state.maxMoves) {
      state.done = true;
      lines.push(say(ctx.text.lateLine ?? "You're out of time.", "warn"));
    }
    return lines;
  },

  edge(state) {
    if (state.reached) return Math.max(0, 6 - 2 * state.alerts);
    if (state.alerts >= state.maxAlerts) return -3;
    const total = Math.abs(state.exit.x - state.start.x) + Math.abs(state.exit.y - state.start.y);
    const left = Math.abs(state.exit.x - state.x) + Math.abs(state.exit.y - state.y);
    return Math.floor(((total - left) / total) * 2) - state.alerts;
  },

  story(state) {
    if (state.reached) return state.alerts ? `They got there, but they were noticed ${state.alerts} time${state.alerts === 1 ? "" : "s"} on the way.` : "They got there completely unnoticed.";
    if (state.alerts >= state.maxAlerts) return "They were spotted, and it turned into a mad dash.";
    return "They ran out of time and had to make a move before they were in position.";
  },
};
