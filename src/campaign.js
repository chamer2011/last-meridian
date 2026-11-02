// The people and enemies that belong to one campaign, kept as files on this computer.
// When the game master adds someone, they're saved here and remembered for good. Saved
// games from the same campaign share these files, and a new campaign starts with none.

import fs from "node:fs";
import path from "node:path";
import { NOTABLES, POLES } from "./character-data.js";
import { ENEMIES } from "./data.js";
import { characterBrief, combatStats, generateStats } from "./npc.js";
import { dataDir } from "./paths.js";
import { readFolder } from "./world.js";

export const slugify = (text) => {
  const raw = String(text ?? "");
  const slug = raw.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  // A name in another alphabet leaves nothing behind, so it gets an id made from its letters' numbers.
  return slug || [...raw.trim()].map((ch) => ch.codePointAt(0).toString(36)).join("-").slice(0, 60);
};

export const newCampaignId = (name) => `${slugify(name) || "captain"}-${Date.now().toString(36)}`;

export const fullName = (person) => [person.title, person.name].filter(Boolean).join(" ");

const campaignFolder = (campaign) => path.join(dataDir(), "campaigns", slugify(campaign));
export const campaignFolderName = (campaign) => path.join("data", "campaigns", slugify(campaign));

// Words that can start a name without being what anyone is called.
const NOT_NAMES = new Set(["Old", "Young", "Big", "Little", "The", "Doc", "Doctor", "Mother", "Father", "Brother", "Sister", "Elder", "Captain", "Commander", "Lieutenant", "Sergeant", "Chief", "Madam", "Mister", "Lady", "Lord", "Saint"]);

// What people would call someone besides their full name: their first and last names.
function shortNames(name) {
  const words = name.split(/\s+/);
  return words.length > 1 ? words.filter((word) => /^\p{Lu}\p{Ll}{2,}$/u.test(word) && !NOT_NAMES.has(word)) : [];
}

const stores = new Map();

function store(campaign) {
  const root = campaignFolder(campaign);
  if (!stores.has(root)) {
    const characters = readFolder(path.join(root, "characters"));
    // Files saved by an earlier version only list a last name.
    for (const person of Object.values(characters)) person.aliases = [...new Set([...(person.aliases ?? []), ...shortNames(person.name)])];
    stores.set(root, { characters, enemies: readFolder(path.join(root, "enemies")), rooms: readFolder(path.join(root, "rooms")) });
  }
  return stores.get(root);
}

function writeFile(campaign, kind, id, data) {
  const folder = path.join(campaignFolder(campaign), kind);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${id}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

export const campaignCharacters = (campaign) => (campaign ? store(campaign).characters : {});
export const campaignEnemies = (campaign) => (campaign ? store(campaign).enemies : {});
export const campaignRooms = (campaign) => (campaign ? store(campaign).rooms : {});
export const allCharacters = (campaign) => ({ ...NOTABLES, ...campaignCharacters(campaign) });
export const allEnemies = (campaign) => ({ ...ENEMIES, ...campaignEnemies(campaign) });

// Finds someone by their id, name, title and name, or any other name they go by.
export function findCharacter(campaign, text) {
  const key = String(text ?? "").trim().toLowerCase();
  if (!key) return null;
  const everyone = allCharacters(campaign);
  // Most of the time this is someone's id, and it gets asked for several times a second.
  if (Object.hasOwn(everyone, key)) return { id: key, ...everyone[key] };
  for (const [id, person] of Object.entries(everyone)) {
    const names = [id, person.name, fullName(person), ...(person.aliases ?? [])];
    if (names.some((name) => name.toLowerCase() === key)) return { id, ...person };
  }
  return null;
}

// Finds something to fight: a type of enemy, or a person with fighting stats in their file.
export function findEnemy(campaign, text) {
  const key = String(text ?? "").trim().toLowerCase();
  if (!key) return null;
  for (const [id, enemy] of Object.entries(allEnemies(campaign))) {
    if (id === key || enemy.name.toLowerCase() === key) return { id, ...enemy };
  }
  const person = findCharacter(campaign, key);
  if (!person?.combat) return null;
  return { id: person.id, name: fullName(person), shortName: person.name, named: true, desc: person.note, color: person.color, faction: person.faction ?? null, ...person.combat };
}

const toBeliefs = (poles = []) => {
  const beliefs = {};
  for (const id of poles) if (POLES[id]) beliefs[POLES[id].axis] = POLES[id].sign * 6;
  return beliefs;
};

// Saves a person the game master has added, or fills in more of their file.
export function saveCampaignCharacter(campaign, input) {
  const given = String(input.name ?? "").trim();
  if (!slugify(given) || given.length > 60) throw new Error("A character needs a name of up to 60 characters.");
  if (NOTABLES[slugify(given)] || findCharacter(null, given)) throw new Error(`${given} already has a file. Use read_character to see it, and note_contact to change how things stand.`);
  // Someone already on file is updated, whichever of their names was used.
  const id = findCharacter(campaign, given)?.id ?? slugify(given);
  const existing = store(campaign).characters[id];
  const name = existing?.name ?? given;
  const archetype = input.archetype ?? existing?.archetype ?? "civilian";
  const threat = input.threat ?? existing?.combat?.threat ?? 1;
  const statsChanged = !existing || archetype !== existing.archetype || threat !== existing.combat?.threat;
  const person = {
    ...existing,
    name,
    title: input.title ?? existing?.title ?? "",
    aliases: existing?.aliases ?? shortNames(name),
    pronouns: input.pronouns ?? existing?.pronouns ?? "they/them",
    species: input.species ?? existing?.species ?? "human",
    faction: input.faction ?? existing?.faction ?? null,
    role: input.role ?? existing?.role ?? "",
    location: input.location ?? existing?.location ?? null,
    note: input.public ?? input.note ?? existing?.note ?? "",
    appearance: input.appearance ?? existing?.appearance ?? "",
    personality: input.personality ?? existing?.personality ?? "",
    voice: input.voice ?? existing?.voice ?? "",
    goals: input.goals ?? existing?.goals ?? "",
    secrets: input.secrets ?? existing?.secrets ?? "",
    beliefs: input.beliefs ? toBeliefs(input.beliefs) : existing?.beliefs ?? {},
    archetype,
    ...(statsChanged ? generateStats(name, archetype, threat) : {}),
  };
  store(campaign).characters[id] = person;
  writeFile(campaign, "characters", id, person);
  return { id, person, created: !existing };
}

export function saveCampaignEnemy(campaign, input) {
  const name = String(input.name ?? "").trim();
  const id = slugify(name).replaceAll("-", "_");
  if (!id || name.length > 60) throw new Error("An enemy needs a name of up to 60 characters.");
  if (ENEMIES[id]) throw new Error(`There's already an enemy called ${name}. Use its id: ${id}.`);
  const stats = combatStats(input.archetype, input.threat);
  const enemy = { name, desc: input.description ?? "", ...stats, tags: [...new Set([...stats.tags, ...(input.tags ?? [])])], archetype: input.archetype, ...(input.why ? { motive: input.why } : {}), ...(input.faction ? { faction: input.faction } : {}) };
  store(campaign).enemies[id] = enemy;
  writeFile(campaign, "enemies", id, enemy);
  return { id, enemy };
}

const roomId = (name) => slugify(String(name).replace(/^\s*the\s+/i, ""));

// Somewhere the story has been that isn't on any map. Its file can have its own drawing, too. Two
// places can each have a Back Room, so if the name's taken, the second one's file says where it is.
export function findCampaignRoom(campaign, name, place) {
  const rooms = campaignRooms(campaign);
  const id = roomId(name);
  if (rooms[`${id}-at-${place}`]) return rooms[`${id}-at-${place}`];
  return rooms[id] && (!place || (rooms[id].place ?? place) === place) ? rooms[id] : null;
}

export function saveCampaignRoom(campaign, room) {
  const taken = store(campaign).rooms[roomId(room.name)];
  const id = taken?.place && room.place && taken.place !== room.place ? `${roomId(room.name)}-at-${room.place}` : roomId(room.name);
  store(campaign).rooms[id] = room;
  writeFile(campaign, "rooms", id, room);
}

// Everyone the captain knows should have a file, including people from their past.
export function ensureContactFiles(game) {
  if (!game.campaign) return;
  for (const contact of game.contacts) {
    const person = findCharacter(game.campaign, contact.name);
    if (person) {
      contact.id = person.id;
      continue;
    }
    if (!slugify(contact.name)) continue;
    const note = contact.note ?? "";
    try {
      const { id } = saveCampaignCharacter(game.campaign, { name: contact.name, role: note.split(". ")[0], public: note, archetype: "civilian", threat: 1 });
      contact.id = id;
    } catch {
      // A name the files can't hold shouldn't stop a save from loading. They're still a contact, just without a file.
    }
  }
}

// A readable copy of the captain's stats. The real ones live in the saved game.
export function saveCaptainSheet(campaign, sheet) {
  const root = campaignFolder(campaign);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "captain.json"), `${JSON.stringify(sheet, null, 2)}\n`);
}

export function characterFileFor(game, text) {
  const person = findCharacter(game.campaign, text);
  if (!person) return null;
  const contact = game.contacts.find((c) => c.name.toLowerCase() === person.name.toLowerCase());
  return { id: person.id, brief: characterBrief(person.id, person, contact) };
}
