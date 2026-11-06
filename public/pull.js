// Pulling something aside with the mouse, for a look at what's under it: the panes by people's heads and by things, and
// the check and computer windows that float over the room. It follows the mouse once it's moved a few pixels, so a
// plain click is still a click; let go, it slides back; and the click the browser sends at the end of a pull presses
// nothing. Whoever uses it says what following and sliding back mean for what they've drawn.

import { zoom } from "./dom.js";

// Taking hold anywhere but these, which are for clicking.
const NOT_FOR_PULLING = "button, a, input, textarea, select, label, summary, details, [data-lore]";
// A hand that wobbles while clicking isn't pulling.
const WOBBLE = 4;
// How long sliding back takes, as the stylesheet's .pullable.springing has it.
export const SPRING_MS = 360;

// The pull under way, kept by the node's id rather than on the node, so a redraw in the middle of it carries on.
let active = null;

// How far the node with this id is being pulled right now, in the page's own measure, or null when it isn't.
export const pulledBy = (id) => (active?.id === id && active.moved ? { x: active.dx, y: active.dy } : null);

// Makes a node, which needs an id, pullable. follow(node, dx, dy) moves it with the mouse, back(node) sends it home
// once it's let go, and tap(event) is what a plain click on it does, if anything.
export function makePullable(node, { follow, back, tap = null }) {
  node.classList.add("pullable");
  node.addEventListener("pointerdown", (event) => press(event, node.id, { follow, back, tap }));
  node.addEventListener("click", (event) => {
    if (!node.dataset.swallow) return;
    delete node.dataset.swallow;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  const pulled = pulledBy(node.id);
  if (pulled) node.classList.add("dragging");
  return node;
}

function press(event, id, hooks) {
  if (event.button !== 0 || active || event.target.closest(NOT_FOR_PULLING)) return;
  // No text gets selected by a pull, and the keyboard stays where it was.
  event.preventDefault();
  active = { id, hooks, x: event.clientX, y: event.clientY, pointer: event.pointerId, moved: false, dx: 0, dy: 0 };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);
}

function move(event) {
  if (!active || event.pointerId !== active.pointer) return;
  const dx = (event.clientX - active.x) / zoom();
  const dy = (event.clientY - active.y) / zoom();
  if (!active.moved) {
    if (Math.hypot(dx, dy) < WOBBLE) return;
    active.moved = true;
  }
  active.dx = dx;
  active.dy = dy;
  const node = document.getElementById(active.id);
  if (!node) return;
  node.classList.remove("springing");
  node.classList.add("dragging");
  active.hooks.follow(node, dx, dy);
}

function release(event) {
  if (!active || event.pointerId !== active.pointer) return;
  const was = active;
  active = null;
  document.removeEventListener("pointermove", move);
  document.removeEventListener("pointerup", release);
  document.removeEventListener("pointercancel", release);
  if (!was.moved) {
    if (event.type === "pointerup") was.hooks.tap?.(event);
    return;
  }
  const node = document.getElementById(was.id);
  if (!node) return;
  // The click the browser sends at the end of the pull presses nothing, and one that never comes doesn't eat the next.
  node.dataset.swallow = "1";
  setTimeout(() => delete node.dataset.swallow, 60);
  node.classList.remove("dragging");
  node.classList.add("springing");
  was.hooks.back(node);
}
