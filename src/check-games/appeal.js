// Persuasion, Leadership and Streetwise: bring someone around before they lose patience. Each
// approach lands differently depending on what they care about. If the check is about someone
// with a file, or a faction, what they care about comes from their real beliefs.

import { bar, closest, link, meter, panel, pick, say, shuffle, tone } from "./kit.js";

const GOALS = [5, 6, 7, 8, 9];

// What each approach is worth to this audience, from -1 to 2.
function buildProfile(approaches, beliefs) {
  const profile = {};
  const known = beliefs && Object.keys(beliefs).length > 0;
  if (known) {
    for (const approach of approaches) {
      const pole = approach.pole;
      const value = pole ? (beliefs[pole.axis] ?? 0) * pole.sign : 0;
      profile[approach.id] = value >= 5 ? 2 : value >= 2 ? 1 : value <= -3 ? -1 : 0;
    }
  }
  // Fills in whatever their beliefs don't settle, so that there's always something to find.
  const good = Object.values(profile).filter((value) => value >= 1).length;
  const shuffled = shuffle(approaches);
  shuffled.forEach((approach, i) => {
    if (profile[approach.id] !== undefined && known) return;
    profile[approach.id] = i === 0 ? 2 : i === 1 ? 1 : i === 2 ? -1 : 0;
  });
  if (good === 0) {
    const open = shuffled.filter((approach) => profile[approach.id] === 0);
    if (open[0]) profile[open[0].id] = 2;
    if (open[1]) profile[open[1].id] = 1;
  }
  return profile;
}

export default {
  start(ctx) {
    const approaches = shuffle(ctx.text.approaches).slice(0, 6).map((approach) => ({
      id: approach.id,
      name: approach.name,
      pole: ctx.polesFor(approach.pole),
    }));
    return {
      order: approaches.map((approach) => approach.id),
      profile: buildProfile(approaches, ctx.audienceBeliefs()),
      used: {},
      conviction: Math.max(0, ctx.relationship),
      goal: GOALS[ctx.level],
      patience: 4 + Math.floor(ctx.tier / 2),
      patienceMax: 4 + Math.floor(ctx.tier / 2),
      history: [],
      won: false,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "They're listening, for now.", "dim"),
      say("Pick how you come at this. Each approach lands differently, and saying the same thing twice works less well. Watch how they react.", "info"),
      ...(ctx.relationship > 0 ? [say("They already think well of you, which gives you a start.", "good")] : []),
      ...(ctx.relationship < 0 ? [say("They don't think much of you, and it shows.", "bad")] : []),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    const approaches = state.order.map((id) => ctx.text.approaches.find((approach) => approach.id === id));
    const liked = state.order.filter((id) => state.profile[id] >= 1).sort((a, b) => state.profile[b] - state.profile[a]);
    const hated = state.order.filter((id) => state.profile[id] < 0);
    const flag = (id) => {
      if (ctx.tier >= 1 && liked[0] === id) return tone("  they'd respond to this", "good");
      if (ctx.tier >= 3 && liked[1] === id) return tone("  this might land", "good");
      if (ctx.tier >= 2 && hated[0] === id) return tone("  this would backfire", "bad");
      return null;
    };
    const read = ctx.tier === 0
      ? [[tone("You can't read them yet. You'll have to try things.", "dim")]]
      : [[tone(ctx.audienceName ? `Reading ${ctx.audienceName}:` : "Reading the room:", "dim")], [tone(ctx.tier >= 3 ? "You can see what moves them, and what won't." : "You can tell a little about what moves them.", "dim")]];
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Conversation", [], { terminal: true }),
        panel("read", consoles.read ?? "Their Reaction", [
          [tone("WON OVER  ", "bright"), tone(bar(state.conviction, state.goal, 12), state.conviction >= state.goal ? "good" : "info"), tone(` ${state.conviction}/${state.goal}`, "dim")],
          [tone("PATIENCE  ", "bright"), tone(bar(state.patience, state.patienceMax, 12), state.patience <= 1 ? "bad" : "warn"), tone(` ${state.patience}/${state.patienceMax}`, "dim")],
          [tone(" ", "dim")],
          ...read,
        ]),
        panel("approaches", consoles.approaches ?? "How You Come at It", state.done ? [[tone("The conversation's over.", "dim")]] : approaches.map((approach) => {
          const used = state.used[approach.id] ?? 0;
          return [link(approach.name, `say ${approach.id}`, "link", approach.name), ...(used ? [tone(`  (said it ${used === 1 ? "once" : `${used} times`})`, "dim")] : []), flag(approach.id)].filter(Boolean);
        }), { wide: true }),
      ],
      commands: [],
      meters: [meter(ctx.text.meterName ?? "WON OVER", state.conviction, state.goal, "good", `${state.conviction}/${state.goal}`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("You've said your piece.", "dim")];
    const verb = words[0];
    const wanted = ["say", "try", "use", "do"].includes(verb) ? words.slice(1).join(" ") : words.join(" ");
    const approaches = state.order.map((id) => ctx.text.approaches.find((approach) => approach.id === id));
    let approach = approaches.find((entry) => entry.id === wanted);
    if (!approach && /^\d+$/.test(wanted)) approach = approaches[Number(wanted) - 1];
    if (!approach) {
      const name = closest(wanted, approaches.map((entry) => entry.name));
      approach = approaches.find((entry) => entry.name === name);
    }
    if (!approach) return null;
    const repeats = state.used[approach.id] ?? 0;
    state.used[approach.id] = repeats + 1;
    const effect = state.profile[approach.id] - repeats;
    state.conviction = Math.max(0, state.conviction + Math.max(effect, -1));
    state.patience = Math.max(0, state.patience - (effect < 0 ? 2 : 1));
    const lines = [say(`"${approach.line ?? approach.name}"`, "bright")];
    const reactions = ctx.text.reactions ?? {};
    const kind = effect >= 2 ? "strong" : effect === 1 ? "good" : effect === 0 ? "flat" : "bad";
    lines.push(say(pick(reactions[kind] ?? ["They think about it."]), kind === "bad" ? "bad" : kind === "flat" ? "dim" : "good"));
    if (state.conviction >= state.goal) {
      state.won = true;
      state.done = true;
      lines.push(say(ctx.text.wonLine ?? "They're with you.", "good"));
    } else if (state.patience <= 0) {
      state.done = true;
      lines.push(say(ctx.text.lostLine ?? "They've heard enough.", "warn"));
    }
    return lines;
  },

  edge(state) {
    if (state.won) return 6;
    const share = state.conviction / state.goal;
    const base = Math.round(share * 5);
    return state.patience <= 0 && state.conviction === 0 ? -2 : base;
  },

  story(state, ctx) {
    const who = ctx.audienceName ?? "They";
    if (state.won) return `${who} came all the way around during the conversation.`;
    if (state.patience <= 0) return `${who} lost patience before the player finished making the case${state.conviction >= state.goal / 2 ? ", though some of it landed" : ""}.`;
    return "They made their case quickly, without stopping to read the room.";
  },
};
