// The walk-around view: each room is its own level, drawn in console art, with the story under it.
// The server keeps the levels and the captain's place in them. All of this is free: it never uses
// the AI. Where people live their own days, the clock runs while the player explores, and this page
// asks the server twice a second where everyone has got to.

import { api, el } from "./dom.js";
import { isoFrameNode } from "./iso.js";
import { closePopups, popsNode, popupDrawn, popupNext, popupPressed, popupReading, resetPopups } from "./popups.js";

const STEP_TIME = 28;
// Seen from an angle, you can see someone walk, so it's closer to a walking pace.
const ISO_STEP_TIME = { across: 55, along: 110 };
const TICK_TIME = 500;
// Nobody's watching after this long without a key or the mouse moving, so the clock waits for them.
const AWAY_AFTER = 120000;
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
// How fast the clock can run, in minutes of the game to each real minute.
const SPEEDS = {
  Normal: { rate: 10, title: "A day in the game takes about two and a half hours" },
  Fast: { rate: 60, title: "A day in the game takes about 24 minutes" },
  Faster: { rate: 300, title: "A day in the game takes about 5 minutes" },
};

const walk = { held: null, timer: null, sending: false, steps: [], message: null, thing: null, looked: false, plan: false, fullStory: false, shownLevel: null, marks: new Map(), listed: "", speed: "Normal", stopped: "start", ticking: false, lastInput: Date.now(), shownClock: "" };

// What the view needs from the main screen. Set once, when the page loads.
let app;

export function initWalk(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  for (const event of ["keydown", "pointerdown", "pointermove"]) {
    document.addEventListener(event, () => {
      walk.lastInput = Date.now();
    }, { passive: true });
  }
  setInterval(tick, TICK_TIME);
}

const isoShown = () => app.reading.view === "iso";
export const walkShown = () => (app.reading.view === "walk" || isoShown()) && Boolean(app.ui.game?.walk);
// The story goes over the room, unless the player would rather have it under the room.
export const popupsShown = () => walkShown() && isoShown() && app.reading.story !== "panel" && !walk.fullStory;

export function resetWalk() {
  stopWalking();
  Object.assign(walk, { held: null, sending: false, steps: [], message: null, thing: null, looked: false, plan: false, fullStory: false, shownLevel: null, stopped: "start" });
  resetPopups();
}

const anotherWindow = () => {
  const g = app.ui.game;
  return Boolean(g.combat || g.check || g.talk || g.fleet.raid || walk.thing || walk.plan);
};

// While the AI is writing or another window is up, the captain stays where they are.
function cannotWalk() {
  const { ui } = app;
  return ui.streaming || ui.waiting || anotherWindow();
}

const shownSpot = () => walk.held ?? app.ui.game.walk.captain;
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

function stopWalking() {
  clearInterval(walk.timer);
  walk.timer = null;
}

function walkAlong(path, done) {
  stopWalking();
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm || path.length < 2) {
    if (path.length) {
      walk.held = path.at(-1);
      placeCaptain(walk.held);
    }
    done();
    return;
  }
  let next = 0;
  const step = () => {
    walk.held = path[next];
    placeCaptain(walk.held);
    next += 1;
    if (next >= path.length) {
      stopWalking();
      done();
    } else if (isoShown()) walk.timer = setTimeout(step, path[next].y !== path[next - 1].y ? ISO_STEP_TIME.along : ISO_STEP_TIME.across);
  };
  step();
  if (!isoShown() && next < path.length) walk.timer = setInterval(step, STEP_TIME);
}

// Asks the server for the way, walks it, and then does whatever walking there was for.
async function go(body) {
  if (cannotWalk() || walk.sending) return;
  stopWalking();
  walk.sending = true;
  walk.message = null;
  if (walk.stopped === "start") walk.stopped = null;
  if (popupsShown()) closePopups();
  let reply;
  try {
    reply = await api("/api/walk", { ...body, from: shownSpot() });
  } catch (err) {
    walk.sending = false;
    walk.message = err.message;
    renderWalk();
    return;
  }
  walk.sending = false;
  walkAlong(reply.path, () => {
    walk.held = null;
    // In the same room, the people carry on from wherever they've got to since this reply was sent.
    const sameRoom = walk.shownLevel === reply.walk.here.id;
    const { people } = sameRoom && app.ui.game.walk.here.id === reply.walk.here.id ? app.ui.game.walk : reply.walk;
    app.ui.game.walk = { ...reply.walk, people };
    walk.message = reply.message;
    if (sameRoom && document.getElementById("walk-frame")) {
      placeCaptain(reply.walk.captain);
      drawHere();
    } else renderWalk();
    if (reply.arrived && reply.arrived.kind !== "exit") walk.steps = [];
    if (reply.arrived?.kind === "person") app.startTalk(reply.arrived.key);
    else if (reply.arrived?.kind === "thing") openThing(reply.arrived.key);
    else if (reply.arrived?.kind === "door") openDoor(reply.arrived.key);
    else if (!document.activeElement?.matches?.("input")) document.getElementById("composer")?.focus({ preventScroll: true });
    const next = walk.steps.shift();
    if (next) go({ action: "step", dx: next[0], dy: next[1] });
  });
}

function squareAt(event, view = app.ui.game.walk) {
  const box = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - box.left) / box.width) * view.cols),
    y: Math.floor(((event.clientY - box.top) / box.height) * view.lines),
  };
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

function thingMark(thing) {
  return el("button", {
    class: "walk-mark walk-thing",
    style: spotStyle(thing.x, thing.y),
    title: `${thing.name}. Click to walk over and take a look.`,
    "aria-label": `Walk over to ${thing.name}`,
    disabled: cannotWalk(),
    onclick: (event) => {
      event.stopPropagation();
      go({ action: "go", to: `thing:${thing.id}` });
    },
  }, "?");
}

function exitMark(exit) {
  const glyph = el("span", { class: "walk-exit-glyph" }, exit.glyph);
  return el("button", {
    class: `walk-mark walk-exit${exit.closed ? " closed" : ""}`,
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
    return el("div", { class: "walk-frame", id: "walk-frame" }, isoFrameNode({ view: () => app.ui.game?.walk ?? null, spot: shownSpot, blocked: cannotWalk, go, pressed: () => popupsShown() && popupPressed(), reading: () => popupsShown() && popupReading(), drawn: popupDrawn }));
  }
  const spot = shownSpot();
  // A level the captain has just walked into fades up.
  const arriving = walk.shownLevel !== null && walk.shownLevel !== view.here.id;
  walk.shownLevel = view.here.id;
  walk.marks = new Map();
  return el("div", { class: "walk-frame", id: "walk-frame" },
    el("div", {
      class: `walk-plan${cannotWalk() ? " waiting" : ""}${arriving ? " arriving" : ""}`,
      style: `--walk-cols:${view.cols};--walk-lines:${view.lines};${colorsOf(view.colors)}`,
      onclick: (event) => {
        const { x, y } = squareAt(event);
        go({ action: "go", x, y });
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
  const button = (text, to, props = {}) => el("button", { disabled: cannotWalk(), onclick: () => go({ action: "go", to }), ...props }, text);
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
    hereList("Things:", view.things.map((thing) => button(thing.name, `thing:${thing.id}`))),
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
    ? `${app.ui.game.walk.things.length ? "? something to look at   " : ""}Click the floor to walk, or click anyone or anything   The mouse wheel zooms`
    : `@ you   ${app.ui.game.walk.things.length ? "? something to look at   " : ""}Click the floor or use the arrow keys to walk`);
  return el("div", { class: `walk-view${isoShown() ? " iso" : ""}${popped ? " pops-on" : ""}`, id: "walk-view" },
    el("div", { class: "walk-map" },
      frameNode(),
      !popped && clockBar(),
      popped ? popsNode(composerNode, legend, clockBar()) : legend),
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
}

// ---- The clock ----------------------------------------------------------

// Why the clock's stopped, if there's a reason worth showing beside it.
function clockHeld() {
  const { ui } = app;
  if (ui.streaming || ui.waiting) return "The story's being written";
  if (walk.stopped === "paused") return "Paused";
  if (walk.stopped === "start") return "Walking starts the clock";
  if (Date.now() - walk.lastInput > AWAY_AFTER) return "Stopped until you're back";
  if (ui.draft.trim()) return "Stopped while you're typing";
  return null;
}

// Time stands still for anything with its own window, and when nobody's looking.
const clockCanRun = () => !clockHeld() && !cannotWalk() && !app.ui.sideOpen && document.visibilityState === "visible";

function setSpeed(name) {
  if (name) {
    walk.speed = name;
    walk.stopped = null;
  } else walk.stopped = "paused";
  drawClock();
}

function clockBar() {
  if (!app.ui.game.walk.life) return null;
  const why = clockHeld();
  walk.shownClock = `${app.ui.game.clock.label}|${why}|${walk.speed}`;
  const pick = (label, on, run, title = null) => el("button", { class: on ? "primary" : "", "aria-pressed": String(on), onclick: run, ...(title ? { title } : {}) }, label);
  return el("div", { class: "walk-clock small", id: "walk-clock" },
    el("span", { class: "walk-clock-time" }, app.ui.game.clock.label),
    pick("Pause", walk.stopped === "paused", () => setSpeed(null)),
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
      app.render();
      return;
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

async function tick() {
  const { ui } = app;
  if (ui.screen !== "game" || !ui.game || !walkShown() || walk.fullStory || !ui.game.walk.life) return;
  // A new scene waits to be read, so it takes a step or a speed button to get the clock going again.
  if ((ui.streaming || ui.waiting) && !walk.stopped) walk.stopped = "start";
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
  walk.thing = door ? { key, name: door.label, look: door.look, use: door.use, door: true } : null;
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
    if (reply.check) {
      // The door's check has its own window, and the answer comes with Continue the story.
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

function thingWindow(thing) {
  const written = app.ui.game.mode === "written" || Boolean(thing.written);
  const choices = [
    ...(thing.door || thing.done ? [] : [["Look", "free", () => {
      walk.looked = true;
      app.render();
    }]]),
    ...(thing.done ? [] : [[thing.door ? "Ask to go through" : "Use", thing.have ? "you're already carrying one" : written ? "free" : "this goes to the story, as your next action", useThing, thing.have]]),
    ["Close", "", closeWindow],
  ];
  return el("div", { class: "check-window walk-thing-window", "data-theme": "green", role: "dialog", "aria-label": thing.name, tabindex: "-1", id: "walk-window" },
    el("header", { class: "check-title" }, el("span", { class: "check-name" }, thing.name)),
    walk.looked && el("div", { class: "walk-thing-look" }, thing.look),
    el("div", { class: "options walk-thing-options" }, choices.map(([label, detail, run, disabled], i) => el("button", {
      "data-choice": String(i + 1),
      disabled,
      onclick: run,
    }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label), detail && el("span", { class: "option-detail" }, detail)))));
}

export function thingNode() {
  if (!thingOpen() || !app.ui.game?.walk) return null;
  return el("div", { class: "check-overlay", id: "walk-thing" }, walk.plan ? planWindow(app.ui.game.walk) : thingWindow(walk.thing));
}

export function focusThing() {
  document.getElementById("walk-window")?.focus({ preventScroll: true });
}

// ---- The keyboard -------------------------------------------------------

function onKey(event) {
  if (app.ui.screen !== "game" || !app.ui.game || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (thingOpen()) {
    if (event.key === "Escape") closeWindow();
    else if (walk.thing && /^[1-3]$/.test(event.key)) {
      event.preventDefault();
      document.querySelector(`#walk-thing [data-choice="${event.key}"]`)?.click();
    }
    return;
  }
  if (popupsShown() && !anotherWindow()) {
    if (event.key === "Escape" && !event.defaultPrevented) closePopups();
    // With nothing to type into, these go on to the next piece of the story.
    if ((event.key === " " || event.key === "Enter") && !event.target.matches?.("input, textarea, button, a, summary") && popupNext()) event.preventDefault();
  }
  const arrow = ARROWS[event.key];
  if (!arrow || !walkShown() || walk.fullStory || cannotWalk()) return;
  // In the middle of typing, the arrow keys belong to the typing.
  if (event.target.matches?.("input, textarea") && event.target.value) return;
  event.preventDefault();
  // A key pressed before the last step has finished still counts, up to a few.
  if (walk.sending || walk.timer) {
    if (walk.steps.length < 4) walk.steps.push(arrow);
    return;
  }
  go({ action: "step", dx: arrow[0], dy: arrow[1] });
}
