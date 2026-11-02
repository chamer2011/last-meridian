// Small helpers shared by the game screens.

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
