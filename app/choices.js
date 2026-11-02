// The decisions the app makes when it starts, kept apart from the app itself so they can be tested
// without opening a window.

import path from "node:path";

// A folder only counts as the game's if the game is really in it.
export const isGameFolder = (folder, exists) => Boolean(folder) && exists(path.join(folder, "server.js")) && exists(path.join(folder, "world"));

// On this computer, the app runs the game from its own folder, so changes there show up the next time
// the app opens, and the saves stay where they've always been. If that folder has gone from where it
// was, the player gets asked, because their saves went with it. A computer that has never had the
// folder runs the copy of the game inside the app, with saves of its own.
export function chooseHome({ remembered, built, exists }) {
  if (isGameFolder(remembered, exists)) return { home: remembered };
  if (remembered) return { lost: remembered };
  return { home: isGameFolder(built, exists) ? built : null };
}

// The game is already running if something on its port answers with its page. Only one copy may run
// at a time, because two would overwrite each other's autosave, so the app uses that one instead.
export const looksLikeTheGame = (page) => String(page).includes("<title>The Last Meridian");

// The title bar and borders take some of this, which leaves the page the 810 by 600 it's been checked at.
const MIN_WIDTH = 830;
const MIN_HEIGHT = 640;
const FIRST_WIDTH = 1400;
const FIRST_HEIGHT = 900;

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// Opens the window where it was last time, unless the screen it was on has gone since then.
export function windowPlace(saved, screens, primary) {
  const size = { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT };
  const usable = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width >= MIN_WIDTH && saved.height >= MIN_HEIGHT;
  if (usable && screens.some((screen) => overlaps(saved, screen))) {
    return { ...size, x: saved.x, y: saved.y, width: saved.width, height: saved.height, maximized: Boolean(saved.maximized) };
  }
  const width = Math.max(MIN_WIDTH, Math.min(FIRST_WIDTH, primary.width));
  const height = Math.max(MIN_HEIGHT, Math.min(FIRST_HEIGHT, primary.height));
  return {
    ...size,
    x: primary.x + Math.round((primary.width - width) / 2),
    y: primary.y + Math.round((primary.height - height) / 2),
    width,
    height,
    maximized: false,
  };
}
