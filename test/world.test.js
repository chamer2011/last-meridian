// The files on this computer: the people and enemies of the world, what the game master
// adds to them, and the fights that run from them without the AI.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { allCharacters, campaignCharacters, campaignEnemies, ensureContactFiles, findCharacter, findEnemy, newCampaignId, saveCaptainSheet, slugify } from "../src/campaign.js";
import { NOTABLES, SKILLS, SPECIES } from "../src/character-data.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { ENEMIES, FACTIONS, LOCATIONS, STATS } from "../src/data.js";
import { LORE } from "../src/lore.js";
import { migrateGame } from "../src/migrate.js";
import { enemyNumbers } from "../src/combat.js";
import { NPC_ARCHETYPES, THREAT_LABELS, characterBrief, combatStats, generateStats } from "../src/npc.js";
import { captainSheet, combatAction, publicState, startCombat } from "../src/rules.js";
import { TOOL_DEFS, newTurnLimits, runTool } from "../src/tools.js";
import { COMBAT_TEXT } from "../src/world.js";
import { buildLoreIndex, findLoreEntry, loreEntries } from "../public/story.js";

// Anything the game master adds in these tests stays out of the real game's folder.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-world-"));
process.env.GAME_DATA_DIR = dataDir;
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const newGame = (seed = 5, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));

let campaigns = 0;
function campaignGame(seed) {
  const game = newGame(seed);
  campaigns += 1;
  game.campaign = `${newCampaignId(game.name)}-${campaigns}`;
  return game;
}

const tool = (game, name, input, turn = newTurnLimits()) => runTool(game, name, input, turn);

const KESSA = {
  name: "Kessa Vane",
  title: "Quartermaster",
  pronouns: "she/her",
  faction: "drift",
  role: "Quartermaster of the Long Reach",
  location: "kessara",
  public: "Runs supplies out of Kessara, and always knows the price of everything.",
  appearance: "Short, with a burn scar along one arm.",
  personality: "Cheerful and completely untrustworthy.",
  voice: "Quick, and sells everything like a bargain.",
  goals: "Get off Kessara before her debts catch up.",
  secrets: "She sold the Long Reach's route to the Hegemony.",
  beliefs: ["mercy"],
  archetype: "scoundrel",
  threat: 2,
};

function fightToTheEnd(game) {
  let outcome;
  let rounds = 0;
  do {
    game.hp = 100;
    outcome = combatAction(game, { type: "attack" });
    rounds += 1;
  } while (!outcome.over && rounds < 500);
  assert.ok(outcome.over);
  return outcome;
}

// ---- The shipped files --------------------------------------------------

function checkCombatNumbers(label, c) {
  assert.ok(Number.isInteger(c.hp) && c.hp > 0, `${label}: hp`);
  assert.ok(Number.isInteger(c.attack), `${label}: attack`);
  assert.ok(Number.isInteger(c.defense) && c.defense > 0, `${label}: defense`);
  assert.ok(Array.isArray(c.damage) && c.damage.length === 2 && c.damage[0] >= 1 && c.damage[0] <= c.damage[1], `${label}: damage`);
  assert.ok(Number.isInteger(c.xp) && c.xp >= 0, `${label}: xp`);
  assert.ok(Array.isArray(c.credits) && c.credits.length === 2 && c.credits[0] <= c.credits[1], `${label}: credits`);
  assert.ok(THREAT_LABELS[c.threat], `${label}: threat`);
  assert.ok(typeof c.weapon === "string" && c.weapon, `${label}: weapon`);
  assert.ok(Array.isArray(c.tags), `${label}: tags`);
}

test("every important character has a complete file", () => {
  assert.ok(Object.keys(NOTABLES).length >= 18);
  assert.equal(Object.values(NOTABLES).filter((n) => n.crew).length, 5);
  for (const [id, person] of Object.entries(NOTABLES)) {
    for (const field of ["name", "pronouns", "species", "role", "note", "personality", "voice", "goals", "secrets"]) {
      assert.ok(typeof person[field] === "string" && person[field], `${id}: ${field}`);
    }
    assert.ok(person.faction === null || FACTIONS[person.faction], `${id}: faction`);
    assert.ok(!person.location || LOCATIONS[person.location], `${id}: location`);
    assert.ok(SPECIES[person.species] || person.species, `${id}: species`);
    for (const stat of Object.keys(person.attributes)) assert.ok(STATS[stat], `${id}: attribute ${stat}`);
    for (const skill of Object.keys(person.skills)) assert.ok(SKILLS[skill], `${id}: skill ${skill}`);
    checkCombatNumbers(id, person.combat);
    // The public description is shown to the player, so it can't give the secret away.
    assert.ok(!person.note.includes(person.secrets), `${id}: note`);
  }
});

test("every enemy has a complete file", () => {
  assert.ok(Object.keys(ENEMIES).length >= 9);
  for (const [id, enemy] of Object.entries(ENEMIES)) {
    assert.ok(typeof enemy.name === "string" && enemy.name, `${id}: name`);
    assert.ok(typeof enemy.desc === "string" && enemy.desc, `${id}: desc`);
    checkCombatNumbers(id, enemy);
  }
});

test("fight text only uses words the game can fill in", () => {
  const seen = [];
  const walk = (value) => {
    if (typeof value === "string") seen.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(COMBAT_TEXT);
  for (const source of [...Object.values(ENEMIES), ...Object.values(NOTABLES).map((n) => n.combat)]) walk(source.lines ?? []);
  assert.ok(seen.length > 50);
  for (const line of seen) {
    for (const [word] of line.matchAll(/\{[^}]*\}/g)) assert.ok(["{enemy}", "{Enemy}", "{ally}", "{Ally}", "{weapon}"].includes(word), `${word} in: ${line}`);
  }
  for (const group of ["firearms", "melee", "engineering", "manifestation", "unarmed"]) {
    for (const kind of ["hit", "miss", "crit"]) assert.ok(COMBAT_TEXT.attack[group][kind].length > 0, `${group} ${kind}`);
  }
});

test("a character's secrets, goals and fighting numbers stay out of what the browser receives", () => {
  const game = campaignGame(11);
  tool(game, "create_character", { ...KESSA, met: true, attitude: "friendly" });
  for (const id of Object.keys(allCharacters(game.campaign))) game.seenLore.push(`person:${id}`);
  const state = publicState(game);
  assert.ok(state.people.length >= 19);
  const sent = JSON.stringify(state);
  for (const person of Object.values(allCharacters(game.campaign))) {
    assert.ok(!sent.includes(person.secrets), `${person.name}: secrets`);
    assert.ok(!sent.includes(person.goals), `${person.name}: goals`);
    assert.ok(!sent.includes(person.personality), `${person.name}: personality`);
  }
  for (const person of state.people) {
    assert.deepEqual(Object.keys(person).filter((key) => ["secrets", "goals", "personality", "voice", "combat", "attributes", "skills"].includes(key)), []);
  }
});

test("the player only sees someone's looks once they've met", () => {
  const game = campaignGame(12);
  tool(game, "create_character", KESSA);
  game.seenLore.push("person:kessa-vane");
  const heardOf = publicState(game).people.find((p) => p.id === "kessa-vane");
  assert.equal(heardOf.met, false);
  assert.equal(heardOf.appearance, null);
  tool(game, "note_contact", { name: "Kessa Vane", attitude: "neutral", note: "Sold you fuel." });
  const met = publicState(game).people.find((p) => p.id === "kessa-vane");
  assert.equal(met.met, true);
  assert.match(met.appearance, /burn scar/);
  assert.equal(met.history, "Sold you fuel.");
});

test("people the player hasn't heard of aren't listed", () => {
  const state = publicState(campaignGame(13));
  assert.ok(state.people.some((p) => p.crew));
  assert.ok(!state.people.some((p) => p.shortName === NOTABLES.cantor.name));
});

// ---- Generated stats ----------------------------------------------------

test("generated stats stay sensible, and the same person always gets the same ones", () => {
  for (const archetype of Object.keys(NPC_ARCHETYPES)) {
    for (const threat of [1, 2, 3, 4, 5]) {
      const stats = generateStats("Test Person", archetype, threat);
      assert.deepEqual(stats, generateStats("Test Person", archetype, threat));
      checkCombatNumbers(`${archetype} ${threat}`, stats.combat);
      assert.equal(stats.combat.threat, threat);
      assert.ok(stats.combat.hp >= 6 && stats.combat.hp <= 70);
      for (const value of Object.values(stats.attributes)) assert.ok(value >= 1 && value <= 10);
      for (const [id, rank] of Object.entries(stats.skills)) {
        assert.ok(SKILLS[id], id);
        assert.ok(rank >= 1 && rank <= 10, id);
      }
    }
  }
  // Tougher people really are tougher.
  assert.ok(combatStats("soldier", 5).hp > combatStats("soldier", 1).hp);
  assert.ok(combatStats("soldier", 5).attack > combatStats("soldier", 1).attack);
  assert.equal(combatStats("nonsense", 99).threat, 1);
});

// ---- The game master adding to the world --------------------------------

test("the game master can add a character, who's saved to a file with generated stats", () => {
  const game = campaignGame(21);
  const turn = newTurnLimits();
  // Numbers from the AI have no way in, because the game makes them.
  const made = tool(game, "create_character", { ...KESSA, hp: 9999, combat: { hp: 9999 } }, turn);
  assert.ok(!made.isError, made.result);
  assert.match(made.result, /kessa-vane/);
  const file = path.join(dataDir, "campaigns", slugify(game.campaign), "characters", "kessa-vane.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.name, "Kessa Vane");
  assert.equal(saved.secrets, KESSA.secrets);
  assert.equal(saved.combat.threat, 2);
  assert.deepEqual(saved.combat, generateStats("Kessa Vane", "scoundrel", 2).combat);
  assert.equal(saved.beliefs.violence, -6);
  assert.equal(turn.newCharacters, 1);
});

test("updating a character fills in their file without changing what stays the same", () => {
  const game = campaignGame(22);
  tool(game, "create_character", KESSA);
  const before = findCharacter(game.campaign, "Kessa Vane");
  const turn = newTurnLimits();
  const updated = tool(game, "create_character", { ...KESSA, secrets: "She has a second ship." }, turn);
  assert.match(updated.result, /Updated/);
  assert.equal(turn.newCharacters, 0);
  const after = findCharacter(game.campaign, "Kessa Vane");
  assert.equal(after.secrets, "She has a second ship.");
  assert.deepEqual(after.combat, before.combat);
});

test("people go by their first name too, and using it finds the same person", () => {
  const game = campaignGame(34);
  tool(game, "note_contact", { name: "Iris Kavan", attitude: "ally", note: "Your spouse." });
  tool(game, "note_contact", { name: "Old Tomas", attitude: "friendly", note: "Sold you a map." });
  assert.deepEqual(campaignCharacters(game.campaign)["iris-kavan"].aliases, ["Iris", "Kavan"]);
  // "Old" isn't anyone's name.
  assert.deepEqual(campaignCharacters(game.campaign)["old-tomas"].aliases, ["Tomas"]);
  assert.equal(findCharacter(game.campaign, "Iris").id, "iris-kavan");
  const count = game.contacts.length;
  tool(game, "note_contact", { name: "Iris", attitude: "friendly", note: "Called you back." });
  assert.equal(game.contacts.length, count);
  // Filling in a thin file under a shorter name doesn't make a second person.
  const turn = newTurnLimits();
  const filled = tool(game, "create_character", { ...KESSA, name: "Iris", role: "Deputy registrar", public: "Works in the civil registry." }, turn);
  assert.match(filled.result, /Updated the file for Iris Kavan/);
  assert.equal(turn.newCharacters, 0);
  assert.equal(Object.keys(campaignCharacters(game.campaign)).filter((id) => id.startsWith("iris")).length, 1);
  assert.equal(findCharacter(game.campaign, "Iris").role, "Deputy registrar");
  // The story highlights the first name.
  const index = buildLoreIndex(loreEntries(LORE, publicState(game)));
  assert.equal(findLoreEntry("Iris", index).id, "person:iris-kavan");
});

test("files saved before first names were added still go by them", () => {
  const game = newGame(35);
  const campaign = `${newCampaignId(game.name)}-older-files`;
  const folder = path.join(dataDir, "campaigns", slugify(campaign), "characters");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "lio-tannen.json"), JSON.stringify({ name: "Lio Tannen", aliases: ["Tannen"], role: "Former partner", note: "Former partner.", combat: combatStats("civilian", 1) }));
  assert.equal(findCharacter(campaign, "Lio").id, "lio-tannen");
  assert.equal(findCharacter(campaign, "Tannen").id, "lio-tannen");
});

test("the game's own characters can't be replaced, and new ones are limited per turn", () => {
  const game = campaignGame(23);
  const turn = newTurnLimits();
  for (const name of ["Ilya Voss", "Voss", "voss"]) {
    const replaced = tool(game, "create_character", { ...KESSA, name }, turn);
    assert.ok(replaced.isError, name);
  }
  assert.equal(turn.newCharacters, 0);
  assert.equal(findCharacter(game.campaign, "Voss").id, "voss");
  for (const name of ["One Person", "Two Person", "Three Person"]) assert.ok(!tool(game, "create_character", { ...KESSA, name }, turn).isError);
  assert.ok(tool(game, "create_character", { ...KESSA, name: "Four Person" }, turn).isError);
  assert.ok(tool(game, "create_character", { ...KESSA, name: "Bad Threat", threat: 9 }).isError);
  assert.ok(tool(game, "create_character", { ...KESSA, name: "Bad Type", archetype: "wizard" }).isError);
});

test("reading a file gives the AI what it needs to play them, including secrets", () => {
  const game = campaignGame(24);
  const file = tool(game, "read_character", { name: "Voss" });
  assert.ok(!file.isError);
  assert.equal(file.notice, undefined);
  assert.ok(file.result.includes(NOTABLES.voss.secrets));
  assert.ok(file.result.includes(NOTABLES.voss.voice));
  assert.ok(!/\bhp\b/i.test(file.result));
  assert.ok(game.ai.sentCharacters.includes("voss"));
  assert.ok(tool(game, "read_character", { name: "Nobody Atall" }).isError);
  assert.match(characterBrief("x", { name: "New Person", note: "N" }, undefined), /hasn't met them yet/);
});

test("something just added can be fought in the same reply, by name, which saves a round", () => {
  const game = campaignGame(38);
  tool(game, "create_enemy", { name: "Hull Crawler", archetype: "beast", threat: 1, description: "It lives in the plating." });
  assert.ok(!tool(game, "start_combat", { enemy: "Hull Crawler", lead_in: "It drops from the ceiling." }).isError);
  assert.equal(game.combat.enemies[0].name, "Hull Crawler");
  fightToTheEnd(game);
  tool(game, "create_character", { ...KESSA, name: "Odo Marsh" });
  assert.ok(!tool(game, "start_combat", { enemy: "Odo Marsh", lead_in: "He draws." }).isError);
  assert.equal(game.combat.enemies[0].name, "Quartermaster Odo Marsh");
});

test("a new enemy goes in the files and can be fought right away", () => {
  const game = campaignGame(25);
  const turn = newTurnLimits();
  const made = tool(game, "create_enemy", { name: "Ion Wraith", archetype: "machine", threat: 3, description: "A ghost in the ship's wiring.", tags: ["choir"] }, turn);
  assert.ok(!made.isError, made.result);
  assert.match(made.result, /ion_wraith/);
  const file = path.join(dataDir, "campaigns", slugify(game.campaign), "enemies", "ion_wraith.json");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(saved.machine, true);
  assert.ok(saved.tags.includes("choir") && saved.tags.includes("machines"));
  const started = tool(game, "start_combat", { enemy: "ion_wraith", lead_in: "The lights flicker." });
  assert.ok(!started.isError, started.result);
  assert.equal(started.narration, "The lights flicker.");
  assert.equal(game.combat.enemies[0].name, "Ion Wraith");
  assert.equal(game.combat.enemies[0].hp, enemyNumbers(combatStats("machine", 3)).hp);
  fightToTheEnd(game);
  assert.equal(game.bestiary.ion_wraith.fought, 1);
  // The same type of thing is still the same type after being fought.
  assert.equal(findEnemy(game.campaign, "Ion Wraith").id, "ion_wraith");
  assert.ok(tool(game, "create_enemy", { name: "Dock Thug", archetype: "soldier", threat: 1, description: "x" }, turn).isError);
  tool(game, "create_enemy", { name: "Second Enemy", archetype: "beast", threat: 1, description: "x" }, turn);
  assert.ok(tool(game, "create_enemy", { name: "Third Enemy", archetype: "beast", threat: 1, description: "x" }, turn).isError);
});

test("the story can rename an enemy, which keeps its stats and uses general fight text", () => {
  const game = campaignGame(36);
  const started = tool(game, "start_combat", { enemy: "dock_thug", lead_in: "He charges.", called: "a Syndicate Courier" });
  assert.ok(!started.isError, started.result);
  assert.match(started.notice, /The fight begins: Syndicate Courier/);
  const view = publicState(game).combat;
  assert.equal(view.enemies[0].name, "Syndicate Courier");
  assert.equal(view.enemies[0].maxHp, ENEMIES.dock_thug.hp);
  assert.deepEqual(view.enemies[0].damage, ENEMIES.dock_thug.damage);
  let outcome;
  let said = "";
  do {
    game.hp = 100;
    outcome = combatAction(game, { type: "attack" });
    said += JSON.stringify(outcome.events);
  } while (!outcome.over);
  assert.doesNotMatch(said, /\bthug\b|Dock Thug/i);
  assert.match(game.pendingEvents[0], /the Syndicate Courier/);
  // It's still a dock thug in the bestiary.
  assert.equal(game.bestiary.dock_thug.fought, 1);
  // The fight survives being saved and loaded.
  const again = campaignGame(37);
  tool(again, "start_combat", { enemy: "dock_thug", lead_in: "He charges.", called: "Syndicate Courier" });
  const loaded = JSON.parse(JSON.stringify(again));
  assert.equal(publicState(loaded).combat.enemies[0].name, "Syndicate Courier");
  assert.doesNotThrow(() => fightToTheEnd(loaded));
});

test("start_combat refuses things that don't exist, and leaves no fight behind", () => {
  const game = campaignGame(26);
  const refused = tool(game, "start_combat", { enemy: "invented_monster", lead_in: "It roars." });
  assert.ok(refused.isError);
  assert.match(refused.result, /dock_thug/);
  assert.equal(game.combat, null);
});

test("a named character can be fought from their file, and the story decides what becomes of them", () => {
  const game = campaignGame(27);
  game.pendingEvents = [];
  const started = tool(game, "start_combat", { enemy: "Kara Tarrow", lead_in: "Tarrow draws." });
  assert.ok(!started.isError, started.result);
  assert.equal(game.combat.enemies[0].hp, enemyNumbers(NOTABLES.tarrow.combat).hp);
  assert.equal(game.combat.enemies[0].attack, enemyNumbers(NOTABLES.tarrow.combat).attack);
  game.combat.enemies[0].hp = 1;
  let outcome;
  do {
    game.hp = 100;
    outcome = combatAction(game, { type: "attack" });
  } while (!outcome.over);
  assert.equal(outcome.result, "victory");
  assert.match(game.pendingEvents[0], /Lieutenant Kara Tarrow/);
  assert.match(game.pendingEvents[0], /the story decides/);
  // Someone they've fought shows up with the enemies they've faced.
  assert.ok(publicState(game).enemies.some((e) => e.id === "tarrow"));
});

test("anyone added as a contact gets a file, and people with files keep their full names", () => {
  const game = campaignGame(28);
  const added = tool(game, "note_contact", { name: "Old Tomas", attitude: "friendly", note: "Sold you a map." });
  assert.ok(!added.isError);
  const contact = game.contacts.find((c) => c.name === "Old Tomas");
  assert.equal(contact.id, "old-tomas");
  assert.equal(campaignCharacters(game.campaign)["old-tomas"].note, "Sold you a map.");
  assert.ok(fs.existsSync(path.join(dataDir, "campaigns", slugify(game.campaign), "characters", "old-tomas.json")));
  const count = game.contacts.length;
  const updated = tool(game, "note_contact", { name: "Voss", attitude: "wary", note: "She heard the lie.", status: "captured" });
  assert.equal(game.contacts.length, count);
  assert.match(updated.notice, /is now captured/);
  const voss = publicState(game).people.find((p) => p.id === "voss");
  assert.equal(voss.attitude, "wary");
  assert.equal(voss.status, "captured");
  assert.equal(voss.history, "She heard the lie.");
});

test("one campaign's people stay out of another, but its saved copies share them", () => {
  const first = campaignGame(29);
  tool(first, "create_character", KESSA);
  const second = campaignGame(30);
  assert.equal(findCharacter(second.campaign, "Kessa Vane"), null);
  assert.ok(tool(second, "read_character", { name: "Kessa Vane" }).isError);
  const copy = JSON.parse(JSON.stringify(first));
  assert.equal(findCharacter(copy.campaign, "Kessa Vane").id, "kessa-vane");
});

test("without a campaign, nothing is written to disk", () => {
  const game = newGame(31);
  assert.equal(game.campaign, null);
  assert.ok(tool(game, "create_character", KESSA).isError);
  assert.ok(tool(game, "create_enemy", { name: "Nope", archetype: "beast", threat: 1, description: "x" }).isError);
  ensureContactFiles(game);
  assert.equal(Object.keys(campaignCharacters(null)).length, 0);
  assert.equal(Object.keys(campaignEnemies(null)).length, 0);
});

test("the tools the AI sees don't change during play", () => {
  // Claude's saved reasoning stops being valid if these change, so nothing dynamic can be in them.
  const before = JSON.stringify(TOOL_DEFS);
  const game = campaignGame(32);
  tool(game, "create_character", { ...KESSA, name: "Tool Stability" });
  tool(game, "create_enemy", { name: "Stability Beast", archetype: "beast", threat: 1, description: "x" });
  assert.equal(JSON.stringify(TOOL_DEFS), before);
  assert.ok(!before.includes("tool-stability"));
  assert.ok(!before.includes("stability_beast"));
});

test("people added in a campaign are highlighted in the story", () => {
  const game = campaignGame(33);
  tool(game, "create_character", { ...KESSA, met: true, attitude: "friendly" });
  const state = publicState(game);
  const entries = loreEntries(LORE, state);
  const index = buildLoreIndex(entries);
  const entry = findLoreEntry("Vane", index);
  assert.equal(entry.id, "person:kessa-vane");
  assert.equal(entry.kind, "person");
  assert.equal(entry.name, "Quartermaster Kessa Vane");
  assert.match(entry.text, /Long Reach/);
  assert.match(entry.status, /friendly/);
  assert.ok(!JSON.stringify(entries).includes(KESSA.secrets));
  // Nobody appears twice.
  assert.equal(entries.filter((e) => e.kind === "person" && /Voss/.test(e.name)).length, 1);
});

// ---- Fights -------------------------------------------------------------

test("the fight menu works out the odds from the real numbers", () => {
  const game = newGame(41);
  game.inventory = { sidearm: 1, medkit: 2 };
  game.equipped.weapon = "sidearm";
  startCombat(game, "dock_thug");
  const view = publicState(game).combat;
  assert.equal(view.round, 1);
  assert.equal(view.training, false);
  assert.equal(view.enemies[0].name, ENEMIES.dock_thug.name);
  assert.equal(view.enemies[0].maxHp, ENEMIES.dock_thug.hp);
  assert.equal(view.enemies[0].attack, ENEMIES.dock_thug.attack);
  assert.deepEqual(view.enemies[0].damage, ENEMIES.dock_thug.damage);
  const attack = view.actions[0];
  assert.deepEqual(attack.action, { type: "attack" });
  assert.equal(attack.oddsLabel, "HIT");
  const { odds } = attack.targets[view.enemies[0].key];
  assert.ok(odds >= 5 && odds <= 95 && odds % 5 === 0);
  assert.ok(view.actions.some((a) => a.action.type === "cover"));
  const medkit = view.actions.find((a) => a.action.type === "item");
  assert.match(medkit.label, /x2/);
  const flee = view.actions.at(-1);
  assert.equal(flee.action.type, "flee");
  assert.ok(flee.odds > 0);
  assert.ok(!flee.disabled);
});

test("the fight menu says what can't be done, and why", () => {
  const game = newGame(42);
  game.perks.push("system_spike", "terrifying_glare");
  game.energy = 0;
  startCombat(game, "inquisitor");
  const view = publicState(game).combat;
  const spike = view.actions.find((a) => a.action.id === "spike");
  assert.equal(spike.disabled, true);
  assert.equal(spike.targets[view.enemies[0].key].why, "only works on machines");
  const glare = view.actions.find((a) => a.action.id === "glare");
  assert.equal(glare.disabled, true);
  assert.equal(glare.why, "not enough energy");
  const flee = view.actions.at(-1);
  if (ENEMIES.inquisitor.boss) assert.equal(flee.disabled, true);
});

test("you can't run from a boss", () => {
  const boss = Object.keys(ENEMIES).find((id) => ENEMIES[id].boss);
  assert.ok(boss);
  const game = newGame(43);
  startCombat(game, boss);
  const state = publicState(game).combat.actions.at(-1);
  assert.equal(state.disabled, true);
  assert.ok(state.why);
  assert.throws(() => combatAction(game, { type: "flee" }));
  assert.ok(game.combat);
});

test("taking cover only lasts for the round it's taken, and the numbers shown stay true", () => {
  const game = newGame(44);
  startCombat(game, "dock_thug");
  const before = publicState(game).combat.you.defense;
  combatAction(game, { type: "cover" });
  assert.equal(publicState(game).combat.you.defense, before);
});

test("a finished fight waits for the player, then the AI hears about it once", () => {
  const game = newGame(45);
  game.credits = 100;
  startCombat(game, "dock_thug");
  assert.equal(publicState(game).pendingEvents, 0);
  game.combat.enemies[0].hp = 1;
  let outcome;
  do {
    game.hp = 100;
    outcome = combatAction(game, { type: "attack" });
  } while (!outcome.over);
  assert.equal(outcome.result, "victory");
  assert.equal(game.combat, null);
  assert.equal(publicState(game).pendingEvents, 1);
  assert.match(game.pendingEvents[0], /won the fight/);
  assert.equal(game.bestiary.dock_thug.won, 1);
  assert.ok(outcome.events.some((line) => line.tone === "good" && /XP/.test(line.math ?? "")));
});

test("a simulated fight leaves everything exactly as it was", () => {
  for (let i = 0; i < 20; i += 1) {
    const game = newGame(50 + i);
    game.needs.stress = 20;
    const before = structuredClone(game);
    startCombat(game, "void_stalker", { training: true });
    assert.equal(game.needs.stress, 20);
    assert.equal(publicState(game).combat.training, true);
    let outcome;
    let rounds = 0;
    do {
      outcome = combatAction(game, { type: "attack" });
      rounds += 1;
    } while (!outcome.over && rounds < 500);
    assert.equal(outcome.training, true);
    assert.match(outcome.message, /nothing carries over/);
    assert.deepEqual(game, before);
  }
});

test("the bestiary shows weak enemies and the ones you've faced, and the simulator only runs aboard", () => {
  const game = newGame(61);
  const state = publicState(game);
  assert.ok(state.enemies.length >= 1);
  assert.ok(state.enemies.every((e) => e.threatLevel <= 2));
  assert.ok(state.enemies.every((e) => e.canSim));
  assert.equal(state.enemiesTotal, Object.keys(ENEMIES).length);
  game.bestiary.inquisitor = { fought: 1, won: 0, lost: 1, fled: 0 };
  assert.ok(publicState(game).enemies.some((e) => e.id === "inquisitor" && e.record.lost === 1));
  game.location = "kessara";
  assert.ok(publicState(game).enemies.every((e) => !e.canSim));
});

// ---- Saves and files ----------------------------------------------------

const VERSION_3 = () => {
  const game = newGame(71);
  const save = structuredClone(game);
  save.version = 3;
  delete save.campaign;
  delete save.bestiary;
  delete save.pendingEvents;
  return save;
};

test("older saves get a campaign, and the same save always gets the same one", () => {
  const save = VERSION_3();
  save.contacts.push({ name: "Old Friend", attitude: "friendly", note: "Knew you back then." });
  save.contacts[0].note = "Commander Ilya Voss. She's hiding something about the Choir.";
  const game = migrateGame(structuredClone(save));
  assert.equal(game.version, 15);
  assert.ok(game.campaign.startsWith(slugify(save.name)));
  assert.equal(migrateGame(structuredClone(save)).campaign, game.campaign);
  assert.deepEqual(game.bestiary, {});
  assert.deepEqual(game.pendingEvents, []);
  // An old description gave away a secret.
  assert.doesNotMatch(game.contacts[0].note, /hiding something/);
  assert.doesNotThrow(() => publicState(game));
  // Someone who joined the crew since then is there, once.
  const newCrew = migrateGame({ ...structuredClone(save), contacts: save.contacts.filter((c) => c.name !== NOTABLES.pell.name) });
  assert.equal(newCrew.contacts.filter((c) => c.name === NOTABLES.pell.name).length, 1);
  assert.equal(game.contacts.filter((c) => c.name === NOTABLES.pell.name).length, 1);
  ensureContactFiles(game);
  assert.ok(findCharacter(game.campaign, "Old Friend"));
  assert.equal(game.contacts.find((c) => c.name === "Old Friend").id, "old-friend");
});

test("a save from the middle of an old fight carries on", () => {
  const save = VERSION_3();
  save.combat = { enemyId: "dock_thug", enemy: { name: "Dock Thug", hp: 3, attack: 2, defense: 11, damage: [2, 5] }, round: 4, stunned: false };
  const game = migrateGame(save);
  const view = publicState(game).combat;
  assert.equal(view.enemies[0].hp, 3);
  assert.equal(view.round, 4);
  assert.equal(view.training, false);
  assert.ok(view.actions.length >= 3);
  fightToTheEnd(game);
  assert.equal(game.combat, null);
});

test("the captain's sheet is a readable copy of the real numbers", () => {
  const game = campaignGame(72);
  const sheet = captainSheet(game);
  assert.equal(sheet.name, game.name);
  assert.equal(sheet.health.current, game.hp);
  assert.deepEqual(Object.keys(sheet.attributes), Object.keys(STATS));
  assert.ok(sheet.combat.defense > 0);
  saveCaptainSheet(game.campaign, sheet);
  const file = path.join(dataDir, "campaigns", slugify(game.campaign), "captain.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).name, game.name);
});

test("the game can say where its files are", () => {
  const game = campaignGame(73);
  tool(game, "create_character", KESSA);
  tool(game, "create_enemy", { name: "File Beast", archetype: "beast", threat: 1, description: "x" });
  const { files } = publicState(game);
  assert.equal(files.world, "world");
  assert.equal(files.worldCharacters, Object.keys(NOTABLES).length);
  assert.equal(files.campaignCharacters, 1);
  assert.equal(files.campaignEnemies, 1);
  assert.ok(files.campaign.includes(slugify(game.campaign)));
});
