// The people, places and species as plain-text files: each reads into the shape the game uses and writes back the
// same, the game holds them all, problems are named by their line, and a saved file is read again at once.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-world-text-"));
process.env.GAME_DATA_DIR = dataDir;
// One test writes a file, so these work on copies.
const realWorld = fileURLToPath(new URL("../world/", import.meta.url));
for (const [folder, env] of [["characters", "GAME_PEOPLE_DIR"], ["places", "GAME_PLACES_DIR"], ["species", "GAME_SPECIES_DIR"], ["enemies", "GAME_ENEMIES_DIR"], ["items", "GAME_ITEMS_DIR"], ["factions", "GAME_FACTIONS_DIR"], ["perks", "GAME_PERKS_DIR"]]) {
  const copy = path.join(dataDir, folder);
  fs.mkdirSync(copy);
  for (const name of fs.readdirSync(path.join(realWorld, folder))) fs.copyFileSync(path.join(realWorld, folder, name), path.join(copy, name));
  process.env[env] = copy;
}

const { ENEMY, FACTION, ITEM, PERK, PERSON, PLACE, SPECIES_SPEC, parsePersonText, parsePlaceText, parseSpeciesText, parseWorldText, writePersonText, writeWorldText } = await import("../public/world-text.js");
const { ENEMIES_DIR, FACTIONS_DIR, ITEMS_DIR, PEOPLE_DIR, PERKS_DIR, PLACES_DIR, SPECIES_DIR, WORLD_CHARACTERS, WORLD_ENEMIES, WORLD_FACTIONS, WORLD_FILE_PROBLEMS, WORLD_ITEMS, WORLD_PERKS, WORLD_PLACES, WORLD_SPECIES, reloadWorld } = await import("../src/world.js");
const { FACTION_BELIEFS, NOTABLES, SPECIES, refreshFactionBeliefs } = await import("../src/character-data.js");
const { ENEMIES, FACTIONS, ITEMS, LOCATIONS, PERKS, STARTING_FACTIONS, refreshFactions, refreshLocations } = await import("../src/data.js");

const canon = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.keys(inner).sort().map((k) => [k, inner[k]])) : inner));

test("every person, place and species reads without a problem, writes back the same, and the game holds them all", () => {
  assert.deepEqual(WORLD_FILE_PROBLEMS, []);
  for (const [dir, spec, count] of [[PEOPLE_DIR, PERSON, 61], [PLACES_DIR, PLACE, 24], [SPECIES_DIR, SPECIES_SPEC, 6], [ENEMIES_DIR, ENEMY, 34], [ITEMS_DIR, ITEM, 60], [FACTIONS_DIR, FACTION, 12], [PERKS_DIR, PERK, 53]]) {
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
    assert.equal(files.length, count, dir);
    for (const name of files) {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const first = parseWorldText(text, spec, name.slice(0, -4));
      assert.deepEqual(first.problems, [], name);
      assert.equal(writeWorldText(first.value, spec), text, `${name} is written the way the game writes it`);
      const again = parseWorldText(writeWorldText(first.value, spec), spec, name.slice(0, -4));
      assert.equal(canon(again.value), canon(first.value), name);
    }
  }
  assert.equal(Object.keys(WORLD_CHARACTERS).length, 61);
  assert.equal(Object.keys(WORLD_PLACES).length, 24);
  assert.deepEqual(Object.keys(WORLD_SPECIES), ["human", "korrun", "veshti", "ilari", "thessan", "synthetic"], "in the order the character creator shows them");
  assert.equal(NOTABLES, WORLD_CHARACTERS);
  assert.equal(SPECIES, WORLD_SPECIES);
  assert.equal(SPECIES.human.fx.factions.fleet, 5);
  assert.equal(SPECIES.synthetic.agelessTerms, 99);
  assert.equal(SPECIES.synthetic.fx.fatigueRate, 0.25);
  assert.equal(NOTABLES.aduro.combat.damage[1] > 0, true);
  assert.equal(NOTABLES.cantor.faction, null, "a person with no faction");
  assert.equal(NOTABLES.cantor.age, null);
  assert.deepEqual(NOTABLES.aduro.combat.tags, []);
  assert.equal(NOTABLES.aduro.listed, undefined);
  assert.equal(LOCATIONS.haven.name, "Haven Station");
  assert.ok(LOCATIONS.haven.market.includes("medkit"));
  assert.equal(LOCATIONS.haven.gm.districts.length, 5);
  assert.equal(LOCATIONS.meridian.fleet, true);
  assert.equal(ENEMIES, WORLD_ENEMIES);
  assert.equal(ITEMS, WORLD_ITEMS);
  assert.equal(FACTIONS, WORLD_FACTIONS);
  assert.equal(Object.keys(WORLD_ENEMIES).length, 34);
  assert.equal(ENEMIES.dock_thug.weapon, "Stun Baton");
  assert.deepEqual(ENEMIES.dock_thug.damage, [2, 5]);
  assert.ok(ENEMIES.dock_thug.lines.intro.length >= 1);
  assert.equal(Object.keys(ITEMS).length, 60);
  assert.deepEqual(Object.keys(ITEMS).slice(0, 2), ["sidearm", "focus_blade"], "the items keep the order they had in the code");
  assert.equal(ITEMS.service_rifle.type, "weapon");
  assert.deepEqual(ITEMS.service_rifle.damage, [5, 9]);
  assert.equal(ITEMS.data_chip.type, "story");
  assert.deepEqual(Object.keys(FACTIONS).slice(0, 4), ["fleet", "hegemony", "drift", "ilun"], "the four the game always knew come first");
  assert.equal(Object.keys(FACTIONS).length, 12);
  assert.equal(FACTIONS.fleet.name, "Refugee Fleet");
  assert.equal(STARTING_FACTIONS.fleet, 20);
  assert.equal(STARTING_FACTIONS.hegemony, -10);
  assert.equal(STARTING_FACTIONS.guild, 0);
  assert.deepEqual(FACTION_BELIEFS.fleet, { loyalty: -6, violence: -1 });
  assert.deepEqual(FACTION_BELIEFS.guild, { authority: -4, loyalty: 5, belief: -3 });
  assert.equal(PERKS, WORLD_PERKS);
  assert.equal(Object.keys(PERKS).length, 53);
  assert.equal(Object.keys(PERKS)[0], "chain_of_command", "the perks keep the order they had in the code");
  assert.deepEqual(PERKS.chain_of_command.fx, { skills: { leadership: 2 } });
  assert.equal(PERKS.chain_of_command.starting, true);
  assert.deepEqual(PERKS.dead_ship_passwords.requiresSkill, { hacking: 5 });
  assert.deepEqual(PERKS.dead_ship_passwords.fx.windowTier, { hacking: 1 });
  assert.ok(Object.values(PERKS).some((perk) => perk.ability === "rally"));
  assert.ok(Object.values(PERKS).some((perk) => perk.fx?.healRate === 1.25));
  assert.ok(Object.values(PERKS).some((perk) => typeof perk.requires === "string"));
});

test("a perk's file holds what it needs at the top and what it changes below", () => {
  const { value, problems } = parseWorldText(`# Dead Ship Passwords
order: 12
starting: no
needs perk: chain_of_command
needs skill: hacking 5
needs attribute: intellect 6
ability: spike

In a line:
You've opened enough dead ships.

Effects:
skills: hacking 1
better tools in: hacking 1
max hp: 5
heal rate: 1.25
`, PERK, "dead_ship_passwords");
  assert.deepEqual(problems, []);
  assert.deepEqual(value, { name: "Dead Ship Passwords", order: 12, starting: false, requires: "chain_of_command", requiresSkill: { hacking: 5 }, requiresStat: { intellect: 6 }, ability: "spike", desc: "You've opened enough dead ships.", fx: { skills: { hacking: 1 }, windowTier: { hacking: 1 }, maxHp: 5, healRate: 1.25 } });
});

test("an enemy's file holds its numbers at the top and its lines below", () => {
  const { value, problems } = parseWorldText(`# Dock Thug
threat: 1
hp: 14
damage: 2 to 5
weapon: Stun Baton
credits: 10 to 40
tags:
motive: paid
on hit: stress 2

In a line:
Hired muscle.

When the fight starts:
- A thug steps out.

When they join the fight:
- Another one.
`, ENEMY, "dock_thug");
  assert.deepEqual(problems, []);
  assert.deepEqual(value, { name: "Dock Thug", threat: 1, hp: 14, damage: [2, 5], weapon: "Stun Baton", credits: [10, 40], tags: [], motive: "paid", onHit: { stress: 2 }, desc: "Hired muscle.", lines: { intro: ["A thug steps out."], joins: ["Another one."] } });
  const faction = parseWorldText("# The Guild\norder: 5\nalso called: the Guild\nstarting standing: -5\n\nIn a line:\nWreck-divers.\n\nBeliefs:\nloyalty 5, belief -3\n", FACTION, "guild");
  assert.deepEqual(faction.problems, []);
  assert.deepEqual(faction.value, { name: "The Guild", order: 5, aliases: ["the Guild"], start: -5, desc: "Wreck-divers.", beliefs: { loyalty: 5, belief: -3 } });
  const item = parseWorldText("# Calm Tabs\ntype: consumable\nprice: 30\neffect: energy 2\n\nIn a line:\nTwo tablets.\n\nEffects:\nskills: composure 1\n", ITEM, "calm_tabs");
  assert.deepEqual(item.problems, []);
  assert.deepEqual(item.value, { name: "Calm Tabs", type: "consumable", price: 30, effect: { energy: 2 }, desc: "Two tablets.", fx: { skills: { composure: 1 } } });
});

test("a faction saved while the game runs changes what a new captain starts with, at once", () => {
  const file = path.join(FACTIONS_DIR, "guild.txt");
  const text = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, text.replace("starting standing: 0", "starting standing: 7").replace("loyalty 5", "loyalty 9"));
    reloadWorld();
    refreshFactions();
    refreshFactionBeliefs();
    assert.equal(STARTING_FACTIONS.guild, 7);
    assert.equal(FACTION_BELIEFS.guild.loyalty, 9);
    assert.equal(FACTIONS.guild.start, 7, "the same object the game holds");
  } finally {
    fs.writeFileSync(file, text);
    reloadWorld();
    refreshFactions();
    refreshFactionBeliefs();
  }
  assert.equal(STARTING_FACTIONS.guild, 0);
});

test("a person's file is plain words and a few lines of numbers", () => {
  const { value, problems } = parsePersonText(`# Sen Aduro
title: Dr.
also called: Dr. Aduro, Aduro
pronouns: they/them
species: ilari
age: unknown
faction: none
role: Chief medical officer
place: meridian
crew: yes
color: #7fe0c3
listed: no

In a line:
Exhausted, kind, and the conscience
of the ship.

Beliefs:
loyalty -5, violence -7

Attributes:
might 2, endurance 4

In a fight:
threat: 1
damage: 2 to 5
weapon: Surgical Laser
tags:
on hit: stress 3
machine: no

When the fight starts:
- The doctor sighs.
`, "aduro");
  assert.deepEqual(problems, []);
  assert.deepEqual(value, {
    name: "Sen Aduro", title: "Dr.", aliases: ["Dr. Aduro", "Aduro"], pronouns: "they/them", species: "ilari", age: null, faction: null, role: "Chief medical officer", location: "meridian", crew: true, color: "#7fe0c3", listed: false,
    note: "Exhausted, kind, and the conscience of the ship.",
    beliefs: { loyalty: -5, violence: -7 }, attributes: { might: 2, endurance: 4 },
    combat: { threat: 1, damage: [2, 5], weapon: "Surgical Laser", tags: [], onHit: { stress: 3 }, machine: false, lines: { intro: ["The doctor sighs."] } },
  });
  assert.equal(writePersonText(value).split("\n")[6], "faction: none");
});

test("a file's problems are named with their line, and the file is still read as far as it goes", () => {
  const { value, problems } = parsePlaceText(`Haven Station
also called: Haven
weather: wet
dangerous: maybe

In a line:
A trade hub.

The Vibe:
cool

Districts:
Just words without a colon
The Neutral Ground: Sable's bar.

Complications:
A line without its dash

Rumors:
- One.
`, "haven");
  const expect = (line, pattern) => assert.ok(problems.some((one) => one.line === line && pattern.test(one.message)), `line ${line} ${pattern}\n${problems.map((one) => `${one.line}: ${one.message}`).join("\n")}`);
  expect(1, /first line is the name/);
  expect(3, /before the first part, each line is one of also called, faction, market/);
  expect(4, /dangerous is yes or no/);
  expect(9, /I don't know a part of a place called "The Vibe"/);
  expect(13, /each one is written Its Name: what it's like/);
  expect(17, /each one starts with - and a space/);
  assert.equal(problems.length, 6, problems.map((one) => `${one.line}: ${one.message}`).join("\n"));
  assert.equal(value.name, "Haven Station");
  assert.deepEqual(value.gm.districts, [{ name: "The Neutral Ground", desc: "Sable's bar." }]);
  assert.deepEqual(value.rumors, ["One."]);
  const species = parseSpeciesText("# Thing\norder: 1\n\nEffects:\nmax hp: 5\nstanding with: fleet 5, ilun -10\n", "thing");
  assert.deepEqual(species.problems, []);
  assert.deepEqual(species.value, { name: "Thing", order: 1, fx: { maxHp: 5, factions: { fleet: 5, ilun: -10 } } });
});

test("a person, a place or a species saved while the game runs is read again into the same objects", () => {
  const file = path.join(PLACES_DIR, "haven.txt");
  const text = fs.readFileSync(file, "utf8");
  const people = WORLD_CHARACTERS, places = WORLD_PLACES;
  try {
    fs.writeFileSync(file, text.replace("# Haven Station", "# Haven Station, Rebuilt"));
    reloadWorld();
    refreshLocations();
    assert.equal(WORLD_PLACES, places, "the same object");
    assert.equal(WORLD_CHARACTERS, people);
    assert.equal(WORLD_PLACES.haven.name, "Haven Station, Rebuilt");
    assert.equal(LOCATIONS.haven.name, "Haven Station, Rebuilt", "and the places the game looks up follow");
  } finally {
    fs.writeFileSync(file, text);
    reloadWorld();
    refreshLocations();
  }
  assert.equal(LOCATIONS.haven.name, "Haven Station");
});
