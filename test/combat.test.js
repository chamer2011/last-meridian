// Fights with two whole sides: followers, people arriving partway through, aiming at a
// particular enemy, and the console art each fighter is drawn with.

import assert from "node:assert/strict";
import { test } from "node:test";
import { NOTABLES } from "../src/character-data.js";
import { enemyNumbers, simulatorFollowers } from "../src/combat.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { ENEMIES } from "../src/data.js";
import { migrateGame } from "../src/migrate.js";
import { NPC_ARCHETYPES } from "../src/npc.js";
import { combatAction, publicState, setDifficulty, startCombat } from "../src/rules.js";
import { TOOL_DEFS, newTurnLimits, runTool } from "../src/tools.js";
import { COMBAT_ART } from "../src/world.js";
import { fallenArt, mirrorArt, trimmedArt } from "../public/art.js";

const newGame = (seed = 7, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
const view = (game) => publicState(game).combat;
const tool = (game, input) => runTool(game, "start_combat", { lead_in: "It starts.", ...input }, newTurnLimits());

// Keeps a fight going for as long as a test needs it to.
function toughen(game, { enemies = true } = {}) {
  game.hp = 1000;
  if (enemies) for (const enemy of game.combat.enemies) enemy.hp = 1000;
}

function playOut(game, action = { type: "attack" }) {
  let outcome;
  let rounds = 0;
  do {
    game.hp = 1000;
    outcome = combatAction(game, action);
    rounds += 1;
  } while (!outcome.over && rounds < 2000);
  assert.ok(outcome.over);
  return outcome;
}

// ---- Who's in the fight -------------------------------------------------

test("both sides can have followers, and each fighter can be told apart", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { followers: ["dock_thug", "security_drone"], allies: ["voss", "tarrow"] });
  const fight = view(game);
  assert.equal(fight.you.key, "you");
  assert.equal(fight.you.name, game.name);
  assert.deepEqual(fight.allies.map((a) => a.name), ["Commander Ilya Voss", "Lieutenant Kara Tarrow"]);
  assert.deepEqual(fight.enemies.map((e) => e.name), ["Dock Thug", "Dock Thug #2", "Security Drone"]);
  const keys = [fight.you, ...fight.allies, ...fight.enemies].map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
  // In the fight's text, the second one is called that.
  assert.equal(game.combat.enemies[1].prose, "the second Dock Thug");
  assert.equal(game.combat.allies[0].prose, "Ilya Voss");
  // Stats come from their files.
  assert.equal(fight.allies[0].maxHp, NOTABLES.voss.combat.hp);
  assert.equal(fight.enemies[2].maxHp, enemyNumbers(ENEMIES.security_drone).hp);
});

test("anyone can go by another name in a fight, and keeps their stats", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { called: "a Syndicate Courier", followers: ["dock_thug as Syndicate Guard"], allies: ["concord_deserter as Hired Gun"] });
  const fight = view(game);
  assert.deepEqual(fight.enemies.map((e) => e.name), ["Syndicate Courier", "Syndicate Guard"]);
  assert.equal(fight.allies[0].name, "Hired Gun");
  assert.equal(fight.allies[0].maxHp, ENEMIES.concord_deserter.hp);
  assert.equal(game.combat.enemies[1].prose, "the Syndicate Guard");
});

test("a bad request is refused, and leaves no fight behind", () => {
  const cases = [
    { followers: ["nobody_at_all"] },
    { allies: ["nobody_at_all"] },
    { followers: ["dock_thug", "dock_thug", "dock_thug", "dock_thug"] },
    { allies: ["voss", "tarrow", "marrow", "pell"] },
    { arrivals: [1, 2, 3, 4].map(() => ({ who: "dock_thug", side: "enemy", round: 2 })) },
    { allies: ["voss", "voss"] },
    { allies: ["voss"], followers: ["voss"] },
    { allies: ["voss"], arrivals: [{ who: "voss", side: "ally", round: 2 }] },
  ];
  for (const options of cases) {
    const game = newGame();
    const stress = game.needs.stress;
    assert.throws(() => startCombat(game, "dock_thug", options), undefined, JSON.stringify(options));
    assert.equal(game.combat, null);
    assert.equal(game.needs.stress, stress);
  }
});

test("someone dead, missing or captured can't join a fight", () => {
  for (const status of ["dead", "missing", "captured"]) {
    const game = newGame();
    const contact = game.contacts.find((c) => c.name === NOTABLES.voss.name);
    contact.status = status;
    assert.throws(() => startCombat(game, "dock_thug", { allies: ["voss"] }), new RegExp(status));
    assert.throws(() => startCombat(game, "voss"), new RegExp(status));
    assert.equal(game.combat, null);
  }
  const game = newGame();
  game.contacts.find((c) => c.name === NOTABLES.voss.name).status = "alive";
  assert.doesNotThrow(() => startCombat(game, "dock_thug", { allies: ["voss"] }));
});

// ---- A round ------------------------------------------------------------

test("followers act each round, and go after what the player is aiming at", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { followers: ["dock_thug"], allies: ["voss", "tarrow"] });
  toughen(game);
  const aim = game.combat.enemies[1].key;
  const followers = game.combat.allies.map((a) => a.key);
  const seen = new Set();
  for (let round = 0; round < 12; round += 1) {
    game.hp = 1000;
    const { events } = combatAction(game, { type: "attack", target: aim });
    const actors = events.filter((e) => followers.includes(e.by));
    assert.equal(actors.length, 2);
    for (const event of actors) {
      assert.equal(event.on, aim);
      seen.add(event.by);
    }
    // The player's own attack lands where they aimed.
    assert.equal(events.find((e) => e.by === "you").on, aim);
  }
  assert.equal(seen.size, 2);
});

test("the player acts first, then followers, then the enemies", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { allies: ["voss"] });
  toughen(game);
  const order = combatAction(game, { type: "cover" }).events.map((e) => e.by).filter(Boolean);
  assert.deepEqual(order, ["you", game.combat.allies[0].key, game.combat.enemies[0].key]);
});

test("a fallen enemy stops acting, and the fight goes on until they're all down", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { followers: ["dock_thug"] });
  const [first, second] = game.combat.enemies;
  second.hp = 1000;
  first.hp = 1;
  first.defense = -100;
  let outcome;
  do {
    game.hp = 1000;
    outcome = combatAction(game, { type: "attack", target: first.key });
  } while (first.hp > 0);
  assert.equal(outcome.over, false);
  assert.ok(outcome.events.some((e) => e.on === first.key && e.down));
  assert.ok(view(game).enemies[0].hp === 0);
  // Aiming at someone who's down falls through to who's left.
  game.hp = 1000;
  const next = combatAction(game, { type: "attack", target: first.key });
  assert.equal(next.events.find((e) => e.by === "you").on, second.key);
  assert.ok(!next.events.some((e) => e.by === first.key));
  second.hp = 1;
  second.defense = -100;
  assert.equal(playOut(game).result, "victory");
});

test("a follower can be knocked out, and then stops fighting while the fight goes on", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { allies: ["voss"] });
  toughen(game);
  const [ally] = game.combat.allies;
  const [enemy] = game.combat.enemies;
  ally.hp = 1;
  ally.defense = -100;
  enemy.attack = 100;
  let downEvent;
  for (let round = 0; round < 500 && !downEvent; round += 1) {
    game.hp = 1000;
    downEvent = combatAction(game, { type: "cover" }).events.find((e) => e.on === ally.key && e.down);
  }
  assert.ok(downEvent);
  assert.equal(downEvent.tone, "bad");
  assert.ok(game.combat);
  assert.equal(view(game).allies[0].hp, 0);
  for (let round = 0; round < 20; round += 1) {
    game.hp = 1000;
    const { events } = combatAction(game, { type: "cover" });
    assert.ok(!events.some((e) => e.by === ally.key || e.on === ally.key));
  }
});

test("the fight is lost when the player falls, even with followers still standing", () => {
  const game = newGame();
  startCombat(game, "choir_hunter", { allies: ["voss"] });
  game.combat.allies[0].defense = 1000;
  game.combat.enemies[0].attack = 100;
  game.combat.enemies[0].hp = 100000;
  let outcome;
  do outcome = combatAction(game, { type: "cover" }); while (!outcome.over);
  assert.equal(outcome.result, "defeat");
  assert.ok(game.hp >= 1);
  assert.equal(outcome.followers[0].down, false);
  assert.match(game.pendingEvents[0], /lost the fight/);
  assert.match(game.pendingEvents[0], /Fighting beside them: Commander Ilya Voss \(\d+\/\d+ health\)/);
});

test("people arrive on their round, on either side", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { arrivals: [{ who: "tarrow", side: "ally", round: 2 }, { who: "drift_raider", side: "enemy", round: 3 }] });
  toughen(game);
  assert.equal(view(game).allies.length, 0);
  assert.equal(view(game).enemies.length, 1);

  const first = combatAction(game, { type: "cover" });
  assert.equal(view(game).allies.length, 1);
  assert.equal(view(game).enemies.length, 1);
  const friend = first.events.find((e) => e.joined);
  assert.equal(friend.joined, "ally");
  assert.equal(friend.fighter.name, "Lieutenant Kara Tarrow");
  assert.equal(friend.tone, "good");
  assert.ok(friend.fighter.art.length > 0);

  game.hp = 1000;
  const second = combatAction(game, { type: "cover" });
  assert.equal(view(game).enemies.length, 2);
  const foe = second.events.find((e) => e.joined);
  assert.equal(foe.joined, "enemy");
  assert.equal(foe.fighter.name, ENEMIES.drift_raider.name);
  assert.equal(foe.tone, "bad");

  // From then on they fight like anyone else.
  game.combat.enemies[1].hp = 1000;
  game.hp = 1000;
  const third = combatAction(game, { type: "cover" });
  assert.ok(third.events.some((e) => e.by === game.combat.allies[0].key));
  assert.ok(third.events.some((e) => e.by === game.combat.enemies[1].key));
  assert.ok(!third.events.some((e) => e.joined));
});

test("there's no room for an arrival on a full side", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { allies: ["voss", "tarrow", "marrow"], arrivals: [{ who: "pell", side: "ally", round: 2 }] });
  toughen(game);
  const { events } = combatAction(game, { type: "cover" });
  assert.ok(!events.some((e) => e.joined));
  assert.equal(view(game).allies.length, 3);
  assert.equal(game.combat.arrivals.length, 0);
});

test("a fight carries on after being saved and loaded, arrivals included", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { allies: ["voss"], arrivals: [{ who: "tarrow", side: "ally", round: 2 }] });
  toughen(game);
  const loaded = JSON.parse(JSON.stringify(game));
  const { events } = combatAction(loaded, { type: "cover" });
  assert.ok(events.some((e) => e.joined));
  assert.equal(view(loaded).allies.length, 2);
  for (const enemy of loaded.combat.enemies) {
    enemy.hp = 1;
    enemy.defense = -100;
  }
  assert.equal(playOut(loaded).result, "victory");
});

test("every fight finishes, with sane numbers all the way through", () => {
  const names = Object.keys(ENEMIES);
  for (let i = 0; i < 60; i += 1) {
    const game = newGame(100 + i);
    const pick = () => names[Math.floor(Math.random() * names.length)];
    startCombat(game, pick(), {
      followers: Array.from({ length: i % 4 }, pick),
      allies: ["voss", "tarrow", "marrow"].slice(0, i % 4),
      arrivals: i % 2 ? [{ who: pick(), side: "enemy", round: 2 }] : [],
    });
    let outcome;
    let rounds = 0;
    do {
      outcome = combatAction(game, { type: "attack" });
      rounds += 1;
      assert.doesNotMatch(JSON.stringify(outcome.events), /NaN|undefined|null,"tone"/);
      assert.ok(outcome.events.every((e) => e.text || e.note), JSON.stringify(outcome.events));
      if (game.combat) assert.doesNotMatch(JSON.stringify(view(game)), /NaN/);
    } while (!outcome.over && rounds < 5000);
    assert.ok(outcome.over);
    assert.equal(game.combat, null);
    assert.ok(game.hp >= 1);
    assert.ok(["victory", "defeat"].includes(outcome.result));
  }
});

// ---- Aiming -------------------------------------------------------------

test("the odds and limits of an action depend on who it's aimed at", () => {
  const game = newGame();
  game.perks.push("system_spike", "terrifying_glare");
  game.energy = 20;
  startCombat(game, "dock_thug", { followers: ["security_drone"] });
  const [thug, drone] = game.combat.enemies;
  thug.defense = 5;
  drone.defense = 25;
  const { actions } = view(game);
  const attack = actions.find((a) => a.action.type === "attack");
  assert.ok(attack.targets[thug.key].odds > attack.targets[drone.key].odds);
  const spike = actions.find((a) => a.action.id === "spike");
  assert.equal(spike.targets[thug.key].disabled, true);
  assert.equal(spike.targets[thug.key].why, "only works on machines");
  assert.ok(spike.targets[drone.key].odds >= 5);
  const glare = actions.find((a) => a.action.id === "glare");
  assert.equal(glare.targets[drone.key].disabled, true);
  assert.ok(glare.targets[thug.key].odds >= 5);

  // The rules agree with the menu, and a refused action costs nothing.
  const energy = game.energy;
  const round = game.combat.round;
  assert.throws(() => combatAction(game, { type: "ability", id: "spike", target: thug.key }));
  assert.throws(() => combatAction(game, { type: "ability", id: "glare", target: drone.key }));
  assert.equal(game.energy, energy);
  assert.equal(game.combat.round, round);
  game.hp = 1000;
  assert.doesNotThrow(() => combatAction(game, { type: "ability", id: "spike", target: drone.key }));
  assert.ok(game.energy < energy);
});

test("every action goes in one of the window's two columns, where talking goes under attacking", () => {
  const game = newGame();
  game.perks.push("field_medic", "overcharge", "evasive", "resonant_push", "system_spike", "foresight", "terrifying_glare", "rally_cry");
  game.inventory.medkit = 1;
  startCombat(game, "dock_thug");
  for (const action of view(game).actions) assert.ok(["attack", "talk", "other"].includes(action.group), action.label);
  assert.ok(view(game).actions.filter((a) => a.group === "attack").length >= 5);
});

test("a stunned enemy loses its turn, and only that one", () => {
  const game = newGame();
  game.perks.push("terrifying_glare");
  game.energy = 200;
  startCombat(game, "dock_thug", { followers: ["dock_thug"] });
  toughen(game);
  const [first, second] = game.combat.enemies;
  first.defense = -100;
  let events;
  do {
    game.hp = 1000;
    ({ events } = combatAction(game, { type: "ability", id: "glare", target: first.key }));
  } while (!events.some((e) => e.by === "you" && !e.missed));
  assert.ok(events.some((e) => e.on === first.key && !e.by));
  assert.ok(!events.some((e) => e.by === first.key));
  assert.ok(events.some((e) => e.by === second.key));
});

test("Rally steadies the player's whole side", () => {
  const game = newGame();
  game.perks.push("rally_cry");
  game.energy = 20;
  game.hp = 5;
  startCombat(game, "dock_thug", { allies: ["voss"] });
  const [ally] = game.combat.allies;
  ally.hp = 5;
  assert.match(view(game).actions.find((a) => a.action.id === "rally").detail, /whole side/);
  const { events } = combatAction(game, { type: "ability", id: "rally" });
  const rally = events.find((e) => e.gained);
  assert.ok(rally.hp.you > 5);
  assert.ok(rally.hp[ally.key] > 5);
});

// ---- Running away -------------------------------------------------------

test("the more enemies there are, the harder it is to get away", () => {
  const escape = (followers) => {
    const game = newGame();
    startCombat(game, "dock_thug", { followers });
    return view(game).actions.at(-1).odds;
  };
  assert.ok(escape([]) > escape(["dock_thug", "dock_thug"]));
});

test("a boss stops anyone running, until it's down", () => {
  const boss = Object.keys(ENEMIES).find((id) => ENEMIES[id].boss);
  const game = newGame();
  startCombat(game, boss, { followers: ["dock_thug"] });
  assert.equal(view(game).actions.at(-1).disabled, true);
  assert.throws(() => combatAction(game, { type: "flee" }));
  game.combat.enemies[0].hp = 0;
  assert.ok(!view(game).actions.at(-1).disabled);
});

// ---- How it ends --------------------------------------------------------

test("rewards add up across the enemies, and followers take a share of the credit", () => {
  const game = newGame();
  game.xp = 0;
  const credits = game.credits;
  startCombat(game, "dock_thug", { followers: ["dock_thug"], allies: ["voss"] });
  for (const enemy of game.combat.enemies) {
    enemy.hp = 1;
    enemy.defense = -100;
  }
  const outcome = playOut(game);
  assert.equal(outcome.result, "victory");
  const xp = Math.round((ENEMIES.dock_thug.xp * 2) / 1.5);
  assert.match(outcome.math, new RegExp(`\\+${xp} XP`));
  assert.ok(game.credits >= credits);
  assert.equal(game.bestiary.dock_thug.fought, 1);
  assert.equal(game.bestiary.dock_thug.won, 1);
  assert.equal(outcome.tone, "good");
  assert.match(outcome.summary, /^You and your followers beat the Dock Thug and the second Dock Thug in \d+ rounds?\.$/);
});

test("the AI hears who was in the fight, and who was left standing", () => {
  const game = newGame();
  startCombat(game, "tarrow", { allies: ["voss", "marrow"] });
  game.combat.allies[1].hp = 0;
  game.combat.enemies[0].hp = 1;
  game.combat.enemies[0].defense = -100;
  playOut(game);
  const told = game.pendingEvents[0];
  assert.match(told, /Lieutenant Kara Tarrow/);
  assert.match(told, /the story decides/);
  assert.match(told, /Commander Ilya Voss \(\d+\/\d+ health\)/);
  assert.match(told, /Chief Engineer Dunn Marrow \(knocked out/);
});

test("running away takes the followers along", () => {
  const game = newGame();
  startCombat(game, "dock_thug", { allies: ["voss"] });
  // Otherwise a follower might win the fight before the player gets away.
  game.combat.enemies[0].hp = 100000;
  const outcome = playOut(game, { type: "flee" });
  assert.equal(outcome.result, "fled");
  assert.match(game.pendingEvents[0], /followers got out/);
  assert.equal(game.bestiary.dock_thug.fled, 1);
});

test("a simulated fight with followers leaves everything exactly as it was", () => {
  for (let i = 0; i < 15; i += 1) {
    const game = newGame(200 + i);
    game.needs.stress = 20;
    const before = structuredClone(game);
    startCombat(game, "void_stalker", { training: true, ...simulatorFollowers(game, "void_stalker") });
    assert.equal(view(game).training, true);
    assert.equal(view(game).allies.length, 1);
    let outcome;
    do outcome = combatAction(game, { type: "attack" }); while (!outcome.over);
    assert.equal(outcome.training, true);
    assert.match(outcome.message, /nothing carries over/);
    assert.deepEqual(game, before);
  }
});

test("the simulator picks the strongest crew who can still fight", () => {
  const game = newGame();
  const first = simulatorFollowers(game, "dock_thug");
  assert.equal(first.allies.length, 1);
  assert.deepEqual(first.arrivals.map((a) => a.side), ["ally", "enemy"]);
  const top = first.allies[0];
  game.contacts.find((c) => c.name === NOTABLES[top].name).status = "dead";
  assert.notEqual(simulatorFollowers(game, "dock_thug").allies[0], top);
  // A person can't be fought twice at once.
  assert.ok(!simulatorFollowers(newGame(), "tarrow").arrivals.some((a) => a.who === "tarrow"));
  assert.doesNotThrow(() => startCombat(newGame(), "corvane", { training: true, ...simulatorFollowers(newGame(), "corvane") }));
});

// ---- The AI's request ---------------------------------------------------

test("the AI can bring followers into a fight, and is told when it can't", () => {
  const game = newGame();
  const started = tool(game, { enemy: "dock_thug", enemy_followers: ["dock_thug"], allies: ["voss"], arrivals: [{ who: "tarrow", side: "ally", round: 2 }] });
  assert.ok(!started.isError, started.result);
  assert.equal(started.narration, "It starts.");
  assert.match(started.notice, /The fight begins: Dock Thug, Dock Thug #2, with Commander Ilya Voss at your side/);
  assert.match(started.result, /Dock Thug, Dock Thug #2/);
  assert.equal(game.combat.arrivals.length, 1);
  assert.equal(view(game).opening, "It starts.");

  for (const bad of [
    { enemy: "dock_thug", allies: "voss" },
    { enemy: "dock_thug", allies: [7] },
    { enemy: "dock_thug", arrivals: ["tarrow"] },
    { enemy: "dock_thug", arrivals: [{ side: "ally", round: 2 }] },
    { enemy: "dock_thug", arrivals: [{ who: "tarrow", side: "nobody", round: 2 }] },
    { enemy: "dock_thug", arrivals: [{ who: "tarrow", side: "ally", round: "soon" }] },
    { enemy: "dock_thug", allies: ["no_such_person"] },
  ]) {
    const fresh = newGame();
    const refused = tool(fresh, bad);
    assert.ok(refused.isError, JSON.stringify(bad));
    assert.equal(fresh.combat, null);
  }
});

test("the tool lists no one by name, so the AI's tools never change during play", () => {
  const schema = JSON.stringify(TOOL_DEFS.find((t) => t.name === "start_combat").input_schema);
  assert.ok(!schema.includes("dock_thug\","));
  for (const id of Object.keys(ENEMIES)) assert.ok(!schema.includes(`"${id}"`), id);
});

test("nothing secret reaches the fight window", () => {
  const game = newGame();
  startCombat(game, "vael", { allies: ["voss"] });
  const sent = JSON.stringify(view(game));
  assert.ok(!sent.includes(NOTABLES.vael.secrets));
  assert.ok(!sent.includes(NOTABLES.voss.secrets));
  assert.ok(!sent.includes(NOTABLES.voss.goals));
});

// ---- Older saves --------------------------------------------------------

test("a save from the middle of a one-on-one fight carries on with two sides", () => {
  const game = newGame();
  const save = structuredClone(game);
  save.version = 4;
  save.bestiary = {};
  save.pendingEvents = [];
  save.campaign = null;
  save.combat = {
    enemyId: "security_drone",
    enemy: { ...ENEMIES.security_drone, id: "security_drone", maxHp: ENEMIES.security_drone.hp, hp: 3 },
    round: 5,
    stunned: true,
    guard: 3,
    survivorUsed: true,
    training: false,
    intro: "It hovers.",
  };
  const migrated = migrateGame(save);
  assert.equal(migrated.version, 15);
  const fight = view(migrated);
  assert.equal(fight.round, 5);
  assert.equal(fight.enemies[0].hp, 3);
  assert.equal(fight.enemies[0].maxHp, ENEMIES.security_drone.hp);
  assert.equal(fight.enemies[0].stunned, true);
  assert.equal(fight.opening, "It hovers.");
  assert.deepEqual(fight.allies, []);
  assert.equal(migrated.combat.enemies[0].prose, `the ${ENEMIES.security_drone.name}`);
  assert.equal(playOut(migrated).over, true);
});

test("a simulated fight in an older save takes its lines back out of the story", () => {
  const game = newGame();
  const save = structuredClone(game);
  save.version = 4;
  save.bestiary = {};
  save.pendingEvents = [];
  save.transcript = [{ role: "narrator", text: "The story." }, { role: "notice", text: "[SIM] Running." }, { role: "combat", text: "You swing." }];
  save.combat = {
    enemyId: "dock_thug",
    enemy: { ...ENEMIES.dock_thug, maxHp: ENEMIES.dock_thug.hp },
    round: 2,
    stunned: false,
    guard: 0,
    training: true,
    transcriptStart: 1,
    snapshot: { hp: game.hp },
  };
  const migrated = migrateGame(save);
  assert.deepEqual(migrated.transcript.filter((entry) => !entry.text.startsWith("[FLEET]")).map((entry) => entry.text), ["The story."]);
  assert.equal(view(migrated).training, true);
});

test("a save with no fight going just moves up a version", () => {
  const save = { ...structuredClone(newGame()), version: 4, bestiary: {}, pendingEvents: [], combat: null };
  const migrated = migrateGame(save);
  assert.equal(migrated.version, 15);
  assert.equal(migrated.combat, null);
});

// ---- The art ------------------------------------------------------------

test("every figure is plain console text of a sensible size", () => {
  for (const [id, lines] of Object.entries(COMBAT_ART)) {
    assert.ok(lines.length >= 1 && lines.length <= 6, `${id} is ${lines.length} lines tall`);
    for (const line of lines) {
      assert.match(line, /^[\x20-\x7e]*$/, id);
      assert.ok(line.length <= 14, `${id} is too wide: ${line}`);
    }
    assert.ok(lines.some((line) => line.trim()), `${id} is empty`);
  }
  assert.ok(COMBAT_ART.fallen);
  assert.ok(COMBAT_ART.wreck);
});

test("everyone in the world files has art that exists", () => {
  for (const [id, person] of Object.entries(NOTABLES)) assert.ok(COMBAT_ART[person.combat.art], id);
  for (const [id, enemy] of Object.entries(ENEMIES)) assert.ok(COMBAT_ART[enemy.art], id);
  for (const [id, type] of Object.entries(NPC_ARCHETYPES)) assert.ok(COMBAT_ART[type.art], id);
});

test("figures turn to face the other way", () => {
  assert.deepEqual(mirrorArt(["/(o", "]->"]), ["o)\\", "<-["]);
  // Short lines are padded first, so that a figure stays in one piece.
  assert.deepEqual(mirrorArt(["ab", "abcd"]), ["  da", "bcda"]);
  for (const lines of Object.values(COMBAT_ART)) {
    const width = Math.max(...lines.map((line) => line.length));
    const twice = mirrorArt(mirrorArt(lines));
    assert.deepEqual(twice, lines.map((line) => line.padEnd(width)));
  }
});

test("figures take only the height they need, and keep it when they fall", () => {
  assert.deepEqual(trimmedArt(["", "  ", "ab", "", "cd"]), ["ab", "", "cd"]);
  assert.deepEqual(trimmedArt(["ab"]), ["ab"]);
  for (const standing of Object.values(COMBAT_ART)) {
    for (const fallen of [COMBAT_ART.fallen, COMBAT_ART.wreck]) {
      const height = Math.max(trimmedArt(standing).length, trimmedArt(fallen).length);
      assert.equal(fallenArt(fallen, standing).length, height);
      assert.ok(fallenArt(fallen, standing).at(-1).trim());
    }
  }
});

test("the player is drawn according to who they are and what they carry", () => {
  const game = newGame();
  game.character.species = "human";
  game.inventory = { sidearm: 1 };
  game.equipped.weapon = "sidearm";
  startCombat(game, "dock_thug");
  assert.deepEqual(view(game).you.art, COMBAT_ART.soldier);
  game.equipped.weapon = null;
  assert.deepEqual(view(game).you.art, COMBAT_ART.brawler);
  game.character.species = "synthetic";
  assert.deepEqual(view(game).you.art, COMBAT_ART.synthetic);
  assert.deepEqual(view(game).you.fallen, COMBAT_ART.fallen);
});

test("machines fall as wrecks, and people who aren't in the files still get drawn", () => {
  const game = newGame();
  startCombat(game, "security_drone", { followers: ["dock_thug"] });
  const fight = view(game);
  assert.deepEqual(fight.enemies[0].fallen, COMBAT_ART.wreck);
  assert.deepEqual(fight.enemies[1].fallen, COMBAT_ART.fallen);
  game.combat.enemies[0].art = null;
  assert.deepEqual(view(game).enemies[0].art, COMBAT_ART.drone);
  game.combat.enemies[1].art = "no_such_art";
  assert.deepEqual(view(game).enemies[1].art, COMBAT_ART.soldier);
});

test("difficulty changes what enemies fight with, and never followers", () => {
  const numbers = (difficulty) => {
    const game = newGame();
    setDifficulty(game, difficulty);
    startCombat(game, "hegemony_trooper", { allies: ["voss"] });
    return { enemy: game.combat.enemies[0], ally: game.combat.allies[0] };
  };
  const easy = numbers("easy");
  const normal = numbers("normal");
  const hard = numbers("hard");
  assert.equal(easy.enemy.maxHp, ENEMIES.hegemony_trooper.hp);
  assert.equal(easy.enemy.attack, ENEMIES.hegemony_trooper.attack);
  assert.ok(normal.enemy.maxHp > easy.enemy.maxHp && hard.enemy.maxHp > normal.enemy.maxHp);
  assert.ok(normal.enemy.attack > easy.enemy.attack && hard.enemy.attack > normal.enemy.attack);
  assert.ok(normal.enemy.damage[1] > easy.enemy.damage[1] && hard.enemy.damage[1] > normal.enemy.damage[1]);
  for (const side of [normal, hard]) {
    assert.equal(side.ally.maxHp, easy.ally.maxHp);
    assert.equal(side.ally.attack, easy.ally.attack);
    assert.deepEqual(side.ally.damage, easy.ally.damage);
  }
  // Minor threats stay as they are, at every difficulty.
  assert.deepEqual(enemyNumbers(ENEMIES.dock_thug, "hard").hp, ENEMIES.dock_thug.hp);
  assert.throws(() => setDifficulty(newGame(), "impossible"), /Unknown difficulty/);
});

test("the Bestiary shows the numbers an enemy will really fight with, and an older save gets the default", () => {
  const game = newGame();
  for (const difficulty of ["easy", "normal", "hard"]) {
    setDifficulty(game, difficulty);
    const shown = publicState(game).enemies.find((enemy) => enemy.id === "drift_raider");
    assert.equal(shown.hp, enemyNumbers(ENEMIES.drift_raider, difficulty).hp, difficulty);
    assert.equal(publicState(game).difficulty, difficulty);
  }
  delete game.difficulty;
  assert.equal(publicState(game).difficulty, "normal");
  // A fight saved before there were difficulties keeps the numbers it started with when someone arrives.
  startCombat(game, "dock_thug", { arrivals: [{ who: "drift_raider", side: "enemy", round: 2 }] });
  delete game.combat.difficulty;
  game.hp = 1000;
  for (const enemy of game.combat.enemies) enemy.hp = 1000;
  combatAction(game, { type: "attack" });
  const arrived = game.combat.enemies.find((enemy) => enemy.id === "drift_raider");
  assert.equal(arrived.maxHp, ENEMIES.drift_raider.hp);
});
