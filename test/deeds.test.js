// Picking pockets and attacking people from the right-click menu: the check and its difficulty, what a clean lift pays,
// what being caught costs, the fight and who fights how, the record, and who's out of sight after a beating.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GAME_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "meridian-deeds-"));

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { mapFor, walkCommand, walkView } = await import("../src/walk.js");
const { afterDeedFight, isWary, pocketDifficulty, settleDeed } = await import("../src/deeds.js");
const { aiSnapshot, publicState } = await import("../src/rules.js");
const { DEEDS, PARLEY } = await import("../src/world.js");
const { ENEMIES, LOCATIONS } = await import("../src/data.js");
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
const personNamed = (game, pattern) => walkView(game).people.find((one) => pattern.test(one.name));
const holderOf = (game, place) => game.world?.places?.[place]?.holder ?? LOCATIONS[place].faction;

test("a pocket is a Stealth check as hard as the person's Awareness, and a clean lift pays and makes them wary", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const voss = personNamed(game, /Voss/);
  assert.ok(voss, "Voss is on the bridge");
  // Her file gives her Awareness 4, which the deeds file makes hard.
  assert.equal(voss.pocket, "Stealth check, hard");
  assert.equal(pocketDifficulty(game, { id: "voss", name: voss.name, asleep: true }), "moderate", "asleep, it's a step easier");
  assert.equal(pocketDifficulty(game, { id: null, name: "Docker Pav" }), "easy");
  assert.equal(pocketDifficulty(game, { id: null, name: "Station Guard Ollo" }), "moderate", "a guard watches for a living");
  const reply = walkCommand(game, { action: "pickpocket", key: voss.key });
  assert.deepEqual(reply, { check: true });
  assert.equal(game.check.skill, "stealth");
  assert.equal(game.check.difficulty, "hard");
  assert.equal(game.check.source, "person", "a check on someone in the room lets the clock run on");
  // The check's over, and it went well.
  const credits = game.credits;
  game.check = null;
  const lines = settleDeed(game, { success: true, reason: "Pick Voss's pocket", training: false });
  const got = game.credits - credits;
  assert.ok(got >= DEEDS.pickpocket.credits.named[0] && got <= DEEDS.pickpocket.credits.named[1], `${got} credits`);
  assert.match(lines[0], new RegExp(`^\\[STEALTH\\] You lift ${got} credits from .*Voss, and they don't notice a thing\\.$`));
  assert.equal(game.personAsked, null);
  assert.ok(isWary(game, "meridian", voss.key));
  assert.equal(personNamed(game, /Voss/).wary, true);
  assert.throws(() => walkCommand(game, { action: "pickpocket", key: voss.key }), /hand on their pocket/);
  assert.ok(game.pendingEvents.some((line) => /picked .*Voss's pocket .* and got \d+ credits\. Nobody noticed/.test(line)));
  assert.equal(game.ship.morale, newGame().ship.morale, "nobody noticed, so nothing's lost");
  // A day later, she's forgotten about it.
  game.clock.hours += DEEDS.pickpocket.wary_hours + 1;
  assert.equal(isWary(game, "meridian", voss.key), false);
});

test("caught with a hand in a pocket: morale on your own ship, standing elsewhere, a soured person, the record, and the alarm under a camera", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const voss = personNamed(game, /Voss/);
  const morale = game.ship.morale;
  walkCommand(game, { action: "pickpocket", key: voss.key });
  game.check = null;
  const lines = settleDeed(game, { success: false, reason: "Pick Voss's pocket", training: false });
  assert.match(lines.join("\n"), /\[STEALTH\] .*Voss catches your hand in their pocket\./);
  assert.match(lines.join("\n"), new RegExp(`\\[SHIP\\] Morale ${DEEDS.pickpocket.caught.morale}: You were caught picking`));
  assert.equal(game.ship.morale, morale + DEEDS.pickpocket.caught.morale);
  assert.match(lines.join("\n"), /\[RELATION\] Ilya Voss: \w+ -> \w+/);
  assert.ok(game.flags.caught_stealing_at_meridian, "it's on the record for the stories");
  // The bridge has a camera, so the alarm rings.
  assert.ok(sys.alarmRinging(game, "meridian"), "the camera saw it");
  assert.match(lines.join("\n"), /\[ALARM\] The alarm is ringing/);
  assert.ok(game.pendingEvents.some((line) => /tried to pick .*Voss's pocket .* and was caught/.test(line)));
  assert.match(game.transcript.at(-1).text, /catches your hand/);

  // At Haven it's the station that thinks less of you.
  const haven = newGame(22);
  haven.clock.hours = 9;
  standIn(haven, "haven", "docks");
  const docker = personNamed(haven, /Docker|Tally Clerk/);
  assert.ok(docker, walkView(haven).people.map((one) => one.name).join(", "));
  const holder = holderOf(haven, "haven");
  const standing = haven.factions[holder];
  walkCommand(haven, { action: "pickpocket", key: docker.key });
  haven.check = null;
  const caught = settleDeed(haven, { success: false, reason: "Pick a pocket", training: false });
  assert.equal(haven.factions[holder], standing + DEEDS.pickpocket.caught.standing);
  assert.match(caught.join("\n"), /\[FACTION\] .* -2: You were caught picking/);
  assert.ok(haven.flags.caught_stealing_at_haven);
});

test("attacking someone with a file starts the fight from their file, sours them, costs, and a beating sends them off for a while", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const voss = personNamed(game, /Voss/);
  const morale = game.ship.morale;
  const reply = walkCommand(game, { action: "attack", key: voss.key });
  assert.equal(reply.combat, true);
  assert.match(reply.said, /^\[COMBAT\] You go for .*Voss\./);
  const enemy = game.combat.enemies[0];
  assert.equal(enemy.id, "voss");
  assert.equal(enemy.named, true);
  assert.equal(game.ship.morale, morale + DEEDS.attack.morale);
  assert.equal(game.contacts.find((one) => one.name === "Ilya Voss").attitude, "hostile");
  assert.ok(game.flags.attacked_voss);
  assert.ok(game.pendingEvents.some((line) => /attacked .*Voss at CFS Meridian, out of nowhere/.test(line)));
  assert.deepEqual(game.deedFight, { place: "meridian", key: voss.key, id: "voss", short: voss.short });
  // The player wins. She's off to get patched up, and back after the deeds file's hours.
  game.combat = null;
  assert.deepEqual(afterDeedFight(game, { over: true, result: "victory" }), [`[COMBAT] ${voss.short} is out of it, and gone to get patched up.`]);
  assert.equal(game.deedFight, null);
  assert.equal(personNamed(game, /Voss/), undefined, "she's not on the bridge");
  game.clock.hours += DEEDS.attack.hurt_hours + 1;
  assert.ok(personNamed(game, /Voss/), "she's back");
  // A fight that wasn't won leaves everyone where they are.
  walkCommand(game, { action: "attack", key: voss.key });
  game.combat = null;
  assert.deepEqual(afterDeedFight(game, { over: true, result: "fled" }), []);
  assert.ok(personNamed(game, /Voss/));
});

test("attacking someone without a file has them fight as the deeds file says, under their own name", () => {
  const game = newGame(23);
  game.clock.hours = 9;
  standIn(game, "haven", "docks");
  const docker = personNamed(game, /Docker|Tally Clerk/);
  const holder = holderOf(game, "haven");
  const standing = game.factions[holder];
  walkCommand(game, { action: "attack", key: docker.key });
  const enemy = game.combat.enemies[0];
  assert.equal(enemy.id, DEEDS.attack.as.anyone);
  assert.equal(enemy.name, docker.name);
  assert.equal(enemy.prose, docker.name, "a name of their own goes without \"the\"");
  assert.equal(enemy.named, false);
  assert.equal(enemy.motive, DEEDS.attack.why.anyone);
  assert.equal(game.factions[holder], standing + DEEDS.attack.standing);
  assert.ok(game.flags.attacked_someone_at_haven);
});

test("the deeds file names enemies that exist, difficulties the checks know and reasons a fight can have", () => {
  for (const id of Object.values(DEEDS.attack.as)) assert.ok(ENEMIES[id], `${id} is an enemy`);
  for (const why of Object.values(DEEDS.attack.why)) assert.ok(PARLEY.motives[why], `${why} is a reason to fight`);
  const ladder = ["easy", "moderate", "hard", "very_hard", "nearly_impossible"];
  for (const level of [DEEDS.pickpocket.anyone, DEEDS.pickpocket.watchful, ...DEEDS.pickpocket.awareness.map(([, one]) => one)]) assert.ok(ladder.includes(level), level);
  for (const range of Object.values(DEEDS.pickpocket.credits)) assert.ok(range[0] <= range[1]);
});

test("showing the game, with its pockets and wary people, changes nothing in the save", () => {
  const game = newGame();
  standIn(game, "meridian", "bridge");
  const before = JSON.stringify(game);
  walkView(game);
  publicState(game);
  aiSnapshot(game);
  assert.equal(JSON.stringify(game), before);
});
