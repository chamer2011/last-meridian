// The game's rules. The AI can narrate whatever it likes, but only this code
// changes health, money, items and so on, so the story can't cheat.

import { allCharacters, allEnemies, campaignCharacters, campaignEnemies, campaignFolderName, findCharacter, findEnemy, fullName } from "./campaign.js";
import {
  ABILITIES, CORE_FACTIONS, FACTIONS, ITEMS, LOCATIONS, PERKS, STARTING_QUESTS, STATS, STAT_INFO,
} from "./data.js";
import {
  ATTITUDE_VALUES, ATTR_MAX, AXES, BONDS, CONDITIONS, CONTEXTS, CONVICTIONS, CONVICTION_THRESHOLD, DRIVES,
  FACTION_BELIEFS, HOMEWORLDS, IDEOLOGY_LIMIT, NOTABLES, POLES, SKILLS, SKILL_GROUPS, SKILL_MAX, SPECIES,
  TAG_LEARN_RATE, TRAITS, UPBRINGINGS,
} from "./character-data.js";
import { checkView } from "./checks.js";
import { FIGHT_DIFFICULTIES, attackBonus, combatProfile, combatView, enemyNumbers, parleyNotes } from "./combat.js";
import { advanceWorld, holdingsOf, itemFactor, newWorld, newsView, placeLine, placeNow, worldOf } from "./daily.js";
import { advanceFleet, chairOf, chartEntry, fleetGoingHungry, fleetJumped, fleetLine, fleetOf, fleetView, isCharted, jumpCost, newFleet } from "./fleet.js";
import { advanceLife, lifeOf } from "./life.js";
import { startingLoreIds } from "./lore.js";
import { THREAT_LABELS } from "./npc.js";
import { START_LIST, inTheFleet, isCaptain, jobHere, roleBrief, startOf, toOutsider } from "./role.js";
import { advanceStories, clockOf } from "./story-clock.js";
import { emptyStory, storyView } from "./story-library.js";
import { startInRoom, talkView, walkLine, walkView } from "./walk.js";
import { buildLoreIndex, findLoreIds } from "../public/story.js";

export { combatAction, startCombat } from "./combat.js";

// Limits on what the AI may do, per player message.
export const TURN_LIMITS = {
  xp: 150, creditsGained: 500, itemsGiven: 2, damage: 30, stress: 40, ideologyShifts: 2, traitChanges: 1, hours: 240, training: 40, loreEntries: 3, newCharacters: 3, newEnemies: 2,
};

export const roll = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// ---- Passive effects ----------------------------------------------------

// Every source of passive effects a character has right now.
function fxSources(game) {
  const list = [];
  const add = (fx) => { if (fx) list.push(fx); };
  add(SPECIES[game.character?.species]?.fx);
  add(DRIVES[game.character?.drive]?.fx);
  for (const id of game.traits ?? []) add(TRAITS[id]?.fx);
  for (const id of game.perks ?? []) add(PERKS[id]?.fx);
  for (const c of game.conditions ?? []) add(CONDITIONS[c.id]?.fx);
  for (const c of activeConvictions(game.ideology)) add(c.fx);
  for (const id of Object.keys(game.inventory ?? {})) add(ITEMS[id]?.fx);
  return list;
}

export const fxSum = (game, key) => fxSources(game).reduce((sum, fx) => sum + (fx[key] ?? 0), 0);
export const fxProduct = (game, key) => fxSources(game).reduce((product, fx) => product * (fx[key] ?? 1), 1);
export const fxOf = (game, key, id) => fxSources(game).reduce((sum, fx) => sum + (fx[key]?.[id] ?? 0), 0);

// Turns an effect into plain words, so the screen always matches what the numbers do.
export function describeFx(fx = {}) {
  const out = [];
  const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
  const rate = (value, label, faster, slower) => {
    if (value === undefined) return;
    const percent = Math.round(Math.abs(1 - value) * 100);
    out.push(`${label} ${percent}% ${value > 1 ? faster : slower}`);
  };
  for (const [id, n] of Object.entries(fx.attrs ?? {})) out.push(`${signed(n)} ${STATS[id]}`);
  for (const [id, n] of Object.entries(fx.skills ?? {})) out.push(`${signed(n)} ${SKILLS[id].name}`);
  for (const [id, n] of Object.entries(fx.context ?? {})) out.push(`${signed(n)} ${CONTEXTS[id]}`);
  if (fx.maxHp) out.push(`${signed(fx.maxHp)} max health`);
  if (fx.maxEnergy) out.push(`${signed(fx.maxEnergy)} max energy`);
  if (fx.attack) out.push(`${signed(fx.attack)} attack`);
  if (fx.defense) out.push(`${signed(fx.defense)} defense`);
  if (fx.damage) out.push(`${signed(fx.damage)} damage`);
  if (fx.flee) out.push(`${signed(fx.flee)} to escape fights`);
  if (fx.checks) out.push(`${signed(fx.checks)} on all checks`);
  for (const id of Object.keys(fx.windowTier ?? {})) out.push(`better tools in ${SKILLS[id].name} check windows`);
  rate(fx.stressRate, "stress builds", "faster", "slower");
  rate(fx.stressRecovery, "stress fades", "faster", "slower");
  rate(fx.fatigueRate, "fatigue builds", "faster", "slower");
  rate(fx.learnRate, "skills improve", "faster", "slower");
  rate(fx.healRate, "medkits heal", "more", "less");
  if (fx.priceBonus) out.push(`market prices ${Math.round(fx.priceBonus * 100)}% better`);
  if (fx.stressOnKill > 0) out.push(`winning a fight adds ${fx.stressOnKill} stress`);
  if (fx.stressOnKill < 0) out.push(`winning a fight relieves ${-fx.stressOnKill} stress`);
  if (fx.credits) out.push(`${signed(fx.credits)} starting credits`);
  for (const [id, n] of Object.entries(fx.factions ?? {})) out.push(`${FACTIONS[id].name} ${signed(n)}`);
  return out;
}

// ---- Attributes and derived numbers -------------------------------------

export function attr(game, id) {
  const cap = SPECIES[game.character?.species]?.attrCaps?.[id] ?? ATTR_MAX + 2;
  return clamp((game.stats[id] ?? 1) + fxOf(game, "attrs", id), 1, cap);
}

export const attrMod = (game, id) => attr(game, id) - 3;
export const skillRank = (game, id) => game.skills?.[id] ?? 0;

export const maxHp = (game) =>
  Math.max(1, 20 + attr(game, "endurance") * 4 + attr(game, "might") + (game.level - 1) * 5 + fxSum(game, "maxHp"));

export const maxEnergy = (game) =>
  Math.max(1, 3 + attr(game, "willpower") + attr(game, "resonance") + Math.floor(game.level / 2) + fxSum(game, "maxEnergy"));

export const xpToNext = (level) => 100 * level;

export function defense(game) {
  const armor = ITEMS[game.equipped.armor]?.defense ?? 0;
  return 10 + armor + Math.floor(attr(game, "agility") / 2) + Math.floor(skillRank(game, "athletics") / 4) + fxSum(game, "defense");
}

export function unlockedAbilities(game) {
  return game.perks.map((id) => PERKS[id]).filter((p) => p?.ability).map((p) => ({ id: p.ability, ...ABILITIES[p.ability] }));
}

// Keeps health and energy within limits after something changes those limits.
function syncVitals(game) {
  game.hp = Math.min(game.hp, maxHp(game));
  game.energy = Math.min(game.energy, maxEnergy(game));
}

// ---- Beliefs ------------------------------------------------------------

export function activeConvictions(ideology = {}) {
  const active = [];
  for (const [id, pole] of Object.entries(POLES)) {
    if ((ideology[pole.axis] ?? 0) * pole.sign >= CONVICTION_THRESHOLD) active.push({ id, pole: pole.name, ...CONVICTIONS[id] });
  }
  return active;
}

export function ideologyTitle(ideology = {}) {
  const poles = Object.entries(AXES)
    .map(([id, axis]) => {
      const value = ideology[id] ?? 0;
      return { strength: Math.abs(value), pole: POLES[value < 0 ? axis.low : axis.high] };
    })
    .filter((p) => p.strength >= 3)
    .sort((a, b) => b.strength - a.strength);
  if (!poles.length) return "Pragmatist";
  if (poles.length === 1) return poles[0].pole.noun;
  return `${poles[1].pole.adj} ${poles[0].pole.noun}`;
}

// How well someone's beliefs match the player's, from -1 to 1.
export function beliefAffinity(ideology, beliefs) {
  let total = 0;
  let weight = 0;
  for (const [axis, value] of Object.entries(beliefs)) {
    total += (ideology[axis] ?? 0) * value;
    weight += Math.abs(value);
  }
  return weight ? clamp(total / (weight * IDEOLOGY_LIMIT * 0.6), -1, 1) : 0;
}

const findContact = (game, name) => game.contacts.find((c) => c.name.toLowerCase() === name.toLowerCase());

// The bonus or penalty on social checks with a faction or a notable person.
export function audienceBonus(game, id) {
  if (FACTION_BELIEFS[id]) {
    return clamp(Math.round(beliefAffinity(game.ideology, FACTION_BELIEFS[id]) * 2 + (game.factions[id] ?? 0) / 40), -4, 4);
  }
  const person = findCharacter(game.campaign, id);
  if (!person) return 0;
  const attitude = ATTITUDE_VALUES[findContact(game, person.name)?.attitude] ?? 0;
  return clamp(Math.round(beliefAffinity(game.ideology, person.beliefs ?? {}) * 2) + attitude, -4, 4);
}

export function shiftIdeology(game, poleId, amount) {
  const pole = POLES[poleId];
  if (!pole) throw new Error(`Unknown belief: ${poleId}`);
  const size = clamp(Math.abs(amount), 1, 3);
  const before = game.ideology[pole.axis] ?? 0;
  const beforeConvictions = activeConvictions(game.ideology).map((c) => c.id);
  const notes = [];

  // Acting against a strong belief hurts. Acting on one steadies you.
  if (before * pole.sign <= -CONVICTION_THRESHOLD) {
    notes.push(`[BELIEF] That went against everything you believe.`);
    notes.push(...changeStress(game, 5 * size));
  } else if (before * pole.sign >= 3) {
    notes.push(...changeStress(game, -3 * size));
  }

  game.ideology[pole.axis] = clamp(before + pole.sign * size, -IDEOLOGY_LIMIT, IDEOLOGY_LIMIT);
  notes.unshift(`[BELIEF] You move toward ${pole.name} (${game.ideology[pole.axis] > 0 ? "+" : ""}${game.ideology[pole.axis]} on ${AXES[pole.axis].name}).`);

  const after = activeConvictions(game.ideology);
  for (const c of after) if (!beforeConvictions.includes(c.id)) notes.push(`[BELIEF] New conviction: ${c.name} (${describeFx(c.fx).join(", ")}).`);
  for (const id of beforeConvictions) if (!after.some((c) => c.id === id)) notes.push(`[BELIEF] You've lost your conviction: ${CONVICTIONS[id].name}.`);
  return notes;
}

// ---- Stress, fatigue, conditions and time -------------------------------

export function changeStress(game, amount) {
  const rate = amount > 0 ? fxProduct(game, "stressRate") : fxProduct(game, "stressRecovery");
  let change = Math.round(amount * rate);
  if (amount !== 0 && change === 0) change = Math.sign(amount);
  game.needs.stress = clamp(game.needs.stress + change, 0, 100);
  if (game.needs.stress < 100) return [];

  // Everyone has a limit. Passing it leaves a mark.
  game.needs.stress = 70;
  addCondition(game, "shaken");
  const notes = ["[BREAK] The stress overwhelms you. For a while, you can't function."];
  if (!game.traits.includes("nightmares")) {
    game.traits.push("nightmares");
    notes.push("[TRAIT] You've gained a new trait: Nightmares.");
  }
  return notes;
}

export function addFatigue(game, amount) {
  const change = amount > 0 ? amount * fxProduct(game, "fatigueRate") : amount;
  game.needs.fatigue = clamp(Math.round(game.needs.fatigue + change), 0, 100);
}

export function addCondition(game, id) {
  const condition = CONDITIONS[id];
  if (!condition) throw new Error(`Unknown condition: ${id}`);
  const existing = game.conditions.find((c) => c.id === id);
  if (existing) existing.hoursLeft = Math.max(existing.hoursLeft, condition.hours);
  else game.conditions.push({ id, hoursLeft: condition.hours });
  syncVitals(game);
}

export function removeCondition(game, id) {
  const before = game.conditions.length;
  game.conditions = game.conditions.filter((c) => c.id !== id);
  return before !== game.conditions.length;
}

export function clockLabel(game) {
  // The clock runs in moments, and a tiny rounding error mustn't show 08:00 as 07:59.
  const minutes = Math.floor(game.clock.hours * 60 + 1e-6);
  const two = (n) => String(n).padStart(2, "0");
  return `Day ${Math.floor(minutes / 1440) + 1}, ${two(Math.floor(minutes / 60) % 24)}:${two(minutes % 60)}`;
}

// Moves the clock forward by whatever the story says, and everyone's day moves on with it.
export function passTime(game, hours, activity = "active") {
  lifeOf(game);
  game.clock.hours += hours;
  // Whoever the story has put beside the captain is still there once the time has passed.
  if (game.walk) game.walk.withUntil = null;
  advanceLife(game);
  return hoursPass(game, hours, activity);
}

// The clock running by itself while the player explores. It moves in moments, and every two hours
// that go by count as two hours, which keeps fatigue and energy in whole numbers.
export function clockRuns(game, minutes) {
  lifeOf(game);
  const before = Math.floor(game.clock.hours + 1e-6);
  game.clock.hours = Math.round((game.clock.hours + minutes / 60) * 3600) / 3600;
  advanceLife(game);
  const notes = [];
  for (let hour = before + 1; hour <= Math.floor(game.clock.hours + 1e-6); hour += 1) {
    if (hour % 2 === 0) notes.push(...hoursPass(game, 2, "active"));
  }
  return notes;
}

// What time does to the captain. Conditions fade, fatigue builds, and rest heals. Each day that goes
// by also runs a day of the fleet. A "routine" day has a night's sleep in it, so it doesn't tire you.
function hoursPass(game, hours, activity) {
  const notes = [];
  if (activity === "rest") {
    addFatigue(game, -9 * hours);
    notes.push(...changeStress(game, -1.5 * hours));
    game.hp = Math.min(maxHp(game), game.hp + hours * (1 + Math.floor(attr(game, "endurance") / 4)));
    game.energy = Math.min(maxEnergy(game), game.energy + hours);
  } else if (activity === "routine") {
    game.energy = Math.min(maxEnergy(game), game.energy + Math.floor(hours / 2));
  } else {
    addFatigue(game, (activity === "work" ? 3 : 1.5) * hours);
    game.energy = Math.min(maxEnergy(game), game.energy + Math.floor(hours / 2));
  }
  // With no medicine in the fleet, wounds take twice as long to heal.
  const speed = (activity === "rest" ? 1.5 : 1) * (game.fleet?.out?.medicine && inTheFleet(game) ? 0.5 : 1);
  for (const c of [...game.conditions]) {
    c.hoursLeft -= hours * speed;
    // Nobody recovers from being underfed while the fleet's still going hungry.
    if (c.hoursLeft <= 0 && c.id === "underfed" && fleetGoingHungry(game)) c.hoursLeft = 1;
    if (c.hoursLeft <= 0) {
      removeCondition(game, c.id);
      notes.push(`[HEALTH] You've recovered: ${CONDITIONS[c.id].name}.`);
    }
  }
  // The fleet, the world and the stories go through each day together, so it makes no difference how a long wait is cut up.
  const today = Math.floor(game.clock.hours / 24);
  const told = { today: 0, all: 0 };
  for (let day = Math.min(fleetOf(game).day, worldOf(game).day, clockOf(game).day) + 1; day <= today; day += 1) {
    notes.push(...advanceFleet(game, day), ...advanceWorld(game, day), ...advanceStories(game, day, told));
  }
  syncVitals(game);
  return notes;
}

function needsPenalties(game) {
  const { stress, fatigue } = game.needs;
  return { stress: stress >= 80 ? -2 : stress >= 50 ? -1 : 0, fatigue: fatigue >= 85 ? -2 : fatigue >= 60 ? -1 : 0 };
}

// ---- Items --------------------------------------------------------------

export function addItem(game, id, count = 1) {
  if (!ITEMS[id]) throw new Error(`Unknown item: ${id}`);
  game.inventory[id] = (game.inventory[id] ?? 0) + count;
}

export function removeItem(game, id, count = 1) {
  if ((game.inventory[id] ?? 0) < count) throw new Error(`You don't have ${ITEMS[id]?.name ?? id}.`);
  game.inventory[id] -= count;
  if (game.inventory[id] === 0) {
    delete game.inventory[id];
    if (game.equipped.weapon === id) game.equipped.weapon = null;
    if (game.equipped.armor === id) game.equipped.armor = null;
  }
}

export function equip(game, id) {
  const item = ITEMS[id];
  if (!item || !game.inventory[id]) throw new Error("You don't have that item.");
  if (item.type !== "weapon" && item.type !== "armor") throw new Error("That can't be equipped.");
  if (game.combat) throw new Error("You can't change gear in the middle of a fight.");
  game.equipped[item.type] = game.equipped[item.type] === id ? null : id;
}

export function useItem(game, id) {
  const item = ITEMS[id];
  if (!item || !game.inventory[id]) throw new Error("You don't have that item.");
  if (item.type !== "consumable") throw new Error("That can't be used from here.");
  const parts = [];
  for (const [key, amount] of Object.entries(item.effect)) {
    if (key === "hp") {
      const before = game.hp;
      const heal = Math.round((amount + skillRank(game, "medicine")) * fxProduct(game, "healRate"));
      game.hp = Math.min(maxHp(game), game.hp + heal);
      parts.push(`+${game.hp - before} health`);
    } else if (key === "energy") {
      const before = game.energy;
      game.energy = Math.min(maxEnergy(game), game.energy + amount);
      parts.push(`+${game.energy - before} energy`);
    } else if (key === "hull") {
      const before = game.ship.hull;
      game.ship.hull = Math.min(game.ship.maxHull, game.ship.hull + amount + skillRank(game, "engineering") * 2);
      parts.push(`+${game.ship.hull - before} hull`);
    } else if (key === "fuel") {
      const before = game.ship.fuel;
      game.ship.fuel = Math.min(game.ship.maxFuel, game.ship.fuel + amount);
      parts.push(`+${game.ship.fuel - before} fuel`);
    }
  }
  removeItem(game, id);
  return `Used ${item.name}: ${parts.join(", ")}.`;
}

// Weapons are compared by how well you can actually use them.
function weaponScore(game, item) {
  const rank = skillRank(game, item.skill);
  return attrMod(game, item.stat) + (rank > 0 ? rank : -2) + (item.damage[0] + item.damage[1]) / 2;
}

function equipBest(game) {
  const owned = Object.keys(game.inventory).map((id) => [id, ITEMS[id]]);
  const best = (list, score) => list.reduce((top, entry) => (!top || score(entry[1]) > score(top[1]) ? entry : top), null)?.[0] ?? null;
  game.equipped.weapon = best(owned.filter(([, i]) => i.type === "weapon"), (i) => weaponScore(game, i));
  game.equipped.armor = best(owned.filter(([, i]) => i.type === "armor"), (i) => i.defense);
}

// ---- Market -------------------------------------------------------------

// A good negotiator gets better prices, but buying always costs more than selling pays.
function priceEdge(game) {
  const commerce = skillRank(game, "commerce") + fxOf(game, "skills", "commerce");
  return clamp(commerce * 0.02 + Math.max(0, attrMod(game, "presence")) * 0.01 + fxSum(game, "priceBonus"), 0, 0.2);
}

// What's short here costs more, and that goes for what you sell as well as for what you buy.
export const buyPrice = (game, item) => Math.ceil(item.price * itemFactor(game, item) * (1 - priceEdge(game)));
export const sellPrice = (game, item) => Math.floor(item.price * itemFactor(game, item) * (0.5 + priceEdge(game)));

export function buy(game, id) {
  if (game.combat) throw new Error("You can't shop in the middle of a fight.");
  const stock = LOCATIONS[game.location]?.market ?? [];
  if (!stock.includes(id)) throw new Error("That isn't sold here.");
  const item = ITEMS[id];
  const price = buyPrice(game, item);
  if (game.credits < price) throw new Error("You can't afford that.");
  game.credits -= price;
  addItem(game, id);
  return `Bought ${item.name} for ${price} credits.`;
}

export function sell(game, id) {
  if (game.combat) throw new Error("You can't shop in the middle of a fight.");
  if (!(LOCATIONS[game.location]?.market ?? []).length) throw new Error("There's no market here.");
  const item = ITEMS[id];
  if (!item || !game.inventory[id]) throw new Error("You don't have that item.");
  if (item.type === "story" && item.price === 0) throw new Error("You should hold on to that.");
  const price = sellPrice(game, item);
  removeItem(game, id);
  game.credits += price;
  return `Sold ${item.name} for ${price} credits.`;
}

// ---- Progression --------------------------------------------------------

const skillPointsPerLevel = (game) => 2 + Math.floor(Math.max(0, attr(game, "intellect") - 3) / 2);

export function grantXp(game, amount) {
  game.xp += amount;
  const notes = [];
  while (game.xp >= xpToNext(game.level)) {
    game.xp -= xpToNext(game.level);
    game.level += 1;
    game.perkPoints += 1;
    game.skillPoints += skillPointsPerLevel(game);
    if (game.level % 2 === 0) game.statPoints += 1;
    game.hp = maxHp(game);
    game.energy = maxEnergy(game);
    notes.push(`Level up! You are now level ${game.level}. Spend your new points in the Character, Skills and Perks menus.`);
  }
  return notes;
}

export const skillXpToNext = (rank) => 10 + rank * 10;
export const skillRaiseCost = (rank) => (rank < 3 ? 1 : rank < 6 ? 2 : 3);

// Skills improve by being used. Tagged skills and younger characters learn faster.
export function practice(game, skill, amount) {
  if (!SKILLS[skill] || skillRank(game, skill) >= SKILL_MAX) return [];
  const rate = (game.character?.learning ?? 1) * fxProduct(game, "learnRate") * (game.tags.includes(skill) ? TAG_LEARN_RATE : 1);
  game.skillXp[skill] = (game.skillXp[skill] ?? 0) + amount * rate;
  const notes = [];
  while (skillRank(game, skill) < SKILL_MAX && game.skillXp[skill] >= skillXpToNext(skillRank(game, skill))) {
    game.skillXp[skill] -= skillXpToNext(skillRank(game, skill));
    game.skills[skill] = skillRank(game, skill) + 1;
    notes.push(`[SKILL] Practice pays off: ${SKILLS[skill].name} is now rank ${game.skills[skill]}.`);
  }
  return notes;
}

export function raiseSkill(game, id) {
  if (!SKILLS[id]) throw new Error("Unknown skill.");
  const rank = skillRank(game, id);
  if (rank >= SKILL_MAX) throw new Error(`${SKILLS[id].name} is already at its maximum.`);
  const cost = skillRaiseCost(rank);
  if (game.skillPoints < cost) throw new Error(`You need ${cost} skill point${cost === 1 ? "" : "s"} for that.`);
  game.skillPoints -= cost;
  game.skills[id] = rank + 1;
  return `${SKILLS[id].name} raised to rank ${rank + 1}.`;
}

export function perkAvailability(game, id) {
  const perk = PERKS[id];
  if (!perk) return { ok: false, why: "Unknown perk." };
  if (game.perks.includes(id)) return { ok: false, why: "Already learned." };
  if (perk.starting) return { ok: false, why: "Comes from a career." };
  if (perk.requires && !game.perks.includes(perk.requires)) return { ok: false, why: `Requires ${PERKS[perk.requires].name}.` };
  for (const [stat, min] of Object.entries(perk.requiresStat ?? {})) {
    if (attr(game, stat) < min) return { ok: false, why: `Requires ${STATS[stat]} ${min}.` };
  }
  for (const [skill, min] of Object.entries(perk.requiresSkill ?? {})) {
    if (skillRank(game, skill) < min) return { ok: false, why: `Requires ${SKILLS[skill].name} rank ${min}.` };
  }
  if (game.perkPoints < 1) return { ok: false, why: "No perk points left." };
  return { ok: true };
}

export function buyPerk(game, id) {
  const { ok, why } = perkAvailability(game, id);
  if (!ok) throw new Error(why);
  game.perkPoints -= 1;
  game.perks.push(id);
  game.hp = Math.min(game.hp + (PERKS[id].fx?.maxHp ?? 0), maxHp(game));
  game.energy = Math.min(game.energy + (PERKS[id].fx?.maxEnergy ?? 0), maxEnergy(game));
  return `Learned ${PERKS[id].name}.`;
}

export function raiseStat(game, stat) {
  if (!(stat in STATS)) throw new Error("Unknown stat.");
  if (game.statPoints < 1) throw new Error("No stat points left.");
  const cap = SPECIES[game.character?.species]?.attrCaps?.[stat] ?? ATTR_MAX;
  if (game.stats[stat] >= cap) throw new Error(`${STATS[stat]} is already at its maximum.`);
  game.statPoints -= 1;
  game.stats[stat] += 1;
  game.hp = Math.min(game.hp + (stat === "endurance" ? 4 : stat === "might" ? 1 : 0), maxHp(game));
  game.energy = Math.min(game.energy + (stat === "willpower" || stat === "resonance" ? 1 : 0), maxEnergy(game));
  return `${STATS[stat]} raised to ${game.stats[stat]}.`;
}

// What a night's sleep costs here. A captain sleeps aboard the Meridian. Anyone else sleeps for nothing
// where they live and anywhere in the fleet, and pays for a bunk anywhere else. Null means there's nowhere.
const BUNK_PRICE = 6;
const SLEEPING_ROUGH_STRESS = 8;

export function restCost(game) {
  const place = LOCATIONS[game.location];
  if (isCaptain(game)) return place?.rest ? 0 : null;
  return place?.rest || place?.fleet || startOf(game)?.place === game.location ? 0 : BUNK_PRICE;
}

export function rest(game, { rough = false } = {}) {
  if (game.combat) throw new Error("You can't rest in the middle of a fight.");
  const cost = restCost(game);
  if (cost === null) throw new Error("You can only rest aboard the Meridian.");
  const where = LOCATIONS[game.location].name;
  if (rough) {
    if (!cost) throw new Error("There's no need to sleep rough here.");
    const notes = passTime(game, 8, "rest");
    notes.push(...changeStress(game, SLEEPING_ROUGH_STRESS));
    return [`You sleep for eight hours in a corner of ${where}, with one eye open. It's now ${clockLabel(game)}.`, ...notes].join("\n");
  }
  if (cost > game.credits) throw new Error(`A bunk here costs ${cost} credits, and you have ${game.credits}.`);
  game.credits -= cost;
  const notes = passTime(game, 8, "rest");
  game.hp = maxHp(game);
  game.energy = maxEnergy(game);
  const slept = isCaptain(game) ? "aboard the Meridian" : cost ? `in a rented bunk at ${where}, for ${cost} credits` : `at ${where}`;
  return [`You sleep for eight hours ${slept}. Health and energy are restored. It's now ${clockLabel(game)}.`, ...notes].join("\n");
}

// A shift at the player's own job. It's not much, but it always pays.
const TOO_TIRED_TO_WORK = 85;

export function workShift(game) {
  if (game.combat) throw new Error("You can't work in the middle of a fight.");
  const job = jobHere(game);
  if (!job) throw new Error("You've got no work here.");
  if (game.needs.fatigue >= TOO_TIRED_TO_WORK) throw new Error("You're too tired to work another shift. Get some sleep first.");
  const notes = passTime(game, 8, "work");
  const pay = job.pay + skillRank(game, job.skill);
  game.credits += pay;
  notes.push(...practice(game, job.skill, 2));
  return [`${job.done} You earn ${pay} credits. It's now ${clockLabel(game)}.`, ...notes].join("\n");
}

// How hard enemies fight. It applies from the next fight on.
export function setDifficulty(game, id) {
  if (!FIGHT_DIFFICULTIES[id]) throw new Error("Unknown difficulty.");
  game.difficulty = id;
  return null;
}

// ---- Skill checks -------------------------------------------------------

export const DIFFICULTY = { easy: 8, moderate: 12, hard: 16, very_hard: 20, nearly_impossible: 24 };
const DIFFICULTY_LEARNING = { easy: 0.5, moderate: 1, hard: 1.5, very_hard: 2, nearly_impossible: 2 };
const SKILLS_WITH_AUDIENCE = ["persuasion", "deception", "leadership", "commerce"];
const UNTRAINED_PENALTY = -2;
// However many traits, perks and gadgets apply, they can only add this much to a skill.
const MAX_SKILL_BONUS = 4;

// Everything that adds up to a check's bonus, with a label for each part.
export function checkParts(game, { skill = null, attribute = null, context = [], audience = null } = {}) {
  const info = SKILLS[skill];
  const stat = attribute ?? info?.attr;
  const parts = [{ label: STATS[stat], value: attrMod(game, stat) }];
  if (info) {
    const rank = skillRank(game, skill);
    parts.push(rank > 0 ? { label: info.name, value: rank } : { label: `untrained ${info.name}`, value: UNTRAINED_PENALTY });
    const bonus = Math.min(MAX_SKILL_BONUS, fxOf(game, "skills", skill));
    if (bonus) parts.push({ label: "bonuses", value: bonus });
  }
  const situation = context.reduce((sum, id) => sum + fxOf(game, "context", id), 0);
  if (situation) parts.push({ label: "situation", value: situation });
  if (audience && SKILLS_WITH_AUDIENCE.includes(skill)) {
    const standing = audienceBonus(game, audience);
    if (standing) parts.push({ label: "relationship", value: standing });
  }
  const { stress, fatigue } = needsPenalties(game);
  if (stress) parts.push({ label: "stress", value: stress });
  if (fatigue) parts.push({ label: "fatigue", value: fatigue });
  const checks = fxSum(game, "checks");
  if (checks) parts.push({ label: "condition", value: checks });
  return { parts, total: parts.reduce((sum, p) => sum + p.value, 0) };
}

// The chance of success, counting the fact that a 1 always fails and a 20 always succeeds.
export function oddsFor(bonus, dc) {
  let wins = 1;
  for (let die = 2; die <= 19; die += 1) if (die + bonus >= dc) wins += 1;
  return wins * 5;
}

// edge is what the player earned in the check's window. Practice doesn't count for anything.
export function skillCheck(game, { skill = null, attribute = null, difficulty, context = [], audience = null, edge = 0, practiceOnly = false }) {
  const dc = DIFFICULTY[difficulty];
  const { parts, total: base } = checkParts(game, { skill, attribute, context, audience });
  if (edge) parts.push({ label: "your work", value: edge });
  const bonus = base + edge;
  const die = roll(1, 20);
  const total = die + bonus;
  const success = die === 20 ? true : die === 1 ? false : total >= dc;
  const notes = [];
  if (!practiceOnly) {
    if (skill) notes.push(...practice(game, skill, (success ? 3 : 2) * DIFFICULTY_LEARNING[difficulty]));
    if (die === 1) notes.push(...changeStress(game, 3));
  }
  return { die, parts, bonus, total, dc, success, margin: total - dc, critical: die === 20 || die === 1, notes };
}

// ---- Travel -------------------------------------------------------------

export const jumpHours = (game) => Math.max(4, 18 - skillRank(game, "navigation") * 2);

export function travel(game, destination) {
  const place = LOCATIONS[destination];
  if (!place) throw new Error(`Unknown location: ${destination}`);
  if (destination === game.location) return { message: `Already at ${place.name}.`, notes: [] };
  if (game.fleet?.raid) throw new Error("The fleet is under attack, and nobody's going anywhere until the captain gives the order.");
  const cost = jumpCost(game, destination);
  // Someone with no fleet of their own goes by themselves, on whatever's going that way.
  if (!isCaptain(game)) {
    game.location = destination;
    game.walk = null;
    const notes = passTime(game, cost.hours);
    return { message: cost.jump ? `Took passage to ${place.name}, which took ${cost.hours} hours. It's now ${clockLabel(game)}.` : `Crossed over to ${place.name}.`, notes };
  }
  // Whatever's already with the fleet is a short shuttle ride away, so no jump is needed.
  if (!cost.jump) {
    game.location = destination;
    game.walk = null;
    return { message: destination === "meridian" ? `Returned aboard the ${place.name}.` : `Crossed over to ${place.name}.`, notes: passTime(game, cost.hours) };
  }
  if (game.ship.fuel < 1) throw new Error("The ship is out of fuel and can't jump.");
  if (game.ship.fuel < cost.fuel) throw new Error(`A jump to ${place.name} takes ${cost.fuel} fuel, and the fleet has ${game.ship.fuel}.`);
  // A good navigator gets there sooner, and sometimes saves some of the fuel.
  const navigation = skillRank(game, "navigation");
  const saved = Math.random() < navigation * 0.04;
  game.ship.fuel -= saved ? cost.fuel - 1 : cost.fuel;
  game.location = destination;
  game.walk = null;
  fleetJumped(game, destination, cost.fuel);
  const notes = passTime(game, cost.hours);
  notes.push(...practice(game, "navigation", 2));
  return {
    message: `Jumped to ${place.name} in ${cost.hours} hours.${saved ? " A clean jump saved the fuel." : ""} Fuel left: ${game.ship.fuel}. It's now ${clockLabel(game)}.`,
    notes,
  };
}

// ---- A new game ---------------------------------------------------------

// Builds a playable game from a finished character. creator.js works out the profile.
export function assembleGame(profile) {
  const start = START_LIST[profile.start] ?? START_LIST.captain;
  const game = {
    version: 15,
    campaign: null,
    // Who writes the story: "written" plays the scenes in world/scenes, and "ai" is the AI game master. The server sets it from the Settings menu.
    mode: "ai",
    scene: null,
    flags: {},
    lastCheck: null,
    lastFight: null,
    name: profile.name,
    character: profile.character,
    level: 1,
    xp: 0,
    statPoints: 0,
    perkPoints: 1,
    skillPoints: 0,
    stats: profile.stats,
    skills: profile.skills,
    skillXp: {},
    tags: profile.tags,
    traits: profile.traits,
    ideology: profile.ideology,
    needs: { stress: 15, fatigue: 10 },
    conditions: [],
    clock: { hours: 8 },
    hp: 0,
    energy: 0,
    credits: profile.credits,
    perks: profile.perks,
    inventory: {},
    equipped: { weapon: null, armor: null },
    ship: { name: "CFS Meridian", hull: 70, maxHull: 100, fuel: 6, maxFuel: 12, morale: 55 },
    location: start.place ?? "meridian",
    role: { id: profile.start ?? "captain", captain: Boolean(start.captain) },
    factions: { ...profile.factions },
    quests: start.quest ? [{ ...start.quest, main: false, status: "active" }] : structuredClone(STARTING_QUESTS),
    contacts: [],
    journal: [],
    lore: [],
    seenLore: startingLoreIds(),
    bestiary: {},
    pendingEvents: [],
    combat: null,
    check: null,
    talk: null,
    walk: null,
    opened: {},
    life: null,
    difficulty: "normal",
    story: emptyStory(),
    transcript: [],
    turn: 0,
    ai: { provider: null, messages: [] },
  };
  for (const id of profile.items) addItem(game, id);
  equipBest(game);
  game.contacts = [...(start.captain ? crewContacts(game.ideology) : startContacts(start, game.ideology)), ...profile.contacts];
  for (const [id, change] of Object.entries(start.factions ?? {})) game.factions[id] = clamp((game.factions[id] ?? 0) + change, -100, 100);
  if (start.place && !game.seenLore.includes(`place:${start.place}`)) game.seenLore.push(`place:${start.place}`);
  game.hp = maxHp(game);
  game.energy = maxEnergy(game);
  game.fleet = newFleet(game);
  game.world = newWorld(game);
  if (start.room) startInRoom(game, start.room);
  return game;
}

// The people the captain already works with. How they feel depends on what the captain believes.
export function crewContacts(ideology) {
  return Object.values(NOTABLES).filter((n) => n.crew).map((n) => {
    const affinity = beliefAffinity(ideology, n.beliefs);
    return {
      name: n.name,
      attitude: affinity >= 0.4 ? "friendly" : affinity <= -0.4 ? "wary" : "neutral",
      note: `${n.title} ${n.name}. ${n.note}`,
    };
  });
}

// The people someone already knows, where they start out.
function startContacts(start, ideology) {
  return (start.people ?? []).map((id) => NOTABLES[id]).filter(Boolean).map((n) => {
    const affinity = beliefAffinity(ideology, n.beliefs);
    const note = n.note.replace(/\bYour\b/g, "The Meridian's");
    return { name: n.name, attitude: affinity >= 0.4 ? "friendly" : affinity <= -0.4 ? "wary" : "neutral", note: `${n.title ? `${n.title} ` : ""}${n.name}. ${note}` };
  });
}

// ---- What the browser and the AI get to see -----------------------------

export const clockFor = (game) => ({ hours: game.clock.hours, label: clockLabel(game) });

function skillList(game) {
  return Object.entries(SKILLS).map(([id, s]) => {
    const rank = skillRank(game, id);
    const bonus = checkParts(game, { skill: id }).total;
    return {
      id,
      name: s.name,
      group: s.group,
      attr: s.attr,
      desc: s.desc,
      rank,
      xp: Math.floor(game.skillXp[id] ?? 0),
      xpNext: skillXpToNext(rank),
      tagged: game.tags.includes(id),
      bonus,
      odds: oddsFor(bonus, DIFFICULTY.moderate),
      raiseCost: rank < SKILL_MAX ? skillRaiseCost(rank) : null,
    };
  });
}

function contactList(game) {
  return game.contacts.map((c) => {
    const person = findCharacter(game.campaign, c.name);
    return person ? { ...c, relationship: audienceBonus(game, person.id) } : c;
  });
}

// Everyone the player has met or heard of, from the character files. Secrets stay out of this.
function peopleList(game) {
  const people = [];
  const fromCampaign = campaignCharacters(game.campaign);
  for (const [id, person] of Object.entries(allCharacters(game.campaign))) {
    const contact = findContact(game, person.name);
    if (!contact && !game.seenLore.includes(`person:${id}`)) continue;
    const history = contact?.note && contact.note !== person.note && !contact.note.includes(person.note) ? contact.note : null;
    people.push({
      id,
      loreId: `person:${id}`,
      campaign: Boolean(fromCampaign[id]),
      name: fullName(person),
      shortName: person.name,
      aliases: person.aliases ?? [],
      role: toOutsider(game, person.role),
      note: toOutsider(game, person.note),
      history,
      met: Boolean(contact),
      attitude: contact?.attitude ?? null,
      status: contact?.status ?? "alive",
      crew: Boolean(person.crew),
      pronouns: person.pronouns,
      species: SPECIES[person.species]?.name ?? null,
      age: person.age ?? null,
      faction: FACTIONS[person.faction]?.name ?? null,
      location: LOCATIONS[person.location]?.name ?? null,
      appearance: contact ? person.appearance || null : null,
      color: person.color ?? null,
      threat: THREAT_LABELS[person.combat?.threat] ?? null,
      sharedBeliefs: Math.round(beliefAffinity(game.ideology, person.beliefs ?? {}) * 100),
      relationship: audienceBonus(game, id),
    });
  }
  const rank = (p) => (p.crew ? 0 : p.met ? 1 : 2);
  return people.sort((a, b) => rank(a) - rank(b) || a.shortName.localeCompare(b.shortName));
}

// Enemies the player has faced, plus the weakest ones, which the ship's simulator always offers.
function enemyList(game) {
  const canSim = LOCATIONS[game.location]?.rest && !game.combat && !game.check && !game.talk;
  const known = Object.entries(allEnemies(game.campaign)).map(([id, enemy]) => ({ id, ...enemy }));
  for (const id of Object.keys(game.bestiary)) {
    if (!known.some((enemy) => enemy.id === id)) {
      const person = findEnemy(game.campaign, id);
      if (person) known.push(person);
    }
  }
  return known
    .filter((enemy) => game.bestiary[enemy.id] || (enemy.threat ?? 1) <= 2)
    .map((enemy) => ({
      id: enemy.id,
      name: enemy.name,
      desc: enemy.desc,
      threat: THREAT_LABELS[enemy.threat] ?? null,
      threatLevel: enemy.threat ?? 1,
      ...enemyNumbers(enemy, game.difficulty ?? "normal"),
      weapon: enemy.weapon ?? null,
      tags: enemy.tags ?? [],
      record: game.bestiary[enemy.id] ?? null,
      canSim: Boolean(canSim),
      talk: parleyNotes(enemy),
    }))
    .sort((a, b) => a.threatLevel - b.threatLevel || a.name.localeCompare(b.name));
}

// Everything currently changing the player's numbers, and where it comes from.
function activeEffects(game) {
  const effects = [];
  const add = (source, name, fx) => {
    const lasting = describeFx({ ...fx, factions: undefined, credits: undefined });
    if (lasting.length) effects.push({ source, name, effects: lasting });
  };
  const species = SPECIES[game.character?.species];
  if (species) add("Species", species.name, species.fx);
  const drive = DRIVES[game.character?.drive];
  if (drive) add("Drive", drive.name, drive.fx);
  for (const id of game.traits) if (TRAITS[id]) add("Trait", TRAITS[id].name, TRAITS[id].fx);
  for (const id of game.perks) if (PERKS[id]) add("Perk", PERKS[id].name, PERKS[id].fx);
  for (const c of activeConvictions(game.ideology)) add("Conviction", c.name, c.fx);
  for (const c of game.conditions) if (CONDITIONS[c.id]) add("Condition", CONDITIONS[c.id].name, CONDITIONS[c.id].fx);
  for (const id of Object.keys(game.inventory)) if (ITEMS[id]?.fx) add("Gear", ITEMS[id].name, ITEMS[id].fx);
  return effects;
}

function locationList(game) {
  return Object.entries(LOCATIONS)
    .filter(([id, place]) => id === game.location || (!place.hidden && (isCharted(id) || place.fleet || game.seenLore.includes(`place:${id}`))))
    .map(([id, place]) => ({
      id,
      name: place.name,
      desc: place.desc,
      here: id === game.location,
      hasMarket: place.market.length > 0,
      withFleet: Boolean(place.fleet),
      dangerous: Boolean(place.dangerous),
      ...chartEntry(game, id),
    }));
}

// A readable copy of the captain's stats, written next to the campaign's other files.
export function captainSheet(game) {
  return {
    _note: "The game writes this file. Changing it has no effect, because your real stats are in your saved game.",
    name: game.name,
    pronouns: game.character.pronouns,
    species: SPECIES[game.character.species]?.name ?? game.character.species,
    age: game.character.age,
    background: game.character.background,
    level: game.level,
    xp: game.xp,
    health: { current: game.hp, max: maxHp(game) },
    energy: { current: game.energy, max: maxEnergy(game) },
    stress: game.needs.stress,
    fatigue: game.needs.fatigue,
    credits: game.credits,
    attributes: Object.fromEntries(Object.keys(STATS).map((id) => [id, attr(game, id)])),
    skills: Object.fromEntries(Object.entries(game.skills).filter(([, rank]) => rank > 0)),
    combat: combatProfile(game),
    traits: game.traits.map((id) => TRAITS[id]?.name ?? id),
    perks: game.perks.map((id) => PERKS[id]?.name ?? id),
    beliefs: game.ideology,
    conditions: game.conditions.map((c) => CONDITIONS[c.id]?.name ?? c.id),
    inventory: game.inventory,
    equipped: game.equipped,
  };
}

export function publicState(game) {
  const stock = LOCATIONS[game.location]?.market ?? [];
  const character = game.character;
  const enemies = enemyList(game);
  // The game master's notes on a place stay here. Only this much reaches the browser.
  const { gm: _gm, encounters: _encounters, rumors: _rumors, ...place } = LOCATIONS[game.location];
  return {
    name: game.name,
    background: character.background,
    pronouns: character.pronouns,
    species: SPECIES[character.species]?.name ?? character.species,
    age: character.age,
    dossier: {
      callsign: character.callsign,
      appearance: character.appearance,
      homeworld: HOMEWORLDS[character.homeworld]?.name,
      upbringing: UPBRINGINGS[character.upbringing]?.name,
      drive: DRIVES[character.drive]?.name,
      driveDesc: DRIVES[character.drive]?.desc,
      driveFx: describeFx(DRIVES[character.drive]?.fx),
      speciesFx: describeFx(SPECIES[character.species]?.fx),
      bond: character.bondPerson ? `${character.bondPerson}. ${BONDS[character.bond]?.note}` : null,
      biography: character.biography ?? [],
      hooks: character.hooks ?? [],
      careers: character.careers ?? [],
      learning: character.learning ?? 1,
      legacy: Boolean(character.legacy),
    },
    statInfo: STAT_INFO,
    penalties: { ...needsPenalties(game), checks: fxSum(game, "checks") },
    combatProfile: combatProfile(game),
    effects: activeEffects(game),
    people: peopleList(game),
    enemies,
    enemiesTotal: Object.keys(allEnemies(game.campaign)).length,
    enemiesUnseen: Object.keys(allEnemies(game.campaign)).filter((id) => !enemies.some((enemy) => enemy.id === id)).length,
    locations: locationList(game),
    pendingEvents: game.pendingEvents.length,
    mode: game.mode ?? "ai",
    scene: game.scene ? { id: game.scene.id, part: game.scene.part } : null,
    files: {
      world: "world",
      campaign: game.campaign ? campaignFolderName(game.campaign) : null,
      worldCharacters: Object.keys(NOTABLES).length,
      campaignCharacters: Object.keys(campaignCharacters(game.campaign)).length,
      campaignEnemies: Object.keys(campaignEnemies(game.campaign)).length,
    },
    level: game.level,
    xp: game.xp,
    xpToNext: xpToNext(game.level),
    statPoints: game.statPoints,
    perkPoints: game.perkPoints,
    skillPoints: game.skillPoints,
    stats: Object.fromEntries(Object.keys(STATS).map((id) => [id, attr(game, id)])),
    baseStats: game.stats,
    skills: skillList(game),
    skillGroups: SKILL_GROUPS,
    traits: game.traits.map((id) => ({ id, name: TRAITS[id]?.name ?? id, desc: TRAITS[id]?.desc, effects: describeFx(TRAITS[id]?.fx) })),
    ideology: Object.entries(AXES).map(([id, axis]) => ({ id, name: axis.name, low: POLES[axis.low].name, high: POLES[axis.high].name, value: game.ideology[id] ?? 0 })),
    ideologyTitle: ideologyTitle(game.ideology),
    convictions: activeConvictions(game.ideology).map((c) => ({ id: c.id, name: c.name, pole: c.pole, effects: describeFx(c.fx) })),
    needs: game.needs,
    conditions: game.conditions.map((c) => ({ ...c, name: CONDITIONS[c.id]?.name, desc: CONDITIONS[c.id]?.desc, effects: describeFx(CONDITIONS[c.id]?.fx) })),
    clock: clockFor(game),
    hp: game.hp,
    maxHp: maxHp(game),
    energy: game.energy,
    maxEnergy: maxEnergy(game),
    defense: defense(game),
    credits: game.credits,
    ship: game.ship,
    fleet: fleetView(game),
    role: roleView(game),
    world: { here: placeNow(game, game.location), news: newsView(game) },
    location: { id: game.location, ...place },
    story: storyView(game),
    equipped: game.equipped,
    inventory: Object.entries(game.inventory).filter(([id]) => ITEMS[id]).map(([id, count]) => ({
      id,
      count,
      ...ITEMS[id],
      sellPrice: sellPrice(game, ITEMS[id]),
      equipped: game.equipped.weapon === id || game.equipped.armor === id,
      ...(ITEMS[id].type === "weapon" ? { attackBonus: attackBonus(game, null, ITEMS[id].stat, ITEMS[id].skill) } : {}),
    })),
    market: stock.map((id) => ({ id, ...ITEMS[id], buyPrice: buyPrice(game, ITEMS[id]) })),
    perks: Object.entries(PERKS)
      .filter(([id, p]) => !p.starting || game.perks.includes(id))
      .map(([id, p]) => ({ id, name: p.name, desc: p.desc, owned: game.perks.includes(id), career: Boolean(p.starting), ...perkAvailability(game, id) })),
    abilities: unlockedAbilities(game),
    quests: game.quests,
    contacts: contactList(game),
    journal: game.journal,
    lore: game.lore,
    seenLore: game.seenLore,
    factions: Object.entries(game.factions).filter(([id]) => FACTIONS[id]).map(([id, value]) => ({
      id, value, relationship: audienceBonus(game, id), sharedBeliefs: Math.round(beliefAffinity(game.ideology, FACTION_BELIEFS[id]) * 100), ...FACTIONS[id],
      known: CORE_FACTIONS.includes(id) || game.seenLore.includes(`faction:${id}`),
      holds: holdingsOf(game, id),
    })),
    combat: combatView(game),
    check: checkView(game),
    walk: walkView(game),
    talk: talkView(game),
    difficulty: game.difficulty ?? "normal",
    transcript: game.transcript,
  };
}

// Who the player is right now, what they can do about it, and who's in charge if it isn't them.
function roleView(game) {
  const start = startOf(game);
  const captain = isCaptain(game);
  const job = jobHere(game);
  const usedToBe = !captain && start?.captain;
  return {
    id: game.role?.id ?? "captain",
    captain,
    title: captain ? START_LIST.captain.name : usedToBe ? "Former captain of the Meridian" : start?.name ?? "Nobody in particular",
    short: captain ? START_LIST.captain.short : usedToBe ? "former captain" : start?.short ?? "drifter",
    job: job ? { name: job.name, pay: job.pay + skillRank(game, job.skill) } : null,
    jobAway: !captain && !job && start?.job ? { name: start.job.name, place: LOCATIONS[start.place]?.name ?? start.place } : null,
    chair: chairOf(game)?.name ?? null,
    inFleet: inTheFleet(game),
    rest: restCost(game),
  };
}

// A compact snapshot sent to the AI with each message, so it always knows the true state.
export function aiSnapshot(game) {
  const weapon = ITEMS[game.equipped.weapon]?.name ?? "none";
  const armor = ITEMS[game.equipped.armor]?.name ?? "none";
  const items = Object.entries(game.inventory).map(([id, n]) => `${id} x${n}`).join(", ") || "nothing";
  const perks = game.perks.map((id) => PERKS[id]?.name ?? id).join(", ");
  const traits = game.traits.map((id) => TRAITS[id]?.name ?? id).join(", ") || "none";
  const skills = Object.entries(game.skills).filter(([, rank]) => rank >= 3).sort((a, b) => b[1] - a[1]).map(([id, rank]) => `${SKILLS[id].name} ${rank}`).join(", ") || "none above rank 2";
  const beliefs = Object.entries(AXES).map(([id, axis]) => {
    const value = game.ideology[id] ?? 0;
    return value === 0 ? `${axis.name} neutral` : `${POLES[value < 0 ? axis.low : axis.high].name} ${Math.abs(value)}`;
  }).join(", ");
  const convictions = activeConvictions(game.ideology).map((c) => c.name).join(", ") || "none";
  const conditions = game.conditions.map((c) => `${CONDITIONS[c.id].name} (${c.hoursLeft}h left)`).join(", ") || "none";
  // Quests and people each get their own line, so that only the one that changed needs sending.
  const quests = game.quests.filter((q) => q.status === "active").map((q) => `Active quest ${q.id}: ${q.objective}`);
  const finished = game.quests.filter((q) => q.status !== "active").map((q) => `${q.title} (${q.status})`).join(", ") || "none";
  const factions = Object.entries(game.factions).map(([id, v]) => `${id} ${v}`).join(", ");
  const contacts = contactList(game).map((c) => `Known person: ${c.name} (${c.attitude}${c.status && c.status !== "alive" ? `, ${c.status}` : ""}): ${c.note}`);
  const addedPeople = Object.entries(campaignCharacters(game.campaign)).map(([id, person]) => `${id} (${person.name})`).join(", ") || "none";
  const addedEnemies = Object.entries(campaignEnemies(game.campaign)).map(([id, enemy]) => `${id} (${enemy.name})`).join(", ") || "none";
  const deckPlan = walkLine(game);
  const placeToday = placeLine(game);
  const who = isCaptain(game) ? `Captain ${game.name}` : `${game.name}, ${roleView(game).short}, not in command`;
  return [
    `${clockLabel(game)}. ${who} (${game.character.pronouns}), level ${game.level}.`,
    `Health ${game.hp}/${maxHp(game)}, energy ${game.energy}/${maxEnergy(game)}, stress ${game.needs.stress}/100, fatigue ${game.needs.fatigue}/100, credits ${game.credits}.`,
    `Injuries and conditions: ${conditions}.`,
    `Attributes: ${Object.keys(STATS).map((id) => `${id} ${attr(game, id)}`).join(", ")}.`,
    `Best skills: ${skills}.`,
    `Weapon: ${weapon}. Armor: ${armor}. Traits: ${traits}. Perks: ${perks}.`,
    `Beliefs: ${beliefs}. Convictions: ${convictions}.`,
    `Carrying: ${items}.`,
    `Location: ${LOCATIONS[game.location].name} (${game.location}).`,
    ...(deckPlan ? [deckPlan] : []),
    ...(placeToday ? [placeToday] : []),
    `${isCaptain(game) ? "Ship" : "The Meridian"}: hull ${game.ship.hull}/${game.ship.maxHull}, fuel ${game.ship.fuel}/${game.ship.maxFuel}, fleet morale ${game.ship.morale}/100.`,
    fleetLine(game),
    `Faction standing: ${factions}.`,
    ...(quests.length ? quests : ["Active quests: none."]),
    `Finished quests: ${finished}.`,
    ...(contacts.length ? contacts : ["Known people: none yet."]),
    `Character files added in this campaign: ${addedPeople}.`,
    `Enemy types added in this campaign: ${addedEnemies}.`,
  ].join("\n");
}

// Marks people added in this campaign as known, once the story has mentioned them.
export function notePeopleSeen(game, text) {
  const entries = Object.entries(campaignCharacters(game.campaign)).map(([id, person]) => ({ id: `person:${id}`, name: person.name, aliases: person.aliases }));
  for (const id of findLoreIds(text, buildLoreIndex(entries))) {
    if (!game.seenLore.includes(id)) game.seenLore.push(id);
  }
}

// The full character background, sent to the AI at the start of each conversation.
export function aiDossier(game) {
  const c = game.character;
  const line = (label, text) => (text ? `${label}: ${text}` : null);
  const traitNotes = game.traits.map((id) => TRAITS[id]).filter(Boolean).map((t) => `- ${t.name}: ${t.gm ?? t.desc}`);
  const careers = (c.careers ?? []).map((job) => `${job.rankTitle}, ${job.name} (${job.terms} term${job.terms === 1 ? "" : "s"})`).join("; ");
  return [
    "<player_dossier>",
    "This is the player's character. Use it to make the story personal, and reveal it through events rather than reciting it.",
    `Name: ${game.name}${c.callsign ? `, known as "${c.callsign}"` : ""}. Pronouns: ${c.pronouns}. Age: ${c.age}.`,
    roleBrief(game, chairOf(game)),
    line("Species", SPECIES[c.species]?.gm),
    line("Appearance", c.appearance),
    line("Origin", [HOMEWORLDS[c.homeworld]?.gm, UPBRINGINGS[c.upbringing]?.gm].filter(Boolean).join(" ")),
    line("Career", careers),
    c.biography?.length ? `Life history:\n${c.biography.map((b) => `- ${b}`).join("\n")}` : null,
    line("What drives them", DRIVES[c.drive] ? `${DRIVES[c.drive].name}. ${DRIVES[c.drive].gm}` : null),
    line("Closest bond", c.bondPerson ? `${c.bondPerson}. ${BONDS[c.bond]?.note} Put this person in danger, or in the way, when it would matter most.` : c.bond === "no_one" ? "No one. Everyone they knew died in the Fall." : null),
    traitNotes.length ? `Traits and how to play them:\n${traitNotes.join("\n")}` : null,
    c.hooks?.length ? `Loose ends from their past, addressed to the player. Bring these into the story over time, and invent the details:\n${c.hooks.map((h) => `- ${h}`).join("\n")}` : null,
    "</player_dossier>",
  ].filter(Boolean).join("\n");
}
