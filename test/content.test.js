// The world's files, checked against each other: every person, place, enemy and item a file
// mentions has to exist. This reads the files directly, so a mistake shows up here first.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const world = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "world");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function folder(name) {
  const dir = path.join(world, name);
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), readJson(path.join(dir, f))]));
}

const single = (name) => (fs.existsSync(path.join(world, name)) ? readJson(path.join(world, name)) : {});

const BASE_ITEMS = ["sidearm", "focus_blade", "arc_welder", "heavy_carbine", "needle_rifle", "choir_lance", "flak_vest", "smugglers_coat", "adept_robes", "marine_plate", "ghostweave", "medkit", "stim", "energy_cell", "repair_kit", "fuel_cell", "lockbreaker", "forged_papers", "beacon_shard", "ilun_codex", "choir_core", "data_chip"];
const BASE_PLACES = ["meridian", "haven", "kessara", "ilun", "vantor", "graveyard", "frontier", "nest"];
const BASE_FACTIONS = ["fleet", "hegemony", "drift", "ilun"];
const SKILLS = ["firearms", "melee", "tactics", "gunnery", "piloting", "navigation", "void_ops", "engineering", "hacking", "science", "medicine", "lore", "persuasion", "deception", "intimidation", "leadership", "commerce", "streetwise", "stealth", "awareness", "survival", "athletics", "composure", "attunement", "manifestation"];
const DIFFICULTIES = ["easy", "moderate", "hard", "very_hard", "nearly_impossible"];
const SPECIES = ["human", "korrun", "veshti", "ilari", "thessan", "synthetic", "unknown"];
const AXES = ["authority", "loyalty", "violence", "belief", "flesh"];
const KINDS = ["job", "mystery", "crew", "politics", "survival", "exploration", "dilemma", "faction", "main"];
const CONTEXTS = ["choir", "machines", "hegemony", "syndicate", "resonance", "vacuum", "confined", "crowd", "authority", "low_light", "heavy_gravity", "loved_one"];

const { PERSON, PLACE, parseWorldText } = await import("../public/world-text.js");
const textFolder = (name, spec) => Object.fromEntries(fs.readdirSync(path.join(world, name))
  .filter((file) => file.endsWith(".txt") && !file.startsWith("_"))
  .map((file) => [file.slice(0, -".txt".length), parseWorldText(fs.readFileSync(path.join(world, name, file), "utf8"), spec, file.slice(0, -".txt".length)).value]));
const characters = textFolder("characters", PERSON);
const { ENEMY, FACTION, ITEM } = await import("../public/world-text.js");
const enemies = textFolder("enemies", ENEMY);
const places = textFolder("places", PLACE);
const { parseStoryText } = await import("../public/story-text.js");
const threads = Object.fromEntries(fs.readdirSync(path.join(world, "stories"))
  .filter((name) => name.endsWith(".txt") && !name.startsWith("_"))
  .map((name) => [name.slice(0, -".txt".length), parseStoryText(fs.readFileSync(path.join(world, "stories", name), "utf8"), name.slice(0, -".txt".length)).story]));
const items = textFolder("items", ITEM);
const { PERK } = await import("../public/world-text.js");
const { ABILITIES } = await import("../src/data.js");
const perks = textFolder("perks", PERK);
const factions = textFolder("factions", FACTION);
const art = single("art.json");
const arc = single("arc.json");
const events = single("fleet-events.json");

const itemIds = new Set([...BASE_ITEMS, ...Object.keys(items)]);
const placeIds = new Set([...BASE_PLACES, ...Object.keys(places)]);
const factionIds = new Set([...BASE_FACTIONS, ...Object.keys(factions)]);

const text = (value) => typeof value === "string" && value.trim().length > 0;
const problems = [];
const report = (where, what) => problems.push(`${where}: ${what}`);
function finish(name) {
  const found = problems.splice(0);
  assert.equal(found.length, 0, `${name}\n${found.join("\n")}`);
}

test("places say what the game master needs, and everything they mention exists", () => {
  for (const [id, place] of Object.entries(places)) {
    const where = `places/${id}`;
    if (!text(place.name)) report(where, "needs a name");
    if (!text(place.desc)) report(where, "needs a desc");
    if (!Array.isArray(place.market)) report(where, "market must be a list");
    for (const item of place.market ?? []) if (!itemIds.has(item)) report(where, `sells unknown item ${item}`);
    if (place.faction && !factionIds.has(place.faction)) report(where, `unknown faction ${place.faction}`);
    const gm = place.gm ?? {};
    if (!text(gm.feel)) report(where, "gm.feel is missing");
    if ((gm.districts ?? []).length < 3) report(where, "needs at least 3 districts");
    for (const person of gm.people ?? []) if (!characters[person]) report(where, `unknown person ${person}`);
    for (const enemy of gm.enemies ?? []) if (!enemies[enemy]) report(where, `unknown enemy ${enemy}`);
    for (const item of gm.items ?? []) if (!itemIds.has(item)) report(where, `unknown item ${item}`);
    if ((gm.complications ?? []).length < 4) report(where, "needs at least 4 complications");
    if ((gm.secrets ?? []).length < 2) report(where, "needs at least 2 secrets");
    if ((place.encounters ?? []).length < 10) report(where, "needs at least 10 encounters");
    if ((place.rumors ?? []).length < 10) report(where, "needs at least 10 rumors");
  }
  finish("Problems with places:");
});

test("factions have beliefs on real axes", () => {
  for (const [id, faction] of Object.entries(factions)) {
    if (!text(faction.name) || !text(faction.desc)) report(`factions/${id}`, "needs a name and a desc");
    for (const [axis, value] of Object.entries(faction.beliefs ?? {})) {
      if (!AXES.includes(axis)) report(`factions/${id}`, `unknown axis ${axis}`);
      if (Math.abs(value) > 9) report(`factions/${id}`, `${axis} is too extreme`);
    }
  }
  finish("Problems with factions:");
});

test("character files are complete", () => {
  const colors = new Map();
  for (const [id, person] of Object.entries(characters)) {
    const where = `characters/${id}`;
    for (const field of ["name", "pronouns", "role", "note", "personality", "voice"]) if (!text(person[field])) report(where, `${field} is missing`);
    if (person.species && !SPECIES.includes(person.species)) report(where, `unknown species ${person.species}`);
    if (person.faction && !factionIds.has(person.faction)) report(where, `unknown faction ${person.faction}`);
    if (person.location && !placeIds.has(person.location)) report(where, `unknown place ${person.location}`);
    for (const skill of Object.keys(person.skills ?? {})) if (!SKILLS.includes(skill)) report(where, `unknown skill ${skill}`);
    for (const axis of Object.keys(person.beliefs ?? {})) if (!AXES.includes(axis)) report(where, `unknown axis ${axis}`);
    if (!person.combat?.hp || !person.combat?.damage) report(where, "combat stats are missing");
    if (person.combat?.art && !art[person.combat.art]) report(where, `unknown art ${person.combat.art}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(person.color ?? "")) report(where, "needs a hex color");
    if (colors.has(person.color)) report(where, `same color as ${colors.get(person.color)}`);
    colors.set(person.color, id);
  }
  finish("Problems with characters:");
});

test("enemy files are complete", () => {
  for (const [id, enemy] of Object.entries(enemies)) {
    const where = `enemies/${id}`;
    for (const field of ["name", "desc"]) if (!text(enemy[field])) report(where, `${field} is missing`);
    for (const field of ["threat", "hp", "attack", "defense", "xp"]) if (typeof enemy[field] !== "number") report(where, `${field} must be a number`);
    if (!Array.isArray(enemy.damage)) report(where, "damage must be [min, max]");
    if (!art[enemy.art]) report(where, `unknown art ${enemy.art}`);
    for (const tag of enemy.tags ?? []) if (!CONTEXTS.includes(tag)) report(where, `unknown tag ${tag}`);
    const lines = enemy.lines ?? {};
    if ((lines.hit ?? []).length < 2 || (lines.miss ?? []).length < 2 || !lines.crit?.length || !lines.defeated?.length || !lines.intro?.length) report(where, "needs its fight lines");
  }
  finish("Problems with enemies:");
});

test("items and perks are complete", () => {
  for (const [id, item] of Object.entries(items)) {
    const where = `items/${id}`;
    if (!text(item.name) || !text(item.desc) || typeof item.price !== "number") report(where, "needs a name, desc and price");
    if (!["weapon", "armor", "consumable", "gadget", "story"].includes(item.type)) report(where, `unknown type ${item.type}`);
    if (item.type === "weapon") {
      if (!Array.isArray(item.damage)) report(where, "needs damage");
      if (!SKILLS.includes(item.skill)) report(where, `unknown skill ${item.skill}`);
      if (!item.stat) report(where, "needs a stat");
    }
    if (item.type === "armor" && typeof item.defense !== "number") report(where, "needs defense");
    if (item.type === "consumable" && !item.effect) report(where, "needs an effect");
    for (const skill of Object.keys(item.fx?.skills ?? {})) if (!SKILLS.includes(skill)) report(where, `unknown skill ${skill}`);
  }
  for (const [id, perk] of Object.entries(perks)) {
    const where = `perks/${id}`;
    if (!text(perk.name) || !text(perk.desc)) report(where, "needs a name and a desc");
    if (perk.ability && !ABILITIES[perk.ability]) report(where, `unknown ability ${perk.ability}: abilities are part of the game's code`);
    for (const skill of Object.keys(perk.requiresSkill ?? {})) if (!SKILLS.includes(skill)) report(where, `unknown skill ${skill}`);
    for (const skill of Object.keys(perk.fx?.skills ?? {})) if (!SKILLS.includes(skill)) report(where, `unknown skill ${skill}`);
    for (const skill of Object.keys(perk.fx?.windowTier ?? {})) if (!SKILLS.includes(skill)) report(where, `unknown skill ${skill}`);
  }
  finish("Problems with items and perks:");
});

test("story threads are complete, and everything they mention exists", () => {
  const leads = new Map();
  for (const [id, thread] of Object.entries(threads)) {
    const where = `stories/${id}`;
    if (!text(thread.title)) report(where, "needs a title");
    if (!text(thread.lead)) report(where, "needs a lead");
    if (!KINDS.includes(thread.kind)) report(where, `unknown kind ${thread.kind}`);
    if (!Array.isArray(thread.places) || !thread.places.length) report(where, "needs places");
    for (const place of thread.places ?? []) if (place !== "any" && place !== "fleet" && !placeIds.has(place)) report(where, `unknown place ${place}`);
    if (thread.after && !threads[thread.after]) report(where, `comes after unknown thread ${thread.after}`);
    for (const person of thread.people ?? []) if (!characters[person]) report(where, `unknown person ${person}`);
    for (const faction of thread.factions ?? []) if (!factionIds.has(faction)) report(where, `unknown faction ${faction}`);
    if ((thread.people ?? []).length === 0) report(where, "needs at least one person");
    const gm = thread.gm ?? {};
    if (!text(gm.truth)) report(where, "gm.truth is missing");
    if ((gm.beats ?? []).length < 3) report(where, "needs at least 3 beats");
    if ((gm.routes ?? []).length < 3) report(where, "needs at least 3 routes");
    if ((gm.outcomes ?? []).length < 3) report(where, "needs at least 3 outcomes");
    if ((gm.checks ?? []).length < 3) report(where, "needs at least 3 checks");
    for (const check of gm.checks ?? []) {
      const [, skill, difficulty] = check.match(/^(\w+):(\w+)/) ?? [];
      if (!SKILLS.includes(skill)) report(where, `check uses unknown skill: ${check}`);
      if (!DIFFICULTIES.includes(difficulty)) report(where, `check uses unknown difficulty: ${check}`);
    }
    const firstWords = thread.lead?.slice(0, 40);
    if (leads.has(firstWords)) report(where, `lead starts the same as ${leads.get(firstWords)}`);
    leads.set(firstWords, id);
  }
  finish("Problems with threads:");
});

test("the main story and the fleet's events are complete", () => {
  for (const [i, act] of (arc.acts ?? []).entries()) {
    if (!text(act.name) || !text(act.goal)) report(`arc/act ${i}`, "needs a name and a goal");
  }
  for (const clue of arc.clues ?? []) {
    if (!text(clue.id) || !text(clue.text)) report(`arc/clue ${clue.id}`, "needs an id and text");
    for (const place of clue.places ?? []) if (!placeIds.has(place)) report(`arc/clue ${clue.id}`, `unknown place ${place}`);
  }
  for (const [i, event] of (events.events ?? []).entries()) {
    if (!text(event.id) || !text(event.text)) report(`fleet-events/${i}`, "needs an id and text");
    for (const person of event.people ?? []) if (!characters[person]) report(`fleet-events/${event.id}`, `unknown person ${person}`);
  }
  finish("Problems with the main story and fleet events:");
});
