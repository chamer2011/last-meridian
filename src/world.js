// Loads the world's files from disk. You can edit these files, or add new ones, and
// the game picks them up the next time it starts. A file's name is that person's id.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";
import { parseStoryText } from "../public/story-text.js";
import { ENEMY, FACTION, ITEM, PERK, PERSON, PLACE, SPECIES_SPEC, parseWorldText } from "../public/world-text.js";

// A file with a mistake in it is skipped, so one typo can't stop the whole game.
export function readFolder(folder) {
  const files = {};
  if (!fs.existsSync(folder)) return files;
  for (const name of fs.readdirSync(folder).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(folder, name);
    try {
      files[name.slice(0, -".json".length)] = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`Skipping ${file}, because it can't be read: ${err.message}`);
    }
  }
  return files;
}

// The same, for a file that holds a whole list of things.
function readFile(name) {
  const file = path.join(worldDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`Skipping ${file}, because it can't be read: ${err.message}`);
    return {};
  }
}

// The people, places and species are plain-text files too, read by public/world-text.js, and read again when the
// story board saves one. Tests point the folders at copies.
export const PEOPLE_DIR = process.env.GAME_PEOPLE_DIR ?? path.join(worldDir, "characters");
export const PLACES_DIR = process.env.GAME_PLACES_DIR ?? path.join(worldDir, "places");
export const SPECIES_DIR = process.env.GAME_SPECIES_DIR ?? path.join(worldDir, "species");
export const ENEMIES_DIR = process.env.GAME_ENEMIES_DIR ?? path.join(worldDir, "enemies");
export const ITEMS_DIR = process.env.GAME_ITEMS_DIR ?? path.join(worldDir, "items");
export const FACTIONS_DIR = process.env.GAME_FACTIONS_DIR ?? path.join(worldDir, "factions");
export const PERKS_DIR = process.env.GAME_PERKS_DIR ?? path.join(worldDir, "perks");
export const WORLD_CHARACTERS = {};
export const WORLD_PLACES = {};
export const WORLD_SPECIES = {};
export const WORLD_ENEMIES = {};
export const WORLD_ITEMS = {};
export const WORLD_FACTIONS = {};
export const WORLD_PERKS = {};
export const WORLD_FILE_PROBLEMS = [];
function readTextFolder(dir, spec, into, folder) {
  for (const key of Object.keys(into)) delete into[key];
  if (!fs.existsSync(dir)) return;
  const read = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const id = name.slice(0, -".txt".length);
    const { value, problems } = parseWorldText(fs.readFileSync(path.join(dir, name), "utf8"), spec, id);
    for (const one of problems) WORLD_FILE_PROBLEMS.push(`${folder}/${name}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
    read.push([id, value]);
  }
  // Files with an order line keep that order, which is the order the game shows them in; the rest come by name.
  if (read.some(([, value]) => value.order !== undefined)) read.sort((a, b) => (a[1].order ?? 999) - (b[1].order ?? 999) || a[0].localeCompare(b[0]));
  for (const [id, value] of read) into[id] = value;
}
export function reloadWorld() {
  WORLD_FILE_PROBLEMS.splice(0);
  readTextFolder(PEOPLE_DIR, PERSON, WORLD_CHARACTERS, "characters");
  readTextFolder(PLACES_DIR, PLACE, WORLD_PLACES, "places");
  readTextFolder(SPECIES_DIR, SPECIES_SPEC, WORLD_SPECIES, "species");
  readTextFolder(ENEMIES_DIR, ENEMY, WORLD_ENEMIES, "enemies");
  readTextFolder(ITEMS_DIR, ITEM, WORLD_ITEMS, "items");
  readTextFolder(FACTIONS_DIR, FACTION, WORLD_FACTIONS, "factions");
  readTextFolder(PERKS_DIR, PERK, WORLD_PERKS, "perks");
}
reloadWorld();
// The stories are plain-text files in world/stories, read by public/story-text.js into the shape the game uses, and
// read again when the story board saves one: the objects below are filled in place, so nothing needs a restart.
// Tests point this at a copy, so they can save stories without touching the real ones.
export const STORIES_DIR = process.env.GAME_STORIES_DIR ?? path.join(worldDir, "stories");
export const WORLD_THREADS = {};
export const STORY_FILE_PROBLEMS = [];
export const WORLD_MAPS = readFolder(path.join(worldDir, "maps"));

// A story's endings by name. An outcome written as a plain string gets its number for a name.
export const endingsOf = (thread) => (thread?.gm?.outcomes ?? []).map((outcome, i) => (typeof outcome === "string" ? { id: `ending_${i + 1}`, text: outcome } : outcome));

// The plain words a story's notes give a fact, by its name: the record uses them for a fact a scene leaves without words.
export const FACT_LINES = {};
export const WORLD_LIFE = readFolder(path.join(worldDir, "life"));
// The written scenes aren't here: src/scenes.js reads them whenever the story needs them, so a change shows up without a restart.



export const WORLD_ARC = readFile("arc.json");
export const FLEET_EVENTS = readFile("fleet-events.json");
export const DAILY = readFile("daily.json");
export const STORY_CLOCK = { ...readFile("story-clock.json"), threads: {} };
export const STARTS = readFile("starts.json");
export const CHECK_TEXT = readFile("checks.json");
export const ROOM_KINDS = readFile("rooms.json").kinds ?? {};
export const ROOM_TALK = readFile("rooms.json").talk ?? {};
// The game can't run without these, so a mistake in one gets a plain explanation.
function readRequired(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(worldDir, name), "utf8"));
  } catch (err) {
    console.error(`\nThe game can't start, because world\\${name} has a mistake in it:\n  ${err.message}\nUndo your last change to that file, then start the game again.\n`);
    process.exit(1);
  }
}

export const COMBAT_TEXT = readRequired("combat-text.json");
export const COMBAT_ART = readRequired("art.json");
export const PARLEY = readRequired("parley.json");
export const LOOKS = readRequired("looks.json");
export const FLEET_DATA = readRequired("fleet.json");
export const STAR_MAP = readRequired("starmap.json");

// Reads every story file. A file with a problem is still read as far as it goes, so one mistake can't stop the
// game, and the problem is kept for the checker.
export function reloadStories() {
  for (const key of Object.keys(WORLD_THREADS)) delete WORLD_THREADS[key];
  for (const key of Object.keys(STORY_CLOCK.threads)) delete STORY_CLOCK.threads[key];
  for (const key of Object.keys(FACT_LINES)) delete FACT_LINES[key];
  STORY_FILE_PROBLEMS.splice(0);
  if (!fs.existsSync(STORIES_DIR)) return;
  for (const name of fs.readdirSync(STORIES_DIR).sort()) {
    if (!name.endsWith(".txt") || name.startsWith("_")) continue;
    const id = name.slice(0, -".txt".length);
    const { story, clock, problems } = parseStoryText(fs.readFileSync(path.join(STORIES_DIR, name), "utf8"), id);
    for (const one of problems) STORY_FILE_PROBLEMS.push(`stories/${name}${one.line ? ` (line ${one.line})` : ""}: ${one.message}`);
    WORLD_THREADS[id] = story;
    STORY_CLOCK.threads[id] = clock;
    Object.assign(FACT_LINES, story.gm?.facts ?? {});
  }
}
reloadStories();
