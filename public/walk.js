// The walk-around view: each room is its own level, drawn in console art, with the story under it.
// The server keeps the levels and the captain's place in them. All of this is free: it never uses
// the AI. The player walks freely, with the keys or a click (public/move.js). Where people live their
// own days, the clock runs until Space pauses it, and this page asks the server twice a second where
// everyone has got to.

import { api, el, zoom } from "./dom.js";
import { isoFrameNode, isoKeepClear, isoMark } from "./iso.js";
import { paneNode, putPane } from "./pane.js";
import { untagged } from "./story.js";
import { closePopups, popsNode, popupDrawn, popupNext, popupPressed, popupReading, resetPopups } from "./popups.js";
import { adopt, currentSquare, follow, leavingRoom, positionNow, resetMoving, startMoving } from "./move.js";

const TICK_TIME = 500;
// How fast the clock can run, in minutes of the game to each real minute.
const SPEEDS = {
  Normal: { rate: 10, title: "A day in the game takes about two and a half hours" },
  Fast: { rate: 60, title: "A day in the game takes about 24 minutes" },
  Faster: { rate: 300, title: "A day in the game takes about 5 minutes" },
};

const walk = { sending: false, message: null, thing: null, looked: false, plan: false, fullStory: false, shownLevel: null, marks: new Map(), listed: "", speed: "Normal", stopped: null, ticking: false, shownClock: "", behindMenu: false };

// What the view needs from the main screen. Set once, when the page loads.
let app;

export function initWalk(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  // Space on a button that was clicked last only pauses: it doesn't press the button again.
  document.addEventListener("keyup", (event) => {
    if (event.key === " " && walk.spaceTaken) {
      walk.spaceTaken = false;
      event.preventDefault();
    }
  });
  document.addEventListener("pointerdown", (event) => {
    if (walk.menu && !event.target.closest?.("#walk-menu")) closeMenu();
  }, true);
  startMoving({
    view: () => (app.ui.screen === "game" && app.ui.game?.walk && walkShown() && !walk.fullStory ? app.ui.game.walk : null),
    canMove: () => !cannotWalk() && !walk.sending && !app.ui.sideOpen && !walk.fullStory && !document.getElementById("board"),
    angled: isoShown,
    setOff,
    send: (body) => api("/api/walk", body),
    arrived: (reply) => {
      takeWalk(reply);
      if (reply.arrived?.kind === "door") openDoor(reply.arrived.key);
    },
    placed: (pos) => {
      if (!isoShown()) placeCaptain(pos);
    },
  });
  setInterval(tick, TICK_TIME);
}

const isoShown = () => app.reading.view === "iso";
export const walkShown = () => (app.reading.view === "walk" || isoShown()) && Boolean(app.ui.game?.walk);
// The story goes over the room, unless the player would rather have it under the room.
export const popupsShown = () => walkShown() && isoShown() && app.reading.story !== "panel" && !walk.fullStory;

export function resetWalk() {
  resetMoving();
  Object.assign(walk, { sending: false, message: null, thing: null, looked: false, plan: false, fullStory: false, shownLevel: null, stopped: null, behindMenu: false });
  resetPopups();
}

const anotherWindow = () => {
  const g = app.ui.game;
  return Boolean(g.combat || g.check || g.talk || g.computer || g.fleet.raid || walk.plan);
};

// While the AI is writing or another window is up, the captain stays where they are.
function cannotWalk() {
  const { ui } = app;
  return ui.streaming || ui.waiting || anotherWindow();
}

// Where the player is now: walking, between squares.
const shownSpot = () => {
  adopt(app.ui.game.walk);
  return positionNow() ?? app.ui.game.walk.captain;
};
const spotStyle = (x, y) => `left:${x}ch;top:calc(${y} * var(--walk-row))`;
// A name goes on whichever side of its mark has room, and the mark stays on its own square.
const markSpot = (mark, length) => ({ x: mark.side === "left" ? mark.x - length - 1 : mark.x, y: mark.y });
const markStyle = (mark, length) => {
  const { x, y } = markSpot(mark, length);
  return spotStyle(x, y);
};

// ---- Moving the captain -------------------------------------------------

function placeCaptain({ x, y }) {
  const marker = document.getElementById("walk-captain");
  if (marker) {
    marker.style.left = `${x}ch`;
    marker.style.top = `calc(${y} * var(--walk-row))`;
  }
}

// What walking puts away, by the keys or a click: the right-click menu, a thing's window, a message about the last
// walk, and the story over the room.
function setOff() {
  if (walk.menu) closeMenu(true);
  if (walk.thing) {
    walk.thing = null;
    drawThingPane();
  }
  if (walk.message) {
    walk.message = null;
    drawHere();
  }
  if (popupsShown()) closePopups();
}

// The room as the server has it after a walk. In the same room, the people carry on from wherever they've got to since
// the reply was sent.
function takeWalk(reply) {
  const sameRoom = walk.shownLevel === reply.walk.here.id;
  const { people } = sameRoom && app.ui.game.walk.here.id === reply.walk.here.id ? app.ui.game.walk : reply.walk;
  app.ui.game.walk = { ...reply.walk, people };
  walk.message = reply.message ?? null;
  if (sameRoom && document.getElementById("walk-frame")) drawHere();
  else renderWalk();
}

// Asks the server for the way, walks it, and then does whatever walking there was for: after, when the right-click menu
// gave one, or else a talk, a thing's window or a door's. point is a spot on the floor to end on exactly, such as the
// one clicked. Keys pressed on the way take over from the click, unless the way leads out of the room.
async function go(body, after = null, point = null) {
  // A click that only put the menu away doesn't walk anywhere, and nor does one on the way out of the room.
  if (cannotWalk() || walk.sending || menuJustShut() || leavingRoom()) return;
  setOff();
  walk.sending = true;
  let reply;
  try {
    reply = await api("/api/walk", { ...body, from: currentSquare() ?? app.ui.game.walk.captain });
  } catch (err) {
    walk.sending = false;
    walk.message = err.message;
    renderWalk();
    return;
  }
  walk.sending = false;
  const leaving = reply.walk.here.id !== app.ui.game.walk.here.id;
  follow(reply.path, {
    serverAt: reply.walk.captain,
    point: leaving ? null : point,
    firm: leaving,
    turned: () => takeWalk(reply),
    done: () => {
      takeWalk(reply);
      if (after && reply.arrived && reply.arrived.kind !== "exit") after(reply.arrived);
      else if (reply.arrived?.kind === "person") app.startTalk(reply.arrived.key);
      else if (reply.arrived?.kind === "thing") openThing(reply.arrived.key);
      else if (reply.arrived?.kind === "door") openDoor(reply.arrived.key);
    },
  });
}

// The square of the plan under the pointer, and the very spot, as a position on it.
function squareAt(event, view = app.ui.game.walk) {
  const box = event.currentTarget.getBoundingClientRect();
  const fx = ((event.clientX - box.left) / box.width) * view.cols;
  const fy = ((event.clientY - box.top) / box.height) * view.lines;
  return { x: Math.floor(fx), y: Math.floor(fy), point: { x: fx - 0.5, y: fy - 0.5 } };
}

function showCursor(event) {
  const cursor = document.getElementById("walk-cursor");
  if (!cursor) return;
  const { x, y } = squareAt(event);
  cursor.style.left = `${x}ch`;
  cursor.style.top = `calc(${y} * var(--walk-row))`;
  cursor.hidden = cannotWalk();
}

function hideCursor() {
  const cursor = document.getElementById("walk-cursor");
  if (cursor) cursor.hidden = true;
}

// ---- The level ----------------------------------------------------------

// Puts someone's mark where they are now. Someone walking shows just their letter, so names don't
// go sliding across the room, and anyone who isn't anyone in particular has no name showing at all.
function dressMark(node, person) {
  const shown = person.walking || person.crowd ? { ...person, side: "right" } : person;
  const { x } = markSpot(shown, person.short.length);
  node.style.left = `${x}ch`;
  node.style.top = `calc(${person.y} * var(--walk-row))`;
  node.classList.toggle("walking", Boolean(person.walking));
  node.classList.toggle("asleep", Boolean(person.asleep));
  node.classList.toggle("crowd", Boolean(person.crowd));
  const title = `${person.name}${person.doing ? `, ${person.doing}` : ""}. Click to walk over and talk.`;
  if (node.title !== title) node.title = title;
}

function personMark(person) {
  const letter = el("span", { class: "walk-person-letter" }, person.crowd ? "o" : person.short[0].toUpperCase());
  const name = el("span", { class: "walk-person-name" }, person.side === "left" ? `${person.short} ` : ` ${person.short}`);
  const node = el("button", {
    class: "walk-mark walk-person",
    "data-mark": `person:${person.key}`,
    style: `--speaker:${person.color}`,
    "data-side": person.side,
    "aria-label": `Walk over and talk to ${person.name}`,
    disabled: cannotWalk(),
    onclick: (event) => {
      event.stopPropagation();
      go({ action: "go", to: `person:${person.key}` });
    },
  }, person.side === "left" ? [name, letter] : [letter, name]);
  dressMark(node, person);
  walk.marks.set(person.key, node);
  return node;
}

// Moves everyone without redrawing the level, so that they can glide from square to square.
function updatePeople() {
  const view = app.ui.game.walk;
  // The isometric view looks up where everyone is for itself, each time it draws.
  if (isoShown()) {
    if (listOf(view) !== walk.listed) drawHere();
    return;
  }
  const plan = document.querySelector("#walk-frame .walk-plan");
  if (!plan) return;
  const gone = new Set(walk.marks.keys());
  for (const person of view.people) {
    gone.delete(person.key);
    const mark = walk.marks.get(person.key);
    if (mark?.dataset.side === person.side) dressMark(mark, person);
    else if (mark) mark.replaceWith(personMark(person));
    else plan.insertBefore(personMark(person), document.getElementById("walk-cursor"));
  }
  for (const key of gone) {
    walk.marks.get(key).remove();
    walk.marks.delete(key);
  }
  if (listOf(view) !== walk.listed) drawHere();
}

// What each kind of part looks like on the plan, as one character.
const PART_GLYPHS = { "junction box": "%", "air plant": "&", vent: "=", "light switch": "'", camera: "o", speaker: ")", relay: "^", console: "]", engines: "&", "nav core": "+", "docking clamps": "H", machine: "*" };
const PART_WORDS = { "junction box": "power", "air plant": "air plant", vent: "vent", "light switch": "lights", camera: "camera", speaker: "alarm", relay: "comms", console: "console", engines: "engines", "nav core": "nav", "docking clamps": "clamps", machine: "machine" };

function thingMark(thing) {
  const part = thing.part;
  return el("button", {
    class: `walk-mark walk-thing${part ? ` walk-part${part.works ? "" : " down"}${part.ringing ? " ringing" : ""}` : ""}`,
    "data-mark": `thing:${thing.id}`,
    style: spotStyle(thing.x, thing.y),
    title: part ? `${thing.name}, ${part.word}. Click to walk over and work it.` : `${thing.name}. Click to walk over and take a look.`,
    "aria-label": `Walk over to ${thing.name}`,
    disabled: cannotWalk(),
    onclick: (event) => {
      event.stopPropagation();
      go({ action: "go", to: `thing:${thing.id}` });
    },
  }, part ? PART_GLYPHS[part.kind] ?? "*" : "?");
}

function exitMark(exit) {
  const glyph = el("span", { class: "walk-exit-glyph" }, exit.glyph);
  return el("button", {
    class: `walk-mark walk-exit${exit.closed ? " closed" : ""}`,
    "data-mark": `exit:${exit.key}`,
    style: markStyle(exit, exit.label.length),
    title: exit.closed ? `${exit.label}. It's closed. Click to walk over and ask.` : `${exit.label}. Click to go through.`,
    "aria-label": exit.closed ? `Walk over to the closed way to ${exit.label}` : `Go through to ${exit.label}`,
    disabled: cannotWalk(),
    onclick: (event) => {
      event.stopPropagation();
      go({ action: "go", to: `exit:${exit.key}` });
    },
  }, exit.side === "left" ? [`${exit.label} `, glyph] : [glyph, ` ${exit.label}`]);
}

const LAYERS = ["floor", "walls", "doors", "scenery", "writing"];

function layersOf(view) {
  return LAYERS.map((layer) => el("pre", { class: `walk-layer walk-${layer}`, "aria-hidden": "true" }, view.layers[layer].join("\n")));
}

function colorsOf(colors = {}) {
  return Object.entries(colors).map(([name, color]) => `--walk-${name}:${color}`).join(";");
}

function frameNode() {
  const view = app.ui.game.walk;
  if (isoShown()) {
    walk.shownLevel = view.here.id;
    walk.marks = new Map();
    return el("div", { class: "walk-frame", id: "walk-frame" }, isoFrameNode({ view: () => app.ui.game?.walk ?? null, spot: shownSpot, blocked: cannotWalk, go, menu: (key, point) => openMenu(key, point), pressed: () => menuJustShut() || (popupsShown() && !anotherWindow() && popupPressed()), reading: () => popupsShown() && !anotherWindow() && popupReading(), drawn: () => {
      popupDrawn();
      placeThingPane();
    } }));
  }
  const spot = shownSpot();
  // A level the captain has just walked into fades up.
  const arriving = walk.shownLevel !== null && walk.shownLevel !== view.here.id;
  walk.shownLevel = view.here.id;
  walk.marks = new Map();
  return el("div", { class: "walk-frame", id: "walk-frame" },
    el("div", {
      class: `walk-plan${cannotWalk() ? " waiting" : ""}${arriving ? " arriving" : ""}${view.room?.dark ? " dark" : ""}${view.room?.thin ? " thin" : ""}${view.room?.alarm ? " alarm" : ""}`,
      style: `--walk-cols:${view.cols};--walk-lines:${view.lines};${colorsOf(view.colors)}`,
      onclick: (event) => {
        const { x, y, point } = squareAt(event);
        go({ action: "go", x, y }, null, point);
      },
      oncontextmenu: (event) => {
        event.preventDefault();
        const mark = event.target.closest?.("[data-mark]");
        const { x, y } = squareAt(event);
        openMenu(mark?.dataset.mark ?? `floor:${x},${y}`, { x: event.clientX, y: event.clientY });
      },
      onmousemove: showCursor,
      onmouseleave: hideCursor,
    },
    layersOf(view),
    view.labels.map((label) => el("div", { class: "walk-label", style: spotStyle(label.x, label.y) }, label.text)),
    view.things.map(thingMark),
    view.exits.map(exitMark),
    view.people.map(personMark),
    el("div", { class: "walk-cursor", id: "walk-cursor", hidden: true }),
    el("div", { class: "walk-captain", id: "walk-captain", style: spotStyle(spot.x, spot.y), title: "You" }, "@")));
}

function hereList(label, entries) {
  return entries.length > 0 && el("div", { class: "walk-here-list small" }, el("span", { class: "muted" }, label), entries);
}

// The room's systems, in a line, when something's wrong with them.
function roomNote(room) {
  if (!room) return null;
  const notes = [
    room.alarm && `The alarm's ringing${room.alarm.room ? ` in ${room.alarm.room}` : ""}.`,
    room.dark && "The lights are out in here.",
    room.thin && `The air in here is ${room.air < 30 ? "bad" : "thin"} (${room.air}%).`,
    room.watched && "A camera's watching this room.",
  ].filter(Boolean);
  return notes.length ? el("div", { class: `walk-room-note small${room.alarm || room.air < 30 ? " bad" : ""}` }, notes.join(" ")) : null;
}

// Who's listed beside the level, and what they're doing. It's only redrawn when this changes.
const listOf = (view) => JSON.stringify(view.people.map((person) => (person.crowd ? 0 : [person.key, person.doing])));

function peopleList(view, button) {
  const named = view.people.filter((person) => !person.crowd);
  const others = view.people.length - named.length;
  const rest = others === 1 && !named.length ? "One other person" : others && !named.length ? `${others} other people` : others === 1 ? "and one other" : `and ${others} others`;
  return [
    ...named.map((person) => button(person.doing ? `${person.short}: ${person.doing}` : person.short, `person:${person.key}`, { class: "walk-here-person", style: `--speaker:${person.color}` })),
    ...(others ? [el("span", { class: "muted" }, rest)] : []),
  ];
}

function hereNode() {
  const view = app.ui.game.walk;
  walk.listed = listOf(view);
  const button = (text, to, props = {}) => el("button", {
    disabled: cannotWalk(),
    onclick: () => go({ action: "go", to }),
    oncontextmenu: (event) => {
      event.preventDefault();
      openMenu(to, { x: event.clientX, y: event.clientY });
    },
    ...props,
  }, text);
  return el("div", { class: "walk-here", id: "walk-here" },
    el("div", { class: "walk-here-name" }, view.here.name),
    view.here.desc && el("div", { class: "muted small" }, view.here.desc),
    view.overview && el("div", {}, el("button", {
      disabled: cannotWalk(),
      onclick: () => {
        walk.plan = true;
        app.render();
      },
    }, view.overview.title)),
    hereList("People:", peopleList(view, button)),
    hereList("Things:", view.things.filter((thing) => !thing.part).map((thing) => button(thing.name, `thing:${thing.id}`))),
    hereList("Systems:", view.things.filter((thing) => thing.part).map((thing) => button(`${PART_WORDS[thing.part.kind] ?? "part"}${["on", "open", "watching", "released"].includes(thing.part.word) ? "" : ` (${thing.part.word})`}`, `thing:${thing.id}`, { class: `walk-here-part${thing.part.works ? "" : " down"}`, title: `${thing.name}, ${thing.part.word}` }))),
    roomNote(view.room),
    hereList("Ways out:", view.exits.map((exit) => button(exit.closed ? `${exit.label} (closed)` : exit.label, `exit:${exit.key}`))),
    !app.ui.game.role.captain && hereList("You can:", [
      app.ui.game.role.job && el("button", { disabled: cannotWalk(), onclick: app.act({ action: "work" }) }, app.ui.game.role.job.name),
      app.ui.game.role.rest === 0 && el("button", { disabled: cannotWalk(), onclick: app.act({ action: "rest" }) }, "Sleep (8 hours)"),
      app.ui.game.role.rest > 0 && el("button", { disabled: cannotWalk() || app.ui.game.credits < app.ui.game.role.rest, onclick: app.act({ action: "rest" }) }, `Rent a bunk (${app.ui.game.role.rest} cr)`),
      app.ui.game.role.rest > 0 && el("button", { disabled: cannotWalk(), onclick: app.act({ action: "rest", rough: true }) }, "Sleep rough"),
    ].filter(Boolean)),
    walk.message && el("div", { class: "notice-inline fail" }, walk.message));
}

// The whole story, in place of the room, for going back over it.
export function showWholeStory() {
  walk.fullStory = true;
  app.render();
}

function storyBar() {
  return el("div", { class: "walk-story-bar small" },
    el("span", { class: "muted" }, walk.fullStory ? "The whole story so far" : "The story"),
    el("button", {
      onclick: () => {
        walk.fullStory = !walk.fullStory;
        app.render();
      },
    }, walk.fullStory ? "Back to the map" : "Show the whole story"));
}

// The story's log goes in here with its usual id, so streaming and scrolling work just as they do in the classic view.
export function walkViewNode(logNode, composerNode) {
  if (walk.fullStory) return el("div", { class: "walk-full" }, storyBar(), logNode());
  const popped = popupsShown();
  const legend = el("div", { class: "muted walk-legend" }, isoShown()
    ? `${app.ui.game.walk.things.length ? "? something to look at   " : ""}Walk with WASD or a click   Click anyone or anything   Right-click for more   Space pauses   The wheel zooms`
    : `@ you   ${app.ui.game.walk.things.length ? "? something to look at   " : ""}Walk with WASD or a click   Right-click for more   Space pauses`);
  return el("div", { class: `walk-view${isoShown() ? " iso" : ""}${popped ? " pops-on" : ""}`, id: "walk-view" },
    el("div", { class: "walk-map" },
      frameNode(),
      !popped && clockBar(),
      popped ? popsNode(composerNode, legend, clockBar()) : legend,
      thingLayer(),
      menuLayer()),
    hereNode(),
    !popped && el("div", { class: "walk-story" }, storyBar(), logNode({ latest: true })));
}

function drawHere() {
  const old = document.getElementById("walk-here");
  if (!old) return;
  const node = hereNode();
  const top = old.scrollTop;
  old.replaceWith(node);
  node.scrollTop = top;
}

// Redraws the level in place, leaving the story and what's being typed alone.
export function renderWalk() {
  if (app.ui.screen !== "game" || !walkShown() || walk.fullStory) return;
  document.getElementById("walk-frame")?.replaceWith(frameNode());
  drawHere();
  drawClock();
  requestAnimationFrame(placeThingPane);
}

// ---- The clock ----------------------------------------------------------

// Why the clock's stopped, if there's a reason worth showing beside it.
function clockHeld() {
  const { ui } = app;
  if (ui.streaming || ui.waiting) return "The story's being written";
  if (walk.stopped === "paused") return "Paused: Space goes on";
  if (ui.draft.trim()) return "Stopped while you're typing";
  return null;
}

// The clock runs all the time, through menus, the deck plan, a thing's window, every skill check and a computer in use,
// until Space pauses it. Talks, fights and raids stop it, the same as walkTick in src/walk.js, and so does the Story
// board, which is for writing.
function clockWaits() {
  const { ui } = app;
  const g = ui.game;
  return ui.streaming || ui.waiting || Boolean(g.combat || g.talk || g.fleet.raid) || Boolean(document.getElementById("board"));
}

// Time stands still for anything that stops the clock, and while the game's window is put away.
const clockCanRun = () => !clockHeld() && !clockWaits() && document.visibilityState === "visible";

function setSpeed(name) {
  if (name) {
    walk.speed = name;
    walk.stopped = null;
  } else walk.stopped = "paused";
  drawClock();
}

// Space: paused, or going on at the speed it had.
export function toggleClock() {
  setSpeed(walk.stopped === "paused" ? walk.speed : null);
}

function clockBar() {
  if (!app.ui.game.walk.life) return null;
  const why = clockHeld();
  walk.shownClock = `${app.ui.game.clock.label}|${why}|${walk.speed}`;
  const pick = (label, on, run, title = null) => el("button", { class: on ? "primary" : "", "aria-pressed": String(on), onclick: run, ...(title ? { title } : {}) }, label);
  return el("div", { class: "walk-clock small", id: "walk-clock" },
    el("span", { class: "walk-clock-time" }, app.ui.game.clock.label),
    pick("Pause", walk.stopped === "paused", () => setSpeed(null), "Or press Space, and Space again to go on"),
    Object.entries(SPEEDS).map(([name, { title }]) => pick(name, !walk.stopped && walk.speed === name, () => setSpeed(name), title)),
    why && el("span", { class: "muted walk-clock-why" }, why));
}

function drawClock() {
  const old = document.getElementById("walk-clock");
  if (old && walk.shownClock !== `${app.ui.game.clock.label}|${clockHeld()}|${walk.speed}`) old.replaceWith(clockBar());
}

function applyTick(reply) {
  const { ui } = app;
  if (!reply.clock || !ui.game) return;
  // Every couple of hours the captain's fatigue changes, and now and then the fleet has news.
  if (reply.game) {
    ui.game = reply.game;
    if (reply.news) {
      // A raid needs the whole screen. Anything else waits behind an open menu, so nothing being done in it is lost.
      if (ui.game.fleet.raid) ui.sideOpen = false;
      if (!ui.sideOpen) {
        app.render();
        return;
      }
      walk.behindMenu = true;
      renderWalk();
    }
    app.renderStatus();
  }
  const changed = ui.game.clock.label !== reply.clock.label;
  ui.game.clock = reply.clock;
  if (changed) app.renderStatus();
  if (reply.here === walk.shownLevel && reply.here === ui.game.walk.here.id) {
    ui.game.walk.people = reply.people;
    updatePeople();
  }
  drawClock();
}

// Whether news came while a menu was open, so the story needs drawing again once it's shut.
export function newsBehindMenu() {
  const was = walk.behindMenu;
  walk.behindMenu = false;
  return was;
}

async function tick() {
  const { ui } = app;
  if (ui.screen !== "game" || !ui.game || !walkShown() || !ui.game.walk.life) return;
  drawClock();
  if (walk.ticking || !clockCanRun()) return;
  walk.ticking = true;
  try {
    applyTick(await api("/api/tick", { ms: TICK_TIME, rate: SPEEDS[walk.speed].rate }));
  } catch {
    // Most likely the game master has just started writing. The next tick looks again.
  }
  walk.ticking = false;
}

// ---- The map of the whole place -----------------------------------------

function goToRoom(to) {
  walk.plan = false;
  go({ action: "room", to });
  app.render();
}

const whoIsIn = (room) => [room.people.join(", "), room.others ? `${room.others} other${room.others === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");

function planWindow(view) {
  const plan = view.overview;
  const here = plan.rooms.find((room) => room.here);
  return el("div", { class: "check-window walk-plan-window", "data-theme": "green", role: "dialog", "aria-label": plan.title, tabindex: "-1", id: "walk-window" },
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, plan.title),
      el("span", { class: "check-skill" }, "Click a room to walk there. It's free, and it takes no time.")),
    el("div", { class: "walk-plan-frame" },
      el("div", {
        class: "walk-plan",
        style: `--walk-cols:${plan.cols};--walk-lines:${plan.lines}`,
        onclick: (event) => {
          const { x, y } = squareAt(event, plan);
          const level = plan.floors[plan.layers.floor[y]?.[x]];
          if (level && !plan.rooms.find((room) => room.id === level)?.closed) goToRoom(level);
        },
      },
      ["floor", "walls", "doors", "scenery"].map((layer) => el("pre", { class: `walk-layer walk-${layer}`, "aria-hidden": "true" }, plan.layers[layer].join("\n"))),
      plan.rooms.map((room) => el("button", {
        class: `walk-mark walk-room${room.here ? " here" : ""}${room.closed ? " closed" : ""}`,
        style: spotStyle(room.x, room.y),
        title: room.closed ? `${room.name}: you'd have to ask at the door` : whoIsIn(room) ? `${room.name}: ${whoIsIn(room)}` : room.name,
        disabled: room.closed,
        onclick: (event) => {
          event.stopPropagation();
          goToRoom(room.id);
        },
      }, room.text)))),
    el("div", { class: "walk-plan-list" },
      plan.rooms.map((room) => el("button", { class: `walk-plan-row${room.here ? " here" : ""}`, disabled: room.closed, onclick: () => goToRoom(room.id) },
        el("span", { class: "option-label" }, room.name),
        room.closed
          ? el("span", { class: "option-detail" }, "closed: you'd have to ask at the door")
          : whoIsIn(room) && el("span", { class: "option-detail" }, whoIsIn(room)))),
      plan.elsewhere.map((room) => el("button", { class: `walk-plan-row${room.here ? " here" : ""}`, onclick: () => goToRoom(`elsewhere:${room.name}`) },
        el("span", { class: "option-label" }, room.name),
        el("span", { class: "option-detail" }, "not on the map")))),
    el("div", { class: "options walk-thing-options" }, el("button", { onclick: closeWindow }, el("span", { class: "option-label" }, here || view.offPlan ? "Stay here" : "Close"))));
}

// ---- Looking at things --------------------------------------------------

export const thingOpen = () => Boolean(walk.thing || walk.plan);

function openThing(id) {
  walk.thing = app.ui.game.walk.things.find((thing) => thing.id === id) ?? null;
  walk.looked = false;
  app.render();
}

// A closed door says why it's closed, straight away, and asking at it goes to the story.
function openDoor(key) {
  const door = app.ui.game.walk.exits.find((exit) => exit.key === key);
  walk.thing = door ? { key, name: door.label, look: door.look, use: door.use, door: true, locked: Boolean(door.locked), actions: door.actions ?? null } : null;
  walk.looked = true;
  app.render();
}

function closeWindow() {
  walk.thing = null;
  walk.plan = false;
  walk.looked = false;
  app.render();
}

// A thing with a written result, or a door with a rule, answers from its file right here in the window, for free.
// With an AI game master, anything else is the player's next line in the story.
async function useThing() {
  const thing = walk.thing;
  if (app.ui.game.mode !== "written" && !thing.written) {
    walk.thing = null;
    walk.looked = false;
    app.sendChat({ text: thing.use });
    return;
  }
  try {
    const reply = await api("/api/walk", { action: thing.door ? "ask" : "use", key: thing.door ? thing.key : thing.id });
    app.ui.game = reply.game;
    if (reply.check || reply.computer) {
      // The door's check has its own window, and the answer comes with Continue the story. A computer has its own too.
      walk.thing = null;
      walk.looked = false;
    } else {
      walk.thing = { ...thing, look: reply.said, done: true, have: thing.have || /^\[ITEM\]/.test(reply.said ?? "") };
      walk.looked = true;
    }
  } catch (err) {
    walk.thing = { ...thing, look: err.message, done: true };
    walk.looked = true;
  }
  app.render();
}

// Working a part or a locked door by hand: something free happens here and now, and anything that takes a check opens
// its window, with the result in the story when it's over.
async function workOn(thing, how) {
  if (walk.working) return;
  walk.working = true;
  try {
    const reply = await api("/api/walk", { action: "work", key: thing.door ? thing.key : thing.id, how });
    app.ui.game = reply.game;
    if (reply.check || reply.computer) {
      walk.thing = null;
      walk.looked = false;
    } else {
      const fresh = thing.door ? null : reply.game.walk?.things.find((one) => one.id === thing.id);
      walk.thing = { ...(fresh ?? thing), said: reply.said ?? null };
      walk.looked = true;
    }
  } catch (err) {
    walk.thing = { ...thing, said: err.message };
    walk.looked = true;
  }
  walk.working = false;
  app.render();
}

// ---- A thing's window, beside it ------------------------------------------

// A thing, a part or a door answers in a window beside it, on a line, like the people's speech: the game's console
// window, with its name and state in the bar, and what can be done in a second window glued to its far side, under an
// Actions bar. Nothing behind it is dimmed, the room and its clock go on, and walking anywhere puts it away. It can be
// pulled aside to see what's under it, and it slides back when it's let go.
const markKey = (thing) => (thing.person ? `person:${thing.key}` : thing.door ? `exit:${thing.key}` : `thing:${thing.id}`);
// The console's colours by kind: gold for things, teal for the ship's parts, amber when a part's off or dead or a door's
// only shut, and red when a door's locked or the alarm's ringing.
// Someone looked at is in their own colour.
const paneTheme = (thing) => (thing.person ? "person" : thing.door ? (thing.locked ? "red" : "amber") : thing.part ? (thing.part.ringing ? "red" : thing.part.works ? "teal" : "amber") : "gold");
// The Actions window overlaps the thing's window by a pixel, so the two share one edge.
const GLUE = -1;
// What the game says comes with a tag in front, like [SYSTEMS] or [ITEM]; the window shows the words alone.
const plainLines = (text) => String(text).split("\n").map(untagged).filter(Boolean);

function thingChoices(thing) {
  if (thing.person) return personChoices(thing);
  if (thing.actions || thing.part) return [...(thing.actions ?? []).map((action) => [action.label, action.detail, () => workOn(thing, action.id)]), ["Close", "", closeWindow]];
  const written = app.ui.game.mode === "written" || Boolean(thing.written);
  return [
    ...(thing.done ? [] : [[thing.door ? "Ask to go through" : "Use", thing.have ? "you're already carrying one" : written ? "free" : "this goes to the story, as your next action", useThing, thing.have]]),
    ["Close", "", closeWindow],
  ];
}

function thingPane(thing) {
  const key = markKey(thing);
  const word = thing.part?.word ?? (thing.locked ? "locked" : thing.door ? "closed" : null);
  const theme = paneTheme(thing);
  const opening = walk.paneFor !== key && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const node = paneNode({
    id: "walk-window",
    key,
    color: theme === "person" ? thing.color : null,
    opening,
    className: "walk-thing-pane",
    place: placeThingPane,
    frame: "console",
    body: [
      el("header", { class: "check-title walk-thing-title" }, el("span", { class: "check-name" }, thing.name), word && el("span", { class: "check-skill" }, word)),
      (thing.said || thing.look) && el("div", { class: "walk-thing-words" },
        thing.said && el("div", { class: "walk-thing-said" }, plainLines(thing.said).map((line) => el("div", {}, line))),
        thing.look && el("div", { class: "walk-thing-look" }, plainLines(thing.look).map((line) => el("div", {}, line)))),
    ],
    // The Actions window slides out from behind the first time, and is simply there when the window's drawn again.
    extras: el("div", { class: `walk-thing-choices${opening ? "" : " in"}`, id: "walk-thing-choices" },
      el("header", { class: "check-title" }, "Actions"),
      el("div", { class: "options walk-thing-options" }, thingChoices(thing).map(([label, detail, run, disabled], i) => el("button", {
        "data-choice": String(i + 1),
        disabled: Boolean(disabled) || Boolean(walk.working),
        onclick: (event) => {
          event.stopPropagation();
          run();
        },
      }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label), detail && el("span", { class: "option-detail" }, detail))))),
  });
  walk.paneFor = key;
  node.dataset.theme = theme;
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", thing.name);
  node.tabIndex = -1;
  if (opening) setTimeout(() => node.querySelector(".walk-thing-choices")?.classList.add("in"), 340);
  return node;
}

// The layer the pane goes on, over the room: every click but the pane's own goes through to the room.
function thingLayer() {
  // Put away, the next window opens afresh, sliding out from its thing.
  if (!walk.thing || walk.plan) {
    walk.paneFor = null;
    return null;
  }
  requestAnimationFrame(placeThingPane);
  return el("div", { class: "walk-things", id: "walk-thing" }, thingPane(walk.thing));
}

// What can be done with someone from their window: the same as their menu, with Attack asking first.
function personChoices(thing) {
  const person = app.ui.game.walk.people.find((one) => one.key === thing.key);
  if (!person) return [["Close", "", closeWindow]];
  const to = `person:${person.key}`;
  const asking = (confirm) => () => {
    walk.thing = { ...thing, confirm };
    drawThingPane();
  };
  if (thing.confirm) {
    return [
      [`Attack ${person.short}`, "it starts a fight, and everyone here sees it", () => go({ action: "go", to }, () => deed("attack", person.key))],
      ["Never mind", "", asking(false)],
    ];
  }
  return [
    ["Talk", "", () => go({ action: "go", to })],
    ["Pickpocket", person.wary ? "they're watching their pockets" : person.pocket, () => go({ action: "go", to }, () => deed("pickpocket", person.key)), person.wary],
    ["Attack", "starts a fight", asking(true)],
    ["Close", "", closeWindow],
  ];
}

// The pane drawn again, or put away, without drawing anything else.
function drawThingPane() {
  const old = document.getElementById("walk-thing");
  const fresh = thingLayer();
  if (old && fresh) old.replaceWith(fresh);
  else if (old) old.remove();
  else if (fresh) document.querySelector(".walk-map")?.append(fresh);
  if (!fresh) uncoverNotes();
}


// A floating window that's about something in the room, with the window's box on the screen where it rests: in the
// isometric view, the room slides aside to keep that thing clear of the window. Nothing, and it slides back.
export function keepClear(key = null, box = null) {
  const canvas = key && box && walkShown() && isoShown() ? document.querySelector("#walk-frame canvas") : null;
  if (!canvas?.clientWidth) {
    isoKeepClear(null);
    return;
  }
  const at = canvas.getBoundingClientRect();
  const scale = at.width / canvas.clientWidth;
  isoKeepClear(key, { left: (box.left - at.left) / scale, top: (box.top - at.top) / scale, right: (box.right - at.left) / scale, bottom: (box.bottom - at.top) / scale });
}

// Where a mark is on the screen right now, for a floating window's line to point at: in the isometric view where it
// was drawn, on the classic plan its mark, or nothing when it isn't in view.
export function markPoint(key) {
  if (!key || !app?.ui.game?.walk || !walkShown() || walk.fullStory) return null;
  const box = markBox(key);
  return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
}

// Where a mark is on the screen, as a box in the screen's pixels: its hit on the isometric room, or its place on the plan.
function markBox(key) {
  if (isoShown()) {
    const hit = isoMark(key);
    const canvas = document.querySelector("#walk-frame canvas");
    if (!hit || !canvas?.clientWidth) return null;
    const box = canvas.getBoundingClientRect();
    const scale = box.width / canvas.clientWidth;
    return { left: box.left + hit.x * scale, top: box.top + hit.y * scale, width: hit.w * scale, height: hit.h * scale };
  }
  return document.querySelector(`#walk-frame [data-mark="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null;
}

// ---- The right-click menu ------------------------------------------------

// A right-click on someone, something, a door or the floor opens what can be done with it, sliding open where the click
// was: the console's window in the colour of what it's for, its choices numbered. What has to be done up close walks
// over first, and Look looks from where the player stands. A click anywhere else, Escape, or walking puts it away.
const menuJustShut = () => Date.now() - (walk.menuShut ?? 0) < 400;
const sentence = (words) => (words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}.` : "");
const usedBy = (thing) => (app.ui.game.mode === "written" || thing.written ? "free" : "this goes to the story, as your next action");

function openMenu(key, point) {
  if (cannotWalk() || !app.ui.game?.walk || !targetOf(key)) return;
  walk.menuShut = 0;
  walk.menu = { key, x: point.x, y: point.y, confirm: null, opening: !window.matchMedia("(prefers-reduced-motion: reduce)").matches };
  drawMenu();
}

// A choice closes it quietly, so whatever it does can walk; anything else closes it and keeps the click from walking.
function closeMenu(chosen = false) {
  if (!walk.menu) return;
  walk.menu = null;
  if (!chosen) walk.menuShut = Date.now();
  drawMenu();
}

// What a key from the room, the plan or the list stands for, as it is now.
function targetOf(key) {
  const view = app.ui.game?.walk;
  if (!view || !key) return null;
  const [kind, ...rest] = String(key).split(":");
  const id = rest.join(":");
  if (kind === "person") {
    const person = view.people.find((one) => one.key === id);
    return person ? { kind, person } : null;
  }
  if (kind === "thing") {
    const thing = view.things.find((one) => one.id === id);
    return thing ? { kind, thing } : null;
  }
  if (kind === "exit") {
    const exit = view.exits.find((one) => one.key === id);
    return exit ? { kind, exit } : null;
  }
  const [x, y] = id.split(",").map(Number);
  return kind === "floor" && Number.isInteger(x) && Number.isInteger(y) ? { kind, x, y } : null;
}

// The menu for each kind of target: its title, its state, its colour and its choices.
function menuFor(target) {
  if (target.kind === "person") {
    const person = target.person;
    const to = `person:${person.key}`;
    return {
      title: person.short,
      word: person.asleep ? "asleep" : null,
      theme: "person",
      color: person.color,
      items: [
        { label: "Talk", run: () => go({ action: "go", to }) },
        { label: "Look", run: () => lookAtPerson(person) },
        { label: "Pickpocket", detail: person.wary ? "they're watching their pockets" : person.pocket, disabled: Boolean(person.wary), run: () => go({ action: "go", to }, () => deed("pickpocket", person.key)) },
        { label: "Attack", detail: "starts a fight", ask: `Attack ${person.short}? It starts a fight, and everyone here sees it.`, run: () => go({ action: "go", to }, () => deed("attack", person.key)) },
      ],
    };
  }
  if (target.kind === "thing") {
    const thing = target.thing;
    const there = (then) => () => go({ action: "go", to: `thing:${thing.id}` }, () => {
      openThing(thing.id);
      then();
    });
    if (thing.part) {
      return {
        title: thing.name,
        word: thing.part.word,
        theme: paneTheme(thing),
        items: [
          { label: "Look", run: () => openThing(thing.id) },
          ...(thing.actions ?? []).map((action) => ({ label: action.label, detail: action.detail, run: there(() => workOn(walk.thing, action.id)) })),
        ],
      };
    }
    return {
      title: thing.name,
      theme: "gold",
      items: [
        { label: "Look", run: () => openThing(thing.id) },
        { label: "Use", detail: thing.have ? "you're already carrying one" : usedBy(thing), disabled: Boolean(thing.have), run: there(() => useThing()) },
      ],
    };
  }
  if (target.kind === "exit") {
    const exit = target.exit;
    const to = `exit:${exit.key}`;
    const there = (then) => () => go({ action: "go", to }, () => {
      openDoor(exit.key);
      then();
    });
    if (exit.locked) {
      return {
        title: exit.label,
        word: "locked",
        theme: "red",
        items: [
          { label: "Look", run: () => openDoor(exit.key) },
          ...(exit.actions ?? []).map((action) => ({ label: action.label, detail: action.detail, run: there(() => workOn(walk.thing, action.id)) })),
        ],
      };
    }
    if (exit.closed) {
      return {
        title: exit.label,
        word: "closed",
        theme: "amber",
        items: [
          { label: "Look", run: () => openDoor(exit.key) },
          { label: "Ask to go through", detail: usedBy(exit), run: there(() => useThing()) },
        ],
      };
    }
    return { title: exit.label, theme: "green", items: [{ label: "Go through", run: () => go({ action: "go", to }) }] };
  }
  return { title: "The floor", theme: "green", items: [{ label: "Walk here", run: () => go({ action: "go", x: target.x, y: target.y }) }] };
}

// Someone looked at: their window beside them, with how they look and what they're doing.
function lookAtPerson(person) {
  const now = person.asleep ? "Asleep." : sentence(person.doing);
  walk.thing = { person: true, key: person.key, name: person.short, color: person.color, look: [person.look, now].filter(Boolean).join("\n") || person.name, confirm: false };
  walk.looked = true;
  app.render();
}

// Picking a pocket or starting a fight, once the player's next to them. Each opens its own window, or says why not.
async function deed(action, key) {
  if (walk.working) return;
  walk.working = true;
  walk.message = null;
  try {
    const reply = await api("/api/walk", { action, key });
    app.ui.game = reply.game;
  } catch (err) {
    walk.message = err.message;
  }
  walk.working = false;
  app.render();
}

function menuNode() {
  const menu = walk.menu;
  const target = menu && targetOf(menu.key);
  if (!target) return null;
  const spec = menuFor(target);
  const opening = menu.opening;
  menu.opening = false;
  const choose = (item) => {
    if (item.ask && !walk.menu.confirm) {
      walk.menu = { ...walk.menu, confirm: item };
      drawMenu();
      return;
    }
    closeMenu(true);
    item.run();
  };
  const items = menu.confirm
    ? [{ ...menu.confirm, label: menu.confirm.label === "Attack" ? `Attack ${spec.title}` : menu.confirm.label, detail: "" }, { label: "Never mind", run: () => {
      walk.menu = { ...walk.menu, confirm: null };
      drawMenu();
    }, keep: true }]
    : spec.items;
  return el("div", {
    class: `walk-menu${opening ? " opening" : ""}`,
    id: "walk-menu",
    "data-theme": spec.theme,
    style: spec.color ? `--speaker:${spec.color}` : "",
    role: "menu",
    "aria-label": spec.title,
    oncontextmenu: (event) => event.preventDefault(),
  },
  el("header", { class: "check-title" }, el("span", { class: "check-name" }, spec.title), spec.word && el("span", { class: "check-skill" }, spec.word)),
  menu.confirm && el("div", { class: "walk-menu-ask" }, menu.confirm.ask),
  el("div", { class: "options" }, items.map((item, i) => el("button", {
    role: "menuitem",
    "data-choice": String(i + 1),
    disabled: Boolean(item.disabled) || Boolean(walk.working),
    onclick: (event) => {
      event.stopPropagation();
      if (item.keep) item.run();
      else choose(item);
    },
  }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, item.label), item.detail && el("span", { class: "option-detail" }, item.detail)))));
}

// The layer the menu goes on, over the room and any thing's window.
function menuLayer() {
  if (walk.menu && (cannotWalk() || !targetOf(walk.menu.key))) walk.menu = null;
  if (!walk.menu) return null;
  requestAnimationFrame(placeMenu);
  return el("div", { class: "walk-menus", id: "walk-menus" }, menuNode());
}

function drawMenu() {
  const old = document.getElementById("walk-menus");
  const fresh = menuLayer();
  if (old && fresh) old.replaceWith(fresh);
  else if (old) old.remove();
  else if (fresh) document.querySelector(".walk-map")?.append(fresh);
}

// Where the click was, opening down and to the right, or up or to the left where there isn't the room.
function placeMenu() {
  const node = document.getElementById("walk-menu");
  const layer = document.getElementById("walk-menus");
  if (!node || !layer || !walk.menu) return;
  const z = zoom();
  const base = layer.getBoundingClientRect();
  const x = (walk.menu.x - base.left) / z;
  const y = (walk.menu.y - base.top) / z;
  const wide = node.offsetWidth;
  const tall = node.offsetHeight;
  const width = layer.clientWidth;
  const height = layer.clientHeight;
  let left = x + 2;
  if (left + wide > width - 4) left = x - 2 - wide;
  left = Math.max(4, Math.min(width - wide - 4, left));
  const up = y + 2 + tall > height - 4 && y - 2 - tall >= 4;
  const top = Math.max(4, Math.min(height - tall - 4, up ? y - 2 - tall : y + 2));
  node.style.left = `${Math.round(left)}px`;
  node.style.top = `${Math.round(top)}px`;
  node.classList.toggle("up", up);
  node.classList.add("placed");
}

// Where the thing is, in the layer's own measure: where the isometric view drew it, or its mark on the plan.
function thingSpot(layer, thing) {
  const box = markBox(markKey(thing));
  if (!box) return null;
  const base = layer.getBoundingClientRect();
  const z = zoom();
  return { x: (box.left - base.left) / z, y: (box.top - base.top) / z, w: box.width / z, h: box.height / z };
}

// Beside the thing: up and to its right, a hand from it, with its Actions glued on beyond it, or both to its left when
// the right hasn't room for the two. When neither side has room for both, the window goes where it fits and its
// Actions under it or over it, so they never sit on the thing. Always inside the room, out from under the clock, and
// above the line along the bottom. It runs each time the room's drawn, so it stays with the thing as the view moves,
// and again while it's being pulled aside or sliding back.
function placeThingPane() {
  const layer = document.getElementById("walk-thing");
  const node = document.getElementById("walk-window");
  if (!layer || !node?.classList.contains("pop-balloon") || !walk.thing) return;
  const z = zoom();
  const base = layer.getBoundingClientRect();
  const spot = thingSpot(layer, walk.thing);
  const pane = node.querySelector(".pop-pane");
  if (pane) pane.style.maxHeight = "";
  const panel = node.querySelector(".walk-thing-choices");
  if (panel) panel.style.maxHeight = "";
  const width = layer.clientWidth;
  const frame = document.getElementById("walk-frame")?.getBoundingClientRect();
  const row = document.getElementById("pop-row")?.getBoundingClientRect();
  const floor = Math.min(frame ? (frame.bottom - base.top) / z : layer.clientHeight, row?.height ? (row.top - base.top) / z : Infinity) - 8;
  const wide = node.offsetWidth;
  const panelWide = panel?.offsetWidth ?? 0;
  const mark = spot ? { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 } : { x: width / 2, y: floor / 2 };
  const pair = panel ? wide + GLUE + panelWide : wide;
  let side = "right";
  let left = mark.x + 26;
  let beside = Boolean(panel);
  if (left + pair > width - 6) {
    if (mark.x - 26 - pair >= 6) {
      side = "left";
      left = mark.x - 26 - wide;
    } else {
      beside = false;
      if (left + wide > width - 6) {
        side = "left";
        left = mark.x - 26 - wide;
      }
      if (left < 6) {
        side = "right";
        left = mark.x + 26;
      }
    }
  }
  left = Math.max(6, Math.min(width - wide - 6, left));
  // The clock sits at the top of the room when the story's over it.
  const clock = document.getElementById("walk-clock")?.getBoundingClientRect();
  const clockBottom = clock?.height ? (clock.bottom - base.top) / z : 0;
  const reach = left + wide + (beside && side === "right" ? GLUE + panelWide : 0);
  const underClock = clock?.height && clockBottom < floor / 2 && reach > (clock.left - base.left) / z;
  const roof = underClock ? clockBottom + 6 : 6;
  // Heights to the fraction of a pixel, so the Actions glued under or over share the window's edge exactly.
  const tallOf = (one) => one.getBoundingClientRect().height / z;
  let tall = tallOf(node);
  if (floor - roof < tall && pane) {
    pane.style.maxHeight = `${Math.max(60, floor - roof)}px`;
    tall = tallOf(node);
  }
  // Side by side, the taller of the two keeps them both above the bottom, with their bars level.
  const pairTall = beside ? Math.max(tall, tallOf(panel)) : tall;
  const top = Math.max(roof, Math.min(floor - pairTall, mark.y - 14 - tall));
  putPane(node, layer, { left, top, wide, tall, side }, spot ? mark : null);
  placeThingChoices(node, { top, tall, floor, roof, side, beside });
  node.classList.add("placed");
  // The notes at the top step aside while the pane or its choices would cover them, and come back once they wouldn't.
  const notes = document.getElementById("pop-notes");
  if (notes) {
    const room = notes.getBoundingClientRect();
    const crosses = (r) => Boolean(r && room.height && r.left < room.right && room.left < r.right && r.top < room.bottom && room.top < r.bottom);
    if (crosses(pane?.getBoundingClientRect()) || crosses(node.querySelector(".walk-thing-choices")?.getBoundingClientRect())) {
      notes.classList.add("covered");
      notes.dataset.thing = "1";
    } else uncoverNotes();
  }
}

function uncoverNotes() {
  const notes = document.getElementById("pop-notes");
  if (!notes?.dataset.thing) return;
  notes.classList.remove("covered");
  delete notes.dataset.thing;
}

// The Actions window is glued to the window's far side from the thing, with their bars level, or under it or over it
// when placeThingPane found no room beside it; their edges share one line.
function placeThingChoices(node, { top, tall, floor, roof, side, beside }) {
  const panel = node.querySelector(".walk-thing-choices");
  if (!panel) return;
  panel.style.maxHeight = `${Math.max(80, beside ? floor - top : floor - roof)}px`;
  const panelTall = panel.getBoundingClientRect().height / zoom();
  let where = beside ? (side === "left" ? "at-left" : "at-right") : "below";
  if (where === "below" && top + tall + GLUE + panelTall > floor && top - panelTall - GLUE >= roof) where = "above";
  for (const one of ["at-right", "at-left", "below", "above"]) panel.classList.toggle(one, one === where);
  const start = where === "below" ? tall + GLUE : where === "above" ? -panelTall - GLUE : 0;
  // Not rounded, so a window glued under or over shares its edge exactly.
  panel.style.top = `${Math.max(roof - top, Math.min(start, floor - top - panelTall))}px`;
}

// The deck plan still opens in a window of its own. A thing's pane is drawn with the room, by thingLayer.
export function thingNode() {
  if (!walk.plan || !app.ui.game?.walk) return null;
  return el("div", { class: "check-overlay", id: "walk-plan-window" }, planWindow(app.ui.game.walk));
}

export function focusThing() {
  document.getElementById("walk-window")?.focus({ preventScroll: true });
}

// ---- The keyboard -------------------------------------------------------

function onKey(event) {
  if (app.ui.screen !== "game" || !app.ui.game || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey || document.getElementById("board")) return;
  const typing = Boolean(event.target.closest?.("input, textarea, select"));
  if (walk.menu && !typing) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    const pick = /^[1-9]$/.test(event.key) ? document.querySelector(`#walk-menu [data-choice="${event.key}"]`) : null;
    if (pick) {
      event.preventDefault();
      pick.click();
      return;
    }
  }
  if (walk.plan) {
    if (event.key === "Escape") closeWindow();
    else if (event.key === " " && !typing) pauseKey(event);
    return;
  }
  if (walk.thing && !typing) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeWindow();
      return;
    }
    const choice = /^[1-9]$/.test(event.key) ? document.querySelector(`#walk-thing [data-choice="${event.key}"]`) : null;
    if (choice) {
      event.preventDefault();
      choice.click();
      return;
    }
  }
  if (event.key === " " && !typing) {
    pauseKey(event);
    return;
  }
  const pressable = event.target.closest?.("button, a, summary");
  if (popupsShown() && !anotherWindow()) {
    if (event.key === "Escape" && !event.defaultPrevented) closePopups();
    // With nothing to type into, Enter goes on to the next piece of the story.
    if (event.key === "Enter" && !typing && !pressable && popupNext()) {
      event.preventDefault();
      return;
    }
  }
  // The keys walk (public/move.js). With nothing else for them, Enter brings up the typing line, and a number picks
  // one of the story's choices.
  if (typing || !walkShown() || walk.fullStory || cannotWalk()) return;
  if (event.key === "Enter" && !pressable) {
    event.preventDefault();
    document.getElementById("composer")?.focus({ preventScroll: true });
  } else if (/^[1-9]$/.test(event.key) && app.pickOption(Number(event.key))) event.preventDefault();
}

// Space pauses the clock, and goes on again, unless a fight, a check, a raid or a talk is open, which use it themselves.
function pauseKey(event) {
  const g = app.ui.game;
  if (!walkShown() || !g.walk?.life || g.combat || g.check || g.fleet.raid || g.talk) return;
  event.preventDefault();
  walk.spaceTaken = true;
  toggleClock();
}
