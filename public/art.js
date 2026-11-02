// Console art for fights. Every figure is drawn facing right, and this turns one around for
// the enemy's side, so that the two sides face each other.

const MIRRORED = { "/": "\\", "\\": "/", "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", d: "b", b: "d", p: "q", q: "p" };

export function mirrorArt(lines) {
  const width = Math.max(...lines.map((line) => line.length));
  return lines.map((line) => [...line.padEnd(width)].reverse().map((ch) => MIRRORED[ch] ?? ch).join(""));
}

// Drops the blank lines above a figure, so that its card is only as tall as it needs to be.
export const trimmedArt = (lines) => lines.slice(Math.max(0, lines.findIndex((line) => line.trim())));

// Someone who falls keeps the height they had standing, so that the window doesn't jump when they do.
export function fallenArt(fallen, standing) {
  const figure = trimmedArt(fallen);
  return [...Array(Math.max(0, trimmedArt(standing).length - figure.length)).fill(""), ...figure];
}
