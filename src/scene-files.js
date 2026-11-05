// Which stories have a written scene, from the file names alone, for the parts of the game that only
// need to know that much. src/scenes.js reads the files themselves.

import fs from "node:fs";
import path from "node:path";
import { worldDir } from "./paths.js";

const dir = path.join(worldDir, "scenes");

// The ids of the stories in world/stories that have a scene called thread_<id>.
export function writtenThreadIds() {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).map((name) => name.match(/^thread_(.+)\.(txt|json)$/)?.[1]).filter(Boolean));
}
