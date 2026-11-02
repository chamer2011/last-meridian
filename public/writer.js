// Writes what people say out a letter at a time, the way a console prints. The whole text is laid
// out from the start with the rest of it unseen, so the window it's in doesn't jump around.

import { el } from "./dom.js";

// In letters a second.
export const WRITING_SPEEDS = { slow: 22, normal: 45, fast: 90, instant: Infinity };

// Hides the words in a piece of the page. show(n) brings back the first n letters. Anything matching
// skip, like the name of whoever's speaking, is there from the start.
export function holdBack(container, { skip = null } = {}) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.data && !(skip && node.parentElement.closest(skip))) nodes.push(node);
  }
  const spots = nodes.map((node) => {
    const rest = el("span", { class: "unwritten" });
    node.after(rest);
    return { node, rest, full: node.data };
  });
  const cursor = el("span", { class: "write-cursor", "aria-hidden": "true" });
  return {
    total: spots.reduce((sum, spot) => sum + spot.full.length, 0),
    show(count) {
      let left = count;
      let placed = false;
      for (const spot of spots) {
        const shown = Math.max(0, Math.min(spot.full.length, left));
        left -= shown;
        if (spot.node.length !== shown) {
          spot.node.data = spot.full.slice(0, shown);
          spot.rest.textContent = spot.full.slice(shown);
        }
        if (!placed && shown < spot.full.length) {
          spot.rest.before(cursor);
          placed = true;
        }
      }
      if (!placed) cursor.remove();
      // In a long speech, the writing stays in view as it goes.
      const scroller = placed && cursor.closest(".pop-words, .talk-log");
      if (scroller) {
        const box = scroller.getBoundingClientRect();
        const past = cursor.getBoundingClientRect().bottom - box.bottom;
        if (past > 0) scroller.scrollTop += Math.ceil((past * scroller.clientHeight) / box.height) + 4;
      }
    },
  };
}

// Keeps count of how much has been written, and moves it on until it has caught up with the text.
// More text can arrive along the way, and then it just carries on.
export function newPen({ speed, draw }) {
  const pen = { written: 0, total: 0, timer: null, last: 0 };
  const stop = () => {
    clearInterval(pen.timer);
    pen.timer = null;
  };
  const tick = () => {
    const now = performance.now();
    pen.written = Math.min(pen.total, pen.written + (speed() * (now - pen.last)) / 1000);
    pen.last = now;
    draw(Math.floor(pen.written));
    if (pen.written >= pen.total) stop();
  };
  return {
    // How much there is to write now.
    aim(total) {
      pen.total = total;
      if (!Number.isFinite(speed())) pen.written = total;
      pen.written = Math.min(pen.written, total);
      draw(Math.floor(pen.written));
      if (pen.written < total && !pen.timer) {
        pen.last = performance.now();
        pen.timer = setInterval(tick, 30);
      } else if (pen.written >= total) stop();
    },
    // Starts again from the beginning, or from the end of it, for something that's already been read.
    start(atTheEnd = false) {
      stop();
      pen.written = atTheEnd ? Infinity : 0;
      pen.total = 0;
    },
    finish() {
      pen.written = pen.total;
      draw(pen.total);
      stop();
    },
    get busy() {
      return pen.written < pen.total;
    },
    stop,
  };
}
