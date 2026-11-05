// A pane by someone's head: four corners, a tag with their name, the words on a dark pane, and a
// thin line down to the top of their head. The story's speech and talks both come up in one. It can
// be pulled aside with the mouse to see what's under it, and it slides back when it's let go.

import { el } from "./dom.js";

// ---- Building one ---------------------------------------------------------

const cornerNodes = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

function leaderNode() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pop-leader");
  svg.setAttribute("aria-hidden", "true");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "2.5");
  svg.append(line, dot);
  return svg;
}

// id and key say which pane this is and whose head it belongs over. tag is what goes on the tag,
// body what goes on the pane, and extras anything that hangs off it, like a talk's choices. onTap
// is what a plain click does, and opening makes it slide out from the head when it first appears.
export function paneNode({ id, key, color, tag, body, extras = [], more = false, opening = false, onTap = null, className = "", place = null }) {
  const node = el("div", {
    class: `pop-balloon${more ? " more" : ""}${opening ? " opening" : ""}${className ? ` ${className}` : ""}`,
    id,
    "data-key": key,
    style: `--speaker:${color}`,
    onpointerdown: pressed,
    onpointermove: moved,
    onpointerup: released,
    onpointercancel: released,
  },
  leaderNode(),
  el("div", { class: "pop-pane pop-speaker" }, cornerNodes(), el("div", { class: "pop-tag" }, tag), body),
  extras);
  node.onTap = onTap;
  // A pane that isn't one of the story's places itself, while it's pulled and while it slides back.
  node.place = place;
  // A drag ends with a click the browser sends anyway, and that click mustn't open anything.
  node.addEventListener("click", (event) => {
    if (!node.dataset.swallow) return;
    delete node.dataset.swallow;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  return node;
}

// The line from the pane's corner nearest the head to the head, and where the pane slides out
// from when it opens. rect is where the pane is, in the room's own measure. The line leaves from
// the bottom corner when the pane is over the head, and from the top one when it's under the feet.
export function drawLeader(node, { left, top, wide, tall, side }, head) {
  const svg = node.querySelector(".pop-leader");
  const pane = node.querySelector(".pop-pane");
  if (!svg || !pane) return;
  const cx = side === "left" ? wide : 0;
  const cy = head.y < top ? 0 : head.y > top + tall ? tall : head.y - top < tall / 2 ? 0 : tall;
  const tx = head.x - left;
  const ty = head.y - top;
  const length = Math.hypot(tx - cx, ty - cy);
  svg.setAttribute("width", String(wide));
  svg.setAttribute("height", String(tall));
  const line = svg.querySelector("line");
  const dot = svg.querySelector("circle");
  line.setAttribute("x1", String(cx));
  line.setAttribute("y1", String(cy));
  line.setAttribute("x2", String(tx));
  line.setAttribute("y2", String(ty));
  line.style.strokeDasharray = String(length);
  line.style.setProperty("--len", String(length));
  dot.setAttribute("cx", String(tx));
  dot.setAttribute("cy", String(ty));
  pane.style.transformOrigin = `${cx}px ${cy}px`;
  pane.style.setProperty("--from-x", `${tx - cx}px`);
  pane.style.setProperty("--from-y", `${ty - cy}px`);
  node.dataset.side = side;
}

// ---- Pulling a pane aside -------------------------------------------------

const NONE = { x: 0, y: 0 };
const offsets = new Map();
const drag = { on: null, place: () => {} };

// Whoever places the panes says how, and it's called again whenever one is pulled or let go.
export function panesPlacedBy(place) {
  drag.place = place;
}

// How far a pane has been pulled from its place, in the room's own measure.
export const paneOffset = (node) => offsets.get(node.id) ?? NONE;
export const paneSpringing = (node) => node.classList.contains("springing");

// The screen's own measure, and the interface may be drawn bigger or smaller than that.
const zoom = () => Number(document.documentElement.style.zoom) || 1;

function pressed(event) {
  const node = event.currentTarget;
  if (event.button !== 0 || drag.on || event.target.closest("button, a, input, textarea, select, summary, details, [data-lore]")) return;
  drag.on = { node, x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
  node.classList.remove("springing");
  try {
    node.setPointerCapture(event.pointerId);
  } catch {
    // Some pointers can't be captured, and the pane still follows while it's over it.
  }
}

function moved(event) {
  const on = drag.on;
  if (!on || event.pointerId !== on.id || event.currentTarget !== on.node) return;
  const dx = (event.clientX - on.x) / zoom();
  const dy = (event.clientY - on.y) / zoom();
  // A hand that wobbles while clicking isn't pulling.
  if (!on.moved) {
    if (Math.hypot(dx, dy) < 4) return;
    on.moved = true;
    on.node.classList.add("dragging");
  }
  offsets.set(on.node.id, { x: dx, y: dy });
  (on.node.place ?? drag.place)();
}

function released(event) {
  const on = drag.on;
  if (!on || event.pointerId !== on.id) return;
  drag.on = null;
  const { node } = on;
  try {
    node.releasePointerCapture(on.id);
  } catch {
    // It wasn't captured.
  }
  if (!on.moved) {
    node.onTap?.(event);
    return;
  }
  node.classList.remove("dragging");
  node.dataset.swallow = "1";
  offsets.delete(node.id);
  // Back to its place, and the line to the head follows it there.
  node.classList.add("springing");
  const place = node.place ?? drag.place;
  place();
  const start = performance.now();
  const follow = (now) => {
    if (!node.isConnected) return;
    place();
    if (now - start < 360) requestAnimationFrame(follow);
    else node.classList.remove("springing");
  };
  requestAnimationFrame(follow);
}
