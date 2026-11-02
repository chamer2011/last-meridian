// Science and Lore: work out a hidden sequence of symbols. Each attempt says how many are in
// the right place, and how many are right but in the wrong place.

import { bar, between, command, link, meter, panel, randomInt, say, shuffle, tone } from "./kit.js";

const SLOTS = [3, 4, 4, 5, 5];
const SYMBOLS = [5, 6, 6, 7, 8];

function score(guess, code) {
  let exact = 0;
  const leftCode = {};
  const leftGuess = {};
  guess.forEach((symbol, i) => {
    if (symbol === code[i]) exact += 1;
    else {
      leftCode[code[i]] = (leftCode[code[i]] ?? 0) + 1;
      leftGuess[symbol] = (leftGuess[symbol] ?? 0) + 1;
    }
  });
  const near = Object.keys(leftGuess).reduce((sum, symbol) => sum + Math.min(leftGuess[symbol], leftCode[symbol] ?? 0), 0);
  return { exact, near };
}

export default {
  start(ctx) {
    const slots = SLOTS[ctx.level];
    const symbols = shuffle(ctx.text.symbols ?? ["A", "B", "C", "D", "E", "F", "G", "H"]).slice(0, SYMBOLS[ctx.level]);
    // Harder codes can repeat a symbol.
    const code = ctx.level >= 2
      ? Array.from({ length: slots }, () => randomInt(symbols.length))
      : shuffle(symbols.map((_, i) => i)).slice(0, slots);
    return {
      symbols,
      code,
      current: [],
      guesses: [],
      maxGuesses: 4 + ctx.tier + (ctx.level === 0 ? 1 : 0),
      known: ctx.tier >= 3 ? [randomInt(slots)] : [],
      repeats: ctx.level >= 2,
      best: 0,
      solved: false,
      spectrum: Array.from({ length: 24 }, () => between(1, 5)),
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Sample captured.", "dim"),
      say(`Find the ${state.code.length} symbols in order. ${state.repeats ? "A symbol can come up more than once." : "No symbol comes up twice."}`, "info"),
      say("Click symbols to build an attempt. Each one tells you how many are exact, and how many are in the wrong place.", "info"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const slotCount = state.code.length;
    const pad = state.symbols.map((symbol, i) => link(` ${symbol} `, `add ${i + 1}`, "link", `Add ${symbol}`));
    const building = Array.from({ length: slotCount }, (_, i) => {
      if (state.current[i] !== undefined) return state.symbols[state.current[i]];
      return state.known.includes(i) ? `(${state.symbols[state.code[i]]})` : "_";
    }).join(" ");
    const heights = state.spectrum.map((height) => " .:-=+*#%"[Math.min(8, height + state.best)]).join("");
    const history = state.guesses.length
      ? state.guesses.map((entry) => [
        tone(`${entry.guess.map((i) => state.symbols[i]).join(" ")}  `, "bright"),
        tone("#".repeat(entry.exact), "good"), tone("o".repeat(entry.near), "warn"),
        tone(".".repeat(slotCount - entry.exact - entry.near), "dim"),
        tone(`  ${entry.exact} exact, ${entry.near} misplaced`, "dim"),
      ])
      : [[tone("No attempts yet.", "dim")]];
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Analysis Console", [], { terminal: true }),
        panel("signal", consoles.signal ?? "Signal", [
          [tone(heights, state.solved ? "good" : "info")],
          [tone("Building: ", "dim"), tone(building, "bright")],
          ...(state.known.length ? [[tone(`Your training tells you the symbol in (brackets).`, "dim")]] : []),
          [tone(" ", "dim")],
          state.done ? [tone("The pad is closed.", "dim")] : pad,
        ], { grid: true }),
        panel("history", consoles.history ?? "Results", history, { grid: true }),
      ],
      // Numbers typed here pick symbols, so the number keys don't pick commands.
      typedNumbers: true,
      commands: state.done ? [] : [
        command("back", "back", "take back the last symbol", { disabled: state.current.length === 0 }),
      ],
      meters: [meter("ATTEMPTS", state.maxGuesses - state.guesses.length, state.maxGuesses, state.guesses.length >= state.maxGuesses - 1 ? "bad" : "info", `${bar(state.maxGuesses - state.guesses.length, state.maxGuesses, 8)} ${state.maxGuesses - state.guesses.length} left`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("That's all the attempts you've got. Time to commit.", "dim")];
    const [verb, ...rest] = words;
    if (verb === "back" || verb === "undo") {
      state.current.pop();
      return [];
    }
    // Whole attempts can be typed in one go, as numbers or symbols.
    const tokens = (verb === "add" ? rest : words).join(" ").split(/[\s,]+/).filter(Boolean)
      .flatMap((token) => (/^\d{2,}$/.test(token) || state.symbols.every((symbol) => symbol.length === 1) ? [...token] : [token]));
    const indexes = tokens.map((token) => {
      const asNumber = /^\d+$/.test(token) ? Number(token) - 1 : -1;
      if (asNumber >= 0 && asNumber < state.symbols.length) return asNumber;
      return state.symbols.findIndex((symbol) => symbol.toLowerCase() === token.toLowerCase());
    });
    if (!indexes.length || indexes.some((index) => index < 0)) return null;
    const out = [];
    for (const index of indexes) {
      state.current.push(index);
      if (state.current.length === state.code.length) {
        out.push(...evaluate(state));
        if (state.done) break;
      }
    }
    return out;
  },

  edge(state) {
    if (state.solved) {
      const left = state.maxGuesses - state.guesses.length;
      return 4 + (left >= 2 ? 2 : left === 1 ? 1 : 0);
    }
    return Math.floor((state.best / state.code.length) * 3);
  },

  story(state) {
    if (state.solved) return `They worked it out in ${state.guesses.length} attempts, so they understand what they're looking at.`;
    return state.guesses.length ? "They got part of the way there, and had to go with a partial answer." : "They didn't stop to work it through.";
  },
};

function evaluate(state) {
  const guess = state.current;
  state.current = [];
  const { exact, near } = score(guess, state.code);
  state.guesses.push({ guess, exact, near });
  state.best = Math.max(state.best, exact);
  if (exact === state.code.length) {
    state.solved = true;
    state.done = true;
    return [say(`${guess.map((i) => state.symbols[i]).join(" ")}: a perfect match.`, "good")];
  }
  const line = say(`${guess.map((i) => state.symbols[i]).join(" ")}: ${exact} exact, ${near} misplaced.`, exact ? "info" : "dim");
  if (state.guesses.length < state.maxGuesses) return [line];
  state.done = true;
  return [line, say("That's as far as you can take it.", "warn")];
}
