// What a check or a computer is about, for its floating window's line: the room's own checks name their part, door or
// person; a story's check finds whoever or whatever in the room it names; practice is about nothing here; and a computer
// knows what the player sat down at.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-aim-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { publicState } = await import("../src/rules.js");
const { startCheck } = await import("../src/checks.js");
const sys = await import("../src/systems.js");

const newGame = (seed = 21) => createGameFromDraft(randomDraft({ seed, archetype: "officer" }));
// The player stands in a room of a place, as if they'd walked there.
function standIn(game, place, room) {
  game.location = place;
  game.walk = null;
  const map = mapFor(place);
  walkCommand(game, { action: "room", to: map.start });
  game.walk.level = room;
  const level = map.levels[room];
  Object.assign(game.walk, { x: level.start.x, y: level.start.y });
}
const marks = (game) => {
  const view = walkView(game);
  return new Set([...view.people.map((one) => `person:${one.key}`), ...view.things.map((one) => `thing:${one.id}`), ...view.exits.map((one) => `exit:${one.key}`)]);
};
const targetNow = (game) => publicState(game).check?.target ?? null;

test("the room's own checks say what they're about: a part, a pocket, a locked door", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const box = Object.values(sys.systemsOf("meridian").parts).find((part) => part.kind === "junction box" && part.room === "bridge");
  walkCommand(game, { action: "work", key: `part:${box.id}`, how: "break" });
  assert.equal(targetNow(game), `thing:part:${box.id}`);
  assert.ok(marks(game).has(targetNow(game)), "it's one of the room's marks");
  game.check = null;
  game.partAsked = null;
  const voss = walkView(game).people.find((one) => /Voss/.test(one.name));
  walkCommand(game, { action: "pickpocket", key: voss.key });
  assert.equal(targetNow(game), `person:${voss.key}`);
  game.check = null;
  game.personAsked = null;
  // The alarm locks the bridge's doors, and forcing one is about that way out.
  sys.soundAlarm(game, "meridian", "bridge", { by: "story" });
  const exit = walkView(game).exits.find((one) => one.locked);
  walkCommand(game, { action: "work", key: exit.key, how: "force" });
  assert.equal(targetNow(game), `exit:${exit.key}`);
  assert.ok(marks(game).has(targetNow(game)));
});

test("a story's check points at whoever or whatever in the room it names, and practice at nothing", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const voss = walkView(game).people.find((one) => /Voss/.test(one.name));
  startCheck(game, { skill: "medicine", difficulty: "moderate", reason: `Patch up ${voss.short}'s hand`, source: "tool" });
  assert.equal(targetNow(game), `person:${voss.key}`, "healing someone points at them");
  game.check = null;
  startCheck(game, { skill: "persuasion", difficulty: "moderate", audience: "voss", reason: "Talk them round", source: "choice" });
  assert.equal(targetNow(game), `person:${voss.key}`, "a check with someone to win over points at them");
  game.check = null;
  const table = walkView(game).things.find((one) => one.name === "The plot table");
  startCheck(game, { skill: "science", difficulty: "easy", reason: "Read the plot table's drift", source: "tool" });
  assert.equal(targetNow(game), `thing:${table.id}`, "a thing named whole points at it");
  game.check = null;
  startCheck(game, { skill: "medicine", difficulty: "easy", reason: "Patch up someone who isn't here", source: "tool" });
  assert.equal(targetNow(game), null, "nobody here, no line");
  game.check = null;
  startCheck(game, { skill: "medicine", difficulty: "easy", reason: `Practice: Medicine, with ${voss.short} watching`, source: "practice" });
  assert.equal(targetNow(game), null, "practice is about nothing in the room");
});

test("a computer knows what the player sat down at, and a hack's result says what was hacked", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const table = walkView(game).things.find((one) => one.name === "The plot table");
  walkCommand(game, { action: "use", key: table.id });
  assert.ok(game.computer, "the captain sits down at their own plot table");
  assert.equal(publicState(game).computer.at, `thing:${table.id}`);
  assert.ok(marks(game).has(publicState(game).computer.at));
});

test("showing the game with a check's target worked out changes nothing in the save", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  startCheck(game, { skill: "medicine", difficulty: "moderate", reason: "Patch up Voss's hand", source: "tool" });
  const before = JSON.stringify(game);
  publicState(game);
  assert.equal(JSON.stringify(game), before);
});
