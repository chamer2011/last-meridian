// Small helpers shared by the game screens.

// How much bigger or smaller than the screen's own measure the interface is drawn, as Settings has it.
export const zoom = () => Number(document.documentElement.style.zoom) || 1;

// A thin line with a dot at its end, which the panes and the floating windows draw to what they're about.
export function lineAndDot(className) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  dot.setAttribute("r", "2.5");
  svg.append(document.createElementNS("http://www.w3.org/2000/svg", "line"), dot);
  return svg;
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "disabled" || key === "checked" || key === "selected") node[key] = Boolean(value);
    else if (key === "value") node.value = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

export async function api(route, body) {
  const res = await fetch(route, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// Reads a reply that arrives a line at a time, as the AI writes it.
export async function readLines(res, handle) {
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    lines.forEach(handle);
  }
  handle(buffer);
}

export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// An amount of dollars, the way you'd say it: 12¢, 6.3¢, 0.07¢ or $1.52.
export function money(dollars) {
  if (dollars >= 1) return `$${dollars.toFixed(2)}`;
  const cents = dollars * 100;
  return `${cents >= 10 ? Math.round(cents) : Number(cents.toFixed(cents < 1 ? 2 : 1))}¢`;
}

export function meter(label, value, max) {
  const share = Math.max(0, Math.min(1, value / max));
  const filled = Math.round(share * 10);
  return el("span", { class: `meter${share <= 0.25 ? " low" : ""}` },
    `${label} [${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${value}/${max}`);
}

// A part of a menu that folds away. Its heading is a line like [ + Orders ], or [ - Orders ] while it's open, and
// what's inside slides open or shut in place, without the menu redrawing. fold starts open and folded starts
// closed, and which ones are open is remembered while the game's open.
const folds = new Map();
function foldable(open, key, title, children) {
  const isOpen = folds.has(key) ? folds.get(key) : open;
  const body = el("div", { class: "fold-body" }, el("div", { class: "fold-inner" }, children));
  const toggle = el("button", { class: "fold-toggle", "aria-expanded": String(isOpen) }, `${isOpen ? "-" : "+"} ${title}`);
  const node = el("section", { class: `menu-section fold${isOpen ? " open" : ""}` }, toggle, body);
  body.inert = !isOpen;
  toggle.addEventListener("click", () => {
    const now = !node.classList.contains("open");
    folds.set(key, now);
    node.classList.toggle("open", now);
    toggle.setAttribute("aria-expanded", String(now));
    toggle.textContent = `${now ? "-" : "+"} ${title}`;
    body.inert = !now;
  });
  return node;
}
export const fold = (key, title, ...children) => foldable(true, key, title, children);
export const folded = (key, title, ...children) => foldable(false, key, title, children);

// Two columns of a menu's parts, the first half on the left and the rest on the right, which stack on a narrow
// page. Each column keeps to itself, so a part that opens or closes moves only what's under it.
export function columns(...children) {
  const items = children.flat(Infinity).filter((one) => one !== null && one !== undefined && one !== false);
  const half = Math.ceil(items.length / 2);
  return twoColumns(items.slice(0, half), items.slice(half));
}
// The same, with the page saying what goes left and what goes right.
export const twoColumns = (left, right) => el("div", { class: "menu-columns" }, el("div", { class: "menu-col" }, left), el("div", { class: "menu-col" }, right));

// For stress and fatigue, where high numbers are the bad ones.
export function strainMeter(label, value) {
  const filled = Math.round(Math.min(100, value) / 10);
  return el("span", { class: `meter${value >= 50 ? " low" : ""}` }, `${label} [${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${value}/100`);
}

// A belief shown as a line, with | at the center and # at its current value.
export function beliefBar(value, limit = 10) {
  let bar = "";
  for (let i = -limit; i <= limit; i += 1) bar += i === value ? "#" : i === 0 ? "|" : "-";
  return bar;
}
