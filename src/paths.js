// Where the game keeps its files.
//   world/                  characters and enemies that come with the game
//   data/saves/             your saved games
//   data/campaigns/<name>/  people and enemies added while playing one campaign, and your captain's sheet

import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const worldDir = path.join(projectDir, "world");

// Worked out each time, so the tests can point the game at a temporary folder.
export const dataDir = () => process.env.GAME_DATA_DIR || path.join(projectDir, "data");
