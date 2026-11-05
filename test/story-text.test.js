// The story files in world/stories: plain text that reads into the shape the game uses and writes back the same,
// with problems named by their line.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-story-text-"));
process.env.GAME_DATA_DIR = dataDir;
// One test writes a story, so these work on a copy of the stories.
const copy = path.join(dataDir, "stories");
fs.mkdirSync(copy);
const realStories = fileURLToPath(new URL("../world/stories/", import.meta.url));
for (const name of fs.readdirSync(realStories)) fs.copyFileSync(path.join(realStories, name), path.join(copy, name));
process.env.GAME_STORIES_DIR = copy;

const { parseStoryText, writeStoryText } = await import("../public/story-text.js");
const { STORIES_DIR, STORY_CLOCK, STORY_FILE_PROBLEMS, WORLD_THREADS, reloadStories } = await import("../src/world.js");

const canon = (value) => JSON.stringify(value, (key, inner) => (inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.keys(inner).sort().map((k) => [k, inner[k]])) : inner));

const SAMPLE = `# Two Weeks of Fuel
kind: main
places: kessara, haven, cinder
people: quill, tannis, marrow
factions: drift, fleet, hegemony
level: 3
after: main_the_old_scholar
waits: Needs the fleet at the Harbor.
clock from: 30 days

The lead:
Chief Marrow has done the sums three times:
the fleet has two weeks of fuel.

For anyone who isn't the captain:
The fleet's down to two weeks of fuel.

What's really going on:
Quill owns the only depot within reach.

How it might go:
- Tea in Quill's Parlor,
  on embroidered cushions.
- Marrow's numbers get worse.

Ways through:
- Talker: haggle with Quill.

Checks that fit:
- commerce:hard to put a limit on Quill's markers in writing

If it comes to a fight:
- drift_raider and syndicate_collector if the depot raid goes wrong

Where it can end up:
sign_with_quill: If they sign with Quill, the fleet has fuel.
raid_depot: If they raid the depot, the fleet is fueled
and at war with the Syndicate.

Facts it can leave:
kessara_closed, after raid_depot: Kessara Drift is closed to the fleet since the depot.
markers_limited: Mother Quill's markers have a limit, in writing.

What on the record changes it:
? ended main_the_old_scholar quills_people_get_him -> Tharel is in Quill's hands,
so the price goes up.

If nobody steps in:
after 18 days: Mother Quill's depot has started selling to whoever asks first.
  lead: The fuel's still there, but the depot is selling it to anyone who asks.
  at kessara: fuel -15, hegemony +5
after 45 days: The council took a shipment of fuel from Legate Corvane.
  if: not ended main_two_weeks_of_fuel
  fleet: fuel +3, morale -1
  named: vesper_landing lost spared 800
  place: haven
  big
  fact hegemony_transponders: Every ship in the fleet carries a Hegemony transponder.
  ending: take_corvanes_fuel

Consequences:
? ended main_two_weeks_of_fuel raid_depot, after 7 days: Kessara Drift's docks are closed to the fleet.
  place: kessara
  fact kessara_closed: Kessara Drift is closed to the fleet since the depot.

Rewards:
Fuel for the fleet, and a place on Quill's list.
`;

test("a story file reads into the shape the game uses, every line of it", () => {
  const { story, clock, problems } = parseStoryText(SAMPLE, "main_two_weeks_of_fuel");
  assert.deepEqual(problems, []);
  assert.deepEqual(story, {
    title: "Two Weeks of Fuel", kind: "main", places: ["kessara", "haven", "cinder"], minLevel: 3, after: "main_the_old_scholar", people: ["quill", "tannis", "marrow"], factions: ["drift", "fleet", "hegemony"],
    lead: "Chief Marrow has done the sums three times: the fleet has two weeks of fuel.",
    anyone: "The fleet's down to two weeks of fuel.",
    gm: {
      truth: "Quill owns the only depot within reach.",
      beats: ["Tea in Quill's Parlor, on embroidered cushions.", "Marrow's numbers get worse."],
      routes: ["Talker: haggle with Quill."],
      checks: ["commerce:hard to put a limit on Quill's markers in writing"],
      fights: ["drift_raider and syndicate_collector if the depot raid goes wrong"],
      outcomes: [{ id: "sign_with_quill", text: "If they sign with Quill, the fleet has fuel." }, { id: "raid_depot", text: "If they raid the depot, the fleet is fueled and at war with the Syndicate." }],
      facts: { kessara_closed: "Kessara Drift is closed to the fleet since the depot.", markers_limited: "Mother Quill's markers have a limit, in writing." },
      factAfter: { kessara_closed: "raid_depot" },
      reacts: [{ to: "ended main_the_old_scholar quills_people_get_him", then: "Tharel is in Quill's hands, so the price goes up." }],
      rewards: "Fuel for the fleet, and a place on Quill's list.",
    },
  });
  assert.deepEqual(clock, {
    waits: "Needs the fleet at the Harbor.",
    from: 30,
    stages: [
      { after: 18, news: "Mother Quill's depot has started selling to whoever asks first.", lead: "The fuel's still there, but the depot is selling it to anyone who asks.", places: [{ id: "kessara", goods: { fuel: -15 }, sides: { hegemony: 5 } }] },
      { after: 45, news: "The council took a shipment of fuel from Legate Corvane.", if: "not ended main_two_weeks_of_fuel", fleet: { fuel: 3, morale: -1, named: { id: "vesper_landing", status: "lost", spared: 800 } }, place: "haven", big: true, facts: { hegemony_transponders: "Every ship in the fleet carries a Hegemony transponder." }, ending: "take_corvanes_fuel" },
    ],
    consequences: [{ of: "ended main_two_weeks_of_fuel raid_depot", after: 7, news: "Kessara Drift's docks are closed to the fleet.", place: "kessara", facts: { kessara_closed: "Kessara Drift is closed to the fleet since the depot." } }],
  });
  const again = parseStoryText(writeStoryText(story, clock), "main_two_weeks_of_fuel");
  assert.deepEqual(again.problems, []);
  assert.equal(canon(again.story), canon(story), "written back and read again, it's the same story");
  assert.equal(canon(again.clock), canon(clock));
});

test("every story in the game reads without a problem and writes back the same, and the game holds them all", () => {
  assert.deepEqual(STORY_FILE_PROBLEMS, []);
  const files = fs.readdirSync(STORIES_DIR).filter((name) => name.endsWith(".txt") && !name.startsWith("_"));
  assert.equal(files.length, 128);
  assert.equal(Object.keys(WORLD_THREADS).length, 128);
  assert.equal(Object.keys(STORY_CLOCK.threads).length, 128);
  assert.ok(Array.isArray(STORY_CLOCK.acts) && STORY_CLOCK.acts.length === 4, "the acts stay in story-clock.json");
  for (const name of files) {
    const id = name.slice(0, -4);
    const text = fs.readFileSync(path.join(STORIES_DIR, name), "utf8");
    const first = parseStoryText(text, id);
    assert.deepEqual(first.problems, [], name);
    assert.equal(writeStoryText(first.story, first.clock), text, `${name} is written the way the game writes it`);
    assert.equal(canon(WORLD_THREADS[id]), canon(first.story));
  }
  assert.equal(WORLD_THREADS.main_two_weeks_of_fuel.title, "Two Weeks of Fuel");
  assert.equal(STORY_CLOCK.threads.main_two_weeks_of_fuel.consequences.length, 3);
  assert.equal(STORY_CLOCK.threads.main_safe_harbor.waits.slice(0, 5), "Needs");
});

test("a story file's problems are named with their line, and the file is still read as far as it goes", () => {
  const { story, clock, problems } = parseStoryText(`Two Weeks of Fuel
kind: main
colour: green
places: kessara

The lead:
Something's up.

The Twist:
- no

How it might go:
A beat without its dash

Where it can end up:
a line that isn't an ending
BadName: x
fine_name: y

If nobody steps in:
  lead: before any stage
after 18 days: Something happens.
  if: flag x
  at kessara: fuel lots
  fleet: fuel +3
  mystery: line

Consequences:
? flag x, after 3 days: Later.
  if: flag y
  ending: fine_name
`, "test_story");
  const lines = problems.map((one) => one.line);
  const messages = problems.map((one) => one.message);
  const expect = (line, pattern) => assert.ok(problems.some((one) => one.line === line && pattern.test(one.message)), `line ${line} ${pattern}\n${problems.map((one) => `${one.line}: ${one.message}`).join("\n")}`);
  expect(1, /first line is the story's title/);
  expect(3, /before the first part, each line is one of kind, places/);
  expect(9, /I don't know a part of a story called "The Twist"/);
  expect(13, /each one starts with - and a space/);
  expect(16, /an ending is written its_name:/);
  expect(17, /ending's name is lowercase/);
  expect(21, /a stage starts with after 18 days/);
  expect(24, /"fuel lots" should be a name and a number/);
  expect(26, /I don't know a line like that under a stage/);
  expect(30, /consequence's condition goes on its first line/);
  expect(31, /only a stage can end its story/);
  assert.equal(problems.length, 11, `${problems.length} problems:\n${problems.map((one) => `${one.line}: ${one.message}`).join("\n")}`);
  assert.equal(story.title, "Two Weeks of Fuel", "the first line is taken as the title all the same");
  assert.equal(story.kind, "main");
  assert.deepEqual(story.gm.outcomes.map((one) => one.id), ["badname", "fine_name"]);
  assert.equal(clock.stages.length, 1);
  assert.equal(clock.stages[0].fleet.fuel, 3);
  assert.deepEqual(lines.slice(0, 3), [1, 3, 9]);
  assert.ok(parseStoryText("", "x").problems.some((one) => /starts with # The Title/.test(one.message)));
});

test("the stories can be read again while the game runs, into the same objects", () => {
  const before = WORLD_THREADS;
  const file = path.join(STORIES_DIR, "main_two_weeks_of_fuel.txt");
  const text = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, text.replace("# Two Weeks of Fuel", "# Two Weeks of Fuel, Again"));
    reloadStories();
    assert.equal(WORLD_THREADS, before, "the same object, so everything that imported it sees the change");
    assert.equal(WORLD_THREADS.main_two_weeks_of_fuel.title, "Two Weeks of Fuel, Again");
  } finally {
    fs.writeFileSync(file, text);
    reloadStories();
  }
  assert.equal(WORLD_THREADS.main_two_weeks_of_fuel.title, "Two Weeks of Fuel");
});
