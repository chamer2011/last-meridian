// The story over the room, in the isometric view. A scene comes up a piece at a time, with what
// someone says on a pane by their head and the rest in a window along the bottom. Clicking
// anywhere goes on to the next piece, and the choices are there the whole time. A talk comes up
// the same way, with the choices beside the pane.

import { el } from "./dom.js";
import { isoLook, isoSpot } from "./iso.js";
import { drawLeader, paneNode, paneOffset, paneSpringing, panesPlacedBy } from "./pane.js";
import { latestSceneStart, personSpeaking, sceneOf } from "./scene.js";
import { blockNode, sceneBlocks, speakerOf, storyEntryNode, thinkingNode, wordNodes } from "./story-view.js";
import { talkPanesNode } from "./talk.js";
import { WRITING_SPEEDS, holdBack, newPen } from "./writer.js";

// How long a note about what's happening stays up.
const NOTE_TIME = 12000;
const MOST_NOTES = 4;

const pop = { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, limit: 340, words: null, wordsOn: null, shownNotes: [], paneFor: null };

// What the popups need from the main screen. Set once, when the page loads.
let app;

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pen = newPen({
  speed: () => (calm() ? Infinity : WRITING_SPEEDS[app.reading.writing] ?? WRITING_SPEEDS.normal),
  draw: (count) => pop.words?.show(count),
});

export function initPopups(hooks) {
  app = hooks;
  panesPlacedBy(placeAll);
}

export function resetPopups() {
  pen.stop();
  for (const note of pop.shownNotes) clearTimeout(note.timer);
  Object.assign(pop, { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, words: null, wordsOn: null, shownNotes: [], paneFor: null });
}

const living = () => app.ui.streaming && !app.ui.game?.talk;

// ---- Keeping up with the story -------------------------------------------

// As much as fits on a pane by someone's head, going by the size of the room and of the text.
function limitNow() {
  const box = document.getElementById("pops");
  const width = box?.clientWidth || 800;
  const height = box?.clientHeight || 500;
  const size = Math.max(12, app.reading.size - 3);
  const letter = size * 0.6;
  const wide = Math.max(26 * letter, Math.min(width * 0.36, 34 * letter));
  const lines = Math.floor((height * 0.42) / (size * 1.45));
  return Math.max(140, Math.min(420, Math.round(((wide - 22) / letter) * lines * 0.9)));
}

function readScene() {
  const { ui } = app;
  const entries = living() ? ui.liveEntries : ui.game.transcript.slice(pop.start);
  Object.assign(pop, sceneOf(entries, { blocksOf: sceneBlocks, limit: pop.limit, streaming: living() }));
}

// Something already read: after a load, or when the story moved on somewhere else, like in another window.
function pickUpFrom(start) {
  pop.start = start;
  pop.limit = limitNow();
  readScene();
  pop.at = Math.max(0, pop.beats.length - 1);
  pop.seen = pop.at;
  pop.posted = pop.notes.length;
  pop.open = pop.beats.length > 0;
  pen.start(true);
}

function sync() {
  const { ui } = app;
  const { transcript } = ui.game;
  if (!living()) {
    const latest = latestSceneStart(transcript);
    if (pop.start === null || pop.start > transcript.length || latest > pop.start) pickUpFrom(latest);
    else {
      readScene();
      // A turn that failed leaves nothing to show, so the scene before it is still the one.
      if (!pop.beats.length && !ui.error && latest < pop.start) pickUpFrom(latest);
    }
  } else readScene();
  // Anything the game has to say, it has to be seen saying.
  if (ui.error || ui.consoleLines.length) pop.open = true;
  pop.at = Math.min(pop.at, Math.max(0, pop.beats.length - 1));
  postNotes();
}

// The player's done something, so the next thing the game master writes is a new scene.
export function beginScene() {
  pen.stop();
  Object.assign(pop, { open: true, start: app.ui.game?.transcript.length ?? 0, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, limit: limitNow(), words: null, wordsOn: null });
  pen.start();
}

// ---- What's happening ----------------------------------------------------

function notesNode() {
  const now = Date.now();
  return el("div", { class: "pop-notes", id: "pop-notes" }, pop.shownNotes.map((note) => el("div", {
    class: "pop-note",
    style: `animation-delay:${Math.max(0, note.until - now - 700)}ms`,
    title: "Click to dismiss. This is in the story too.",
    onclick: () => dropNote(note),
  }, storyEntryNode({ role: "notice", text: note.text }))));
}

const drawNotes = () => {
  document.getElementById("pop-notes")?.replaceWith(notesNode());
  placeAll();
};

function dropNote(note) {
  clearTimeout(note.timer);
  pop.shownNotes = pop.shownNotes.filter((one) => one !== note);
  drawNotes();
}

function addNote(text) {
  const note = { text, until: Date.now() + NOTE_TIME };
  note.timer = setTimeout(() => dropNote(note), NOTE_TIME);
  pop.shownNotes.push(note);
  while (pop.shownNotes.length > MOST_NOTES) dropNote(pop.shownNotes[0]);
}

// A note comes up when the reader gets to the piece it goes with, so it doesn't give anything away.
function postNotes() {
  let posted = false;
  while (pop.posted < pop.notes.length && (pop.notes[pop.posted].at <= pop.at || !pop.open)) {
    addNote(pop.notes[pop.posted].text);
    pop.posted += 1;
    posted = true;
  }
  if (posted) drawNotes();
}

// ---- Going through a scene -----------------------------------------------

const current = () => pop.beats[pop.at] ?? null;

// Whoever's saying this, if they're here to say it over their head. A voice over comms and a machine
// don't have a head to put it over, and neither does anyone who isn't in the room. During a talk the
// talk has the room, and the story's words stay in the window along the bottom.
function speakerHere(beat) {
  const { game } = app.ui;
  if (app.reading.story !== "popups" || beat?.type !== "speech" || beat.voice || game?.talk) return null;
  if (personSpeaking(beat.speaker, [{ name: game.name, short: game.name }])) return { key: "you" };
  return personSpeaking(beat.speaker, game.walk.people);
}

const unread = () => pen.busy || pop.at < pop.beats.length - 1;
// Until it's been read, a click on the room goes on with the story, and doesn't walk anywhere.
export const popupReading = () => pop.open && unread();

function moved() {
  pen.start(pop.at <= pop.seen);
  pop.seen = Math.max(pop.seen, pop.at);
  postNotes();
  drawScene();
}

// The next thing: the rest of what's being said, and then the next piece.
export function popupNext() {
  if (!pop.open) return false;
  if (pen.busy) {
    pen.finish();
    return true;
  }
  if (pop.at < pop.beats.length - 1) {
    pop.at += 1;
    moved();
    return true;
  }
  return false;
}

function popupBack() {
  if (pop.at <= 0) return;
  pen.finish();
  pop.at -= 1;
  moved();
}

// A click on the room goes on to the next piece, until the scene's been read, and then it's a walk.
export function popupPressed() {
  return popupReading() ? popupNext() : false;
}

export const popupsOpen = () => pop.open;

export function closePopups() {
  if (!pop.open) return;
  pen.finish();
  pop.open = false;
  isoLook();
  postNotes();
  app.render();
}

export function openPopups() {
  pop.open = true;
  app.render();
}

// ---- Drawing -------------------------------------------------------------

const clickedWords = (event) => {
  if (!event.target.closest("button, a, input, summary, [data-lore]")) popupNext();
};

// What's being said, on a pane by whoever's saying it. It slides out from their head the first time
// it's theirs, and only then, since the pane is drawn again for every piece.
function balloonNode() {
  const beat = current();
  const person = pop.open ? speakerHere(beat) : null;
  if (!person) {
    pop.paneFor = null;
    return null;
  }
  const { color, name, voice } = speakerOf(beat);
  const still = living() && pop.at === pop.beats.length - 1;
  const more = pop.at < pop.beats.length - 1;
  const opening = pop.paneFor !== person.key && !calm();
  pop.paneFor = person.key;
  return paneNode({
    id: "pop-balloon",
    key: person.key,
    color,
    more,
    opening,
    onTap: () => popupNext(),
    tag: [el("span", { class: "pop-tag-name" }, name), voice && el("span", { class: "pop-tag-note" }, voice)],
    body: [
      el("div", { class: "pop-words", id: "pop-writing" }, wordNodes(beat.parts)),
      el("div", { class: "pop-hint" }, `${pop.at + 1} of ${pop.beats.length}${still ? "..." : ""}`, more && el("span", {}, "click to go on")),
    ],
  });
}

// What's in the window along the bottom: this piece, or if this piece is over someone's head, the
// narration it follows from.
function storyWords(beat, overHead) {
  if (!beat) return null;
  if (overHead) {
    for (let i = pop.at - 1; i >= 0; i -= 1) if (pop.beats[i].type === "narration") return el("div", { class: "pop-before" }, blockNode(pop.beats[i]));
    return null;
  }
  const node = blockNode(beat);
  if (beat.type === "speech") node.querySelector(".speech-body").id = "pop-writing";
  if (beat.type !== "speech" && living() && pop.at === pop.beats.length - 1) node.append(el("span", { class: "cursor", "aria-hidden": "true" }));
  return node;
}

function storyWindow() {
  const { ui } = app;
  const beat = current();
  const overHead = Boolean(speakerHere(beat));
  const waiting = living() && (!beat || (pop.at === pop.beats.length - 1 && overHead));
  const nothing = !beat && !waiting && !ui.error && !ui.consoleLines.length;
  if (!pop.open || nothing) return null;
  const { walk, clock } = ui.game;
  const count = pop.beats.length;
  return el("section", { class: `check-window pop-window pop-story${overHead ? " overhead" : ""}${pop.at < count - 1 ? " more" : ""}`, "data-theme": "green", id: "pop-story", onclick: clickedWords },
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, walk.here.name),
      el("span", { class: "check-skill" }, clock.label),
      el("button", { class: "pop-close", title: "Or press Esc, or just start walking", onclick: closePopups }, "Close")),
    el("div", { class: "pop-words", "data-scrolls": "1" },
      ui.consoleLines.map((entry) => storyEntryNode(entry)),
      ui.error && el("div", { class: "entry error" }, ui.error.message,
        el("div", { class: "row", style: "margin-top:8px" },
          el("button", { onclick: app.retry }, "Try again"),
          el("button", { onclick: app.openSettings }, "Open Settings"))),
      pop.said && pop.at === 0 && el("div", { class: "pop-said" }, `> ${pop.said}`),
      storyWords(beat, overHead),
      waiting && thinkingNode()),
    count > 0 && el("footer", { class: "check-taskbar" },
      el("span", { class: "check-hint" }, `${pop.at + 1} of ${count}`),
      el("button", { class: "check-command", disabled: pop.at === 0, onclick: popupBack }, "Back"),
      el("button", { class: "check-command pop-next", disabled: pop.at >= count - 1, onclick: popupNext }, "Next"),
      el("span", { class: "check-spacer" }),
      el("button", { class: "check-command", onclick: app.showWholeStory }, "Whole story")));
}

function commandWindow(composer) {
  const reading = pop.open && pop.at < pop.beats.length - 1;
  return el("section", { class: `check-window pop-window pop-command${reading ? " reading" : ""}`, "data-theme": "green", id: "pop-command" },
    pop.open && el("header", { class: "check-title" }, el("span", { class: "check-name" }, "What do you do?")),
    composer);
}

// Where a pane by someone's head goes: up and to their right, with its corner a hand from the head,
// or up and to their left when the right has no room, and always on the screen, out from under the
// clock and the notes. This runs each time the room's drawn, so it stays with them as they move, and
// again while it's being pulled aside or sliding back. A pane with nobody to belong to, which a talk
// can be when the room can't show the person, goes in the middle.
function placePane(node, key, { choices = false, anywhere = false } = {}) {
  const box = document.getElementById("pops");
  if (!node || !box) return;
  const spot = key ? isoSpot(key) : null;
  if (!spot && !anywhere) {
    node.classList.remove("placed");
    return;
  }
  const row = document.getElementById("pop-row");
  const notes = document.getElementById("pop-notes");
  const clock = document.getElementById("walk-clock");
  const pane = node.querySelector(".pop-pane");
  if (pane) pane.style.maxHeight = "";
  const width = box.clientWidth;
  const floor = box.clientHeight - (row?.offsetHeight ?? 0) - 12;
  const wide = node.offsetWidth;
  const head = spot ? { x: spot.x + spot.w / 2, y: spot.y + 2 } : { x: width / 2, y: floor / 2 };
  // Your own pane goes on the side away from theirs, since you're standing right beside them.
  const theirs = node.id === "pop-you" ? paneCalled("talk")?.placedAt ?? null : null;
  let side = theirs && theirs.left + theirs.wide / 2 > head.x ? "left" : "right";
  let left = side === "right" ? head.x + 28 : head.x - 28 - wide;
  if (side === "right" && left + wide > width - 6) {
    side = "left";
    left = head.x - 28 - wide;
  } else if (side === "left" && left < 6) {
    side = "right";
    left = head.x + 28;
  }
  left = Math.max(6, Math.min(width - wide - 6, left));
  // It stays out from under the clock and the notes, which are at the top.
  const under = (other) => (other && other.offsetHeight && left + wide > other.offsetLeft && left < other.offsetLeft + other.offsetWidth ? other.offsetTop + other.offsetHeight + 5 : 6);
  let tall = node.offsetHeight;
  let roof = Math.max(under(clock), under(notes));
  // The words come first. When the room's too short for them under the notes, the notes step aside until the words
  // have gone, and when it's too short even for that, the pane shrinks and its words scroll, so it never runs into
  // the story below.
  if (node.id !== "pop-you") {
    const covering = floor - roof < tall && under(notes) > under(clock);
    if (covering) roof = under(clock);
    notes?.classList.toggle("covered", covering);
  }
  if (floor - roof < tall && pane) {
    pane.style.maxHeight = `${Math.max(60, floor - roof)}px`;
    tall = node.offsetHeight;
  }
  let top = Math.max(roof, Math.min(floor - tall, head.y - 16 - tall));
  // And it keeps clear of their words: under your feet, if over your head would cover them.
  if (theirs && spot) {
    const crosses = (at) => left < theirs.left + theirs.wide && left + wide > theirs.left && at < theirs.top + theirs.tall && at + tall > theirs.top;
    const below = spot.y + spot.h + 12;
    if (crosses(top) && !crosses(below) && below + tall <= floor) top = below;
  }
  node.placedAt = { left, top, wide, tall };
  const pulled = paneOffset(node);
  node.style.transform = `translate(${Math.round(left + pulled.x)}px, ${Math.round(top + pulled.y)}px)`;
  // The line to the head is drawn from where the pane really is, which while it slides back is somewhere between.
  let at = { left: left + pulled.x, top: top + pulled.y };
  if (paneSpringing(node)) {
    const zoom = Number(document.documentElement.style.zoom) || 1;
    const here = node.getBoundingClientRect();
    const there = box.getBoundingClientRect();
    at = { left: (here.left - there.left) / zoom, top: (here.top - there.top) / zoom };
  }
  if (spot) drawLeader(node, { ...at, wide, tall, side }, { x: head.x, y: top > head.y ? spot.y + spot.h + 3 : head.y - 5 });
  node.classList.toggle("no-head", !spot);
  if (choices) placeChoices(node, { left, top, wide, tall, width, floor, roof: Math.max(under(clock), under(notes)) });
  node.classList.add("placed");
}

// A talk's choices hang off the pane, on whichever side has the room, or under it, or over it, when
// neither side has. They line up with the top of the pane, stay out from under the clock, never go
// past the floor, and when there are more than the room has height for, the list scrolls.
function placeChoices(node, { left, top, wide, tall, width, floor, roof }) {
  const panel = node.querySelector(".pop-choices");
  if (!panel) return;
  panel.style.maxHeight = `${Math.max(80, floor - roof - 12)}px`;
  const panelWide = panel.offsetWidth;
  const panelTall = panel.offsetHeight;
  let where = left + wide + 12 + panelWide <= width - 6 ? "at-right" : left - 12 - panelWide >= 6 ? "at-left" : "below";
  if (where === "below" && top + tall + 12 + panelTall > floor && top - panelTall - 12 >= roof) where = "above";
  for (const one of ["at-right", "at-left", "below", "above"]) panel.classList.toggle(one, one === where);
  const start = where === "below" ? tall + 12 : where === "above" ? -panelTall - 12 : 0;
  panel.style.top = `${Math.round(Math.max(roof - top, Math.min(start, floor - top - panelTall)))}px`;
}

// A pane is only placed when it's one of ours, and not the talk's own window in another view.
const paneCalled = (id) => {
  const node = document.getElementById(id);
  return node?.classList.contains("pop-balloon") ? node : null;
};

function placeAll() {
  const { game } = app.ui;
  placePane(paneCalled("pop-balloon"), speakerHere(current())?.key ?? null);
  placePane(paneCalled("talk"), game?.talk?.key ?? null, { choices: true, anywhere: true });
  placePane(paneCalled("pop-you"), "you");
}

export const popupDrawn = placeAll;

// Puts the words in the window that's writing them, picks up the writing where it was, and tells
// the camera who to keep in view and how much of the room the windows are covering.
function settle() {
  const writing = pop.open ? document.getElementById("pop-writing") : null;
  if (writing !== pop.wordsOn) {
    pop.words = writing ? holdBack(writing) : null;
    pop.wordsOn = writing;
  }
  if (pop.words) pen.aim(pop.words.total);
  const beat = current();
  const row = document.getElementById("pop-row");
  // The camera keeps whoever's talking in view: the person in a talk, or whoever the story has speaking.
  const talking = app.ui.game?.talk?.key ?? null;
  isoLook({ person: talking ?? (pop.open ? speakerHere(beat)?.key ?? null : null), bottom: row ? row.offsetHeight + 12 : 0 });
  placeAll();
}

function drawScene() {
  const root = document.getElementById("pops");
  if (!root) return;
  root.classList.toggle("pop-open", pop.open);
  document.getElementById("pop-balloon")?.remove();
  const balloon = balloonNode();
  if (balloon) root.prepend(balloon);
  const row = document.getElementById("pop-row");
  document.getElementById("pop-story")?.remove();
  const story = storyWindow();
  if (story) row?.append(story);
  document.getElementById("pop-command")?.classList.toggle("reading", pop.open && pop.at < pop.beats.length - 1);
  settle();
}

// As the game master's words arrive.
export function updatePopups() {
  if (!document.getElementById("pops")) return;
  sync();
  drawScene();
}

// Call this once the screen's been drawn, so the windows can be measured.
export function popupsAttached() {
  if (document.getElementById("pops")) settle();
  else isoLook();
}

export function popsNode(composerNode, legend, clock) {
  // This comes first, because what's on the typing line depends on whether the story's open.
  sync();
  return el("div", { class: `pops${pop.open ? " pop-open" : ""}`, id: "pops" },
    balloonNode(),
    talkPanesNode(),
    notesNode(),
    legend,
    clock,
    el("div", { class: "pop-row", id: "pop-row" }, commandWindow(composerNode()), storyWindow()));
}
