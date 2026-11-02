// Everything the game can explain when a word in the story is highlighted. This is
// what a captain would know, so the setting's secrets stay out of it.

import { FACTIONS, LOCATIONS } from "./data.js";
import { NOTABLES, SPECIES } from "./character-data.js";
import { FLEET_DATA } from "./world.js";
import { buildLoreIndex, findLoreIds } from "../public/story.js";

export const LORE_KINDS = ["person", "faction", "place", "ship", "people", "concept"];

const CONCEPTS = [
  { id: "concord", name: "The Concord", aliases: ["the Concord", "Concord"], text: "The peaceful interstellar republic that kept order for a century. It fell in a single week, six months ago." },
  { id: "choir", name: "The Choir", aliases: ["the Choir", "Choir"], color: "#cfd8dc", text: "Silver machines that sing to one another across space, and wear the faces of the people they kill. Nobody knows who built them." },
  { id: "fall", name: "The Fall", aliases: ["the Fall"], text: "The week the Concord died. Everyone in the fleet can tell you where they were." },
  { id: "first_builders", name: "The First Builders", aliases: ["the First Builders", "First Builders", "First Builder"], text: "A vanished civilization, far older than any living people. Their ruins still hum, and nobody agrees on why they left." },
  { id: "resonance", name: "Resonance", aliases: ["resonance", "Resonants", "Resonant", "resonants"], text: "The faint field the First Builders left behind. Those who can feel it are called Resonants. They can sense minds, move objects and glimpse what's coming, and it always has a price." },
  { id: "adepts", name: "Adepts", aliases: ["Adept", "adepts"], text: "Resonants trained by the Order of Ilun, through years of silence and discipline." },
  { id: "inquisitors", name: "Inquisitors", aliases: ["Inquisitor"], text: "The Hegemony's hunters of Resonants. Their blades are said to drink energy." },
  { id: "beacon", name: "The Beacon", aliases: ["the Beacon", "Beacon"], text: "A signal from beyond known space, promising a safe harbor from the Choir. It repeats on every band, and nobody knows who's sending it." },
];

const FACTION_ALIASES = {
  fleet: ["Refugee Fleet", "the Fleet", "The Fleet"],
  hegemony: ["the Hegemony", "The Hegemony"],
  drift: ["the Syndicate", "The Syndicate", "Syndicate"],
  ilun: ["the Order of Ilun", "The Order of Ilun", "the Order", "The Order"],
};

const PLACE_ALIASES = {
  meridian: ["the Meridian", "The Meridian", "Meridian"],
  haven: ["Haven"],
  kessara: ["Kessara", "the Drift", "The Drift"],
  ilun: ["Ilun"],
  vantor: ["Vantor"],
  graveyard: ["the Graveyard", "Graveyard"],
  frontier: ["Tessen"],
  nest: ["the Choir Nest", "Choir Nest", "the Nest", "The Nest"],
};

const PLACE_COLORS = { meridian: "#7fdfff" };

const SPECIES_ALIASES = { synthetic: ["Synthetics", "synthetics"] };

const titled = (person) => [person.title, person.name].filter(Boolean).join(" ");

export const LORE = [
  ...Object.entries(NOTABLES).map(([id, person]) => ({
    id: `person:${id}`,
    name: titled(person),
    kind: "person",
    person: person.name,
    pronouns: person.pronouns,
    aliases: person.aliases,
    color: person.color,
    voiceStyle: person.voice_style,
    text: `${person.role}. ${person.note}`,
  })),
  ...Object.entries(FACTIONS).map(([id, faction]) => ({
    id: `faction:${id}`,
    name: faction.name,
    kind: "faction",
    factionId: id,
    aliases: faction.aliases ?? FACTION_ALIASES[id] ?? [],
    text: faction.desc,
  })),
  ...Object.entries(LOCATIONS).map(([id, place]) => ({
    id: `place:${id}`,
    name: place.name,
    kind: "place",
    placeId: id,
    aliases: [...new Set([...(PLACE_ALIASES[id] ?? []), ...(place.aliases ?? [])])],
    color: PLACE_COLORS[id],
    text: place.desc,
  })),
  ...Object.entries(SPECIES).map(([id, species]) => ({
    id: `people:${id}`,
    name: species.name,
    kind: "people",
    aliases: SPECIES_ALIASES[id] ?? [],
    text: species.desc,
  })),
  ...CONCEPTS.map((concept) => ({ ...concept, id: `concept:${concept.id}`, kind: "concept" })),
  // The fleet's ships, apart from the ones you can go aboard, which are places already.
  ...FLEET_DATA.ships.filter((ship) => !ship.place).map((ship) => ({
    id: `ship:${ship.id}`,
    name: ship.name,
    kind: "ship",
    aliases: ship.aliases ?? [],
    text: `${ship.role} in the fleet. ${ship.class}, under ${ship.captain}. ${ship.note}`,
  })),
];

const staticIndex = buildLoreIndex(LORE);

export const hasStaticLore = (term) => {
  const lower = term.toLowerCase();
  return [...staticIndex.byAlias.keys()].some((alias) => alias.toLowerCase() === lower);
};

// What every captain already knows on the first day.
export const startingLoreIds = () => [
  "concept:concord", "concept:choir", "concept:fall", "concept:beacon", "faction:fleet", "place:meridian",
  ...Object.entries(NOTABLES).filter(([, person]) => person.crew).map(([id]) => `person:${id}`),
];

// Adds anything mentioned in this text to what the player has come across.
export function noteLoreSeen(game, text) {
  for (const id of findLoreIds(text, staticIndex)) {
    if (!game.seenLore.includes(id)) game.seenLore.push(id);
  }
}
