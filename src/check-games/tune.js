// Attunement: find the one place on the dial where the thing you're listening for comes
// through. Every time you listen, it costs you, so you can't just sweep the whole range.

import { bar, between, clamp, command, meter, panel, randomInt, say, tone } from "./kit.js";

// How much the reading wavers on a harder check.
const NOISE = [0, 1, 2, 3, 4];

// How far off you can be and still hear anything, by difficulty.
const WIDTH = [30, 24, 18, 14, 10];
const strength = (state, at) => clamp(Math.round(100 * Math.exp(-(((at - state.hidden) / state.width) ** 2))) + state.noise, 0, 100);

function wave(power) {
  const height = Math.round(power / 12);
  const shapes = " .,-~^*#%@";
  return Array.from({ length: 30 }, (_, i) => shapes[clamp(Math.round(height * Math.abs(Math.sin(i * 0.7 + power))), 0, 9)]).join("");
}

export default {
  start(ctx) {
    return {
      hidden: between(5, 94),
      width: WIDTH[ctx.level],
      dial: 50,
      listens: 0,
      maxListens: 4 + ctx.tier,
      readings: [],
      noise: 0,
      noiseSize: Math.max(0, NOISE[ctx.level] - Math.floor(ctx.tier / 2)),
      best: null,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "You let the room go quiet.", "dim"),
      say("Set the dial, then listen. It comes through stronger the closer you are. Each time you listen, it costs you.", "info"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const scale = Array.from({ length: 41 }, (_, i) => (i === Math.round(state.dial * 0.4) ? "|" : i % 10 === 0 ? "+" : "-")).join("");
    const last = state.readings.at(-1);
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Stillness", [], { terminal: true }),
        panel("dial", consoles.dial ?? "The Field", [
          [tone(wave(last?.power ?? 0), (last?.power ?? 0) >= 80 ? "good" : "info")],
          [tone(scale, "dim")],
          [tone(`Dial: ${state.dial}`, "bright"), tone(last ? `   Last: ${last.power}% at ${last.at}` : "", "dim")],
          [tone(" ", "dim")],
          ...state.readings.slice(-5).map((reading) => [tone(`${String(reading.at).padStart(3)}  `, "dim"), tone(bar(reading.power, 100, 14), reading.power >= 80 ? "good" : "info"), tone(` ${reading.power}%`, "dim")]),
        ], { grid: true }),
      ],
      // Numbers typed here are dial settings, so the number keys don't pick commands.
      typedNumbers: true,
      commands: state.done ? [] : [
        command("-10", "dial -10", "", { key: "ArrowDown" }),
        command("-1", "dial -1", "", { key: "ArrowLeft" }),
        command("+1", "dial +1", "", { key: "ArrowRight" }),
        command("+10", "dial +10", "", { key: "ArrowUp" }),
        command("listen", "listen", `${state.maxListens - state.listens} left`, { key: "Enter" }),
      ],
      meters: [meter("STRAIN", state.listens, state.maxListens, state.listens >= state.maxListens - 1 ? "bad" : "warn", `${bar(state.listens, state.maxListens, 8)} ${state.maxListens - state.listens} left`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("You can't hold it any longer.", "dim")];
    const [verb, amount] = words;
    if (verb === "dial" || verb === "tune" || verb === "set" || /^[+-]?\d+$/.test(verb)) {
      const text = verb === "dial" || verb === "tune" || verb === "set" ? amount : verb;
      if (!/^[+-]?\d+$/.test(text ?? "")) return [say("Give the dial a number.", "dim")];
      state.dial = clamp(/^[+-]/.test(text) ? state.dial + Number(text) : Number(text), 0, 99);
      return [];
    }
    if (verb !== "listen" && verb !== "reach" && verb !== "sense") return null;
    state.noise = state.noiseSize ? randomInt(state.noiseSize * 2 + 1) - state.noiseSize : 0;
    const power = strength(state, state.dial);
    state.readings.push({ at: state.dial, power });
    state.listens += 1;
    if (state.best === null || power > state.best) state.best = power;
    const previous = state.readings.at(-2);
    const trend = previous ? (power > previous.power ? (ctx.text.warmer ?? "Stronger.") : power < previous.power ? (ctx.text.colder ?? "Fainter.") : "No change.") : "";
    const lines = [say(`At ${state.dial}: ${power}%. ${trend}`.trim(), power >= 80 ? "good" : "info")];
    if (power >= 98) {
      state.done = true;
      lines.push(say(ctx.text.foundLine ?? "There. Clear as a bell.", "good"));
    } else if (state.listens >= state.maxListens) {
      state.done = true;
      lines.push(say(ctx.text.spentLine ?? "That's all you can hold. You have to go with what you've got.", "warn"));
    }
    return lines;
  },

  edge(state) {
    if (state.best === null) return 0;
    if (state.best >= 96) return 6;
    if (state.best >= 90) return 5;
    if (state.best >= 80) return 4;
    if (state.best >= 65) return 3;
    if (state.best >= 45) return 2;
    return 1;
  },

  story(state) {
    if (state.best === null) return "They reached out blindly, without really listening.";
    if (state.best >= 90) return "They found it clearly, and held it without strain.";
    if (state.best >= 65) return "They caught hold of it, though not cleanly.";
    return "They only caught the edge of it.";
  },
};
