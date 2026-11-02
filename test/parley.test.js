// Everything you can do in a fight besides hitting someone, and what decides whether it works:
// how much they hate you, why they're fighting, how strong you are, and the stat that helps.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { NOTABLES, SKILLS } from "../src/character-data.js";
import { parleyNotes, whyTheyFight } from "../src/combat.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { ENEMIES, FACTIONS, STATS } from "../src/data.js";
import { migrateGame } from "../src/migrate.js";
import { NPC_ARCHETYPES } from "../src/npc.js";
import { projectDir } from "../src/paths.js";
import { combatAction, publicState, startCombat } from "../src/rules.js";
import { TOOL_DEFS, newTurnLimits, runTool } from "../src/tools.js";
import { PARLEY } from "../src/world.js";

const newGame = (seed = 7, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
const view = (game) => publicState(game).combat;
const actionFor = (game, id) => view(game).actions.find((action) => action.action.id === id && action.group === "talk");
const aimedAt = (game, id, enemy = game.combat.enemies[0]) => actionFor(game, id)?.targets[enemy.key];
const odds = (game, id, enemy) => aimedAt(game, id, enemy).odds;
// The difficulty's what the odds come from, and it can be read off the hover text even when the odds have hit their limits.
const difficulty = (game, id, enemy) => Number(aimedAt(game, id, enemy).title.match(/To beat: (\d+)/)[1]);
const fightWith = (enemy, options = {}, seed = 7, archetype = "officer") => {
  const game = newGame(seed, archetype);
  startCombat(game, enemy, options);
  return game;
};

// Keeps going until it's worked, however the dice fall.
function until(game, action, done) {
  let outcome;
  let tries = 0;
  do {
    game.hp = 1000;
    outcome = combatAction(game, action);
    tries += 1;
  } while (!done(outcome) && tries < 500);
  assert.ok(done(outcome), `it never happened: ${JSON.stringify(action)}`);
  return outcome;
}
const worked = (outcome) => outcome.over || outcome.events.some((event) => event.out);
const failed = (outcome) => outcome.events.some((event) => event.refused);
const talkTo = (game, id, enemy = game.combat.enemies[0]) => until(game, { type: "parley", id, target: enemy.key }, worked);

// Someone it can't fail on, apart from the one roll in twenty that always fails.
function persuasive(game) {
  game.stats.presence = 10;
  game.stats.intellect = 10;
  game.stats.might = 10;
  for (const skill of ["persuasion", "intimidation", "commerce", "deception", "hacking", "survival"]) game.skills[skill] = 10;
  return game;
}

// ---- The files ----------------------------------------------------------

test("every kind of enemy has a reason to fight, and a side that exists", () => {
  for (const [id, enemy] of Object.entries(ENEMIES)) {
    assert.ok(PARLEY.motives[enemy.motive], `${id}: ${enemy.motive}`);
    if (enemy.faction) assert.ok(FACTIONS[enemy.faction], `${id}: ${enemy.faction}`);
  }
  for (const archetype of Object.keys(NPC_ARCHETYPES)) assert.ok(PARLEY.motives[PARLEY.archetypes[archetype]], archetype);
});

test("every reason and every approach is complete, and its lines are ones the game can fill in", () => {
  const ids = Object.keys(PARLEY.approaches);
  for (const [id, motive] of Object.entries(PARLEY.motives)) {
    assert.ok(motive.label && motive.says, id);
    if (motive.stat) assert.ok(STATS[motive.stat], `${id}: ${motive.stat}`);
    for (const key of ["persuade", "threaten", "pay", "lie"]) assert.ok(motive[key] === null || typeof motive[key] === "number", `${id}: ${key}`);
    for (const key of ["persuade", "threaten", "pay", "lie"]) if (motive[key] === null) assert.ok(motive.refuses?.[key] ?? motive.refuses?.any, `${id} says why not: ${key}`);
  }
  const check = (line, where) => {
    assert.equal(typeof line, "string", where);
    for (const [word] of line.matchAll(/\{[^}]*\}/g)) assert.ok(["{enemy}", "{Enemy}", "{price}"].includes(word), `${word} in: ${line}`);
  };
  for (const id of ids) {
    const approach = PARLEY.approaches[id];
    assert.ok(SKILLS[approach.skill], `${id}: ${approach.skill}`);
    for (const stat of approach.stats) assert.ok(STATS[stat], `${id}: ${stat}`);
    for (const key of ["name", "out", "done", "told"]) check(approach[key], `${id}: ${key}`);
    for (const outcome of ["worked", "failed"]) {
      assert.ok(approach.lines[outcome].any.length >= 1, `${id} ${outcome}`);
      for (const [motive, lines] of Object.entries(approach.lines[outcome])) {
        assert.ok(motive === "any" || PARLEY.motives[motive], `${id} ${outcome}: ${motive}`);
        lines.forEach((line) => check(line, `${id} ${outcome} ${motive}`));
      }
    }
  }
  // An enemy's own lines are for approaches that exist, and that could work on it.
  const own = /^(.+)_(worked|failed)$/;
  for (const [id, enemy] of Object.entries(ENEMIES)) {
    for (const [key, lines] of Object.entries(enemy.lines ?? {})) {
      const match = key.match(own);
      if (!match) continue;
      assert.ok(ids.includes(match[1]), `${id}: ${key}`);
      assert.ok(parleyNotes({ ...enemy, id }).could.includes(PARLEY.approaches[match[1]].name), `${id} can't be: ${key}`);
      lines.forEach((line) => check(line, `${id} ${key}`));
    }
  }
});

test("the difficulty bands read from the top down, so every value has a line", () => {
  for (const bands of [PARLEY.feelings, PARLEY.strength]) {
    assert.deepEqual(bands.map((band) => band.from), bands.map((band) => band.from).sort((a, b) => b - a));
    assert.equal(bands.at(-1).from, -6);
  }
});

// ---- What decides it ----------------------------------------------------

test("why they're fighting: the same enemy is easier or harder to talk down, depending on the reason", () => {
  const talk = (why) => difficulty(fightWith("dock_thug", { why }), "persuade");
  assert.ok(talk("desperate") < talk("paid"));
  assert.ok(talk("paid") < talk("orders"));
  assert.ok(talk("orders") < talk("grudge"));
  assert.ok(talk("grudge") < talk("belief"));
  // And it's not the same order for everything: money works on a hired hand, not on a true believer.
  assert.ok(difficulty(fightWith("dock_thug", { why: "paid" }), "pay") < difficulty(fightWith("dock_thug", { why: "orders" }), "pay"));
  const believer = fightWith("dock_thug", { why: "belief" });
  assert.equal(actionFor(believer, "pay"), undefined, "it isn't even offered");
  assert.throws(() => combatAction(believer, { type: "parley", id: "pay", target: "e0" }), /They can't be bought/);
  assert.throws(() => combatAction(believer, { type: "parley", id: "threaten", target: "e0" }), /They aren't afraid of you/);
  // Forged orders are the way past someone who's following orders.
  const soldier = fightWith("dock_thug", { why: "orders" });
  assert.ok(difficulty(soldier, "lie") < difficulty(soldier, "persuade"));
});

test("how much they hate you: a faction's feelings, and a person's", () => {
  const trooper = (standing) => {
    const game = newGame();
    game.ideology = {};
    game.factions.hegemony = standing;
    startCombat(game, "hegemony_trooper");
    return game;
  };
  assert.ok(difficulty(trooper(-90), "persuade") > difficulty(trooper(0), "persuade"));
  assert.ok(difficulty(trooper(0), "persuade") > difficulty(trooper(90), "persuade"));
  const read = (standing) => view(trooper(standing)).reads.e0.feels;
  assert.equal(read(-90), "They want you dead.");
  assert.equal(read(-50), "They hate you.");
  assert.equal(read(-20), "They don't like you.");
  assert.equal(read(0), "You're nobody to them.");
  assert.equal(read(90), "They like you.");

  const person = (attitude) => {
    const game = newGame();
    game.ideology = {};
    game.contacts = game.contacts.filter((contact) => contact.name !== NOTABLES.tarrow.name);
    game.contacts.push({ name: NOTABLES.tarrow.name, attitude });
    startCombat(game, "tarrow");
    return game;
  };
  assert.ok(difficulty(person("hostile"), "persuade") > difficulty(person("neutral"), "persuade"));
  assert.ok(difficulty(person("neutral"), "persuade") > difficulty(person("ally"), "persuade"));

  // Someone who's on nobody's side doesn't care what the player's done to whom.
  const thug = (standing) => {
    const game = newGame();
    game.factions.hegemony = standing;
    startCombat(game, "dock_thug");
    return difficulty(game, "persuade");
  };
  assert.equal(thug(-100), thug(100));
  // The story can say who they're fighting for.
  const game = newGame();
  game.ideology = {};
  game.factions.hegemony = -90;
  startCombat(game, "dock_thug", { faction: "hegemony" });
  assert.equal(view(game).reads.e0.feels, "They want you dead.");
});

test("how strong you are: it gets easier as you win, and harder as you lose", () => {
  const game = fightWith("hegemony_trooper");
  const [enemy] = game.combat.enemies;
  game.hp = 40;
  const even = difficulty(game, "persuade");
  enemy.hp = 2;
  assert.ok(difficulty(game, "persuade") < even, "they're nearly finished");
  assert.equal(view(game).reads[enemy.key].fight, "You could finish this easily.");
  enemy.hp = enemy.maxHp;
  game.hp = 1;
  assert.ok(difficulty(game, "persuade") > even, "the player is nearly finished");
  assert.equal(view(game).reads[enemy.key].fight, "You're losing badly.");

  // More of them makes it worse, and friends make it better.
  const alone = difficulty(fightWith("drift_raider"), "persuade");
  assert.ok(difficulty(fightWith("drift_raider", { followers: ["drift_raider", "drift_raider"] }), "persuade") > alone);
  assert.ok(difficulty(fightWith("drift_raider", { allies: ["voss", "tarrow"] }), "persuade") < alone);

  // A threat needs more behind it than a good argument does.
  const shift = (id) => {
    const fight = fightWith("drift_raider");
    fight.game = null;
    const [foe] = fight.combat.enemies;
    fight.hp = 2;
    const losing = difficulty(fight, id);
    fight.hp = 1000;
    foe.hp = 1;
    return losing - difficulty(fight, id);
  };
  assert.ok(shift("threaten") > shift("persuade"));
  assert.ok(shift("persuade") > shift("lie"));
});

test("the stat that helps: skills and stats change the odds, and what helps depends on who you're talking to", () => {
  const withStats = (stats, why) => {
    const game = newGame();
    for (const id of Object.keys(STATS)) game.stats[id] = 3;
    Object.assign(game.stats, stats);
    startCombat(game, "dock_thug", { why });
    return game;
  };
  assert.ok(odds(withStats({ presence: 7 }, "paid"), "persuade") > odds(withStats({}, "paid"), "persuade"));
  const trained = withStats({}, "paid");
  const before = odds(trained, "persuade");
  trained.skills.persuasion = 8;
  assert.ok(odds(trained, "persuade") > before);

  // A hired hand can be shown the sums, a champion respects strength, and someone desperate needs reading.
  const clever = withStats({ intellect: 8 }, "paid");
  assert.match(aimedAt(clever, "persuade").detail, /^Persuasion and Intellect$/);
  assert.ok(odds(clever, "persuade") > odds(withStats({}, "paid"), "persuade"));
  assert.match(aimedAt(withStats({ might: 8 }, "honor"), "persuade").detail, /Might/);
  assert.match(aimedAt(withStats({ perception: 8 }, "desperate"), "persuade").detail, /Perception/);
  // It's the best one that counts, so nobody's worse off for being good at something else.
  assert.match(aimedAt(withStats({ presence: 9, intellect: 5 }, "paid"), "persuade").detail, /Presence/);
  // Other approaches have stats of their own.
  assert.match(aimedAt(withStats({ might: 8 }, "paid"), "threaten").detail, /^Intimidation and Might$/);
  assert.match(aimedAt(withStats({ intellect: 8 }, "paid"), "lie").detail, /^Deception and Intellect$/);
  assert.match(aimedAt(withStats({}, "paid"), "pay").detail, /^Commerce and Presence$/);
});

test("the odds shown are the ones that get rolled, and the sum is there to read", () => {
  const game = fightWith("dock_thug");
  const { title } = aimedAt(game, "persuade");
  assert.match(title, /^You: Presence \+\d+, /);
  assert.match(title, /To beat: \d+ \(starts at 16/);
  const counted = { yes: 0, no: 0 };
  const percent = odds(game, "persuade");
  for (let i = 0; i < 2000; i += 1) {
    const fight = fightWith("dock_thug");
    const { events } = combatAction(fight, { type: "parley", id: "persuade", target: "e0" });
    if (events.some((event) => event.out)) counted.yes += 1;
    else counted.no += 1;
  }
  const seen = (counted.yes / 2000) * 100;
  assert.ok(Math.abs(seen - percent) < 6, `shown ${percent}%, happened ${seen}%`);
});

// ---- What happens -------------------------------------------------------

test("it takes your turn: if it fails they get angrier and they still come for you, and your side holds its fire", () => {
  // A roll of 20 always works, so this goes on until one doesn't.
  let game;
  let enemy;
  let before;
  let outcome;
  do {
    game = fightWith("drift_raider", { allies: ["voss"] });
    [enemy] = game.combat.enemies;
    game.stats.presence = 1;
    game.skills.persuasion = 0;
    enemy.hp = 500;
    game.hp = 1000;
    before = difficulty(game, "persuade");
    outcome = combatAction(game, { type: "parley", id: "persuade", target: enemy.key });
  } while (!failed(outcome));
  assert.equal(enemy.anger, PARLEY.anger.each);
  assert.ok(outcome.events.some((event) => event.by === enemy.key), "they still act");
  assert.ok(!outcome.events.some((event) => event.by === game.combat.allies[0].key), "the follower doesn't");
  assert.ok(outcome.events.some((event) => event.text === PARLEY.holdFire[0]));
  assert.equal(enemy.hp, 500);
  assert.ok(difficulty(game, "persuade") >= before);
  assert.match(aimedAt(game, "persuade").title, /you've already tried \+\d/);
  // Trying over and over only goes so far.
  for (let i = 0; i < 40 && game.combat; i += 1) {
    game.hp = 1000;
    combatAction(game, { type: "parley", id: "persuade", target: enemy.key });
    assert.ok(enemy.anger <= PARLEY.anger.most);
  }
});

test("someone who stands down is out of it, and the rest fight on, a little less sure of themselves", () => {
  const game = persuasive(fightWith("dock_thug", { followers: ["dock_thug", "dock_thug"], allies: ["voss"] }));
  const [leader, second, third] = game.combat.enemies;
  game.combat.allies[0].attack = -100;
  for (const enemy of [leader, second, third]) enemy.hp = 500;
  const other = difficulty(game, "persuade", third);
  const outcome = talkTo(game, "persuade", second);
  assert.equal(outcome.over, false);
  assert.equal(second.out, "persuade");
  const event = outcome.events.find((one) => one.out);
  assert.equal(event.on, second.key);
  assert.equal(event.out, "Talked down");
  assert.ok(!outcome.events.some((one) => one.by === second.key), "they don't act");
  assert.ok(outcome.events.some((one) => one.by === leader.key), "the others do");
  assert.equal(view(game).enemies[1].out, "Talked down");
  assert.ok(!view(game).reads[second.key]);
  // Aiming at them falls through to who's left, and nobody goes after them.
  game.hp = 1000;
  const next = combatAction(game, { type: "attack", target: second.key });
  assert.notEqual(next.events.find((one) => one.by === "you").on, second.key);
  assert.ok(!next.events.some((one) => one.on === second.key));
  assert.ok(difficulty(game, "persuade", third) <= other);
  assert.match(aimedAt(game, "persuade", third).title, /the others have backed off/);
  // It means more when it's the one in charge.
  const led = persuasive(fightWith("dock_thug", { followers: ["dock_thug", "dock_thug"] }));
  const [boss, , last] = led.combat.enemies;
  for (const enemy of led.combat.enemies) enemy.hp = 500;
  talkTo(led, "persuade", boss);
  assert.match(aimedAt(led, "persuade", last).title, new RegExp(`the others have backed off -${PARLEY.backing.leader}`));
});

test("talking everyone down ends the fight: no winner, the XP, none of their money, and the story's told they're still out there", () => {
  const game = persuasive(fightWith("drift_raider", { allies: ["voss"] }));
  game.xp = 0;
  const credits = game.credits;
  const standing = game.factions.drift;
  const outcome = talkTo(game, "persuade");
  assert.equal(outcome.over, true);
  assert.equal(outcome.result, "talked");
  assert.equal(game.combat, null);
  assert.equal(outcome.tone, "good");
  assert.match(outcome.summary, /let you talk them out of it/);
  assert.equal(outcome.math, `+${Math.round(ENEMIES.drift_raider.xp / 1.5)} XP`);
  assert.equal(game.credits, credits);
  assert.equal(game.factions.drift, standing + PARLEY.approaches.persuade.standing);
  const told = game.pendingEvents.at(-1);
  assert.match(told, /without anyone being beaten/);
  assert.match(told, /talked out of fighting by the player/);
  assert.match(told, /still out there/);
  assert.match(told, /Fighting beside them: Commander Ilya Voss/);
  assert.deepEqual(game.bestiary.drift_raider, { fought: 1, won: 0, lost: 0, fled: 0, talked: 1, gaveUp: 0 });
  assert.ok(publicState(game).enemies.find((enemy) => enemy.id === "drift_raider").record.talked === 1);
});

test("beating some and talking down the rest is still a win, with money only from those beaten", () => {
  const game = persuasive(fightWith("dock_thug", { followers: ["drift_raider"] }));
  const [thug, raider] = game.combat.enemies;
  thug.credits = [7, 7];
  raider.credits = [1000, 1000];
  raider.hp = 500;
  thug.hp = 500;
  talkTo(game, "persuade", raider);
  const credits = game.credits;
  game.xp = 0;
  thug.hp = 1;
  thug.defense = -100;
  const outcome = until(game, { type: "attack", target: thug.key }, (one) => one.over);
  assert.equal(outcome.result, "victory");
  assert.equal(game.credits, credits + 7);
  assert.match(outcome.summary, /^You beat the Dock Thug in \d+ rounds?\. The Drift Raider let you talk them out of it\.$/);
  assert.equal(outcome.math, `+${ENEMIES.dock_thug.xp + ENEMIES.drift_raider.xp} XP, +7 credits`);
  const told = game.pendingEvents.at(-1);
  assert.match(told, /won the fight against the Dock Thug/);
  assert.match(told, /Drift Raider was talked out of fighting/);
  assert.equal(game.bestiary.dock_thug.won, 1);
  assert.equal(game.bestiary.drift_raider.talked, 1);
});

test("paying them off only costs anything if they take it, and it costs what they're worth", () => {
  const game = fightWith("dock_thug");
  const [enemy] = game.combat.enemies;
  game.stats.presence = 1;
  game.skills.commerce = 0;
  game.credits = 5000;
  enemy.hp = 500;
  const { label } = aimedAt(game, "pay");
  const price = Number(label.match(/(\d+) cr$/)[1]);
  assert.ok(price >= PARLEY.pay.lowest);
  const money = game.credits;
  const refused = until(game, { type: "parley", id: "pay", target: enemy.key }, (one) => failed(one) || worked(one));
  if (failed(refused)) assert.equal(game.credits, money);

  const paying = persuasive(fightWith("dock_thug"));
  paying.credits = 5000;
  paying.xp = 0;
  const cost = Number(aimedAt(paying, "pay").label.match(/(\d+) cr$/)[1]);
  const outcome = talkTo(paying, "pay");
  assert.equal(outcome.result, "talked");
  assert.equal(paying.credits, 5000 - cost);
  assert.ok(outcome.events.find((one) => one.out).math.includes(`-${cost} credits`));
  assert.equal(outcome.math, `+${Math.round(ENEMIES.dock_thug.xp * PARLEY.approaches.pay.xp)} XP`);
  assert.match(outcome.summary, new RegExp(`took ${cost} credits`));
  assert.match(paying.pendingEvents.at(-1), new RegExp(`took ${cost} credits from the player`));

  // Good at it, it costs less. Someone under orders costs more than someone desperate.
  const priced = (why, rank) => {
    const fight = fightWith("dock_thug", { why });
    fight.credits = 100000;
    fight.skills.commerce = rank;
    return Number(aimedAt(fight, "pay").label.match(/(\d+) cr$/)[1]);
  };
  assert.ok(priced("paid", 8) < priced("paid", 0));
  assert.ok(priced("desperate", 0) < priced("orders", 0));

  // There's no paying with money you haven't got, and being refused costs nothing.
  const broke = fightWith("dock_thug");
  broke.credits = 0;
  const round = broke.combat.round;
  assert.equal(aimedAt(broke, "pay").disabled, true);
  assert.match(aimedAt(broke, "pay").why, /it would take \d+ credits/);
  assert.throws(() => combatAction(broke, { type: "parley", id: "pay", target: "e0" }), /It would take \d+ credits/);
  assert.equal(broke.combat.round, round);
});

test("a lie only gets one chance with each of them, and the story's told it was a lie", () => {
  let game;
  let first;
  let second;
  do {
    game = fightWith("dock_thug", { followers: ["dock_thug"] });
    [first, second] = game.combat.enemies;
    game.stats.presence = 1;
    game.stats.intellect = 1;
    game.skills.deception = 0;
    first.hp = 500;
    second.hp = 500;
    game.hp = 1000;
  } while (!failed(combatAction(game, { type: "parley", id: "lie", target: first.key })));
  assert.equal(aimedAt(game, "lie", first).disabled, true);
  assert.equal(aimedAt(game, "lie", first).why, "they won't believe another word");
  assert.throws(() => combatAction(game, { type: "parley", id: "lie", target: first.key }), /They won't believe another word/);
  assert.ok(!aimedAt(game, "lie", second).disabled);
  // One roll in twenty always fails, and then there's no second try.
  let fooled;
  do {
    fooled = persuasive(fightWith("dock_thug"));
    fooled.hp = 1000;
    combatAction(fooled, { type: "parley", id: "lie", target: "e0" });
  } while (fooled.combat);
  assert.match(fooled.pendingEvents.at(-1), /believed a lie the player told them/);
  assert.equal(fooled.bestiary.dock_thug.talked, 1);
});

test("a threat works, and they'll hold it against you", () => {
  const game = persuasive(fightWith("drift_raider"));
  const standing = game.factions.drift;
  const outcome = talkTo(game, "threaten");
  assert.equal(outcome.result, "talked");
  assert.equal(game.factions.drift, standing + PARLEY.approaches.threaten.standing);
  assert.match(game.pendingEvents.at(-1), /frightened off by the player, and won't forget it/);
  assert.match(outcome.summary, /backed off/);
  assert.ok(outcome.notes.some((note) => /^\[FACTION\] Kessara Syndicate -3/.test(note)));
});

test("machines and animals don't talk, but there are other ways", () => {
  const names = (game) => view(game).actions.filter((action) => action.group === "talk").map((action) => action.action.id);

  const drone = fightWith("security_drone");
  assert.deepEqual(names(drone), ["shutdown"]);
  assert.match(aimedAt(drone, "shutdown").detail, /^Hacking and Intellect$/);
  assert.equal(view(drone).reads.e0.feels, null);
  assert.throws(() => combatAction(drone, { type: "parley", id: "persuade", target: "e0" }), /It's a machine/);
  assert.throws(() => combatAction(drone, { type: "parley", id: "threaten", target: "e0" }), /Machines can't be frightened/);
  const hacked = persuasive(fightWith("security_drone"));
  const done = talkTo(hacked, "shutdown");
  assert.equal(done.result, "talked");
  assert.match(done.summary, /shut down/);
  assert.match(hacked.pendingEvents.at(-1), /could start up again/);

  const rat = fightWith("scrap_rat");
  assert.deepEqual(names(rat), ["threaten", "calm"]);
  assert.equal(aimedAt(rat, "threaten").label, "Scare it off");
  assert.equal(aimedAt(fightWith("dock_thug"), "threaten").label, "Threaten them");
  assert.deepEqual(parleyNotes(ENEMIES.scrap_rat).could, ["Scare it off", "Back away slowly"]);
  assert.match(aimedAt(rat, "calm").detail, /^Survival and /);
  assert.equal(talkTo(persuasive(rat), "calm").result, "talked");

  // A free synthetic is someone, not something: it can be reasoned with, though it can't be frightened.
  const sentinel = fightWith("unbound_sentinel");
  assert.deepEqual(names(sentinel), ["persuade", "pay", "lie", "shutdown"]);
  assert.equal(whyTheyFight(ENEMIES.unbound_sentinel).motive, "guarding");

  // The Choir's very hard to hack, and not at all to talk to.
  const choir = fightWith("choir_drone");
  assert.deepEqual(names(choir), ["shutdown"]);
  assert.ok(difficulty(choir, "shutdown") > difficulty(fightWith("security_drone"), "shutdown"));

  // In a mixed group, what's on offer depends on who's being aimed at.
  const mixed = fightWith("dock_thug", { followers: ["security_drone"] });
  const [thug, bot] = mixed.combat.enemies;
  assert.ok(aimedAt(mixed, "persuade", thug).odds);
  assert.equal(aimedAt(mixed, "persuade", bot).why, "it's a machine");
  assert.equal(aimedAt(mixed, "shutdown", thug).why, "it only works on machines");
  assert.ok(aimedAt(mixed, "shutdown", bot).odds);
});

test("the worst of them can't be talked out of it", () => {
  for (const id of Object.keys(ENEMIES).filter((one) => ENEMIES[one].boss)) {
    const game = fightWith(id);
    assert.deepEqual(view(game).actions.filter((action) => action.group === "talk"), [], id);
    assert.throws(() => combatAction(game, { type: "parley", id: "shutdown", target: "e0" }), /nothing's going to stop this one/i, id);
  }
  // Anyone with them still can be.
  const game = fightWith("choir_hunter", { followers: ["dock_thug"] });
  const [hunter, thug] = game.combat.enemies;
  assert.ok(aimedAt(game, "persuade", thug).odds);
  assert.equal(aimedAt(game, "persuade", hunter).disabled, true);
});

test("an unknown approach, or someone who isn't there, is refused without using up a turn", () => {
  const game = fightWith("dock_thug");
  const { round } = game.combat;
  assert.throws(() => combatAction(game, { type: "parley", id: "seduce", target: "e0" }), /Unknown combat action/);
  assert.throws(() => combatAction(game, { type: "parley", target: "e0" }), /Unknown combat action/);
  assert.equal(game.combat.round, round);
});

// ---- Giving up ----------------------------------------------------------

test("giving up ends it where it stands, and the story decides what they do with you", () => {
  const game = fightWith("dock_thug", { allies: ["voss"], reason: "You owe the Syndicate." });
  game.hp = 11;
  const credits = game.credits;
  const stress = game.needs.stress;
  const outcome = combatAction(game, { type: "surrender" });
  assert.equal(outcome.over, true);
  assert.equal(outcome.result, "surrendered");
  assert.equal(outcome.tone, "warn");
  assert.equal(game.combat, null);
  assert.equal(game.hp, 11);
  assert.equal(game.credits, credits);
  assert.ok(game.needs.stress > stress);
  assert.equal(outcome.summary, "You gave up to the Dock Thug.");
  const told = game.pendingEvents.at(-1);
  assert.match(told, /gave up/);
  assert.match(told, /at their mercy/);
  assert.match(told, /You owe the Syndicate/);
  assert.match(told, /It isn't the end of the game/);
  assert.ok(!game.bestiary.dock_thug.won);
  assert.equal(game.bestiary.dock_thug.gaveUp, 1);

  // A drone can't take a prisoner, so it's the people with it you give up to.
  const mixed = fightWith("security_drone", { followers: ["dock_thug"] });
  const gave = combatAction(mixed, { type: "surrender" });
  assert.equal(gave.summary, "You gave up to the Dock Thug.");
  assert.match(mixed.pendingEvents.at(-1), /gave up in the fight with the Dock Thug after/);
});

test("several who went the same way get one sentence between them", () => {
  const game = persuasive(fightWith("dock_thug", { followers: ["drift_raider"] }));
  for (const enemy of game.combat.enemies) enemy.hp = 500;
  game.credits = 5000;
  const [thug, raider] = game.combat.enemies;
  talkTo(game, "persuade", thug);
  const outcome = talkTo(game, "persuade", raider);
  assert.equal(outcome.summary, "The Dock Thug and the Drift Raider let you talk them out of it.");
  const paid = persuasive(fightWith("dock_thug", { followers: ["dock_thug"] }));
  for (const enemy of paid.combat.enemies) enemy.hp = 500;
  paid.credits = 5000;
  talkTo(paid, "pay", paid.combat.enemies[0]);
  const last = talkTo(paid, "pay", paid.combat.enemies[1]);
  const cost = 5000 - paid.credits;
  assert.equal(last.summary, `The Dock Thug and the second Dock Thug took ${cost} credits and left.`);
});

test("there's nobody to give up to if it's only machines or animals", () => {
  const offer = (game) => view(game).actions.find((action) => action.action.type === "surrender");
  for (const id of ["security_drone", "scrap_rat", "choir_drone"]) {
    const game = fightWith(id);
    assert.equal(offer(game).disabled, true, id);
    assert.throws(() => combatAction(game, { type: "surrender" }), /nobody here to give up to/);
    assert.ok(game.combat);
  }
  assert.ok(!offer(fightWith("dock_thug", { followers: ["security_drone"] })).disabled);
  // Once the thug's gone, there's only the drone.
  const game = fightWith("dock_thug", { followers: ["security_drone"] });
  game.combat.enemies[0].hp = 0;
  assert.equal(offer(game).disabled, true);
});

test("running away still works, and it's still last in the list", () => {
  const game = fightWith("dock_thug");
  assert.equal(view(game).actions.at(-1).action.type, "flee");
  assert.equal(view(game).actions.at(-2).action.type, "surrender");
});

// ---- The simulator, the story, and old saves ----------------------------

test("in the simulator, it all leaves everything exactly as it was", () => {
  const trials = [
    ["dock_thug", { type: "parley", id: "persuade", target: "e0" }],
    ["dock_thug", { type: "parley", id: "threaten", target: "e0" }],
    ["dock_thug", { type: "parley", id: "pay", target: "e0" }],
    ["dock_thug", { type: "parley", id: "lie", target: "e0" }],
    ["security_drone", { type: "parley", id: "shutdown", target: "e0" }],
    ["scrap_rat", { type: "parley", id: "calm", target: "e0" }],
    ["drift_raider", { type: "surrender" }],
  ];
  for (const [enemy, action] of trials) {
    const game = persuasive(newGame());
    game.credits = 5000;
    game.needs.stress = 20;
    const before = structuredClone(game);
    startCombat(game, enemy, { training: true });
    let outcome;
    do {
      // One roll in twenty always fails, and a lie doesn't get a second try.
      outcome = combatAction(game, game.combat.enemies[0].lied ? { type: "surrender" } : action);
    } while (!outcome.over);
    assert.equal(outcome.training, true, enemy);
    assert.match(outcome.message, /nothing carries over/);
    assert.deepEqual(game, before, `${enemy}: ${action.id ?? action.type}`);
  }
});

test("the story can say why they're fighting, and what it can't change", () => {
  const game = newGame();
  const started = runTool(game, "start_combat", { enemy: "dock_thug", enemy_followers: ["security_drone"], lead_in: "It starts.", why: "grudge", reason: "You put their brother in the Hot Bunks' infirmary.", faction: "drift", arrivals: [{ who: "drift_raider", side: "enemy", round: 2 }] }, newTurnLimits());
  assert.ok(!started.isError, started.result);
  const [thug, drone] = game.combat.enemies;
  assert.equal(thug.motive, "grudge");
  assert.equal(thug.faction, "drift");
  assert.equal(view(game).reads[thug.key].why, "You put their brother in the Hot Bunks' infirmary.");
  // A machine has no brother.
  assert.equal(drone.motive, "programmed");
  assert.equal(drone.reason, null);
  assert.equal(drone.faction, null);
  assert.equal(view(game).reads[drone.key].why, PARLEY.motives.programmed.says);
  // Someone who turns up has the same reasons.
  game.hp = 1000;
  thug.hp = 1000;
  drone.hp = 1000;
  combatAction(game, { type: "cover" });
  assert.equal(game.combat.enemies[2].motive, "grudge");

  const fresh = newGame();
  assert.ok(runTool(fresh, "start_combat", { enemy: "dock_thug", lead_in: "It starts.", why: "boredom" }, newTurnLimits()).isError);
  assert.equal(fresh.combat, null);
  // Only reasons a person can have are on offer.
  const schema = TOOL_DEFS.find((tool) => tool.name === "start_combat").input_schema.properties;
  assert.ok(schema.why.enum.includes("paid"));
  for (const fixed of ["hunger", "programmed", "choir"]) assert.ok(!schema.why.enum.includes(fixed));
  assert.ok(!Object.keys(ENEMIES).some((id) => schema.why.enum.includes(id)));
  // A long reason is cut down to something that fits.
  const wordy = newGame();
  startCombat(wordy, "dock_thug", { reason: "x".repeat(400) });
  assert.ok(wordy.combat.enemies[0].reason.length <= 160);
});

test("anyone without a reason of their own gets one from what they are", () => {
  assert.equal(whyTheyFight({ archetype: "beast" }).motive, "hunger");
  assert.equal(whyTheyFight({ archetype: "scoundrel" }).motive, "greed");
  assert.equal(whyTheyFight({ machine: true }).motive, "programmed");
  assert.equal(whyTheyFight({ named: true, machine: true }).motive, "cause");
  assert.equal(whyTheyFight({}).motive, "paid");
  // People with files can be fought, and have reasons and feelings like anyone else.
  const game = fightWith("tarrow");
  assert.ok(aimedAt(game, "persuade").odds);
  assert.equal(game.combat.enemies[0].faction, NOTABLES.tarrow.faction);
  // The voice of the Choir isn't someone you can reason with.
  assert.equal(view(fightWith("cantor")).actions.filter((action) => action.group === "talk").length, 0);
  assert.equal(view(fightWith("cantor")).reads.e0.why, PARLEY.motives.choir.says);
});

test("the Bestiary says why they fight and what you could try", () => {
  const game = newGame();
  const thug = publicState(game).enemies.find((enemy) => enemy.id === "dock_thug");
  assert.equal(thug.talk.why, PARLEY.motives.paid.says);
  assert.deepEqual(thug.talk.could, ["Talk them down", "Threaten them", "Pay them off", "Lie to them"]);
  const drone = publicState(game).enemies.find((enemy) => enemy.id === "security_drone");
  assert.deepEqual(drone.talk.could, ["Shut it down"]);
});

test("a fight that was going on in an older save can be talked out of, too", () => {
  const game = fightWith("drift_raider");
  const [enemy] = game.combat.enemies;
  delete enemy.motive;
  delete enemy.reason;
  delete enemy.faction;
  delete game.combat.story;
  game.bestiary.drift_raider = { fought: 2, won: 1, lost: 1, fled: 0 };
  const loaded = JSON.parse(JSON.stringify(game));
  persuasive(loaded);
  assert.equal(view(loaded).reads.e0.why, PARLEY.motives.paid.says);
  assert.equal(talkTo(loaded, "persuade", loaded.combat.enemies[0]).result, "talked");
  assert.deepEqual(loaded.bestiary.drift_raider, { fought: 3, won: 1, lost: 1, fled: 0, talked: 1, gaveUp: 0 });
  // Even one from the days before fights had two sides.
  const ancient = structuredClone(newGame());
  ancient.version = 4;
  ancient.bestiary = {};
  ancient.pendingEvents = [];
  ancient.campaign = null;
  ancient.combat = { enemyId: "dock_thug", enemy: { ...ENEMIES.dock_thug, id: "dock_thug", maxHp: ENEMIES.dock_thug.hp, hp: 3 }, round: 2, stunned: false, guard: 0, survivorUsed: false, training: false };
  const migrated = migrateGame(ancient);
  assert.doesNotMatch(JSON.stringify(view(migrated)), /NaN|undefined/);
  assert.match(aimedAt(migrated, "pay", migrated.combat.enemies[0]).label ?? aimedAt(migrated, "pay", migrated.combat.enemies[0]).why, /\d+/);
  // Likewise a machine, which is still a machine.
  const old = fightWith("security_drone");
  delete old.combat.enemies[0].motive;
  assert.deepEqual(view(old).actions.filter((action) => action.group === "talk").map((action) => action.action.id), ["shutdown"]);
});

test("every enemy, every character kind, every approach: sane numbers, and every fight finishes", () => {
  const kinds = ["officer", "smuggler", "adept", "engineer", "envoy", "marine", "doctor", "ghost"];
  const ids = Object.keys(ENEMIES);
  let round = 0;
  for (const id of ids) {
    for (const kind of kinds) {
      round += 1;
      const game = fightWith(id, { followers: round % 3 ? [] : [ids[round % ids.length]] }, 300 + round, kind);
      const before = JSON.stringify(game);
      const fight = view(game);
      assert.equal(JSON.stringify(game), before, "looking doesn't change anything");
      assert.doesNotMatch(JSON.stringify(fight), /NaN|undefined/);
      assert.ok(fight.reads[fight.enemies[0].key].why);
      for (const action of fight.actions.filter((one) => one.group === "talk")) {
        for (const aim of Object.values(action.targets)) {
          assert.ok(aim.disabled ? aim.why : aim.odds >= 5 && aim.odds <= 95, JSON.stringify(aim));
        }
      }
      let outcome;
      let tries = 0;
      do {
        // Whatever's on offer, taking turns with whatever's open, until it's over one way or another.
        game.hp = Math.max(game.hp, 20);
        const open = view(game).actions.filter((action) => {
          const target = view(game).enemies.find((one) => one.hp > 0 && !one.out)?.key;
          return !action.disabled && !action.targets?.[target]?.disabled;
        });
        const choice = open[tries % open.length];
        const aim = view(game).enemies.find((one) => one.hp > 0 && !one.out).key;
        outcome = combatAction(game, { ...choice.action, target: aim });
        tries += 1;
        assert.ok(outcome.events.every((event) => event.text || event.note), JSON.stringify(outcome.events));
        assert.doesNotMatch(JSON.stringify(outcome.events), /NaN|undefined|\{enemy\}|\{Enemy\}|\{price\}/);
      } while (!outcome.over && tries < 3000);
      assert.ok(outcome.over, `${kind} against ${id}`);
      assert.equal(game.combat, null);
      assert.ok(game.hp >= 1);
      assert.ok(game.credits >= 0);
      assert.ok(["victory", "defeat", "fled", "talked", "surrendered"].includes(outcome.result));
      assert.doesNotMatch(outcome.summary, /\{/);
      assert.doesNotMatch(game.pendingEvents.at(-1), /\{|undefined/);
    }
  }
});

// ---- With the stand-in AI, and over the real server ---------------------

function sendReply(res, body, blocks, stop) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const usage = { input_tokens: 4, output_tokens: 1 };
  send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage } });
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage });
  send("message_stop", {});
  res.end();
}

const serverData = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-parley-server-"));
let standIn = null;
let requests = [];
let child = null;
let port = 0;
let nextFight = null;

const freePort = () => new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port: free } = probe.address();
    probe.close(() => resolve(free));
  });
});

async function post(route, body) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const type = res.headers.get("content-type") ?? "";
  return type.includes("application/json") ? { status: res.status, ...(await res.json()) } : { status: res.status, text: await res.text() };
}

before(async () => {
  standIn = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    if (nextFight) {
      const input = nextFight;
      nextFight = null;
      sendReply(res, body, [{ type: "tool_use", id: "fight_1", name: "start_combat", input }], "tool_use");
    } else sendReply(res, body, [{ type: "text", text: "A stand-in scene.\n\n> Look around" }], "end_turn");
  });
  await new Promise((resolve) => { standIn.listen(0, "127.0.0.1", resolve); });
  fs.mkdirSync(path.join(serverData, "saves"), { recursive: true });
  fs.writeFileSync(path.join(serverData, "settings.json"), JSON.stringify({ provider: "claude", model: "claude-haiku-5-5", effort: "low", apiKey: "not-a-real-key" }));
  port = await freePort();
  child = spawn(process.execPath, ["server.js"], { cwd: projectDir, env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${standIn.address().port}`, GAME_DATA_DIR: serverData, PORT: String(port) }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("running at")) resolve(); });
    child.on("exit", () => reject(new Error("The server stopped.")));
  });
});

after(() => {
  child?.removeAllListeners("exit");
  child?.kill();
  standIn?.close();
  try {
    fs.rmSync(serverData, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

test("over the real server: the game master starts a fight and says why, the player talks them down, and the game master hears how it went", async () => {
  const made = await post("/api/new", { draft: randomDraft({ seed: 42, archetype: "envoy" }) });
  assert.equal(made.status, 200, JSON.stringify(made));
  nextFight = { enemy: "desperate_refugee", lead_in: "A thin figure steps out, holding a knife.", why: "afraid", reason: "They think you've come to take their ship's rations." };
  const started = await post("/api/chat", { event: "start" });
  assert.equal(started.status, 200);
  const asked = requests.at(-1);
  assert.ok(asked.system.some?.((part) => part.text?.includes("Talking in fights")) ?? JSON.stringify(asked.system).includes("Talking in fights"));
  assert.ok(asked.tools.find((tool) => tool.name === "start_combat").input_schema.properties.why);

  let state = await fetch(`http://127.0.0.1:${port}/api/state`).then((res) => res.json());
  assert.ok(state.game.combat, JSON.stringify(state.game.transcript.slice(-2)));
  const key = state.game.combat.enemies[0].key;
  assert.equal(state.game.combat.reads[key].why, "They think you've come to take their ship's rations.");

  const talked = requests.length;
  let reply;
  let rounds = 0;
  do {
    reply = await post("/api/combat", { type: "parley", id: "persuade", target: key });
    assert.equal(reply.status, 200, JSON.stringify(reply));
    rounds += 1;
  } while (!reply.outcome.over && rounds < 60);
  assert.equal(reply.outcome.over, true);
  assert.equal(reply.outcome.result, "talked", JSON.stringify(reply.outcome));
  assert.equal(requests.length, talked, "none of it goes near the AI");
  assert.equal(reply.game.combat, null);
  const line = reply.game.transcript.findLast((entry) => entry.role === "combat");
  assert.match(line.text, /let you talk them out of it/);

  const continued = await post("/api/chat", { event: "continue" });
  assert.equal(continued.status, 200);
  const told = JSON.stringify(requests.at(-1).messages.at(-1));
  assert.match(told, /talked out of fighting by the player/);
  assert.match(told, /still out there/);
  state = await fetch(`http://127.0.0.1:${port}/api/state`).then((res) => res.json());
  assert.equal(state.game.bestiary?.desperate_refugee?.talked ?? 1, 1);
});
