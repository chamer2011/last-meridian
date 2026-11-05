// Character creation: turns the player's choices into a finished character.
// The same draft and seed always produce the same life, so the browser can ask
// for a fresh preview after every click and the server stays in charge of the rules.

import {
  ARCHETYPES, ATTR_COST, ATTR_MAX, ATTR_MAX_BUY, ATTR_MIN, ATTR_POINTS, ATTR_START, AXES, BONDS, CONTEXTS,
  CONVICTIONS, CONVICTION_THRESHOLD, DRIVES, FACTION_BELIEFS, HOMEWORLDS, IDEOLOGY_LIMIT, MAX_NEGATIVE_TRAIT_POINTS,
  MAX_TERMS, MAX_TRAITS, NAMES, NOTABLES, POLES, SKILLS, SKILL_BASE_POINTS, SKILL_CREATION_CAP, SKILL_GROUPS,
  SKILL_POINTS_PER_TERM, SPECIES, STANCE_LIMIT, TAG_COUNT, TRAITS, TRAIT_GROUPS, TRAIT_POINTS, UPBRINGINGS,
} from "./character-data.js";
import { CAREERS, FALL_CHOICES, GENERAL_EVENTS, GENERAL_MISHAPS } from "./life-data.js";
import { CORE_FACTIONS, FACTIONS, ITEMS, LOCATIONS, PERKS, STARTING_FACTIONS, STATS, STAT_INFO } from "./data.js";
import { LORE } from "./lore.js";
import { hackingClasses } from "./checks.js";
import { START_GROUPS, START_LIST } from "./role.js";
import {
  DIFFICULTY, activeConvictions, assembleGame, beliefAffinity, checkParts, clamp, crewContacts, defense,
  describeFx, ideologyTitle, maxEnergy, maxHp, oddsFor,
} from "./rules.js";

export const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "role", label: "Your place" },
  { id: "species", label: "Species" },
  { id: "homeworld", label: "Homeworld" },
  { id: "upbringing", label: "Upbringing" },
  { id: "attributes", label: "Attributes" },
  { id: "life", label: "Life" },
  { id: "skills", label: "Skills" },
  { id: "traits", label: "Traits" },
  { id: "ideology", label: "Ideology" },
  { id: "drive", label: "Drive" },
  { id: "gear", label: "Gear" },
];

export const PRONOUNS = { they: "they/them", she: "she/her", he: "he/him", custom: "custom" };

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const newSeed = () => Math.floor(Math.random() * 2147483647);
// Most of what anyone saved burned with the Concord. This is the share of pay they still have.
const PAY_KEPT = 0.5;
const termPay = (career, rank) => Math.floor(career.pay * (rank + 1) * PAY_KEPT);

// ---- Seeded randomness --------------------------------------------------

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

function shuffled(rng, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---- Cleaning up what the browser sends ---------------------------------

const cleanText = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const known = (value, table) => (typeof value === "string" && Object.hasOwn(table, value) ? value : null);
const cleanInt = (value, min, max, fallback) => (Number.isFinite(value) ? clamp(Math.trunc(value), min, max) : fallback);

function cleanCounts(raw, table, min, max) {
  const out = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const id of Object.keys(table)) {
    const n = cleanInt(raw[id], min, max, 0);
    if (n !== 0) out[id] = n;
  }
  return out;
}

const cleanList = (raw, table, max) =>
  (Array.isArray(raw) ? [...new Set(raw)].filter((id) => known(id, table)).slice(0, max) : []);

const gearAllowed = (item) => ["weapon", "armor", "consumable", "gadget"].includes(item.type) && !item.restricted;

export function normalizeDraft(raw) {
  const d = typeof raw === "object" && raw !== null ? raw : {};
  const life = typeof d.life === "object" && d.life !== null ? d.life : {};
  const attributes = {};
  for (const id of Object.keys(STATS)) attributes[id] = cleanInt(d.attributes?.[id], ATTR_MIN, ATTR_MAX_BUY, ATTR_START);
  const ideology = {};
  for (const id of Object.keys(AXES)) ideology[id] = cleanInt(d.ideology?.[id], -STANCE_LIMIT, STANCE_LIMIT, 0);
  const terms = (Array.isArray(life.terms) ? life.terms : []).slice(0, MAX_TERMS).map((t) => ({
    career: known(t?.career, CAREERS),
    choice: typeof t?.choice === "string" ? t.choice : null,
  })).filter((t) => t.career);
  return {
    name: cleanText(d.name, 40),
    callsign: cleanText(d.callsign, 30),
    pronouns: known(d.pronouns, PRONOUNS) ?? "they",
    customPronouns: cleanText(d.customPronouns, 30),
    appearance: cleanText(d.appearance, 300),
    start: known(d.start, START_LIST) ?? "captain",
    species: known(d.species, SPECIES),
    homeworld: known(d.homeworld, HOMEWORLDS),
    upbringing: known(d.upbringing, UPBRINGINGS),
    attributes,
    life: {
      seed: cleanInt(life.seed, 0, 2147483647, newSeed()),
      terms,
      finished: life.finished === true,
      fall: known(life.fall, FALL_CHOICES),
    },
    tags: cleanList(d.tags, SKILLS, TAG_COUNT),
    skills: cleanCounts(d.skills, SKILLS, 0, SKILL_CREATION_CAP),
    traits: cleanList(d.traits, TRAITS, Object.keys(TRAITS).length),
    ideology,
    drive: known(d.drive, DRIVES),
    bond: known(d.bond, BONDS),
    bondName: cleanText(d.bondName, 40),
    gear: Object.fromEntries(Object.entries(cleanCounts(d.gear, ITEMS, 0, 9)).filter(([id]) => gearAllowed(ITEMS[id]))),
  };
}

// ---- The life simulation ------------------------------------------------

export const skillCost = (rank) => (rank <= 2 ? 1 : rank <= 4 ? 2 : 3);

const addTo = (target, id, n) => { target[id] = (target[id] ?? 0) + n; };

function applyPoles(target, poles = {}) {
  for (const [id, n] of Object.entries(poles)) addTo(target, POLES[id].axis, POLES[id].sign * n);
}

function emptyLife(stage) {
  return {
    stage, terms: [], pending: null, careers: [], fallChoices: [], attrs: {}, skills: {}, traits: [], ideology: {}, factions: {},
    credits: 0, contacts: [], hooks: [], biography: [], ranks: {}, served: {}, blocked: null, traitPoints: 0, perks: [],
    completedTerms: 0, lastCareer: null,
  };
}

function careerBlockReason(career, id, life, state, speciesId) {
  if (career.blockedSpecies?.includes(speciesId)) return `Not open to ${SPECIES[speciesId].name} applicants.`;
  for (const [stat, min] of Object.entries(career.requires ?? {})) {
    if (state.attrs[stat] < min) return `Requires ${STATS[stat]} ${min}.`;
  }
  if (life.blocked === id) return "You were forced out of this career last term.";
  return null;
}

// Applies one outcome to the life so far, and lists what changed in plain words.
function applyOutcome(life, state, outcome, name) {
  const gains = [];
  const fill = (text) => text?.replaceAll("{name}", outcome.contact?.name ?? name);
  for (const [id, n] of Object.entries(outcome.skills ?? {})) {
    addTo(life.skills, id, n);
    addTo(state.ranks, id, n);
    gains.push(`${signed(n)} ${SKILLS[id].name}`);
  }
  for (const [id, n] of Object.entries(outcome.attrs ?? {})) {
    const next = clamp(state.attrs[id] + n, ATTR_MIN, ATTR_MAX);
    addTo(life.attrs, id, next - state.attrs[id]);
    state.attrs[id] = next;
    gains.push(`${signed(n)} ${STATS[id]}`);
  }
  for (const [id, n] of Object.entries(outcome.ideology ?? {})) {
    addTo(life.ideology, POLES[id].axis, POLES[id].sign * n);
    gains.push(`Belief: ${POLES[id].name} ${signed(n)}`);
  }
  for (const id of outcome.traits ?? []) {
    const trait = TRAITS[id];
    const clash = trait.excludes?.some((other) => life.traits.includes(other));
    const barred = trait.notSpecies?.includes(state.species);
    if (life.traits.includes(id) || clash || barred) continue;
    life.traits.push(id);
    if (trait.cost < 0) life.traitPoints -= trait.cost;
    gains.push(`Trait: ${trait.name}${trait.cost < 0 ? ` (+${-trait.cost} trait points)` : ""}`);
  }
  if (outcome.credits) {
    life.credits += outcome.credits;
    gains.push(`${signed(outcome.credits)} credits`);
  }
  for (const [id, n] of Object.entries(outcome.factions ?? {})) {
    addTo(life.factions, id, n);
    gains.push(`${FACTIONS[id].name} ${signed(n)}`);
  }
  if (outcome.contact) {
    const contact = { name: outcome.contact.name ?? name, attitude: outcome.contact.attitude, note: `${outcome.contact.role}. ${fill(outcome.contact.note)}` };
    life.contacts.push(contact);
    gains.push(`Contact: ${contact.name} (${contact.attitude})`);
  }
  if (outcome.hook) life.hooks.push(fill(outcome.hook));
  return { gains, text: fill(outcome.text), bio: fill(outcome.bio ?? outcome.text) };
}

export function simulateLife(draft, baseAttrs, baseRanks) {
  const speciesId = draft.species;
  const species = SPECIES[speciesId];
  const life = emptyLife("career");
  const state = { attrs: { ...baseAttrs }, ranks: { ...baseRanks }, species: speciesId };
  const bonusFor = (check) => state.attrs[check.attr] - 3 + (check.skill ? state.ranks[check.skill] ?? 0 : 0);
  const rollCheck = (rng, check, label) => {
    const bonus = bonusFor(check);
    const die = 1 + Math.floor(rng() * 20);
    const total = die + bonus;
    const success = die === 20 || (die !== 1 && total >= check.dc);
    return { label, die, bonus, total, dc: check.dc, success, skill: check.skill ? SKILLS[check.skill].name : null, attr: STATS[check.attr] };
  };
  const nameOrder = shuffled(seededRandom(draft.life.seed), NAMES);
  const seen = new Set();

  draft.life.terms.forEach((entry, i) => {
    if (life.stopped) return;
    const career = CAREERS[entry.career];
    const blocked = careerBlockReason(career, entry.career, life, state, speciesId);
    if (blocked) {
      life.stopped = true;
      life.invalid = blocked;
      return;
    }
    const rng = seededRandom((draft.life.seed + (i + 1) * 7919) >>> 0);
    const rank = life.ranks[entry.career] ?? 0;
    const name = nameOrder[i % nameOrder.length];
    const term = {
      index: i, career: entry.career, careerName: career.name, from: 18 + i * 4, to: 22 + i * 4,
      rankBefore: career.ranks[rank], rankAfter: career.ranks[rank], rolls: [], gains: [], mishap: false,
    };
    life.terms.push(term);
    life.blocked = null;
    life.lastCareer = entry.career;

    const survival = rollCheck(rng, career.danger, "Survival");
    term.rolls.push(survival);
    let bio;
    if (!survival.success) {
      const mishap = pick(rng, [...career.mishaps, ...GENERAL_MISHAPS]);
      const applied = applyOutcome(life, state, mishap, name);
      term.mishap = true;
      term.eventText = "Something goes badly wrong.";
      term.outcomeText = applied.text;
      term.gains.push(...applied.gains);
      bio = applied.bio;
      life.blocked = entry.career;
    } else {
      const fromCareer = career.events.filter((e) => !seen.has(e.id));
      const general = GENERAL_EVENTS.filter((e) => !seen.has(e.id));
      const useGeneral = !fromCareer.length || (general.length && rng() < 0.3);
      const event = pick(rng, useGeneral ? general : fromCareer);
      seen.add(event.id);
      term.eventText = event.text.replaceAll("{name}", name);
      const choice = event.choices.find((c) => c.id === entry.choice);
      if (!choice) {
        life.pending = {
          term: i,
          careerName: career.name,
          text: term.eventText,
          choices: event.choices.map((c) => ({
            id: c.id,
            label: c.label,
            check: c.check ? `${STATS[c.check.attr]}${c.check.skill ? ` + ${SKILLS[c.check.skill].name}` : ""}: ${oddsFor(bonusFor(c.check), c.check.dc)}% chance` : null,
          })),
        };
        term.pending = true;
        life.stopped = true;
        return;
      }
      term.choiceLabel = choice.label;
      let outcome = choice.result;
      if (choice.check) {
        const roll = rollCheck(rng, choice.check, "Your choice");
        term.rolls.push(roll);
        outcome = roll.success ? choice.win : choice.lose;
      }
      const applied = applyOutcome(life, state, outcome, name);
      term.outcomeText = applied.text;
      term.gains.push(...applied.gains);
      bio = applied.bio;
      if (outcome.forcedOut) life.blocked = entry.career;
      if (outcome.rank) life.ranks[entry.career] = Math.min(career.ranks.length - 1, (life.ranks[entry.career] ?? 0) + outcome.rank);
      if (!outcome.forcedOut) {
        const advance = rollCheck(rng, career.advance, "Promotion");
        term.rolls.push(advance);
        if (advance.success) life.ranks[entry.career] = Math.min(career.ranks.length - 1, (life.ranks[entry.career] ?? 0) + 1);
      }
    }

    // Every term teaches something and pays something, even a bad one.
    const served = life.served[entry.career] ?? 0;
    const core = career.core[served % career.core.length];
    addTo(life.skills, core, 1);
    addTo(state.ranks, core, 1);
    term.gains.push(`+1 ${SKILLS[core].name}`);
    life.served[entry.career] = served + 1;
    const finalRank = life.ranks[entry.career] ?? 0;
    term.rankAfter = career.ranks[finalRank];
    const pay = Math.floor(termPay(career, finalRank) * (term.mishap ? 0.5 : 1));
    life.credits += pay;
    term.gains.push(`+${pay} credits`);
    for (const [id, n] of Object.entries(career.perTerm?.factions ?? {})) addTo(life.factions, id, n);
    applyPoles(life.ideology, career.perTerm?.ideology);

    // Time catches up with everyone, sooner or later.
    const agingFrom = species.agelessTerms ?? 4;
    if (i >= agingFrom) {
      const aging = rollCheck(rng, { attr: "endurance", dc: 6 + (i - agingFrom + 1) * 3 }, "Aging");
      term.rolls.push(aging);
      if (!aging.success) {
        const id = pick(rng, ["might", "agility", "endurance", "perception"]);
        const next = clamp(state.attrs[id] - 1, ATTR_MIN, ATTR_MAX);
        addTo(life.attrs, id, next - state.attrs[id]);
        state.attrs[id] = next;
        term.gains.push(`-1 ${STATS[id]} (age)`);
      }
    }

    const promoted = term.rankAfter !== term.rankBefore ? ` Rose to ${term.rankAfter}.` : "";
    life.biography.push(`Ages ${term.from}-${term.to}, ${career.name}: ${bio}${promoted}`);
    life.completedTerms = i + 1;
  });

  const available = (id) => careerBlockReason(CAREERS[id], id, life, state, speciesId);
  life.careers = Object.entries(CAREERS).map(([id, career]) => {
    const rank = life.ranks[id] ?? 0;
    return {
      id,
      name: career.name,
      blurb: career.blurb,
      blocked: available(id),
      served: life.served[id] ?? 0,
      rankTitle: career.ranks[rank],
      survival: oddsFor(bonusFor(career.danger), career.danger.dc),
      promotion: oddsFor(bonusFor(career.advance), career.advance.dc),
      pay: termPay(career, rank),
      core: career.core.map((s) => SKILLS[s].name),
      signature: PERKS[career.signature].name,
    };
  });
  life.fallChoices = Object.entries(FALL_CHOICES).map(([id, f]) => ({ id, label: f.label, desc: f.desc }));
  life.reachedLimit = life.completedTerms >= MAX_TERMS;

  if (life.pending) {
    life.stage = "event";
  } else if (life.invalid) {
    life.stage = "career";
  } else if (life.completedTerms === 0 || (!draft.life.finished && !life.reachedLimit)) {
    life.stage = "career";
  } else if (!draft.life.fall) {
    life.stage = "fall";
  } else {
    const fall = FALL_CHOICES[draft.life.fall];
    // Only one of them ended up with the Meridian, and everyone else ended up somewhere else.
    const story = draft.start !== "captain" && fall.result.other ? { ...fall.result, ...fall.result.other } : fall.result;
    const applied = applyOutcome(life, state, story, nameOrder[MAX_TERMS]);
    life.fall = { label: fall.label, text: applied.text, gains: applied.gains };
    life.biography.push(`The Fall of the Concord: ${applied.bio}`);
    life.stage = "done";
  }

  // Your career perk comes from where you spent the most time, or anywhere you stayed for a while.
  const careersServed = Object.entries(life.served);
  if (careersServed.length) {
    const longest = careersServed.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    life.perks = [...new Set([CAREERS[longest].signature, ...careersServed.filter(([, n]) => n >= 2).map(([id]) => CAREERS[id].signature)])];
  }
  delete life.stopped;
  return life;
}

// ---- Working out the whole character ------------------------------------

function mergeCounts(...sources) {
  const out = {};
  for (const source of sources) for (const [id, n] of Object.entries(source ?? {})) addTo(out, id, n);
  return out;
}

const pronounLabel = (draft) =>
  (draft.pronouns === "custom" ? draft.customPronouns.trim() || "they/them" : PRONOUNS[draft.pronouns]);

function traitProblem(id, draft, life, stats, chosenAndAcquired) {
  const trait = TRAITS[id];
  if (trait.notSpecies?.includes(draft.species)) return `Not available to ${SPECIES[draft.species].name} characters.`;
  for (const [stat, min] of Object.entries(trait.requires ?? {})) {
    if (stats[stat] < min) return `Requires ${STATS[stat]} ${min}.`;
  }
  const clash = (trait.excludes ?? []).find((other) => chosenAndAcquired.includes(other));
  if (clash) return `Can't be combined with ${TRAITS[clash].name}.`;
  return null;
}

export function buildCharacter(raw) {
  const draft = normalizeDraft(raw);
  const errors = Object.fromEntries(STEPS.map((s) => [s.id, []]));
  const warnings = Object.fromEntries(STEPS.map((s) => [s.id, []]));
  const species = SPECIES[draft.species];
  const homeworld = HOMEWORLDS[draft.homeworld];
  const upbringing = UPBRINGINGS[draft.upbringing];

  if (!draft.name.trim()) errors.identity.push("Enter your captain's name.");
  if (draft.pronouns === "custom" && !draft.customPronouns.trim()) errors.identity.push("Enter your captain's pronouns.");
  if (!species) errors.species.push("Choose a species.");
  if (!homeworld) errors.homeworld.push("Choose a homeworld.");
  if (!upbringing) errors.upbringing.push("Choose an upbringing.");

  // Attributes
  const attrBudget = ATTR_POINTS + (species?.bonusAttrPoints ?? 0);
  const attrSpent = Object.values(draft.attributes).reduce((sum, v) => sum + ATTR_COST[v], 0);
  const capFor = (id) => species?.attrCaps?.[id] ?? ATTR_MAX;
  const baseAttrs = {};
  for (const id of Object.keys(STATS)) baseAttrs[id] = clamp(draft.attributes[id] + (species?.attrs?.[id] ?? 0), ATTR_MIN, capFor(id));
  const attrLeft = attrBudget - attrSpent;
  if (attrLeft < 0) errors.attributes.push(`You've overspent by ${-attrLeft} attribute point${attrLeft === -1 ? "" : "s"}.`);
  if (attrLeft > 0) warnings.attributes.push(`You have ${attrLeft} unspent attribute point${attrLeft === 1 ? "" : "s"}.`);

  // Life
  const preRanks = mergeCounts(species?.skills, homeworld?.skills, upbringing?.skills);
  const life = species && homeworld && upbringing ? simulateLife(draft, baseAttrs, preRanks) : emptyLife("origins");
  if (life.invalid) errors.life.push(`Your life history is no longer valid: ${life.invalid}`);
  else if (life.stage !== "done") errors.life.push("Finish living your life, up to the Fall of the Concord.");
  const terms = life.completedTerms;

  const stats = {};
  for (const id of Object.keys(STATS)) stats[id] = clamp(baseAttrs[id] + (life.attrs[id] ?? 0), ATTR_MIN, capFor(id));

  // Skills
  if (draft.tags.length < TAG_COUNT) errors.skills.push(`Tag ${TAG_COUNT - draft.tags.length} more skill${TAG_COUNT - draft.tags.length === 1 ? "" : "s"}.`);
  const skillBudget = SKILL_BASE_POINTS + SKILL_POINTS_PER_TERM * terms + Math.max(0, stats.intellect - 3);
  let skillSpent = 0;
  const ranks = {};
  const freeRanks = {};
  const boughtRanks = {};
  for (const id of Object.keys(SKILLS)) {
    const free = (preRanks[id] ?? 0) + (life.skills[id] ?? 0) + (draft.tags.includes(id) ? 1 : 0);
    const bought = Math.max(0, Math.min(draft.skills[id] ?? 0, SKILL_CREATION_CAP - free));
    for (let r = free + 1; r <= free + bought; r += 1) skillSpent += skillCost(r);
    freeRanks[id] = free;
    boughtRanks[id] = bought;
    ranks[id] = free + bought;
    if (bought) draft.skills[id] = bought;
    else delete draft.skills[id];
  }
  const skillLeft = skillBudget - skillSpent;
  if (skillLeft < 0) errors.skills.push(`You've overspent by ${-skillLeft} skill point${skillLeft === -1 ? "" : "s"}.`);
  if (skillLeft > 0) warnings.skills.push(`You have ${skillLeft} unspent skill point${skillLeft === 1 ? "" : "s"}.`);

  // Traits
  const acquired = life.traits;
  const chosen = draft.traits.filter((id) => !acquired.includes(id));
  draft.traits = chosen;
  const allTraits = [...acquired, ...chosen];
  const traitBudget = TRAIT_POINTS + (species?.bonusTraitPoints ?? 0) + life.traitPoints;
  const traitSpent = chosen.reduce((sum, id) => sum + TRAITS[id].cost, 0);
  const traitLeft = traitBudget - traitSpent;
  const negativeTotal = chosen.reduce((sum, id) => sum + Math.max(0, -TRAITS[id].cost), 0);
  if (traitLeft < 0) errors.traits.push(`You've overspent by ${-traitLeft} trait point${traitLeft === -1 ? "" : "s"}.`);
  if (chosen.length > MAX_TRAITS) errors.traits.push(`You can choose at most ${MAX_TRAITS} traits.`);
  if (negativeTotal > MAX_NEGATIVE_TRAIT_POINTS) errors.traits.push(`Flaws can give you at most ${MAX_NEGATIVE_TRAIT_POINTS} trait points.`);
  for (const id of chosen) {
    const problem = traitProblem(id, draft, life, stats, allTraits);
    if (problem) errors.traits.push(`${TRAITS[id].name}: ${problem}`);
  }

  // Beliefs
  const shifts = mergeCounts(life.ideology);
  applyPoles(shifts, homeworld?.ideology);
  applyPoles(shifts, upbringing?.ideology);
  const ideology = {};
  for (const id of Object.keys(AXES)) ideology[id] = clamp(draft.ideology[id] + (shifts[id] ?? 0), -IDEOLOGY_LIMIT, IDEOLOGY_LIMIT);

  // Drive and bond
  const drive = DRIVES[draft.drive];
  const bond = BONDS[draft.bond];
  if (!drive) errors.drive.push("Choose what drives your captain.");
  if (!bond) errors.drive.push("Choose your captain's closest bond.");

  // Credits and gear
  const traitFx = allTraits.map((id) => TRAITS[id].fx ?? {});
  const creditsStart = Math.max(0, 100 + (homeworld?.credits ?? 0) + (upbringing?.credits ?? 0) + life.credits + traitFx.reduce((sum, fx) => sum + (fx.credits ?? 0), 0));
  const gearSpent = Object.entries(draft.gear).reduce((sum, [id, n]) => sum + ITEMS[id].price * n, 0);
  const creditsLeft = creditsStart - gearSpent;
  if (creditsLeft < 0) errors.gear.push(`You've overspent by ${-creditsLeft} credits.`);

  // Faction standing
  const factions = { ...STARTING_FACTIONS };
  const factionSources = [species?.fx?.factions, homeworld?.factions, upbringing?.factions, life.factions, drive?.fx?.factions, ...traitFx.map((fx) => fx.factions)];
  for (const source of factionSources) for (const [id, n] of Object.entries(source ?? {})) factions[id] += n;
  for (const [id, beliefs] of Object.entries(FACTION_BELIEFS)) factions[id] = clamp(Math.round(factions[id] + beliefAffinity(ideology, beliefs) * 15), -100, 100);

  // Background summary
  const careerHistory = [];
  for (const term of life.terms) {
    if (term.pending) continue;
    const last = careerHistory.at(-1);
    if (last?.career === term.career) {
      last.terms += 1;
      last.rankTitle = term.rankAfter;
    } else {
      careerHistory.push({ career: term.career, name: term.careerName, terms: 1, rankTitle: term.rankAfter });
    }
  }
  const lastJob = careerHistory.at(-1);
  const background = lastJob ? `${lastJob.rankTitle}, ${lastJob.name}` : "No career yet";
  const age = 18 + terms * 4 + (draft.life.seed % 3);
  const learning = clamp(1.4 - terms * 0.1, 0.8, 1.3);

  const contacts = [...life.contacts];
  let bondPerson = null;
  if (bond?.attitude) {
    const nameOrder = shuffled(seededRandom(draft.life.seed), NAMES);
    bondPerson = draft.bondName.trim() || nameOrder[MAX_TERMS + 1];
    contacts.push({ name: bondPerson, attitude: bond.attitude, note: bond.note });
  }

  const items = [];
  if (lastJob) items.push(...CAREERS[lastJob.career].kit);
  for (const [id, n] of Object.entries(draft.gear)) for (let i = 0; i < n; i += 1) items.push(id);

  const game = assembleGame({
    name: draft.name.trim() || "Unnamed",
    character: {
      callsign: draft.callsign.trim(),
      pronouns: pronounLabel(draft),
      appearance: draft.appearance.trim(),
      species: draft.species ?? "human",
      homeworld: draft.homeworld,
      upbringing: draft.upbringing,
      drive: draft.drive,
      bond: draft.bond,
      bondPerson,
      age,
      background,
      careers: careerHistory,
      biography: life.biography,
      hooks: life.hooks,
      learning,
    },
    stats,
    skills: ranks,
    tags: draft.tags,
    traits: allTraits,
    ideology,
    credits: Math.max(0, creditsLeft),
    perks: life.perks,
    factions,
    contacts,
    items,
    start: draft.start,
  });

  const complete = Object.values(errors).every((list) => list.length === 0);
  return {
    game,
    complete,
    view: {
      draft,
      errors,
      warnings,
      complete,
      attributes: Object.fromEntries(Object.keys(STATS).map((id) => {
        const value = stats[id];
        const bought = draft.attributes[id];
        const next = ATTR_COST[bought + 1];
        return [id, {
          bought,
          species: species?.attrs?.[id] ?? 0,
          life: life.attrs[id] ?? 0,
          value,
          mod: value - 3,
          raiseCost: next === undefined ? null : next - ATTR_COST[bought],
          canRaise: next !== undefined && next - ATTR_COST[bought] <= attrLeft && baseAttrs[id] < capFor(id),
          canLower: bought > ATTR_MIN,
          cap: capFor(id),
        }];
      })),
      attrPoints: { budget: attrBudget, spent: attrSpent, left: attrLeft },
      skills: Object.fromEntries(Object.keys(SKILLS).map((id) => {
        const rank = ranks[id];
        const bonus = checkParts(game, { skill: id }).total;
        const cost = rank < SKILL_CREATION_CAP ? skillCost(rank + 1) : null;
        return [id, {
          free: freeRanks[id],
          bought: boughtRanks[id],
          rank,
          tagged: draft.tags.includes(id),
          bonus,
          odds: oddsFor(bonus, DIFFICULTY.moderate),
          nextCost: cost,
          canRaise: cost !== null && cost <= skillLeft,
          canLower: boughtRanks[id] > 0,
        }];
      })),
      skillPoints: { budget: skillBudget, spent: skillSpent, left: skillLeft },
      traitPoints: { budget: traitBudget, spent: traitSpent, left: traitLeft, negativeTotal },
      traits: Object.fromEntries(Object.keys(TRAITS).map((id) => {
        const isAcquired = acquired.includes(id);
        const isChosen = chosen.includes(id);
        const others = allTraits.filter((t) => t !== id);
        const problem = isAcquired ? null : traitProblem(id, draft, life, stats, others);
        return [id, { acquired: isAcquired, chosen: isChosen, problem, affordable: TRAITS[id].cost <= traitLeft }];
      })),
      ideology: Object.fromEntries(Object.keys(AXES).map((id) => [id, { stance: draft.ideology[id], shift: shifts[id] ?? 0, value: ideology[id] }])),
      ideologyTitle: ideologyTitle(ideology),
      convictions: activeConvictions(ideology).map((c) => ({ id: c.id, name: c.name, pole: c.pole, effects: describeFx(c.fx) })),
      factions: Object.entries(factions).filter(([id]) => CORE_FACTIONS.includes(id)).map(([id, value]) => ({
        id, name: FACTIONS[id].name, value, affinity: Math.round(beliefAffinity(ideology, FACTION_BELIEFS[id]) * 100),
      })),
      crew: crewContacts(ideology).map((c) => ({ name: c.name, attitude: c.attitude, note: c.note })),
      notables: Object.values(NOTABLES).filter((n) => n.prominent).map((n) => ({ name: n.name, role: n.role, affinity: Math.round(beliefAffinity(ideology, n.beliefs) * 100) })),
      life: {
        stage: life.stage,
        terms: life.terms,
        pending: life.pending,
        careers: life.careers,
        fallChoices: life.fallChoices,
        fall: life.fall ?? null,
        completedTerms: terms,
        maxTerms: MAX_TERMS,
        blocked: life.blocked ? CAREERS[life.blocked].name : null,
        reachedLimit: life.reachedLimit,
        contacts,
        hooks: life.hooks,
        biography: life.biography,
        started: draft.life.terms.length > 0,
      },
      kit: lastJob ? CAREERS[lastJob.career].kit : [],
      credits: { start: creditsStart, spent: gearSpent, left: creditsLeft },
      perks: life.perks.map((id) => ({ id, name: PERKS[id].name, desc: PERKS[id].desc })),
      start: {
        id: draft.start,
        name: START_LIST[draft.start].name,
        begin: START_LIST[draft.start].captain ? "Take command of the Meridian" : `Begin at ${LOCATIONS[START_LIST[draft.start].place]?.name ?? "the start"}`,
      },
      sheet: {
        name: draft.name.trim(),
        callsign: draft.callsign.trim(),
        pronouns: pronounLabel(draft),
        species: species?.name ?? null,
        homeworld: homeworld?.name ?? null,
        upbringing: upbringing?.name ?? null,
        drive: drive?.name ?? null,
        appearance: draft.appearance.trim(),
        age,
        background,
        hp: maxHp(game),
        energy: maxEnergy(game),
        defense: defense(game),
        credits: creditsLeft,
        learning,
        traits: allTraits.map((id) => TRAITS[id].name),
        weapon: ITEMS[game.equipped.weapon]?.name ?? null,
        armor: ITEMS[game.equipped.armor]?.name ?? null,
      },
    },
  };
}

export function createGameFromDraft(draft) {
  const built = buildCharacter(draft);
  if (!built.complete) {
    const first = Object.values(built.view.errors).flat()[0];
    throw new Error(first ?? "Your character isn't finished.");
  }
  return built.game;
}

// ---- Random and ready-made characters -----------------------------------

function spendAttributes(draft, rng, targets) {
  const species = SPECIES[draft.species];
  const budget = ATTR_POINTS + (species?.bonusAttrPoints ?? 0);
  const ids = Object.keys(STATS);
  const spent = () => ids.reduce((sum, id) => sum + ATTR_COST[draft.attributes[id]], 0);
  if (targets) {
    for (const id of ids) draft.attributes[id] = targets[id] ?? ATTR_START;
    // If a target build costs too much for this species, trim the most expensive values.
    while (spent() > budget) {
      const top = ids.reduce((a, b) => (draft.attributes[b] > draft.attributes[a] ? b : a));
      draft.attributes[top] -= 1;
    }
  }
  const favorites = shuffled(rng, ids).slice(0, 3);
  for (let guard = 0; guard < 200; guard += 1) {
    const left = budget - spent();
    if (left <= 0) break;
    const pool = rng() < 0.6 ? favorites : ids;
    const id = pick(rng, pool);
    const value = draft.attributes[id];
    const next = ATTR_COST[value + 1];
    const atCap = species?.attrCaps?.[id] !== undefined && value + (species.attrs?.[id] ?? 0) >= species.attrCaps[id];
    if (next !== undefined && next - ATTR_COST[value] <= left && !atCap) draft.attributes[id] = value + 1;
  }
}

const baseAttrsOf = (draft) => Object.fromEntries(Object.keys(STATS).map((id) => {
  const species = SPECIES[draft.species];
  return [id, clamp(draft.attributes[id] + (species?.attrs?.[id] ?? 0), ATTR_MIN, species?.attrCaps?.[id] ?? ATTR_MAX)];
}));

function liveRandomLife(draft, rng, plan) {
  const preRanks = mergeCounts(SPECIES[draft.species].skills, HOMEWORLDS[draft.homeworld].skills, UPBRINGINGS[draft.upbringing].skills);
  const baseAttrs = baseAttrsOf(draft);
  const wanted = plan.careers ? plan.careers.length : 2 + Math.floor(rng() * 4);
  for (let guard = 0; guard < MAX_TERMS * 3; guard += 1) {
    const life = simulateLife(draft, baseAttrs, preRanks);
    if (life.stage === "event") {
      draft.life.terms[life.pending.term].choice = pick(rng, life.pending.choices).id;
      continue;
    }
    if (life.stage === "career" && life.completedTerms < wanted) {
      const open = life.careers.filter((c) => !c.blocked);
      const planned = plan.careers?.[life.completedTerms];
      const previous = draft.life.terms.at(-1)?.career;
      let next = open.find((c) => c.id === planned)?.id;
      if (!next && previous && rng() < 0.65) next = open.find((c) => c.id === previous)?.id;
      if (!next) next = pick(rng, open).id;
      draft.life.terms.push({ career: next, choice: null });
      continue;
    }
    if (life.stage === "career") {
      draft.life.finished = true;
      continue;
    }
    break;
  }
  draft.life.finished = true;
  draft.life.fall = plan.fall ?? pick(rng, Object.keys(FALL_CHOICES));
}

function spendSkills(draft, rng, priorities) {
  const { view } = buildCharacter(draft);
  let left = view.skillPoints.left;
  const ranks = Object.fromEntries(Object.entries(view.skills).map(([id, s]) => [id, s.rank]));
  const order = [...priorities, ...shuffled(rng, Object.keys(SKILLS))];
  for (let guard = 0; guard < 300 && left > 0; guard += 1) {
    // Raise the first useful skill that's still cheap, which spreads points across a few skills.
    const cheapest = order.filter((id) => ranks[id] < SKILL_CREATION_CAP && skillCost(ranks[id] + 1) <= left);
    if (!cheapest.length) break;
    const id = guard % 3 === 2 ? pick(rng, cheapest) : cheapest.reduce((best, s) => (ranks[s] < ranks[best] - 1 ? s : best), cheapest[0]);
    left -= skillCost(ranks[id] + 1);
    ranks[id] += 1;
    draft.skills[id] = (draft.skills[id] ?? 0) + 1;
  }
}

function chooseTraits(draft, rng, wanted) {
  const order = wanted ?? shuffled(rng, Object.keys(TRAITS)).slice(0, 8);
  draft.traits = [];
  for (const id of order) {
    if (!wanted && draft.traits.length >= 3 + Math.floor(rng() * 2)) break;
    const { view } = buildCharacter(draft);
    const status = view.traits[id];
    const fits = !status.problem && !status.acquired && !status.chosen && status.affordable
      && view.traitPoints.negativeTotal + Math.max(0, -TRAITS[id].cost) <= MAX_NEGATIVE_TRAIT_POINTS;
    if (fits) draft.traits.push(id);
  }
}

export function randomDraft({ seed = newSeed(), archetype = null, keep = {}, anyone = false } = {}) {
  const rng = seededRandom(seed);
  const plan = ARCHETYPES[archetype] ?? {};
  const draft = normalizeDraft({ life: { seed } });

  draft.name = cleanText(keep.name, 40).trim() ? cleanText(keep.name, 40) : pick(rng, NAMES);
  draft.callsign = cleanText(keep.callsign, 30);
  draft.pronouns = known(keep.pronouns, PRONOUNS) ?? pick(rng, ["they", "she", "he"]);
  draft.customPronouns = cleanText(keep.customPronouns, 30);
  draft.appearance = cleanText(keep.appearance, 300);
  draft.start = anyone ? pick(rng, Object.keys(START_LIST)) : known(keep.start, START_LIST) ?? "captain";
  draft.species = plan.species ?? pick(rng, Object.keys(SPECIES));
  draft.homeworld = plan.homeworld ?? pick(rng, Object.keys(HOMEWORLDS));
  draft.upbringing = plan.upbringing ?? pick(rng, Object.keys(UPBRINGINGS));
  spendAttributes(draft, rng, plan.attributes);
  liveRandomLife(draft, rng, plan);

  const lastCareer = CAREERS[draft.life.terms.at(-1)?.career];
  const careerSkills = lastCareer?.core ?? [];
  draft.tags = (plan.tags ?? careerSkills.slice(0, TAG_COUNT)).slice(0, TAG_COUNT);
  spendSkills(draft, rng, plan.skills ?? careerSkills);
  chooseTraits(draft, rng, plan.traits);

  for (const id of Object.keys(AXES)) {
    draft.ideology[id] = plan.ideology?.[id] ?? Math.round((rng() - 0.5) * 8);
  }
  draft.drive = plan.drive ?? pick(rng, Object.keys(DRIVES));
  draft.bond = plan.bond ?? pick(rng, Object.keys(BONDS));

  const { view } = buildCharacter(draft);
  let credits = view.credits.left;
  const shopping = plan.gear ?? shuffled(rng, ["medkit", "medkit", "stim", "energy_cell", "repair_kit", "fuel_cell"]).slice(0, 3);
  for (const id of shopping) {
    if (ITEMS[id].price <= credits) {
      credits -= ITEMS[id].price;
      draft.gear[id] = (draft.gear[id] ?? 0) + 1;
    }
  }
  return draft;
}

// ---- What the browser needs to draw the creator -------------------------

const withEffects = (table, extra = () => ({})) => Object.fromEntries(Object.entries(table).map(([id, entry]) => [id, {
  id,
  name: entry.name,
  desc: entry.desc,
  ...extra(entry),
}]));

function originEffects(entry) {
  const effects = [];
  for (const [id, n] of Object.entries(entry.attrs ?? {})) effects.push(`${signed(n)} ${STATS[id]}`);
  for (const [id, cap] of Object.entries(entry.attrCaps ?? {})) effects.push(`${STATS[id]} can't exceed ${cap}`);
  for (const [id, n] of Object.entries(entry.skills ?? {})) effects.push(`${SKILLS[id].name} rank ${n}`);
  if (entry.bonusAttrPoints) effects.push(`+${entry.bonusAttrPoints} attribute points`);
  if (entry.bonusTraitPoints) effects.push(`+${entry.bonusTraitPoints} trait point`);
  if (entry.credits) effects.push(`+${entry.credits} starting credits`);
  for (const [id, n] of Object.entries(entry.factions ?? {})) effects.push(`${FACTIONS[id].name} ${signed(n)}`);
  for (const [id, n] of Object.entries(entry.ideology ?? {})) effects.push(`Belief: ${POLES[id].name} ${signed(n)}`);
  if (entry.agelessTerms) effects.push(entry.agelessTerms > MAX_TERMS ? "doesn't age" : "ages very slowly");
  effects.push(...describeFx(entry.fx));
  return { effects };
}

export function creatorSetup() {
  return {
    starts: Object.fromEntries(Object.entries(START_LIST).map(([id, start]) => [id, { id, group: start.group, name: start.name, desc: start.desc, pay: start.job?.pay ?? null, place: LOCATIONS[start.place]?.name ?? null }])),
    startGroups: START_GROUPS,
    steps: STEPS,
    pronouns: PRONOUNS,
    stats: STATS,
    statInfo: STAT_INFO,
    species: withEffects(SPECIES, originEffects),
    homeworlds: withEffects(HOMEWORLDS, originEffects),
    upbringings: withEffects(UPBRINGINGS, originEffects),
    skills: SKILLS,
    skillGroups: SKILL_GROUPS,
    traits: withEffects(TRAITS, (t) => ({ group: t.group, cost: t.cost, effects: describeFx(t.fx) })),
    traitGroups: TRAIT_GROUPS,
    axes: Object.fromEntries(Object.entries(AXES).map(([id, axis]) => [id, {
      id,
      name: axis.name,
      question: axis.question,
      low: { ...POLES[axis.low], id: axis.low, conviction: CONVICTIONS[axis.low].name, effects: describeFx(CONVICTIONS[axis.low].fx) },
      high: { ...POLES[axis.high], id: axis.high, conviction: CONVICTIONS[axis.high].name, effects: describeFx(CONVICTIONS[axis.high].fx) },
    }])),
    drives: withEffects(DRIVES, (d) => ({ effects: describeFx(d.fx) })),
    bonds: withEffects(BONDS),
    archetypes: Object.fromEntries(Object.entries(ARCHETYPES).map(([id, a]) => [id, { id, name: a.name, blurb: a.blurb }])),
    gear: Object.entries(ITEMS).filter(([, item]) => gearAllowed(item)).map(([id, item]) => ({ id, ...item })),
    items: ITEMS,
    limits: {
      tagCount: TAG_COUNT,
      skillCap: SKILL_CREATION_CAP,
      stanceLimit: STANCE_LIMIT,
      ideologyLimit: IDEOLOGY_LIMIT,
      convictionThreshold: CONVICTION_THRESHOLD,
      maxTraits: MAX_TRAITS,
      maxNegative: MAX_NEGATIVE_TRAIT_POINTS,
    },
    contexts: CONTEXTS,
    difficulty: DIFFICULTY,
    hackingClasses: hackingClasses(),
    lore: LORE,
  };
}
