// What's inside each slide-over menu. Everything shown here comes straight from the
// game's state, so a menu can never disagree with the rules.

import { checkStyle, setCheckStyle } from "./check.js";
import { api, beliefBar, columns, el, folded, meter, money, signed, strainMeter } from "./dom.js";
import { fleetMenu, mapMenu } from "./fleet.js";
import { oddsFor } from "./story.js";

// What the menus need from the main screen. Set once, when the page loads.
let app;

export function initMenus(hooks) {
  app = hooks;
}

// ---- Shared pieces ------------------------------------------------------

const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const effects = (list) => (list?.length ? el("div", { class: "effects small" }, list.join(" | ")) : null);
const muted = (text) => el("div", { class: "muted small" }, text);
const small = (text) => el("div", { class: "small" }, text);
const empty = (text) => el("div", { class: "muted" }, text);

function row(label, value, hint) {
  return el("div", { class: "menu-row" },
    el("span", {}, label, hint && el("span", { class: "muted small" }, ` ${hint}`)),
    el("strong", {}, String(value)));
}

function asciiBar(value, max, width = 10) {
  const filled = Math.round(Math.max(0, Math.min(1, value / max)) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

// ---- Character ----------------------------------------------------------

function characterMenu() {
  const { ui, act } = app;
  const g = ui.game;
  const d = g.dossier;
  const p = g.combatProfile;
  const penalties = [
    g.penalties.stress && `Stress: ${g.penalties.stress} on every check.`,
    g.penalties.fatigue && `Fatigue: ${g.penalties.fatigue} on every check.`,
    g.penalties.checks && `Conditions: ${signed(g.penalties.checks)} on every check.`,
  ].filter(Boolean);
  return columns(
    section(g.role.captain ? "Captain" : "You",
      el("div", { class: "card stack gap-small" },
        el("strong", { class: "menu-name" }, `${g.name}${d.callsign ? ` "${d.callsign}"` : ""}`),
        small(`${g.pronouns}, age ${g.age}. ${g.species}.`),
        small(g.background),
        muted(`From ${d.homeworld ?? "somewhere"}. ${d.upbringing ?? ""}`),
        small(`${g.ideologyTitle}. ${d.drive ? `Driven to: ${d.drive}.` : ""}`))),
    !g.role.captain && section("Your place",
      el("strong", {}, g.role.title),
      g.role.chair && muted(`${g.role.chair} has the fleet, and the Meridian. You're not the one they ask.`),
      g.role.job
        ? [muted(`It's a living: about ${g.role.job.pay} credits for eight hours, and it wears you out.`), el("div", {}, el("button", { disabled: Boolean(g.combat || g.talk), onclick: act({ action: "work" }) }, g.role.job.name))]
        : g.role.jobAway && muted(`Your work's back at ${g.role.jobAway.place}.`),
      el("div", { class: "row" },
        el("button", { disabled: Boolean(g.combat || g.talk || g.check), onclick: () => app.openMenu("map") }, "Open the star map"),
        el("button", { onclick: () => app.openMenu("fleet") }, "What's the fleet doing?"))),
    section("Experience",
      row("Level", g.level),
      el("div", { class: "menu-row" }, el("span", {}, "Next level"), el("span", {}, `${asciiBar(g.xp, g.xpToNext)} ${g.xp}/${g.xpToNext} XP`)),
      row("Attribute points", g.statPoints, "every 2 levels"),
      row("Skill points", g.skillPoints, "spend in Skills"),
      row("Perk points", g.perkPoints, "spend in Perks")),
    section("Condition",
      el("div", { class: "stack gap-small small" },
        meter("HEALTH ", g.hp, g.maxHp), meter("ENERGY ", g.energy, g.maxEnergy),
        strainMeter("STRESS ", g.needs.stress), strainMeter("FATIGUE", g.needs.fatigue)),
      penalties.length > 0 ? el("div", { class: "notice-inline fail" }, penalties.join(" ")) : muted("Nothing is holding you back right now."),
      small(g.clock.label),
      g.conditions.map((c) => el("div", { class: "card" },
        el("div", { class: "spread" }, el("strong", {}, c.name), el("span", { class: "muted small" }, `${Math.ceil(c.hoursLeft)}h left`)),
        muted(c.desc),
        effects(c.effects))),
      sleepButtons(g)),
    section("Attributes",
      g.statPoints > 0 && small(`You have ${g.statPoints} point${g.statPoints === 1 ? "" : "s"} to spend.`),
      Object.entries(ui.setup.stats).map(([id, label]) => el("div", { class: "menu-entry" },
        el("div", { class: "menu-row" },
          el("span", {}, label, g.stats[id] !== g.baseStats[id] && el("span", { class: "muted small" }, ` (base ${g.baseStats[id]})`)),
          el("span", { class: "row" },
            el("strong", {}, String(g.stats[id])),
            el("span", { class: "muted small", title: "Added to checks that use this attribute" }, signed(g.stats[id] - 3)),
            g.statPoints > 0 && el("button", { "aria-label": `Raise ${label}`, onclick: act({ action: "stat", id }) }, "+"))),
        muted(g.statInfo[id])))),
    section("In a fight",
      row("Weapon", p.weapon, `${p.weaponStat} and ${p.weaponSkill}`),
      row("Attack bonus", signed(p.attack)),
      row("Damage", `${p.damage[0]}-${p.damage[1]}`),
      row("Armor", p.armor, p.armorDefense ? `defense +${p.armorDefense}` : ""),
      row("Defense", p.defense, "enemies must beat this"),
      row("Chance to escape", `${p.escape}%`),
      g.abilities.length > 0 && el("div", { class: "small" }, `Abilities: ${g.abilities.map((a) => `${a.name} (${a.energy} energy)`).join(", ")}`)),
  );
}

// Where someone can sleep, and what it costs them.
function sleepButtons(g) {
  const { act } = app;
  const { rest, captain } = g.role;
  const busy = Boolean(g.combat || g.talk);
  if (rest === null) return muted("You can only sleep properly aboard the Meridian.");
  if (!rest) return el("div", {}, el("button", { disabled: busy, onclick: act({ action: "rest" }) }, captain ? "Sleep aboard ship (8 hours)" : "Sleep (8 hours)"));
  return el("div", { class: "row" },
    el("button", { disabled: busy || g.credits < rest, title: g.credits < rest ? "You can't afford it" : "", onclick: act({ action: "rest" }) }, `Rent a bunk (8 hours, ${rest} cr)`),
    el("button", { disabled: busy, title: "Free, but you won't wake up much better for it", onclick: act({ action: "rest", rough: true }) }, "Sleep rough (8 hours)"));
}

// ---- Skills -------------------------------------------------------------

function skillsMenu() {
  const { ui, act } = app;
  const g = ui.game;
  const { difficulty, stats } = ui.setup;
  return [
    el("div", { class: "menu-intro small" },
      `Skill points: ${g.skillPoints}. You earn more each level, and skills also improve as you use them. Tagged skills (*) improve 50% faster.`,
      g.dossier.learning !== 1 && ` At your age, you're learning at ${Math.round(g.dossier.learning * 100)}% speed.`),
    columns(Object.entries(g.skillGroups).map(([group, label]) => section(label,
      g.skills.filter((s) => s.group === group).map((s) => el("div", { class: `menu-entry${s.tagged ? " tagged" : ""}` },
        el("div", { class: "menu-row" },
          el("span", {}, el("strong", {}, `${s.tagged ? "*" : ""}${s.name}`), el("span", { class: "muted small" }, ` ${stats[s.attr]}`)),
          el("span", { class: "row" },
            el("span", { class: "skill-bar", title: `Rank ${s.rank} of 10` }, asciiBar(s.rank, 10)),
            el("strong", { title: "Your total bonus on checks with this skill" }, signed(s.bonus)),
            s.raiseCost && g.skillPoints >= s.raiseCost && el("button", { "aria-label": `Raise ${s.name}`, title: `Costs ${s.raiseCost} skill point${s.raiseCost === 1 ? "" : "s"}`, onclick: act({ action: "skill", id: s.id }) }, "+"))),
        muted(s.desc),
        s.id === "hacking" && ui.setup.hackingClasses?.length
          ? el("div", { class: "row small practice-classes" }, el("span", { class: "muted" }, "Practice on:"), ui.setup.hackingClasses.map((one) => el("button", { class: "small", disabled: Boolean(g.combat || g.check), title: `A ${one.difficulty.replace("_", " ")} hack. Nothing that happens in practice counts.`, onclick: () => app.startPractice(s.id, one.difficulty) }, one.name)))
          : el("div", {}, el("button", { class: "small", disabled: Boolean(g.combat || g.check), title: "Try this skill's check window. Nothing that happens in practice counts.", onclick: () => app.startPractice(s.id) }, "Practice")),
        el("div", { class: "small" }, `Moderate ${oddsFor(s.bonus, difficulty.moderate)}%, hard ${oddsFor(s.bonus, difficulty.hard)}%, very hard ${oddsFor(s.bonus, difficulty.very_hard)}%`),
        s.raiseCost && el("div", { class: "muted small" }, `Practice ${asciiBar(s.xp, s.xpNext)} ${s.xp}/${s.xpNext}. Next rank costs ${s.raiseCost} point${s.raiseCost === 1 ? "" : "s"}.`)))))),
  ];
}

// ---- Traits and perks ---------------------------------------------------

function traitsMenu() {
  const g = app.ui.game;
  return columns(
    section("Traits",
      g.traits.length ? g.traits.map((t) => el("div", { class: "card" },
        el("strong", {}, t.name), muted(t.desc), effects(t.effects))) : empty("You have no traits.")),
    section("Convictions",
      g.convictions.length ? g.convictions.map((c) => el("div", { class: "card" },
        el("strong", {}, c.name), el("span", { class: "muted small" }, ` (${c.pole})`), effects(c.effects))) : muted("None. A belief of 5 or more becomes a conviction.")),
    folded("traits-effects", `Everything affecting you (${g.effects.length})`,
      g.effects.length ? g.effects.map((e) => el("div", { class: "menu-entry" },
        el("div", { class: "spread" }, el("span", {}, e.name), el("span", { class: "tag" }, e.source)),
        effects(e.effects))) : muted("Nothing at the moment.")),
  );
}

function perksMenu() {
  const { ui, act } = app;
  const g = ui.game;
  const owned = g.perks.filter((p) => p.owned);
  const ready = g.perks.filter((p) => !p.owned && p.ok);
  const locked = g.perks.filter((p) => !p.owned && !p.ok);
  const card = (p, control) => el("div", { class: "card" },
    el("div", { class: "spread" }, el("strong", {}, p.name), p.career && el("span", { class: "tag on" }, "career")),
    muted(p.desc),
    control);
  return [
    el("div", { class: "menu-intro small" }, `Perk points: ${g.perkPoints}. You earn one each level.`),
    columns(
      section(`Learned (${owned.length})`, owned.length ? owned.map((p) => card(p)) : empty("Nothing yet.")),
      section(`Ready to learn (${ready.length})`, ready.length
        ? ready.map((p) => card(p, el("div", { class: "card-action" }, el("button", { onclick: act({ action: "perk", id: p.id }) }, "Learn"))))
        : muted(g.perkPoints ? "Nothing you qualify for yet." : "You need a perk point. You get one each level.")),
      section(`Locked (${locked.length})`, locked.map((p) => card(p, el("div", { class: "small notice-inline fail" }, p.why)))),
    ),
  ];
}

// ---- Beliefs ------------------------------------------------------------

function beliefsMenu() {
  const { ui } = app;
  const g = ui.game;
  const { axes, limits } = ui.setup;
  return columns(
    section("Where you stand",
      el("div", { class: "card" }, el("strong", {}, g.ideologyTitle), muted("Your choices move these. Acting against a strong belief causes stress, and acting on one steadies you.")),
      Object.values(axes).map((axis) => {
        const value = g.ideology.find((i) => i.id === axis.id)?.value ?? 0;
        const pole = value < 0 ? axis.low : axis.high;
        const active = Math.abs(value) >= limits.convictionThreshold;
        return el("div", { class: "menu-entry" },
          el("div", {}, el("strong", {}, axis.name), el("span", { class: "muted small" }, ` ${axis.question}`)),
          el("div", { class: "spread small" }, el("span", {}, axis.low.name), el("strong", {}, signed(value)), el("span", {}, axis.high.name)),
          el("div", { class: "axis-bar side-bar", role: "img", "aria-label": `${axis.name}: ${value}` }, beliefBar(value)),
          muted(`${axis.low.name}: ${axis.low.desc}`),
          muted(`${axis.high.name}: ${axis.high.desc}`),
          value !== 0 && (active
            ? el("div", { class: "effects small" }, `Conviction: ${pole.conviction}. ${pole.effects.join(" | ")}`)
            : muted(`At ${limits.convictionThreshold}, you'd gain the conviction ${pole.conviction}: ${pole.effects.join(" | ")}`)));
      })),
    section("Factions",
      g.factions.filter((f) => f.known).map((f) => el("div", { class: "menu-entry" },
        el("div", { class: "menu-row" }, el("strong", {}, f.name), el("strong", {}, signed(f.value))),
        el("div", { class: "axis-bar side-bar", role: "img", "aria-label": `Standing with ${f.name}: ${f.value}` }, beliefBar(Math.round(f.value / 10))),
        f.holds.length > 0 && el("div", { class: "muted small" }, `Holds ${f.holds.join(", ")}.`),
        muted(f.desc),
        small(`Shared beliefs: ${signed(f.sharedBeliefs)}%`),
        f.relationship !== 0 && el("div", { class: "effects small" }, `${signed(f.relationship)} on social checks with them`)))),
  );
}

// ---- Dossier ------------------------------------------------------------

function dossierMenu() {
  const g = app.ui.game;
  const d = g.dossier;
  return columns(
    section("Personal record",
      row("Name", g.name),
      d.callsign && row("Callsign", d.callsign),
      row("Pronouns", g.pronouns),
      row("Age", g.age),
      row("Species", g.species),
      row("Homeworld", d.homeworld ?? "Unknown"),
      row("Upbringing", d.upbringing ?? "Unknown"),
      d.appearance && el("div", { class: "menu-entry" }, muted(d.appearance))),
    d.speciesFx.length > 0 && section(g.species, effects(d.speciesFx)),
    d.drive && section("What drives you", el("div", { class: "card" }, el("strong", {}, d.drive), muted(d.driveDesc), effects(d.driveFx))),
    d.bond && section("Closest bond", small(d.bond)),
    d.careers.length > 0 && section("Career",
      d.careers.map((c) => row(c.name, c.rankTitle, `${c.terms * 4} years`))),
    d.biography.length > 0 && folded("past-history", `Life history (${d.biography.length})`, el("ul", { class: "bio small" }, d.biography.map((line) => el("li", {}, line)))),
    d.hooks.length > 0 && folded("past-loose-ends", `Loose ends (${d.hooks.length})`, el("ul", { class: "bio small" }, d.hooks.map((line) => el("li", {}, line)))),
    d.legacy && muted("This captain was created before the deep character creator. Start a new game to build one."),
  );
}

// ---- People -------------------------------------------------------------

const PEOPLE_FILTERS = {
  all: ["Everyone", () => true],
  crew: ["Crew", (p) => p.crew],
  met: ["Met", (p) => p.met],
  heard: ["Heard of", (p) => !p.met],
};

function personCard(p, focus) {
  const facts = [p.pronouns, p.species, p.age && `age ${p.age}`].filter(Boolean).join(", ");
  const where = [p.faction, p.location && `usually at ${p.location}`].filter(Boolean).join(", ");
  return el("div", {
    class: `card stack gap-small${focus === p.loreId ? " focused" : ""}`,
    "data-focus": p.loreId,
    style: `--speaker:${p.color ?? "var(--lore)"}`,
  },
  el("div", { class: "spread" },
    el("strong", { class: "person-name" }, p.name),
    el("span", { class: "row" },
      p.status !== "alive" && el("span", { class: "tag bad" }, p.status),
      p.attitude ? el("span", { class: "tag" }, p.attitude) : el("span", { class: "tag" }, "not met"))),
  !p.note.startsWith(p.role) && el("div", { class: "small" }, p.role),
  facts && muted(facts),
  where && muted(where),
  el("div", { class: "muted small" }, p.note),
  p.appearance && el("div", { class: "muted small" }, p.appearance),
  p.history && el("div", { class: "small" }, `Between you: ${p.history}`),
  el("div", { class: "small" }, [p.threat && `Threat: ${p.threat}`, `Shared beliefs: ${signed(p.sharedBeliefs)}%`].filter(Boolean).join(". ")),
  p.relationship !== 0 && el("div", { class: "effects small" }, `${signed(p.relationship)} on social checks with them`));
}

function peopleMenu() {
  const { ui, renderMenus } = app;
  const g = ui.game;
  const filter = PEOPLE_FILTERS[ui.peopleFilter] ? ui.peopleFilter : "all";
  const shown = g.people.filter(PEOPLE_FILTERS[filter][1]);
  return [
    el("div", { class: "menu-intro" },
      el("div", { class: "row" }, Object.entries(PEOPLE_FILTERS).map(([id, [label]]) => el("button", {
        class: id === filter ? "primary" : "",
        "aria-pressed": String(id === filter),
        onclick: () => { ui.peopleFilter = id; renderMenus(); },
      }, label)))),
    shown.length ? el("div", { class: "menu-cards" }, shown.map((p) => personCard(p, ui.menuFocus))) : empty("Nobody here yet."),
  ];
}

// ---- Quests -------------------------------------------------------------

function questsMenu() {
  const g = app.ui.game;
  const active = [...g.quests.filter((q) => q.status === "active")].sort((a, b) => Number(b.main) - Number(a.main));
  // The record may be missing while a page from after it talks to a game from before it.
  const record = g.story.record ?? { endings: [], facts: [] };
  // A story that ended on the record without a quest of its own is finished too.
  const done = [
    ...g.quests.filter((q) => q.status !== "active").map((q) => ({ ...q, ending: record.endings.find((ending) => ending.id === q.id)?.ending ?? null })),
    ...record.endings.filter((ending) => !g.quests.some((q) => q.id === ending.id)).map((ending) => ({ id: ending.id, title: ending.title, main: false, status: ending.failed ? "failed" : "completed", ending: ending.ending, desc: "", objective: ending.summary })),
  ];
  const card = (q) => el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, q.title), q.main ? el("span", { class: "tag on" }, "main") : q.status !== "active" && el("span", { class: `tag ${q.status === "failed" ? "bad" : "on"}` }, q.ending ? q.ending.replaceAll("_", " ") : q.status)),
    q.desc && muted(q.desc),
    el("div", { class: "small" }, q.status === "active" ? `Next: ${q.objective}` : q.objective));
  return columns(
    section(`Active (${active.length})`, active.length ? active.map(card) : empty("No active quests.")),
    folded("quests-finished", `Finished (${done.length})`, done.length ? done.map(card) : muted("Nothing finished yet.")),
    folded("quests-journal", `Journal (${g.journal.length})`, g.journal.length
      ? [...g.journal].reverse().map((j) => el("div", { class: "menu-entry small" }, j.entry))
      : muted("Important events will be recorded here.")),
    folded("quests-facts", `Facts on record (${record.facts.length})`, record.facts.length
      ? [...record.facts].reverse().map((fact) => el("div", { class: "menu-entry small" }, el("span", {}, fact.text), fact.from && el("span", { class: "muted" }, ` ${fact.from}`)))
      : muted("What the stories leave behind is kept here, for the stories that come after.")),
  );
}

// ---- Leads --------------------------------------------------------------

const LEAD_KINDS = { job: "job", mystery: "mystery", crew: "crew", politics: "politics", survival: "survival", exploration: "exploration", dilemma: "dilemma", faction: "faction", main: "the Beacon" };

function leadsMenu() {
  const { ui, followLead, askAbout } = app;
  const g = ui.game;
  const { here, rumors, active, done, moved } = g.story;
  const busy = ui.streaming || Boolean(g.combat) || Boolean(g.check);
  const card = (lead, action) => el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, lead.title), el("span", { class: "row" },
      lead.moved && el("span", { class: "tag" }, "it's moved on"),
      el("span", { class: lead.kind === "main" ? "tag on" : "tag" }, LEAD_KINDS[lead.kind] ?? lead.kind))),
    el("div", { class: "small" }, lead.lead),
    action);
  return [
    columns(
      section(`Leads here, at ${g.location.name}`,
        here.length
          ? here.map((lead) => card(lead, el("div", { class: "row" }, g.mode === "written" && !lead.written
            ? el("span", { class: "muted small", title: "This story hasn't been written out yet. It plays out by itself for now, and an AI game master could run it from its notes." }, "Not written yet")
            : el("button", { disabled: busy, onclick: () => followLead(lead) }, "Look into this"),
          lead.written && g.mode !== "written" && el("span", { class: "muted small", title: "This story is written out, so it plays from its file for free. Your own words in it go to the AI." }, "written, so it's free"))))
          : empty("Nothing new here at the moment. Try somewhere else, or come back later.")),
      section("What people are saying",
        rumors.length
          ? rumors.map((rumor) => el("div", { class: "menu-entry" },
            el("div", { class: "small" }, `"${rumor}"`),
            el("div", {}, el("button", { class: "small", disabled: busy, onclick: () => askAbout(rumor) }, "Ask around about this"))))
          : muted("Nobody's saying much here.")),
      section(`Following (${active.length})`,
        active.length ? active.map((lead) => card(lead)) : muted("Stories you take up will be listed here, along with your Quests.")),
      done.length > 0 && folded("leads-finished", `Finished (${done.length})`, done.map((lead) => el("div", { class: "menu-entry small" }, lead.title))),
      moved?.length > 0 && folded("leads-moved", `Moved on without you (${moved.length})`, moved.map((entry) => el("div", { class: "menu-entry small" },
        el("div", {}, el("strong", {}, entry.title), el("span", { class: "muted" }, ` Day ${entry.day}`)),
        el("div", {}, entry.text)))),
    ),
  ];
}

// ---- Codex --------------------------------------------------------------

const CODEX_GROUPS = { faction: "Factions", place: "Places", ship: "Ships", people: "Peoples", concept: "Concepts", person: "People" };

function codexMenu() {
  const { ui, loreCatalog } = app;
  const g = ui.game;
  const inCodex = (e) => e.id.startsWith("custom:") || (e.kind !== "person" && g.seenLore.includes(e.id));
  const found = loreCatalog().filter(inCodex);
  const total = ui.setup.lore.filter((e) => e.kind !== "person").length + g.lore.length;
  const results = el("div", { class: "menu-cards" });
  const draw = () => {
    const search = (ui.codexSearch ?? "").trim().toLowerCase();
    const shown = search ? found.filter((e) => `${e.name} ${e.text}`.toLowerCase().includes(search)) : found;
    results.replaceChildren(...Object.entries(CODEX_GROUPS).flatMap(([kind, label]) => {
      const entries = shown.filter((e) => e.kind === kind);
      return entries.length ? [section(label, entries.map((e) => el("div", {
        class: `card${ui.menuFocus === e.id ? " focused" : ""}`,
        "data-focus": e.id,
        ...(e.color ? { style: `--speaker:${e.color}` } : {}),
      },
      el("strong", { class: `codex-name lore-${e.kind}` }, e.name),
      muted(e.text),
      e.status && el("div", { class: "effects small" }, e.status))))] : [];
    }));
    if (!shown.length) results.replaceChildren(empty("Nothing matches that."));
  };
  draw();
  return [
    el("div", { class: "menu-intro" },
      el("div", { class: "small" }, `${found.length} of ${total} entries found.`),
      el("input", {
        type: "text",
        placeholder: "Search the codex",
        "aria-label": "Search the codex",
        autocomplete: "off",
        value: ui.codexSearch ?? "",
        oninput: (e) => { ui.codexSearch = e.target.value; draw(); },
      })),
    results,
  ];
}

// ---- Inventory ----------------------------------------------------------

const ITEM_GROUPS = { weapon: "Weapons", armor: "Armor", consumable: "Supplies", gadget: "Gadgets", story: "Story items" };

function itemCard(i) {
  const { ui, act } = app;
  const g = ui.game;
  const stats = [
    i.damage && `Damage ${i.damage[0]}-${i.damage[1]}. Uses ${ui.setup.stats[i.stat]} and ${ui.setup.skills[i.skill].name}, for ${signed(i.attackBonus)} to hit.`,
    i.defense && `Defense +${i.defense}.`,
  ].filter(Boolean);
  return el("div", { class: "card stack gap-small" },
    el("div", { class: "spread" }, el("strong", {}, `${i.name}${i.count > 1 ? ` x${i.count}` : ""}`), i.equipped && el("span", { class: "tag on" }, "equipped")),
    muted(i.desc),
    stats.length > 0 && small(stats.join(" ")),
    i.price > 0 && muted(`Worth ${i.price} cr. Sells for ${i.sellPrice} cr.`),
    (i.type === "weapon" || i.type === "armor") && el("div", {}, el("button", { disabled: Boolean(g.combat), onclick: act({ action: "equip", id: i.id }) }, i.equipped ? "Unequip" : "Equip")),
    i.type === "consumable" && el("div", {}, el("button", { disabled: Boolean(g.combat), onclick: act({ action: "use", id: i.id }) }, "Use")));
}

function inventoryMenu() {
  const g = app.ui.game;
  const p = g.combatProfile;
  return columns(
    section("Carrying",
      row("Credits", g.credits),
      row("Weapon", p.weapon, `${p.damage[0]}-${p.damage[1]} damage`),
      row("Armor", p.armor, `defense ${p.defense}`)),
    Object.entries(ITEM_GROUPS).map(([type, label]) => {
      const items = g.inventory.filter((i) => i.type === type);
      return items.length > 0 && section(label, items.map(itemCard));
    }),
    !g.inventory.length && empty("Your pockets are empty."),
  );
}

// ---- Ship ---------------------------------------------------------------

// The Meridian's own systems, which the captain runs from here with no hacking: each one folded, with what isn't
// working said on its line.
function shipSystems(g) {
  const systems = g.shipSystems;
  if (!systems?.length) return null;
  const turn = (row, to) => app.runAction(async () => {
    const { game } = await api("/api/systems", { row, to });
    app.ui.game = game;
  });
  return section("Systems",
    systems.map((system) => {
      const down = system.rows.filter((row) => !row.works).length;
      return folded(`ship-systems-${system.id}`, `${system.title}${down ? ` (${down} down)` : ""}`,
        system.rows.map((row) => el("div", { class: "menu-row small ship-system-row" },
          el("span", { class: "ship-system-name" }, row.name, row.feed?.length ? el("span", { class: "muted" }, `, on camera: ${row.feed.join(", ")}`) : null),
          el("span", { class: `tag${row.works ? "" : " bad"}` }, row.word),
          row.actions.map((action) => el("button", { class: "small", onclick: turn(row.id, action.to) }, action.label)))));
    }));
}

function shipMenu() {
  const g = app.ui.game;
  const s = g.ship;
  return columns(
    section(s.name,
      el("div", { class: "stack gap-small small" }, meter("HULL  ", s.hull, s.maxHull), meter("FUEL  ", s.fuel, s.maxFuel), meter("MORALE", s.morale, 100)),
      muted("Each jump uses 1 to 3 fuel, depending on how far it is. If fuel runs out, the fleet can't jump anywhere.")),
    section("Current location",
      el("div", { class: "card" }, el("strong", {}, g.location.name), muted(g.location.desc), small(g.clock.label))),
    shipSystems(g),
    section("Crew",
      g.people.filter((p) => p.crew).map((p) => el("div", { class: "menu-row small" },
        el("span", {}, p.name, el("span", { class: "muted" }, `, ${p.role}`)),
        el("span", { class: p.status === "alive" ? "tag" : "tag bad" }, p.status === "alive" ? p.attitude ?? "not met" : p.status)))),
    section("Where to go",
      muted(`You know of ${g.locations.filter((l) => !l.withFleet).length} places. You'll hear about more as the story goes on.`),
      el("div", { class: "row" },
        el("button", { class: "primary", onclick: () => app.openMenu("map") }, "Open the star map"),
        el("button", { onclick: () => app.openMenu("fleet") }, "Open the Fleet menu"))),
  );
}

// ---- Market -------------------------------------------------------------

// Why the prices here are what they are today.
function marketNote(g) {
  const goods = g.world.here?.goods ?? [];
  const short = goods.filter((good) => good.low).map((good) => good.id);
  const plenty = goods.filter((good) => good.high).map((good) => good.id);
  const list = (names) => names.join(" and ");
  return [
    short.length > 0 && small(`There's not much ${list(short)} here today, so what's made from it costs more.`),
    plenty.length > 0 && small(`There's plenty of ${list(plenty)} here today, so what's made from it costs less.`),
  ];
}

function marketMenu() {
  const { ui, act } = app;
  const g = ui.game;
  if (!g.market.length) {
    const elsewhere = g.locations.filter((l) => l.hasMarket).map((l) => l.name);
    return [
      section(`Credits: ${g.credits}`,
        empty(`There's no market at ${g.location.name}.`),
        elsewhere.length > 0 && small(`Known markets: ${elsewhere.join(", ")}.`)),
    ];
  }
  const sellable = g.inventory.filter((i) => !(i.type === "story" && i.price === 0));
  return columns(
    section(`Market at ${g.location.name}`,
      row("Your credits", g.credits),
      marketNote(g),
      g.market.map((i) => el("div", { class: "card stack gap-small" },
        el("div", { class: "spread" }, el("strong", {}, i.name), el("span", {}, `${i.buyPrice} cr`)),
        muted(i.desc),
        i.damage && small(`Damage ${i.damage[0]}-${i.damage[1]}`),
        i.defense > 0 && small(`Defense +${i.defense}`),
        el("div", {}, el("button", { disabled: g.credits < i.buyPrice || Boolean(g.combat), onclick: act({ action: "buy", id: i.id }) }, "Buy"))))),
    section("Sell",
      sellable.length ? sellable.map((i) => el("div", { class: "menu-row small" },
        el("span", {}, `${i.name}${i.count > 1 ? ` x${i.count}` : ""}`, i.equipped && el("span", { class: "tag on" }, " equipped")),
        el("button", { disabled: Boolean(g.combat), onclick: act({ action: "sell", id: i.id }) }, `Sell ${i.sellPrice} cr`))) : muted("Nothing to sell.")),
  );
}

// ---- Bestiary -----------------------------------------------------------

function bestiaryMenu() {
  const { ui, startSim } = app;
  const g = ui.game;
  const p = g.combatProfile;
  return [
    el("div", { class: "menu-cards" }, g.enemies.map((e) => el("div", { class: "card stack gap-small" },
      el("div", { class: "spread" }, el("strong", {}, e.name), e.threat && el("span", { class: "tag" }, e.threat)),
      muted(e.desc),
      small(`Health ${e.hp}, attack ${signed(e.attack)}, defense ${e.defense}, damage ${e.damage[0]}-${e.damage[1]}${e.weapon ? `, ${e.weapon}` : ""}.`),
      small(`You'd hit it ${oddsFor(p.attack, e.defense)}% of the time, and it would hit you ${oddsFor(e.attack, p.defense)}% of the time.`),
      small(`${e.talk.why} ${e.talk.could.length ? `You could try: ${e.talk.could.join(", ").toLowerCase()}.` : "There's no talking to it."}`),
      e.record && muted(`Fought ${e.record.fought}: won ${e.record.won}, lost ${e.record.lost}, ran ${e.record.fled}${e.record.talked ? `, talked down ${e.record.talked}` : ""}${e.record.gaveUp ? `, gave up ${e.record.gaveUp}` : ""}.`),
      el("div", { class: "row" },
        el("button", { disabled: !e.canSim, onclick: () => startSim(e.id) }, "Run in simulator"),
        el("button", { disabled: !e.canSim, onclick: () => startSim(e.id, true), title: "A crew member fights beside you and another comes running, while more of them arrive too." }, "With followers"))))),
    g.enemies.length > 0 && !g.enemies[0].canSim && !g.combat && muted("The simulator is aboard the Meridian."),
    g.enemiesUnseen > 0 && muted(`${g.enemiesUnseen} more ${g.enemiesUnseen === 1 ? "type" : "types"} of enemy you haven't faced yet.`),
  ];
}

// ---- Settings -----------------------------------------------------------

const fileEntry = (label, where) => el("div", { class: "menu-entry small" }, label, el("span", { class: "muted" }, where));

function settingsMenu() {
  const { ui, runAction, reading, changeReading, textSizes, toggleFullScreen, loadGame, toTitle } = app;
  // A row of buttons, with the one that's on lit up.
  const pickRow = (label, key, picks) => el("div", { class: "row small" }, label, picks.map(([value, name, title]) => el("button", {
    class: reading[key] === value ? "primary" : "",
    "aria-pressed": String(reading[key] === value),
    ...(title ? { title } : {}),
    onclick: () => changeReading({ [key]: value }),
  }, name)));
  const s = ui.settings;
  const g = ui.game;
  const choose = (provider, model) => runAction(async () => {
    ui.settings = await api("/api/settings", { provider, model });
    ui.settingsMessage = null;
  });
  const choice = (provider, id, name, note) => el("button", {
    class: `card selectable${s.provider === provider && s.model === id ? " selected" : ""}`,
    onclick: choose(provider, id),
  }, el("strong", {}, name), note && muted(note));

  let keyInput;
  return columns(
    section("Reading",
      pickRow("Story over the room:", "story", [
        ["popups", "Popups", "What people say comes up in a window over their heads"],
        ["box", "One box", "Everything comes up in the one window along the bottom"],
        ["panel", "Under the room", "The story stays in a panel under the room"],
      ]),
      pickRow("People's words:", "writing", [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"], ["instant", "All at once"]]),
      pickRow("Popup font:", "popFont", [["terminal", "Terminal"], ["book", "Book"]]),
      el("div", { class: "row small" }, "Story font:",
        el("button", { class: reading.font === "book" ? "primary" : "", "aria-pressed": String(reading.font === "book"), onclick: () => changeReading({ font: "book" }) }, "Book"),
        el("button", { class: reading.font === "terminal" ? "primary" : "", "aria-pressed": String(reading.font === "terminal"), onclick: () => changeReading({ font: "terminal" }) }, "Terminal")),
      el("div", { class: "row small" }, "Text size:",
        el("button", { "aria-label": "Smaller story text", disabled: reading.size <= textSizes.min, onclick: () => changeReading({ size: reading.size - 1 }) }, "-"),
        String(reading.size),
        el("button", { "aria-label": "Larger story text", disabled: reading.size >= textSizes.max, onclick: () => changeReading({ size: reading.size + 1 }) }, "+")),
      el("div", { class: "row small" }, "Story view:",
        el("button", { class: reading.view === "iso" ? "primary" : "", "aria-pressed": String(reading.view === "iso"), onclick: () => changeReading({ view: "iso" }) }, "Isometric"),
        el("button", { class: reading.view === "walk" ? "primary" : "", "aria-pressed": String(reading.view === "walk"), onclick: () => changeReading({ view: "walk" }) }, "Walk-around"),
        el("button", { class: reading.view === "classic" ? "primary" : "", "aria-pressed": String(reading.view === "classic"), onclick: () => changeReading({ view: "classic" }) }, "Classic")),
      folded("settings-views", "What the story views mean",
        muted("Isometric shows the room you're in, seen from an angle, wherever you are, and you can walk around and click on people and things. The story comes up over the room a piece at a time: click anywhere to go on. Walking is free. The clock runs while you explore, because everyone lives their own day, and the buttons at the top of the room pause it or speed it up. Each thing you say in a talk is one call to the AI, with the clock stopped."),
        muted("Walk-around is the same thing, drawn in console art, with the story under it. Classic gives the story the whole window, and only the story moves the clock. Popup font is for the story over the room, and Story font is for the whole story, Classic and the panel under the room."))),
    folded("settings-display", "Display",
      pickRow("Interface size:", "interface", [
        ["auto", "Automatic", "Everything grows with the window, so it looks the same on any screen"],
        ["small", "Small"],
        ["normal", "Normal"],
        ["large", "Large"],
        ["largest", "Largest"],
      ]),
      el("div", { class: "row small" }, "Full screen:", el("button", { "aria-pressed": String(Boolean(document.fullscreenElement)), onclick: toggleFullScreen }, document.fullscreenElement ? "Leave full screen" : "Go full screen")),
      muted("You can also press F11 for full screen, and pull the edges of the window to make it any size. Automatic makes everything bigger in a bigger window, so it looks the same on any screen. A size can't go past what still fits in the window.")),
    folded("settings-checks", "Skill checks",
      el("div", { class: "row small" }, "Checks open as:",
        el("button", { class: checkStyle() === "play" ? "primary" : "", "aria-pressed": String(checkStyle() === "play"), onclick: () => { setCheckStyle("play"); app.renderMenus(); } }, "A game"),
        el("button", { class: checkStyle() === "roll" ? "primary" : "", "aria-pressed": String(checkStyle() === "roll"), onclick: () => { setCheckStyle("roll"); app.renderMenus(); } }, "Just a roll")),
      muted("Playing a check's window well improves your odds. If you'd rather not, a check can go straight to the roll, at your character's own odds. Either way, the Skills menu lets you practice any of them.")),
    folded("settings-fights", "Fights",
      el("div", { class: "row small" }, "How hard enemies fight:",
        [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]].map(([id, label]) => el("button", {
          class: g.difficulty === id ? "primary" : "",
          "aria-pressed": String(g.difficulty === id),
          disabled: Boolean(g.combat),
          onclick: app.act({ action: "difficulty", id }),
        }, label))),
      muted("Stronger enemies get more health, hit more often and hit harder at Normal and Hard. Your followers stay the same. On Hard, anyone who can't fight will usually lose to anything above a minor threat, unless they bring help or run. It applies from your next fight.")),
    section("Who writes the story",
      el("div", { class: "row small" }, "New games:",
        [["written", "Written story"], ["ai", "AI game master"]].map(([id, label]) => el("button", {
          class: s.storyApplies === id ? "primary" : "",
          "aria-pressed": String(s.storyApplies === id),
          onclick: runAction(async () => { ui.settings = await api("/api/settings", { story: id }); }),
        }, label))),
      folded("settings-writers", "What the two mean",
        muted("Written story: the story is written in advance, so it's free and needs no AI. For now that's the openings for three lives, the arrival at Haven, the main story's whole first act and a story aboard the Meridian from the Leads menu, and the crew's conversations, and the rest is being written. AI game master: the written parts still play as written, for free, and the AI reads whatever you type or say in them and fits it to the story, plays everyone and everything that isn't written, and runs the stories that haven't been written out. It needs a key or a local model from below.")),
      muted(`${s.story === null ? `Until you choose, it's the ${s.storyApplies === "written" ? "written story, because no AI is set up" : "AI game master, because an AI is set up"}. ` : ""}It applies to new games. This game has ${g.mode === "written" ? "the written story" : "an AI game master"}, and that can't change once a game has started.`)),
    folded("settings-model", "AI model",
      s.claudeModels.map((m) => choice("claude", m.id, m.name, m.note)),
      s.ollama.models.map((m) => choice("ollama", m, `Local: ${m}`, "Free and private. Runs on your graphics card.")),
      !s.ollama.running && muted("Local models: Ollama isn't running, so none are listed. See the README to set it up, then come back here."),
      s.ollama.running && !s.ollama.models.length && muted("Ollama is running but has no models installed yet. See the README."),
      el("div", { class: "row" },
        el("button", { onclick: runAction(async () => {
          if (keyInput.value.trim()) ui.settings = await api("/api/settings", { apiKey: keyInput.value });
          ui.settingsMessage = await api("/api/settings/test", {});
        }) }, "Test connection"),
        el("button", { onclick: runAction(async () => { ui.settings = await api("/api/settings"); }) }, "Refresh list")),
      ui.settingsMessage && el("div", { class: `notice-inline ${ui.settingsMessage.ok ? "ok" : "fail"}` }, ui.settingsMessage.message),
      s.provider === "claude" && el("div", { class: "row small" }, "Claude's thinking:",
        ["medium", "low"].map((effort) => el("button", {
          class: s.effort === effort ? "primary" : "",
          "aria-pressed": String(s.effort === effort),
          onclick: runAction(async () => { ui.settings = await api("/api/settings", { effort }); }),
        }, effort === "medium" ? "Medium" : "Low"))),
      s.provider === "claude" && muted("Low costs less per turn, but Claude may be less careful with the story and the rules. Changing this makes Claude reload your story once.")),
    folded("settings-cost", "What the AI has cost",
      row("Last turn", s.spending.lastTurn === null ? "None yet" : money(s.spending.lastTurn)),
      row("Since you opened the game", money(s.spending.session), `${s.spending.calls} ${s.spending.calls === 1 ? "call" : "calls"}`),
      row("Since this meter was added", money(s.spending.total)),
      muted("Worked out from Anthropic's prices. Your exact bill is at console.anthropic.com. Fights and menus cost nothing.")),
    folded("settings-key", "Anthropic API key",
      small(s.hasKey ? "A key is saved on this computer." : "No key saved yet. You only need one for Claude models. Create one at console.anthropic.com."),
      keyInput = el("input", { type: "password", placeholder: "Paste your key here", autocomplete: "off", "aria-label": "Anthropic API key" }),
      el("div", { class: "row" },
        el("button", { class: "primary", onclick: runAction(async () => {
          if (!keyInput.value.trim()) throw new Error("Paste a key first.");
          ui.settings = await api("/api/settings", { apiKey: keyInput.value });
          ui.settingsMessage = await api("/api/settings/test", {});
        }) }, "Save key"),
        s.hasKey && el("button", { onclick: runAction(async () => { ui.settings = await api("/api/settings", { clearKey: true }); }) }, "Remove key"))),
    section("Saved games",
      ["slot1", "slot2", "slot3"].map((slot) => {
        const save = ui.saves.find((x) => x.slot === slot);
        return el("div", { class: "menu-row small" },
          el("span", {}, `Slot ${slot.slice(-1)}: `, save?.empty ? el("span", { class: "muted" }, "empty") : `${save.name}, level ${save.level}`),
          el("span", { class: "row" },
            el("button", { disabled: ui.streaming, onclick: runAction(async () => {
              ui.saves = (await api("/api/save", { slot })).saves;
              ui.menuMessage = { ok: true, text: `Saved to slot ${slot.slice(-1)}.` };
            }) }, "Save"),
            !save?.empty && el("button", { disabled: ui.streaming, onclick: runAction(() => loadGame(slot)) }, "Load")));
      }),
      el("div", {}, el("button", { disabled: ui.streaming, onclick: toTitle }, "Title screen"))),
    folded("settings-files", "Your files",
      small("The world is kept in files on this computer, inside the game's folder. You can open them with any text editor. If you change one, restart the game to see the change."),
      fileEntry(`${g.files.worldCharacters} important characters`, `${g.files.world}\\characters`),
      fileEntry(`${g.enemiesTotal - g.files.campaignEnemies} enemy types`, `${g.files.world}\\enemies`),
      fileEntry("Everything said in a fight", `${g.files.world}\\combat-text.json`),
      fileEntry("The written story, which you can change while the game is running", `${g.files.world}\\scenes`),
      g.files.campaign && fileEntry(`This campaign: ${g.files.campaignCharacters} ${g.files.campaignCharacters === 1 ? "person" : "people"} and ${g.files.campaignEnemies} enemy ${g.files.campaignEnemies === 1 ? "type" : "types"} added, plus your character's sheet`, g.files.campaign)),
  );
}

// ---- The list of menus --------------------------------------------------

// about is what a menu holds, for the tooltip on its button: it isn't written on the screen.
export const MENUS = {
  character: { label: "Character", command: "char", about: "Level, condition, attributes, and your numbers in a fight", view: characterMenu },
  skills: { label: "Skills", command: "skills", about: "What you're good at, your odds, and practice", view: skillsMenu },
  traits: { label: "Traits", command: "traits", about: "Traits, convictions, and everything affecting you", view: traitsMenu },
  perks: { label: "Perks", command: "perks", about: "What you've learned, and what you can learn now", view: perksMenu },
  beliefs: { label: "Beliefs", command: "beliefs", about: "Where you stand, and your standing with each faction", view: beliefsMenu },
  dossier: { label: "Your past", command: "dossier", about: "Your record, career and life history", view: dossierMenu },
  people: { label: "People", command: "people", about: "Everyone you've met or heard of", view: peopleMenu },
  quests: { label: "Quests", command: "quests", about: "What you've taken on, and the journal", view: questsMenu },
  board: { label: "Story board", command: "board", about: "Every story as boxes and arrows, to read and change, saved to its file", board: true, view: () => el("div") },
  leads: { label: "Leads", command: "leads", about: "Stories you could start here, and what people are saying", view: leadsMenu },
  codex: { label: "What you know", command: "codex", about: "Places, factions, ships and ideas you've come across", view: codexMenu },
  inventory: { label: "Inventory", command: "inv", about: "What you're carrying and wearing", view: inventoryMenu },
  ship: { label: "Ship", command: "ship", about: "The Meridian and her crew", view: shipMenu, captainOnly: true },
  fleet: { label: "Fleet", command: "fleet", about: "All 41 ships: supplies, rations, work crews and orders", view: fleetMenu },
  map: { label: "Star map", command: "map", about: "The chart of known space, and setting course", view: mapMenu },
  market: { label: "Market", command: "market", about: "Buying and selling, where there's a market", view: marketMenu },
  bestiary: { label: "Enemies met", command: "bestiary", about: "Enemies you know of, how they fight, and the simulator", view: bestiaryMenu },
  settings: { label: "Settings", command: "settings", about: "Reading, the AI, saved games, and your files", view: settingsMenu },
};

// The groups the menus sit in on the rail, each under its own heading.
export const MENU_GROUPS = [
  { title: "You", ids: ["character", "skills", "traits", "perks", "beliefs", "dossier"] },
  { title: "The story", ids: ["quests", "leads", "board", "people", "codex", "bestiary"] },
  { title: "The fleet", ids: ["fleet", "ship", "map"] },
  { title: "Gear", ids: ["inventory", "market"] },
  { title: "Game", ids: ["settings"] },
];
