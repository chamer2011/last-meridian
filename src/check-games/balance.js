// Medicine, Survival and Composure: three things to keep in the safe zone while the situation
// keeps pushing them around. You pick one response each turn.

import { bar, clamp, closest, link, meter, panel, pick, say, tone } from "./kit.js";

const TURNS = [4, 5, 5, 6, 6];
const PUSH = [1, 1, 1.25, 1.5, 2];

const inZone = (value, zone) => value >= zone[0] && value <= zone[1];
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const effects = (deltas, meters) => Object.entries(deltas).filter(([, n]) => n).map(([id, n]) => `${meters.find((m) => m.id === id)?.name ?? id} ${signed(n)}`).join(", ") || "no change";

function nextPush(state, ctx) {
  const event = pick(ctx.text.events);
  const scale = PUSH[ctx.level];
  return { text: event.text, deltas: Object.fromEntries(Object.entries(event.deltas).map(([id, n]) => [id, Math.round(n * scale)])) };
}

export default {
  start(ctx) {
    const meters = ctx.text.meters;
    const values = Object.fromEntries(meters.map((m) => [m.id, clamp(Math.round((m.zone[0] + m.zone[1]) / 2) + (ctx.level >= 2 ? pick([-2, -1, 1, 2]) : pick([-1, 0, 1])), 1, 9)]));
    const state = {
      values,
      turn: 0,
      turns: TURNS[ctx.level],
      score: 0,
      max: TURNS[ctx.level] * meters.length,
      queue: [],
      used: {},
      done: false,
      forced: false,
    };
    for (let i = 0; i < state.turns + 2; i += 1) state.queue.push(nextPush(state, ctx));
    return state;
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "It's on you.", "dim"),
      say(`Keep all three in the safe zone for ${state.turns} turns. Each turn, choose one response. Then things get pushed around again.`, "info"),
      ...(ctx.tier >= 2 ? [say("You've done this enough to see what's coming next.", "info")] : []),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const { meters } = ctx.text;
    const rows = meters.map((m) => {
      const value = state.values[m.id];
      const safe = inZone(value, m.zone);
      const scale = Array.from({ length: 11 }, (_, i) => {
        if (i === value) return "O";
        return inZone(i, m.zone) ? "=" : "-";
      }).join("");
      return [tone(m.name.padEnd(10), "bright"), tone(`[${scale}]`, safe ? "good" : value <= 0 || value >= 10 ? "bad" : "warn"), tone(` ${value}`, safe ? "good" : "warn")];
    });
    const coming = state.queue[state.turn];
    const forecast = ctx.tier >= 2 && coming && !state.done
      ? [[tone("Next: ", "dim"), tone(coming.text, "warn")], [tone(`      ${effects(coming.deltas, meters)}`, "dim")]]
      : ctx.tier >= 1 && coming && !state.done ? [[tone(`Something's coming: it'll hit ${effects(coming.deltas, meters).split(" ")[0]} first.`, "dim")]] : [];
    const actions = availableActions(state, ctx);
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Console", [], { terminal: true }),
        panel("monitor", consoles.monitor ?? "Monitor", [
          ...rows,
          [tone(" ", "dim")],
          ...forecast,
        ], { grid: true }),
        panel("chart", consoles.chart ?? "Responses", state.done ? [[tone("Nothing more you can do from here.", "dim")]] : actions.map((action) => [
          link(action.name, `do ${action.id}`, "link", action.desc ?? action.name),
          tone(`  ${effects(action.deltas, meters)}`, "dim"),
          ...(action.uses ? [tone(`  (${action.uses - (state.used[action.id] ?? 0)} left)`, "warn")] : []),
        ])),
      ],
      commands: [],
      meters: [meter("TURN", Math.min(state.turn + (state.done ? 0 : 1), state.turns), state.turns, "info", `${bar(state.turn, state.turns, 8)} ${Math.min(state.turn + (state.done ? 0 : 1), state.turns)}/${state.turns}`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("It's out of your hands now.", "dim")];
    const verb = words[0];
    const wanted = verb === "do" || verb === "use" || verb === "give" ? words.slice(1).join(" ") : words.join(" ");
    const actions = availableActions(state, ctx);
    let action = actions.find((entry) => entry.id === wanted);
    if (!action) {
      const name = closest(wanted, actions.map((entry) => entry.name));
      action = actions.find((entry) => entry.name === name);
    }
    if (!action) return /^\d+$/.test(wanted) && actions[Number(wanted) - 1] ? this.act(state, ctx, ["do", actions[Number(wanted) - 1].id]) : null;
    if (action.uses) state.used[action.id] = (state.used[action.id] ?? 0) + 1;
    apply(state, action.deltas);
    const push = state.queue[state.turn];
    const lines = [say(`${action.name}: ${action.line ?? "done."}`, "info")];
    apply(state, push.deltas);
    lines.push(say(push.text, "warn"));
    const { meters } = ctx.text;
    const safe = meters.filter((m) => inZone(state.values[m.id], m.zone)).length;
    const critical = meters.filter((m) => state.values[m.id] <= 0 || state.values[m.id] >= 10).length;
    state.score += safe - critical;
    state.turn += 1;
    lines.push(say(safe === meters.length ? "All steady." : `${safe} of ${meters.length} in the safe zone.`, safe === meters.length ? "good" : "dim"));
    if (state.turn >= state.turns) {
      state.done = true;
      lines.push(say("That's it. You've done what you can.", "info"));
    }
    return lines;
  },

  edge(state) {
    if (!state.turn) return 0;
    const share = state.score / state.max;
    // The penalty is for playing badly so far, not for having only just started.
    const sofar = state.score / ((state.max / state.turns) * state.turn);
    return Math.round(share * state.turn / state.turns * 8) - (sofar < 0.25 ? 2 : 0);
  },

  story(state) {
    const share = state.turn ? state.score / state.max : 0;
    if (state.turn < state.turns) return "They didn't see it through, and acted early.";
    if (share >= 0.8) return "They held everything steady from start to finish.";
    if (share >= 0.5) return "It got away from them a few times, but they kept control of it.";
    return "It got away from them more than once, and they had to scramble.";
  },
};

function apply(state, deltas) {
  for (const [id, n] of Object.entries(deltas)) state.values[id] = clamp((state.values[id] ?? 5) + n, 0, 10);
}

function availableActions(state, ctx) {
  return ctx.text.actions.filter((action) => (action.tier ?? 0) <= ctx.tier && (!action.uses || (state.used[action.id] ?? 0) < action.uses));
}
