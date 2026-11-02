// The character creator. The server works out all the rules: after every choice
// this page sends the draft to the server, then draws whatever comes back.

import { beliefBar, api, el, signed } from "./dom.js";

const PROMPT = "dossier@meridian:~$";
// Fields the player types into, which must survive a preview that's already on its way back.
const TYPED_FIELDS = ["name", "callsign", "customPronouns", "appearance", "bondName"];

const state = {
  setup: null,
  draft: null,
  view: null,
  step: "start",
  message: null,
  sheetOpen: false,
  confirmRandom: false,
  scrollToTerm: false,
  visited: new Set(["start"]),
  token: 0,
  options: [],
};

let hooks = { render() {}, begin() {}, exit() {} };

export function initCreator(callbacks) {
  hooks = callbacks;
}

export async function openCreator(setup) {
  state.setup = setup;
  if (!state.draft) {
    state.draft = {};
    state.step = "start";
  }
  await refresh();
  hooks.render();
}

export function resetCreator() {
  state.draft = null;
  state.view = null;
  state.step = "start";
  state.message = null;
  state.sheetOpen = false;
  state.visited = new Set(["start"]);
}

// ---- Talking to the server ----------------------------------------------

function adopt(view) {
  const typed = state.draft ? Object.fromEntries(TYPED_FIELDS.map((f) => [f, state.draft[f]])) : {};
  state.view = view;
  state.draft = view.draft;
  for (const [field, value] of Object.entries(typed)) if (value !== undefined) state.draft[field] = value;
}

async function refresh() {
  state.token += 1;
  const token = state.token;
  const view = await api("/api/creator/preview", { draft: state.draft });
  if (token !== state.token) return false;
  adopt(view);
  return true;
}

function guarded(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      state.message = { ok: false, text: err.message };
      hooks.render();
    }
  };
}

const change = guarded(async (fn, message = null) => {
  fn(state.draft);
  state.message = message;
  state.confirmRandom = false;
  if (await refresh()) hooks.render();
});

// While typing, only the summary panels update, so the field being typed in isn't redrawn.
let softTimer;
function softRefresh() {
  clearTimeout(softTimer);
  softTimer = setTimeout(guarded(async () => {
    if (await refresh()) {
      document.getElementById("creator-sheet")?.replaceWith(sheetNode());
      document.getElementById("creator-steps")?.replaceWith(stepBar());
    }
  }), 150);
}

const randomize = guarded(async (archetype = null, label = "A random person") => {
  const d = state.draft;
  const view = await api("/api/creator/random", {
    archetype,
    anyone: !archetype,
    keep: { name: d.name, callsign: d.callsign, pronouns: d.pronouns, customPronouns: d.customPronouns, appearance: d.appearance, start: d.start },
  });
  state.token += 1;
  state.draft = null;
  adopt(view);
  state.step = "review";
  state.visited = new Set(stepIds());
  state.confirmRandom = false;
  state.message = { ok: true, text: `${label} is ready. Every step can still be changed, or you can begin right away.` };
  hooks.render();
});

function askRandom() {
  const started = state.draft.name || state.draft.species || state.view.life.started;
  if (started && !state.confirmRandom) {
    state.confirmRandom = true;
    state.message = { ok: false, text: "This replaces your choices so far. Your name and pronouns are kept. Press Randomize again to confirm." };
    hooks.render();
    return;
  }
  randomize();
}

const begin = guarded(async () => {
  await hooks.begin(state.draft);
});

// ---- Navigation ---------------------------------------------------------

const stepIds = () => ["start", ...state.setup.steps.map((s) => s.id), "review"];

const stepLabel = (id) => (id === "start" ? "Start" : id === "review" ? "Review" : state.setup.steps.find((s) => s.id === id).label);

function goTo(id) {
  state.step = id;
  state.visited.add(id);
  state.message = null;
  state.confirmRandom = false;
  hooks.render();
}

function move(by) {
  const ids = stepIds();
  const next = ids[ids.indexOf(state.step) + by];
  if (next) goTo(next);
}

function stepStatus(id) {
  const { errors, warnings, complete } = state.view;
  if (id === "start") return "done";
  if (id === "review") return complete ? "done" : "todo";
  if (errors[id].length || !state.visited.has(id)) return "todo";
  return warnings[id].length ? "warn" : "done";
}

function stepBar() {
  const mark = { done: "*", warn: "~", todo: " " };
  return el("nav", { class: "stepbar", id: "creator-steps", "aria-label": "Character creation steps" }, stepIds().map((id) => {
    const status = stepStatus(id);
    return el("button", {
      class: `step ${status}${id === state.step ? " current" : ""}`,
      "aria-current": id === state.step ? "step" : "false",
      onclick: () => goTo(id),
    }, `${mark[status]}${stepLabel(id)}`);
  }));
}

// ---- Shared pieces ------------------------------------------------------

// Registers something that can be picked by typing its number at the prompt.
function option(actions) {
  state.options.push(actions);
  return state.options.length;
}

const num = (n) => el("span", { class: "num" }, `${String(n).padStart(2, " ")})`);
const effectsLine = (effects) => (effects?.length ? el("div", { class: "effects small" }, effects.join(" | ")) : null);
const heading = (title, intro) => [el("h2", { class: "step-title" }, title), intro && el("p", { class: "muted small step-intro" }, intro)];
const points = (label, left, extra) => el("div", { class: `points${left < 0 ? " over" : ""}` }, `${label}: ${left} left`, extra && el("span", { class: "muted" }, ` ${extra}`));

function lockedNotice() {
  if (!state.view.life.started) return null;
  return el("div", { class: "card stack lock" },
    el("div", {}, "Your life has already been lived, and it depended on these choices. To change them, restart your life history."),
    el("div", {}, el("button", { onclick: () => restartLife() }, "Restart life history")));
}

function restartLife() {
  change((d) => {
    d.life = { seed: Math.floor(Math.random() * 2147483647), terms: [], finished: false, fall: null };
  }, { ok: true, text: "Your life history has been cleared. It will play out differently this time." });
}

// A selectable card. "action" cards do something right away, so they don't look like a checkbox.
function choiceCard({ selected, disabled, title, desc, effects, onclick, right, check, action }) {
  const n = disabled ? null : option({ run: onclick });
  return el("button", {
    class: `card selectable${check ? " check" : ""}${action ? " action" : ""}${selected ? " selected" : ""}`,
    disabled,
    ...(action ? {} : { "aria-pressed": String(Boolean(selected)) }),
    onclick,
  },
  el("div", { class: "spread" }, el("span", {}, n && num(n), " ", el("strong", {}, title)), right && el("span", { class: "small" }, right)),
  desc && el("div", { class: "muted small" }, desc),
  effectsLine(effects));
}

function singleChoice(list, field, { locked = false } = {}) {
  return Object.values(list).map((entry) => choiceCard({
    selected: state.draft[field] === entry.id,
    disabled: locked,
    title: entry.name,
    desc: entry.desc,
    effects: entry.effects,
    onclick: () => change((d) => { d[field] = entry.id; }),
  }));
}

// ---- Steps --------------------------------------------------------------

function startStep() {
  const { archetypes } = state.setup;
  return [
    ...heading("Open a new dossier", "Build someone one decision at a time, or start from a ready-made captain and change whatever you like. You don't have to be the captain: that's your choice under Your place."),
    choiceCard({
      action: true,
      title: "Build from scratch",
      desc: "Choose your species, origins and attributes, live your life term by term, then pick your skills, traits and beliefs.",
      onclick: () => goTo("identity"),
    }),
    choiceCard({
      action: true,
      title: "Surprise me",
      desc: "Generate a whole person at random, with their life and their place in the world. It might be the captain, and it might be someone with a mop.",
      onclick: askRandom,
    }),
    el("h3", { class: "group" }, "Ready-made captains"),
    Object.values(archetypes).map((a) => choiceCard({
      action: true,
      title: a.name,
      desc: `${a.blurb} Their life story still plays out differently each time.`,
      onclick: () => randomize(a.id, `A ${a.name}`),
    })),
  ];
}

function textField(field, label, attrs = {}, tag = "input") {
  const id = `field-${field}`;
  return el("div", {},
    el("label", { class: "field-label", for: id }, label),
    el(tag, {
      id,
      ...(tag === "input" ? { type: "text" } : { rows: "3" }),
      value: state.draft[field] ?? "",
      autocomplete: "off",
      spellcheck: "false",
      ...attrs,
      oninput: (e) => {
        state.draft[field] = e.target.value;
        softRefresh();
      },
      onkeydown: (e) => {
        if (e.key === "Enter" && tag === "input") {
          e.preventDefault();
          move(1);
        }
      },
    }));
}

function identityStep() {
  const { pronouns } = state.setup;
  return [
    ...heading("Identity", "Who you are. The game master uses all of this when it writes your story."),
    textField("name", "Name", { maxlength: "40", placeholder: "Your full name" }),
    textField("callsign", "Callsign or nickname (optional)", { maxlength: "30", placeholder: "What your friends call you" }),
    el("div", { class: "stack" },
      el("span", { class: "field-label" }, "Pronouns"),
      Object.entries(pronouns).map(([id, label]) => choiceCard({
        selected: state.draft.pronouns === id,
        title: label,
        onclick: () => change((d) => { d.pronouns = id; }),
      })),
      state.draft.pronouns === "custom" && textField("customPronouns", "Your pronouns", { maxlength: "30", placeholder: "for example, ze/zir" })),
    textField("appearance", "Appearance (optional)", { maxlength: "300", placeholder: "Scars, clothes, the way you stand. Anything the story should know." }, "textarea"),
  ];
}

function roleStep() {
  const { starts, startGroups } = state.setup;
  return [
    ...heading("Your place", "Where you are when the story starts, and what you do there. Being captain is one way to play. Choose anything else, and someone else has the fleet, the world goes on over your head, and what you do about it is up to you."),
    Object.entries(startGroups).map(([group, label]) => [
      el("h3", { class: "group" }, label),
      Object.values(starts).filter((start) => start.group === group).map((start) => choiceCard({
        selected: state.draft.start === start.id,
        title: start.name,
        desc: start.desc,
        right: start.pay ? `${start.pay} cr a shift` : null,
        onclick: () => change((d) => { d.start = start.id; }),
      })),
    ]),
  ];
}

function speciesStep() {
  return [...heading("Species", "This changes your attributes and skills, and how the fleet looks at you."), lockedNotice(), singleChoice(state.setup.species, "species", { locked: state.view.life.started })];
}

function homeworldStep() {
  return [...heading("Homeworld", "Where you learned what normal means. It gives early skills, money and a faction's opinion of you."), lockedNotice(), singleChoice(state.setup.homeworlds, "homeworld", { locked: state.view.life.started })];
}

function upbringingStep() {
  return [...heading("Upbringing", "Who raised you, and what they thought mattered."), lockedNotice(), singleChoice(state.setup.upbringings, "upbringing", { locked: state.view.life.started })];
}

function attributesStep() {
  const { stats, statInfo } = state.setup;
  const { attributes, attrPoints, life } = state.view;
  const locked = life.started;
  return [
    ...heading("Attributes", "Your natural abilities. They decide your odds in the life ahead, so they're set before you live it. Going above 5 costs more. The signed number beside each value is the bonus it adds to checks."),
    lockedNotice(),
    points("Attribute points", attrPoints.left, `of ${attrPoints.budget}`),
    Object.entries(stats).map(([id, label]) => {
      const a = attributes[id];
      const raise = () => change((d) => { d.attributes[id] += 1; });
      const lower = () => change((d) => { d.attributes[id] -= 1; });
      const n = locked ? null : option({ run: raise, inc: raise, dec: lower });
      const parts = [`${a.bought} bought`];
      if (a.species) parts.push(`${signed(a.species)} species`);
      if (a.life) parts.push(`${signed(a.life)} life`);
      return el("div", { class: "attr-row" },
        el("div", {}, n && num(n), " ", el("strong", {}, label), el("span", { class: "muted small" }, `  ${parts.join(", ")}`), el("div", { class: "muted small" }, statInfo[id])),
        el("div", { class: "attr-controls" },
          el("button", { "aria-label": `Lower ${label}`, disabled: locked || !a.canLower, onclick: lower }, "-"),
          el("span", { class: "attr-value" }, String(a.value)),
          el("button", { "aria-label": `Raise ${label}`, disabled: locked || !a.canRaise, onclick: raise }, "+"),
          el("span", { class: "muted small attr-mod" }, signed(a.mod)),
          el("span", { class: "muted small attr-cost" }, a.raiseCost !== null ? `next: ${a.raiseCost}pt` : "max")));
    }),
  ];
}

function rollLine(r) {
  const bonus = r.bonus >= 0 ? `+ ${r.bonus}` : `- ${-r.bonus}`;
  return el("div", { class: `roll small ${r.success ? "ok" : "fail"}` },
    `[${r.success ? " OK " : "FAIL"}] ${r.label}: ${r.die} ${bonus} = ${r.total} vs ${r.dc}`,
    el("span", { class: "muted" }, ` (${r.attr}${r.skill ? ` + ${r.skill}` : ""})`));
}

function termNode(term) {
  return el("div", { class: `term${term.mishap ? " mishap" : ""}` },
    el("div", { class: "term-head" }, `AGES ${term.from}-${term.to} // ${term.careerName.toUpperCase()} // ${term.rankBefore}${term.rankAfter !== term.rankBefore ? ` -> ${term.rankAfter}` : ""}`),
    term.rolls.filter((r) => r.label === "Survival").map(rollLine),
    el("p", {}, term.eventText),
    term.choiceLabel && el("p", { class: "chosen" }, `> ${term.choiceLabel}`),
    term.rolls.filter((r) => r.label === "Your choice").map(rollLine),
    el("p", {}, term.outcomeText),
    term.rolls.filter((r) => r.label !== "Survival" && r.label !== "Your choice").map(rollLine),
    term.gains.length > 0 && el("div", { class: "effects small" }, term.gains.join(" | ")));
}

function lifeStep() {
  const { life } = state.view;
  const completed = life.terms.filter((t) => !t.pending);
  const body = [
    ...heading("Life Simulation", "Your life, four years at a time. Each term rolls for survival and promotion using your attributes, something happens that you have to decide about, and you come out changed. More terms mean more skills and money, but you learn more slowly, aging starts to hurt, and things can go wrong."),
  ];
  if (life.stage === "origins") {
    body.push(el("div", { class: "card stack" },
      el("div", {}, "Choose your species, homeworld and upbringing first. Your life starts from there."),
      el("div", { class: "row" },
        !state.draft.species && el("button", { onclick: () => goTo("species") }, "Species"),
        !state.draft.homeworld && el("button", { onclick: () => goTo("homeworld") }, "Homeworld"),
        !state.draft.upbringing && el("button", { onclick: () => goTo("upbringing") }, "Upbringing"))));
    return body;
  }
  if (life.started) body.push(el("div", { class: "row" }, el("button", { onclick: () => restartLife() }, "Restart life history")));
  body.push(completed.map(termNode));

  if (life.stage === "career") {
    const term = life.completedTerms + 1;
    body.push(el("h3", { class: "group" }, `Term ${term} of ${life.maxTerms}: where do the next four years go?`));
    if (life.blocked) body.push(el("div", { class: "notice-inline fail" }, `You were forced out of the ${life.blocked}. You can't go straight back.`));
    if (life.completedTerms > 0) {
      body.push(choiceCard({
        action: true,
        title: "Enough. Live to see the Fall.",
        desc: "Stop here. What happens next happens to everyone.",
        onclick: () => {
          state.scrollToTerm = true;
          change((d) => { d.life.finished = true; });
        },
      }));
    }
    body.push(life.careers.map((c) => choiceCard({
      action: true,
      title: `${c.name}${c.served ? ` (${c.rankTitle}, ${c.served} term${c.served === 1 ? "" : "s"})` : ""}`,
      desc: c.blocked ?? c.blurb,
      disabled: Boolean(c.blocked),
      effects: c.blocked ? null : [`Survival ${c.survival}%`, `Promotion ${c.promotion}%`, `${c.pay} credits a term`, `Teaches ${c.core.join(", ")}`, `Perk: ${c.signature}`],
      onclick: () => {
        state.scrollToTerm = true;
        change((d) => { d.life.terms.push({ career: c.id, choice: null }); });
      },
    })));
  } else if (life.stage === "event") {
    const { pending } = life;
    const term = life.terms[pending.term];
    body.push(el("div", { class: "term pending" },
      el("div", { class: "term-head" }, `AGES ${term.from}-${term.to} // ${pending.careerName.toUpperCase()} // ${term.rankBefore}`),
      term.rolls.map(rollLine),
      el("p", {}, pending.text)));
    body.push(pending.choices.map((c) => choiceCard({
      action: true,
      title: c.label,
      effects: c.check ? [c.check] : null,
      onclick: () => {
        state.scrollToTerm = true;
        change((d) => { d.life.terms[pending.term].choice = c.id; });
      },
    })));
  } else if (life.stage === "fall") {
    body.push(el("h3", { class: "group" }, "Six months ago: the Fall of the Concord"));
    body.push(el("p", {}, "In a single week, the silver ships came and the Concord ended. Where were you?"));
    body.push(life.fallChoices.map((f) => choiceCard({
      action: true,
      title: f.label,
      desc: f.desc,
      onclick: () => {
        state.scrollToTerm = true;
        change((d) => { d.life.fall = f.id; });
      },
    })));
    if (!life.reachedLimit) {
      body.push(el("div", {}, el("button", { onclick: () => change((d) => { d.life.finished = false; }) }, "Not yet. Serve another term.")));
    }
  } else if (life.stage === "done") {
    body.push(el("div", { class: "term" },
      el("div", { class: "term-head" }, `THE FALL OF THE CONCORD // ${life.fall.label.toUpperCase()}`),
      el("p", {}, life.fall.text),
      effectsLine(life.fall.gains)));
    body.push(el("div", { class: "card" }, `You've lived your life. You're ${state.view.sheet.age}, and you command the CFS Meridian. Now decide what you learned from it.`));
    body.push(el("div", {}, el("button", { onclick: () => change((d) => { d.life.fall = null; }) }, "Choose a different answer to where you were")));
  }
  return body;
}

function skillsStep() {
  const { skills: info, skillGroups, stats, limits } = state.setup;
  const { skills, skillPoints, sheet } = state.view;
  const tagged = state.draft.tags.length;
  return [
    ...heading("Skills", `Your life taught you some of these. Spend your points on the rest. Tag ${limits.tagCount} skills to get a free rank in each and improve them 50% faster for the rest of the game. Skills also get better by using them, and you're learning at ${Math.round(sheet.learning * 100)}% speed at your age. Raising a skill costs more at higher ranks, and none can go above rank ${limits.skillCap} yet.`),
    el("div", { class: "row" }, points("Skill points", skillPoints.left, `of ${skillPoints.budget}`), el("div", { class: `points${tagged < limits.tagCount ? " over" : ""}` }, `Tagged: ${tagged} of ${limits.tagCount}`)),
    Object.entries(skillGroups).map(([group, label]) => [
      el("h3", { class: "group" }, label),
      Object.entries(info).filter(([, s]) => s.group === group).map(([id, s]) => {
        const v = skills[id];
        const raise = () => change((d) => { d.skills[id] = (d.skills[id] ?? 0) + 1; });
        const lower = () => change((d) => { d.skills[id] -= 1; });
        const canTag = v.tagged || tagged < limits.tagCount;
        const toggle = () => change((d) => {
          d.tags = v.tagged ? d.tags.filter((t) => t !== id) : [...d.tags, id];
        });
        const n = option({ run: v.canRaise ? raise : undefined, inc: v.canRaise ? raise : undefined, dec: v.canLower ? lower : undefined, tag: canTag ? toggle : undefined });
        const bar = `${"#".repeat(v.rank)}${"-".repeat(Math.max(0, limits.skillCap - v.rank))}`;
        return el("div", { class: `skill-row${v.tagged ? " tagged" : ""}` },
          el("div", { class: "skill-name" },
            num(n), " ",
            el("button", { class: "tag-toggle", disabled: !canTag, "aria-pressed": String(v.tagged), "aria-label": `Tag ${s.name}`, onclick: toggle }, v.tagged ? "T" : "t"), " ",
            el("strong", {}, s.name), el("span", { class: "muted small" }, ` ${stats[s.attr].slice(0, 3).toUpperCase()}`),
            el("div", { class: "muted small" }, s.desc)),
          el("div", { class: "skill-numbers" },
            el("span", { class: "skill-bar", title: `Rank ${v.rank}` }, `[${bar}]`),
            el("span", { class: "small", title: "Your total bonus on checks with this skill" }, signed(v.bonus)),
            el("span", { class: "muted small", title: "Chance of passing a moderate check" }, `${v.odds}%`)),
          el("div", { class: "skill-controls" },
            el("button", { "aria-label": `Lower ${s.name}`, disabled: !v.canLower, onclick: lower }, "-"),
            el("button", { "aria-label": `Raise ${s.name}`, disabled: !v.canRaise, onclick: raise }, "+"),
            el("span", { class: "muted small" }, v.nextCost ? `${v.nextCost}pt` : "max")));
      }),
    ]),
  ];
}

function traitsStep() {
  const { traits: info, traitGroups, limits } = state.setup;
  const { traits, traitPoints } = state.view;
  const costLabel = (cost) => (cost > 0 ? `costs ${cost}` : cost < 0 ? `gives ${-cost}` : "free");
  const acquired = Object.keys(traits).filter((id) => traits[id].acquired);
  return [
    ...heading("Traits", `What makes you different. Strengths cost trait points, and flaws give them back: at most ${limits.maxNegative} points' worth of flaws, and ${limits.maxTraits} chosen traits. Your flaws will come up in the story, so pick ones you'd enjoy playing.`),
    points("Trait points", traitPoints.left, `of ${traitPoints.budget}`),
    acquired.length > 0 && [
      el("h3", { class: "group" }, "From your life"),
      acquired.map((id) => el("div", { class: "card" }, el("strong", {}, info[id].name), el("span", { class: "tag on" }, " life"), el("div", { class: "muted small" }, info[id].desc), effectsLine(info[id].effects))),
    ],
    Object.entries(traitGroups).map(([group, label]) => [
      el("h3", { class: "group" }, label),
      Object.values(info).filter((t) => t.group === group && !traits[t.id].acquired).map((t) => {
        const status = traits[t.id];
        const blocked = !status.chosen && (status.problem || !status.affordable);
        return choiceCard({
          check: true,
          selected: status.chosen,
          disabled: Boolean(blocked),
          title: t.name,
          right: costLabel(t.cost),
          desc: status.problem && !status.chosen ? status.problem : t.desc,
          effects: t.effects,
          onclick: () => change((d) => {
            d.traits = status.chosen ? d.traits.filter((x) => x !== t.id) : [...d.traits, t.id];
          }),
        });
      }),
    ]),
  ];
}

function ideologyStep() {
  const { axes, limits } = state.setup;
  const { ideology, convictions, factions, crew, notables, ideologyTitle } = state.view;
  return [
    ...heading("Ideology", `What you believe. Your life has already pushed you, so set where you stand now. A belief of ${limits.convictionThreshold} or more becomes a conviction, with real benefits and costs. In play, your choices will move these. Acting against a conviction causes stress, and people who share your beliefs treat you differently.`),
    el("div", { class: "points" }, `You are a ${ideologyTitle}`),
    Object.values(axes).map((axis) => {
      const v = ideology[axis.id];
      const toLow = () => change((d) => { d.ideology[axis.id] -= 1; });
      const toHigh = () => change((d) => { d.ideology[axis.id] += 1; });
      const n = option({ dec: toLow, inc: toHigh });
      const shiftText = v.shift ? `your past ${signed(v.shift)}, ` : "";
      return el("div", { class: "axis" },
        el("div", {}, num(n), " ", el("strong", {}, axis.name), el("span", { class: "muted small" }, `  ${axis.question}`)),
        el("div", { class: "axis-line" },
          el("span", { class: "pole low" }, axis.low.name),
          el("button", { "aria-label": `Move ${axis.name} toward ${axis.low.name}`, disabled: v.stance <= -limits.stanceLimit, onclick: toLow }, "<"),
          el("span", { class: "axis-bar", role: "img", "aria-label": `${axis.name}: ${v.value}` }, beliefBar(v.value, limits.ideologyLimit)),
          el("button", { "aria-label": `Move ${axis.name} toward ${axis.high.name}`, disabled: v.stance >= limits.stanceLimit, onclick: toHigh }, ">"),
          el("span", { class: "pole high" }, axis.high.name)),
        el("div", { class: "muted small" }, `${shiftText}your stance ${signed(v.stance)}, total ${signed(v.value)}`),
        el("div", { class: "muted small" }, `${axis.low.name}: ${axis.low.desc}`),
        el("div", { class: "muted small" }, `${axis.high.name}: ${axis.high.desc}`));
    }),
    el("h3", { class: "group" }, "Convictions"),
    convictions.length
      ? convictions.map((c) => el("div", { class: "card" }, el("strong", {}, c.name), el("span", { class: "muted small" }, ` (${c.pole})`), effectsLine(c.effects)))
      : el("div", { class: "muted small" }, "None yet. Push a belief to 5 or more to gain one."),
    el("h3", { class: "group" }, "How the galaxy will see you"),
    factions.map((f) => el("div", { class: "spread small" }, el("span", {}, f.name), el("span", {}, `standing ${signed(f.value)}`, el("span", { class: "muted" }, `, shared beliefs ${signed(f.affinity)}%`)))),
    el("h3", { class: "group" }, "Your crew"),
    crew.map((c) => el("div", { class: "spread small" }, el("span", {}, c.name), el("span", { class: "tag" }, c.attitude))),
    el("h3", { class: "group" }, "Powerful people"),
    notables.filter((n) => !crew.some((c) => c.name === n.name)).map((n) => el("div", { class: "spread small" }, el("span", {}, `${n.name}, ${n.role}`), el("span", { class: "muted" }, `shared beliefs ${signed(n.affinity)}%`))),
  ];
}

function driveStep() {
  const { drives, bonds } = state.setup;
  const bond = bonds[state.draft.bond];
  return [
    ...heading("Drive and Bonds", "Why you get up in the morning, and the person you'd burn it all down for. The game master builds the story around these."),
    el("h3", { class: "group" }, "What drives you"),
    singleChoice(drives, "drive"),
    el("h3", { class: "group" }, "Your closest bond"),
    singleChoice(bonds, "bond"),
    bond && bond.id !== "no_one" && textField("bondName", "Their name (optional)", { maxlength: "40", placeholder: "Leave blank to generate one" }),
  ];
}

function gearStep() {
  const { gear, items } = state.setup;
  const { credits, kit } = state.view;
  const groups = { weapon: "Weapons", armor: "Armor", consumable: "Supplies", gadget: "Gadgets" };
  const line = (item) => {
    if (item.damage) return `Damage ${item.damage[0]}-${item.damage[1]}. Uses ${state.setup.stats[item.stat]} and ${state.setup.skills[item.skill].name}.`;
    if (item.defense) return `Defense +${item.defense}.`;
    return "";
  };
  return [
    ...heading("Gear", "Your last career left you with a basic kit. Whatever you don't spend now, you keep as credits for later."),
    points("Credits", credits.left, `of ${credits.start}`),
    el("h3", { class: "group" }, "Your kit (free)"),
    kit.length
      ? el("div", { class: "small" }, kit.map((id) => items[id].name).join(", "))
      : el("div", { class: "muted small" }, "Finish your life history to see this."),
    Object.entries(groups).map(([type, label]) => [
      el("h3", { class: "group" }, label),
      gear.filter((i) => i.type === type).map((item) => {
        const count = state.draft.gear[item.id] ?? 0;
        const canBuy = item.price <= credits.left && count < 9;
        const add = () => change((d) => { d.gear[item.id] = count + 1; });
        const remove = () => change((d) => { d.gear[item.id] = count - 1; });
        const n = option({ run: canBuy ? add : undefined, inc: canBuy ? add : undefined, dec: count ? remove : undefined });
        return el("div", { class: "gear-row" },
          el("div", {}, num(n), " ", el("strong", {}, item.name), count > 0 && el("span", { class: "tag on" }, ` x${count}`),
            el("div", { class: "muted small" }, [line(item), item.desc].filter(Boolean).join(" "))),
          el("div", { class: "attr-controls" },
            el("span", { class: "small" }, `${item.price} cr`),
            el("button", { "aria-label": `Remove ${item.name}`, disabled: !count, onclick: remove }, "-"),
            el("button", { "aria-label": `Buy ${item.name}`, disabled: !canBuy, onclick: add }, "+")));
      }),
    ]),
  ];
}

function reviewStep() {
  const { setup, view } = state;
  const { sheet, attributes, skills, life, errors, warnings, complete, perks, ideologyTitle, convictions, factions, credits } = view;
  const problems = Object.entries(errors).filter(([, list]) => list.length);
  const notes = Object.entries(warnings).filter(([, list]) => list.length);
  const topSkills = Object.entries(skills).filter(([, s]) => s.rank > 0).sort((a, b) => b[1].rank - a[1].rank);
  return [
    ...heading("Review", "You, as the records have you."),
    problems.length > 0 && el("div", { class: "card stack problems" },
      el("strong", {}, "Still to do"),
      problems.map(([id, list]) => el("div", { class: "spread small" }, el("span", {}, list.join(" ")), el("button", { onclick: () => goTo(id) }, stepLabel(id))))),
    notes.length > 0 && el("div", { class: "stack small" }, notes.map(([id, list]) => el("div", { class: "spread" }, el("span", { class: "muted" }, list.join(" ")), el("button", { onclick: () => goTo(id) }, stepLabel(id))))),
    el("div", { class: "card stack" },
      el("strong", { class: "dossier-name" }, `${sheet.name || "Unnamed"}${sheet.callsign ? ` "${sheet.callsign}"` : ""}`),
      el("div", { class: "small" }, `${sheet.pronouns}, age ${sheet.age}. ${sheet.species ?? "Unknown species"} from ${sheet.homeworld ?? "somewhere"}. ${sheet.upbringing ?? ""}`),
      el("div", { class: "small" }, sheet.background),
      el("div", { class: "spread small" }, el("strong", {}, view.start.name), el("button", { onclick: () => goTo("role") }, "Change")),
      el("div", { class: "small" }, `Believes: ${ideologyTitle}. Driven to: ${sheet.drive ?? "unknown"}.`),
      sheet.appearance && el("div", { class: "muted small" }, sheet.appearance)),
    el("h3", { class: "group" }, "Attributes"),
    el("div", { class: "review-grid small" }, Object.entries(setup.stats).map(([id, label]) => el("div", { class: "spread" }, el("span", {}, label), el("strong", {}, String(attributes[id].value))))),
    el("h3", { class: "group" }, "Skills"),
    el("div", { class: "review-grid small" }, topSkills.map(([id, s]) => el("div", { class: "spread" }, el("span", {}, `${s.tagged ? "*" : ""}${setup.skills[id].name}`), el("strong", {}, String(s.rank))))),
    el("h3", { class: "group" }, "Traits and perks"),
    el("div", { class: "small" }, [...sheet.traits, ...perks.map((p) => p.name)].join(", ") || "None"),
    convictions.length > 0 && el("div", { class: "small" }, `Convictions: ${convictions.map((c) => c.name).join(", ")}`),
    el("h3", { class: "group" }, "Life history"),
    life.biography.length
      ? el("ul", { class: "bio small" }, life.biography.map((line) => el("li", {}, line)))
      : el("div", { class: "muted small" }, "Not lived yet."),
    life.contacts.length > 0 && [
      el("h3", { class: "group" }, "People from your past"),
      life.contacts.map((c) => el("div", { class: "small" }, el("strong", {}, c.name), el("span", { class: "tag" }, ` ${c.attitude}`), el("div", { class: "muted" }, c.note))),
    ],
    life.hooks.length > 0 && [
      el("h3", { class: "group" }, "Loose ends"),
      el("ul", { class: "bio small" }, life.hooks.map((h) => el("li", {}, h))),
    ],
    el("h3", { class: "group" }, "Standing"),
    factions.map((f) => el("div", { class: "spread small" }, el("span", {}, f.name), el("strong", {}, signed(f.value)))),
    el("div", { class: "small" }, `Credits after shopping: ${credits.left}`),
    hooks.hasGame() && el("div", { class: "muted small" }, "Your current game will be kept as \"Previous game\" on the title screen."),
  ];
}

const STEP_VIEWS = {
  start: startStep,
  identity: identityStep,
  role: roleStep,
  species: speciesStep,
  homeworld: homeworldStep,
  upbringing: upbringingStep,
  attributes: attributesStep,
  life: lifeStep,
  skills: skillsStep,
  traits: traitsStep,
  ideology: ideologyStep,
  drive: driveStep,
  gear: gearStep,
  review: reviewStep,
};

// ---- The live character sheet -------------------------------------------

function sheetNode() {
  const { setup, view } = state;
  const { sheet, attributes, skills, ideologyTitle, credits } = view;
  const topSkills = Object.entries(skills).filter(([, s]) => s.rank > 0).sort((a, b) => b[1].rank - a[1].rank).slice(0, 12);
  return el("aside", { class: `creator-sheet${state.sheetOpen ? " open" : ""}`, id: "creator-sheet", "aria-label": "Character sheet" },
    el("div", { class: "sheet-title" }, "-- CHARACTER SHEET --"),
    el("strong", { class: "dossier-name" }, sheet.name || "Unnamed"),
    el("div", { class: "muted small" }, [sheet.pronouns, sheet.species, view.life.completedTerms > 0 && `age ${sheet.age}`].filter(Boolean).join(", ")),
    el("div", { class: "small" }, sheet.background),
    el("div", { class: "sheet-vitals small" }, `HP ${sheet.hp}  EN ${sheet.energy}  DEF ${sheet.defense}  CR ${credits.left}`),
    el("div", { class: "sheet-heading" }, "Attributes"),
    el("div", { class: "review-grid small" }, Object.entries(setup.stats).map(([id, label]) => el("div", { class: "spread" }, el("span", {}, label.slice(0, 3).toUpperCase()), el("span", {}, `${attributes[id].value}`)))),
    el("div", { class: "sheet-heading" }, "Top skills"),
    topSkills.length
      ? el("div", { class: "review-grid small" }, topSkills.map(([id, s]) => el("div", { class: "spread" }, el("span", {}, `${s.tagged ? "*" : ""}${setup.skills[id].name}`), el("span", {}, String(s.rank)))))
      : el("div", { class: "muted small" }, "None yet"),
    el("div", { class: "sheet-heading" }, "Traits"),
    el("div", { class: "small" }, sheet.traits.join(", ") || el("span", { class: "muted" }, "None yet")),
    el("div", { class: "sheet-heading" }, "Beliefs"),
    el("div", { class: "small" }, ideologyTitle),
    sheet.weapon && el("div", { class: "sheet-heading" }, "Equipped"),
    sheet.weapon && el("div", { class: "small" }, [sheet.weapon, sheet.armor].filter(Boolean).join(", ")));
}

// ---- The typed prompt ---------------------------------------------------

function promptHelp() {
  state.message = { ok: true, text: "Type a number to pick something. Use 3+ or 3- to raise or lower it, and t3 to tag a skill. You can also type next, back, random or begin." };
  hooks.render();
}

function handlePrompt(raw) {
  const text = raw.trim().toLowerCase();
  if (!text) return;
  if (text === "next") return move(1);
  if (text === "back") return move(-1);
  if (text === "random") return askRandom();
  if (text === "help" || text === "/help") return promptHelp();
  if (text === "begin") {
    if (state.view.complete) return begin();
    state.message = { ok: false, text: "You aren't finished yet. See the Review step for what's left." };
    return goTo("review");
  }
  const named = stepIds().find((id) => stepLabel(id).toLowerCase() === text);
  if (named) return goTo(named);

  const match = text.match(/^(t?)\s*(\d+)\s*([+\-<>]?)$/);
  const picked = match && state.options[Number(match[2]) - 1];
  if (!picked) {
    state.message = { ok: false, text: match ? `There's no choice ${match[2]} on this screen.` : `I don't understand "${raw.trim()}". Type help for the commands.` };
    return hooks.render();
  }
  const action = match[1] ? picked.tag
    : match[3] === "+" || match[3] === ">" ? picked.inc
      : match[3] === "-" || match[3] === "<" ? picked.dec
        : picked.run;
  if (action) return action();
  state.message = { ok: false, text: "You can't do that right now." };
  return hooks.render();
}

function promptLine() {
  return el("div", { class: "prompt-line" },
    el("label", { class: "prompt", for: "creator-prompt" }, PROMPT),
    el("input", {
      id: "creator-prompt",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "type a number, next, back, or help",
      onkeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const value = e.target.value;
          e.target.value = "";
          handlePrompt(value);
        }
      },
    }));
}

// ---- The whole screen ---------------------------------------------------

export function creatorScreen() {
  const previous = document.getElementById("creator-main");
  const previousStep = previous?.dataset.step;
  const previousTop = previous?.scrollTop ?? 0;

  state.options = [];
  const ids = stepIds();
  const index = ids.indexOf(state.step);
  const screen = el("div", { class: "creator" },
    el("header", { class: "creator-head" },
      el("div", {}, el("strong", {}, "CONCORD PERSONNEL SYSTEM"), el("span", { class: "muted" }, " // PERSONNEL DOSSIER")),
      el("div", { class: "row" },
        el("button", { onclick: askRandom }, "Randomize"),
        el("button", { class: "sheet-toggle", onclick: () => { state.sheetOpen = !state.sheetOpen; hooks.render(); } }, state.sheetOpen ? "Hide sheet" : "Sheet"),
        el("button", { onclick: () => hooks.exit() }, "Exit"))),
    stepBar(),
    el("div", { class: "creator-body" },
      el("main", { class: "creator-main", id: "creator-main", "data-step": state.step },
        el("div", { class: "creator-content stack" }, STEP_VIEWS[state.step]())),
      sheetNode()),
    el("footer", { class: "creator-foot" },
      el("div", { class: "creator-foot-inner" },
        state.message && el("div", { class: `notice-inline ${state.message.ok ? "ok" : "fail"}` }, state.message.text),
        el("div", { class: "row" },
          el("button", { disabled: index === 0, onclick: () => move(-1) }, "< Back"),
          index < ids.length - 1 && el("button", { class: "primary", onclick: () => move(1) }, `Next: ${stepLabel(ids[index + 1])} >`),
          index === ids.length - 1 && el("button", { class: "primary begin", disabled: !state.view.complete, onclick: begin }, state.view.start.begin)),
        promptLine())));

  // Runs once the new screen is in place.
  queueMicrotask(() => {
    const main = document.getElementById("creator-main");
    if (!main) return;
    if (state.scrollToTerm) {
      // Shows what just happened, with the next decision below it.
      const terms = main.querySelectorAll(".term");
      if (terms.length) main.scrollTop = terms[terms.length - 1].offsetTop - main.offsetTop - 8;
      state.scrollToTerm = false;
    } else if (previousStep === state.step) {
      main.scrollTop = previousTop;
    }
    if (window.innerWidth > 860) {
      const nameField = state.step === "identity" && !state.draft.name ? document.getElementById("field-name") : null;
      (nameField ?? document.getElementById("creator-prompt"))?.focus({ preventScroll: true });
    }
  });
  return screen;
}
