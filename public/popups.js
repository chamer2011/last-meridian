// The story over the room, in the isometric view. A scene comes up a piece at a time, with what
// someone says in a window over their head and the rest in a window along the bottom. Clicking
// anywhere goes on to the next piece, and the choices are there the whole time.

import { el } from "./dom.js";
import { isoLook, isoSpot } from "./iso.js";
import { latestSceneStart, personSpeaking, sceneOf } from "./scene.js";
import { blockNode, sceneBlocks, speakerOf, storyEntryNode, thinkingNode, wordNodes } from "./story-view.js";
import { WRITING_SPEEDS, holdBack, newPen } from "./writer.js";

// How long a note about what's happening stays up.
const NOTE_TIME = 12000;
const MOST_NOTES = 4;

const pop = { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, limit: 340, words: null, wordsOn: null, shownNotes: [] };

// What the popups need from the main screen. Set once, when the page loads.
let app;

const calm = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const pen = newPen({
  speed: () => (calm() ? Infinity : WRITING_SPEEDS[app.reading.writing] ?? WRITING_SPEEDS.normal),
  draw: (count) => pop.words?.show(count),
});

export function initPopups(hooks) {
  app = hooks;
}

export function resetPopups() {
  pen.stop();
  for (const note of pop.shownNotes) clearTimeout(note.timer);
  Object.assign(pop, { open: false, start: null, at: 0, seen: -1, beats: [], notes: [], posted: 0, said: null, words: null, wordsOn: null, shownNotes: [] });
}

const living = () => app.ui.streaming && !app.ui.game?.talk;

// ---- Keeping up with the story -------------------------------------------

// As much as fits in a window over someone's head, going by the size of the room and of the text.
function limitNow() {
  const box = document.getElementById("pops");
  const width = box?.clientWidth || 800;
  const height = box?.clientHeight || 500;
  const size = Math.max(12, app.reading.size - 3);
  const letter = size * 0.6;
  const wide = Math.max(26 * letter, Math.min(width * 0.44, 46 * letter));
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
  placeBalloon();
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
// don't have a head to put it over, and neither does anyone who isn't in the room.
function speakerHere(beat) {
  const { game } = app.ui;
  if (app.reading.story !== "popups" || beat?.type !== "speech" || beat.voice) return null;
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

function balloonNode() {
  const beat = current();
  const person = pop.open ? speakerHere(beat) : null;
  if (!person) return null;
  const { color, name, voice } = speakerOf(beat);
  const still = living() && pop.at === pop.beats.length - 1;
  return el("div", { class: `pop-balloon${pop.at < pop.beats.length - 1 ? " more" : ""}`, id: "pop-balloon", style: `--speaker:${color}`, onclick: clickedWords },
    el("div", { class: "check-window pop-window pop-speaker" },
      el("header", { class: "check-title" }, el("span", { class: "check-name" }, name), voice && el("span", { class: "check-skill" }, voice)),
      el("div", { class: "pop-words", id: "pop-writing" }, wordNodes(beat.parts)),
      el("div", { class: "pop-hint" }, `${pop.at + 1} of ${pop.beats.length}${still ? "..." : ""}`, pop.at < pop.beats.length - 1 && el("span", {}, "click to go on"))),
    el("div", { class: "pop-tail", "aria-hidden": "true" }));
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

// Where the window over someone's head goes: above them if it fits and below them if it doesn't,
// and always on the screen. This runs each time the room's drawn, so it stays with them as they move.
function placeBalloon() {
  const balloon = document.getElementById("pop-balloon");
  const box = document.getElementById("pops");
  const notes = document.getElementById("pop-notes");
  const person = balloon && box ? speakerHere(current()) : null;
  const spot = person && isoSpot(person.key);
  if (!spot) {
    notes?.classList.remove("covered");
    return;
  }
  const row = document.getElementById("pop-row");
  const inner = balloon.querySelector(".pop-speaker");
  if (inner) inner.style.maxHeight = "";
  const width = box.clientWidth;
  const floor = box.clientHeight - (row?.offsetHeight ?? 0) - 12;
  const wide = balloon.offsetWidth;
  const full = balloon.offsetHeight;
  const middle = spot.x + spot.w / 2;
  const left = Math.max(6, Math.min(width - wide - 6, middle - wide / 2));
  // It stays out from under the clock and the notes, which are at the top.
  const clock = document.getElementById("walk-clock");
  const under = (other) => (other && other.offsetHeight && left + wide > other.offsetLeft && left < other.offsetLeft + other.offsetWidth ? other.offsetTop + other.offsetHeight + 5 : 6);
  let roof = Math.max(under(clock), under(notes));
  // The words come first. When the room's too short for them under the notes, the notes step aside until the words
  // have gone, and when it's too short even for that, the window shrinks and its words scroll, so it never runs
  // into the story below.
  const covering = floor - roof < full && under(notes) > under(clock);
  if (covering) roof = under(clock);
  notes?.classList.toggle("covered", covering);
  let tall = full;
  if (floor - roof < full && inner) {
    inner.style.maxHeight = `${Math.max(60, floor - roof)}px`;
    tall = balloon.offsetHeight;
  }
  const above = spot.y - tall - 12;
  const below = spot.y + spot.h + 12;
  const up = above >= roof || below + tall > floor;
  const top = Math.max(roof, Math.min(floor - tall, up ? above : below));
  balloon.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  balloon.style.setProperty("--tail", `${Math.round(Math.max(10, Math.min(wide - 20, middle - left - 5)))}px`);
  balloon.classList.toggle("below", !up);
  balloon.classList.add("placed");
}

export const popupDrawn = placeBalloon;

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
  isoLook({ person: pop.open ? speakerHere(beat)?.key ?? null : null, bottom: row ? row.offsetHeight + 12 : 0 });
  placeBalloon();
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
    notesNode(),
    legend,
    clock,
    el("div", { class: "pop-row", id: "pop-row" }, commandWindow(composerNode()), storyWindow()));
}
