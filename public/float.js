// The windows that float over the room, the skill check's and the computer's: pulled aside with the mouse they follow
// it, and let go they slide back, the way the panes in the room do; and a thin line runs from each to whatever it's
// about in the room, a part, a door, a person or a console, the way the panes point at their people and things.

import { lineAndDot, zoom } from "./dom.js";
import { SPRING_MS, makePullable, pulledBy } from "./pull.js";

// Where something is on the screen, and how to keep it clear of a window, from the walk view, which knows the room. Set
// once, when the page loads.
let markPoint = () => null;
let keepClear = () => {};
export function aimWith(finder, clearer = () => {}) {
  markPoint = finder;
  keepClear = clearer;
}

// ---- Pulling a window aside -----------------------------------------------------------------

// The window moves by a transform while it's pulled, and slides back by the transform going. A redraw in the middle of
// a pull carries on from where it was.
export function pullable(node) {
  makePullable(node, {
    follow: (win, dx, dy) => {
      win.style.transform = `translate(${dx}px, ${dy}px)`;
      aimLeaders();
    },
    back: (win) => {
      win.style.transform = "";
      setTimeout(() => win.classList.remove("springing"), SPRING_MS);
    },
  });
  const pulled = pulledBy(node.id);
  if (pulled) node.style.transform = `translate(${pulled.x}px, ${pulled.y}px)`;
  return node;
}

// ---- The line to what it's about ----------------------------------------------------------------

// A line from the window's corner nearest the thing to a dot on the thing, in the window's colour. It's drawn again
// every frame while there's one to draw, so it follows the thing as people walk and the view moves, and the window as
// it's pulled aside and slides back. Nothing's drawn when the thing isn't in view, or is under the window.
export function leaderNode(target) {
  if (!target) return null;
  const svg = lineAndDot("float-leader");
  svg.dataset.target = target;
  startAiming();
  return svg;
}

let aiming = false;
function startAiming() {
  if (aiming) return;
  aiming = true;
  const frame = () => {
    if (!document.querySelector(".float-leader")) {
      aiming = false;
      keepClear(null);
      return;
    }
    aimLeaders();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

export function aimLeaders() {
  let kept = false;
  for (const svg of document.querySelectorAll(".float-leader")) {
    const layer = svg.parentElement;
    const win = layer?.querySelector(".check-window");
    // Where the window rests, not where it's been pulled to: the room keeps the thing clear of that.
    if (win && !kept) {
      const base = layer.getBoundingClientRect();
      const z = zoom();
      keepClear(svg.dataset.target, { left: base.left + win.offsetLeft * z, top: base.top + win.offsetTop * z, right: base.left + (win.offsetLeft + win.offsetWidth) * z, bottom: base.top + (win.offsetTop + win.offsetHeight) * z });
      kept = true;
    }
    const point = win ? markPoint(svg.dataset.target) : null;
    if (!point) {
      svg.classList.remove("shown");
      continue;
    }
    const z = zoom();
    const base = layer.getBoundingClientRect();
    const box = win.getBoundingClientRect();
    // In the layer's own measure.
    const p = { x: (point.x - base.left) / z, y: (point.y - base.top) / z };
    const r = { left: (box.left - base.left) / z, top: (box.top - base.top) / z, right: (box.right - base.left) / z, bottom: (box.bottom - base.top) / z };
    if (p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom) {
      svg.classList.remove("shown");
      continue;
    }
    const cx = p.x < (r.left + r.right) / 2 ? r.left : r.right;
    const cy = p.y < r.top ? r.top : p.y > r.bottom ? r.bottom : p.y - r.top < (r.bottom - r.top) / 2 ? r.top : r.bottom;
    const [line, dot] = svg.children;
    line.setAttribute("x1", String(cx));
    line.setAttribute("y1", String(cy));
    line.setAttribute("x2", String(p.x));
    line.setAttribute("y2", String(p.y));
    dot.setAttribute("cx", String(p.x));
    dot.setAttribute("cy", String(p.y));
    svg.style.setProperty("--c", getComputedStyle(win).getPropertyValue("--c"));
    svg.classList.add("shown");
  }
}
