// Cuts a scene of the story into the pieces it's read in, one at a time, for the popups over the
// room, and works out who's speaking. Nothing here touches the screen, so the tests can use it too.

// ---- Where a scene starts ------------------------------------------------

// The same thing the story panel calls the latest section: each thing the player does starts a new
// one, and so does the story picking up after a fight.
export function latestSceneStart(transcript) {
  let start = 0;
  let previous = null;
  transcript.forEach((entry, i) => {
    if (entry.role === "player" || (entry.role === "narrator" && previous === "combat")) start = i;
    previous = entry.role;
  });
  return start;
}

// ---- Cutting long pieces up ----------------------------------------------

const sentencesOf = (text) => text.match(/[^.!?…]+(?:[.!?…]+["”’)]*\s*|$)|[.!?…]+\s*/g) ?? [text];

// A long run of words is cut after the end of a sentence, and a quote cut in two stays a quote on both sides.
function cutPart(part, limit) {
  if (part.text.length <= limit) return [part];
  const opening = part.kind === "quote" ? part.text[0] : "";
  const closing = opening === "“" ? "”" : opening ? '"' : "";
  const inner = part.text.slice(opening.length);
  const closed = Boolean(closing) && inner.endsWith(closing);
  const body = closed ? inner.slice(0, -closing.length) : inner;
  const pieces = [];
  let current = "";
  for (const sentence of sentencesOf(body)) {
    if (current && current.length + sentence.length > limit) {
      pieces.push(current);
      current = "";
    }
    current += sentence;
  }
  if (current) pieces.push(current);
  return pieces.map((text, i) => {
    const last = i === pieces.length - 1;
    return { kind: part.kind, text: opening ? `${opening}${last ? text : text.trimEnd()}${!last || closed ? closing : ""}` : text };
  });
}

// One block of the story as however many pieces it takes to keep each under the limit. The start of
// a block doesn't change as more of it arrives, so a piece being read stays put.
export function piecesOf(block, limit) {
  if (!block.parts) return [block];
  const pieces = [];
  let current = [];
  let size = 0;
  for (const part of block.parts.flatMap((one) => cutPart(one, limit))) {
    if (current.length && size + part.text.length > limit) {
      pieces.push(current);
      current = [];
      size = 0;
    }
    current.push(part);
    size += part.text.length;
  }
  if (current.length) pieces.push(current);
  return pieces.map((parts) => ({ ...block, parts }));
}

// ---- A scene -------------------------------------------------------------

// The pieces of a scene, in order, the game's messages with the piece they come up with, and what
// the player said to start it. blocksOf reads the game master's text, and can be given by the page,
// which knows who's who.
export function sceneOf(entries, { blocksOf, limit = 340, streaming = false }) {
  const beats = [];
  const notes = [];
  let said = null;
  entries.forEach((entry, i) => {
    if (entry.role === "player") said = entry.text;
    else if (entry.role === "notice") notes.push({ text: entry.text, at: beats.length });
    else if (entry.role === "narrator") {
      const still = streaming && i === entries.length - 1;
      for (const block of blocksOf(entry.text, { streaming: still })) beats.push(...piecesOf(block, limit));
    }
  });
  // A message after the last piece comes up with the last piece.
  const last = Math.max(0, beats.length - 1);
  return { beats, notes: notes.map((note) => ({ ...note, at: Math.min(note.at, last) })), said };
}

// ---- Who's speaking ------------------------------------------------------

const wordsOf = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}' -]/gu, "").split(/\s+/).filter(Boolean);
const LITTLE_WORDS = new Set(["the", "of", "a", "an", "de", "van", "von"]);

// Finds someone in the room from their name as the AI wrote it, such as "Commander Ilya Voss" for
// Voss. Someone in the crowd only counts if the name is exactly theirs, and a wrong person with a
// balloon over their head is worse than none.
export function personSpeaking(speaker, people = []) {
  const said = wordsOf(speaker);
  if (!said.length) return null;
  const same = (name) => wordsOf(name).join(" ") === said.join(" ");
  const exact = people.find((person) => same(person.name) || same(person.short));
  if (exact) return exact;
  const last = said.at(-1);
  if (LITTLE_WORDS.has(last)) return null;
  const named = people.filter((person) => !person.crowd && (wordsOf(person.short).at(-1) === last || wordsOf(person.name).includes(last)));
  return named.length === 1 ? named[0] : null;
}

// ---- The size of the interface -------------------------------------------

export const INTERFACE_SIZES = { auto: null, small: 0.85, normal: 1, large: 1.2, largest: 1.45 };
// The window the game's screens are made for, when it first opens.
const MADE_FOR = { width: 1400, height: 900 };
// And the least room any of them can work in.
const LEAST = { width: 830, height: 640 };

// How much bigger or smaller to draw everything. Automatic keeps things in proportion in a bigger
// window, and no size can leave the screens with less room than the smallest window they work in.
export function interfaceZoom(choice, width, height) {
  const wanted = INTERFACE_SIZES[choice] ?? Math.min(2.5, Math.max(1, Math.min(width / MADE_FOR.width, height / MADE_FOR.height)));
  const most = Math.min(width / LEAST.width, height / LEAST.height);
  const zoom = wanted > 1 ? Math.max(1, Math.min(wanted, most)) : wanted;
  // Always down to a whole step, so it can't go past what fits.
  return Math.floor(zoom * 20 + 1e-9) / 20;
}
