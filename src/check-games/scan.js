// Awareness: something in this picture is wrong. Find it before you run out of chances.
// How subtle it is depends on how hard the check is.

import { cellName, link, meter, panel, parseCell, pick, randomInt, say, shuffle, tone } from "./kit.js";

const SIZES = [[12, 4], [14, 5], [16, 5], [18, 6], [20, 6]];
const COUNTS = [2, 3, 3, 4, 4];

export default {
  start(ctx) {
    const [width, height] = SIZES[ctx.level];
    const pair = pick(ctx.text.pairs[ctx.level] ?? ctx.text.pairs[0]);
    const count = COUNTS[ctx.level];
    const cells = shuffle(Array.from({ length: width * height }, (_, i) => i)).slice(0, count);
    const hints = ctx.tier >= 4 ? 2 : ctx.tier >= 2 ? 1 : 0;
    return {
      width,
      height,
      base: pair[0],
      odd: pair[1],
      hidden: cells,
      found: [],
      wrong: [],
      marks: count + 2 + ctx.tier,
      used: 0,
      hintRows: shuffle(cells).slice(0, hints).map((cell) => Math.floor(cell / width)),
      noise: Array.from({ length: width * height }, () => (Math.random() < 0.08 ? randomInt(1000) : 0)),
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Look again.", "dim"),
      say(`${state.hidden.length} things here don't belong. Click each one you spot. A wrong guess uses up one of your chances.`, "info"),
      ...(state.hintRows.length ? [say(`Your instincts draw you to row ${[...new Set(state.hintRows)].map((row) => row + 1).join(" and ")}.`, "info")] : []),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const rows = [[tone(`    ${Array.from({ length: state.width }, (_, i) => String.fromCharCode(97 + i)).join(" ")}`, "dim")]];
    for (let y = 0; y < state.height; y += 1) {
      const line = [tone(`${String(y + 1).padStart(2)}  `, state.hintRows.includes(y) ? "warn" : "dim")];
      for (let x = 0; x < state.width; x += 1) {
        const index = y * state.width + x;
        const isOdd = state.hidden.includes(index);
        const symbol = isOdd ? state.odd : state.base;
        if (state.found.includes(index)) line.push(tone(symbol, "good"));
        else if (state.wrong.includes(index)) line.push(tone(symbol, "bad"));
        else if (state.done) line.push(tone(symbol, isOdd ? "warn" : "dim"));
        else line.push(link(symbol, `mark ${cellName(x, y)}`, "cell", cellName(x, y)));
        line.push(tone(x < state.width - 1 ? " " : "", "dim"));
      }
      rows.push(line);
    }
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Your Notes", [], { terminal: true }),
        panel("field", consoles.field ?? "What You're Looking At", rows, { grid: true }),
      ],
      commands: [],
      meters: [
        meter("FOUND", state.found.length, state.hidden.length, "good", `${state.found.length}/${state.hidden.length}`),
        meter("CHANCES", state.marks - state.used, state.marks, state.marks - state.used <= 1 ? "bad" : "info", `${state.marks - state.used} left`),
      ],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("That's all you can take in.", "dim")];
    const typed = words[0] === "mark" || words[0] === "look" || words[0] === "check" ? words.slice(1).join("") : words.join("");
    const cell = parseCell(typed);
    if (!cell || cell.x >= state.width || cell.y >= state.height) return words[0] === "mark" ? [say("That's off the edge.", "bad")] : null;
    const index = cell.y * state.width + cell.x;
    if (state.found.includes(index) || state.wrong.includes(index)) return [say("You've already looked there.", "dim")];
    state.used += 1;
    const lines = [];
    if (state.hidden.includes(index)) {
      state.found.push(index);
      lines.push(say(`${cellName(cell.x, cell.y)}: ${pick(ctx.text.foundLines ?? ["There."])}`, "good"));
    } else {
      state.wrong.push(index);
      lines.push(say(`${cellName(cell.x, cell.y)}: ${pick(ctx.text.wrongLines ?? ["Nothing."])}`, "dim"));
    }
    if (state.found.length === state.hidden.length) {
      state.done = true;
      lines.push(say(ctx.text.allFound ?? "You've got all of it.", "good"));
    } else if (state.used >= state.marks) {
      state.done = true;
      lines.push(say(ctx.text.outOfTime ?? "You can't look any longer.", "warn"));
    }
    return lines;
  },

  edge(state) {
    const found = state.found.length / state.hidden.length;
    return Math.round(found * 6) - (state.wrong.length > state.hidden.length ? 1 : 0);
  },

  story(state) {
    if (state.found.length === state.hidden.length) return "They spotted every detail that was out of place.";
    return state.found.length ? `They noticed some of it (${state.found.length} of ${state.hidden.length} details), and missed the rest.` : "They didn't notice anything out of place.";
  },
};
