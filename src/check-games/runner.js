// Piloting and Athletics: get down a corridor of obstacles, one move at a time, seeing only as
// far ahead as your skill lets you. There's always a clear way through.

import { bar, between, command, meter, panel, randomInt, say, tone } from "./kit.js";

const WIDTH = 5;
const STEPS = [8, 10, 12, 14, 16];
const BLOCKED = [1, 2, 2, 3, 3];

function makeCourse(steps, blocked) {
  const rows = [];
  let safe = 2;
  for (let i = 0; i < steps; i += 1) {
    safe = Math.max(0, Math.min(WIDTH - 1, safe + between(-1, 1)));
    const row = Array(WIDTH).fill(false);
    let placed = 0;
    let tries = 0;
    while (placed < blocked && tries < 20) {
      const lane = randomInt(WIDTH);
      tries += 1;
      if (lane !== safe && !row[lane]) {
        row[lane] = true;
        placed += 1;
      }
    }
    rows.push(row);
  }
  return rows;
}

export default {
  start(ctx) {
    const steps = STEPS[ctx.level];
    return {
      rows: makeCourse(steps, BLOCKED[ctx.level]),
      at: 0,
      lane: 2,
      hits: 0,
      maxHits: 3 + Math.floor(ctx.tier / 2),
      sight: 2 + ctx.tier,
      steps,
      lastHit: false,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Here we go.", "dim"),
      say(`Reach the end of the run. Each move, go left, right or straight on. You can see ${state.sight} rows ahead.`, "info"),
      say("It goes at your pace. Take your time.", "dim"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const you = ctx.text.you ?? "^";
    const block = ctx.text.block ?? "#";
    const lines = [];
    const total = state.sight + 1;
    for (let ahead = total; ahead >= 1; ahead -= 1) {
      const index = state.at + ahead - 1;
      if (ahead > state.sight) {
        lines.push([tone(`| ${Array(WIDTH).fill("?").join(" ")} |`, "dim"), tone("  beyond your sight", "dim")]);
      } else if (index >= state.steps) {
        lines.push([tone(`| ${Array(WIDTH).fill("=").join(" ")} |`, "good"), tone(index === state.steps ? "  the end" : "", "good")]);
      } else {
        const row = state.rows[index];
        lines.push([tone("| ", "dim"), ...row.flatMap((blocked, lane) => [tone(blocked ? block : ".", blocked ? "bad" : "dim"), tone(lane < WIDTH - 1 ? " " : "", "dim")]), tone(" |", "dim")]);
      }
    }
    lines.push([tone("| ", "dim"), ...Array.from({ length: WIDTH }, (_, lane) => [tone(lane === state.lane ? you : " ", state.lastHit ? "bad" : "bright"), tone(lane < WIDTH - 1 ? " " : "", "dim")]).flat(), tone(" |", "dim")]);
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Flight Console", [], { terminal: true }),
        panel("radar", consoles.radar ?? "Proximity Radar", lines, { grid: true }),
      ],
      commands: state.done ? [] : [
        command("left", "left", "", { key: "ArrowLeft", disabled: state.lane === 0 }),
        command("straight", "straight", "", { key: "ArrowUp" }),
        command("right", "right", "", { key: "ArrowRight", disabled: state.lane === WIDTH - 1 }),
      ],
      meters: [
        meter("RUN", state.at, state.steps, "info", `${bar(state.at, state.steps, 8)} ${state.at}/${state.steps}`),
        meter(ctx.text.hitsName ?? "HITS", state.hits, state.maxHits, state.hits >= state.maxHits - 1 ? "bad" : "warn", `${state.hits}/${state.maxHits}`),
      ],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The run's over. See how it comes out.", "dim")];
    const moves = { left: -1, l: -1, a: -1, right: 1, r: 1, d: 1, straight: 0, s: 0, w: 0, stay: 0, hold: 0, up: 0, forward: 0, go: 0 };
    const move = moves[words[0]];
    if (move === undefined) return null;
    state.lane = Math.max(0, Math.min(WIDTH - 1, state.lane + move));
    const row = state.rows[state.at];
    state.at += 1;
    state.lastHit = row[state.lane];
    const lines = [];
    if (state.lastHit) {
      state.hits += 1;
      lines.push(say(ctx.text.hitLine ?? "Impact!", "bad"));
      if (state.hits >= state.maxHits) {
        state.done = true;
        state.forced = true;
        lines.push(say(ctx.text.wreckLine ?? "That's all you can take.", "bad"));
        return lines;
      }
    } else {
      lines.push(say(ctx.text.clearLine ?? "Clear.", "dim"));
    }
    if (state.at >= state.steps) {
      state.done = true;
      lines.push(say(state.hits ? "You made it through, not cleanly." : "You made it through without a scratch.", state.hits ? "warn" : "good"));
    }
    return lines;
  },

  edge(state) {
    return Math.max(-3, Math.floor((6 * state.at) / state.steps) - 2 * state.hits);
  },

  story(state) {
    if (state.at >= state.steps) return state.hits ? `They got through, taking ${state.hits} hit${state.hits === 1 ? "" : "s"} on the way.` : "They got through without a scratch.";
    if (state.hits >= state.maxHits) return "They took too much punishment and barely held together.";
    return "They cut the run short and went for it.";
  },
};
