// The game as an app: which copy of the game it runs, where its window opens, what goes in the
// installer, and saving when it closes. Opening a real window can't be tested from here.

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { after, test } from "node:test";
import { chooseHome, isGameFolder, looksLikeTheGame, windowPlace } from "../app/choices.js";
import { projectDir } from "../src/paths.js";

const pack = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
const here = "D:/Game";
const other = "E:/Moved";
const gameIn = (...folders) => (file) => folders.some((folder) => file.replaceAll("\\", "/").startsWith(folder) && /(server\.js|world)$/.test(file));

// ---- Which copy of the game it runs -----------------------------------------

test("the first time, the app uses the game's folder if it's on this computer", () => {
  assert.deepEqual(chooseHome({ remembered: null, built: here, exists: gameIn(here) }), { home: here });
});

test("on a computer that's never had the folder, the app runs its own copy of the game", () => {
  assert.deepEqual(chooseHome({ remembered: null, built: here, exists: gameIn() }), { home: null });
  assert.deepEqual(chooseHome({ remembered: null, built: null, exists: gameIn() }), { home: null });
});

test("once it knows the folder, the app keeps using it, wherever the player has told it that is", () => {
  assert.deepEqual(chooseHome({ remembered: other, built: here, exists: gameIn(here, other) }), { home: other });
});

test("if the folder has gone from where it was, the app asks, because the saves went with it", () => {
  assert.deepEqual(chooseHome({ remembered: here, built: here, exists: gameIn() }), { lost: here });
  assert.deepEqual(chooseHome({ remembered: other, built: here, exists: gameIn(here) }), { lost: other });
});

test("a folder only counts if the game is really in it", () => {
  assert.equal(isGameFolder(here, gameIn(here)), true);
  assert.equal(isGameFolder(here, () => false), false);
  assert.equal(isGameFolder(null, () => true), false);
  assert.equal(isGameFolder(projectDir, fs.existsSync), true);
  assert.equal(isGameFolder(os.tmpdir(), fs.existsSync), false);
});

// ---- Only one copy running ---------------------------------------------------

test("the app can recognize the game's own page, and nothing else", () => {
  assert.equal(looksLikeTheGame(fs.readFileSync(path.join(projectDir, "public", "index.html"), "utf8")), true);
  assert.equal(looksLikeTheGame("<html><title>Something else</title></html>"), false);
  assert.equal(looksLikeTheGame(""), false);
});

// ---- Where the window opens --------------------------------------------------

const wide = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };

test("the first time, the window opens in the middle of the screen, at the size everything's been checked at", () => {
  const place = windowPlace(undefined, [wide], wide);
  assert.deepEqual([place.width, place.height], [1400, 900]);
  assert.deepEqual([place.x, place.y], [260, 70]);
  assert.deepEqual([place.minWidth, place.minHeight], [830, 640], "which leaves room for a page of 810 by 600");
  assert.equal(place.maximized, false);
});

test("on a small screen, the window fits the screen", () => {
  const small = { x: 0, y: 0, width: 1280, height: 680 };
  const place = windowPlace(undefined, [small], small);
  assert.deepEqual([place.width, place.height, place.x, place.y], [1280, 680, 0, 0]);
});

test("after that, the window opens where it was left", () => {
  const place = windowPlace({ x: 2000, y: 50, width: 1000, height: 700, maximized: true }, [wide, second], wide);
  assert.deepEqual([place.x, place.y, place.width, place.height, place.maximized], [2000, 50, 1000, 700, true]);
});

test("a window that was left on a screen that's gone comes back to one that's there", () => {
  const place = windowPlace({ x: 2000, y: 50, width: 1000, height: 700 }, [wide], wide);
  assert.deepEqual([place.x, place.y], [260, 70]);
});

test("nonsense in what the app remembers about its window is ignored", () => {
  for (const saved of [{}, { x: "a", y: 0, width: 900, height: 700 }, { x: 0, y: 0, width: 10, height: 10 }, null]) {
    assert.deepEqual([windowPlace(saved, [wide], wide).width], [1400]);
  }
});

// ---- What goes in the installer ----------------------------------------------

test("the installer can't contain your saves or your API key", () => {
  const { files } = pack.build;
  assert.ok(files.length > 0, "only what's listed goes in");
  for (const pattern of files) {
    assert.ok(!/^(\*|data|backups|test|dist|\.)/.test(pattern), `${pattern} shouldn't go in the installer`);
    assert.ok(!pattern.includes("**/*"), `${pattern} could take in anything`);
  }
  for (const needed of ["app/**", "public/**", "src/**", "world/**", "server.js", "package.json"]) assert.ok(files.includes(needed), `${needed} needs to go in`);
});

test("the app's own files are all there, and its icon is one Windows can use", () => {
  assert.equal(pack.main, "app/main.js");
  assert.ok(fs.existsSync(path.join(projectDir, pack.main)));
  const icon = fs.readFileSync(path.join(projectDir, pack.build.win.icon));
  assert.equal(icon.readUInt16LE(2), 1, "it's an icon file");
  const count = icon.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => icon[6 + i * 16] || 256);
  for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size), `it needs a ${size} pixel size`);
});

test("installing it only ever adds shortcuts, and uninstalling it leaves what's yours alone", () => {
  assert.equal(pack.build.nsis.perMachine, false, "no administrator rights needed");
  assert.equal(pack.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pack.build.asar, false, "the game's files stay readable");
});

test("setting the game up the old way doesn't download the app's building tools", () => {
  assert.match(fs.readFileSync(path.join(projectDir, "start-game.bat"), "utf8"), /npm install --omit=dev/);
  assert.ok(pack.dependencies["@anthropic-ai/sdk"]);
  assert.ok(!pack.dependencies.electron, "the app's tools aren't needed to run the game");
});

// ---- Saving when it closes -----------------------------------------------------

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meridian-app-"));

after(() => {
  try {
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // It's a temporary folder, so it doesn't matter if something is still holding on to it.
  }
});

const freePort = () => new Promise((resolve) => {
  const probe = http.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

// Stands in for the app: it starts the game's server inside itself, and calls it the way the app does.
const STAND_IN = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.env.GAME_ROOT;
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { createGameFromDraft, randomDraft } = await load("src/creator.js");
const saves = path.join(process.env.GAME_DATA_DIR, "saves");
fs.mkdirSync(saves, { recursive: true });
const game = createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));
game.transcript.push({ role: "narrator", text: "The story so far." });
fs.writeFileSync(path.join(saves, "autosave.json"), JSON.stringify(game));
const server = await load("server.js");
const port = process.env.PORT;
for (let i = 0; i < 100; i += 1) {
  try {
    await fetch("http://127.0.0.1:" + port + "/");
    break;
  } catch {
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
}
const read = () => JSON.parse(fs.readFileSync(path.join(saves, "autosave.json"), "utf8")).walk?.level ?? null;
const report = { idle: server.gameIsBusy(), before: read() };
server.finishSaving();
report.nothingToSave = read();
await fetch("http://127.0.0.1:" + port + "/api/walk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "go", to: "exit:1" }) });
report.notYet = read();
server.finishSaving();
report.saved = read();
console.log("REPORT " + JSON.stringify(report));
process.exit(0);
`;

test("walking and then closing the app straight away still saves where the captain is", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["--input-type=module", "-e", STAND_IN], { env: { ...process.env, GAME_DATA_DIR: dataDir, PORT: String(port), GAME_ROOT: projectDir }, stdio: "pipe" });
  let printed = "";
  child.stdout.on("data", (part) => { printed += part; });
  child.stderr.on("data", (part) => { printed += part; });
  await new Promise((resolve) => { child.on("exit", resolve); });
  const line = printed.split("\n").find((one) => one.startsWith("REPORT "));
  assert.ok(line, printed);
  const report = JSON.parse(line.slice("REPORT ".length));
  assert.equal(report.idle, false, "nothing's being written");
  assert.equal(report.before, null);
  assert.equal(report.nothingToSave, null, "with nothing waiting, the save isn't touched");
  assert.equal(report.notYet, null, "a walk is saved a moment later");
  assert.equal(report.saved, "names", "and closing doesn't wait for that moment");
});
