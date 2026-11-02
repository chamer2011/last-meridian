// Tactics and Melee: read what the other side is about to do, and answer it. Each move beats one
// and loses to another. Your skill decides how far you can trust what you think you've seen.

import { bar, chance, closest, command, meter, panel, pick, randomInt, say, tone } from "./kit.js";

const ROUNDS = [3, 4, 5, 5, 6];

// Each move beats the next one around the circle.
const beats = (a, b, count) => (a - b + count) % count === 1;

function nextMove(state, count) {
  // Everyone has a habit, and a sharp eye can pick it up.
  const move = chance(0.45) ? state.habit : randomInt(count);
  const reliable = chance(state.reliability);
  state.current = { move, shown: reliable ? move : randomInt(count) };
}

export default {
  start(ctx) {
    const count = ctx.text.moves.length;
    const state = {
      habit: randomInt(count),
      reliability: 0.5 + ctx.tier * 0.1,
      rounds: ROUNDS[ctx.level],
      round: 0,
      score: 0,
      wins: 0,
      losses: 0,
      seen: [],
      current: null,
      done: false,
      forced: false,
    };
    nextMove(state, count);
    return state;
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "You size them up.", "dim"),
      say(`${state.rounds} exchanges. Each move beats one and loses to another: ${ctx.text.moves.map((move, i) => `${move.name} beats ${ctx.text.moves[(i + ctx.text.moves.length - 1) % ctx.text.moves.length].name}`).join(", ")}.`, "info"),
      say(fillRead(state, ctx), "warn"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const { moves } = ctx.text;
    const seenCounts = moves.map((move, i) => state.seen.filter((entry) => entry === i).length);
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "The Exchange", [], { terminal: true }),
        panel("board", consoles.board ?? "What You Can See", [
          ...(state.done || !state.current ? [] : [[tone(fillRead(state, ctx), "warn")], [tone(`You'd trust that about ${Math.round(state.reliability * 100)}% of the time.`, "dim")]]),
          [tone(" ", "dim")],
          [tone("Their habits so far:", "dim")],
          ...moves.map((move, i) => [tone(move.name.padEnd(14), "info"), tone(bar(seenCounts[i], Math.max(1, state.round), 8), "dim")]),
          [tone(" ", "dim")],
          [tone(`Won ${state.wins}, lost ${state.losses}.`, state.wins >= state.losses ? "good" : "bad")],
        ], { wide: true }),
      ],
      commands: state.done ? [] : moves.map((move) => command(move.name, `move ${move.id}`, move.hint ?? "")),
      meters: [meter("EXCHANGE", Math.min(state.round + 1, state.rounds), state.rounds, "info", `${Math.min(state.round + 1, state.rounds)}/${state.rounds}`), meter("AHEAD", Math.max(0, state.score), state.rounds, state.score > 0 ? "good" : "warn", String(state.score))],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("It's decided.", "dim")];
    const { moves } = ctx.text;
    const wanted = words[0] === "move" || words[0] === "do" ? words.slice(1).join(" ") : words.join(" ");
    let index = moves.findIndex((move) => move.id === wanted);
    if (index < 0 && /^\d+$/.test(wanted)) index = Number(wanted) - 1;
    if (index < 0 || index >= moves.length) {
      const name = closest(wanted, moves.map((move) => move.name));
      index = moves.findIndex((move) => move.name === name);
    }
    if (index < 0) return null;
    const theirs = state.current.move;
    state.seen.push(theirs);
    state.round += 1;
    const lines = [say(`You: ${moves[index].name}. They: ${moves[theirs].name}.`, "bright")];
    if (index === theirs) {
      lines.push(say(pick(ctx.text.tieLines ?? ["Neither of you gains anything."]), "dim"));
    } else if (beats(index, theirs, moves.length)) {
      state.score += 1;
      state.wins += 1;
      lines.push(say(pick(ctx.text.winLines ?? ["It works."]), "good"));
    } else {
      state.score -= 1;
      state.losses += 1;
      lines.push(say(pick(ctx.text.loseLines ?? ["They saw it coming."]), "bad"));
    }
    if (state.round >= state.rounds) {
      state.done = true;
      state.current = null;
      lines.push(say(`It's over: ${state.wins} won, ${state.losses} lost.`, "info"));
      return lines;
    }
    nextMove(state, moves.length);
    lines.push(say(fillRead(state, ctx), "warn"));
    return lines;
  },

  edge(state) {
    return Math.max(-2, Math.min(6, Math.round((state.score / state.rounds) * 6) + (state.wins && !state.losses ? 1 : 0)));
  },

  story(state) {
    if (state.round < state.rounds) return "They committed early, without reading the other side.";
    if (state.score > 0) return `They read the other side well, winning ${state.wins} exchanges to ${state.losses}.`;
    if (state.score === 0) return "It was an even contest, with neither side getting the better of it.";
    return `The other side read them instead, winning ${state.losses} exchanges to ${state.wins}.`;
  },
};

function fillRead(state, ctx) {
  const move = ctx.text.moves[state.current.shown];
  return move.tell ?? `It looks like they're about to ${move.name.toLowerCase()}.`;
}
