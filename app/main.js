// The game as an app: its own window and icon, with no browser and no black window. It starts the
// same local server that start-game.bat starts, and shows the same page, so the game itself is the
// same either way. app/build.js makes the installer.

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, Menu, nativeTheme, screen, shell } from "electron";
import { chooseHome, isGameFolder, looksLikeTheGame, windowPlace } from "./choices.js";

const NAME = "The Last Meridian";
const PORT = Number(process.env.PORT) || 3210;
const PAGE_COLOR = "#050a07";
const appDir = path.dirname(fileURLToPath(import.meta.url));
const bundled = path.dirname(appDir);
const LONGEST_TURN = 5 * 60 * 1000;

app.setName(NAME);
app.setAppUserModelId("com.lastmeridian.game");
// The title bar matches the game's dark screen.
nativeTheme.themeSource = "dark";

let window = null;
// The game's server, if this app is the one running it.
let gameServer = null;
let leaving = null;

// ---- Notes for when something goes wrong --------------------------------

// There's no black window to read here, so what the game would have printed there goes in a file.
function keepLog() {
  const file = path.join(app.getPath("userData"), "game.log");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.rmSync(file);
  } catch {
    return;
  }
  for (const name of ["log", "error"]) {
    const write = console[name];
    console[name] = (...parts) => {
      write(...parts);
      try {
        fs.appendFileSync(file, `${new Date().toISOString()} ${parts.join(" ")}\n`);
      } catch {
        // The log is only a convenience, so it never gets in the way of the game.
      }
    };
  }
}

// ---- What the app remembers ----------------------------------------------

const memoryFile = () => path.join(app.getPath("userData"), "app-state.json");

function recall() {
  try {
    return JSON.parse(fs.readFileSync(memoryFile(), "utf8"));
  } catch {
    return {};
  }
}

function remember(changes) {
  try {
    fs.mkdirSync(path.dirname(memoryFile()), { recursive: true });
    fs.writeFileSync(memoryFile(), JSON.stringify({ ...recall(), ...changes }, null, 2));
  } catch (err) {
    console.error(`Couldn't remember the app's settings: ${err.message}`);
  }
}

// ---- Which copy of the game to run ----------------------------------------

function builtHome() {
  try {
    return JSON.parse(fs.readFileSync(path.join(bundled, "package.json"), "utf8")).gameHome ?? null;
  } catch {
    return null;
  }
}

// Their saves are in that folder, so a moved folder is worth asking about before starting afresh.
function askWhereItWent(lost) {
  while (true) {
    const answer = dialog.showMessageBoxSync({
      type: "warning",
      title: NAME,
      message: "The game's folder has moved.",
      detail: `It used to be at ${lost}, and your saves are in it. If you've moved it, show the app where it is now.`,
      buttons: ["Find the folder", "Start with no saves", "Close"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (answer === 2) return { quit: true };
    if (answer === 1) return { home: null };
    const [picked] = dialog.showOpenDialogSync({ title: "Where's the game's folder?", properties: ["openDirectory"] }) ?? [];
    if (isGameFolder(picked, fs.existsSync)) return { home: picked };
    if (picked) {
      dialog.showMessageBoxSync({ type: "info", title: NAME, message: "That isn't the game's folder.", detail: "It's the one with server.js and a folder called world in it.", noLink: true });
    }
  }
}

function chooseRoot() {
  if (!app.isPackaged) return bundled;
  let choice = chooseHome({ remembered: recall().home ?? null, built: builtHome(), exists: fs.existsSync });
  if (choice.lost) choice = askWhereItWent(choice.lost);
  if (choice.quit) return null;
  remember({ home: choice.home });
  // Without the folder, the copy inside the app can't keep its saves in itself, because that's read-only.
  if (!choice.home) process.env.GAME_DATA_DIR ||= path.join(app.getPath("userData"), "data");
  return choice.home ?? bundled;
}

// ---- Starting the game's server --------------------------------------------

function readPage(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1500 }, (reply) => {
      let page = "";
      reply.setEncoding("utf8");
      reply.on("data", (part) => { page += part; });
      reply.on("end", () => resolve(page));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(""));
  });
}

const gameIsAt = async (port) => looksLikeTheGame(await readPage(port));

function freePort(wanted) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(null));
    probe.listen(wanted, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startServer(root, port) {
  process.env.PORT = String(port);
  gameServer = await import(pathToFileURL(path.join(root, "server.js")).href);
  for (let tries = 0; tries < 150; tries += 1) {
    if (await gameIsAt(port)) return;
    await new Promise((resolve) => { setTimeout(resolve, 100); });
  }
  throw new Error("The game's server didn't start.");
}

// Uses the game if it's already running, and otherwise starts it. If something else has the game's
// usual port, any other port will do.
async function connect(root) {
  if (await gameIsAt(PORT)) return PORT;
  const port = (await freePort(PORT)) ?? (await freePort(0));
  await startServer(root, port);
  return port;
}

// If the game this window was using stops, say because its black window was closed, the app carries
// on with a server of its own. The autosave has everything, so nothing's lost.
function watchTheServer(root, port) {
  const watch = setInterval(async () => {
    if (await gameIsAt(port)) return;
    clearInterval(watch);
    try {
      await startServer(root, port);
      window?.reload();
    } catch (err) {
      console.error(`Couldn't take over from the game that stopped: ${err.message}`);
    }
  }, 3000);
}

// ---- The window ----------------------------------------------------------------

// The menu bar stays hidden, and these shortcuts are all that's in it.
function hiddenMenu() {
  return Menu.buildFromTemplate([{
    label: "View",
    submenu: [
      { role: "togglefullscreen", accelerator: "F11" },
      { role: "zoomIn", accelerator: "CommandOrControl+=" },
      { role: "zoomOut", accelerator: "CommandOrControl+-" },
      { role: "resetZoom", accelerator: "CommandOrControl+0" },
      // Not every keyboard has its minus on the same key, but the number pad's is always there.
      { role: "zoomIn", accelerator: "CommandOrControl+numadd", visible: false, acceleratorWorksWhenHidden: true },
      { role: "zoomOut", accelerator: "CommandOrControl+numsub", visible: false, acceleratorWorksWhenHidden: true },
      { role: "resetZoom", accelerator: "CommandOrControl+num0", visible: false, acceleratorWorksWhenHidden: true },
    ],
  }]);
}

function rememberWindow() {
  if (!window || window.isDestroyed()) return;
  remember({ window: { ...window.getNormalBounds(), maximized: window.isMaximized() } });
}

function openOutside(url) {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
}

// A turn that's still being written is finished and saved, the same as when a browser tab is closed.
function leaveAfterThisTurn() {
  const deadline = Date.now() + LONGEST_TURN;
  window.hide();
  leaving = setInterval(() => {
    if (gameServer.gameIsBusy() && Date.now() < deadline) return;
    clearInterval(leaving);
    leaving = null;
    window.destroy();
  }, 200);
}

function openWindow(address) {
  const place = windowPlace(recall().window, screen.getAllDisplays().map((one) => one.workArea), screen.getPrimaryDisplay().workArea);
  window = new BrowserWindow({
    title: NAME,
    icon: path.join(appDir, "icon.ico"),
    backgroundColor: PAGE_COLOR,
    show: false,
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    minWidth: place.minWidth,
    minHeight: place.minHeight,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.setMenuBarVisibility(false);
  if (place.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(address)) return;
    event.preventDefault();
    openOutside(url);
  });
  window.on("close", (event) => {
    rememberWindow();
    if (!gameServer?.gameIsBusy() || leaving) return;
    event.preventDefault();
    leaveAfterThisTurn();
  });
  window.on("session-end", () => gameServer?.finishSaving());
  window.on("closed", () => { window = null; });
  window.loadURL(address);
}

// ---- Starting up -----------------------------------------------------------------

async function start() {
  Menu.setApplicationMenu(hiddenMenu());
  try {
    const root = chooseRoot();
    if (!root) {
      app.quit();
      return;
    }
    const port = await connect(root);
    if (!gameServer) watchTheServer(root, port);
    openWindow(`http://localhost:${port}/`);
  } catch (err) {
    console.error(`The game couldn't start: ${err.stack ?? err.message}`);
    dialog.showErrorBox(NAME, `The game couldn't start.\n\n${err.message}`);
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Opening the app again just brings back the window that's already open.
  app.on("second-instance", () => {
    if (!window) return;
    if (leaving) {
      clearInterval(leaving);
      leaving = null;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => gameServer?.finishSaving());

  keepLog();
  // This can't be awaited at the top of the file, because the app isn't ready until the file has finished.
  app.whenReady().then(start);
}
