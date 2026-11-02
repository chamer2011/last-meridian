import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILLS, TRAITS } from "../src/character-data.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { ITEMS } from "../src/data.js";
import {
  activeConvictions, addCondition, attr, audienceBonus, buy, buyPerk, buyPrice, changeStress, checkParts, combatAction, equip,
  grantXp, maxHp, oddsFor, passTime, practice, publicState, raiseSkill, raiseStat, rest, sell, sellPrice, shiftIdeology, skillCheck,
  startCombat, travel, useItem,
} from "../src/rules.js";
import { checkCommand } from "../src/checks.js";
import { newTurnLimits, runTool } from "../src/tools.js";

const newGame = (archetype = "officer", seed = 42) => createGameFromDraft(randomDraft({ seed, archetype }));

test("items can't be used twice, and healing stops at the maximum", () => {
  const game = newGame();
  game.inventory = { medkit: 1 };
  game.hp = maxHp(game) - 5;
  assert.match(useItem(game, "medkit"), /\+5 health/);
  assert.throws(() => useItem(game, "medkit"));
});

test("market refuses what is unaffordable or not sold here", () => {
  const game = newGame();
  assert.throws(() => buy(game, "medkit"), /isn't sold here/);
  game.location = "haven";
  game.credits = 10;
  assert.throws(() => buy(game, "medkit"), /afford/);
  const price = buyPrice(game, ITEMS.medkit);
  game.credits = price;
  buy(game, "medkit");
  assert.equal(game.credits, 0);
});

test("buying always costs more than selling pays, however good you are at trading", () => {
  const game = newGame();
  game.location = "haven";
  game.skills.commerce = 10;
  game.stats.presence = 10;
  game.perks.push("quartermaster");
  game.traits.push("haggler");
  for (const item of Object.values(ITEMS)) {
    if (item.price > 0) assert.ok(buyPrice(game, item) > sellPrice(game, item), item.name);
  }
  game.credits = 1000;
  buy(game, "heavy_carbine");
  const afterBuying = game.credits;
  sell(game, "heavy_carbine");
  assert.ok(game.credits < 1000);
  assert.ok(game.credits > afterBuying);
});

test("Commerce gets you better prices", () => {
  const game = newGame();
  game.skills.commerce = 0;
  const before = buyPrice(game, ITEMS.heavy_carbine);
  game.skills.commerce = 6;
  assert.ok(buyPrice(game, ITEMS.heavy_carbine) < before);
});

test("leveling grants points, and perks enforce requirements", () => {
  const game = newGame();
  game.perkPoints = 1;
  game.skillPoints = 0;
  game.statPoints = 0;
  assert.throws(() => buyPerk(game, "overcharge"), /Requires Steady Aim/);
  buyPerk(game, "steady_aim");
  assert.throws(() => buyPerk(game, "toughened"), /No perk points/);
  game.xp = 0;
  game.level = 1;
  grantXp(game, 100);
  assert.equal(game.level, 2);
  assert.equal(game.perkPoints, 1);
  assert.ok(game.skillPoints >= 2);
  raiseStat(game, "might");
  assert.throws(() => raiseStat(game, "might"), /No stat points/);
});

test("perks can require skill ranks", () => {
  const game = newGame();
  game.perkPoints = 2;
  game.skills.medicine = 0;
  assert.throws(() => buyPerk(game, "field_medic"), /Requires Medicine rank 2/);
  game.skills.medicine = 2;
  buyPerk(game, "field_medic");
  assert.ok(game.perks.includes("field_medic"));
});

test("skill points raise skills, and high ranks cost more", () => {
  const game = newGame();
  game.skills.science = 0;
  game.skillPoints = 1;
  raiseSkill(game, "science");
  assert.equal(game.skills.science, 1);
  assert.equal(game.skillPoints, 0);
  assert.throws(() => raiseSkill(game, "science"), /skill point/);
  game.skills.science = 7;
  game.skillPoints = 2;
  assert.throws(() => raiseSkill(game, "science"), /3 skill points/);
});

test("skills improve through practice, and tagged skills improve faster", () => {
  const plain = newGame();
  plain.character.learning = 1;
  plain.traits = [];
  plain.perks = [];
  plain.skills.science = 0;
  plain.tags = [];
  assert.deepEqual(practice(plain, "science", 5), []);
  assert.equal(plain.skills.science, 0);
  const notes = practice(plain, "science", 5);
  assert.equal(plain.skills.science, 1);
  assert.match(notes[0], /Science is now rank 1/);

  const tagged = newGame();
  tagged.character.learning = 1;
  tagged.traits = [];
  tagged.perks = [];
  tagged.skills.science = 0;
  tagged.tags = ["science"];
  practice(tagged, "science", 7);
  assert.equal(tagged.skills.science, 1);
});

test("checks combine attribute, skill, traits and penalties, and being untrained hurts", () => {
  const game = newGame();
  game.traits = [];
  game.perks = [];
  game.inventory = {};
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0 };
  game.character.species = "human";
  game.character.drive = null;
  game.conditions = [];
  game.needs = { stress: 0, fatigue: 0 };
  game.stats.presence = 5;
  game.skills.persuasion = 3;
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 5);
  game.skills.persuasion = 0;
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 0);
  game.skills.persuasion = 3;
  game.traits = ["honeyed_voice"];
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 7);
  game.needs.stress = 85;
  game.needs.fatigue = 65;
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 4);
  addCondition(game, "shaken");
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 3);
});

test("stacked bonuses on one skill are capped, but penalties aren't", () => {
  const game = newGame();
  game.character.drive = null;
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0 };
  game.inventory = {};
  game.traits = ["honeyed_voice", "polyglot", "honest_face"];
  game.perks = ["silver_tongue", "fast_talker"];
  game.needs = { stress: 0, fatigue: 0 };
  game.stats.presence = 3;
  game.skills.persuasion = 1;
  assert.equal(checkParts(game, { skill: "persuasion" }).total, 5);
  game.traits = ["awkward", "hot_headed"];
  game.perks = [];
  assert.equal(checkParts(game, { skill: "persuasion" }).total, -1);
});

test("traits respond to the situation", () => {
  const game = newGame();
  game.traits = ["fear_of_machines"];
  game.perks = [];
  game.character.drive = null;
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0 };
  const normal = checkParts(game, { skill: "composure" }).total;
  assert.equal(checkParts(game, { skill: "composure", context: ["choir"] }).total, normal - 2);
  assert.equal(checkParts(game, { skill: "composure", context: ["vacuum"] }).total, normal);
});

test("check odds match the rules of the dice", () => {
  assert.equal(oddsFor(0, 11), 50);
  assert.equal(oddsFor(100, 12), 95);
  assert.equal(oddsFor(-100, 12), 5);
  const game = newGame();
  for (let i = 0; i < 200; i += 1) {
    const r = skillCheck(game, { skill: "persuasion", difficulty: "hard" });
    assert.equal(r.total, r.die + r.bonus);
    if (r.die === 20) assert.equal(r.success, true);
    else if (r.die === 1) assert.equal(r.success, false);
    else assert.equal(r.success, r.total >= 16);
  }
});

test("shared beliefs and relationships change social checks with that audience", () => {
  const game = newGame();
  game.ideology = { authority: -8, loyalty: -3, violence: 5, belief: -3, flesh: -2 };
  game.factions.hegemony = 0;
  assert.ok(audienceBonus(game, "hegemony") > 0);
  game.ideology = { authority: 8, loyalty: 3, violence: -5, belief: 3, flesh: 2 };
  assert.ok(audienceBonus(game, "hegemony") < 0);
  const withAudience = checkParts(game, { skill: "persuasion", audience: "hegemony" }).total;
  assert.ok(withAudience < checkParts(game, { skill: "persuasion" }).total);
  // A relationship doesn't change things that aren't social.
  assert.equal(checkParts(game, { skill: "firearms", audience: "hegemony" }).total, checkParts(game, { skill: "firearms" }).total);
});

test("travel uses fuel and time, and fails with no fuel", () => {
  const game = newGame();
  game.skills.navigation = 0;
  game.ship.fuel = 1;
  const before = game.clock.hours;
  travel(game, "haven");
  assert.equal(game.ship.fuel, 0);
  assert.ok(game.clock.hours > before);
  assert.throws(() => travel(game, "kessara"), /out of fuel/);
  travel(game, "meridian");
  assert.equal(game.location, "meridian");
});

test("good navigators get there faster", () => {
  const slow = newGame();
  slow.skills.navigation = 0;
  const fast = newGame();
  fast.skills.navigation = 6;
  const start = [slow.clock.hours, fast.clock.hours];
  travel(slow, "haven");
  travel(fast, "haven");
  assert.ok(fast.clock.hours - start[1] < slow.clock.hours - start[0]);
});

test("time heals conditions, builds fatigue, and rest helps", () => {
  const game = newGame();
  game.traits = [];
  game.needs = { stress: 40, fatigue: 0 };
  addCondition(game, "shaken");
  const notes = passTime(game, 30);
  assert.equal(game.conditions.length, 0);
  assert.match(notes[0], /recovered: Shaken/);
  assert.ok(game.needs.fatigue > 0);
  game.needs.fatigue = 80;
  passTime(game, 8, "rest");
  assert.equal(game.needs.fatigue, 8);
  assert.ok(game.needs.stress < 40);
});

test("conditions change the numbers and can't leave health above the maximum", () => {
  const game = newGame();
  game.hp = maxHp(game);
  const before = maxHp(game);
  addCondition(game, "deep_burn");
  assert.equal(maxHp(game), before - 10);
  assert.equal(game.hp, before - 10);
  const might = attr(game, "might");
  addCondition(game, "cracked_ribs");
  assert.equal(attr(game, "might"), Math.max(1, might - 1));
});

test("resting aboard the Meridian passes the night and restores you", () => {
  const game = newGame();
  game.hp = 1;
  const before = game.clock.hours;
  rest(game);
  assert.equal(game.hp, maxHp(game));
  assert.equal(game.clock.hours, before + 8);
  game.location = "haven";
  assert.throws(() => rest(game), /aboard the Meridian/);
});

test("too much stress causes a breakdown that leaves a mark", () => {
  const game = newGame();
  game.traits = [];
  game.perks = [];
  game.character.species = "human";
  game.needs.stress = 95;
  const notes = changeStress(game, 20);
  assert.equal(game.needs.stress, 70);
  assert.ok(game.conditions.some((c) => c.id === "shaken"));
  assert.ok(game.traits.includes("nightmares"));
  assert.match(notes[0], /overwhelms/);
});

test("stress traits change how stress builds and fades", () => {
  const game = newGame();
  game.perks = [];
  game.character.species = "human";
  game.traits = ["cool_headed"];
  game.needs.stress = 0;
  changeStress(game, 10);
  assert.equal(game.needs.stress, 7);
  game.traits = ["nightmares"];
  game.needs.stress = 50;
  changeStress(game, -10);
  assert.equal(game.needs.stress, 45);
});

test("acting against a strong belief hurts, acting on one steadies you, and beliefs drift", () => {
  const game = newGame();
  game.traits = [];
  game.perks = [];
  game.character.species = "human";
  game.ideology.violence = -6;
  game.needs.stress = 30;
  const notes = shiftIdeology(game, "iron", 2);
  assert.equal(game.ideology.violence, -4);
  assert.equal(game.needs.stress, 40);
  assert.ok(notes.some((n) => n.includes("against everything")));
  assert.ok(notes.some((n) => n.includes("lost your conviction: Open Hand")));

  game.needs.stress = 30;
  game.ideology.violence = -4;
  const steady = shiftIdeology(game, "mercy", 1);
  assert.equal(game.needs.stress, 27);
  assert.ok(steady.some((n) => n.includes("New conviction: Open Hand")));
  assert.ok(activeConvictions(game.ideology).some((c) => c.id === "mercy"));
});

test("convictions give real effects", () => {
  const game = newGame();
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: -6, flesh: 0 };
  const skeptic = checkParts(game, { skill: "science" }).total;
  game.ideology.belief = 6;
  assert.equal(checkParts(game, { skill: "science" }).total, skeptic - 4);
});

test("a fight always finishes, and losing is not game over", () => {
  for (let i = 0; i < 50; i += 1) {
    const game = newGame("doctor", i);
    startCombat(game, "choir_hunter");
    let outcome;
    let rounds = 0;
    do {
      outcome = combatAction(game, { type: "attack" });
      rounds += 1;
    } while (!outcome.over && rounds < 500);
    assert.ok(outcome.over);
    assert.equal(game.combat, null);
    assert.ok(game.hp >= 1);
    if (outcome.result === "defeat") assert.ok(game.conditions.length >= 1);
  }
});

test("every combat ability works", () => {
  for (const [perk, ability, enemy] of [
    ["field_medic", "field_patch", "dock_thug"], ["overcharge", "overcharged_shot", "dock_thug"], ["evasive", "evade", "dock_thug"],
    ["resonant_push", "push", "dock_thug"], ["system_spike", "spike", "security_drone"],
    ["foresight", "foresight", "dock_thug"], ["terrifying_glare", "glare", "dock_thug"],
    ["rally_cry", "rally", "dock_thug"],
  ]) {
    const game = newGame();
    game.perks.push(perk);
    game.energy = 10;
    game.hp = 10;
    startCombat(game, enemy);
    const outcome = combatAction(game, { type: "ability", id: ability });
    assert.ok(outcome.events.length > 0, ability);
    assert.ok(game.energy < 10, ability);
  }
});

test("an ability that can't work on this enemy is refused and costs nothing", () => {
  for (const [perk, ability, enemy] of [["system_spike", "spike", "dock_thug"], ["terrifying_glare", "glare", "security_drone"]]) {
    const game = newGame();
    game.perks.push(perk);
    game.energy = 10;
    game.hp = 10;
    startCombat(game, enemy);
    const round = game.combat.round;
    assert.throws(() => combatAction(game, { type: "ability", id: ability }), ability);
    assert.equal(game.energy, 10, ability);
    assert.equal(game.combat.round, round, ability);
  }
});

test("a pacifist suffers for winning a fight", () => {
  const game = newGame();
  game.traits = ["pacifist"];
  game.perks = [];
  game.character.species = "human";
  game.needs.stress = 20;
  startCombat(game, "dock_thug");
  const stressAfterStart = game.needs.stress;
  game.combat.enemies[0].hp = 1;
  let outcome;
  do outcome = combatAction(game, { type: "attack" }); while (!outcome.over);
  if (outcome.result === "victory") assert.ok(game.needs.stress >= stressAfterStart + 10 - 4);
});

test("fighting practices your weapon skill", () => {
  const game = newGame();
  game.inventory.sidearm = 1;
  game.equipped.weapon = "sidearm";
  game.skills.firearms = 0;
  game.tags = [];
  for (let i = 0; i < 60 && game.skills.firearms < 1; i += 1) {
    if (!game.combat) startCombat(game, "choir_hunter");
    game.hp = maxHp(game);
    combatAction(game, { type: "attack" });
  }
  assert.ok(game.skills.firearms >= 1);
});

test("equipment can't be changed mid-fight", () => {
  const game = newGame();
  game.inventory.sidearm = 1;
  startCombat(game, "dock_thug");
  assert.throws(() => equip(game, "sidearm"));
});

test("the AI can't exceed reward limits or invent things", () => {
  const game = newGame();
  game.perks = [];
  game.traits = [];
  game.level = 1;
  game.xp = 0;
  const turn = newTurnLimits();
  const startCredits = game.credits;

  runTool(game, "change_credits", { amount: 999999, reason: "cheat" }, turn);
  assert.equal(game.credits, startCredits + 500);
  assert.equal(runTool(game, "change_credits", { amount: 1, reason: "more" }, turn).isError, true);

  assert.equal(runTool(game, "give_item", { item: "death_star_key" }, turn).isError, true);
  runTool(game, "give_item", { item: "choir_lance" }, turn);
  runTool(game, "give_item", { item: "ghostweave" }, turn);
  assert.equal(runTool(game, "give_item", { item: "medkit" }, turn).isError, true);

  runTool(game, "award_xp", { amount: 100000, reason: "cheat" }, turn);
  assert.equal(game.level, 2);

  assert.equal(runTool(game, "change_credits", { amount: -99999999, reason: "too much" }, newTurnLimits()).isError, true);
});

test("the AI's non-combat damage can't kill, and bad input is rejected", () => {
  const game = newGame();
  const turn = newTurnLimits();
  game.hp = 5;
  runTool(game, "change_health", { amount: -500, reason: "explosion" }, turn);
  assert.equal(game.hp, 1);
  assert.equal(runTool(game, "roll_check", { skill: "luck", difficulty: "easy", reason: "x" }, turn).isError, true);
  assert.equal(runTool(game, "roll_check", { skill: "melee" }, turn).isError, true);
  assert.equal(runTool(game, "roll_check", { skill: "none", difficulty: "easy", reason: "x" }, turn).isError, true);
  assert.equal(runTool(game, "roll_check", { skill: "melee", difficulty: "easy", reason: "x", context: ["nonsense"] }, turn).isError, true);
  assert.equal(runTool(game, "not_a_tool", {}, turn).isError, true);
});

test("roll_check opens a check, and the true roll comes out of it, with and without optional details", () => {
  const game = newGame();
  for (let i = 0; i < 100; i += 1) {
    const { result, isError } = runTool(game, "roll_check", { skill: "melee", difficulty: "hard", reason: "Lift" }, newTurnLimits());
    assert.ok(!isError, result);
    assert.ok(game.check);
    const { outcome } = checkCommand(game, "run");
    assert.ok(outcome.die >= 1 && outcome.die <= 20);
    assert.equal(game.check, null);
    assert.match(outcome.math, /vs 16/);
    assert.match(game.transcript.at(-1).text, /^\[ROLL\] Lift: .* vs 16/);
    assert.match(game.pendingEvents.splice(0).join(" "), /Rolled \d+/);
  }
  const full = runTool(game, "roll_check", { skill: "persuasion", attribute: "might", difficulty: "easy", context: ["crowd", "authority"], audience: "voss", reason: "Loom" }, newTurnLimits());
  assert.ok(!full.isError, full.result);
  assert.match(checkCommand(game, "run").outcome.math, /Might/);
  const raw = runTool(game, "roll_check", { skill: "none", attribute: "endurance", difficulty: "easy", reason: "Hold on" }, newTurnLimits());
  assert.ok(!raw.isError, raw.result);
  checkCommand(game, "run");
  // A local model may send empty optional values.
  const blanks = runTool(game, "roll_check", { skill: "melee", attribute: "", difficulty: "easy", audience: null, context: null, reason: "x" }, newTurnLimits());
  assert.ok(!blanks.isError, blanks.result);
  checkCommand(game, "run");
});

test("the simulation tools work and respect their limits", () => {
  const game = newGame();
  game.perks = [];
  game.traits = [];
  game.character.species = "human";
  game.needs.stress = 0;
  const turn = newTurnLimits();
  assert.ok(!runTool(game, "change_stress", { amount: 30, reason: "Horror" }, turn).isError);
  assert.equal(game.needs.stress, 30);
  runTool(game, "change_stress", { amount: 30, reason: "More" }, turn);
  assert.equal(game.needs.stress, 40);
  assert.equal(runTool(game, "change_stress", { amount: 5, reason: "Too much" }, turn).isError, true);

  const hours = game.clock.hours;
  assert.ok(!runTool(game, "pass_time", { hours: 6, activity: "active", reason: "Talk" }, turn).isError);
  assert.equal(game.clock.hours, hours + 6);
  assert.equal(runTool(game, "pass_time", { hours: 6, activity: "dancing", reason: "x" }, turn).isError, true);

  assert.ok(!runTool(game, "add_condition", { condition: "concussed", reason: "Blast" }, turn).isError);
  assert.ok(!runTool(game, "remove_condition", { condition: "concussed", reason: "Medbay" }, turn).isError);
  assert.equal(runTool(game, "remove_condition", { condition: "concussed", reason: "Again" }, turn).isError, true);

  assert.ok(!runTool(game, "shift_ideology", { toward: "mercy", amount: 2, reason: "Spared them" }, turn).isError);
  assert.ok(!runTool(game, "shift_ideology", { toward: "faith", amount: 1, reason: "Prayed" }, turn).isError);
  assert.equal(runTool(game, "shift_ideology", { toward: "faith", amount: 1, reason: "Third" }, turn).isError, true);

  assert.ok(!runTool(game, "grant_trait", { trait: "battle_hardened", reason: "War" }, turn).isError);
  assert.equal(runTool(game, "remove_trait", { trait: "battle_hardened", reason: "Too soon" }, turn).isError, true);
  assert.ok(!runTool(game, "remove_trait", { trait: "battle_hardened", reason: "Peace" }, newTurnLimits()).isError);
  assert.equal(runTool(game, "grant_trait", { trait: "quick_study", reason: "Not earnable" }, newTurnLimits()).isError, true);

  game.skills.lore = 0;
  assert.ok(!runTool(game, "train_skill", { skill: "lore", amount: 20, reason: "Reading" }, turn).isError);
  assert.equal(runTool(game, "train_skill", { skill: "lore", amount: 20, reason: "x" }, { ...turn, training: 30 }).isError, true);
});

test("a trait gained in play applies its faction effect once", () => {
  const game = newGame();
  game.traits = [];
  game.factions.fleet = 0;
  runTool(game, "grant_trait", { trait: "war_hero", reason: "Saved the fleet" }, newTurnLimits());
  assert.equal(game.factions.fleet, 15);
  assert.equal(runTool(game, "grant_trait", { trait: "war_hero", reason: "Again" }, newTurnLimits()).isError, true);
  assert.equal(game.factions.fleet, 15);
  const state = publicState(game);
  assert.ok(state.traits.some((t) => t.id === "war_hero"));
});

test("every skill has a sensible entry in the public state", () => {
  const state = publicState(newGame());
  assert.equal(state.skills.length, Object.keys(SKILLS).length);
  assert.ok(state.skills.every((s) => Number.isFinite(s.bonus) && s.odds >= 5 && s.odds <= 95));
  assert.ok(Object.keys(TRAITS).length > 30);
});
