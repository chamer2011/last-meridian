// Engineering: a bank of relays where flipping one also flips the ones wired to it. Get them
// all live before you run out of time. The puzzle is made by scrambling a working bank, so
// there's always a way through.

import { bar, closest, command, link, meter, panel, pick, say, shuffle, tone } from "./kit.js";

const RELAYS = [5, 6, 7, 8, 9];
const SCRAMBLE = [2, 3, 3, 4, 5];

const nameOf = (i) => String.fromCharCode(65 + i);

// Each relay is wired to its neighbours around a ring. Bigger banks have cross-links too.
function wiring(count, level) {
  const links = Array.from({ length: count }, (_, i) => new Set([i, (i + 1) % count, (i + count - 1) % count]));
  if (level >= 3) {
    for (let i = 0; i < count; i += 3) {
      const other = (i + Math.floor(count / 2)) % count;
      links[i].add(other);
      links[other].add(i);
    }
  }
  return links.map((set) => [...set].sort((a, b) => a - b));
}

function flip(state, index) {
  for (const i of state.links[index]) state.on[i] = !state.on[i];
  // Flipping the same relay twice cancels out, so the known fix stays a true fix.
  const at = state.fix.indexOf(index);
  if (at >= 0) state.fix.splice(at, 1);
  else state.fix.push(index);
}

const allOn = (state) => state.on.every(Boolean);

export default {
  start(ctx) {
    const count = RELAYS[ctx.level];
    const state = {
      links: wiring(count, ctx.level),
      on: Array(count).fill(true),
      fix: [],
      moves: 0,
      maxMoves: 0,
      hints: ctx.tier,
      hinted: [],
      solved: false,
      done: false,
      forced: false,
    };
    for (const index of shuffle([...Array(count).keys()]).slice(0, SCRAMBLE[ctx.level])) flip(state, index);
    // In case the scramble happened to cancel itself out.
    if (allOn(state)) flip(state, 0);
    state.maxMoves = state.fix.length + 1 + ctx.tier;
    return state;
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "Panel open.", "dim"),
      say("Get every relay live. Flipping one also flips the ones wired to it, and each flip takes time you don't have.", "info"),
      ...(state.hints ? [say(`You know this kind of system: you can diagnose ${state.hints} time${state.hints === 1 ? "" : "s"}, to find a relay that needs flipping.`, "info")] : []),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const row = state.on.flatMap((on, i) => [
      state.done ? tone(`${nameOf(i)}[${on ? " ON" : "off"}]`, on ? "good" : "bad")
        : link(`${nameOf(i)}[${on ? " ON" : "off"}]`, `flip ${nameOf(i)}`, on ? "good" : "bad", `Flip ${nameOf(i)}`),
      tone(i < state.on.length - 1 ? "--" : "", "dim"),
    ]);
    const half = Math.ceil(row.length / 2);
    const wires = state.links.map((linked, i) => [
      tone(`${nameOf(i)} `, state.hinted.includes(i) ? "warn" : "info"),
      tone(`flips ${linked.map(nameOf).join(" ")}`, "dim"),
      ...(state.hinted.includes(i) ? [tone("  <- flip this one", "warn")] : []),
    ]);
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Diagnostics Console", [], { terminal: true }),
        panel("bus", consoles.bus ?? "Power Bus", [
          row.slice(0, half), row.slice(half),
          [tone(" ", "dim")],
          [tone(allOn(state) ? "BUS LIVE" : `${state.on.filter(Boolean).length} of ${state.on.length} relays live`, allOn(state) ? "good" : "warn")],
        ], { grid: true }),
        panel("wiring", consoles.wiring ?? "Wiring", wires, { grid: true }),
      ],
      commands: state.done ? [] : [
        ...(state.hints > 0 ? [command("diagnose", "diagnose", `${state.hints} left: finds a relay to flip`)] : []),
      ],
      meters: [meter("TIME", state.maxMoves - state.moves, state.maxMoves, state.moves >= state.maxMoves - 1 ? "bad" : "info", `${bar(state.maxMoves - state.moves, state.maxMoves, 8)} ${state.maxMoves - state.moves} flips left`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The panel's as good as it's going to get. Time to commit.", "dim")];
    const [verb, ...rest] = words;
    if (verb === "diagnose" || verb === "test" || verb === "hint") {
      if (state.hints <= 0) return [say("You've run all the diagnostics you can.", "bad")];
      const open = state.fix.filter((index) => !state.hinted.includes(index));
      const index = open.length ? pick(open) : state.fix[0];
      state.hints -= 1;
      if (index === undefined) return [say("Diagnostics say you're done.", "dim")];
      state.hinted = [index];
      return [say(`Diagnostics point to relay ${nameOf(index)}.`, "info")];
    }
    const name = verb === "flip" || verb === "toggle" ? rest[0] : verb;
    const letter = closest(name ?? "", state.on.map((_, i) => nameOf(i)));
    if (!letter) return verb === "flip" ? [say(`There's no relay ${name ?? ""}.`, "bad")] : null;
    const index = letter.charCodeAt(0) - 65;
    flip(state, index);
    state.moves += 1;
    state.hinted = state.hinted.filter((i) => state.fix.includes(i));
    const lines = [say(`Flipped ${letter}. ${state.on.filter(Boolean).length} of ${state.on.length} live.`, "dim")];
    if (allOn(state)) {
      state.solved = true;
      state.done = true;
      lines.push(say("BUS LIVE. Everything's holding.", "good"));
    } else if (state.moves >= state.maxMoves) {
      state.done = true;
      lines.push(say("Out of time. It's as good as it's going to get.", "warn"));
    }
    return lines;
  },

  edge(state) {
    if (state.solved) {
      const left = state.maxMoves - state.moves;
      return 4 + (left >= 2 ? 2 : left === 1 ? 1 : 0);
    }
    const live = state.on.filter(Boolean).length / state.on.length;
    return Math.floor(live * 3) - (state.moves >= state.maxMoves ? 1 : 0);
  },

  story(state) {
    if (state.solved) return `They got every relay live with ${state.maxMoves - state.moves} moves to spare, so the work is sound.`;
    return state.moves ? "They couldn't get it all working, so whatever they've done is a patch at best." : "They didn't stop to trace the fault, and just forced it.";
  },
};
