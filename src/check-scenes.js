// Checks every written scene in world/scenes and says what's wrong, in plain words, with the line.
//   npm run check-story
// It reads the files and changes nothing. The game doesn't need to be running. Another folder can be
// named after the command, for checking scenes kept somewhere else.

import { allSceneProblems, SCENES_DIR } from "./scenes.js";

const dir = process.argv[2] ?? SCENES_DIR;
const { count, problems } = allSceneProblems(dir);
if (!problems.length) {
  console.log(`All ${count} ${count === 1 ? "scene is" : "scenes are"} sound.`);
} else {
  console.log(`${problems.length} ${problems.length === 1 ? "problem" : "problems"} in ${dir}:\n`);
  for (const problem of problems) console.log(`- ${problem}`);
  console.log("\nFix these and run it again. The how-to is in world\\scenes\\_how-to-write-a-scene.txt.");
  process.exit(1);
}
