// Brings saved games from older versions of the game up to date, so they keep working.

import { createHash } from "node:crypto";
import { slugify } from "./campaign.js";
import { ENEMIES, LOCATIONS, STARTING_FACTIONS } from "./data.js";
import { newWorld } from "./daily.js";
import { newFleet, syncFleetShips } from "./fleet.js";
import { noteLoreSeen, startingLoreIds } from "./lore.js";
import { crewContacts, maxEnergy, maxHp } from "./rules.js";
import { emptyStory } from "./story-library.js";
import { walkFromOnePlan, walkFromStory } from "./walk.js";

// What each original background becomes under the deeper character system.
const LEGACY_BACKGROUNDS = {
  officer: { background: "Lieutenant, Concord Navy", career: "navy", name: "Concord Navy", rankTitle: "Lieutenant", upbringing: "service", skills: { tactics: 3, leadership: 3, piloting: 2, firearms: 2, gunnery: 1 }, tags: ["tactics", "leadership", "piloting"], ideology: { authority: -3, loyalty: -2 } },
  smuggler: { background: "Runner, Free Trader", career: "smuggler", name: "Free Trader", rankTitle: "Runner", upbringing: "undercity", skills: { piloting: 3, deception: 3, streetwise: 2, firearms: 2, commerce: 1 }, tags: ["piloting", "deception", "streetwise"], ideology: { authority: 3, loyalty: 2 } },
  adept: { background: "Listener, Order of Ilun", career: "adept", name: "Order of Ilun", rankTitle: "Listener", upbringing: "devout", skills: { attunement: 3, manifestation: 3, composure: 2, melee: 2, lore: 1 }, tags: ["attunement", "manifestation", "composure"], ideology: { belief: 4, violence: -2 } },
  engineer: { background: "Salvage Tech, Salvage Guild", career: "engineer", name: "Salvage Guild", rankTitle: "Salvage Tech", upbringing: "dockside", skills: { engineering: 3, void_ops: 2, hacking: 2, science: 2, firearms: 1 }, tags: ["engineering", "hacking", "void_ops"], ideology: { belief: -3, flesh: 2 } },
  envoy: { background: "Consular Officer, Diplomatic Corps", career: "envoy", name: "Diplomatic Corps", rankTitle: "Consular Officer", upbringing: "privilege", skills: { persuasion: 3, deception: 2, lore: 2, leadership: 2, firearms: 1 }, tags: ["persuasion", "lore", "deception"], ideology: { violence: -3, loyalty: -1 } },
};

function fromVersion1(save) {
  const legacy = LEGACY_BACKGROUNDS[save.background] ?? LEGACY_BACKGROUNDS.officer;
  const ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0, ...legacy.ideology };
  const known = new Set((save.contacts ?? []).map((c) => c.name.toLowerCase()));

  const migrated = {
    ...save,
    version: 2,
    character: {
      callsign: "",
      pronouns: "they/them",
      appearance: "",
      species: "human",
      homeworld: "aurelis",
      upbringing: legacy.upbringing,
      drive: "protect",
      bond: null,
      age: 30,
      background: legacy.background,
      careers: [{ career: legacy.career, name: legacy.name, terms: 2, rankTitle: legacy.rankTitle }],
      biography: [`Served in the ${legacy.name} before the Fall of the Concord, and was left in command of the Meridian when everyone above them died.`],
      hooks: [],
      learning: 1,
      legacy: true,
    },
    stats: { might: 3, endurance: 3, agility: 3, perception: 3, intellect: 3, willpower: 3, presence: 3, resonance: 1, ...save.stats },
    skills: legacy.skills,
    skillXp: {},
    skillPoints: 0,
    tags: legacy.tags,
    traits: [],
    ideology,
    needs: { stress: 15, fatigue: 10 },
    conditions: [],
    clock: { hours: 8 },
    contacts: [...crewContacts(ideology).filter((c) => !known.has(c.name.toLowerCase())), ...(save.contacts ?? [])],
    // The AI restarts from a recap, so that it picks up the new character details.
    ai: { provider: null, messages: [] },
  };
  delete migrated.background;
  // Health and energy are worked out differently now, so old values may no longer fit.
  migrated.hp = Math.min(migrated.hp, maxHp(migrated));
  migrated.energy = Math.min(migrated.energy, maxEnergy(migrated));
  return migrated;
}

// Version 3 added the codex.
function fromVersion2(save) {
  const migrated = { ...save, version: 3, lore: [], seenLore: startingLoreIds() };
  for (const entry of migrated.transcript) {
    if (entry.role === "narrator") noteLoreSeen(migrated, entry.text);
  }
  return migrated;
}

// Version 4 moved characters and enemies into local files, and made fights fully local.
function fromVersion3(save) {
  // The same campaign gets the same folder, whichever saved copy of it is loaded first.
  const fingerprint = createHash("sha256").update(JSON.stringify([save.name, save.character?.age, save.character?.biography])).digest("hex").slice(0, 8);
  const known = new Set(save.contacts.map((c) => c.name.toLowerCase()));
  return {
    ...save,
    version: 4,
    campaign: `${slugify(save.name) || "captain"}-${fingerprint}`,
    bestiary: {},
    pendingEvents: [],
    contacts: [
      // An earlier version gave away Commander Voss's secret in her description.
      ...save.contacts.map((c) => (c.note?.includes("hiding something about the Choir")
        ? { ...c, note: "Commander Ilya Voss. Your XO. Blunt and loyal, and doesn't talk about how she got out of the Fall." }
        : c)),
      // The crew has grown since older saves were made.
      ...crewContacts(save.ideology).filter((c) => !known.has(c.name.toLowerCase())),
    ],
    combat: save.combat
      ? { ...save.combat, guard: 0, training: false, enemy: { ...ENEMIES[save.combat.enemyId], ...save.combat.enemy } }
      : null,
  };
}

// Version 5 gave fights two sides, each of which can have several fighters.
function fromVersion4(save) {
  const old = save.combat;
  if (!old) return { ...save, version: 5 };
  const enemy = old.enemy;
  const type = ENEMIES[old.enemyId];
  // The fight's lines no longer go in the story, and a simulated fight never leaves any behind.
  const transcript = old.training && old.transcriptStart !== undefined ? save.transcript.slice(0, old.transcriptStart) : save.transcript;
  return {
    ...save,
    version: 5,
    transcript,
    combat: {
      id: Date.now(),
      round: old.round,
      guard: 0,
      survivorUsed: Boolean(old.survivorUsed),
      training: Boolean(old.training),
      nextKey: 1,
      allies: [],
      enemies: [{
        ...type,
        ...enemy,
        key: "e0",
        id: old.enemyId,
        base: enemy.name,
        prose: enemy.named ? enemy.shortName ?? enemy.name : `the ${enemy.name}`,
        maxHp: enemy.maxHp ?? type?.hp ?? enemy.hp,
        tags: enemy.tags ?? type?.tags ?? [],
        xp: enemy.xp ?? type?.xp ?? 0,
        credits: enemy.credits ?? type?.credits ?? [0, 0],
        stunned: Boolean(old.stunned),
      }],
      arrivals: [],
      notes: [],
      leadIn: null,
      intro: old.intro ?? null,
      ...(old.snapshot ? { snapshot: old.snapshot } : {}),
    },
  };
}

// Version 6 added skill check windows, more factions, and story threads.
function fromVersion5(save) {
  return {
    ...save,
    version: 6,
    check: null,
    story: emptyStory(),
    factions: { ...STARTING_FACTIONS, ...save.factions },
  };
}

// Version 7 gave the fleet real ships, supplies that run out, and the Choir on its trail. The
// clock starts from now: nobody pays for the days that went by before this save knew about them.
function fromVersion6(save) {
  return {
    ...save,
    version: 7,
    fleet: newFleet(save),
    transcript: [...(save.transcript ?? []), { role: "notice", text: "[FLEET] The fleet is now 41 real ships, with food, fuel, medicine and parts that run out, and the Choir on its trail. The new Fleet menu and Star map show it all." }],
  };
}

// Version 8 gave the captain a place on the deck plan, and a way to talk to whoever's there.
function fromVersion7(save) {
  return { ...save, version: 8, talk: null, walk: null };
}

// Version 9 made each room its own level, so the captain's place is now a room and a spot in it.
function fromVersion8(save) {
  return { ...save, version: 9, walk: walkFromOnePlan(save) };
}

// Version 10 gave every place a map, so a captain who's away from the Meridian needs a place on it.
function fromVersion9(save) {
  const walk = save.walk ?? walkFromStory(save);
  return { ...save, version: 10, opened: save.opened ?? {}, walk };
}

// Version 11 gave people their own days. Everyone just starts from wherever this time of day finds them.
function fromVersion10(save) {
  return { ...save, version: 11, life: null };
}

// Version 14 let the player be anyone. Everyone who's already playing is the captain, and stays that way.
function fromVersion13(save) {
  return { ...save, version: 14, role: { id: "captain", captain: true } };
}

// Version 13 set the stories moving by themselves. Their clocks start from now, so nothing happens all at once.
function fromVersion12(save) {
  const day = Math.floor(save.clock.hours / 24);
  return { ...save, version: 13, story: { ...save.story, act: save.story?.act ?? 1, clock: { day, start: day, threads: {}, act: null, moved: [] } } };
}

// Version 12 gave every place its own supplies, prices and factions. They start from now, as they stand in the world's files.
function fromVersion11(save) {
  return { ...save, version: 12, world: newWorld(save) };
}

export function migrateGame(save) {
  if (!save) return save;
  let game = save;
  if ((game.version ?? 1) < 2) game = fromVersion1(game);
  if (game.version < 3) game = fromVersion2(game);
  if (game.version < 4) game = fromVersion3(game);
  if (game.version < 5) game = fromVersion4(game);
  if (game.version < 6) game = fromVersion5(game);
  if (game.version < 7) game = fromVersion6(game);
  if (game.version < 8) game = fromVersion7(game);
  if (game.version < 9) game = fromVersion8(game);
  if (game.version < 10) game = fromVersion9(game);
  if (game.version < 11) game = fromVersion10(game);
  if (game.version < 12) game = fromVersion11(game);
  if (game.version < 13) game = fromVersion12(game);
  if (game.version < 14) game = fromVersion13(game);
  // A place that's gone from the world's files can't hold anyone, and factions added since this save was made need a standing.
  if (!LOCATIONS[game.location]) game.location = "meridian";
  game.factions ??= {};
  for (const [id, start] of Object.entries(STARTING_FACTIONS)) game.factions[id] ??= start;
  syncFleetShips(game);
  return game;
}
