// Act 1 written out: Two Weeks of Fuel, Visiting Hours and the council, each with its sides for other lives, and
// the act moving on when both stories are settled. None of this calls an AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-act1-"));
process.env.GAME_DATA_DIR = dataDir;

const { createGameFromDraft, randomDraft } = await import("../src/creator.js");
const { attr, maxHp, publicState, skillRank } = await import("../src/rules.js");
const { conditionHolds, parseEffect } = await import("../src/scene-text.js");
const { loadScenes, writtenTurn } = await import("../src/scenes.js");
const { leadsHere } = await import("../src/story-library.js");
const { openWrittenTalk, writtenTalkTurn } = await import("../src/talks.js");
const { newTurnLimits, runTool } = await import("../src/tools.js");
const { talkCommand, talkHeard, talkSaid, talkView } = await import("../src/walk.js");
const { WORLD_THREADS, STORY_CLOCK } = await import("../src/world.js");

const HELPERS = { attr, skillRank, maxHp };
const FUEL = "main_two_weeks_of_fuel";
const VISITING = "main_visiting_hours";
const COUNCIL = "main_the_council";

const newGame = (start = "captain", seed = 21) => {
  const draft = randomDraft({ seed, archetype: "officer" });
  draft.start = start;
  const game = createGameFromDraft(draft);
  game.mode = "written";
  return game;
};

// Plays one turn the way the server does: what the story says goes in the transcript after the turn, in order.
function play(game, args, scenes) {
  const pieces = [];
  const emit = (e) => {
    if (e.type === "state") return;
    const last = pieces.at(-1);
    if (e.type === "text" && last?.role === "narrator") last.text += e.text;
    else pieces.push({ role: e.type === "text" ? "narrator" : "notice", text: e.text });
  };
  writtenTurn({ game, emit, log: (role, text) => game.transcript.push({ role, text }), scenes, ...args });
  for (const piece of pieces) game.transcript.push(piece);
  return pieces.filter((piece) => piece.role === "narrator").map((piece) => piece.text).join("\n");
}
const take = (game, id) => play(game, { playerText: "I look into this", threadId: id });

// Settles the check that's open, without the dice, the way its window would.
function settleCheck(game, success) {
  assert.ok(game.check, "a check is open");
  game.lastCheck = { id: game.check.id, skill: game.check.skill, difficulty: game.check.difficulty, success, reason: game.check.reason, source: game.check.source, used: false };
  game.check = null;
  game.pendingEvents.push("The check is done.");
}
// Ends the fight that's on, the way the fight window would.
function endFight(game, result) {
  assert.ok(game.combat, "a fight is on");
  game.combat = null;
  game.lastFight = { result, enemies: ["drift_raider"], summary: "It ended.", used: false };
  game.pendingEvents.push("The fight is over.");
}
// A check from the list, then the story carrying on from how it came out.
function checkThen(game, words, success) {
  play(game, { playerText: words });
  settleCheck(game, success);
  play(game, { event: "continue" });
}
const quest = (game, id) => game.quests.find((one) => one.id === id);
const contact = (game, pattern) => game.contacts.find((one) => pattern.test(one.name));
const roomNow = (game) => publicState(game).walk.here.name;

// ---- The engine's new pieces ----------------------------------------------------------

test("the written story can move the act and fill the tanks, and a part can wait for the fleet to arrive", () => {
  assert.deepEqual(parseEffect("act 2").do, { tool: "update_story", act: 2 });
  assert.match(parseEffect("act two").problem, /act needs/);
  assert.deepEqual(parseEffect("fuel 6: Quill's depot").do, { tool: "change_ship", hull: 0, fuel: 6, morale: 0, reason: "Quill's depot" });
  assert.match(parseEffect("fuel: nothing").problem, /fuel needs/);
  const game = newGame();
  assert.equal(conditionHolds(game, "act < 2", HELPERS), true);
  assert.equal(conditionHolds(game, "act >= 2", HELPERS), false);
  game.story.act = 2;
  assert.equal(conditionHolds(game, "act >= 2 and not act > 2", HELPERS), true);

  // A part that waits: its rules are read again when the player continues, and its effects run once.
  const scenes = { thread_wait: { title: "Wait", start: "here", parts: {
    here: { text: ["Set course for Kessara, and press Continue when you're there."], when: [{ if: "at kessara", to: "there" }], choices: [{ say: "Stay a while", to: "here" }] },
    there: { text: ["You're there."], do: [{ tool: "award_xp", amount: 5, reason: "Arrived" }], end: true },
  } } };
  const waiting = newGame("captain", 22);
  const xp = waiting.xp;
  play(waiting, { playerText: "I look into this", threadId: "wait" }, scenes);
  assert.equal(waiting.scene.part, "here");
  const still = play(waiting, { event: "continue" }, scenes);
  assert.equal(waiting.scene.part, "here", "nothing has changed, so the story stays");
  assert.doesNotMatch(still, /You're there/);
  waiting.location = "kessara";
  waiting.pendingEvents.push("The fleet jumped.");
  const arrived = play(waiting, { event: "continue" }, scenes);
  assert.match(arrived, /You're there/);
  assert.equal(waiting.scene, null);
  assert.equal(waiting.xp, xp + 5);
});

test("the council story is in the world, with a clock, after the Warm Room, and for the captain only", () => {
  assert.equal(WORLD_THREADS[COUNCIL].after, "main_the_old_scholar");
  assert.equal(WORLD_THREADS[COUNCIL].anyone, undefined);
  assert.ok(STORY_CLOCK.threads[COUNCIL].stages.length >= 2);
  const game = newGame();
  game.location = "haven";
  assert.ok(!leadsHere(game).some((lead) => lead.id === COUNCIL), "not before the Warm Room");
  game.story.threads.main_the_old_scholar = "done";
  const lead = leadsHere(game).find((one) => one.id === COUNCIL);
  assert.ok(lead, "after it, the council asks");
  assert.equal(lead.written, true);
  const hand = newGame("docker");
  hand.location = "haven";
  hand.story.threads.main_the_old_scholar = "done";
  assert.ok(!leadsHere(hand).some((one) => one.id === COUNCIL), "a dock hand isn't asked where the fleet's going");
});

// ---- Two Weeks of Fuel ----------------------------------------------------------------

test("the fuel: the captain finds days with Marrow, jumps to Kessara, limits Quill's markers in writing, and signs", () => {
  const game = newGame();
  game.location = "haven";
  const opening = take(game, FUEL);
  assert.match(opening, /Fourteen days if nobody jumps/);
  assert.equal(game.scene.part, "start");
  assert.ok(quest(game, FUEL));
  const fuel = game.ship.fuel;
  checkThen(game, "Sit down with Marrow", true);
  assert.equal(game.scene.part, "cold_pass");
  assert.equal(game.ship.fuel, fuel + 2, "four days, found");
  assert.ok(game.flags.cold_burn);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "hub");
  const waiting = play(game, { playerText: "Accept Mother Quill's invitation" });
  assert.equal(game.scene.part, "to_kessara");
  assert.match(waiting, /Set course for Kessara Drift/);
  // The jump is the star map's. Here it's done by hand, and the story goes on when the player continues.
  game.location = "kessara";
  game.walk = null;
  game.pendingEvents.push("On the captain's order, the fleet jumped to Kessara Drift.");
  const parlor = play(game, { event: "continue" });
  assert.equal(game.scene.part, "parlor");
  assert.match(parlor, /@Mother Quill/);
  assert.equal(roomNow(game), "Quill's Parlor");
  checkThen(game, "Put a limit on the markers", true);
  assert.equal(game.scene.part, "limited");
  assert.ok(game.flags.markers_limited);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "parlor_again");
  const signed = play(game, { playerText: "Sign her page" });
  assert.equal(game.scene.part, "signed_limited", "a limit in writing changes the ending");
  assert.match(signed, /A captain who reads/);
  assert.equal(game.ship.fuel, 12, "the tanks are full, and no fuller");
  assert.equal(quest(game, FUEL).status, "completed");
  assert.ok(game.flags.fuel_sorted && game.flags.signed_with_quill);
  assert.equal(contact(game, /Quill/).attitude, "friendly");
  assert.ok(game.journal.some((entry) => /forty-one ships on credit/.test(entry.entry)));
  play(game, { playerText: "Go on" });
  assert.equal(game.scene, null);
  assert.equal(game.story.act, 1, "the council hasn't met yet, so the act stays");
});

test("the fuel's other roads: Tannis's quiet night goes wrong and the fight decides, and the strike at Cinder Reach settles at the table", () => {
  const game = newGame();
  game.location = "kessara";
  take(game, FUEL);
  play(game, { playerText: "Accept the invitation" });
  assert.equal(game.scene.part, "parlor", "already at Kessara, so the parlor's straight away");
  play(game, { playerText: "Thank her for the tea" });
  assert.equal(game.scene.part, "hub");
  const drink = play(game, { playerText: "Let Rook Tannis buy you that drink" });
  assert.match(drink, /hull breach/);
  assert.equal(roomNow(game), "Raiders' Row");
  play(game, { playerText: "Take the depot on the fourth hour" });
  assert.equal(game.check.skill, "tactics");
  settleCheck(game, false);
  play(game, { event: "continue" });
  assert.ok(game.combat, "the raid went wrong, and the collectors came up the gantry");
  assert.equal(game.scene.part, "raid_messy");
  const drift = game.factions.drift;
  endFight(game, "victory");
  const taken = play(game, { event: "continue" });
  assert.equal(game.scene.part, "raided_messy");
  assert.match(taken, /whose idea the raid was/);
  assert.ok(game.flags.framed_by_tannis && game.flags.kessara_closed && game.flags.fuel_sorted);
  assert.ok(game.factions.drift < drift);
  assert.equal(quest(game, FUEL).status, "completed");
  assert.equal(contact(game, /Tannis/).attitude, "wary");

  // Losing the raid leaves the fleet with nothing, and a way out.
  const lost = newGame("captain", 22);
  lost.location = "kessara";
  take(lost, FUEL);
  play(lost, { playerText: "Accept the invitation" });
  play(lost, { playerText: "Thank her for the tea" });
  play(lost, { playerText: "Let Rook Tannis" });
  checkThen(lost, "Take the depot", false);
  endFight(lost, "defeat");
  play(lost, { event: "continue" });
  assert.equal(lost.scene.part, "raid_lost");
  assert.equal(quest(lost, FUEL).status, "active", "the fuel's still to find");
  play(lost, { playerText: "Take the Hegemony's fuel" });
  assert.equal(lost.scene.part, "took_corvane");
  assert.ok(lost.flags.hegemony_transponders);
  assert.equal(quest(lost, FUEL).status, "completed");

  // Cinder Reach: both sides at one table, and honest fuel five days late.
  const cinder = newGame("captain", 23);
  cinder.location = "cinder";
  take(cinder, FUEL);
  play(cinder, { playerText: "Take the fleet to Cinder Reach" });
  assert.equal(cinder.scene.part, "shift_row");
  assert.equal(roomNow(cinder), "Shift Row");
  checkThen(cinder, "Get Greaves and Vale", true);
  assert.equal(cinder.scene.part, "table_pass");
  const hours = cinder.clock.hours;
  play(cinder, { playerText: "Go on" });
  assert.equal(cinder.scene.part, "settled_table");
  assert.ok(cinder.clock.hours >= hours + 72, "three days passed");
  assert.ok(cinder.ship.fuel >= 11, `the tanks are full, less what three days of waiting burned: ${cinder.ship.fuel}`);
  assert.equal(contact(cinder, /Greaves/).attitude, "friendly");
  assert.equal(quest(cinder, FUEL).status, "completed");
});

test("the fuel for other lives: the engine hand finds four days with Marrow, and the dock hand reads what's under the dumplings", () => {
  const hand = newGame("engine_hand");
  const fuel = hand.ship.fuel;
  take(hand, FUEL);
  assert.equal(hand.scene.part, "hand_start");
  assert.equal(hand.check.skill, "engineering", "the story opened the check itself");
  settleCheck(hand, true);
  play(hand, { event: "continue" });
  assert.equal(hand.scene.part, "hand_pass");
  assert.equal(hand.ship.fuel, fuel + 2);
  assert.equal(contact(hand, /Marrow/).attitude, "friendly");
  play(hand, { playerText: "Go on" });
  assert.equal(hand.scene, null);
  assert.equal(quest(hand, FUEL).status, "active", "what the captain does about the rest is upstairs business");
  assert.match(quest(hand, FUEL).objective, /upstairs/);

  const docker = newGame("docker");
  take(docker, FUEL);
  assert.equal(docker.scene.part, "dock_start");
  checkThen(docker, "Have a look under the dumplings", true);
  assert.equal(docker.scene.part, "dock_looked");
  assert.ok(docker.flags.knows_quill_terms);
  play(docker, { playerText: "Tell the fleet's chief engineer" });
  assert.equal(docker.scene.part, "dock_told");
  assert.ok(docker.inventory.ration_pack >= 1, "a Meridian ration bar");
  assert.equal(quest(docker, FUEL).status, "completed");
  play(docker, { playerText: "Go on" });
  assert.equal(docker.scene, null);
});

// ---- Visiting Hours -------------------------------------------------------------------

test("visiting hours: the captain crosses to the Mercy, sits across from her, cuts Tarrow's order down, walks her to a locked room, tells Pavel himself, and Mila meets her father", () => {
  const game = newGame();
  game.location = "haven";
  const opening = take(game, VISITING);
  assert.equal(game.location, "anselm", "the story crossed to Anselm's Mercy");
  assert.equal(roomNow(game), "The Long Ward");
  assert.match(opening, /Four-twelve/);
  assert.ok(quest(game, VISITING));
  checkThen(game, "Sit down across from her", true);
  assert.equal(game.scene.part, "talk_pass");
  assert.ok(game.flags.talked_to_ilse);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "ward");
  play(game, { playerText: "Take Wen aside" });
  assert.ok(game.flags.knows_transfers);
  play(game, { playerText: "Go on" });
  checkThen(game, "Pull the ship's visitor log", true);
  assert.ok(game.flags.read_logs);
  play(game, { playerText: "Go on" });
  play(game, { playerText: "Ask Mercy Seven" });
  assert.equal(game.scene.part, "seven");
  checkThen(game, "Ask them straight", true);
  assert.equal(game.scene.part, "seven_told");
  assert.ok(game.story.clues.includes("pavel_tune"));
  play(game, { playerText: "Go on" });
  play(game, { playerText: "The bell's about to go" });
  assert.equal(game.scene.part, "tarrow_arrives");
  checkThen(game, "Give her a narrow order", true);
  assert.equal(game.scene.part, "tarrow_narrow");
  assert.ok(game.flags.tarrow_narrow && !game.flags.tarrow_list_live);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "the_visitor");
  checkThen(game, "Calm the ward", true);
  assert.equal(game.scene.part, "held_pass");
  assert.ok(game.flags.mimic_held);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "tell");
  const told = play(game, { playerText: "Tell him the truth yourself" });
  assert.match(told, /whether the dog got out/);
  assert.equal(contact(game, /Ostrov/).attitude, "friendly");
  assert.equal(contact(game, /Aduro/).attitude, "friendly");
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "mila");
  const mila = play(game, { playerText: "Bring Mila across" });
  assert.match(mila, /toy piano/);
  assert.ok(game.flags.pavel_met_mila);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "wen_transfers", "Wen brings the forms, because the captain found them");
  play(game, { playerText: "Sign off on it" });
  assert.ok(game.inventory.surgeon_lens >= 1, "something from Wen's own locker");
  assert.equal(contact(game, /Adeyemi/).attitude, "friendly");
  play(game, { playerText: "Go on" });
  assert.equal(game.scene, null);
  assert.equal(quest(game, VISITING).status, "completed");
  assert.match(quest(game, VISITING).objective, /locked on the Bell Stair/);
});

test("visiting hours goes wrong: Tarrow's list goes live, the fight is lost, and she takes him; and the porter and the orderly have their own sides", () => {
  const game = newGame();
  game.location = "haven";
  take(game, VISITING);
  play(game, { playerText: "Take Wen aside" });
  play(game, { playerText: "Go on" });
  play(game, { playerText: "The bell's about to go" });
  play(game, { playerText: "Sign Tarrow's order as written" });
  assert.equal(game.scene.part, "tarrow_full");
  assert.ok(game.flags.tarrow_list_live);
  assert.equal(contact(game, /Seven/).attitude, "wary");
  play(game, { playerText: "Go on" });
  play(game, { playerText: "Draw, and take her down here" });
  assert.ok(game.combat, "the thing with Ilse's face fights to reach him");
  assert.equal(game.scene.part, "mimic_fight");
  endFight(game, "defeat");
  const taken = play(game, { event: "continue" });
  assert.equal(game.scene.part, "mimic_won");
  assert.match(taken, /short a patient/);
  assert.ok(game.flags.pavel_taken);
  const over = play(game, { playerText: "Go on" });
  assert.match(over, /nobody on the ward hums any more/, "no transfers were found, so the story ends here");
  assert.equal(quest(game, VISITING).status, "completed");
  assert.match(quest(game, VISITING).objective, /She took Pavel/);
  assert.equal(game.scene, null);

  // Winning the fight leaves a core.
  const won = newGame("captain", 22);
  won.location = "haven";
  take(won, VISITING);
  play(won, { playerText: "Take Wen aside" });
  play(won, { playerText: "Go on" });
  play(won, { playerText: "The bell's about to go" });
  play(won, { playerText: "Refuse her any order" });
  play(won, { playerText: "Go on" });
  play(won, { playerText: "Draw, and take her down here" });
  endFight(won, "victory");
  play(won, { event: "continue" });
  assert.equal(won.scene.part, "mimic_down");
  assert.ok(won.inventory.choir_core >= 1);

  const porter = newGame("porter");
  take(porter, VISITING);
  assert.equal(porter.scene.part, "porter_start");
  checkThen(porter, "Stop pushing", true);
  assert.equal(porter.scene.part, "porter_heard");
  assert.ok(porter.story.clues.includes("pavel_tune"));
  play(porter, { playerText: "Go on" });
  assert.equal(porter.scene.part, "porter_wen");
  play(porter, { playerText: "Go on" });
  assert.equal(porter.scene, null);
  assert.equal(quest(porter, VISITING).status, "completed");

  const orderly = newGame("orderly");
  take(orderly, VISITING);
  assert.equal(orderly.scene.part, "orderly_start");
  assert.equal(orderly.check.skill, "medicine");
  settleCheck(orderly, false);
  play(orderly, { event: "continue" });
  assert.equal(orderly.scene.part, "orderly_nothing");
  play(orderly, { playerText: "Go on" });
  assert.equal(orderly.scene, null);
});

// ---- The council, and the end of the act ----------------------------------------------

test("the council asks, the captain tells the whole truth and carries the room, and with fuel in the tanks the first act ends", () => {
  const game = newGame();
  game.location = "haven";
  game.quests.push({ id: FUEL, title: "Two Weeks of Fuel", main: false, status: "completed", desc: "", objective: "Signed." });
  const opening = take(game, COUNCIL);
  assert.equal(game.location, "meridian", "the council meets aboard");
  assert.equal(roomNow(game), "The Long Mess");
  assert.match(opening, /what exactly you're leading us toward/);
  play(game, { playerText: "Tell them the whole of it" });
  assert.equal(game.scene.part, "truth");
  assert.ok(game.flags.told_the_fleet_truth);
  checkThen(game, "Stand up, and bring the room back", true);
  assert.equal(game.scene.part, "carry_pass");
  assert.equal(contact(game, /Voss/).attitude, "ally");
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "drawing");
  const drawing = play(game, { playerText: "Pick it up" });
  assert.match(drawing, /inside your coat/);
  assert.ok(game.flags.has_the_drawing);
  play(game, { playerText: "Go on" });
  assert.equal(game.scene.part, "vote_follow");
  assert.equal(quest(game, COUNCIL).status, "completed");
  assert.ok(game.flags.council_voted_follow);
  const ended = play(game, { playerText: "Go on" });
  assert.match(ended, /following the Beacon now/);
  assert.equal(game.story.act, 2, "the first act is over");
  assert.equal(game.scene, null);

  // Told the truth and lost the room, the vote's close, and Halm abstains.
  const split = newGame("captain", 22);
  split.location = "haven";
  split.quests.push({ id: FUEL, title: "Two Weeks of Fuel", main: false, status: "completed", desc: "", objective: "Signed." });
  take(split, COUNCIL);
  play(split, { playerText: "Tell them the whole of it" });
  checkThen(split, "Stand up, and bring the room back", false);
  assert.equal(split.scene.part, "carry_fail");
  play(split, { playerText: "Go on" });
  play(split, { playerText: "Leave it on the table" });
  play(split, { playerText: "Go on" });
  assert.equal(split.scene.part, "vote_close");
  assert.ok(split.flags.halm_abstained);
  play(split, { playerText: "Go on" });
  assert.equal(split.story.act, 2);
});

test("the council first, with empty tanks: it votes fuel first, and the act ends when the fuel's found; and Tharel can be sent for, and flinches", () => {
  const game = newGame();
  game.location = "haven";
  take(game, COUNCIL);
  play(game, { playerText: "Tell them you don't know" });
  assert.equal(game.scene.part, "dont_know");
  assert.equal(contact(game, /Voss/).attitude, "ally");
  assert.equal(contact(game, /Halm/).attitude, "wary");
  play(game, { playerText: "Go on" });
  play(game, { playerText: "Leave it on the table" });
  const fuelFirst = play(game, { playerText: "Go on" });
  assert.match(fuelFirst, /Fuel first, Captain/, "no fuel, so no vote on the Beacon");
  assert.equal(game.scene, null, "and the story ends there");
  assert.equal(quest(game, COUNCIL).status, "completed");
  assert.equal(game.story.act, 1);
  // Now the fuel, which ends the act because the council has already met.
  take(game, FUEL);
  play(game, { playerText: "Ask Legate Corvane" });
  assert.equal(game.scene.part, "corvane");
  play(game, { playerText: "Take the Hegemony's fuel" });
  assert.equal(game.scene.part, "took_corvane");
  const ended = play(game, { playerText: "Go on" });
  assert.match(ended, /following the Beacon now/, "the council has met, so the fuel ends the act");
  assert.equal(game.story.act, 2);
  assert.equal(game.scene, null);

  // Tharel at the table: a scholar sees him flinch, and Quill's prisoner can't be sent for.
  const scholar = newGame("captain", 23);
  scholar.location = "haven";
  const asked = take(scholar, COUNCIL);
  assert.match(asked, /Send for Archivist Tharel/);
  play(scholar, { playerText: "Send for Archivist Tharel" });
  assert.equal(scholar.scene.part, "send_tharel");
  checkThen(scholar, "Ask him, in front of them", true);
  assert.equal(scholar.scene.part, "tharel_flinch");
  assert.ok(scholar.flags.saw_tharel_flinch);
  const prisoner = newGame("captain", 24);
  prisoner.location = "haven";
  prisoner.flags = { tharel_taken_by_quill: true };
  const without = take(prisoner, COUNCIL);
  assert.doesNotMatch(without, /Send for Archivist Tharel/);
});

// ---- Tharel's conversation --------------------------------------------------------------

function openTalkWith(game, pattern) {
  const key = publicState(game).walk.people.find((one) => pattern.test(one.name))?.key;
  assert.ok(key, `someone matching ${pattern} is in the room`);
  talkCommand(game, { action: "open", person: key });
  openWrittenTalk(game);
  return talkView(game);
}
function sayInTalk(game, text) {
  talkSaid(game, text);
  const pieces = [];
  writtenTalkTurn({ game, playerText: text, emit: (e) => { if (e.type !== "state") pieces.push(e); } });
  for (const piece of pieces) talkHeard(game, piece.text, piece.type === "text" ? "narrator" : "notice");
  return pieces.filter((piece) => piece.type === "text").map((piece) => piece.text).join("\n");
}
function inTharelsRoom(start = "captain", seed = 21) {
  const game = newGame(start, seed);
  game.location = "haven";
  game.walk = null;
  game.transcript.push({ role: "narrator", text: "Haven." });
  const outcome = runTool(game, "set_scene", { area: "Tharel's Warm Room", people: ["tharel"] }, newTurnLimits());
  assert.ok(!outcome.isError, outcome.result);
  return game;
}

test("Tharel's conversation: he flinches at the lower layer, says more to a captain he trusts, and isn't there once Quill has him", () => {
  const game = inTharelsRoom();
  const first = openTalkWith(game, /Tharel/);
  assert.match(first.lastReply, /Young one/);
  assert.match(first.lastReply, /Ask him again what the lower layer says/);
  const lower = sayInTalk(game, "Ask him again what the lower layer says");
  assert.match(lower, /both his eyes stop blinking/);
  assert.match(lower, /Bring me the Ilun Codex/);
  assert.equal(game.talk.written.part, "lower");
  const corso = sayInTalk(game, "Ask about Lenn Corso");
  assert.match(corso, /somewhere very wet/);
  assert.ok(game.journal.some((entry) => /Corso/.test(entry.entry)));
  assert.doesNotMatch(sayInTalk(game, "Ask what the Ilun Codex is"), /Ask about Lenn Corso/, "a question asked goes away");
  talkCommand(game, { action: "close" });

  game.flags.tharel_trusts = true;
  game.flags.heard_two_voices = true;
  runTool(game, "give_item", { item: "beacon_shard" }, newTurnLimits());
  const trusted = openTalkWith(game, /Tharel/);
  assert.match(trusted.lastReply, /kettle's on/);
  assert.match(trusted.lastReply, /Ask about the shard/);
  assert.match(sayInTalk(game, "Ask him again what the lower layer says"), /Don't tell anyone else you can/);
  assert.match(sayInTalk(game, "Ask about the shard"), /never once liked where/);
  talkCommand(game, { action: "close" });

  game.flags.tharel_taken_by_quill = true;
  assert.match(openTalkWith(game, /Tharel/).lastReply, /isn't Tharel/);
  talkCommand(game, { action: "close" });

  const hand = inTharelsRoom("docker", 22);
  const other = openTalkWith(hand, /Tharel/);
  assert.match(other.lastReply, /not the one with the fleet/);
  assert.match(sayInTalk(hand, "Ask him about the signal"), /Mind the crate on your way out/);
});
