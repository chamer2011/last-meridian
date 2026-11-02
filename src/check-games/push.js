// Manifestation and Intimidation: push harder for a stronger result, and stop before it breaks.
// Skill makes each push more predictable.

import { between, command, meter, panel, pick, say, tone } from "./kit.js";

const LIMIT = 21;
const BAND = [7, 6, 5, 4, 3];
const STEP = [[1, 8], [2, 7], [2, 6], [3, 6], [3, 5]];

export default {
  start(ctx) {
    const blur = ctx.tier >= 2 ? 0 : between(-2, 2);
    return {
      gauge: between(1, 3),
      limit: LIMIT + blur,
      shown: LIMIT,
      exact: ctx.tier >= 2,
      band: BAND[ctx.level],
      step: STEP[ctx.tier],
      pushes: 0,
      held: false,
      broke: false,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "You reach for it.", "dim"),
      say(`Push to build it up. Each push adds between ${state.step[0]} and ${state.step[1]}. Hold when it's where you want it. Past the limit, it breaks.`, "info"),
      ...(state.exact ? [] : [say("You can't be sure exactly where the limit is. It's somewhere around the mark.", "warn")]),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const width = 26;
    const start = state.shown - state.band;
    const scale = Array.from({ length: width }, (_, i) => {
      if (i === state.gauge) return "O";
      if (i < state.gauge) return "#";
      if (i >= start && i <= state.shown) return "=";
      return i > state.shown ? "x" : "-";
    }).join("");
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Focus", [], { terminal: true }),
        panel("gauge", consoles.gauge ?? "Pressure", [
          [tone(scale, state.broke ? "bad" : state.gauge >= start ? "good" : "info")],
          [tone(`Now: ${state.gauge}   Strong from ${start}   Limit: ${state.exact ? state.shown : `about ${state.shown}`}`, "dim")],
          [tone(state.broke ? (ctx.text.brokeLabel ?? "IT BROKE") : state.gauge >= start ? (ctx.text.goodLabel ?? "STRONG") : (ctx.text.weakLabel ?? "BUILDING"), state.broke ? "bad" : state.gauge >= start ? "good" : "warn")],
        ], { grid: true }),
      ],
      commands: state.done ? [] : [
        command(ctx.text.pushName ?? "push", "push", `adds ${state.step[0]} to ${state.step[1]}`),
        command(ctx.text.holdName ?? "hold", "hold", "stop here"),
      ],
      meters: [meter("PRESSURE", state.gauge, state.shown, state.gauge >= start ? "good" : "warn", `${state.gauge}/${state.exact ? state.shown : `~${state.shown}`}`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("It's done.", "dim")];
    const verb = words[0];
    if (verb === "hold" || verb === "stop" || verb === "enough") {
      state.held = true;
      state.done = true;
      return [say(pick(ctx.text.holdLines ?? ["You hold it there."]), "info")];
    }
    if (verb !== "push" && verb !== "more" && verb !== "press") return null;
    const added = between(state.step[0], state.step[1]);
    state.gauge += added;
    state.pushes += 1;
    if (state.gauge > state.limit) {
      state.broke = true;
      state.done = true;
      state.forced = true;
      return [say(pick(ctx.text.breakLines ?? ["It breaks."]), "bad")];
    }
    return [say(`${pick(ctx.text.pushLines ?? ["Harder."])} (+${added})`, state.gauge >= state.shown - state.band ? "good" : "dim")];
  },

  edge(state) {
    if (state.broke) return -3;
    const start = state.shown - state.band;
    if (state.gauge < start) return Math.round((state.gauge / start) * 3);
    return 4 + Math.round(((state.gauge - start) / state.band) * 2);
  },

  story(state) {
    if (state.broke) return "They pushed too far and it broke on them, so it's visibly gone wrong.";
    if (!state.held) return "They acted without building up to it.";
    return state.gauge >= state.shown - 2 ? "They pushed right to the edge and held it there." : state.gauge >= state.shown - state.band ? "They built it up strongly and held control." : "They played it safe and held back.";
  },
};
