// Navigation: plot a course across a chart. Each stop costs drift, and some hide a hazard that
// only a skilled navigator can see coming. The best route is rarely the obvious one.

import { between, chance, link, meter, panel, say, tone } from "./kit.js";

const LAYERS = [3, 4, 4, 5, 5];
const NODES = 3;
const HAZARD = [0.1, 0.2, 0.25, 0.3, 0.4];

const nameOf = (layer, row) => `${String.fromCharCode(97 + layer)}${row + 1}`;
const reachable = (from) => [from - 1, from, from + 1].filter((row) => row >= 0 && row < NODES);

// The cheapest and the costliest ways across, once every hazard is known.
function extremes(state) {
  let best = [0, 0, 0];
  let worst = [0, 0, 0];
  state.chart.forEach((layer, i) => {
    const costs = layer.map((node) => node.cost + (node.hazard ? 3 : 0));
    if (i === 0) {
      best = costs.map((cost, row) => (reachable(1).includes(row) ? cost : Infinity));
      worst = costs.map((cost, row) => (reachable(1).includes(row) ? cost : -Infinity));
      return;
    }
    best = costs.map((cost, row) => cost + Math.min(...reachable(row).map((from) => best[from])));
    worst = costs.map((cost, row) => cost + Math.max(...reachable(row).map((from) => worst[from])));
  });
  return { best: Math.min(...best), worst: Math.max(...worst) };
}

export default {
  start(ctx) {
    const chart = Array.from({ length: LAYERS[ctx.level] }, () => Array.from({ length: NODES }, () => ({
      cost: between(1, 6),
      hazard: chance(HAZARD[ctx.level]),
    })));
    return {
      chart,
      row: 1,
      layer: 0,
      total: 0,
      path: [],
      hazardsHit: 0,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "The chart comes up.", "dim"),
      say(`Plot a course across ${state.chart.length} stages. Each stop adds its drift, and you can only move one row at a time. Keep the total low.`, "info"),
      ...(ctx.tier >= 1 ? [say("Your training flags the hazards it can see on the chart with !.", "info")] : [say("Some stops hide a hazard worth +3 drift, and you can't tell which.", "warn")]),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const options = state.done ? [] : reachable(state.row);
    // How far ahead the hazards show depends on skill.
    const seesHazard = (layer) => (ctx.tier >= 4 ? true : ctx.tier >= 2 ? layer <= state.layer + 1 : ctx.tier >= 1 ? layer === state.layer : false);
    const header = [tone("START  ", "dim"), ...state.chart.map((_, i) => tone(`stage ${i + 1}  `, "dim")), tone("JUMP", "good")];
    const rows = [];
    for (let row = 0; row < NODES; row += 1) {
      const line = [tone(row === state.row && state.layer === 0 ? "  @    " : "       ", "bright")];
      state.chart.forEach((layer, i) => {
        const node = layer[row];
        const visited = state.path[i] === row;
        const hazardMark = node.hazard && (seesHazard(i) || visited) ? "!" : " ";
        const text = `${nameOf(i, row)}:${node.cost}${hazardMark}`;
        if (i === state.layer && options.includes(row)) line.push(link(text, `go ${nameOf(i, row)}`, node.hazard && seesHazard(i) ? "warn" : "link", `Go to ${nameOf(i, row)}, drift ${node.cost}`));
        else line.push(tone(text, visited ? "good" : i < state.layer ? "dim" : "info"));
        line.push(tone("   ", "dim"));
      });
      rows.push(line);
    }
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Nav Console", [], { terminal: true }),
        panel("chart", consoles.chart ?? "Star Chart", [
          header,
          ...rows,
          [tone(" ", "dim")],
          [tone(`Drift so far: ${state.total}`, "bright"), tone(state.hazardsHit ? `   Hazards hit: ${state.hazardsHit}` : "", "warn")],
        ], { grid: true }),
      ],
      commands: [],
      meters: [meter("DRIFT", state.total, Math.max(state.total, 24), "warn", String(state.total)), meter("STAGE", Math.min(state.layer + 1, state.chart.length), state.chart.length, "info", `${Math.min(state.layer + 1, state.chart.length)}/${state.chart.length}`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The course is laid in.", "dim")];
    const typed = words[0] === "go" || words[0] === "jump" || words[0] === "plot" ? words[1] : words[0];
    const match = /^([a-z])?(\d)$/.exec(typed ?? "");
    if (!match) return null;
    const row = Number(match[2]) - 1;
    if (match[1] && match[1].charCodeAt(0) - 97 !== state.layer) return [say("That's not the next stage.", "dim")];
    if (!reachable(state.row).includes(row)) return [say("You can't reach that one from here.", "bad")];
    const node = state.chart[state.layer][row];
    state.total += node.cost + (node.hazard ? 3 : 0);
    if (node.hazard) state.hazardsHit += 1;
    state.path.push(row);
    state.row = row;
    state.layer += 1;
    const lines = [say(`${nameOf(state.layer - 1, row)}: drift +${node.cost}.`, "dim")];
    if (node.hazard) lines.push(say(ctx.text.hazardLine ?? "Hazard! +3 drift.", "bad"));
    if (state.layer >= state.chart.length) {
      state.done = true;
      lines.push(say(`Course laid in, with ${state.total} drift.`, "info"));
    }
    return lines;
  },

  edge(state) {
    if (state.layer < state.chart.length) return Math.floor((state.layer / state.chart.length) * 2);
    const { best, worst } = extremes(state);
    if (worst === best) return 6;
    return Math.round((1 - (state.total - best) / (worst - best)) * 8) - 2;
  },

  story(state) {
    if (state.layer < state.chart.length) return "They rushed the calculation and didn't finish plotting the course.";
    const { best } = extremes(state);
    if (state.total <= best + 1) return "They found very nearly the best course there was.";
    return state.hazardsHit ? `They plotted a workable course, though it ran into ${state.hazardsHit} hazard${state.hazardsHit === 1 ? "" : "s"}.` : "They plotted a workable course, though not the best one.";
  },
};
