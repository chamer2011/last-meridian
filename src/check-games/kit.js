// Small helpers shared by the games inside the skill check windows.
//
// Every game has the same shape, and runs entirely on this computer:
//   start(ctx)              sets up the puzzle, and returns its state as plain data for the save file
//   intro(state, ctx)       the lines the console opens with
//   view(state, ctx)        what the window shows right now: panels, commands and meters
//   act(state, ctx, words)  does one command, and returns lines for the console, or null if it makes no sense
//   edge(state, ctx)        how much the player's work so far adds to the final roll
//   story(state, ctx)       one sentence for the game master about how it went
// state.done means there's nothing left to do but make the final roll, and state.forced
// means the roll happens right now, ready or not. What a game shows must never give away
// the answer: only what's in view() and the console's lines reach the browser.

export const randomInt = (max) => Math.floor(Math.random() * max);
export const between = (min, max) => min + randomInt(max - min + 1);
export const pick = (list) => list[randomInt(list.length)];
export const chance = (share) => Math.random() < share;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// A bit of console text, in one of the tones: good, bad, warn, info, dim or bright.
export const tone = (text, name) => ({ t: text, tone: name });
// A bit of console text that runs a command when it's clicked.
export const link = (text, command, name = "link", title = undefined) => ({ t: text, cmd: command, tone: name, ...(title ? { title } : {}) });
export const bar = (value, max, width = 10) => {
  const filled = Math.round(clamp(value / Math.max(1, max), 0, 1) * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
};
export const panel = (id, title, lines, options = {}) => ({ id, title, lines, ...options });
export const meter = (label, value, max, name = "info", text = undefined) => ({ label, value, max, tone: name, ...(text ? { text } : {}) });
export const command = (label, cmd, hint = undefined, options = {}) => ({ label, command: cmd, ...(hint ? { hint } : {}), ...options });
export const say = (text, name = undefined) => (name ? { text, tone: name } : { text });

// Accepts a typed name even if it's a bit off, because nobody's typing should cost them a check.
export function closest(text, options) {
  const wanted = text.toLowerCase();
  const exact = options.find((option) => option.toLowerCase() === wanted);
  if (exact) return exact;
  const starts = options.filter((option) => option.toLowerCase().startsWith(wanted));
  if (wanted.length >= 2 && starts.length === 1) return starts[0];
  const near = options.filter((option) => editDistance(option.toLowerCase(), wanted) <= 1);
  return near.length === 1 ? near[0] : null;
}

export function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const held = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = held;
    }
  }
  return row[b.length];
}

// Grid squares are named like a chart, with a letter for the column and a number for the row.
export const cellName = (x, y) => `${String.fromCharCode(97 + x)}${y + 1}`;
export function parseCell(text) {
  const match = /^([a-z])\s*-?\s*(\d{1,2})$/.exec(String(text).toLowerCase());
  return match && Number(match[2]) > 0 ? { x: match[1].charCodeAt(0) - 97, y: Number(match[2]) - 1 } : null;
}

// Fills in the {blanks} in a line of text from the world's files.
export const fill = (line, values) => String(line).replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);
