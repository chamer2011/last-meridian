// All the game's world content lives here. You can safely edit names, prices and
// descriptions in this file without touching the rules. Characters are in character-data.js,
// and each important person and enemy has their own file in the world folder.

import { WORLD_ENEMIES, WORLD_FACTIONS, WORLD_ITEMS, WORLD_PERKS, WORLD_PLACES } from "./world.js";

export const STATS = {
  might: "Might",
  endurance: "Endurance",
  agility: "Agility",
  perception: "Perception",
  intellect: "Intellect",
  willpower: "Willpower",
  presence: "Presence",
  resonance: "Resonance",
};

export const STAT_INFO = {
  might: "Raw strength. Melee, athletics and a little extra health.",
  endurance: "Toughness. The main source of health. Void ops and survival.",
  agility: "Speed and coordination. Firearms, piloting, stealth and defense.",
  perception: "Noticing things. Awareness, gunnery, streetwise and long rifles.",
  intellect: "Reasoning. Technical skills and tactics. Earns extra skill points.",
  willpower: "Mental strength. Composure, and a bigger pool of energy.",
  presence: "Force of personality. All the social skills.",
  resonance: "Sensitivity to the field the First Builders left behind. Rare and feared.",
};

// The items are files in world/items, read by src/world.js: weapons (damage is min to max, and stat and skill both add
// to the attack roll), armor, consumables, gadgets and story items.
export const ITEMS = WORLD_ITEMS;

// The perks are files in world/perks, read by src/world.js. The abilities some of them give are below.
export const PERKS = WORLD_PERKS;

export const ABILITIES = {
  field_patch: { name: "Field Patch", energy: 3 },
  overcharged_shot: { name: "Overcharged Shot", energy: 3 },
  evade: { name: "Evade", energy: 2 },
  push: { name: "Resonant Push", energy: 4 },
  spike: { name: "System Spike", energy: 3 },
  foresight: { name: "Foresight", energy: 3 },
  glare: { name: "Terrifying Glare", energy: 2 },
  rally: { name: "Rally", energy: 3 },
};

// Each type of enemy has a file in world/enemies, with its stats and the lines used in fights.
export const ENEMIES = WORLD_ENEMIES;

// Each place can also have a file in world/places, with what the game master needs to run it.
const BASE_LOCATIONS = {
  meridian: { name: "CFS Meridian", desc: "Your battered frigate and the flagship of what's left. Medbay, mess hall, one working cannon.", market: [], rest: true, fleet: true },
  haven: { name: "Haven Station", desc: "A neutral trade hub where every faction drinks in the same bar and pretends not to notice.", market: ["medkit", "stim", "energy_cell", "repair_kit", "fuel_cell", "sidearm", "heavy_carbine", "flak_vest", "marine_plate", "forged_papers", "lockbreaker", "data_chip"] },
  kessara: { name: "Kessara Drift", desc: "A lawless asteroid warren of smugglers, raiders and very good noodle stalls.", market: ["stim", "energy_cell", "fuel_cell", "needle_rifle", "smugglers_coat", "ghostweave", "lockbreaker", "forged_papers"] },
  ilun: { name: "Ruins of Ilun", desc: "A silent monastery world, carved by the First Builders. The stones hum at night.", market: [] },
  vantor: { name: "Vantor Prime", desc: "Capital of the Hegemony: gleaming towers, surveillance, and a very polite secret police.", market: ["medkit", "energy_cell", "repair_kit", "marine_plate", "heavy_carbine"] },
  graveyard: { name: "The Graveyard", desc: "The wreckage of the Concord's last battle, drifting in silence. Full of salvage and ghosts.", market: [] },
  frontier: { name: "Tessen Colony", desc: "A struggling farm colony beyond patrol range. They have food, and they have a problem.", market: ["medkit", "fuel_cell", "flak_vest"] },
  nest: { name: "The Choir Nest", desc: "A dead star wrapped in silver machinery. Nobody has come back from here. Yet.", market: [], dangerous: true },
};

export const LOCATIONS = {};
// Filled in place, so that a place saved from the story board shows at once wherever the game looks places up.
export function refreshLocations() {
  for (const key of Object.keys(LOCATIONS)) delete LOCATIONS[key];
  for (const id of new Set([...Object.keys(BASE_LOCATIONS), ...Object.keys(WORLD_PLACES)])) LOCATIONS[id] = { market: [], ...BASE_LOCATIONS[id], ...WORLD_PLACES[id] };
}
refreshLocations();

// The ones every captain already knows about. The rest come up as the story goes on.
export const CORE_FACTIONS = ["fleet", "hegemony", "drift", "ilun"];

// The factions are files in world/factions, read by src/world.js.
export const FACTIONS = WORLD_FACTIONS;

export const STARTING_FACTIONS = {};
// Filled in place, so a faction saved from the story board counts at once.
export function refreshFactions() {
  for (const key of Object.keys(STARTING_FACTIONS)) delete STARTING_FACTIONS[key];
  for (const [id, faction] of Object.entries(WORLD_FACTIONS)) STARTING_FACTIONS[id] = faction.start ?? 0;
}
refreshFactions();

export const STARTING_QUESTS = [
  {
    id: "the_beacon",
    title: "The Beacon",
    main: true,
    status: "active",
    desc: "The Meridian received a signal from beyond known space, promising a safe harbor from the Choir. Find where it comes from.",
    objective: "Find someone who can decode the signal. Haven Station is the obvious place to start.",
  },
  {
    id: "fuel_for_the_fleet",
    title: "Fuel for the Fleet",
    main: false,
    status: "active",
    desc: "The fleet has about two weeks of fuel left. Someone at Haven or Kessara must be selling.",
    objective: "Secure a fuel supplier for the fleet.",
  },
];

export const WORLD_BIBLE = `SETTING: THE LAST MERIDIAN
Tone: hopeful exploration, swashbuckling adventure, and desperate survival, all in one original galaxy. Think thoughtful diplomacy on the bridge, scoundrels in cantinas, mystical powers, and a ragtag fleet hunted by machines. This is an ORIGINAL universe. Never use names, characters, ships or terms from existing franchises.

BACKSTORY: Six months ago the Concord, a peaceful interstellar republic, fell in a single week to the Choir: silver machines that sing to one another across space and copy the faces of the people they kill. Nobody knows who built them. The survivors formed the Refugee Fleet: 41 ships and 30,000 people, led by the frigate CFS Meridian. Its newly appointed captain has the job because everyone above them is dead. The player may be that captain, or anyone else in the galaxy: the <player_dossier> says who they are.

PEOPLES: The Concord was home to humans and to several other peoples. Korrun are broad heavy-worlders who prize plain speech. Veshti are long-limbed spacers who dislike planets. Ilari are empaths whose skin shows their feelings in patterns of light. Thessan are cold-blooded, long-lived archivists. Synthetics are free machine people, citizens under Concord law, and since the Fall they're feared and hated by many survivors.

FACTIONS:
- Refugee Fleet: exhausted, frightened and arguing. Admiral-in-all-but-name is the Meridian's captain. XO Commander Ilya Voss is loyal, blunt and hides a Choir-related secret. Chief Engineer Dunn Marrow keeps the ship running through profanity. Dr. Sen Aduro, the chief medical officer, is the ship's exhausted conscience. Lt. Kara Tarrow, the chief of security, wants every machine in the galaxy destroyed.
- The Hegemony: an authoritarian empire at Vantor Prime led by the Serene Regent. It offers refugees protection in exchange for conscription, and hunts Resonants through its Inquisitors.
- Kessara Syndicate: pirates and smugglers led by the charming and treacherous Mother Quill.
- Order of Ilun: nearly extinct monks led by Abbess Ione who study Resonance, the faint field left behind by the vanished First Builders. Resonants can feel it and bend it: sensing minds, pushing objects, glimpsing what's coming. It always has a price.

THE MYSTERY (do not reveal early; let the player uncover it over many sessions): The Beacon promises a safe harbor, but it is a First Builder warning light, not an invitation. The First Builders made the Choir as guardians against something older, and then vanished. The Choir's song is a failing attempt to keep that thing asleep, and it copies the dead because it is trying to preserve minds. The final choice will be whether to destroy the Choir, join it, or fix it, and it falls to whoever gets that far.`;
