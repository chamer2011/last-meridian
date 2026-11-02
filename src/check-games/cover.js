// Deception: keep a cover story alive under questioning. Watch for tells: if they already know
// the answer, a bold lie sinks you, and if they don't, a bold lie sells it.

import { bar, chance, command, meter, panel, pick, say, shuffle, tone } from "./kit.js";

const ROUNDS = [3, 4, 4, 5, 5];
const KNOWS = [0.3, 0.4, 0.5, 0.6, 0.7];

function nextQuestion(state, ctx) {
  const question = state.questions[state.round];
  const knows = chance(KNOWS[ctx.level]);
  // A skilled liar reads the tell correctly more often.
  const accurate = chance(0.6 + ctx.tier * 0.1);
  const showsKnowing = accurate ? knows : !knows;
  state.current = { question, knows, tell: pick(showsKnowing ? ctx.text.knowsTells : ctx.text.blankTells) };
}

export default {
  start(ctx) {
    const rounds = ROUNDS[ctx.level];
    const state = {
      questions: shuffle(ctx.text.questions).slice(0, rounds),
      rounds,
      round: 0,
      belief: 0,
      suspicion: 0,
      maxSuspicion: 3 + Math.floor(ctx.tier / 2),
      deflects: 2,
      current: null,
      done: false,
      forced: false,
    };
    nextQuestion(state, ctx);
    return state;
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "They've got questions.", "dim"),
      say("Answer each question. A bold lie sells your story, unless they already know the truth. So watch how they ask.", "info"),
      say(`Q: "${state.current.question}"`, "bright"),
      say(state.current.tell, "warn"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Under Questioning", [], { terminal: true }),
        panel("read", consoles.read ?? "How It's Going", [
          [tone("BELIEVED   ", "bright"), tone(bar(state.belief, state.rounds * 2, 12), "good"), tone(` ${state.belief}`, "dim")],
          [tone("SUSPICION  ", "bright"), tone(bar(state.suspicion, state.maxSuspicion, 12), state.suspicion >= state.maxSuspicion - 1 ? "bad" : "warn"), tone(` ${state.suspicion}/${state.maxSuspicion}`, "dim")],
          [tone(" ", "dim")],
          ...(state.done || !state.current ? [] : [
            [tone("They ask: ", "dim"), tone(state.current.question, "bright")],
            [tone(state.current.tell, "warn")],
          ]),
        ], { wide: true }),
      ],
      commands: state.done ? [] : [
        command("lie boldly", "bold", "sells it, unless they already know"),
        command("stick to the story", "plain", "safe, a small gain"),
        ...(state.deflects > 0 ? [command("deflect", "deflect", `no gain, no risk (${state.deflects} left)`)] : []),
      ],
      meters: [meter("QUESTION", Math.min(state.round + 1, state.rounds), state.rounds, "info", `${Math.min(state.round + 1, state.rounds)}/${state.rounds}`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The questions have stopped.", "dim")];
    const choice = { bold: "bold", lie: "bold", embellish: "bold", plain: "plain", stick: "plain", story: "plain", safe: "plain", deflect: "deflect", dodge: "deflect" }[words[0]];
    if (!choice) return null;
    if (choice === "deflect" && state.deflects <= 0) return [say("You can't dodge again without it looking like what it is.", "bad")];
    const { knows } = state.current;
    const lines = [];
    if (choice === "bold") {
      if (knows) {
        state.suspicion += 2;
        lines.push(say(pick(ctx.text.caught), "bad"));
      } else {
        state.belief += 2;
        lines.push(say(pick(ctx.text.sold), "good"));
      }
    } else if (choice === "plain") {
      if (knows) {
        state.suspicion += 1;
        lines.push(say(pick(ctx.text.shaky), "warn"));
      } else {
        state.belief += 1;
        lines.push(say(pick(ctx.text.fine), "info"));
      }
    } else {
      state.deflects -= 1;
      lines.push(say(pick(ctx.text.dodged), "dim"));
    }
    state.round += 1;
    if (state.suspicion >= state.maxSuspicion) {
      state.done = true;
      state.forced = true;
      state.current = null;
      lines.push(say(ctx.text.blownLine ?? "They've stopped believing a word of it.", "bad"));
      return lines;
    }
    if (state.round >= state.rounds) {
      state.done = true;
      state.current = null;
      lines.push(say(ctx.text.endLine ?? "That's the last of the questions.", "info"));
      return lines;
    }
    nextQuestion(state, ctx);
    lines.push(say(`Q: "${state.current.question}"`, "bright"), say(state.current.tell, "warn"));
    return lines;
  },

  edge(state) {
    if (state.suspicion >= state.maxSuspicion) return -3;
    return Math.max(-2, Math.min(6, Math.round((6 * (state.belief - state.suspicion)) / (state.rounds * 1.1))));
  },

  story(state) {
    if (state.suspicion >= state.maxSuspicion) return "Their cover story fell apart under questioning.";
    if (state.round < state.rounds) return "They cut the questions short and bluffed the rest.";
    return state.suspicion ? "Their story mostly held, though it was caught out at least once." : "Their story held all the way through, without a single slip.";
  },
};
