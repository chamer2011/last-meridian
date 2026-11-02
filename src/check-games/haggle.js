// Commerce: find their real price. Lowball too hard and they'll walk away. Settle too soon and
// you've paid too much. The numbers are how good the deal is, not actual credits.

import { bar, between, clamp, command, meter, panel, pick, say, tone } from "./kit.js";

const FLOOR = [55, 60, 65, 70, 75];
const RANGE = [18, 12, 8, 5, 2];

export default {
  start(ctx) {
    const floor = FLOOR[ctx.level] + between(-8, 8);
    const accuracy = RANGE[ctx.tier];
    // The range they think it's in, which always holds the true limit.
    return {
      floor,
      ask: 100,
      lastOffer: 0,
      patience: 4 + Math.floor(ctx.tier / 2),
      patienceMax: 4 + Math.floor(ctx.tier / 2),
      low: floor - between(0, accuracy),
      high: floor + between(0, accuracy),
      history: [],
      price: null,
      walked: false,
      done: false,
      forced: false,
    };
  },

  intro(state, ctx) {
    return [
      say(ctx.text.opening ?? "They name their price.", "dim"),
      say("They're asking 100. Make offers to find their real price. Offer too little, and they lose patience. Take the deal when you think it's as good as it gets.", "info"),
    ];
  },

  view(state, ctx) {
    const consoles = ctx.text.consoles ?? {};
    // Spread between the last offer and what they're asking, so that the buttons can really haggle.
    const low = state.lastOffer || 40;
    const offers = [0.75, 0.5, 0.25].map((share) => clamp(Math.round(low + (state.ask - low) * share), state.lastOffer + 1, 99));
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "The Table", [], { terminal: true }),
        panel("deal", consoles.deal ?? "The Deal", [
          [tone("THEY'RE ASKING  ", "bright"), tone(String(state.ask), "warn")],
          [tone("YOUR LAST OFFER ", "bright"), tone(state.lastOffer ? String(state.lastOffer) : "none yet", "info")],
          [tone("PATIENCE        ", "bright"), tone(bar(state.patience, state.patienceMax, 10), state.patience <= 1 ? "bad" : "warn")],
          [tone(" ", "dim")],
          [tone(ctx.tier >= 1 ? `You'd guess their real limit is around ${state.low} to ${state.high}.` : "You've no idea what their real limit is.", "dim")],
          ...state.history.slice(-4).map((entry) => [tone(`You: ${entry.offer}  They: ${entry.reply}`, "dim")]),
        ], { wide: true }),
      ],
      // Numbers typed here are offers, so the number keys don't pick commands.
      typedNumbers: true,
      commands: state.done ? [] : [
        command(`offer ${offers[0]}`, `offer ${offers[0]}`, "a small step"),
        command(`offer ${offers[1]}`, `offer ${offers[1]}`, "a real push"),
        command(`offer ${offers[2]}`, `offer ${offers[2]}`, "an insult, maybe"),
        command(`deal at ${state.ask}`, "deal", "take what's on the table"),
      ],
      meters: [meter("ASKING", state.ask, 100, "warn", String(state.ask))],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The deal's done, one way or another.", "dim")];
    const [verb, amount] = words;
    if (verb === "deal" || verb === "accept" || verb === "take") {
      state.price = state.ask;
      state.done = true;
      return [say(`You shake on ${state.ask}.`, "good"), say(pick(ctx.text.dealLines ?? ["Done."]), "info")];
    }
    const offer = Number(verb === "offer" || verb === "bid" ? amount : verb);
    if (!Number.isFinite(offer) || !Number.isInteger(offer)) return null;
    if (offer >= state.ask) {
      state.price = state.ask;
      state.done = true;
      return [say(`You've offered what they're asking, so that's a deal at ${state.ask}.`, "info")];
    }
    if (offer <= state.lastOffer) return [say(`You've already offered ${state.lastOffer}. Going backward would end this.`, "dim")];
    state.lastOffer = offer;
    if (offer >= state.floor) {
      // They'd take it, and they say so with a show of reluctance.
      state.price = offer;
      state.done = true;
      state.history.push({ offer, reply: "done" });
      return [say(`You offer ${offer}.`, "bright"), say(pick(ctx.text.acceptLines ?? ["They take it."]), "good")];
    }
    const insult = offer < state.floor * 0.75;
    state.patience -= insult ? 2 : 1;
    state.ask = Math.max(state.floor, Math.round(state.ask - (state.ask - state.floor) * (insult ? 0.15 : 0.4)));
    state.history.push({ offer, reply: state.ask });
    const lines = [say(`You offer ${offer}.`, "bright"), say(pick(insult ? ctx.text.insultLines ?? ["They laugh."] : ctx.text.counterLines ?? ["They come down a little."]), insult ? "bad" : "info"), say(`They're now asking ${state.ask}.`, "warn")];
    if (state.patience <= 0) {
      state.walked = true;
      state.done = true;
      lines.push(say(ctx.text.walkLine ?? "They've had enough, and they walk.", "bad"));
    }
    return lines;
  },

  edge(state) {
    if (state.walked) return -2;
    if (state.price === null) return Math.round(((100 - state.ask) / (100 - state.floor)) * 2);
    return Math.round(((100 - state.price) / (100 - state.floor)) * 6);
  },

  story(state) {
    if (state.walked) return "They pushed too hard, and the other side walked away from the table.";
    if (state.price === null) return "They didn't haggle much before making their move.";
    const share = (100 - state.price) / (100 - state.floor);
    return share >= 0.8 ? "They found the other side's real limit and got an excellent deal." : share >= 0.4 ? "They got a fair deal." : "They settled for a poor deal.";
  },
};
