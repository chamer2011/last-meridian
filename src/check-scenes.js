// Checks every written scene in world/scenes and every story in world/stories, and says what's wrong, in plain
// words, with the line.
//   npm run check-story
// It reads the files and changes nothing. The game doesn't need to be running. Another scenes folder can be
// named after the command, for checking scenes kept somewhere else.

import { allStoryProblems, SCENES_DIR } from "./scenes.js";

const dir = process.argv[2] ?? SCENES_DIR;
const { count, stories, problems } = allStoryProblems(dir);
if (!problems.length) {
  console.log(`All ${count} ${count === 1 ? "scene is" : "scenes are"} sound, and so are the notes of ${stories} stories.`);
} else {
  console.log(`${problems.length} ${problems.length === 1 ? "problem" : "problems"} in ${dir} and world\\stories:\n`);
  for (const problem of problems) console.log(`- ${problem}`);
  console.log("\nFix these and run it again. The how-tos are world\\scenes\\_how-to-write-a-scene.txt and world\\stories\\_how-to-write-a-story.txt.");
  process.exit(1);
}
