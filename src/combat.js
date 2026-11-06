// Fights run entirely on this computer, from the stats in the files. The AI only says who's in
// a fight, and it's told how it ended. There are two sides, the player's and the enemy's, and
// either can have followers, including ones who join partway through.
//
// Each round returns a list of events for the fight window to play back. An event has text to
// show, and can say who acted, who was affected and what their health is now.

import { findCharacter, findEnemy } from "./campaign.js";
import { ATTITUDE_VALUES, CONDITIONS, FACTION_BELIEFS, NOTABLES, SKILLS } from "./character-data.js";
import { ABILITIES, ENEMIES, ITEMS, STATS } from "./data.js";
import { THREAT_LABELS } from "./npc.js";
import {
  addCondition, addFatigue, attrMod, beliefAffinity, changeStanding, changeStress, checkParts, clamp, defense, fxSum, grantXp, maxEnergy, maxHp, oddsFor, practice, roll, skillRank,
  unlockedAbilities, useItem,
} from "./rules.js";
import { COMBAT_ART, COMBAT_TEXT, PARLEY } from "./world.js";

// The most fighters a side can have, counting the player. More wouldn't fit in the window.
const MAX_PER_SIDE = 4;
const MAX_ARRIVALS = 3;
const FLEE_DC = 12;
// What a threat level adds to anyone fighting against the player, at each difficulty. A file holds what
// that person or creature is like at your side, so followers keep their numbers, and the danger of a
// threat level shows up as an enemy. hp multiplies health, and attack and damage are added.
export const FIGHT_DIFFICULTIES = {
  easy: {},
  normal: {
    2: { hp: 1.5, attack: 2, damage: 1 },
    3: { hp: 1.75, attack: 2, damage: 2 },
    4: { hp: 2.25, attack: 5, damage: 6 },
    5: { hp: 2.5, attack: 6, damage: 8 },
  },
  hard: {
    2: { hp: 2, attack: 3, damage: 3 },
    3: { hp: 2, attack: 3, damage: 3 },
    4: { hp: 2.5, attack: 6, damage: 8 },
    5: { hp: 2.5, attack: 6, damage: 8 },
  },
};
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
const YOU = "you";

const pickFrom = (pool) => pool[roll(0, pool.length - 1)];
const capitalized = (text) => text[0].toUpperCase() + text.slice(1);
// Someone who's been talked out of it isn't in the fight any more, though they're still on their feet.
const alive = (fighters) => fighters.filter((fighter) => fighter.hp > 0 && !fighter.out);
const roundsText = (n) => `${n} round${n === 1 ? "" : "s"}`;

function listOf(words) {
  if (words.length < 2) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function fill(pool, { enemy, ally, weapon } = {}) {
  return pickFrom(pool)
    .replaceAll("{enemy}", enemy?.prose ?? "your enemy")
    .replaceAll("{Enemy}", capitalized(enemy?.prose ?? "your enemy"))
    .replaceAll("{ally}", ally?.prose ?? "your follower")
    .replaceAll("{Ally}", capitalized(ally?.prose ?? "your follower"))
    .replaceAll("{weapon}", weapon ?? "weapon");
}

// An enemy's own line for something, if its file has one, otherwise a general one.
const enemyLines = (enemy, kind) => enemy.lines?.[kind] ?? COMBAT_TEXT.enemy[kind];

// ---- Who's fighting -----------------------------------------------------

// Reads "dock_thug", or "dock_thug as Syndicate Guard" when the story calls them something else.
function findFighter(game, text) {
  const [, who, called] = String(text).match(/^(.+?)\s+as\s+(.+)$/i) ?? [null, text, null];
  const source = findEnemy(game.campaign, who);
  if (!source) {
    throw new Error(`There's no enemy or person called "${who}". Use an id from the enemy list, a character with a file, or add a new one with create_enemy. The enemy list is: ${Object.keys(ENEMIES).join(", ")}.`);
  }
  const status = source.named ? game.contacts?.find((c) => c.name.toLowerCase() === source.shortName.toLowerCase())?.status : null;
  if (status && status !== "alive") throw new Error(`${source.name} can't fight, because they're ${status}.`);
  return { source, called };
}

// The numbers someone fights with when they're against the player. The fight window and the Bestiary show these.
export function enemyNumbers(source, difficulty = "normal") {
  const edge = FIGHT_DIFFICULTIES[difficulty]?.[source.threat] ?? { hp: 1, attack: 0, damage: 0 };
  return {
    hp: Math.round(source.hp * edge.hp),
    attack: source.attack + edge.attack,
    defense: source.defense,
    damage: source.damage.map((n) => n + edge.damage),
  };
}

// Why someone's fighting, and who for. The story can say, unless they're something that has no reasons.
export function whyTheyFight(source, { why = null, reason = null, faction = null } = {}) {
  const usual = source.motive ?? PARLEY.archetypes[source.archetype] ?? (source.named ? "cause" : source.machine ? "programmed" : "paid");
  const told = !PARLEY.motives[usual]?.fixed;
  return {
    motive: told && why ? why : usual,
    reason: told ? reason : null,
    faction: (told ? faction : null) ?? source.faction ?? null,
  };
}

function newFighter(c, side, { source, called, asName = false }) {
  // A fight saved before difficulties existed carries on with the numbers it started with.
  const numbers = side === "enemy" ? enemyNumbers(source, c.difficulty ?? "easy") : source;
  // Someone the story has renamed keeps their stats, and uses the general fight text instead of their own.
  const renamed = called?.replace(/^(?:a|an|the)\s+/i, "").trim() || null;
  const base = renamed ?? source.name;
  const sameName = [...c.allies, ...c.enemies].filter((fighter) => fighter.base === base).length;
  const named = Boolean(source.named && !renamed);
  return {
    key: `${side === "enemy" ? "e" : "a"}${c.nextKey++}`,
    id: source.id,
    base,
    name: sameName ? `${base} #${sameName + 1}` : base,
    // A name of someone's own, like Docker Pav, goes without "the".
    prose: named ? source.shortName : asName && renamed ? renamed : `the ${sameName ? `${ORDINALS[sameName]} ` : ""}${base}`,
    named,
    hp: numbers.hp,
    maxHp: numbers.hp,
    attack: numbers.attack,
    defense: numbers.defense,
    damage: numbers.damage,
    weapon: source.weapon ?? null,
    tags: source.tags ?? [],
    threat: source.threat ?? 1,
    xp: source.xp ?? 0,
    credits: source.credits ?? [0, 0],
    machine: Boolean(source.machine),
    boss: Boolean(source.boss),
    art: source.art ?? null,
    color: source.color ?? null,
    desc: source.desc ?? "",
    onHit: source.onHit ?? null,
    lines: renamed ? null : source.lines ?? null,
    stunned: false,
    ...(side === "enemy" ? whyTheyFight(source, c.story) : {}),
  };
}

// Sets up a fight. Everyone is checked before anything changes, so a bad request leaves no fight behind.
// asName says the main enemy's "as" is a person's own name, like "dock_thug as Docker Pav", not a kind of enemy.
export function startCombat(game, enemyId, { training = false, called = null, followers = [], allies = [], arrivals = [], leadIn = null, why = null, reason = null, faction = null, asName = false } = {}) {
  if (game.combat) throw new Error("A fight is already underway.");
  const main = findFighter(game, enemyId);
  const foes = followers.map((who) => findFighter(game, who));
  const friends = allies.map((who) => findFighter(game, who));
  const later = arrivals.map(({ who, side, round }) => ({ ...findFighter(game, who), side: side === "enemy" ? "enemy" : "ally", round: Math.max(2, round ?? 2) }));
  if (foes.length + 1 > MAX_PER_SIDE || friends.length + 1 > MAX_PER_SIDE) throw new Error(`Each side can have at most ${MAX_PER_SIDE} fighters, counting the player.`);
  if (later.length > MAX_ARRIVALS) throw new Error(`At most ${MAX_ARRIVALS} people can arrive during a fight.`);
  const people = [main, ...foes, ...friends, ...later].filter(({ source }) => source.named).map(({ source }) => source.id);
  if (new Set(people).size !== people.length) throw new Error("A person can only be in a fight once.");

  const c = {
    id: Date.now(),
    difficulty: game.difficulty ?? "normal",
    round: 1,
    guard: 0,
    survivorUsed: false,
    training,
    nextKey: 0,
    allies: [],
    enemies: [],
    arrivals: later,
    notes: [],
    leadIn,
    story: { why, reason: reason ? String(reason).slice(0, 160) : null, faction },
    // A simulated fight leaves everything exactly as it was.
    ...(training ? {
      snapshot: structuredClone({ hp: game.hp, energy: game.energy, needs: game.needs, conditions: game.conditions, inventory: game.inventory, skills: game.skills, skillXp: game.skillXp, credits: game.credits, xp: game.xp, level: game.level, perkPoints: game.perkPoints, statPoints: game.statPoints, skillPoints: game.skillPoints, traits: game.traits }),
    } : {}),
  };
  c.enemies.push(newFighter(c, "enemy", { source: main.source, called: called ?? main.called, asName }));
  for (const foe of foes) c.enemies.push(newFighter(c, "enemy", foe));
  for (const friend of friends) c.allies.push(newFighter(c, "ally", friend));
  c.intro = fill(enemyLines(c.enemies[0], "intro"), { enemy: c.enemies[0] });
  game.combat = c;
  return training ? [] : changeStress(game, c.enemies.some((enemy) => enemy.boss) ? 12 : 4);
}

// A follower for each side, for trying out a bigger fight in the simulator: one crew
// member beside you, another on the way, and a second enemy coming too.
export function simulatorFollowers(game, enemyId) {
  const crew = Object.entries(NOTABLES)
    .filter(([id, person]) => person.crew && id !== enemyId && (game.contacts.find((c) => c.name === person.name)?.status ?? "alive") === "alive")
    .sort(([, a], [, b]) => b.combat.threat - a.combat.threat)
    .map(([id]) => id);
  const arrivals = [];
  if (crew[1]) arrivals.push({ who: crew[1], side: "ally", round: 2 });
  if (!findEnemy(game.campaign, enemyId)?.named) arrivals.push({ who: enemyId, side: "enemy", round: 3 });
  return { allies: crew.slice(0, 1), arrivals };
}

// ---- The player's numbers -----------------------------------------------

export function attackBonus(game, target, stat, skill) {
  return checkParts(game, { skill, attribute: stat, context: target?.tags ?? [] }).total + fxSum(game, "attack");
}

function currentWeapon(game) {
  const weapon = ITEMS[game.equipped.weapon];
  if (!weapon) return { name: "your bare hands", stat: "might", skill: "melee", damage: [1, 3], text: "unarmed" };
  return { name: weapon.name, stat: weapon.stat, skill: weapon.skill, damage: weapon.damage, text: weapon.skill };
}

const damageRange = (game, range, bonus = 0) => {
  const extra = bonus + fxSum(game, "damage");
  return [Math.max(1, range[0] + extra), Math.max(1, range[1] + extra)];
};

const fleeBonus = (game) => attrMod(game, "agility") + skillRank(game, "athletics") + fxSum(game, "flee");
// The more of them there are, the harder it is to slip away.
const fleeDc = (c) => FLEE_DC + 2 * (alive(c.enemies).length - 1);

// ---- One round ----------------------------------------------------------

function addNotes(c, log, notes) {
  if (c.training) return;
  for (const note of notes) {
    c.notes.push(note);
    log.push({ note });
  }
}

function hurtEnemy(target, damage, log, line) {
  target.hp = Math.max(0, target.hp - damage);
  log.push({ ...line, damage, hp: { [target.key]: target.hp } });
  if (target.hp <= 0) log.push({ on: target.key, down: true, text: fill(enemyLines(target, "defeated"), { enemy: target }), tone: "good" });
}

function playerAttack(game, c, target, log, { ability = null, bonusDamage = 0, bonusAttack = 0, stat, skill } = {}) {
  const weapon = currentWeapon(game);
  const attackStat = stat ?? weapon.stat;
  const attackSkill = skill ?? weapon.skill;
  const die = roll(1, 20);
  const total = die + attackBonus(game, target, attackStat, attackSkill) + bonusAttack;
  const hit = die === 20 || (die !== 1 && total >= target.defense);
  const lines = ability ? COMBAT_TEXT.abilities[ability] : COMBAT_TEXT.attack[weapon.text] ?? COMBAT_TEXT.attack.melee;
  const words = { enemy: target, weapon: weapon.name };
  if (!hit) {
    log.push({ by: YOU, on: target.key, missed: true, text: fill(lines.miss, words), tone: "dim", math: `${total} vs defense ${target.defense}` });
  } else {
    const critical = die === 20;
    const [low, high] = damageRange(game, weapon.damage, bonusDamage);
    const damage = roll(low, high) * (critical ? 2 : 1);
    hurtEnemy(target, damage, log, { by: YOU, on: target.key, text: fill(critical && lines.crit ? lines.crit : lines.hit, words), tone: "good", math: `${damage} damage, ${total} vs defense ${target.defense}${critical ? ", critical" : ""}` });
  }
  addNotes(c, log, practice(game, attackSkill, hit ? 2 : 1));
  return hit;
}

function heal(game, amount, fighters = []) {
  const before = game.hp;
  game.hp = Math.min(maxHp(game), game.hp + amount);
  const hp = { [YOU]: game.hp };
  for (const ally of fighters) {
    ally.hp = Math.min(ally.maxHp, ally.hp + amount);
    hp[ally.key] = ally.hp;
  }
  return { healed: game.hp - before, hp };
}

function useAbility(game, c, id, target, log) {
  const lines = COMBAT_TEXT.abilities;
  const stun = (hit) => {
    if (hit && target.hp > 0) target.stunned = true;
  };
  game.energy -= ABILITIES[id].energy;
  if (id === "field_patch") {
    const { healed, hp } = heal(game, 10 + skillRank(game, "medicine"));
    log.push({ by: YOU, on: YOU, gained: healed, hp, text: fill(lines.field_patch, { enemy: target }), tone: "good", math: `+${healed} health` });
    addNotes(c, log, practice(game, "medicine", 2));
  } else if (id === "overcharged_shot") {
    playerAttack(game, c, target, log, { ability: id, bonusDamage: 6 });
  } else if (id === "evade") {
    c.guard = 5;
    log.push({ by: YOU, text: fill(lines.evade, { enemy: target }), tone: "info", math: "+5 defense this round" });
  } else if (id === "foresight") {
    c.guard = 5;
    addNotes(c, log, practice(game, "attunement", 2));
    playerAttack(game, c, target, log, { ability: id, bonusAttack: 3 });
  } else if (id === "push") {
    stun(playerAttack(game, c, target, log, { ability: id, stat: "resonance", skill: "manifestation" }));
  } else if (id === "spike") {
    stun(playerAttack(game, c, target, log, { ability: id, stat: "intellect", skill: "hacking" }));
  } else if (id === "glare") {
    const die = roll(1, 20);
    const total = die + checkParts(game, { skill: "intimidation", context: target.tags }).total;
    const worked = die === 20 || (die !== 1 && total >= target.defense);
    stun(worked);
    log.push({ by: YOU, on: target.key, missed: !worked, text: fill(worked ? lines.glare.hit : lines.glare.miss, { enemy: target }), tone: worked ? "good" : "dim", math: `${total} vs ${target.defense}` });
    addNotes(c, log, practice(game, "intimidation", 2));
  } else if (id === "rally") {
    const amount = 6 + skillRank(game, "leadership");
    const { healed, hp } = heal(game, amount, alive(c.allies));
    log.push({ by: YOU, on: YOU, gained: healed, hp, text: fill(lines.rally), tone: "good", math: `+${amount} health${c.allies.length ? " for your whole side" : ""}, -15 stress` });
    addNotes(c, log, changeStress(game, -15));
    addNotes(c, log, practice(game, "leadership", 2));
  }
}

function followerAttacks(c, ally, focus, log) {
  const foes = alive(c.enemies);
  // Followers go after what the player is aiming at, or else the weakest one left.
  const target = foes.find((foe) => foe.key === focus) ?? foes.reduce((weakest, foe) => (foe.hp < weakest.hp ? foe : weakest));
  const die = roll(1, 20);
  const total = die + ally.attack;
  const words = { enemy: target, ally };
  if (die !== 20 && (die === 1 || total < target.defense)) {
    log.push({ by: ally.key, on: target.key, missed: true, text: fill(COMBAT_TEXT.ally.miss, words), tone: "dim", math: `${total} vs defense ${target.defense}` });
    return;
  }
  const critical = die === 20;
  const damage = roll(...ally.damage) * (critical ? 2 : 1);
  hurtEnemy(target, damage, log, { by: ally.key, on: target.key, text: fill(critical ? COMBAT_TEXT.ally.crit : COMBAT_TEXT.ally.hit, words), tone: "good", math: `${damage} damage${critical ? ", critical" : ""}` });
}

function inflictWound(game, log) {
  const id = pickFrom(Object.keys(CONDITIONS).filter((condition) => CONDITIONS[condition].wound));
  addCondition(game, id);
  log.push({ text: `${pickFrom(COMBAT_TEXT.player.wound)} ${CONDITIONS[id].name}: ${CONDITIONS[id].desc}`, tone: "bad" });
}

function attackPlayer(game, c, enemy, log) {
  const die = roll(1, 20);
  const target = defense(game) + c.guard;
  const total = die + enemy.attack;
  if (die !== 20 && (die === 1 || total < target)) {
    log.push({ by: enemy.key, on: YOU, missed: true, text: fill(enemyLines(enemy, "miss"), { enemy }), tone: "dim", math: `${total} vs your defense ${target}` });
    return;
  }
  const critical = die === 20;
  const damage = roll(...enemy.damage) * (critical ? 2 : 1);
  game.hp -= damage;
  log.push({ by: enemy.key, on: YOU, damage, hp: { [YOU]: Math.max(0, game.hp) }, text: fill(enemyLines(enemy, critical ? "crit" : "hit"), { enemy }), tone: "bad", math: `${damage} damage${critical ? ", critical" : ""}` });
  if (enemy.onHit?.energy) {
    game.energy = Math.max(0, game.energy + enemy.onHit.energy);
    log.push({ text: `It drains you: ${enemy.onHit.energy} energy.`, tone: "bad" });
  }
  if (enemy.onHit?.stress) addNotes(c, log, changeStress(game, enemy.onHit.stress));
  if (critical) {
    addNotes(c, log, changeStress(game, 4));
    if (roll(1, 2) === 1) inflictWound(game, log);
  }
  if (game.hp <= 0 && !c.survivorUsed && game.perks.includes("survivor")) {
    game.hp = 1;
    c.survivorUsed = true;
    log.push({ hp: { [YOU]: 1 }, text: pickFrom(COMBAT_TEXT.player.survivor), tone: "good", math: "Survivor: 1 health" });
  }
}

function attackFollower(c, enemy, ally, log) {
  const die = roll(1, 20);
  const total = die + enemy.attack;
  const words = { enemy, ally };
  if (die !== 20 && (die === 1 || total < ally.defense)) {
    log.push({ by: enemy.key, on: ally.key, missed: true, text: fill(COMBAT_TEXT.enemyVsAlly.miss, words), tone: "dim", math: `${total} vs defense ${ally.defense}` });
    return;
  }
  const critical = die === 20;
  const damage = roll(...enemy.damage) * (critical ? 2 : 1);
  ally.hp = Math.max(0, ally.hp - damage);
  log.push({ by: enemy.key, on: ally.key, damage, hp: { [ally.key]: ally.hp }, text: fill(critical ? COMBAT_TEXT.enemyVsAlly.crit : COMBAT_TEXT.enemyVsAlly.hit, words), tone: "bad", math: `${damage} damage${critical ? ", critical" : ""}` });
  if (ally.hp <= 0) log.push({ on: ally.key, down: true, text: fill(COMBAT_TEXT.ally.down, { ally }), tone: "bad" });
}

function enemyActs(game, c, enemy, log) {
  if (enemy.stunned) {
    enemy.stunned = false;
    log.push({ on: enemy.key, text: fill(enemyLines(enemy, "stunned"), { enemy }), tone: "good" });
    return;
  }
  // The captain draws the most attention, but followers get their share.
  const friends = alive(c.allies);
  const target = pickFrom([YOU, YOU, ...friends.map((friend) => friend.key)]);
  if (target === YOU) attackPlayer(game, c, enemy, log);
  else attackFollower(c, enemy, friends.find((friend) => friend.key === target), log);
}

// ---- Talking instead of fighting -----------------------------------------

const APPROACHES = PARLEY.approaches;
const motiveOf = (enemy) => PARLEY.motives[enemy.motive] ?? PARLEY.motives[enemy.machine ? "programmed" : "paid"];
const bandFor = (bands, value) => bands.find((band) => value >= band.from)?.says ?? bands.at(-1).says;
const fillWith = (text, enemy) => text
  .replaceAll("{enemy}", enemy.prose)
  .replaceAll("{Enemy}", capitalized(enemy.prose))
  .replaceAll("{price}", String(enemy.paid ?? 0));

// How much someone hates the player, from -6 (they like them) to 6 (they want them dead).
function hatredOf(game, enemy) {
  const person = enemy.named ? findCharacter(game.campaign, enemy.id) : null;
  if (person) {
    const attitude = ATTITUDE_VALUES[game.contacts.find((contact) => contact.name === person.name)?.attitude] ?? 0;
    return clamp(Math.round(-2 * attitude - 2 * beliefAffinity(game.ideology, person.beliefs ?? {})), -6, 6);
  }
  if (!enemy.faction) return 0;
  return clamp(Math.round(-(game.factions[enemy.faction] ?? 0) / 15 - 2 * beliefAffinity(game.ideology, FACTION_BELIEFS[enemy.faction] ?? {})), -6, 6);
}

const average = ([low, high]) => (low + high) / 2;

// Who's winning, from the fighters' own numbers: how long each side would take to beat the other,
// from -6 (they'd walk over the player) to 6 (the other way around).
function strengthOf(game, c, target) {
  const weapon = currentWeapon(game);
  const foes = alive(c.enemies);
  const friends = alive(c.allies);
  const yours = (oddsFor(attackBonus(game, target, weapon.stat, weapon.skill), target.defense) / 100) * average(damageRange(game, weapon.damage))
    + friends.reduce((sum, ally) => sum + (oddsFor(ally.attack, target.defense) / 100) * average(ally.damage), 0);
  const theirs = foes.reduce((sum, foe) => sum + (oddsFor(foe.attack, defense(game)) / 100) * average(foe.damage), 0);
  const toBeatThem = foes.reduce((sum, foe) => sum + foe.hp, 0) / yours;
  const toBeatYou = (Math.max(1, game.hp) + friends.reduce((sum, ally) => sum + ally.hp, 0)) / theirs;
  return clamp(Math.round(Math.log2(toBeatYou / toBeatThem) * PARLEY.strengthScale), -PARLEY.strengthMost, PARLEY.strengthMost);
}

function priceFor(game, enemy) {
  const usual = average(enemy.credits) + enemy.threat * PARLEY.pay.threat;
  const haggled = usual * (motiveOf(enemy).price ?? 1) * (1 - skillRank(game, "commerce") * PARLEY.pay.perRank);
  return Math.max(PARLEY.pay.lowest, Math.round(haggled / 5) * 5);
}

// Whether an approach could work on this kind of enemy at all, whatever else is going on.
function couldWork(enemy, id) {
  if (enemy.boss) return false;
  if (id === "shutdown") return Boolean(enemy.machine);
  if (id === "threaten" && enemy.machine) return false;
  const shift = motiveOf(enemy)[id];
  return shift !== null && shift !== undefined;
}

// How one approach would go against one enemy right now, or why it can't happen.
function parleyOdds(game, c, enemy, id) {
  const approach = APPROACHES[id];
  const motive = motiveOf(enemy);
  if (!couldWork(enemy, id)) {
    const why = enemy.boss ? "nothing's going to stop this one but a fight" : id === "shutdown" ? "it only works on machines" : id === "threaten" && enemy.machine ? "machines can't be frightened" : motive.refuses?.[id] ?? motive.refuses?.any ?? "that won't work on them";
    return { disabled: true, why };
  }
  if (id === "lie" && enemy.lied) return { disabled: true, why: "they won't believe another word" };
  const price = id === "pay" ? priceFor(game, enemy) : null;
  if (price !== null && game.credits < price) return { disabled: true, why: `it would take ${price} credits` };
  const shift = id === "shutdown" ? motive.shutdown ?? PARLEY.machineShutdown : motive[id];
  const backing = c.enemies.filter((other) => other.out).reduce((sum, other) => sum + (other === c.enemies[0] ? PARLEY.backing.leader : PARLEY.backing.each), 0);
  const against = [
    { label: motive.label.toLowerCase(), value: shift },
    { label: "how they feel about you", value: Math.round(hatredOf(game, enemy) * approach.hate) },
    { label: "who's winning", value: -Math.round(strengthOf(game, c, enemy) * approach.strength) },
    { label: "you've already tried", value: enemy.anger ?? 0 },
    { label: "the others have backed off", value: -backing },
  ].filter((part) => part.value);
  const dc = clamp(PARLEY.difficulty + against.reduce((sum, part) => sum + part.value, 0), PARLEY.lowest, PARLEY.highest);
  const stats = id === "persuade" && motive.stat ? [...approach.stats, motive.stat] : approach.stats;
  const stat = stats.reduce((best, one) => (attrMod(game, one) > attrMod(game, best) ? one : best));
  const { parts, total } = checkParts(game, { skill: approach.skill, attribute: stat, context: enemy.tags });
  return { dc, bonus: total, odds: oddsFor(total, dc), stat, parts, against, price };
}

const withSign = (value) => (value >= 0 ? `+${value}` : String(value));

// What the fight window shows for an approach, aimed at this enemy.
function parleyTarget(game, c, enemy, id) {
  const found = parleyOdds(game, c, enemy, id);
  if (found.disabled) return found;
  const approach = APPROACHES[id];
  const yours = found.parts.map((part) => `${part.label} ${withSign(part.value)}`).join(", ");
  const theirs = found.against.map((part) => `${part.label} ${withSign(part.value)}`).join(", ");
  return {
    odds: found.odds,
    label: found.price !== null ? `${approach.name}, ${found.price} cr` : nameFor(enemy, id),
    detail: `${SKILLS[approach.skill].name} and ${STATS[found.stat]}`,
    title: `You: ${yours}. To beat: ${found.dc} (starts at ${PARLEY.difficulty}${theirs ? `, ${theirs}` : ""}).`,
  };
}

function nameFor(enemy, id) {
  return motiveOf(enemy).names?.[id] ?? APPROACHES[id].name;
}

function parleyLine(enemy, id, outcome) {
  const lines = APPROACHES[id].lines[outcome];
  return fill(enemy.lines?.[`${id}_${outcome}`] ?? lines[enemy.motive] ?? lines.any, { enemy });
}

// The player tries it. Whatever happens, it's their turn gone, and the enemies still get theirs.
function tryParley(game, c, target, id, log) {
  const approach = APPROACHES[id];
  const found = parleyOdds(game, c, target, id);
  const die = roll(1, 20);
  const total = die + found.bonus;
  const worked = die === 20 || (die !== 1 && total >= found.dc);
  if (!worked) {
    target.anger = Math.min(PARLEY.anger.most, (target.anger ?? 0) + PARLEY.anger.each);
    if (id === "lie") target.lied = true;
    log.push({ by: YOU, on: target.key, refused: true, text: parleyLine(target, id, "failed"), tone: "dim", math: `${total} vs ${found.dc}` });
  } else {
    if (found.price !== null) {
      game.credits -= found.price;
      target.paid = found.price;
    }
    target.out = id;
    log.push({ by: YOU, on: target.key, out: approach.out, text: parleyLine(target, id, "worked"), tone: "good", math: `${total} vs ${found.dc}${found.price !== null ? `, -${found.price} credits` : ""}` });
    const standing = c.training ? null : changeStanding(game, target.faction, approach.standing, `you ${approach.standing > 0 ? "talked your way out of a fight with one of theirs" : "frightened off one of theirs"}`);
    if (standing) addNotes(c, log, [standing]);
  }
  addNotes(c, log, practice(game, approach.skill, worked ? 3 : 2));
}

const someoneTakesPrisoners = (c) => alive(c.enemies).some((enemy) => motiveOf(enemy).surrender !== false);

// For the Bestiary: why this kind of enemy usually fights, and what you could try on it.
export function parleyNotes(source) {
  const { motive } = whyTheyFight(source);
  const enemy = { ...source, motive };
  return { why: motiveOf(enemy).says, could: Object.keys(APPROACHES).filter((id) => couldWork(enemy, id)).map((id) => nameFor(enemy, id)) };
}

function bringArrivals(c, log) {
  const next = c.round + 1;
  c.arrivals = c.arrivals.filter((arrival) => {
    if (arrival.round > next) return true;
    const side = arrival.side === "enemy" ? c.enemies : c.allies;
    // The player takes up a place on their side. Someone with no room stays out of it.
    if (side.length + (arrival.side === "enemy" ? 0 : 1) >= MAX_PER_SIDE) return false;
    const fighter = newFighter(c, arrival.side, arrival);
    side.push(fighter);
    const text = arrival.side === "enemy" ? fill(enemyLines(fighter, "joins"), { enemy: fighter }) : fill(COMBAT_TEXT.ally.joins, { ally: fighter });
    log.push({ joined: arrival.side, fighter: fighterView(fighter), on: fighter.key, text, tone: arrival.side === "enemy" ? "bad" : "good" });
    return false;
  });
}

// Refuses what can't be done before anything changes, so it costs nothing.
function checkAllowed(game, c, action, target) {
  if (action.type === "flee" && alive(c.enemies).some((enemy) => enemy.boss)) throw new Error(pickFrom(COMBAT_TEXT.player.fleeBoss));
  if (action.type === "ability") {
    const ability = ABILITIES[action.id];
    if (!ability || !unlockedAbilities(game).some((a) => a.id === action.id)) throw new Error("You don't know that ability.");
    if (game.energy < ability.energy) throw new Error(`Not enough energy for ${ability.name}.`);
    if (action.id === "spike" && !target.machine) throw new Error("System Spike only works on machines.");
    if (action.id === "glare" && target.machine) throw new Error("Machines can't be frightened.");
  } else if (action.type === "parley") {
    if (!APPROACHES[action.id]) throw new Error("Unknown combat action.");
    const found = parleyOdds(game, c, target, action.id);
    if (found.disabled) throw new Error(`${capitalized(found.why)}.`);
  } else if (action.type === "surrender") {
    if (!someoneTakesPrisoners(c)) throw new Error("There's nobody here to give up to.");
  } else if (!["attack", "cover", "item", "flee"].includes(action.type)) {
    throw new Error("Unknown combat action.");
  }
}

// Plays one round. The player acts, then their followers, then the enemies. Returns what happened.
export function combatAction(game, action) {
  const c = game.combat;
  if (!c) throw new Error("There's no fight right now.");
  const foes = alive(c.enemies);
  const target = foes.find((foe) => foe.key === action.target) ?? foes[0];
  checkAllowed(game, c, action, target);
  const log = [];
  c.guard = 0;

  if (action.type === "attack") {
    playerAttack(game, c, target, log);
  } else if (action.type === "cover") {
    c.guard = 3;
    log.push({ by: YOU, text: pickFrom(COMBAT_TEXT.player.cover), tone: "info", math: "+3 defense this round" });
  } else if (action.type === "item") {
    const text = useItem(game, action.id);
    log.push({ by: YOU, on: YOU, gained: 1, hp: { [YOU]: game.hp }, text, tone: "good" });
  } else if (action.type === "flee") {
    const die = roll(1, 20);
    const total = die + fleeBonus(game);
    const dc = fleeDc(c);
    addNotes(c, log, practice(game, "athletics", 2));
    if (die === 20 || (die !== 1 && total >= dc)) {
      log.push({ by: YOU, text: pickFrom(COMBAT_TEXT.player.fleeSuccess), tone: "info", math: `${total} vs ${dc}` });
      return endCombat(game, "fled", log);
    }
    log.push({ by: YOU, text: fill(COMBAT_TEXT.player.fleeFail, { enemy: target }), tone: "dim", math: `${total} vs ${dc}` });
  } else if (action.type === "parley") {
    tryParley(game, c, target, action.id, log);
  } else if (action.type === "surrender") {
    log.push({ by: YOU, text: pickFrom(PARLEY.surrender.lines), tone: "info" });
    return endCombat(game, "surrendered", log);
  } else {
    useAbility(game, c, action.id, target, log);
  }
  if (!alive(c.enemies).length) return endCombat(game, "victory", log);

  // Nobody talks anyone down with someone shooting at them from behind.
  if (action.type === "parley") {
    if (alive(c.allies).length) log.push({ text: pickFrom(PARLEY.holdFire), tone: "dim" });
  } else {
    for (const ally of alive(c.allies)) {
      followerAttacks(c, ally, target.key, log);
      if (!alive(c.enemies).length) return endCombat(game, "victory", log);
    }
  }
  for (const enemy of alive(c.enemies)) {
    enemyActs(game, c, enemy, log);
    if (game.hp <= 0) return endCombat(game, "defeat", log);
  }
  bringArrivals(c, log);
  c.round += 1;
  return { over: false, events: log };
}

// ---- How a fight ends ---------------------------------------------------

function endCombat(game, ended, log) {
  const c = game.combat;
  const wentAway = c.enemies.filter((enemy) => enemy.out && enemy.hp > 0);
  const beaten = c.enemies.filter((enemy) => !wentAway.includes(enemy));
  // If nobody was beaten, nobody won.
  const result = ended === "victory" && !beaten.length ? "talked" : ended;
  const rounds = roundsText(c.round);
  const prose = listOf(c.enemies.map((enemy) => enemy.prose));
  const beatenProse = listOf(beaten.map((enemy) => enemy.prose));
  const followers = c.allies.map((ally) => ({ name: ally.name, hp: ally.hp, maxHp: ally.maxHp, down: ally.hp <= 0 }));
  game.combat = null;

  if (c.training) {
    Object.assign(game, c.snapshot);
    const words = { victory: `You beat ${beatenProse} in ${rounds}.`, defeat: `You lost to ${prose} in ${rounds}.`, fled: `You broke off the fight with ${prose}.`, talked: `You got ${prose} to stop in ${rounds}.`, surrendered: `You gave up to ${prose}.` };
    return { over: true, result, training: true, events: log, followers, message: `${words[result]} It was only a simulation, so nothing carries over.` };
  }

  addFatigue(game, 6);
  const nameOf = (enemy) => (enemy.named ? enemy.name : enemy.prose);
  const foes = listOf(c.enemies.map(nameOf));
  const beatenNames = listOf(beaten.map(nameOf));
  const side = followers.length ? "You and your followers" : "You";
  // Those who went away are still out there, and that's the story's to pick up.
  const done = Object.keys(APPROACHES).filter((id) => wentAway.some((enemy) => enemy.out === id)).map((id) => {
    const these = wentAway.filter((enemy) => enemy.out === id);
    return fillWith(APPROACHES[id].done, { prose: listOf(these.map((enemy) => enemy.prose)), paid: these.reduce((sum, enemy) => sum + (enemy.paid ?? 0), 0) });
  }).join(" ");
  const told = wentAway.map((enemy) => fillWith(APPROACHES[enemy.out].told, { ...enemy, prose: nameOf(enemy) })).join(" ");
  const stillOut = told ? ` ${told} ${wentAway.length > 1 ? "They're" : "That one's"} still out there, so what happens next is up to the story.` : "";
  // Followers take their share of the credit. Someone who was paid to go is only worth half.
  const earned = () => Math.round(c.enemies.reduce((total, enemy) => total + enemy.xp * (wentAway.includes(enemy) ? APPROACHES[enemy.out].xp ?? 1 : 1), 0) / (1 + c.allies.length * 0.5));
  let summary;
  let story;
  let math = null;
  let tone;
  if (result === "victory") {
    const xp = earned();
    const credits = beaten.reduce((total, enemy) => total + roll(...enemy.credits), 0);
    game.credits += credits;
    math = `+${xp} XP${credits ? `, +${credits} credits` : ""}`;
    log.push({ text: "It's over. Nobody's left standing against you.", tone: "good", math });
    addNotes(c, log, grantXp(game, xp));
    addNotes(c, log, practice(game, "tactics", 2));
    addNotes(c, log, changeStress(game, fxSum(game, "stressOnKill")));
    const named = beaten.filter((enemy) => enemy.named).map((enemy) => enemy.name);
    story = `The player won the fight against ${beatenNames} in ${rounds}, and took ${credits} credits.${named.length ? ` The game hasn't decided what becomes of ${listOf(named)}. They're beaten and at the player's mercy, so the story decides.` : ""}${stillOut}`;
    summary = `${side} beat ${beatenProse} in ${rounds}.${done ? ` ${done}` : ""}`;
    tone = "good";
  } else if (result === "talked") {
    const xp = earned();
    math = `+${xp} XP`;
    log.push({ text: "It's over, and nobody had to be beaten.", tone: "good", math });
    addNotes(c, log, grantXp(game, xp));
    story = `The fight with ${foes} ended in ${rounds} without anyone being beaten.${stillOut}`;
    summary = done;
    tone = "good";
  } else if (result === "surrendered") {
    log.push({ text: PARLEY.surrender.over, tone: "warn" });
    addNotes(c, log, changeStress(game, 6));
    // A drone can't take prisoners, so it's the people with it who matter.
    const takers = alive(c.enemies).filter((enemy) => motiveOf(enemy).surrender !== false);
    const reason = takers[0]?.reason;
    story = `The player gave up in the fight with ${listOf(takers.map(nameOf))} after ${rounds}, and is at their mercy.${reason ? ` They were fighting because: ${reason}` : ""} Decide what they do now, in a way that fits why they were fighting: they might rob the player, arrest them, drag them off or let them go. It isn't the end of the game.${stillOut}`;
    summary = PARLEY.surrender.done.replaceAll("{enemy}", listOf(takers.map((enemy) => enemy.prose)));
    tone = "warn";
  } else if (result === "defeat") {
    // Losing a fight isn't game over. It's a setback the story has to deal with.
    const lost = Math.floor(game.credits * 0.25);
    game.credits -= lost;
    math = `-${lost} credits`;
    log.push({ text: pickFrom(COMBAT_TEXT.player.defeat), tone: "bad", math });
    inflictWound(game, log);
    game.hp = Math.max(1, Math.floor(maxHp(game) * 0.25));
    addNotes(c, log, changeStress(game, 15));
    story = `The player lost the fight against ${foes}, was left badly hurt and lost ${lost} credits. They survive, and wake up somewhere that fits the story.${stillOut}`;
    summary = `You lost the fight against ${prose}.`;
    tone = "bad";
  } else {
    addNotes(c, log, changeStress(game, 3));
    story = `The player ran from the fight with ${foes}, who ${c.enemies.length > 1 ? "are" : "is"} still out there.${followers.length ? " Their followers got out with them." : ""}${stillOut}`;
    summary = `You got away from ${prose}.`;
    tone = "info";
  }

  for (const id of new Set(c.enemies.map((enemy) => enemy.id))) {
    const record = game.bestiary[id] ?? { fought: 0, won: 0, lost: 0, fled: 0 };
    game.bestiary[id] = {
      fought: record.fought + 1,
      won: record.won + (result === "victory" ? 1 : 0),
      lost: record.lost + (result === "defeat" ? 1 : 0),
      fled: record.fled + (result === "fled" ? 1 : 0),
      talked: (record.talked ?? 0) + (wentAway.some((enemy) => enemy.id === id) ? 1 : 0),
      gaveUp: (record.gaveUp ?? 0) + (result === "surrendered" ? 1 : 0),
    };
  }
  // The written story reads this to decide where it goes next.
  game.lastFight = { result, enemies: [...new Set(c.enemies.map((enemy) => enemy.id))], summary, used: false };
  // The AI hears about the fight with the player's next message. Nothing is sent to it now.
  const wounds = game.conditions.map((condition) => CONDITIONS[condition.id].name);
  const beside = followers.length
    ? ` Fighting beside them: ${listOf(c.allies.map((ally) => `${ally.named ? ally.name : ally.prose} (${ally.hp > 0 ? `${ally.hp}/${ally.maxHp} health` : "knocked out, and the story decides how badly"})`))}.`
    : "";
  game.pendingEvents.push(`${story}${beside} Health is now ${game.hp}/${maxHp(game)}.${wounds.length ? ` Current injuries and conditions: ${wounds.join(", ")}.` : ""}`);
  return { over: true, result, events: log, followers, summary, math, tone, notes: c.notes };
}

// ---- What the fight window shows ----------------------------------------

function artFor(fighter) {
  const fallback = fighter.machine ? "drone" : fighter.tags.includes("resonance") ? "adept" : "soldier";
  return COMBAT_ART[fighter.art] ?? COMBAT_ART[fallback];
}

function playerArt(game) {
  if (game.character?.species === "synthetic") return COMBAT_ART.synthetic;
  const { skill } = currentWeapon(game);
  if (skill === "manifestation") return COMBAT_ART.adept;
  if (skill === "melee") return COMBAT_ART[game.equipped.weapon ? "blade" : "brawler"];
  if (skill === "engineering") return COMBAT_ART.engineer;
  return COMBAT_ART.soldier;
}

function fighterView(fighter) {
  return {
    key: fighter.key,
    name: fighter.name,
    hp: fighter.hp,
    maxHp: fighter.maxHp,
    attack: fighter.attack,
    defense: fighter.defense,
    damage: fighter.damage,
    weapon: fighter.weapon,
    desc: fighter.desc,
    threat: THREAT_LABELS[fighter.threat] ?? null,
    color: fighter.color,
    art: artFor(fighter),
    fallen: COMBAT_ART[fighter.machine ? "wreck" : "fallen"],
    stunned: fighter.stunned,
    out: fighter.out ? APPROACHES[fighter.out]?.out ?? "Gone" : null,
  };
}

// What the player can tell about someone they might try talking to.
function readOf(game, c, enemy) {
  const motive = motiveOf(enemy);
  return {
    why: enemy.reason ?? motive.says,
    feels: motive.noFeelings ? null : bandFor(PARLEY.feelings, hatredOf(game, enemy)),
    fight: bandFor(PARLEY.strength, strengthOf(game, c, enemy)),
  };
}

// What the player can do this round, with the odds worked out against each enemy.
function combatActions(game) {
  const c = game.combat;
  const foes = alive(c.enemies);
  const weapon = currentWeapon(game);
  const range = (bonus = 0) => damageRange(game, weapon.damage, bonus).join("-");
  const against = (work) => Object.fromEntries(foes.map((foe) => [foe.key, work(foe)]));
  const hitting = (stat, skill, bonus = 0) => against((foe) => ({ odds: oddsFor(attackBonus(game, foe, stat, skill) + bonus, foe.defense) }));
  const usual = (bonus) => hitting(weapon.stat, weapon.skill, bonus);
  const actions = [
    { group: "attack", action: { type: "attack" }, label: `Attack with ${weapon.name}`, detail: `${range()} damage`, oddsLabel: "HIT", targets: usual() },
    { group: "other", action: { type: "cover" }, label: "Take cover", detail: "+3 defense this round" },
  ];
  const abilityDetails = {
    field_patch: { group: "other", detail: `heal ${10 + skillRank(game, "medicine")}` },
    overcharged_shot: { group: "attack", detail: `${range(6)} damage`, oddsLabel: "HIT", targets: usual() },
    evade: { group: "other", detail: "+5 defense this round" },
    foresight: { group: "attack", detail: `${range()} damage, +5 defense this round`, oddsLabel: "HIT", targets: usual(3) },
    push: { group: "attack", detail: `${range()} damage, stuns for a round`, oddsLabel: "HIT", targets: hitting("resonance", "manifestation") },
    spike: {
      group: "attack",
      detail: `${range()} damage, disables for a round`,
      oddsLabel: "HIT",
      targets: against((foe) => (foe.machine ? { odds: oddsFor(attackBonus(game, foe, "intellect", "hacking"), foe.defense) } : { disabled: true, why: "only works on machines" })),
    },
    glare: {
      group: "attack",
      detail: "freezes them for a round",
      oddsLabel: "WORKS",
      targets: against((foe) => (foe.machine ? { disabled: true, why: "machines can't be frightened" } : { odds: oddsFor(checkParts(game, { skill: "intimidation", context: foe.tags }).total, foe.defense) })),
    },
    rally: { group: "other", detail: `heal ${6 + skillRank(game, "leadership")}${c.allies.length ? " for your whole side" : ""}, -15 stress` },
  };
  for (const ability of unlockedAbilities(game)) {
    actions.push({
      action: { type: "ability", id: ability.id },
      label: `${ability.name} (${ability.energy} energy)`,
      ...abilityDetails[ability.id],
      ...(game.energy < ability.energy ? { disabled: true, why: "not enough energy" } : {}),
    });
  }
  for (const id of Object.keys(APPROACHES).filter((one) => foes.some((foe) => couldWork(foe, one)))) {
    actions.push({ group: "talk", action: { type: "parley", id }, label: APPROACHES[id].name, oddsLabel: "WORKS", targets: against((foe) => parleyTarget(game, c, foe, id)) });
  }
  for (const [id, count] of Object.entries(game.inventory)) {
    const item = ITEMS[id];
    if (item?.type === "consumable" && (item.effect.hp || item.effect.energy)) {
      actions.push({ group: "other", action: { type: "item", id }, label: `${item.name} x${count}`, detail: item.desc });
    }
  }
  actions.push(someoneTakesPrisoners(c)
    ? { group: "other", action: { type: "surrender" }, label: "Give up", detail: "the story decides what they do with you" }
    : { group: "other", action: { type: "surrender" }, label: "Give up", disabled: true, why: "there's nobody here to give up to" });
  actions.push(foes.some((foe) => foe.boss)
    ? { group: "other", action: { type: "flee" }, label: "Run for it", disabled: true, why: "there's no outrunning this one" }
    : { group: "other", action: { type: "flee" }, label: "Run for it", oddsLabel: "ESCAPE", odds: oddsFor(fleeBonus(game), fleeDc(c)) });
  return actions;
}

export function combatView(game) {
  const c = game.combat;
  if (!c) return null;
  const weapon = currentWeapon(game);
  return {
    id: c.id,
    round: c.round,
    training: Boolean(c.training),
    opening: c.leadIn ?? c.intro ?? null,
    you: {
      key: YOU,
      name: game.name,
      hp: Math.max(0, game.hp),
      maxHp: maxHp(game),
      energy: game.energy,
      maxEnergy: maxEnergy(game),
      attack: attackBonus(game, null, weapon.stat, weapon.skill),
      defense: defense(game),
      damage: damageRange(game, weapon.damage),
      weapon: weapon.name,
      art: playerArt(game),
      fallen: COMBAT_ART.fallen,
    },
    allies: c.allies.map(fighterView),
    enemies: c.enemies.map(fighterView),
    reads: Object.fromEntries(alive(c.enemies).map((enemy) => [enemy.key, readOf(game, c, enemy)])),
    actions: combatActions(game),
  };
}

// The player's fighting numbers outside a fight, for the Character menu.
export function combatProfile(game) {
  const weapon = currentWeapon(game);
  const armor = ITEMS[game.equipped.armor];
  return {
    weapon: weapon.name,
    weaponStat: STATS[weapon.stat],
    weaponSkill: SKILLS[weapon.skill].name,
    attack: attackBonus(game, null, weapon.stat, weapon.skill),
    damage: damageRange(game, weapon.damage),
    armor: armor?.name ?? "None",
    armorDefense: armor?.defense ?? 0,
    defense: defense(game),
    escape: oddsFor(fleeBonus(game), FLEE_DC),
  };
}
