// What the story board in the game reads and writes: a story's file as boxes and arrows need it, with who reacts to
// it elsewhere and what the checker has to say, and a written scene as its parts and their choices. Saving goes
// through the same readers as the game, so a file that can't be read is never written.

import fs from "node:fs";
import path from "node:path";
import { AXES, CONTEXTS, SKILLS, refreshFactionBeliefs } from "./character-data.js";
import { ABILITIES, ENEMIES, FACTIONS, ITEMS, LOCATIONS, PERKS, STATS, refreshFactions, refreshLocations } from "./data.js";
import { dataDir } from "./paths.js";
import { writtenThreadIds } from "./scene-files.js";
import { parseSceneText } from "./scene-text.js";
import { SCENES_DIR, factsLeft, loadScenes, sceneProblems } from "./scenes.js";
import { clockProblems } from "./story-clock.js";
import { notesProblems } from "./story-library.js";
import { ENEMIES_DIR, FACTIONS_DIR, FLEET_DATA, ITEMS_DIR, PEOPLE_DIR, PERKS_DIR, PLACES_DIR, SPECIES_DIR, STORIES_DIR, STORY_CLOCK, STORY_FILE_PROBLEMS, WORLD_CHARACTERS, WORLD_ENEMIES, WORLD_FACTIONS, WORLD_FILE_PROBLEMS, WORLD_ITEMS, WORLD_PERKS, WORLD_PLACES, WORLD_SPECIES, WORLD_THREADS, endingsOf, reloadStories, reloadWorld } from "./world.js";
import { parseStoryText, writeStoryText } from "../public/story-text.js";
import { ENEMY, FACTION, ITEM, PERK, PERSON, PLACE, SPECIES_SPEC, parseWorldText, writeWorldText } from "../public/world-text.js";

const ID = /^[a-z][a-z0-9_]{1,60}$/;
function checkId(id) {
  if (!ID.test(id ?? "")) throw new Error("A story's id is lowercase letters, digits and underscores.");
  return id;
}
const lineOf = (one) => (typeof one === "string" ? one : `${one.line ? `line ${one.line}: ` : ""}${one.message}`);

// Where the boxes were moved to, by story or thing, kept in the data folder: it's the owner's own tidying, not
// part of the world's files.
const layoutFile = () => path.join(dataDir(), "board-layout.json");
export function readLayout() {
  try {
    return JSON.parse(fs.readFileSync(layoutFile(), "utf8"));
  } catch {
    return {};
  }
}
export function saveLayout(key, positions) {
  if (!/^[a-z]+\/[a-z][a-z0-9_]*$/.test(key ?? "")) throw new Error("The layout's key is the kind and the id, like story/main_two_weeks_of_fuel.");
  const all = readLayout();
  if (positions && typeof positions === "object" && Object.keys(positions).length) all[key] = positions;
  else delete all[key];
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(layoutFile(), JSON.stringify(all));
  return { saved: true };
}

// Every story, for the board's list.
export function boardStories() {
  const written = writtenThreadIds();
  return Object.entries(WORLD_THREADS)
    .map(([id, story]) => ({ id, title: story.title, kind: story.kind, written: written.has(id) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

// The checker's problems with one story: its file, its notes and its clock.
function problemsFor(id) {
  const known = factsLeft(loadScenes().scenes);
  const mine = (one) => one.startsWith(`${id},`) || one.startsWith(`${id} `) || one.startsWith(`stories/${id}.txt`);
  return [...STORY_FILE_PROBLEMS, ...notesProblems(known), ...clockProblems(known)].filter(mine);
}

// One story as the board shows it: its file and what the game read from it, who reacts to it in other stories,
// what there is to pick from, and the checker's problems with it.
export function boardStory(id) {
  checkId(id);
  const story = WORLD_THREADS[id];
  if (!story) throw new Error(`There's no story called ${id}.`);
  const clock = STORY_CLOCK.threads[id] ?? { stages: [] };
  const file = path.join(STORIES_DIR, `${id}.txt`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : writeStoryText(story, clock);
  const mentions = (one) => typeof one === "string" && one.includes(`ended ${id}`);
  const next = [];
  for (const [other, thread] of Object.entries(WORLD_THREADS)) {
    if (other === id) continue;
    const theirs = STORY_CLOCK.threads[other] ?? {};
    for (const one of thread.gm?.reacts ?? []) if (mentions(one.to)) next.push({ story: other, title: thread.title, to: one.to, then: one.then, where: "its notes" });
    for (const stage of theirs.stages ?? []) if (mentions(stage.if)) next.push({ story: other, title: thread.title, to: stage.if, then: stage.news, where: `its clock, day ${stage.after}` });
    for (const one of theirs.consequences ?? []) if (mentions(one.of)) next.push({ story: other, title: thread.title, to: one.of, then: one.news, where: `its clock, ${one.after} days later` });
  }
  return {
    id, text, story, clock, next,
    written: writtenThreadIds().has(id),
    places: Object.entries(LOCATIONS).map(([placeId, place]) => ({ id: placeId, name: place.name })),
    facts: [...factsLeft(loadScenes().scenes)].sort(),
    stories: boardStories().map((one) => ({ id: one.id, title: one.title, endings: endingsOf(WORLD_THREADS[one.id]).map((ending) => ending.id) })),
    lists: boardLists(),
    layout: readLayout()[`story/${id}`] ?? {},
    problems: problemsFor(id),
  };
}

// Writes a story's file, if it can be read, and reads every story again so the game plays the new one.
export function saveBoardStory(id, text) {
  checkId(id);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseStoryText(text, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(STORIES_DIR, { recursive: true });
  fs.writeFileSync(path.join(STORIES_DIR, `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  reloadStories();
  return { saved: true, problems: problemsFor(id) };
}

// A scene file as the board shows it: the lines before the first part, then each part with its name, the lines
// under it as they are in the file, and what the game reads from them: the choices and where they go, the rules,
// a check or a fight, and whether it ends the scene. Put back together line for line, it's the file again.
export function sceneBoardView(text, name) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  const header = [];
  let current = null;
  lines.forEach((line, index) => {
    const start = line.match(/^==\s*(\S+)\s*$/);
    if (start) {
      current = { name: start[1], line: index + 1, lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
    else header.push(line);
  });
  const { scene, problems } = parseSceneText(text, name);
  const parts = blocks.map((block) => {
    const part = scene?.parts?.[block.name] ?? {};
    const words = (part.text ?? []).filter((one) => typeof one === "string");
    const first = words.find((one) => !one.startsWith("@") && !one.startsWith("=>")) ?? words[0] ?? "";
    return {
      name: block.name,
      line: block.line,
      raw: block.lines.join("\n"),
      text: first.slice(0, 240),
      choices: (part.choices ?? []).map((one) => ({ say: one.say, to: one.to ?? null, pass: one.pass ?? null, fail: one.fail ?? null, check: one.check ?? null, if: one.if ?? null, line: one.line ?? null })),
      when: (part.when ?? []).map((one) => ({ if: one.if ?? null, to: one.to ?? null, line: one.line ?? null })),
      check: part.check ?? null, pass: part.pass ?? null, fail: part.fail ?? null,
      fight: part.fight ? part.fight.enemy ?? "a fight" : null, won: part.won ?? null, lost: part.lost ?? null, fled: part.fled ?? null, gaveUp: part.gaveUp ?? null, talked: part.talked ?? null,
      end: Boolean(part.end),
      ai: part.ai ?? null,
    };
  });
  return { header: header.join("\n"), parts, problems: (problems ?? []).map(lineOf) };
}

// A story's scene is thread_<id>.txt; a person's written lines are talk_<id>.txt.
const sceneFile = (id, prefix) => path.join(SCENES_DIR, `${prefix}_${checkId(id)}.txt`);
const sceneName = (id, prefix) => `${prefix}_${checkId(id)}`;

export function boardScene(id, prefix = "thread") {
  const file = sceneFile(id, prefix);
  if (!fs.existsSync(file)) throw new Error(prefix === "talk" ? `${WORLD_CHARACTERS[id]?.name ?? id} has no written lines yet: the AI, or the stock lines, speak for them.` : `${WORLD_THREADS[id]?.title ?? id} has no written scene yet.`);
  const text = fs.readFileSync(file, "utf8");
  return { id, text, ...checkBoardScene(id, text, prefix) };
}

// The scene as the board would show it after a change, with the checker's problems, without saving anything.
export function checkBoardScene(id, text, prefix = "thread") {
  const name = sceneName(id, prefix);
  const view = sceneBoardView(text, name);
  const parsed = parseSceneText(text, name);
  const problems = parsed.problems?.length ? view.problems : sceneProblems(parsed.scene, name, { talk: prefix === "talk" });
  return { ...view, problems };
}

export function saveBoardScene(id, text, prefix = "thread") {
  const file = sceneFile(id, prefix);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const name = sceneName(id, prefix);
  const parsed = parseSceneText(text, name);
  if (parsed.problems?.length) return { saved: false, problems: parsed.problems.map(lineOf) };
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`);
  return { saved: true, problems: sceneProblems(parsed.scene, name, { talk: prefix === "talk" }) };
}

// ---- People, places and species ------------------------------------------------------------------

const WORLD_KINDS = {
  person: { dir: () => PEOPLE_DIR, spec: PERSON, all: WORLD_CHARACTERS, folder: "characters", what: "person" },
  place: { dir: () => PLACES_DIR, spec: PLACE, all: WORLD_PLACES, folder: "places", what: "place" },
  species: { dir: () => SPECIES_DIR, spec: SPECIES_SPEC, all: WORLD_SPECIES, folder: "species", what: "species" },
  enemy: { dir: () => ENEMIES_DIR, spec: ENEMY, all: WORLD_ENEMIES, folder: "enemies", what: "enemy" },
  item: { dir: () => ITEMS_DIR, spec: ITEM, all: WORLD_ITEMS, folder: "items", what: "item" },
  faction: { dir: () => FACTIONS_DIR, spec: FACTION, all: WORLD_FACTIONS, folder: "factions", what: "faction" },
  perk: { dir: () => PERKS_DIR, spec: PERK, all: WORLD_PERKS, folder: "perks", what: "perk" },
};
const kindOf = (kind) => {
  if (!WORLD_KINDS[kind]) throw new Error("The board knows stories, people, places, species, enemies, items, factions and perks.");
  return WORLD_KINDS[kind];
};
const talkIds = () => new Set(fs.existsSync(SCENES_DIR) ? fs.readdirSync(SCENES_DIR).map((name) => name.match(/^talk_(.+)\.txt$/)?.[1]).filter(Boolean) : []);

export function boardWorldList(kind) {
  const { all } = kindOf(kind);
  const written = kind === "person" ? talkIds() : new Set();
  const groupOf = (one) => (kind === "person" || kind === "place" ? one.faction ?? "none" : kind === "enemy" ? one.motive ?? "other" : kind === "item" ? one.type ?? "other" : kind === "perk" ? (one.starting ? "starting" : one.ability ? "with an ability" : "learned") : kind);
  const ordered = Object.values(all).some((one) => one.order !== undefined);
  return Object.entries(all)
    .map(([id, one]) => ({ id, name: [one.title, one.name].filter(Boolean).join(" ") || id, kind: groupOf(one), written: written.has(id) }))
    .sort((a, b) => (ordered ? (all[a.id].order ?? 999) - (all[b.id].order ?? 999) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name)));
}

// What there is to pick from on the board, by id and name.
function boardLists() {
  const named = (table, label = (one) => one.name) => Object.entries(table).map(([id, one]) => ({ id, name: label(one) ?? id }));
  return {
    people: named(WORLD_CHARACTERS, (one) => [one.title, one.name].filter(Boolean).join(" ")),
    places: named(LOCATIONS),
    species: named(WORLD_SPECIES),
    factions: named(FACTIONS),
    items: named(ITEMS),
    enemies: named(ENEMIES),
    skills: Object.keys(SKILLS),
    attributes: Object.keys(STATS),
    axes: Object.keys(AXES),
    contexts: Object.keys(CONTEXTS),
    arts: [...new Set([...Object.values(WORLD_CHARACTERS).map((one) => one.combat?.art), ...Object.values(WORLD_ENEMIES).map((one) => one.art)].filter(Boolean))].sort(),
    kinds: ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"],
    motives: [...new Set(Object.values(WORLD_ENEMIES).map((one) => one.motive).filter(Boolean))].sort(),
    itemTypes: ["weapon", "armor", "consumable", "gadget", "story"],
    perks: named(PERKS),
    abilities: named(ABILITIES),
    ships: (FLEET_DATA.ships ?? []).map((one) => ({ id: one.id, name: one.name })),
    goods: ["food", "fuel", "medicine", "parts"],
    fleetKeys: ["morale", "food", "medicine", "parts", "fuel", "pursuit", "ships", "picked", "sat"],
  };
}

// One person, place or species as the board shows it: its file and what the game read, what it's linked to, what
// there is to pick from, and the checker's problems with the file.
export function boardWorldItem(kind, id) {
  const { all, dir, spec, folder } = kindOf(kind);
  checkId(id);
  const value = all[id];
  if (!value) throw new Error(`There's no ${kind} called ${id}.`);
  const file = path.join(dir(), `${id}.txt`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : writeWorldText(value, spec);
  const stories = (test) => Object.entries(WORLD_THREADS).filter(([, thread]) => test(thread)).map(([storyId, thread]) => ({ id: storyId, title: thread.title }));
  const people = (test) => Object.entries(WORLD_CHARACTERS).filter(([, one]) => test(one)).map(([personId, one]) => ({ id: personId, name: [one.title, one.name].filter(Boolean).join(" "), role: one.role ?? "" }));
  const places = (test) => Object.entries(LOCATIONS).filter(([, place]) => test(place)).map(([placeId, place]) => ({ id: placeId, name: place.name }));
  const enemies = (test) => Object.entries(WORLD_ENEMIES).filter(([, one]) => test(one)).map(([enemyId, one]) => ({ id: enemyId, name: one.name }));
  const factionLink = (factionId) => (factionId ? { id: factionId, name: FACTIONS[factionId]?.name ?? factionId } : null);
  const links = kind === "place"
    ? { people: people((one) => one.location === id || (value.gm?.people ?? []).includes(one.id)), stories: stories((thread) => (thread.places ?? []).includes(id)) }
    : kind === "person"
      ? { place: value.location ? { id: value.location, name: LOCATIONS[value.location]?.name ?? value.location } : null, species: value.species ? { id: value.species, name: WORLD_SPECIES[value.species]?.name ?? value.species } : null, faction: factionLink(value.faction), stories: stories((thread) => (thread.people ?? []).includes(id)), written: talkIds().has(id) }
      : kind === "species"
        ? { people: people((one) => one.species === id) }
        : kind === "enemy"
          ? { faction: factionLink(value.faction), places: places((place) => (place.gm?.enemies ?? []).includes(id)) }
          : kind === "item"
            ? { sold: places((place) => (place.market ?? []).includes(id)), found: places((place) => (place.gm?.items ?? []).includes(id)) }
            : kind === "faction"
              ? { people: people((one) => one.faction === id), places: places((place) => place.faction === id), stories: stories((thread) => (thread.factions ?? []).includes(id)), enemies: enemies((one) => one.faction === id) }
              : { needs: value.requires ? { id: value.requires, name: PERKS[value.requires]?.name ?? value.requires } : null, neededBy: Object.entries(PERKS).filter(([, perk]) => perk.requires === id).map(([perkId, perk]) => ({ id: perkId, name: perk.name })), ability: value.ability ? { id: value.ability, name: ABILITIES[value.ability]?.name ?? value.ability } : null };
  return { id, kind, text, value, links, lists: boardLists(), layout: readLayout()[`${kind}/${id}`] ?? {}, problems: WORLD_FILE_PROBLEMS.filter((one) => one.startsWith(`${folder}/${id}.txt`)) };
}

export function saveBoardWorldItem(kind, id, text) {
  const { dir, spec, folder } = kindOf(kind);
  checkId(id);
  if (typeof text !== "string" || !text.trim()) throw new Error("There's nothing to save.");
  const { problems } = parseWorldText(text, spec, id);
  if (problems.length) return { saved: false, problems: problems.map(lineOf) };
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${id}.txt`), text.endsWith("\n") ? text : `${text}\n`);
  reloadWorld();
  refreshLocations();
  refreshFactions();
  refreshFactionBeliefs();
  return { saved: true, problems: WORLD_FILE_PROBLEMS.filter((one) => one.startsWith(`${folder}/${id}.txt`)) };
}
