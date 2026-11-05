// Computers: what the player uses once they're in. A written one from world/computers, a generic one
// for a console or a door nobody has written, getting in by hack, by right or by password, what's
// read and run, the trace inside, logging off, and the checker.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkCommand, startCheck } from "../src/checks.js";
import { computerAtThing, computerForPlace, computerProblems, computerView, enterAfterHack, enterComputer, genericKindOf, programOf, useComputer } from "../src/computers.js";
import { computerCommand } from "../src/computer-use.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { readRecord } from "../src/record.js";
import { publicState } from "../src/rules.js";
import { parseEffect } from "../src/scene-text.js";
import { WORLD_COMPUTERS, WORLD_MAPS, reloadWorld } from "../src/world.js";
import { parseComputerText, writeComputerText } from "../public/world-text.js";

const newGame = (seed = 21, archetype = "officer") => {
  const game = createGameFromDraft(randomDraft({ seed, archetype }));
  game.skills.hacking = 4;
  game.inventory = {};
  return game;
};

const SAMPLE = `# The test board
class: moderate
owner: haven
place: haven
room: The Manifest Docks
thing: The berth board
login: tester
password: ORBIT

What the player sees:
A board for testing.

Files:
one.txt: The first file,
which runs on.
two.txt: The second file.

Mail:
From Mott to the harbor master: A letter.

Logs:
- berths
- A line of my own.

Programs:
Do the thing: It does the thing. -> * flag test_thing_done: The test thing was done; * credits 10: A test
Do it later: Only sometimes. -> * flag later_done ? flag test_thing_done

Network:
haven_harbor_office: Upstairs.
`;

test("a computer's file reads into files, mail, logs, programs and a network, and writes back the same", () => {
  const { value, problems } = parseComputerText(SAMPLE, "test_board");
  assert.deepEqual(problems, []);
  assert.equal(value.name, "The test board");
  assert.equal(value.class, "moderate");
  assert.equal(value.thing, "The berth board");
  assert.equal(value.password, "ORBIT");
  assert.equal(value.files.length, 2);
  assert.equal(value.files[0].desc, "The first file, which runs on.");
  assert.equal(value.mail[0].name, "From Mott to the harbor master");
  assert.deepEqual(value.logs, ["berths", "A line of my own."]);
  assert.equal(value.programs.length, 2);
  const again = parseComputerText(writeComputerText(value), "test_board");
  assert.deepEqual(again.value, value);
});

test("a program's text, effects and condition come apart, and a bad effect is a problem", () => {
  const program = programOf({ name: "Do the thing", desc: "It does the thing. -> * flag test_thing_done: The test thing was done; * credits 10: A test ? not flag test_thing_done" });
  assert.equal(program.id, "do_the_thing");
  assert.equal(program.text, "It does the thing.");
  assert.equal(program.effects.length, 2);
  assert.equal(program.effects[0].set, "test_thing_done");
  assert.equal(program.effects[1].tool, "change_credits");
  assert.equal(program.condition, "not flag test_thing_done");
  assert.deepEqual(program.problems, []);
  const broken = programOf({ name: "Oops", desc: "Nothing -> * nonsense here" });
  assert.equal(broken.problems.length, 1);
  assert.match(broken.problems[0], /Oops/);
  // The new effects a scene or a program can use.
  assert.deepEqual(parseEffect("door here").do, { door: "here" });
  assert.deepEqual(parseEffect("password haven_berth_board ORBIT").do, { password: "haven_berth_board", word: "ORBIT" });
  assert.deepEqual(parseEffect("computer meridian_plot_table").do, { computer: "meridian_plot_table" });
});

test("the written computers in the world are sound, and the checker catches what isn't", () => {
  assert.ok(Object.keys(WORLD_COMPUTERS).length >= 6, Object.keys(WORLD_COMPUTERS).join(", "));
  assert.deepEqual(computerProblems(), []);
  // A file with a wrong room, a bad program and a network to nowhere.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "computers-"));
  fs.writeFileSync(path.join(dir, "bad.txt"), "# Bad\nclass: vast\nplace: haven\nroom: Nowhere\nthing: A thing\n\nPrograms:\nBreak: Nothing -> * nonsense\n\nNetwork:\nnowhere: Nothing.\n");
  const before = process.env.GAME_COMPUTERS_DIR;
  process.env.GAME_COMPUTERS_DIR = dir;
  try {
    // The loader reads the folder its module was started with, so this checks the problems on a parsed file directly.
    const { value } = parseComputerText(fs.readFileSync(path.join(dir, "bad.txt"), "utf8"), "bad");
    WORLD_COMPUTERS.bad = value;
    const problems = computerProblems();
    assert.ok(problems.some((one) => /class "vast"/.test(one)), problems.join("\n"));
    assert.ok(problems.some((one) => /no room called Nowhere/.test(one)));
    assert.ok(problems.some((one) => /nonsense/.test(one)));
    assert.ok(problems.some((one) => /nowhere/.test(one)));
  } finally {
    delete WORLD_COMPUTERS.bad;
    if (before === undefined) delete process.env.GAME_COMPUTERS_DIR;
    else process.env.GAME_COMPUTERS_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(computerProblems(), []);
});

test("the player's own computers open with no hack, and reading, running and logging off do what they say", () => {
  const game = newGame();
  assert.ok(WORLD_COMPUTERS.meridian_plot_table?.yours);
  enterComputer(game, { id: "meridian_plot_table" });
  assert.ok(game.computer);
  assert.equal(game.computer.hacked, false);
  const view = computerView(game);
  assert.equal(view.name, "The plot table");
  assert.equal(view.yours, true);
  assert.ok(view.files.some((one) => one.name === "course.txt"));
  assert.ok(view.logs.some((one) => one.id === "berths"));
  assert.ok(view.programs.some((one) => one.name === "Log the day's orders"));
  assert.ok(!JSON.stringify(view).includes("password"));
  assert.ok(view.hints.length >= 1);
  // Reading a file puts it in What you know, once.
  computerCommand(game, { action: "file", id: "course_txt" });
  assert.equal(game.computer.screen.kind, "file");
  assert.ok(game.lore.some((entry) => entry.name === "course.txt"));
  computerCommand(game, { action: "file", id: "course_txt" });
  assert.equal(game.lore.filter((entry) => entry.name === "course.txt").length, 1);
  assert.equal(computerView(game).files.find((one) => one.id === "course_txt").read, true);
  // A log is made from the game's own data.
  computerCommand(game, { action: "log", id: "berths" });
  assert.equal(game.computer.screen.title, "The berth log");
  assert.ok(game.computer.screen.lines.length >= 1);
  // A program runs its effects once.
  const journalBefore = (game.journal ?? []).length;
  computerCommand(game, { action: "program", id: "log_the_days_orders" });
  assert.equal((game.journal ?? []).length, journalBefore + 1);
  assert.ok(computerView(game).programs.find((one) => one.id === "log_the_days_orders").ran);
  computerCommand(game, { action: "program", id: "log_the_days_orders" });
  assert.equal((game.journal ?? []).length, journalBefore + 1);
  // Typed commands work too.
  computerCommand(game, { action: "type", text: "cat fleet_manifest" });
  assert.equal(game.computer.screen.title, "fleet_manifest.txt");
  computerCommand(game, { action: "type", text: "mail" });
  assert.equal(game.computer.screen.kind, "mail");
  // Logging off: a line in the story, one for the game master, and a little time gone.
  const hoursBefore = game.clock.hours;
  const reply = computerCommand(game, { action: "logoff" });
  assert.equal(reply.over, true);
  assert.equal(game.computer, null);
  assert.match(game.transcript.at(-1).text, /^\[COMPUTER\] On The plot table: read 2 things, ran Log the day's orders\./);
  assert.match(game.pendingEvents.at(-1), /used a computer, The plot table/);
  assert.ok(game.clock.hours > hoursBefore);
  assert.equal(game.computers.meridian_plot_table.visits, 1);
});

test("a hack that gets in opens the computer it was for, with the trace carried inside", () => {
  const game = newGame();
  startCheck(game, { skill: "hacking", difficulty: "moderate", reason: "Get in", source: "choice", audience: "haven_berth_board" });
  assert.equal(game.check.computer, "haven_berth_board");
  assert.equal(game.check.audience, null);
  let reply;
  while (game.check) reply = checkCommand(game, `try ${game.check.state.answer}`);
  assert.equal(reply.outcome.success, true);
  assert.equal(reply.outcome.hack.computer, "haven_berth_board");
  enterAfterHack(game, reply.outcome.hack);
  assert.equal(game.computer.id, "haven_berth_board");
  assert.equal(game.computer.hacked, true);
  assert.equal(game.computer.maxTrace, reply.outcome.hack.maxTrace);
  const view = computerView(game);
  assert.equal(view.theme, "cyan");
  assert.ok(view.network.some((one) => one.id === "haven_harbor_office" && !one.known));
  // A program on a hacked computer costs a point of trace, and its effects land.
  const traceBefore = game.computer.trace;
  computerCommand(game, { action: "program", id: "rewrite_a_berth_entry" });
  assert.equal(game.computer.trace, traceBefore + 1);
  assert.ok(game.flags.berth_rewritten_at_haven);
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "berth_rewritten_at_haven"));
  // A program that's only offered sometimes isn't offered when its condition fails.
  computerCommand(game, { action: "program", id: "clear_the_sundials_fees" });
  assert.ok(game.flags.sundial_fees_cleared);
  assert.ok(!computerView(game).programs.some((one) => one.id === "clear_the_sundials_fees"));
  computerCommand(game, { action: "logoff" });
  assert.match(game.transcript.at(-1).text, /Logged off with the trace at \d+%/);
});

test("the trace completing inside throws the player out, with the mark on an important computer", () => {
  const game = newGame();
  enterComputer(game, { id: "asterion_ministry_archive", hacked: true, trace: 2, maxTrace: 3 });
  assert.equal(game.computer.hacked, true);
  // On a Ministry server even reading costs a point.
  const reply = computerCommand(game, { action: "file", id: "fleet_register_txt" });
  assert.equal(reply.over, true);
  assert.equal(game.computer, null);
  assert.match(game.transcript.at(-1).text, /TRACE COMPLETE/);
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "traced_on_ministry_or_navy_server"));
});

test("a learned password gets in without a hack, and a scene can hand one out", () => {
  const game = newGame();
  const level = Object.entries(WORLD_MAPS.haven.levels).find(([, one]) => one.name === "The Manifest Docks");
  const thing = Object.entries(level[1].things).map(([id, one]) => ({ id, ...one })).find((one) => /berth board/i.test(one.name));
  game.location = "haven";
  const first = useComputer(game, { place: "haven", levelId: level[0], thing });
  assert.equal(first.check, true);
  assert.equal(game.check.computer, "haven_berth_board");
  assert.equal(game.check.state.className, "Crew terminal");
  checkCommand(game, "disconnect");
  assert.equal(game.check, null);
  game.passwords = { haven_berth_board: "ORBIT" };
  const second = useComputer(game, { place: "haven", levelId: level[0], thing });
  assert.equal(second.computer, true);
  assert.equal(game.computer.id, "haven_berth_board");
  assert.equal(game.computer.hacked, false);
  assert.equal(game.computer.maxTrace, 0);
});

test("a console nobody has written is a generic computer of its kind, made from the world", () => {
  const game = newGame();
  assert.equal(genericKindOf({ name: "Cracked repeater" }), "console");
  assert.equal(genericKindOf({ name: "The restart board" }), "power");
  assert.equal(genericKindOf({ name: "A cracked recognition panel" }), "panel");
  assert.equal(genericKindOf({ name: "The blackboard" }), null);
  assert.equal(genericKindOf({ name: "A chip in a coat pocket", item: "data_chip" }), null);
  assert.equal(genericKindOf({ name: "A medal on a dead console" }), null);
  const target = computerAtThing(game, "meridian", "bridge", { id: "b", name: "Cracked repeater" });
  assert.ok(target.generic);
  assert.equal(target.generic.yours, true);
  assert.ok(target.generic.files.length >= 2);
  assert.ok(target.generic.programs.length >= 1);
  enterComputer(game, { generic: target.generic });
  assert.equal(game.computer.name, "Cracked repeater");
  computerCommand(game, { action: "log", id: "prices" });
  assert.ok(game.computer.screen.lines.length >= 1);
  computerCommand(game, { action: "logoff" });
  // A hack at a place with no computer of that class lands on a generic one.
  game.location = "haven";
  const landed = computerForPlace(game, "very_hard");
  assert.ok(landed.generic);
  assert.equal(landed.generic.classKey, "very_hard");
  assert.equal(landed.generic.yours, false);
});

test("what reaches the browser has the computer, and never its password or a program's effects", () => {
  const game = newGame();
  enterComputer(game, { id: "haven_berth_board", hacked: true, trace: 1, maxTrace: 6 });
  const shown = JSON.stringify(publicState(game).computer);
  assert.ok(shown.includes('"name":"The berth board"'));
  assert.ok(!shown.includes("password"));
  assert.ok(!shown.includes('"effects"'));
  assert.ok(!shown.includes("ORBIT"));
});

test("the scene effects open doors, hand out passwords and sit the player down", () => {
  // Through the same effect code a program uses: the door to a room opens, and a password is learned.
  const game = newGame();
  enterComputer(game, { id: "foundry_sublevel_panel", hacked: true, trace: 0, maxTrace: 5 });
  computerCommand(game, { action: "program", id: "open_the_sublevel_door" });
  assert.ok(game.opened.foundry.includes("sublevels"));
  computerCommand(game, { action: "logoff" });
  assert.equal(game.computer, null);
  reloadWorld();
  assert.ok(WORLD_COMPUTERS.foundry_sublevel_panel);
});
