// Gunnery and Firearms: the target keeps moving, so aim where it's going to be, not where it is.

import { between, cellName, chance, link, meter, panel, parseCell, randomInt, say, tone } from "./kit.js";

const WIDTH = 10;
const HEIGHT = 6;
const JINK = [0.1, 0.2, 0.3, 0.4, 0.5];

function step(state) {
  let { x, y, dx, dy } = state.target;
  if (chance(state.jink)) {
    dx = between(-1, 1);
    dy = between(-1, 1);
    if (!dx && !dy) dx = x > WIDTH / 2 ? -1 : 1;
  }
  if (x + dx < 0 || x + dx >= WIDTH) dx = -dx;
  if (y + dy < 0 || y + dy >= HEIGHT) dy = -dy;
  state.target = { x: x + dx, y: y + dy, dx, dy };
}

export default {
  start(ctx) {
    const dx = randomInt(2) ? 1 : -1;
    const dy = between(-1, 1);
    const shots = 4 + Math.floor(ctx.tier / 2);
    const target = { x: between(2, WIDTH - 3), y: between(1, HEIGHT - 2), dx, dy };
    return {
      target,
      trail: [{ x: target.x - dx, y: target.y - dy }],
      jink: Math.max(0.05, JINK[ctx.level] - ctx.tier * 0.05),
      shots,
      fired: 0,
      hits: 0,
      near: 0,
      lastShot: null,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Target acquired.", "dim"),
      say(`You've got ${state.shots} shots. Each one lands after the target moves, so aim where it's going, by clicking that square.`, "info"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const { x, y, dx, dy } = state.target;
    const showLead = ctx.tier >= 3;
    const lead = { x: x + dx, y: y + dy };
    const trail = new Set(state.trail.slice(-(1 + ctx.tier)).map((p) => `${p.x},${p.y}`));
    const rows = [[tone(`    ${Array.from({ length: WIDTH }, (_, i) => String.fromCharCode(97 + i)).join(" ")}`, "dim")]];
    for (let row = 0; row < HEIGHT; row += 1) {
      const line = [tone(`${String(row + 1).padStart(2)}  `, "dim")];
      for (let col = 0; col < WIDTH; col += 1) {
        const here = `${col},${row}`;
        let symbol = ".";
        let name = "dim";
        if (col === x && row === y) {
          symbol = ctx.text.target ?? "X";
          name = "bad";
        } else if (state.lastShot && state.lastShot.x === col && state.lastShot.y === row) {
          symbol = "*";
          name = state.lastShot.hit ? "good" : "warn";
        } else if (trail.has(here)) {
          symbol = "o";
          name = "warn";
        } else if (showLead && col === lead.x && row === lead.y) {
          symbol = "+";
          name = "info";
        }
        line.push(state.done ? tone(symbol, name) : link(symbol, `fire ${cellName(col, row)}`, name === "dim" ? "cell" : name, `Fire at ${cellName(col, row)}`));
        line.push(tone(col < WIDTH - 1 ? " " : "", "dim"));
      }
      rows.push(line);
    }
    const heading = dx === 0 && dy === 0 ? "holding still" : `${dy < 0 ? "up " : dy > 0 ? "down " : ""}${dx < 0 ? "left" : dx > 0 ? "right" : ""}`.trim();
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Fire Control", [], { terminal: true }),
        panel("scope", consoles.scope ?? "Targeting Grid", [
          ...rows,
          [tone(" ", "dim")],
          [tone(`${ctx.text.target ?? "X"} target   o its trail   * your last shot${showLead ? "   + where it's heading" : ""}`, "dim")],
          ...(ctx.tier >= 2 ? [[tone(`Heading: ${heading}. Breaks course ${Math.round(state.jink * 100)}% of the time.`, "info")]] : []),
        ], { grid: true }),
      ],
      commands: [],
      meters: [
        meter("SHOTS", state.shots - state.fired, state.shots, state.fired >= state.shots - 1 ? "bad" : "info", `${state.shots - state.fired} left`),
        meter("HITS", state.hits, state.shots, "good", `${state.hits}/${state.shots}`),
      ],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("You're out of shots.", "dim")];
    const typed = words[0] === "fire" || words[0] === "shoot" || words[0] === "aim" ? words.slice(1).join("") : words.join("");
    const cell = parseCell(typed);
    if (!cell || cell.x >= WIDTH || cell.y >= HEIGHT) return words[0] === "fire" ? [say("That's off the grid.", "bad")] : null;
    state.trail.push({ x: state.target.x, y: state.target.y });
    step(state);
    state.fired += 1;
    const distance = Math.max(Math.abs(cell.x - state.target.x), Math.abs(cell.y - state.target.y));
    const hit = distance === 0;
    state.lastShot = { x: cell.x, y: cell.y, hit };
    const lines = [];
    if (hit) {
      state.hits += 1;
      lines.push(say(`${cellName(cell.x, cell.y)}: ${ctx.text.hitLine ?? "HIT."}`, "good"));
    } else if (distance === 1) {
      state.near += 1;
      lines.push(say(`${cellName(cell.x, cell.y)}: ${ctx.text.nearLine ?? "Close."}`, "warn"));
    } else {
      lines.push(say(`${cellName(cell.x, cell.y)}: ${ctx.text.missLine ?? "A clean miss."}`, "dim"));
    }
    if (state.fired >= state.shots) {
      state.done = true;
      lines.push(say(`That's all of them: ${state.hits} hit${state.hits === 1 ? "" : "s"} out of ${state.shots}.`, "info"));
    }
    return lines;
  },

  edge(state) {
    return Math.round((6 * (state.hits + state.near * 0.34)) / state.shots);
  },

  story(state) {
    if (!state.fired) return "They didn't wait to line it up.";
    return `They landed ${state.hits} of ${state.shots} shots${state.near ? `, with ${state.near} more very close` : ""}.`;
  },
};
