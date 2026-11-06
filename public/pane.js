// A pane by someone's head: four corners, a tag with their name, the words on a dark pane, and a
// thin line down to the top of their head. The story's speech and talks both come up in one. It can
// be pulled aside with the mouse to see what's under it, and it slides back when it's let go.

import { el, lineAndDot, zoom } from "./dom.js";
import { SPRING_MS, makePullable, pulledBy } from "./pull.js";

// ---- Building one ---------------------------------------------------------

const cornerNodes = () => ["tl", "tr", "bl", "br"].map((corner) => el("span", { class: `pop-corner ${corner}`, "aria-hidden": "true" }));

// id and key say which pane this is and whose head it belongs over. tag is what goes on the tag,
// body what goes on the pane, and extras anything that hangs off it, like a talk's choices. onTap
// is what a plain click does, and opening makes it slide out from the head when it first appears.
// A console frame is the game's old console window instead of the corners and the tag: body brings
// its own bar.
export function paneNode({ id, key, color, tag, body, extras = [], more = false, opening = false, onTap = null, className = "", place = null, frame = "corners" }) {
  const node = el("div", {
    class: `pop-balloon${more ? " more" : ""}${opening ? " opening" : ""}${className ? ` ${className}` : ""}`,
    id,
    "data-key": key,
    ...(color ? { style: `--speaker:${color}` } : {}),
  },
  lineAndDot("pop-leader"),
  frame === "console" ? el("div", { class: "pop-pane pop-console" }, body) : el("div", { class: "pop-pane pop-speaker" }, cornerNodes(), el("div", { class: "pop-tag" }, tag), body),
  extras);
  // A pane that isn't one of the story's places itself, while it's pulled and while it slides back.
  node.place = place;
  return makePullable(node, { follow: (pane) => placeOf(pane)(), back: slideBack, tap: onTap });
}

// Puts a pane at its place in the room, plus however far it's being pulled aside, and draws its line to the head or the
// thing from where the pane really is, which while it slides back is somewhere on the way. room is the element its
// place is measured from, and to the point the line goes to, or null for none.
export function putPane(node, room, { left, top, wide, tall, side }, to) {
  node.placedAt = { left, top, wide, tall };
  const pulled = paneOffset(node);
  node.style.transform = `translate(${Math.round(left + pulled.x)}px, ${Math.round(top + pulled.y)}px)`;
  let at = { left: left + pulled.x, top: top + pulled.y };
  if (paneSpringing(node)) {
    const here = node.getBoundingClientRect();
    const there = room.getBoundingClientRect();
    at = { left: (here.left - there.left) / zoom(), top: (here.top - there.top) / zoom() };
  }
  if (to) drawLeader(node, { ...at, wide, tall, side }, to);
  node.classList.toggle("no-head", !to);
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
let placer = () => {};

// Whoever places the panes says how, and it's called again whenever one is pulled or let go.
export function panesPlacedBy(place) {
  placer = place;
}
const placeOf = (node) => node.place ?? placer;

// How far a pane has been pulled from its place, in the room's own measure.
export const paneOffset = (node) => pulledBy(node.id) ?? NONE;
export const paneSpringing = (node) => node.classList.contains("springing");

// Back to its place, with the line to the head following it there.
function slideBack(node) {
  const place = placeOf(node);
  place();
  const start = performance.now();
  const follow = (now) => {
    if (!node.isConnected) return;
    place();
    if (now - start < SPRING_MS) requestAnimationFrame(follow);
    else node.classList.remove("springing");
  };
  requestAnimationFrame(follow);
}
