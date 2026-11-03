// Loads the world's files from disk. You can edit these files, or add new ones, and
// the game picks them up the next time it starts. A file's name is that person's id.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";

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

export const WORLD_CHARACTERS = readFolder(path.join(worldDir, "characters"));
export const WORLD_ENEMIES = readFolder(path.join(worldDir, "enemies"));
export const WORLD_PLACES = readFolder(path.join(worldDir, "places"));
export const WORLD_THREADS = readFolder(path.join(worldDir, "threads"));
export const WORLD_MAPS = readFolder(path.join(worldDir, "maps"));
export const WORLD_LIFE = readFolder(path.join(worldDir, "life"));
// The written scenes aren't here: src/scenes.js reads them whenever the story needs them, so a change shows up without a restart.
export const WORLD_ITEMS = readFile("items.json");
export const WORLD_PERKS = readFile("perks.json");
export const WORLD_FACTIONS = readFile("factions.json");
export const WORLD_ARC = readFile("arc.json");
export const FLEET_EVENTS = readFile("fleet-events.json");
export const DAILY = readFile("daily.json");
export const STORY_CLOCK = readFile("story-clock.json");
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
