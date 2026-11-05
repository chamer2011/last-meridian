// The story board's side in the game: a story as the board needs it, saving a story's file through the same reader
// the game uses, and a written scene as its parts and choices, put back together line for line.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-board-"));
process.env.GAME_DATA_DIR = dataDir;
// The board writes files, so these tests work on copies of the stories and the scenes.
const worldDir = fileURLToPath(new URL("../world/", import.meta.url));
for (const [folder, env] of [["stories", "GAME_STORIES_DIR"], ["scenes", "GAME_SCENES_DIR"], ["characters", "GAME_PEOPLE_DIR"], ["places", "GAME_PLACES_DIR"], ["species", "GAME_SPECIES_DIR"], ["enemies", "GAME_ENEMIES_DIR"], ["items", "GAME_ITEMS_DIR"], ["factions", "GAME_FACTIONS_DIR"], ["perks", "GAME_PERKS_DIR"], ["computers", "GAME_COMPUTERS_DIR"], ["systems", "GAME_SYSTEMS_DIR"]]) {
  const copy = path.join(dataDir, folder);
  fs.mkdirSync(copy);
  for (const name of fs.readdirSync(path.join(worldDir, folder))) fs.copyFileSync(path.join(worldDir, folder, name), path.join(copy, name));
  process.env[env] = copy;
}

const { boardScene, boardStories, boardStory, boardWorldItem, boardWorldList, checkBoardScene, readLayout, saveBoardScene, saveBoardStory, saveBoardWorldItem, saveLayout, sceneBoardView } = await import("../src/board.js");
const { LOCATIONS } = await import("../src/data.js");
const { SCENES_DIR } = await import("../src/scenes.js");
const { COMPUTERS_DIR, PLACES_DIR, STORIES_DIR, STORY_CLOCK, WORLD_CHARACTERS, WORLD_COMPUTERS, WORLD_PLACES, WORLD_THREADS } = await import("../src/world.js");
const { parseStoryText, writeStoryText } = await import("../public/story-text.js");
const { PLACE, parseComputerText, parseWorldText, writeComputerText, writeWorldText } = await import("../public/world-text.js");

const FUEL = "main_two_weeks_of_fuel";

test("the board lists every story, and knows which have a written scene", () => {
  const stories = boardStories();
  assert.equal(stories.length, 128);
  const fuel = stories.find((one) => one.id === FUEL);
  assert.deepEqual(fuel, { id: FUEL, title: "Two Weeks of Fuel", kind: "main", written: true });
  assert.equal(stories.find((one) => one.id === "main_who_paid").written, false);
  assert.ok(stories.every((one, i) => !i || stories[i - 1].title.localeCompare(one.title) <= 0), "in order of their titles");
});

test("a story comes with its file, what the game read, who reacts to it, and what there is to pick from", () => {
  const view = boardStory(FUEL);
  assert.equal(view.text, fs.readFileSync(path.join(STORIES_DIR, `${FUEL}.txt`), "utf8"));
  assert.equal(view.story.title, "Two Weeks of Fuel");
  assert.equal(view.clock.consequences.length, 3);
  assert.ok(view.next.some((one) => one.story === "main_the_council" && one.where.startsWith("its clock") && /take_corvanes_fuel/.test(one.to)));
  assert.ok(view.next.some((one) => one.story === "main_chain_of_command" && one.where === "its notes"));
  assert.ok(view.places.some((one) => one.id === "kessara" && one.name));
  assert.ok(view.facts.includes("kessara_closed") && view.facts.includes("told_the_fleet"));
  assert.equal(view.stories.length, 128);
  assert.deepEqual(view.stories.find((one) => one.id === FUEL).endings, ["sign_with_quill", "raid_depot", "take_corvanes_fuel", "settle_cinder_reach"]);
  assert.deepEqual(view.problems, []);
  assert.equal(view.written, true);
  assert.throws(() => boardStory("No Such"), /lowercase letters/);
  assert.throws(() => boardStory("no_such_story"), /no story called/);
});

test("saving a story writes its file and the game plays the new one, and a file that can't be read is never written", () => {
  const file = path.join(STORIES_DIR, `${FUEL}.txt`);
  const original = fs.readFileSync(file, "utf8");
  try {
    const { story, clock } = parseStoryText(original, FUEL);
    story.lead = "Chief Marrow has done the sums four times now.";
    story.gm.facts.tested_by_the_board = "The board was tested.";
    const saved = saveBoardStory(FUEL, writeStoryText(story, clock));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.readFileSync(file, "utf8").includes("Chief Marrow has done the sums four times now."));
    assert.equal(WORLD_THREADS[FUEL].lead, "Chief Marrow has done the sums four times now.", "the game holds the new story at once");
    assert.equal(WORLD_THREADS[FUEL].gm.facts.tested_by_the_board, "The board was tested.");
    assert.equal(STORY_CLOCK.threads[FUEL].consequences.length, 3);

    const refused = saveBoardStory(FUEL, "Two Weeks of Fuel\nkind: main\n\nThe Twist:\nno");
    assert.equal(refused.saved, false);
    assert.ok(refused.problems.some((one) => /line 1: the first line is the story's title/.test(one)), refused.problems.join("\n"));
    assert.ok(fs.readFileSync(file, "utf8").includes("four times now"), "the broken text wasn't written");

    const warned = saveBoardStory(FUEL, writeStoryText({ ...story, gm: { ...story.gm, reacts: [{ to: "ended no_such_story", then: "x" }] } }, clock));
    assert.equal(warned.saved, true, "a story the checker frowns on is still saved, with the problems named");
    assert.ok(warned.problems.some((one) => /reacts 1: there's no story called no_such_story/.test(one)), warned.problems.join("\n"));
    assert.throws(() => saveBoardStory("bad id", "x"), /lowercase letters/);
    assert.throws(() => saveBoardStory(FUEL, ""), /nothing to save/);
  } finally {
    fs.writeFileSync(file, original);
    saveBoardStory(FUEL, original);
  }
  assert.equal(WORLD_THREADS[FUEL].lead.slice(0, 40), "Chief Marrow has done the sums three tim");
  assert.equal(WORLD_THREADS[FUEL].gm.facts.tested_by_the_board, undefined);
});

test("a written scene comes as its parts and choices, and put back together it's the file again", () => {
  const view = boardScene(FUEL);
  const file = fs.readFileSync(path.join(SCENES_DIR, `thread_${FUEL}.txt`), "utf8");
  assert.equal(view.text, file);
  assert.ok(view.parts.length > 50);
  const start = view.parts.find((one) => one.name === "start");
  assert.ok(start.text.startsWith("Two weeks."));
  assert.equal(start.line, 8);
  const marrow = start.choices.find((one) => one.check === "engineering:moderate");
  assert.deepEqual([marrow.pass, marrow.fail, marrow.to], ["cold_pass", "cold_fail", null]);
  assert.ok(start.choices.some((one) => one.to === "to_kessara"));
  assert.ok(start.when.some((one) => one.if === "life engine_hand" && one.to === "hand_start"));
  assert.ok(view.parts.some((one) => one.fight && one.won && one.lost));
  assert.ok(view.parts.some((one) => one.end));
  assert.deepEqual(view.problems, []);
  const together = [view.header, ...view.parts.map((one) => `== ${one.name}\n${one.raw}`)].join("\n");
  assert.equal(together, file.replace(/\r\n?/g, "\n"), "line for line");
  assert.throws(() => boardScene("main_who_paid"), /no written scene yet/);
});

test("a changed scene is checked without saving, and saving writes it only when it can be read", () => {
  const file = path.join(SCENES_DIR, `thread_${FUEL}.txt`);
  const original = fs.readFileSync(file, "utf8");
  const broken = original.replace("== start", "== start\n> A choice that goes nowhere -> no_such_part");
  const checked = checkBoardScene(FUEL, broken);
  assert.ok(checked.parts.some((one) => one.name === "start" && one.choices.some((choice) => choice.to === "no_such_part")));
  assert.ok(checked.problems.some((one) => /no_such_part/.test(one)), checked.problems.join("\n"));
  assert.equal(fs.readFileSync(file, "utf8"), original, "checking saves nothing");
  try {
    const saved = saveBoardScene(FUEL, original.replace("Two weeks. Chief Marrow", "Two weeks, near enough. Chief Marrow"));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.readFileSync(file, "utf8").includes("Two weeks, near enough."));
    const unreadable = saveBoardScene(FUEL, "== start\nText.\nCHECK\n");
    assert.equal(unreadable.saved, false);
    assert.ok(unreadable.problems.length > 0);
    assert.ok(fs.readFileSync(file, "utf8").includes("Two weeks, near enough."), "the unreadable text wasn't written");
  } finally {
    fs.writeFileSync(file, original);
  }
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.throws(() => saveBoardScene("bad id", "x"), /lowercase letters/);
  const empty = sceneBoardView("", "thread_x");
  assert.deepEqual(empty.parts, []);
});

test("the board lists the people, places and species, and shows each with what it's linked to", () => {
  const people = boardWorldList("person");
  assert.equal(people.length, 61);
  assert.ok(people.some((one) => one.id === "aduro" && one.name === "Dr. Sen Aduro" && one.kind === "fleet" && one.written === true));
  assert.ok(people.some((one) => one.id === "ione" && one.written === false));
  assert.equal(boardWorldList("place").length, 24);
  assert.deepEqual(boardWorldList("species").map((one) => one.id), ["human", "korrun", "veshti", "ilari", "thessan", "synthetic"]);
  assert.throws(() => boardWorldList("ship"), /stories, people, places, species, enemies, items, factions, perks, computers and systems/);
  assert.equal(boardWorldList("perk").length, 53);
  assert.equal(boardWorldList("perk")[0].id, "chain_of_command");
  const perk = boardWorldItem("perk", "dead_ship_passwords");
  assert.ok(perk.lists.perks.length === 53 && perk.lists.abilities.some((one) => one.id === "rally"));
  assert.equal(perk.links.needs, null);
  const needing = Object.entries(perk.lists.perks).length && boardWorldList("perk").find((one) => boardWorldItem("perk", one.id).links.needs);
  assert.ok(needing, "some perk needs another first");
  assert.ok(boardWorldItem("perk", boardWorldItem("perk", needing.id).links.needs.id).links.neededBy.some((one) => one.id === needing.id), "and that one knows it leads there");
  assert.equal(boardWorldList("enemy").length, 34);
  assert.ok(boardWorldList("enemy").some((one) => one.id === "dock_thug" && one.kind === "paid"));
  assert.deepEqual(boardWorldList("item").slice(0, 2).map((one) => one.id), ["sidearm", "focus_blade"]);
  assert.ok(boardWorldList("item").some((one) => one.id === "service_rifle" && one.kind === "weapon"));
  assert.deepEqual(boardWorldList("faction").slice(0, 4).map((one) => one.id), ["fleet", "hegemony", "drift", "ilun"]);
  const thug = boardWorldItem("enemy", "dock_thug");
  assert.ok(thug.links.places.some((one) => one.id === "haven"));
  assert.ok(thug.lists.motives.includes("paid") && thug.lists.itemTypes.includes("weapon"));
  const chip = boardWorldItem("item", "data_chip");
  assert.ok(chip.links.sold.some((one) => one.id === "haven") && chip.links.found.some((one) => one.id === "haven"));
  const fleet = boardWorldItem("faction", "fleet");
  assert.ok(fleet.links.people.some((one) => one.id === "aduro"));
  assert.ok(fleet.links.places.some((one) => one.id === "meridian"));
  assert.ok(fleet.links.stories.length > 10);

  const haven = boardWorldItem("place", "haven");
  assert.equal(haven.value.name, "Haven Station");
  assert.equal(haven.text, fs.readFileSync(path.join(PLACES_DIR, "haven.txt"), "utf8"));
  assert.ok(haven.links.people.some((one) => one.id === "sable"));
  assert.ok(haven.links.stories.some((one) => one.id === "main_the_old_scholar"));
  assert.ok(haven.lists.attributes.includes("might") && haven.lists.skills.includes("medicine") && haven.lists.axes.includes("loyalty"));
  assert.deepEqual(haven.problems, []);

  const aduro = boardWorldItem("person", "aduro");
  assert.equal(aduro.links.place.name, "CFS Meridian");
  assert.equal(aduro.links.species.name, "Ilari");
  assert.equal(aduro.links.faction.id, "fleet");
  assert.ok(aduro.links.stories.some((one) => one.id === "crew_aduro_forty_one_days"));
  assert.equal(aduro.links.written, true);
  const ilari = boardWorldItem("species", "ilari");
  assert.ok(ilari.links.people.some((one) => one.id === "aduro"));
  assert.throws(() => boardWorldItem("person", "nobody"), /no person called nobody/);
});

test("saving a place writes its file, and the game's places follow at once", () => {
  const file = path.join(PLACES_DIR, "haven.txt");
  const original = fs.readFileSync(file, "utf8");
  try {
    const { value } = parseWorldText(original, PLACE, "haven");
    value.desc = "A neutral trade hub, tested by the board.";
    value.gm.districts.push({ name: "The Test Deck", desc: "Where the board was tried." });
    const saved = saveBoardWorldItem("place", "haven", writeWorldText(value, PLACE));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.readFileSync(file, "utf8").includes("tested by the board"));
    assert.equal(WORLD_PLACES.haven.desc, "A neutral trade hub, tested by the board.");
    assert.equal(LOCATIONS.haven.desc, "A neutral trade hub, tested by the board.", "the places the game looks up follow");
    assert.equal(LOCATIONS.haven.gm.districts.at(-1).name, "The Test Deck");
    const refused = saveBoardWorldItem("place", "haven", "# Haven\nweather: wet\n");
    assert.equal(refused.saved, false);
    assert.ok(refused.problems.some((one) => /line 2/.test(one)));
    assert.ok(fs.readFileSync(file, "utf8").includes("tested by the board"), "the broken text wasn't written");
    assert.throws(() => saveBoardWorldItem("place", "Bad Id", "x"), /lowercase letters/);
  } finally {
    saveBoardWorldItem("place", "haven", original);
  }
  assert.equal(LOCATIONS.haven.desc.slice(0, 20), "A neutral trade hub ");
  assert.equal(WORLD_CHARACTERS.aduro.name, "Sen Aduro");
});

test("the board remembers where boxes were moved, by story or thing, in the data folder", () => {
  assert.deepEqual(readLayout(), {});
  assert.deepEqual(boardStory(FUEL).layout, {});
  saveLayout(`story/${FUEL}`, { "notes:lead": { x: 10, y: 20 } });
  assert.deepEqual(boardStory(FUEL).layout, { "notes:lead": { x: 10, y: 20 } });
  assert.deepEqual(boardWorldItem("place", "haven").layout, {});
  saveLayout("place/haven", { "notes:desc": { x: 5, y: 5 } });
  assert.deepEqual(boardWorldItem("place", "haven").layout, { "notes:desc": { x: 5, y: 5 } });
  saveLayout(`story/${FUEL}`, {});
  assert.deepEqual(boardStory(FUEL).layout, {}, "tidied up");
  assert.ok(fs.existsSync(path.join(dataDir, "board-layout.json")));
  assert.throws(() => saveLayout("../x", {}), /kind and the id/);
  const lists = boardStory(FUEL).lists;
  assert.ok(lists.ships.length > 10 && lists.goods.includes("fuel") && lists.fleetKeys.includes("morale"), "a stage's place and fleet changes have lists to pick from");
});

test("a person's written lines come as parts and choices, like a scene", () => {
  const talk = boardScene("aduro", "talk");
  assert.ok(talk.parts.length >= 5);
  assert.ok(talk.parts.some((one) => one.name === "start"));
  assert.deepEqual(talk.problems, []);
  assert.throws(() => boardScene("ione", "talk"), /no written lines yet/);
  const checked = checkBoardScene("aduro", talk.text.replace("== start", "== start\n> A line that goes nowhere -> no_such_part"), "talk");
  assert.ok(checked.problems.some((one) => /no_such_part/.test(one)));
});

test("the board shows a computer with its files, programs and network, and saves it back through the checker", () => {
  const list = boardWorldList("computer");
  assert.ok(list.length >= 6, list.map((one) => one.id).join(", "));
  assert.ok(list.some((one) => one.id === "haven_berth_board" && one.kind === "Haven Station"), "grouped by place");
  const board = boardWorldItem("computer", "haven_berth_board");
  assert.equal(board.value.name, "The berth board");
  assert.equal(board.text, fs.readFileSync(path.join(COMPUTERS_DIR, "haven_berth_board.txt"), "utf8"));
  assert.equal(board.links.place.id, "haven");
  assert.equal(board.links.className, "Crew terminal");
  assert.deepEqual(board.links.network.map((one) => one.id), ["haven_harbor_office"]);
  assert.equal(board.links.network[0].className, "Ship's main system");
  assert.ok(boardWorldItem("computer", "haven_harbor_office").links.reachedFrom.some((one) => one.id === "haven_berth_board"), "the other end knows what reaches it");
  assert.equal(board.links.programs.length, 2);
  assert.equal(board.links.programs[0].effects, 2);
  assert.equal(board.links.programs[0].condition, "not flag sundial_fees_cleared");
  assert.ok(board.lists.classes.some((one) => one.id === "hard" && one.name === "Ship's main system"));
  assert.ok(board.lists.computers.some((one) => one.id === "meridian_plot_table"));
  assert.ok(board.lists.flavors.includes("yours"));
  assert.deepEqual(board.problems, []);
  const file = path.join(COMPUTERS_DIR, "haven_berth_board.txt");
  const original = fs.readFileSync(file, "utf8");
  try {
    const { value } = parseComputerText(original, "haven_berth_board");
    value.programs.push({ name: "Break it", desc: "Nothing -> * nonsense" });
    const saved = saveBoardWorldItem("computer", "haven_berth_board", writeComputerText(value));
    assert.equal(saved.saved, true);
    assert.ok(saved.problems.some((one) => /Break it/.test(one) && /nonsense/.test(one)), saved.problems.join("\n"));
    assert.equal(WORLD_COMPUTERS.haven_berth_board.programs.length, 3, "the game reads the saved file at once");
    assert.ok(boardWorldItem("computer", "haven_berth_board").problems.length >= 1, "and the board shows the problem");
    const refused = saveBoardWorldItem("computer", "haven_berth_board", "# Nothing\nclass: moderate\nweather: wet\n");
    assert.equal(refused.saved, false);
    assert.ok(refused.problems.length >= 1);
    assert.equal(WORLD_COMPUTERS.haven_berth_board.programs.length, 3, "a refused save changes nothing");
  } finally {
    saveBoardWorldItem("computer", "haven_berth_board", original);
  }
  assert.deepEqual(boardWorldItem("computer", "haven_berth_board").problems, []);
  assert.equal(WORLD_COMPUTERS.haven_berth_board.programs.length, 2);
});

test("the board shows a place's systems, its own file or what it gets by default, and saving one places its parts again", async () => {
  const { SYSTEMS_DIR } = await import("../src/world.js");
  const { systemsOf } = await import("../src/systems.js");
  const { parseSystemsText, writeSystemsText } = await import("../public/systems-text.js");
  const list = boardWorldList("systems");
  assert.ok(list.length >= 20);
  assert.ok(list.some((one) => one.id === "haven" && one.kind === "its own file" && one.written));
  assert.ok(list.some((one) => one.id === "kessara" && one.kind === "by default" && !one.written));
  const haven = boardWorldItem("systems", "haven");
  assert.equal(haven.text, fs.readFileSync(path.join(SYSTEMS_DIR, "haven.txt"), "utf8"));
  assert.equal(haven.links.own, true);
  assert.ok(haven.links.rooms.some((room) => room.name === "The Manifest Docks" && room.parts.includes("camera")));
  assert.ok(haven.links.people.some((one) => one.key === "mott"));
  assert.ok(haven.lists.partKinds.includes("junction box") && haven.lists.rooms.includes("The Hook"));
  assert.deepEqual(haven.problems, []);
  // A place with no file shows its defaults, and saving them makes them its own.
  const kessara = boardWorldItem("systems", "kessara");
  assert.equal(kessara.links.own, false);
  assert.match(kessara.text, /^# Kessara Drift\n/);
  const file = path.join(SYSTEMS_DIR, "kessara.txt");
  try {
    const { value } = parseSystemsText(kessara.text, "kessara");
    value.systems.push({ name: "Water", id: "water", lines: [{ text: "pump in The Sump" }] });
    const saved = saveBoardWorldItem("systems", "kessara", writeSystemsText(value));
    assert.equal(saved.saved, true);
    assert.deepEqual(saved.problems, []);
    assert.ok(fs.existsSync(file));
    assert.ok(systemsOf("kessara").written);
    assert.ok(Object.values(systemsOf("kessara").parts).some((part) => part.system === "water" && part.room === "sump" && Number.isInteger(part.x)), "the pump has its place at once");
    const wrong = saveBoardWorldItem("systems", "kessara", writeSystemsText(value).replace("pump in The Sump", "pump in The Moon"));
    assert.equal(wrong.saved, true, "a room the place hasn't got is the checker's to mark, not a reason to refuse");
    assert.ok(wrong.problems.some((one) => /no room called The Moon/.test(one)), wrong.problems.join(" | "));
    const refused = saveBoardWorldItem("systems", "kessara", "# Kessara Drift\nweather: wet\n");
    assert.equal(refused.saved, false);
  } finally {
    fs.rmSync(file, { force: true });
    saveBoardWorldItem("systems", "haven", fs.readFileSync(path.join(SYSTEMS_DIR, "haven.txt"), "utf8"));
  }
  assert.equal(systemsOf("kessara").written, false, "with its file gone, it's back to its defaults");
});
