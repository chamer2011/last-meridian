// Generates the numbers for people and enemies the game master adds while playing.
// The AI only says what sort of person they are. Their stats always come from here.

import { AXES, POLES, SPECIES } from "./character-data.js";
import { FACTIONS, LOCATIONS, STATS } from "./data.js";

export const THREAT_LABELS = { 1: "Minor", 2: "Capable", 3: "Dangerous", 4: "Deadly", 5: "Legendary" };

const THREATS = {
  1: { hp: 14, attack: 2, defense: 11, damage: [2, 5], xp: 20, credits: [5, 30], attr: 3, rank: 2 },
  2: { hp: 22, attack: 3, defense: 12, damage: [3, 6], xp: 40, credits: [10, 60], attr: 4, rank: 3 },
  3: { hp: 30, attack: 5, defense: 14, damage: [4, 8], xp: 80, credits: [20, 90], attr: 5, rank: 5 },
  4: { hp: 42, attack: 6, defense: 15, damage: [5, 10], xp: 140, credits: [40, 150], attr: 6, rank: 6 },
  5: { hp: 60, attack: 7, defense: 16, damage: [6, 12], xp: 220, credits: [0, 0], attr: 8, rank: 8 },
};

export const NPC_ARCHETYPES = {
  civilian: { favors: ["presence", "perception"], skills: ["persuasion", "commerce", "awareness"], hp: 0.8, attack: -1, defense: -1, damage: -1, weapon: "Whatever's to Hand", tags: [], art: "civilian" },
  soldier: { favors: ["might", "endurance"], skills: ["firearms", "tactics", "athletics"], hp: 1.1, attack: 1, defense: 0, damage: 0, weapon: "Service Rifle", tags: [], art: "soldier" },
  officer: { favors: ["presence", "intellect"], skills: ["leadership", "tactics", "firearms"], hp: 1, attack: 0, defense: 0, damage: 0, weapon: "Concord Sidearm", tags: [], art: "officer" },
  scoundrel: { favors: ["agility", "presence"], skills: ["deception", "stealth", "streetwise", "firearms"], hp: 0.9, attack: 0, defense: 1, damage: 0, weapon: "Concealed Pistol", tags: [], art: "scoundrel" },
  scholar: { favors: ["intellect", "perception"], skills: ["science", "lore", "medicine"], hp: 0.7, attack: -2, defense: -1, damage: -1, weapon: "Bare Hands", tags: [], art: "civilian" },
  engineer: { favors: ["intellect", "endurance"], skills: ["engineering", "hacking", "void_ops"], hp: 0.9, attack: -1, defense: 0, damage: 0, weapon: "Heavy Tool", tags: [], art: "engineer" },
  adept: { favors: ["resonance", "willpower"], skills: ["attunement", "manifestation", "composure", "melee"], hp: 0.9, attack: 1, defense: 0, damage: 0, weapon: "Focus Blade", tags: ["resonance"], art: "adept" },
  machine: { favors: ["might", "intellect"], skills: ["firearms", "awareness", "hacking"], hp: 1, attack: 0, defense: 1, damage: 0, weapon: "Built-In Weapons", tags: ["machines"], machine: true, art: "drone" },
  beast: { favors: ["might", "agility"], skills: ["athletics", "survival", "stealth"], hp: 1.1, attack: 0, defense: 0, damage: 1, weapon: "Claws and Teeth", tags: [], art: "beast" },
};

// A small repeatable random generator, so the same name always gets the same stats.
function seededRandom(text) {
  let seed = 0;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function combatStats(archetype, threat) {
  const type = NPC_ARCHETYPES[archetype] ?? NPC_ARCHETYPES.civilian;
  const level = THREATS[threat] ?? THREATS[1];
  const min = Math.max(1, level.damage[0] + type.damage);
  return {
    threat: level === THREATS[threat] ? threat : 1,
    hp: Math.max(6, Math.round(level.hp * type.hp)),
    attack: Math.max(0, level.attack + type.attack),
    defense: level.defense + type.defense,
    damage: [min, Math.max(min + 1, level.damage[1] + type.damage)],
    weapon: type.weapon,
    art: type.art,
    tags: [...type.tags],
    xp: level.xp,
    credits: [...level.credits],
    ...(type.machine ? { machine: true } : {}),
  };
}

export function generateStats(name, archetype, threat) {
  const type = NPC_ARCHETYPES[archetype] ?? NPC_ARCHETYPES.civilian;
  const level = THREATS[threat] ?? THREATS[1];
  const random = seededRandom(name);
  const attributes = {};
  for (const id of Object.keys(STATS)) {
    const favored = type.favors.includes(id) ? 2 : 0;
    const base = id === "resonance" && !favored ? 1 : level.attr - 1 + Math.floor(random() * 2) + favored;
    attributes[id] = Math.max(1, Math.min(10, base));
  }
  const skills = {};
  type.skills.forEach((id, i) => {
    skills[id] = Math.max(1, level.rank - i);
  });
  return { attributes, skills, combat: combatStats(archetype, threat) };
}

// A person's file, written out for the AI. Numbers stay out of it: the game handles those.
export function characterBrief(id, person, contact) {
  const fullName = [person.title, person.name].filter(Boolean).join(" ");
  const beliefs = Object.entries(person.beliefs ?? {})
    .map(([axis, value]) => `${POLES[value < 0 ? AXES[axis].low : AXES[axis].high].name} ${Math.abs(value)}`)
    .join(", ");
  const facts = [
    person.pronouns,
    SPECIES[person.species]?.name ?? person.species,
    person.age ? `age ${person.age}` : null,
    FACTIONS[person.faction]?.name,
    LOCATIONS[person.location] ? `usually at ${LOCATIONS[person.location].name}` : null,
  ].filter(Boolean).join(", ");
  const line = (label, text) => (text ? `${label}: ${text}` : null);
  return [
    `${fullName} (id: ${id}). ${facts}.`,
    line("Role", person.role),
    line("Publicly known", person.note),
    line("Appearance", person.appearance),
    line("Personality", person.personality),
    line("How they speak", person.voice),
    line("Goals", person.goals),
    line("Secrets, for you only", person.secrets),
    line("Beliefs", beliefs),
    contact ? `With the player: ${contact.attitude}. ${contact.note ?? ""}`.trim() : "The player hasn't met them yet.",
  ].filter(Boolean).join("\n");
}
