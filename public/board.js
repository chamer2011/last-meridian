// The story board: every story, place, person and species as boxes and arrows, to read and change, and saved to
// its file in world/. Everything is done by clicking: words open in a box on the right, conditions are picked from
// lists, names are made from the words. The board is drawn again from the file's contents each time something
// changes, and the file is written by the same readers the game uses (public/story-text.js and
// public/world-text.js), so what's saved is what plays. A story's written scene, and a person's written lines,
// are shown the same way: parts, and the choices between them.

import { el } from "./dom.js";
import { writeStoryText } from "./story-text.js";
import { LINE_PHRASES, PERK_NUMBERS, SPECS, writeWorldText } from "./world-text.js";

const state = {
  kind: "story", id: null, lists: {},
  stories: [], items: [], story: null, clock: null, next: [], written: false, places: [], facts: [], all: [],
  item: null, links: {},
  problems: [], tab: "notes", selected: null, expanded: null, zoom: 1, dirty: false,
  scene: null, scenePrefix: "thread", sceneDirty: false, positions: {}, layoutKey: null, layoutTimer: null,
};
let nodes = [];
let wires = [];
const $ = (id) => document.getElementById(id);
const spaced = (id) => String(id ?? "").replaceAll("_", " ");
const fill = (parent, ...children) => { for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) parent.append(child); return parent; };
const STOP = new Set("if the they she he it you someone anyone a an and or of is are that this their them its in on at for as has have then when there".split(" "));
const KIND_WORDS = { story: "The story", place: "The place", person: "The person", species: "The species", enemy: "The enemy", item: "The item", faction: "The faction", perk: "The perk" };
const FOLDERS = { story: "stories", person: "characters", place: "places", species: "species", enemy: "enemies", item: "items", faction: "factions", perk: "perks" };

// A name made from words, for an ending or a fact, so nobody has to type one.
export function nameFrom(text) {
  const words = String(text ?? "").toLowerCase().replace(/'/g, "").split(/[^a-z0-9]+/).filter((word) => word && !STOP.has(word)).slice(0, 5).join("_").slice(0, 40).replace(/_+$/, "");
  return /^[a-z]/.test(words) && words.length >= 2 ? words : "new_name";
}
const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  if (value === undefined) delete holder[keys.at(-1)];
  else holder[keys.at(-1)] = value;
}

// ---- Conditions, in words ---------------------------------------------------------
function parseCondition(text) {
  return String(text ?? "").split(/\s+and\s+/i).filter((one) => one.trim()).map((raw) => {
    const words = raw.trim().split(/\s+/);
    const not = words[0]?.toLowerCase() === "not";
    if (not) words.shift();
    const [kind, ...rest] = words;
    return { not, kind: kind?.toLowerCase(), rest, raw: raw.trim() };
  });
}
const storyTitle = (id) => state.all.find((one) => one.id === id)?.title ?? id;
function conditionWords(text) {
  if (!text) return "always";
  return parseCondition(text).map((term) => {
    const no = term.not ? "unless " : "if ";
    if (term.kind === "ended") return `${no}${storyTitle(term.rest[0])} ended${term.rest[1] ? `: ${spaced(term.rest[1])}` : ""}`;
    if (term.kind === "flag") return `${no}${spaced(term.rest[0])}`;
    if (term.kind === "captain") return `${no}the player is the captain`;
    return `${no}${term.raw}`;
  }).join(" and ");
}
const firstTerm = (text) => parseCondition(text)[0] ?? null;

// ---- Talking to the game -----------------------------------------------------------
async function call(route, body) {
  const response = await fetch(route, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error ?? "Something went wrong.");
  return data;
}

// ---- Opening and closing ---------------------------------------------------------------
export async function openBoard() {
  if ($("board")) return;
  document.body.append(boardNode());
  // For the browser checks, which look at the board's state from outside.
  window.__board = state;
  try {
    state.stories = (await call("/api/board/stories")).stories;
    await load(state.kind, state.id ?? state.stories.find((one) => one.id === "main_two_weeks_of_fuel")?.id ?? state.stories.find((one) => one.kind === "main")?.id ?? state.stories[0]?.id);
  } catch (err) {
    say(err.message, false);
  }
}
export function closeBoard() {
  if (state.dirty || state.sceneDirty) {
    say("There are changes that aren't saved. Save them, or Close again to lose them.", false);
    state.dirty = false;
    state.sceneDirty = false;
    return;
  }
  $("board")?.remove();
  document.removeEventListener("keydown", onKey);
}
function onKey(event) {
  if (event.key === "Escape" && $("board") && !event.target.closest("textarea, input, select")) closeBoard();
}

function boardNode() {
  document.addEventListener("keydown", onKey);
  return el("div", { class: "board", id: "board", role: "dialog", "aria-label": "Story board" },
    el("header", { class: "board-head" },
      el("h2", {}, "Story board"),
      el("select", { id: "board-what", title: "Stories, places, people or species", onchange: (event) => changeKind(event.target.value) },
        ...[["story", "Stories"], ["place", "Places"], ["person", "People"], ["species", "Species"], ["enemy", "Enemies"], ["item", "Items"], ["faction", "Factions"], ["perk", "Perks"]].map(([kind, label]) => el("option", { value: kind }, label))),
      el("select", { id: "board-pick", title: "Which one", onchange: (event) => load(state.kind, event.target.value) }),
      el("nav", { class: "board-tabs", role: "tablist" },
        ...[["notes", "The story"], ["scene", "The written scene"], ["file", "As the file"]].map(([tab, label]) => el("button", { class: "board-tab", role: "tab", "data-tab": tab, "aria-selected": "false", onclick: () => showTab(tab) }, label))),
      el("span", { class: "board-status", id: "board-status" }),
      el("button", { class: "board-save", id: "board-save", onclick: save }, "Save"),
      el("button", { class: "board-close", onclick: closeBoard, title: "Or press Esc" }, "Close")),
    el("div", { class: "board-main" },
      el("section", { class: "board-wrap" },
        el("div", { class: "board-scroll", id: "board-scroll" }, el("div", { class: "board-canvas", id: "board-canvas" }, svg("svg", { class: "board-wires", id: "board-wires" }))),
        el("pre", { class: "board-text", id: "board-text", hidden: "" }),
        el("div", { class: "board-tools", id: "board-tools" },
          el("button", { onclick: () => zoomBy(-0.1), title: "Smaller" }, "−"),
          el("button", { onclick: () => zoomBy(0.1), title: "Bigger" }, "+"),
          el("button", { onclick: fit }, "Fit"),
          el("button", { onclick: tidy, title: "Puts every box back in its column, and forgets where they were moved" }, "Tidy up"))),
      el("aside", { class: "board-inspector", id: "board-inspector" })),
    el("footer", { class: "board-foot" },
      el("span", {}, "Click a box to read and change it."),
      el("span", {}, "Drag a box to move it."),
      el("span", {}, "Click the words on an arrow to change when it applies."),
      el("span", {}, "Drop a box on another to link them."),
      el("span", {}, "Drag the dark background to look around.")));
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function say(text, ok = true) {
  const status = $("board-status");
  if (!status) return;
  status.textContent = text ?? "";
  status.className = `board-status ${ok ? "ok" : "fail"}`;
}
const unsaved = () => {
  if (!(state.dirty || state.sceneDirty)) return false;
  if (state.leaving) { state.leaving = false; return false; }
  state.leaving = true;
  say("There are changes that aren't saved. Save them, or pick again to lose them.", false);
  return true;
};

async function changeKind(kind) {
  if (unsaved()) { $("board-what").value = state.kind; return; }
  const items = kind === "story" ? state.stories : (await call(`/api/board/world/${kind}`)).items;
  state.items = items;
  state.itemsKind = kind;
  await load(kind, items[0]?.id);
}

// Loads one story, place, person or species onto the board.
async function load(kind, id) {
  if (!id) return;
  if (unsaved()) { $("board-pick").value = state.id; return; }
  state.leaving = false;
  if (kind === "story") {
    const data = await call(`/api/board/story/${id}`);
    Object.assign(state, { kind, id, story: data.story, clock: data.clock, next: data.next, written: data.written, places: data.places, facts: data.facts, all: data.stories, lists: data.lists, problems: data.problems, item: null, links: {}, scenePrefix: "thread", layoutKey: `story/${id}`, layout: data.layout ?? {} });
    state.items = state.stories;
    state.itemsKind = "story";
  } else {
    const data = await call(`/api/board/world/${kind}/${id}`);
    Object.assign(state, { kind, id, item: data.value, links: data.links, lists: data.lists, problems: data.problems, written: Boolean(data.links.written), story: null, clock: null, next: [], scenePrefix: "talk", layoutKey: `${kind}/${id}`, layout: data.layout ?? {} });
    // The list at the top is of the kind shown, which a link from another board may have changed.
    if (state.itemsKind !== kind) {
      state.items = (await call(`/api/board/world/${kind}`)).items;
      state.itemsKind = kind;
    }
  }
  Object.assign(state, { selected: null, expanded: null, dirty: false, sceneDirty: false, scene: null, positions: state.layout });
  $("board-what").value = kind;
  const pick = $("board-pick");
  const groups = kind === "story" ? ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"] : [...new Set(state.items.map((one) => one.kind))];
  pick.replaceChildren(...groups.map((group) => {
    const box = el("optgroup", { label: group });
    for (const one of state.items.filter((item) => item.kind === group)) box.append(el("option", { value: one.id, selected: one.id === id ? "selected" : null }, `${one.title ?? one.name}${one.written ? " ✓" : ""}`));
    return box;
  }).filter((box) => box.children.length));
  pick.value = id;
  for (const button of document.querySelectorAll(".board-tab")) {
    if (button.dataset.tab === "notes") button.textContent = KIND_WORDS[kind];
    if (button.dataset.tab === "scene") { button.textContent = kind === "person" ? "The written lines" : "The written scene"; button.hidden = !["story", "person"].includes(kind); }
  }
  showTab(state.tab === "scene" && !state.written ? "notes" : state.tab);
  say(state.problems.length ? `${state.problems.length} ${state.problems.length === 1 ? "thing" : "things"} the checker would like changed. They're marked in red.` : "");
}

// ---- The boxes and arrows, from the story -------------------------------------------------
const S = () => state.story;
const C = () => state.clock;
const endingIds = () => S().gm.outcomes.map((one) => one.id);
const endNode = (ending) => (ending && endingIds().includes(ending) ? `end_${ending}` : "lead");
const UNFOLDS = ["fact", "consequence", "next"];

function notesGraph() {
  const story = S(), clock = C();
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: story.title, text: `${story.kind}. ${story.places.join(", ")}.${story.after ? ` After ${storyTitle(story.after)}.` : ""}`, label: "About this story" });
  (story.gm.reacts ?? []).forEach((one, i) => {
    add({ id: `react${i}`, kind: "react", col: 0, name: conditionWords(one.to), text: one.then, label: "The record changes this", cond: one.to, bind: { react: i } });
    ws.push({ from: `react${i}`, to: "lead", kind: "cond" });
  });
  add({ id: "lead", kind: "lead", col: 1, name: "The lead", text: story.lead, label: "What the player hears", bind: { text: "lead" } });
  if (story.anyone !== undefined) add({ id: "anyone", kind: "truth", col: 1, name: "For anyone who isn't the captain", text: story.anyone, label: "The lead, for others", bind: { text: "anyone" } });
  add({ id: "truth", kind: "truth", col: 1, name: "What's really going on", text: story.gm.truth, label: "For the game master only", bind: { gm: "truth" } });
  ws.push({ from: "lead", to: "truth" });
  story.gm.beats.forEach((beat, i) => {
    add({ id: `beat${i}`, kind: "beat", col: 1, name: `How it might go, ${i + 1}`, text: beat, label: "A beat", bind: { list: "beats", i } });
    ws.push({ from: i ? `beat${i - 1}` : "truth", to: `beat${i}` });
  });
  add({ id: "ways", kind: "route", col: 2, name: "Ways through", text: story.gm.routes.join("\n"), label: `${story.gm.routes.length} ways`, bind: { lines: "routes" } });
  ws.push({ from: "lead", to: "ways" });
  add({ id: "checks", kind: "route", col: 2, name: "Checks and fights", text: [...story.gm.checks, ...story.gm.fights].join("\n"), label: "What the dice decide", bind: { checks: true } });
  add({ id: "rewards", kind: "truth", col: 2, name: "Rewards", text: story.gm.rewards, label: "What the player gets", bind: { gm: "rewards" } });
  story.gm.outcomes.forEach((one, i) => {
    add({ id: `end_${one.id}`, kind: "ending", col: 3, name: spaced(one.id), text: one.text, label: "An ending", ending: one.id, bind: { outcome: i } });
    ws.push({ from: "ways", to: `end_${one.id}` });
  });
  for (const [name, line] of Object.entries(story.gm.facts ?? {})) {
    add({ id: `fact_${name}`, kind: "fact", col: 4, name: spaced(name), text: line, label: "A fact it leaves", fact: name });
    ws.push({ from: endNode(story.gm.factAfter?.[name]), to: `fact_${name}` });
  }
  (clock.consequences ?? []).forEach((one, i) => {
    add({ id: `cons${i}`, kind: "consequence", col: 4, name: `${one.after} days later`, text: one.news, label: "A consequence", cond: one.of, bind: { cons: i } });
    const term = firstTerm(one.of);
    ws.push({ from: term?.kind === "ended" && !term.not ? endNode(term.rest[1]) : "lead", to: `cons${i}`, kind: "timer" });
    for (const name of Object.keys(one.facts ?? {})) if (list.some((node) => node.id === `fact_${name}`)) ws.push({ from: `cons${i}`, to: `fact_${name}`, kind: "timer" });
  });
  state.next.forEach((one, i) => {
    add({ id: `next${i}`, kind: "next", col: 4, name: `${one.title} (${one.where})`, text: one.then, label: "Another story reacts", cond: one.to, story: one.story });
    const term = firstTerm(one.to);
    ws.push({ from: term?.kind === "ended" && !term.not ? endNode(term.rest[1]) : "lead", to: `next${i}`, kind: "cond" });
  });
  clock.stages.forEach((stage, i) => {
    add({ id: `stage${i}`, kind: "clock", col: 1 + i, row: "clock", name: `Day ${stage.after}, if nobody steps in`, text: stage.news, label: "The clock", cond: stage.if ?? null, bind: { stage: i } });
    ws.push({ from: i ? `stage${i - 1}` : "lead", to: `stage${i}`, words: i ? (stage.if ? conditionWords(stage.if) : "then") : "if nobody steps in", kind: stage.if ? "cond" : "timer", stage: i });
  });
  return { list, ws };
}

// ---- The boxes and arrows, from a place, a person or a species --------------------------------
const linkNode = (id, kind, name, text, label) => ({ id, kind: "link", col: 4, name, text, label, link: { kind, id: id.replace(/^link_[a-z]+_/, "") }, linkKind: kind });
function placeGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.faction ? `Held by ${P.faction}. ` : ""}${P.aliases?.length ? `Also called ${P.aliases.join(", ")}. ` : ""}${[P.fleet && "the fleet is here", P.rest && "a place to rest", P.dangerous && "dangerous", P.hidden && "hidden"].filter(Boolean).join(", ")}`, label: "About this place" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player sees", bind: { path: "desc" } });
  add({ id: "feel", kind: "truth", col: 1, name: "The feel of it", text: P.gm?.feel ?? "", label: "For the game master", bind: { path: "gm.feel" } });
  ws.push({ from: "desc", to: "feel" });
  (P.gm?.districts ?? []).forEach((one, i) => {
    add({ id: `district${i}`, kind: "beat", col: 2, name: one.name, text: one.desc, label: "A district", bind: { district: i } });
    ws.push({ from: "desc", to: `district${i}` });
  });
  for (const [key, path, label] of [["complications", "gm.complications", "Complications"], ["secrets", "gm.secrets", "Secrets"], ["encounters", "encounters", "Encounters"], ["rumors", "rumors", "Rumors"]]) {
    const items = get(P, path) ?? [];
    add({ id: key, kind: "route", col: 3, name: `${label} (${items.length})`, text: items.join("\n"), label: key === "rumors" ? "What people say" : key === "encounters" ? "What can happen" : "For the game master", bind: { items: path } });
    ws.push({ from: "feel", to: key });
  }
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "Someone here")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story set here.", "A story here")); ws.push({ from: "desc", to: `link_story_${one.id}` }); }
  return { list, ws };
}
function personGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: [P.title, P.name].filter(Boolean).join(" "), text: `${P.role ?? ""}. ${P.pronouns ?? ""}${P.species ? `, ${P.species}` : ""}${P.age ? `, ${P.age}` : ""}. ${P.faction ? `${P.faction}. ` : ""}${P.crew ? "Crew. " : ""}`, label: "About this person" });
  add({ id: "note", kind: "lead", col: 1, name: "In a line", text: P.note ?? "", label: "How the game sees them", bind: { path: "note" } });
  for (const [key, label] of [["appearance", "Appearance"], ["personality", "Personality"], ["voice", "Voice"], ["goals", "Goals"], ["secrets", "Secrets"]]) {
    add({ id: key, kind: "truth", col: 1, name: label, text: P[key] ?? "", label: key === "secrets" ? "For the game master only" : "For the game master", bind: { path: key } });
    ws.push({ from: "note", to: key });
  }
  add({ id: "numbers", kind: "route", col: 2, name: "Their numbers", text: ["beliefs", "attributes", "skills"].map((key) => `${key}: ${Object.entries(P[key] ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "none"}`).join("\n"), label: "Beliefs, attributes and skills", bind: { numbers: true } });
  ws.push({ from: "note", to: "numbers" });
  const c = P.combat ?? {};
  add({ id: "fight", kind: "ending", col: 2, name: "In a fight", text: `threat ${c.threat ?? 0}, hp ${c.hp ?? 0}, attack ${c.attack ?? 0}, defense ${c.defense ?? 0}${c.weapon ? `, ${c.weapon}` : ""}${c.lines ? `. ${Object.values(c.lines).flat().length} lines.` : ""}`, label: "What the dice decide", bind: { fight: true } });
  ws.push({ from: "note", to: "fight" });
  if (L.place) { add(linkNode(`link_place_${L.place.id}`, "place", L.place.name, "Where they are.", "Their place")); ws.push({ from: "note", to: `link_place_${L.place.id}` }); }
  if (L.species) { add(linkNode(`link_species_${L.species.id}`, "species", L.species.name, "What they are.", "Their species")); ws.push({ from: "note", to: `link_species_${L.species.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story they're in.", "A story")); ws.push({ from: "note", to: `link_story_${one.id}` }); }
  add({ id: "lines", kind: L.written ? "fact" : "stub", col: 4, name: "Written lines", text: L.written ? "What they say in a talk, written out. Open the tab to see and change it." : "Not written yet: the AI, or the stock lines, speak for them.", label: "Talking", lines: true });
  ws.push({ from: "note", to: "lines" });
  return { list, ws };
}
function speciesGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `Shown ${P.order ?? "?"}${P.order === 1 ? "st" : P.order === 2 ? "nd" : P.order === 3 ? "rd" : "th"} in the character creator.${P.bonusAttrPoints ? ` ${P.bonusAttrPoints} extra attribute points.` : ""}${P.bonusTraitPoints ? ` ${P.bonusTraitPoints} extra trait points.` : ""}${P.agelessTerms ? ` Ages after ${P.agelessTerms} terms.` : ""}`, label: "About this species" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  add({ id: "gm", kind: "truth", col: 1, name: "For the game master", text: P.gm ?? "", label: "How to play them", bind: { path: "gm" } });
  ws.push({ from: "desc", to: "gm" });
  const fx = P.fx ?? {};
  add({ id: "numbers", kind: "route", col: 2, name: "Their numbers", text: [["attrs", "attributes"], ["attrCaps", "caps"], ["skills", "skills"]].map(([key, label]) => `${label}: ${Object.entries(P[key] ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "none"}`).join("\n"), label: "Attributes and skills", bind: { speciesNumbers: true } });
  ws.push({ from: "desc", to: "numbers" });
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(fx).map(([key, value]) => `${spaced(key)}: ${typeof value === "object" ? Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ") : value}`).join("\n") || "none", label: "What's different for them", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "One of them")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  return { list, ws };
}

function enemyGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `threat ${P.threat ?? 0}, hp ${P.hp ?? 0}, attack ${P.attack ?? 0}, defense ${P.defense ?? 0}${P.weapon ? `, ${P.weapon}` : ""}${P.motive ? `. Fights for ${P.motive}.` : ""}${P.boss ? " A boss." : ""}${P.machine ? " A machine." : ""}`, label: "About this enemy" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player sees", bind: { path: "desc" } });
  add({ id: "lines", kind: "route", col: 2, name: "What they say", text: LINE_PHRASES.filter(([key]) => P.lines?.[key]?.length).map(([key, phrase]) => `${phrase}: ${P.lines[key].length}`).join("\n") || "No lines yet.", label: "In a fight", bind: { enemyLines: true } });
  ws.push({ from: "desc", to: "lines" });
  if (L.faction) { add(linkNode(`link_faction_${L.faction.id}`, "faction", L.faction.name, "Who they fight for.", "Their faction")); ws.push({ from: "desc", to: `link_faction_${L.faction.id}` }); }
  for (const one of L.places ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Where they turn up.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  return { list, ws };
}
function itemGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.type ?? "an item"}, ${P.price ?? 0} credits.${P.damage ? ` ${P.damage[0]} to ${P.damage[1]} damage, ${P.stat ?? ""} and ${P.skill ?? ""}.` : ""}${P.defense ? ` Defense ${P.defense}.` : ""}${P.effect ? ` ${Object.entries(P.effect).map(([k, v]) => `${k} ${v}`).join(", ")}.` : ""}${P.restricted ? " Restricted." : ""}`, label: "About this item" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(P.fx ?? {}).map(([key, value]) => `${spaced(key)}: ${Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ")}`).join("\n") || "none", label: "While it's worn or carried", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  for (const one of L.sold ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Sold here.", "A market")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  for (const one of L.found ?? []) if (!list.some((node) => node.id === `link_place_${one.id}`)) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Can turn up here.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  return { list, ws };
}
function factionGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.aliases?.length ? `Also called ${P.aliases.join(", ")}. ` : ""}A new captain starts at ${P.start ?? 0} with them.`, label: "About this faction" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  add({ id: "beliefs", kind: "route", col: 2, name: "What they believe", text: Object.entries(P.beliefs ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ") || "nothing in particular", label: "Beliefs", bind: { beliefs: true } });
  ws.push({ from: "desc", to: "beliefs" });
  for (const one of L.people ?? []) { add(linkNode(`link_person_${one.id}`, "person", one.name, one.role, "One of theirs")); ws.push({ from: "desc", to: `link_person_${one.id}` }); }
  for (const one of L.places ?? []) { add(linkNode(`link_place_${one.id}`, "place", one.name, "Held by them.", "A place")); ws.push({ from: "desc", to: `link_place_${one.id}` }); }
  for (const one of L.enemies ?? []) { add(linkNode(`link_enemy_${one.id}`, "enemy", one.name, "Fights for them.", "An enemy")); ws.push({ from: "desc", to: `link_enemy_${one.id}` }); }
  for (const one of L.stories ?? []) { add(linkNode(`link_story_${one.id}`, "story", one.title, "A story they're in.", "A story")); ws.push({ from: "desc", to: `link_story_${one.id}` }); }
  return { list, ws };
}

function perkGraph() {
  const P = state.item, L = state.links;
  const list = [], ws = [];
  const add = (node) => { list.push(node); return node.id; };
  const needs = [...Object.entries(P.requiresSkill ?? {}).map(([name, amount]) => `${spaced(name)} ${amount}`), ...Object.entries(P.requiresStat ?? {}).map(([name, amount]) => `${spaced(name)} ${amount}`)];
  add({ id: "about", kind: "about", col: 0, name: P.name, text: `${P.starting ? "A starting perk, from a career. " : ""}${needs.length ? `Needs ${needs.join(", ")}. ` : ""}${L.needs ? `Needs ${L.needs.name} first. ` : ""}${L.ability ? `Gives the ability ${L.ability.name}.` : ""}`, label: "About this perk" });
  add({ id: "desc", kind: "lead", col: 1, name: "In a line", text: P.desc ?? "", label: "What the player reads", bind: { path: "desc" } });
  const fx = P.fx ?? {};
  add({ id: "effects", kind: "ending", col: 2, name: "Effects", text: Object.entries(fx).map(([key, value]) => `${PERK_NUMBERS.find(([path]) => path === key)?.[1] ?? spaced(key)}: ${typeof value === "object" ? Object.entries(value).map(([name, amount]) => `${name} ${amount}`).join(", ") : value}`).join("\n") || "none", label: "What it changes", bind: { effects: true } });
  ws.push({ from: "desc", to: "effects" });
  if (L.needs) { add(linkNode(`link_perk_${L.needs.id}`, "perk", L.needs.name, "Learned first.", "Needs")); ws.push({ from: `link_perk_${L.needs.id}`, to: "desc" }); }
  for (const one of L.neededBy ?? []) { add(linkNode(`link_perk_${one.id}`, "perk", one.name, "Needs this one first.", "Leads to")); ws.push({ from: "desc", to: `link_perk_${one.id}` }); }
  return { list, ws };
}

function sceneGraph() {
  const scene = state.scene;
  const list = [], ws = [];
  const byName = Object.fromEntries(scene.parts.map((part) => [part.name, part]));
  const depth = { start: 0 };
  const queue = ["start"];
  const targets = (part) => [...part.choices.flatMap((one) => [one.to, one.pass, one.fail]), ...part.when.map((one) => one.to), part.pass, part.fail, part.won, part.lost, part.fled, part.gaveUp, part.talked].filter(Boolean);
  while (queue.length) {
    const name = queue.shift();
    for (const target of targets(byName[name] ?? { choices: [], when: [] })) if (depth[target] === undefined) { depth[target] = depth[name] + 1; queue.push(target); }
  }
  scene.parts.forEach((part, i) => {
    const kind = part.end ? "end" : part.check || part.fight ? "check" : "part";
    list.push({ id: `p_${part.name}`, kind, col: depth[part.name] ?? Math.max(1, ...Object.values(depth)) + 1, name: part.name, text: part.text || (part.fight ? `A fight: ${part.fight}.` : "..."), label: part.end ? "The end" : part.check ? `A check: ${part.check}` : part.fight ? `A fight: ${part.fight}` : "A part", part: i, problem: state.scene.problems.some((one) => one.includes(`part ${part.name} `) || one.includes(`part ${part.name},`)) });
  });
  const stub = (target) => { const id = `p_${target}`; if (!list.some((node) => node.id === id)) list.push({ id, kind: "stub", col: (depth[target] ?? 8), name: target, text: "There's no part with this name yet.", label: "Missing" }); return id; };
  scene.parts.forEach((part, i) => {
    part.choices.forEach((one, k) => {
      const check = one.check ? `[${one.check}] ` : "";
      if (one.to) ws.push({ from: `p_${part.name}`, to: stub(one.to), words: `${check}${one.say}`, kind: "choice", part: i, choice: k });
      if (one.pass) ws.push({ from: `p_${part.name}`, to: stub(one.pass), words: `${check}${one.say}: passed`, kind: "choice", part: i, choice: k });
      if (one.fail) ws.push({ from: `p_${part.name}`, to: stub(one.fail), words: `${check}${one.say}: failed`, kind: "choice", part: i, choice: k });
    });
    part.when.forEach((one, k) => { if (one.to) ws.push({ from: `p_${part.name}`, to: stub(one.to), words: conditionWords(one.if), kind: "cond", part: i, rule: k }); });
    for (const [key, words] of [["pass", "passed"], ["fail", "failed"], ["won", "won"], ["lost", "lost"], ["fled", "fled"], ["gaveUp", "gave up"], ["talked", "talked"]]) if (part[key]) ws.push({ from: `p_${part.name}`, to: stub(part[key]), words, kind: "choice", part: i, outcome: key });
  });
  return { list, ws };
}

function build() {
  const builders = { story: notesGraph, place: placeGraph, person: personGraph, species: speciesGraph, enemy: enemyGraph, item: itemGraph, faction: factionGraph, perk: perkGraph };
  const graph = state.tab === "scene" ? sceneGraph() : builders[state.kind]();
  nodes = graph.list;
  wires = graph.ws;
  for (const node of nodes) node.problem ??= state.problems.some((one) => problemTouches(one, node));
}
// Whether the checker's problem is about this box, so it can be marked.
function problemTouches(problem, node) {
  const id = state.id;
  if (state.kind !== "story") return node.kind === "about";
  if (node.kind === "ending") return problem.includes(`outcome ${node.bind.outcome + 1}`) || problem.includes(`called ${node.ending}`);
  if (node.kind === "fact") return problem.includes(`facts: ${node.fact}`) || problem.includes(`fact ${node.fact}`);
  if (node.kind === "react") return problem.includes(`reacts ${node.bind.react + 1}`);
  if (node.kind === "consequence") return problem.includes(`${id}, consequence ${node.bind.cons + 1}`);
  if (node.kind === "clock") return problem.includes(`${id}, stage ${node.bind.stage + 1}`);
  if (node.kind === "about") return problem.startsWith(`stories/${id}.txt`);
  return false;
}

// ---- Laying it out and drawing it ------------------------------------------------------------
const GAP = 18, TOP = 20;
let COL_W = 300, LEFT = 20;
function visibleNodes() {
  if (state.tab !== "notes" || state.kind !== "story") return nodes;
  const focus = state.expanded ?? nodes.find((node) => node.kind === "ending")?.id;
  const shown = new Set(nodes.filter((node) => !UNFOLDS.includes(node.kind)).map((node) => node.id));
  const reach = (id) => { for (const wire of wires) if (wire.from === id && !shown.has(wire.to)) { shown.add(wire.to); reach(wire.to); } };
  if (focus) reach(focus);
  for (const wire of wires) if (wire.from === "lead" && UNFOLDS.includes(nodes.find((node) => node.id === wire.to)?.kind)) { shown.add(wire.to); reach(wire.to); }
  return nodes.filter((node) => shown.has(node.id));
}
// A remembered position belongs to a board, the notes or the scene, whichever tab is showing it or was last.
const posKey = (node) => `${state.tab === "file" ? state.lastBoard ?? "notes" : state.tab}:${node.id}`;
function layout() {
  COL_W = state.tab === "scene" ? 390 : 300;
  LEFT = state.tab === "scene" ? 20 : state.kind === "story" ? 150 : 20;
  const visible = visibleNodes();
  for (const node of nodes) node.hidden = !visible.includes(node);
  const cols = {};
  for (const node of visible) if (node.row !== "clock") (cols[node.col] ??= []).push(node);
  let bottom = TOP;
  for (const [col, list] of Object.entries(cols)) {
    let y = TOP;
    for (const node of list) {
      const saved = state.positions[posKey(node)];
      node.x = saved?.x ?? LEFT + Number(col) * COL_W;
      node.y = saved?.y ?? y;
      y = Math.max(y, node.y) + (node.h ?? 110) + GAP;
      bottom = Math.max(bottom, y);
    }
  }
  let x = LEFT + COL_W;
  for (const node of visible.filter((one) => one.row === "clock")) {
    const saved = state.positions[posKey(node)];
    node.x = saved?.x ?? x;
    node.y = saved?.y ?? bottom + 30;
    x += COL_W;
  }
}

function render() {
  const canvas = $("board-canvas");
  if (!canvas) return;
  for (const old of canvas.querySelectorAll(".board-node, .board-label")) old.remove();
  canvas.classList.toggle("scene", state.tab === "scene");
  for (const node of nodes) node.el = null;
  for (const node of nodes.filter((one) => !one.hidden)) {
    const div = el("div", { class: `board-node ${node.kind}${node.problem ? " problem" : ""}`, "data-id": node.id, tabindex: "0", role: "button" },
      el("div", { class: "kind" }, node.label, node.kind === "ending" && node.ending ? el("span", { class: "tag" }, node.ending) : null),
      el("div", { class: "name" }, node.name),
      node.cond !== undefined && node.kind !== "react" ? el("div", { class: "when" }, conditionWords(node.cond)) : null,
      el("div", { class: "words" }, node.text));
    if (state.selected?.node === node.id) div.classList.add("selected");
    div.style.left = `${node.x}px`;
    div.style.top = `${node.y}px`;
    canvas.append(div);
    node.el = div;
  }
  let changed = false;
  const drawn = nodes.filter((one) => one.el);
  for (const node of drawn) { const h = node.el.offsetHeight; if (node.h !== h) { node.h = h; changed = true; } }
  if (changed) { layout(); for (const node of drawn) { node.el.style.left = `${node.x}px`; node.el.style.top = `${node.y}px`; } }
  drawWires();
  const w = Math.max(400, ...drawn.map((node) => node.x + node.el.offsetWidth)) + 60;
  const h = Math.max(300, ...drawn.map((node) => node.y + node.h)) + 60;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const lines = $("board-wires");
  lines.setAttribute("width", w);
  lines.setAttribute("height", h);
  canvas.style.transform = `scale(${state.zoom})`;
}
function drawWires() {
  const canvas = $("board-canvas"), lines = $("board-wires");
  lines.replaceChildren();
  for (const old of canvas.querySelectorAll(".board-label")) old.remove();
  const defs = svg("defs");
  defs.innerHTML = '<marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5f9c75"></path></marker>';
  lines.append(defs);
  const byId = Object.fromEntries(nodes.map((node) => [node.id, node]));
  wires.forEach((wire, i) => {
    const a = byId[wire.from], b = byId[wire.to];
    if (!a?.el || !b?.el) return;
    const aw = a.el.offsetWidth, bw = b.el.offsetWidth;
    const margin = wire.stage === 0;
    const down = (a.row !== "clock" && b.row === "clock") || (b.y > a.y + a.h + 40 && Math.abs(b.x - a.x) < 80);
    const x1 = margin ? a.x : down ? a.x + aw / 2 : a.x + aw, y1 = margin ? a.y + a.h / 2 : down ? a.y + a.h : a.y + a.h / 2;
    const x2 = down && !margin ? b.x + bw / 2 : b.x, y2 = down && !margin ? b.y : b.y + b.h / 2;
    const d = margin ? `M${x1},${y1} L${a.x - 70},${y1} L${a.x - 70},${y2} L${x2},${y2}` : down ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}` : `M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`;
    const lit = state.selected?.wire === i || state.selected?.node === wire.from || state.selected?.node === wire.to;
    const path = svg("path", { d, class: `${wire.kind ?? ""}${lit ? " lit" : ""}`, "marker-end": "url(#board-arrow)" });
    lines.append(path);
    // On the scene board the words on arrows would pile up, so they show for the part that's selected.
    const sel = state.selected;
    const showWords = state.tab !== "scene" || (sel && (sel.wire === i || sel.node === wire.from || sel.node === wire.to));
    if (wire.words && showWords) {
      const t = margin ? 0.5 : 0.66;
      const sameTarget = wires.filter((other, k) => k < i && other.to === wire.to && other.words).length;
      const label = el("div", { class: `board-label ${wire.kind ?? ""}${state.selected?.wire === i ? " selected" : ""}`, "data-wire": i, tabindex: "0", role: "button" }, wire.words);
      label.style.left = `${margin ? a.x - 70 : x1 + (x2 - x1) * t}px`;
      label.style.top = `${margin ? (y1 + y2) / 2 : y1 + (y2 - y1) * t + sameTarget * 16}px`;
      canvas.append(label);
    }
  });
}
function redraw() {
  build();
  layout();
  render();
  layout();
  render();
  inspect();
  if (state.tab === "file") $("board-text").textContent = fileText();
}
function fileText() {
  if (state.tab === "scene" || (state.scene && state.tab === "file" && state.lastBoard === "scene")) return sceneText();
  if (state.kind === "story") return writeStoryText(S(), C());
  return writeWorldText(state.item, SPECS[state.kind]);
}
const sceneText = () => (state.scene ? [state.scene.header, ...state.scene.parts.map((part) => `== ${part.name}\n${part.raw}`)].join("\n") : "");
const sceneRoute = () => `/api/board/${state.scenePrefix === "talk" ? "talk" : "scene"}/${state.id}`;

// ---- Tabs, zoom and looking around ------------------------------------------------------------
async function showTab(tab) {
  if (tab === "scene" && !state.written) {
    say(state.kind === "person" ? `${state.item.name} has no written lines yet: the AI, or the stock lines, speak for them.` : `${S().title} has no written scene yet. The AI runs it from these notes.`, false);
    tab = "notes";
  }
  if (tab !== "file") state.lastBoard = tab;
  if (tab === "scene" && !state.scene) {
    try {
      state.scene = await call(sceneRoute());
    } catch (err) {
      say(err.message, false);
      tab = "notes";
    }
  }
  state.tab = tab;
  state.selected = null;
  for (const button of document.querySelectorAll(".board-tab")) button.setAttribute("aria-selected", String(button.dataset.tab === tab));
  const text = tab === "file";
  $("board-text").hidden = !text;
  $("board-scroll").hidden = text;
  $("board-tools").hidden = text;
  redraw();
  if (!text) fit();
}
function zoomBy(amount) {
  state.zoom = Math.min(1.6, Math.max(0.4, state.zoom + amount));
  render();
}
function fit() {
  const canvas = $("board-canvas"), scroll = $("board-scroll");
  if (!canvas || !scroll) return;
  state.zoom = Math.max(0.6, Math.min(1, scroll.clientWidth / (canvas.offsetWidth + 20)));
  render();
  scroll.scrollTo(0, 0);
}
// Where boxes were moved to is kept by the game, per story or thing, so it's the same next time.
function saveLayoutSoon() {
  clearTimeout(state.layoutTimer);
  state.layoutTimer = setTimeout(() => { call("/api/board/layout", { key: state.layoutKey, positions: state.positions }).catch((err) => say(err.message, false)); }, 400);
}
function tidy() {
  state.positions = {};
  saveLayoutSoon();
  layout();
  render();
  fit();
}

// ---- New arrows, by dragging one box onto another ---------------------------------------------------
// What dropping one box on another means: a fact comes after an ending, a consequence follows an ending, and in a
// written scene a part gets a choice that leads to the other part.
function canConnect(from, to) {
  if (state.tab === "scene") return ["part", "check", "end"].includes(from.kind) && ["part", "check", "end"].includes(to.kind) && from !== to;
  if (state.kind !== "story") return false;
  return to.kind === "ending" && (from.kind === "fact" || from.kind === "consequence");
}
function connect(from, to) {
  if (state.tab === "scene") {
    const part = state.scene.parts[from.part];
    state.selected = { node: from.id };
    keepPart(from.part, `${part.raw.replace(/\n+$/, "")}\n> Say what the player does -> ${to.name}\n`);
    say(`${from.name} now has a choice that leads to ${to.name}. Click its words to say what the player does.`);
    return;
  }
  const story = S();
  if (from.kind === "fact") (story.gm.factAfter ??= {})[from.fact] = to.ending;
  else C().consequences[from.bind.cons].of = `ended ${state.id} ${to.ending}`;
  state.expanded = to.id;
  state.selected = { node: from.id };
  changed();
}
// Dropping the words on an arrow onto a part sends the choice there instead.
function retarget(wire, to) {
  const part = state.scene.parts[wire.part];
  const rawLines = part.raw.split("\n");
  const line = wire.choice !== undefined ? part.choices[wire.choice]?.line : wire.rule !== undefined ? part.when[wire.rule]?.line : null;
  const at = line ? line - part.line - 1 : -1;
  if (at < 0 || at >= rawLines.length) return say("That arrow is changed in the part's own box.", false);
  if (wire.choice !== undefined && part.choices[wire.choice]?.check) return say("A check's two ways are picked in the box on the right, passed and failed.", false);
  rawLines[at] = rawLines[at].replace(/->\s*\S+/, `-> ${to.name}`);
  state.selected = { node: wire.from };
  keepPart(wire.part, rawLines.join("\n"));
}

// ---- Clicking and dragging ------------------------------------------------------------------------
let drag = null, pan = null;
// The box under the pointer that the dragged thing could be dropped on, lit up while it's there.
function dropTarget(event, from) {
  const over = document.elementFromPoint(event.clientX, event.clientY)?.closest(".board-node");
  const target = over && over !== from.el ? nodes.find((one) => one.id === over.dataset.id) : null;
  for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
  if (target && canConnect(from, target)) {
    target.el.classList.add("target");
    return target;
  }
  return null;
}
document.addEventListener("pointerdown", (event) => {
  const canvas = $("board-canvas");
  if (!canvas) return;
  const nodeEl = event.target.closest(".board-node");
  if (nodeEl && canvas.contains(nodeEl)) {
    const node = nodes.find((one) => one.id === nodeEl.dataset.id);
    drag = { node, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, moved: false, target: null };
    try { nodeEl.setPointerCapture(event.pointerId); } catch { /* fine without */ }
    return;
  }
  const labelEl = event.target.closest(".board-label");
  if (labelEl && canvas.contains(labelEl) && state.tab === "scene") {
    drag = { label: wires[Number(labelEl.dataset.wire)], el: labelEl, startX: event.clientX, startY: event.clientY, left: parseFloat(labelEl.style.left), top: parseFloat(labelEl.style.top), moved: false, target: null };
    try { labelEl.setPointerCapture(event.pointerId); } catch { /* fine without */ }
    return;
  }
  const scroll = $("board-scroll");
  if (event.target === scroll || event.target === canvas || event.target === $("board-wires")) {
    pan = { x: event.clientX, y: event.clientY, left: scroll.scrollLeft, top: scroll.scrollTop };
    scroll.classList.add("dragging");
  }
});
document.addEventListener("pointermove", (event) => {
  if (drag?.label) {
    const dx = (event.clientX - drag.startX) / state.zoom, dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.el.classList.add("dragging");
    drag.el.style.left = `${drag.left + dx}px`;
    drag.el.style.top = `${drag.top + dy}px`;
    const from = nodes.find((one) => one.id === drag.label.from);
    drag.target = dropTarget(event, { el: drag.el, kind: from?.kind ?? "part" });
  } else if (drag) {
    const dx = (event.clientX - drag.startX) / state.zoom, dy = (event.clientY - drag.startY) / state.zoom;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    drag.node.el.classList.add("dragging");
    drag.node.x = Math.max(0, drag.x + dx);
    drag.node.y = Math.max(0, drag.y + dy);
    drag.node.el.style.left = `${drag.node.x}px`;
    drag.node.el.style.top = `${drag.node.y}px`;
    drag.target = dropTarget(event, drag.node);
    drawWires();
  } else if (pan) {
    const scroll = $("board-scroll");
    scroll.scrollLeft = pan.left - (event.clientX - pan.x);
    scroll.scrollTop = pan.top - (event.clientY - pan.y);
  }
});
document.addEventListener("pointerup", () => {
  if (drag?.label) {
    const { label, moved, target, el: labelEl } = drag;
    drag = null;
    labelEl.classList.remove("dragging");
    for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
    if (moved && target) retarget(label, target);
    else if (moved) drawWires();
    return;
  }
  if (drag) {
    const { node, moved, target } = drag;
    drag = null;
    node.el?.classList.remove("dragging");
    for (const lit of document.querySelectorAll(".board-node.target")) lit.classList.remove("target");
    if (!moved) select({ node: node.id });
    else if (target) {
      // Dropped on another box: that's a link, and the box goes back to its column when the board is drawn again.
      connect(node, target);
    } else {
      state.positions[posKey(node)] = { x: node.x, y: node.y };
      saveLayoutSoon();
      render();
    }
  }
  if (pan) {
    pan = null;
    $("board-scroll")?.classList.remove("dragging");
  }
});
document.addEventListener("click", (event) => {
  const label = event.target.closest(".board-label");
  if (label && $("board-canvas")?.contains(label)) select({ wire: Number(label.dataset.wire) });
});
document.addEventListener("keydown", (event) => {
  if (!$("board") || (event.key !== "Enter" && event.key !== " ")) return;
  const nodeEl = event.target.closest(".board-node"), label = event.target.closest(".board-label");
  if (nodeEl) select({ node: nodeEl.dataset.id });
  else if (label) select({ wire: Number(label.dataset.wire) });
  else return;
  event.preventDefault();
});
function select(what) {
  state.selected = what;
  const node = what.node ? nodes.find((one) => one.id === what.node) : null;
  if (node?.kind === "ending" && state.kind === "story") { state.expanded = node.id; layout(); }
  render();
  inspect();
}

// ---- Changing things ---------------------------------------------------------------------------
function changed() {
  if (state.tab === "scene") state.sceneDirty = true;
  else state.dirty = true;
  redraw();
}
function textOf(node) {
  const story = S(), b = node.bind ?? {};
  if (b.path) return get(state.item, b.path) ?? "";
  if (b.district !== undefined) return state.item.gm.districts[b.district].desc;
  if (b.items) return (get(state.item, b.items) ?? []).join("\n");
  if (b.text) return story[b.text] ?? "";
  if (b.gm) return story.gm[b.gm] ?? "";
  if (b.list) return story.gm[b.list][b.i];
  if (b.lines) return story.gm[b.lines].join("\n");
  if (b.outcome !== undefined) return story.gm.outcomes[b.outcome].text;
  if (node.fact) return story.gm.facts[node.fact];
  if (b.cons !== undefined) return C().consequences[b.cons].news;
  if (b.stage !== undefined) return C().stages[b.stage].news;
  if (b.react !== undefined) return story.gm.reacts[b.react].then;
  return node.text;
}
function setText(node, value) {
  const story = S(), b = node.bind ?? {};
  const text = value.trim();
  if (b.path) setPath(state.item, b.path, text);
  else if (b.district !== undefined) state.item.gm.districts[b.district].desc = text;
  else if (b.items) setPath(state.item, b.items, value.split("\n").map((one) => one.trim()).filter(Boolean));
  else if (b.text) story[b.text] = text;
  else if (b.gm) story.gm[b.gm] = text;
  else if (b.list) story.gm[b.list][b.i] = text;
  else if (b.lines) story.gm[b.lines] = value.split("\n").map((one) => one.trim()).filter(Boolean);
  else if (b.outcome !== undefined) story.gm.outcomes[b.outcome].text = text;
  else if (node.fact) story.gm.facts[node.fact] = text;
  else if (b.cons !== undefined) C().consequences[b.cons].news = text;
  else if (b.stage !== undefined) C().stages[b.stage].news = text;
  else if (b.react !== undefined) story.gm.reacts[b.react].then = text;
}
function renameEnding(index, name) {
  const story = S();
  const old = story.gm.outcomes[index].id;
  if (!name || name === old) return;
  story.gm.outcomes[index].id = name;
  for (const [fact, after] of Object.entries(story.gm.factAfter ?? {})) if (after === old) story.gm.factAfter[fact] = name;
  const swap = (text) => (typeof text === "string" ? text.replace(new RegExp(`ended ${state.id} ${old}(?!\\w)`, "g"), `ended ${state.id} ${name}`) : text);
  for (const one of story.gm.reacts ?? []) one.to = swap(one.to);
  for (const one of C().consequences ?? []) one.of = swap(one.of);
  for (const one of C().stages) { one.if = swap(one.if); if (one.ending === old) one.ending = name; }
  state.expanded = `end_${name}`;
  state.selected = { node: `end_${name}` };
}
function renameFact(oldName, name) {
  const story = S();
  if (!name || name === oldName || story.gm.facts[name]) return;
  story.gm.facts = Object.fromEntries(Object.entries(story.gm.facts).map(([key, line]) => [key === oldName ? name : key, line]));
  if (story.gm.factAfter?.[oldName]) { story.gm.factAfter[name] = story.gm.factAfter[oldName]; delete story.gm.factAfter[oldName]; }
  state.selected = { node: `fact_${name}` };
}
function remove(node) {
  const story = S(), clock = C(), b = node.bind ?? {};
  if (b.district !== undefined) state.item.gm.districts.splice(b.district, 1);
  else if (b.list) story.gm[b.list].splice(b.i, 1);
  else if (b.outcome !== undefined) {
    const id = story.gm.outcomes[b.outcome].id;
    story.gm.outcomes.splice(b.outcome, 1);
    for (const [fact, after] of Object.entries(story.gm.factAfter ?? {})) if (after === id) delete story.gm.factAfter[fact];
    state.expanded = null;
  } else if (node.fact) { delete story.gm.facts[node.fact]; delete story.gm.factAfter?.[node.fact]; }
  else if (b.cons !== undefined) clock.consequences.splice(b.cons, 1);
  else if (b.stage !== undefined) clock.stages.splice(b.stage, 1);
  else if (b.react !== undefined) story.gm.reacts.splice(b.react, 1);
  state.selected = null;
  changed();
}
function addEnding() {
  const story = S();
  let name = "new_ending", n = 2;
  while (story.gm.outcomes.some((one) => one.id === name)) name = `new_ending_${n++}`;
  story.gm.outcomes.push({ id: name, text: "What's true if the story ends this way." });
  state.expanded = `end_${name}`;
  state.selected = { node: `end_${name}` };
  changed();
}
function addFact(after = null) {
  const story = S();
  story.gm.facts ??= {};
  let name = "new_fact", n = 2;
  while (story.gm.facts[name]) name = `new_fact_${n++}`;
  story.gm.facts[name] = "What's true from now on, in a line.";
  if (after) (story.gm.factAfter ??= {})[name] = after;
  state.selected = { node: `fact_${name}` };
  changed();
}
function addConsequence(ending = null) {
  const clock = C();
  clock.consequences ??= [];
  clock.consequences.push({ of: `ended ${state.id}${ending ? ` ${ending}` : ""}`, after: 7, news: "What people hear, that many days later." });
  state.selected = { node: `cons${clock.consequences.length - 1}` };
  changed();
}
function addStage() {
  const clock = C();
  const last = clock.stages.at(-1)?.after ?? 0;
  clock.stages.push({ after: last + 14, news: "What happens by itself, if nobody has stepped in.", lead: "What the lead says from then on." });
  state.selected = { node: `stage${clock.stages.length - 1}` };
  changed();
}
function addReaction() {
  const story = S();
  story.gm.reacts ??= [];
  const other = state.all.find((one) => one.id !== state.id && one.endings.length) ?? state.all[0];
  story.gm.reacts.push({ to: `ended ${other.id}${other.endings[0] ? ` ${other.endings[0]}` : ""}`, then: "What changes in this story when that's so." });
  state.selected = { node: `react${story.gm.reacts.length - 1}` };
  changed();
}
function addBeat(after) {
  S().gm.beats.splice(after + 1, 0, "What might happen next.");
  state.selected = { node: `beat${after + 1}` };
  changed();
}
function addDistrict() {
  const P = state.item;
  (P.gm ??= {}).districts ??= [];
  P.gm.districts.push({ name: "A new district", desc: "What it's like, and who's there." });
  state.selected = { node: `district${P.gm.districts.length - 1}` };
  changed();
}

// ---- The inspector: what's selected, and the ways to change it -----------------------------------
const h2 = (text) => el("h2", {}, text);
const hint = (text) => el("div", { class: "hint" }, text);
const row = (...children) => fill(el("div", { class: "row" }), ...children);
const button = (text, onclick, extra = {}) => el("button", { type: "button", onclick, ...extra }, text);
const textarea = (id, value, lines = 6) => { const area = el("textarea", { id, rows: String(lines) }); area.value = value ?? ""; return area; };
const picker = (id, options, value) => { const pick = el("select", { id }); for (const [v, label] of options) pick.append(el("option", { value: v }, label)); pick.value = value; return pick; };
const numberBox = (id, value, step = 1) => { const box = el("input", { id, type: "number", step: String(step), class: "number-box" }); box.value = value ?? ""; return box; };
const textBox = (id, value) => { const box = el("input", { id, type: "text", class: "name-box" }); box.value = value ?? ""; return box; };
const checkBox = (id, value) => { const box = el("input", { id, type: "checkbox" }); box.checked = Boolean(value); return box; };

function inspect() {
  const inspector = $("board-inspector");
  if (!inspector) return;
  inspector.replaceChildren();
  const sel = state.selected;
  if (state.tab === "file") return fill(inspector, h2("The file"), hint("This is the same thing, written the way its file holds it. The board is read from this, and Save writes it, so the file can still be changed by hand, on GitHub or in Notepad."));
  if (!sel) return inspectNothing(inspector);
  if (sel.wire !== undefined) return inspectWire(inspector, wires[sel.wire], sel.wire);
  const node = nodes.find((one) => one.id === sel.node);
  if (!node) return inspectNothing(inspector);
  if (state.tab === "scene") return inspectPart(inspector, node);
  if (node.kind === "link") return inspectLink(inspector, node);
  if (node.lines) return fill(inspector, h2("Written lines"), hint(node.text), state.written ? row(button("Open the written lines", () => showTab("scene"))) : hint("A file called talk_<id>.txt in world/scenes gives them written lines; the how-to there explains it."));
  if (node.kind === "about") return state.kind === "story" ? inspectAbout(inspector) : inspectWorldAbout(inspector);
  if (node.bind?.numbers) return inspectNumbers(inspector, node);
  if (node.bind?.fight) return inspectFight(inspector, node);
  if (node.bind?.speciesNumbers) return inspectSpeciesNumbers(inspector, node);
  if (node.bind?.effects) return inspectEffects(inspector, node);
  if (node.bind?.enemyLines) return inspectEnemyLines(inspector, node);
  if (node.bind?.beliefs) return inspectBeliefs(inspector, node);
  if (node.bind?.district !== undefined) return inspectDistrict(inspector, node);
  return inspectNode(inspector, node);
}
function inspectNothing(inspector) {
  const title = state.kind === "story" ? S().title : [state.item.title, state.item.name].filter(Boolean).join(" ");
  fill(inspector,
    h2(title),
    hint(state.tab === "scene"
      ? "The written parts: each box is a part, each arrow a choice, a check's two ways, or a rule that moves the player on. Click a part and the words on its arrows appear; click those to change a choice."
      : state.kind === "story" ? "The story's notes as a board: the lead and the beats, the ways through, and the endings by name. Click an ending and the facts it leaves, what follows days later, and the stories that react to it unfold beside it. Click any box to read all of it and change it."
        : state.kind === "place" ? "The place as a board: what the player sees, the feel of it, its districts, what can happen there, and the people and stories here. Click any box to read all of it and change it."
          : state.kind === "person" ? "The person as a board: how the game sees them, their looks, personality, voice, goals and secrets, their numbers, how they fight, and where they belong. Click any box to read all of it and change it."
            : state.kind === "species" ? "The species as a board: what the player reads, how the game master plays them, their numbers, and the people who are one. Click any box to read all of it and change it."
              : state.kind === "enemy" ? "The enemy as a board: what the player sees, what they say in a fight, who they fight for, and where they turn up. Their numbers are in the box on the left."
                : state.kind === "item" ? "The item as a board: what the player reads, its effects, and where it's sold or found. Its numbers are in the box on the left."
                  : state.kind === "faction" ? "The faction as a board: what the player reads, what they believe, and their people, places, enemies and stories, each a box that opens."
                    : "The perk as a board: what the player reads, what it changes, and the perks it needs or leads to. What it needs is in the box on the left."),
    el("div", { class: "legend" }, ...(state.tab === "scene" ? [["beat", "parts"], ["ending", "checks and fights"], ["end", "ends"], ["clock", "missing"]]
      : state.kind === "story" ? [["lead", "the lead"], ["beat", "beats"], ["route", "ways through"], ["ending", "endings"], ["fact", "facts"], ["consequence", "consequences"], ["clock", "the clock"], ["next", "other stories"]]
        : [["lead", "for the player"], ["beat", "for the game master"], ["route", "lists and numbers"], ["ending", "the dice"], ["next", "links to open"]]).map(([kind, words]) => el("span", { class: `l-${kind}` }, words))),
    state.tab === "notes" && state.kind === "story" ? row(button("+ an ending", addEnding), button("+ a fact", () => addFact()), button("+ something days later", () => addConsequence()), button("+ a stage of the clock", addStage), button("+ what changes this story", addReaction)) : null,
    state.tab === "notes" && state.kind === "place" ? row(button("+ a district", addDistrict)) : null,
    state.problems.length ? el("div", { class: "problems" }, h2("The checker says"), ...state.problems.map((one) => el("div", {}, one))) : hint("The checker has nothing to say about this one."),
    hint(`Save writes the file in world/${FOLDERS[state.kind]}, and the game uses the new version from the next turn.`));
}
function inspectEnemyLines(inspector, node) {
  const P = state.item;
  const boxes = LINE_PHRASES.map(([key, phrase]) => {
    const area = textarea(`edit-lines-${key}`, (P.lines?.[key] ?? []).join("\n"), 2);
    return fill(el("div", {}), el("label", { for: area.id }, `${phrase}, one line each`), area, row(button("Keep", () => { const items = area.value.split("\n").map((one) => one.trim()).filter(Boolean); if (items.length) (P.lines ??= {})[key] = items; else if (P.lines) { delete P.lines[key]; if (!Object.keys(P.lines).length) delete P.lines; } changed(); }, { class: "small" })));
  });
  fill(inspector, h2("What they say"), hint("One is picked at random each time it happens. A box left empty means the plain line is used."), ...boxes);
}
function inspectBeliefs(inspector, node) {
  fill(inspector, h2("What they believe"), hint("How far they lean on each axis, from -10 to 10. The game compares them with the player's own beliefs when it works out how they get on."), pairsEditor(state.item, "beliefs", "Beliefs", state.lists.axes));
}

function inspectNode(inspector, node) {
  const story = S(), clock = C(), b = node.bind ?? {};
  if (node.kind === "next") {
    return fill(inspector, h2("Another story reacts"), el("h3", {}, node.name), hint(`When: ${conditionWords(node.cond)}.`), el("div", { class: "quote" }, node.text), row(button(`Open ${storyTitle(node.story)}`, () => load("story", node.story))), hint("It's written in that story's file, so it's changed there."));
  }
  const nameBox = textBox("edit-name", node.ending ?? node.fact ?? "");
  const area = textarea("edit-text", textOf(node), b.lines || b.checks || b.items ? 8 : 6);
  const checksArea = b.checks ? textarea("edit-fights", story.gm.fights.join("\n"), 4) : null;
  if (b.checks) area.value = story.gm.checks.join("\n");
  const keep = () => {
    if (b.checks) {
      story.gm.checks = area.value.split("\n").map((one) => one.trim()).filter(Boolean);
      story.gm.fights = area.value && checksArea.value.split("\n").map((one) => one.trim()).filter(Boolean);
    } else setText(node, area.value);
    if (node.ending !== undefined) renameEnding(b.outcome, nameBox.value.trim() || nameFrom(area.value));
    if (node.fact !== undefined) renameFact(node.fact, nameBox.value.trim());
    changed();
  };
  fill(inspector,
    h2(node.label),
    node.ending !== undefined || node.fact !== undefined
      ? el("div", {}, el("label", { for: "edit-name" }, node.ending !== undefined ? "Its name, which other stories use. Leave it empty and it's made from the words." : "The fact's name, which conditions use"), nameBox, node.ending !== undefined ? row(button("Name it from the words", () => { nameBox.value = nameFrom(area.value); })) : null)
      : el("h3", {}, node.name),
    el("label", { for: "edit-text" }, b.lines ? "One way through on each line" : b.items ? "One on each line" : b.checks ? "Checks that fit, one on each line: a skill, a colon, easy, moderate or hard, and what it's for" : node.kind === "ending" ? "What's true if the story ends this way" : node.kind === "fact" ? "The line the player and the AI read" : node.kind === "consequence" || node.kind === "clock" ? "What people hear" : node.kind === "react" ? "What changes in this story" : "The words"),
    area,
    checksArea ? el("label", { for: "edit-fights" }, "If it comes to a fight, one on each line: enemy ids, and when") : null,
    checksArea,
    row(button("Keep", keep), button("Undo", () => inspect())),
    node.kind === "ending" ? row(button("+ a fact it leaves", () => addFact(node.ending)), button("+ something days later", () => addConsequence(node.ending))) : null,
    node.kind === "beat" && b.list ? row(button("+ a beat after this", () => addBeat(b.i))) : null,
    node.kind === "fact" ? factAfterRow(node) : null,
    node.kind === "consequence" ? [daysRow(clock.consequences[b.cons]), conditionPicker(clock.consequences[b.cons], "of", "What has to be on the record"), placeRow(clock.consequences[b.cons]), subFacts(clock.consequences[b.cons]), placeHitsEditor(clock.consequences[b.cons]), fleetEditor(clock.consequences[b.cons])] : null,
    node.kind === "clock" ? [daysRow(clock.stages[b.stage]), stageLeadRow(clock.stages[b.stage]), conditionPicker(clock.stages[b.stage], "if", "Only if", true), placeRow(clock.stages[b.stage]), subFacts(clock.stages[b.stage]), stageEndingRow(clock.stages[b.stage]), placeHitsEditor(clock.stages[b.stage]), fleetEditor(clock.stages[b.stage])] : null,
    node.kind === "react" ? conditionPicker(story.gm.reacts[b.react], "to", "When this is on the record") : null,
    ["ending", "fact", "consequence", "clock", "react"].includes(node.kind) || b.list ? row(button("Remove", () => remove(node), { class: "danger" })) : null,
    node.problem ? el("div", { class: "problems" }, ...state.problems.filter((one) => problemTouches(one, node)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the box and the file together. Save writes the file."));
}
function inspectAbout(inspector) {
  const story = S(), clock = C();
  const title = textBox("edit-title", story.title);
  const kind = picker("edit-kind", ["main", "crew", "dilemma", "mystery", "exploration", "survival", "politics", "job", "faction"].map((one) => [one, one]), story.kind);
  const after = picker("edit-after", [["", "nothing: it can start on its own"], ...state.all.filter((one) => one.id !== state.id).map((one) => [one.id, one.title])], story.after ?? "");
  const level = picker("edit-level", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((one) => [String(one), `level ${one}`]), String(story.minLevel ?? 1));
  const places = textBox("edit-places", story.places.join(", "));
  const people = textBox("edit-people", story.people.join(", "));
  const factions = textBox("edit-factions", story.factions.join(", "));
  fill(inspector,
    h2("About this story"),
    el("label", { for: "edit-title" }, "Its title"), title,
    row(el("label", { for: "edit-kind" }, "What kind of story"), kind),
    row(el("label", { for: "edit-after" }, "Comes after"), after),
    row(el("label", { for: "edit-level" }, "For a player of at least"), level),
    el("label", { for: "edit-places" }, "Where it happens: place ids, the first is where the lead comes up"), places,
    el("label", { for: "edit-people" }, "Who's in it: people's ids"), people,
    el("label", { for: "edit-factions" }, "Which factions"), factions,
    clock.waits ? hint(`Its clock waits: ${clock.waits}`) : null,
    row(button("Keep", () => {
      story.title = title.value.trim() || story.title;
      story.kind = kind.value;
      story.after = after.value || null;
      story.minLevel = Number(level.value);
      const list = (box) => box.value.split(",").map((one) => one.trim()).filter(Boolean);
      story.places = list(places);
      story.people = list(people);
      story.factions = list(factions);
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/stories/${state.id}.txt. Its name doesn't change here.`));
}

// The lines at the top of a person's, a place's or a species' file, each with the right kind of box.
function inspectWorldAbout(inspector) {
  const spec = SPECS[state.kind], item = state.item, lists = state.lists;
  const boxes = [];
  const optionsFor = (path) => (path === "species" ? lists.species : path === "location" ? lists.places : path === "faction" ? lists.factions
    : path === "stat" ? lists.attributes.map((one) => ({ id: one, name: one })) : path === "skill" ? lists.skills.map((one) => ({ id: one, name: one }))
      : path === "type" ? lists.itemTypes.map((one) => ({ id: one, name: one })) : path === "art" ? lists.arts.map((one) => ({ id: one, name: one })) : path === "motive" ? lists.motives.map((one) => ({ id: one, name: one }))
        : path === "requires" ? lists.perks.filter((one) => one.id !== state.id) : path === "ability" ? lists.abilities : null);
  const title = textBox("edit-title", item[spec.title]);
  for (const field of spec.header) {
    const value = get(item, field.path);
    const id = `edit-${field.path.replaceAll(".", "-")}`;
    let box;
    if (field.type === "pairs") {
      // Numbers with names, like on hit: stress 2, have an editor of their own, with Keep buttons of its own.
      const names = field.path === "onHit" ? ["stress", "energy"] : field.path === "effect" ? ["hp", "energy", "hull", "fuel"] : field.path === "requiresSkill" ? lists.skills : field.path === "requiresStat" ? lists.attributes : lists.axes;
      boxes.push({ field, box: pairsEditor(item, field.path, field.key, names), own: true });
      continue;
    }
    if (field.type === "range") {
      const low = numberBox(`${id}-low`, value?.[0] ?? ""), high = numberBox(`${id}-high`, value?.[1] ?? "");
      boxes.push({ field, box: row(el("label", { for: low.id }, field.key), low, el("span", {}, "to"), high), low, high });
      continue;
    }
    if ((field.type === "name" || field.type === "string") && optionsFor(field.path)) box = picker(id, [["", "none"], ...optionsFor(field.path).map((one) => [one.id, one.name])], value ?? "");
    else if (field.type === "flag") box = checkBox(id, value);
    else if (field.type === "number") box = numberBox(id, value ?? "");
    else if (field.type === "list") box = textBox(id, (value ?? []).join(", "));
    else box = textBox(id, value ?? "");
    boxes.push({ field, box });
  }
  fill(inspector,
    h2(`About this ${state.kind}`),
    el("label", { for: "edit-title" }, "The name"), title,
    ...boxes.map(({ field, box, own, low }) => (own || low ? box : field.type === "flag" || box.tagName === "SELECT" || field.type === "number" ? row(el("label", { for: box.id }, field.key), box) : [el("label", { for: box.id }, field.type === "list" ? `${field.key}, separated by commas` : field.key), box])),
    row(button("Keep", () => {
      item[spec.title] = title.value.trim() || item[spec.title];
      for (const { field, box, own, low, high } of boxes) {
        if (own) continue;
        let value;
        if (field.type === "range") value = low.value === "" && high.value === "" ? undefined : [Number(low.value || 0), Number(high.value || 0)];
        else if (field.type === "flag") value = box.checked ? true : (get(item, field.path) === undefined && !box.checked ? undefined : false);
        else if (field.type === "number") value = box.value === "" ? (get(item, field.path) === undefined ? undefined : null) : Number(box.value);
        else if (field.type === "list") value = box.value.split(",").map((one) => one.trim()).filter(Boolean);
        else if (field.type === "name") value = box.value || null;
        else if (box.tagName === "SELECT") value = box.value || undefined;
        else value = box.value.trim() || (get(item, field.path) === undefined ? undefined : "");
        if (field.type === "list" && !value.length && get(item, field.path) === undefined) value = undefined;
        setPath(item, field.path, value);
      }
      changed();
    }), button("Undo", () => inspect())),
    hint(`The file is world/${FOLDERS[state.kind]}/${state.id}.txt. Its name doesn't change here.`));
}
function inspectDistrict(inspector, node) {
  const district = state.item.gm.districts[node.bind.district];
  const name = textBox("edit-name", district.name);
  const area = textarea("edit-text", district.desc, 6);
  fill(inspector, h2("A district"), el("label", { for: "edit-name" }, "Its name"), name, el("label", { for: "edit-text" }, "What it's like, and who's there"), area,
    row(button("Keep", () => { district.name = name.value.trim() || district.name; district.desc = area.value.trim(); changed(); }), button("Undo", () => inspect())),
    row(button("+ a district", addDistrict), button("Remove", () => remove(node), { class: "danger" })));
}
function inspectLink(inspector, node) {
  fill(inspector, h2(node.label), el("h3", {}, node.name), hint(node.text), row(button(`Open ${node.name}`, () => load(node.link.kind, node.link.id))), hint("It has a board of its own, and it's changed there."));
}

// Numbers are picked in boxes with arrows, never typed, and a new one is chosen from a list. "after" runs before
// the board is drawn again, for an editor that works on a copy.
function pairsEditor(holder, key, label, names, step = 1, after = null) {
  const box = el("div", { class: "subfacts" });
  const done = () => { after?.(); changed(); };
  const draw = () => {
    const pairs = holder[key] ?? {};
    box.replaceChildren(el("label", {}, label));
    for (const [name, amount] of Object.entries(pairs)) {
      const number = numberBox(`edit-${key}-${name}`, amount, step);
      box.append(row(el("span", { class: "fact-name" }, spaced(name)), number, button("Keep", () => { holder[key][name] = Number(number.value); done(); }, { class: "small" }), button("Remove", () => { delete holder[key][name]; if (!Object.keys(holder[key]).length && key !== "attributes") delete holder[key]; done(); }, { class: "danger small" })));
    }
    const left = names.filter((name) => !(name in pairs));
    if (left.length) {
      const pick = picker(`edit-${key}-new`, [["", "add one..."], ...left.map((name) => [name, spaced(name)])], "");
      box.append(row(pick, button("+ add it", () => { if (!pick.value) return; (holder[key] ??= {})[pick.value] = 0; done(); })));
    }
  };
  draw();
  return box;
}
// What a stage or a consequence changes at a place: how much there is of a good, or who holds it, picked by name.
function placeHitsEditor(holder) {
  const box = el("div", { class: "subfacts" });
  box.append(el("label", {}, "What changes at a place"));
  const goods = state.lists.goods ?? ["food", "fuel", "medicine", "parts"];
  const sides = (state.lists.factions ?? []).map((one) => one.id);
  (holder.places ?? []).forEach((hit, i) => {
    const place = picker(`edit-hit-${i}`, state.places.map((one) => [one.id, one.name]), hit.id);
    place.addEventListener("change", () => { hit.id = place.value; changed(); });
    const view = { all: { ...(hit.goods ?? {}), ...(hit.sides ?? {}) } };
    box.append(fill(el("div", { class: "hit" }),
      row(place, button("Remove", () => { holder.places.splice(i, 1); if (!holder.places.length) delete holder.places; changed(); }, { class: "danger small" })),
      pairsEditor(view, "all", "Goods there, or who holds it", [...goods, ...sides], 1, () => {
        delete hit.goods;
        delete hit.sides;
        for (const [name, amount] of Object.entries(view.all ?? {})) (goods.includes(name) ? (hit.goods ??= {}) : (hit.sides ??= {}))[name] = amount;
      })));
  });
  box.append(row(button("+ a place", () => { (holder.places ??= []).push({ id: state.places[0]?.id ?? "haven", goods: { fuel: -5 } }); changed(); })));
  return box;
}
// What a stage or a consequence changes in the fleet: its numbers, and a ship lost or gone by name.
function fleetEditor(holder) {
  const box = el("div", { class: "subfacts" });
  box.append(el("label", {}, "What changes in the fleet"));
  const keys = state.lists.fleetKeys ?? ["morale", "food", "medicine", "parts", "fuel", "pursuit", "ships", "picked", "sat"];
  const view = { numbers: Object.fromEntries(Object.entries(holder.fleet ?? {}).filter(([key]) => key !== "named")) };
  const put = () => {
    const named = holder.fleet?.named;
    holder.fleet = { ...(view.numbers ?? {}), ...(named ? { named } : {}) };
    if (!Object.keys(holder.fleet).length) delete holder.fleet;
  };
  box.append(pairsEditor(view, "numbers", "Morale, supplies, pursuit, ships leaving or picked off", keys, 1, put));
  const named = holder.fleet?.named;
  const ship = picker("edit-named-ship", [["", "no ship in particular"], ...(state.lists.ships ?? []).map((one) => [one.id, one.name])], named?.id ?? "");
  const status = picker("edit-named-status", [["lost", "lost"], ["gone", "gone"]], named?.status ?? "lost");
  const spared = numberBox("edit-named-spared", named?.spared ?? "");
  box.append(row(el("label", { for: "edit-named-ship" }, "A ship by name"), ship, status, el("label", { for: "edit-named-spared" }, "spared"), spared, button("Keep", () => {
    if (ship.value) (holder.fleet ??= {}).named = { id: ship.value, status: status.value, ...(spared.value !== "" ? { spared: Number(spared.value) } : {}) };
    else if (holder.fleet) { delete holder.fleet.named; if (!Object.keys(holder.fleet).length) delete holder.fleet; }
    changed();
  }, { class: "small" })));
  return box;
}
function inspectNumbers(inspector, node) {
  const P = state.item, lists = state.lists;
  fill(inspector, h2("Their numbers"), hint("Beliefs run from -10 to 10, attributes from 1 to 10, skills from 0 to 10."),
    pairsEditor(P, "beliefs", "Beliefs", lists.axes), pairsEditor(P, "attributes", "Attributes", lists.attributes), pairsEditor(P, "skills", "Skills", lists.skills));
}
function inspectSpeciesNumbers(inspector, node) {
  const P = state.item, lists = state.lists;
  fill(inspector, h2("Their numbers"), hint("What this species adds or takes from a new character's attributes and skills."),
    pairsEditor(P, "attrs", "Attributes", lists.attributes), pairsEditor(P, "attrCaps", "Attribute caps", lists.attributes), pairsEditor(P, "skills", "Skills", lists.skills));
}
function inspectEffects(inspector, node) {
  const P = state.item, lists = state.lists;
  P.fx ??= {};
  const fx = P.fx;
  const numberList = state.kind === "species" ? [["maxHp", "max hp", 1], ["fatigueRate", "fatigue rate", 0.05], ["healRate", "heal rate", 0.05], ["stressRate", "stress rate", 0.05]]
    : state.kind === "perk" ? PERK_NUMBERS.map(([key, label]) => [key, label, /Rate|Recovery|Bonus/.test(key) ? 0.05 : 1]) : [];
  const numbers = numberList.map(([key, label, step]) => {
    const box = numberBox(`edit-fx-${key}`, fx[key] ?? "", step);
    return row(el("label", { for: box.id }, label), box, button("Keep", () => { if (box.value === "") delete fx[key]; else fx[key] = Number(box.value); changed(); }, { class: "small" }));
  });
  fill(inspector, h2("Effects"), hint(state.kind === "species" ? "Leave a number empty for none. Rates are fractions of the usual: 0.5 is half." : state.kind === "perk" ? "Leave a number empty for none. Rates are fractions of the usual: 1.25 is a quarter more." : "While it's worn or carried: a bonus or a penalty in a setting, or to a skill."), ...numbers,
    pairsEditor(fx, "skills", "Skills", lists.skills), state.kind === "perk" ? pairsEditor(fx, "windowTier", "Better tools in check windows", lists.skills) : null,
    pairsEditor(fx, "context", "In a setting", lists.contexts), state.kind === "species" ? pairsEditor(fx, "factions", "Standing with", lists.factions.map((one) => one.id)) : null);
}
function inspectFight(inspector, node) {
  const P = state.item, lists = state.lists;
  P.combat ??= {};
  const c = P.combat;
  const fields = [["threat", "threat"], ["hp", "hp"], ["attack", "attack"], ["defense", "defense"], ["xp", "xp"]].map(([key, label]) => {
    const box = numberBox(`edit-fight-${key}`, c[key] ?? "");
    return row(el("label", { for: box.id }, label), box, button("Keep", () => { if (box.value === "") delete c[key]; else c[key] = Number(box.value); changed(); }, { class: "small" }));
  });
  const range = (key, label) => {
    const low = numberBox(`edit-fight-${key}-low`, c[key]?.[0] ?? ""), high = numberBox(`edit-fight-${key}-high`, c[key]?.[1] ?? "");
    return row(el("label", { for: low.id }, label), low, el("span", {}, "to"), high, button("Keep", () => { if (low.value === "" && high.value === "") delete c[key]; else c[key] = [Number(low.value || 0), Number(high.value || 0)]; changed(); }, { class: "small" }));
  };
  const weapon = textBox("edit-fight-weapon", c.weapon ?? "");
  const art = picker("edit-fight-art", [["", "none"], ...lists.arts.map((one) => [one, one])], c.art ?? "");
  const tags = textBox("edit-fight-tags", (c.tags ?? []).join(", "));
  const machine = checkBox("edit-fight-machine", c.machine), boss = checkBox("edit-fight-boss", c.boss);
  const linesBoxes = [["intro", "When the fight starts"], ["hit", "When they hit"], ["miss", "When they miss"], ["crit", "When they hit hard"], ["defeated", "When they're beaten"]].map(([key, label]) => {
    const area = textarea(`edit-lines-${key}`, (c.lines?.[key] ?? []).join("\n"), 3);
    return fill(el("div", {}), el("label", { for: area.id }, `${label}, one line each`), area, row(button("Keep", () => { const items = area.value.split("\n").map((one) => one.trim()).filter(Boolean); if (items.length) (c.lines ??= {})[key] = items; else if (c.lines) { delete c.lines[key]; if (!Object.keys(c.lines).length) delete c.lines; } changed(); }, { class: "small" })));
  });
  fill(inspector, h2("In a fight"), ...fields, range("damage", "damage"), range("credits", "credits"),
    el("label", { for: "edit-fight-weapon" }, "weapon"), weapon,
    row(el("label", { for: "edit-fight-art" }, "drawn as"), art),
    el("label", { for: "edit-fight-tags" }, "tags, separated by commas"), tags,
    row(el("label", { for: "edit-fight-machine" }, "a machine"), machine, el("label", { for: "edit-fight-boss" }, "a boss"), boss),
    row(button("Keep these", () => { if (weapon.value.trim()) c.weapon = weapon.value.trim(); else delete c.weapon; if (art.value) c.art = art.value; else delete c.art; c.tags = tags.value.split(",").map((one) => one.trim()).filter(Boolean); if (machine.checked) c.machine = true; else delete c.machine; if (boss.checked) c.boss = true; else delete c.boss; changed(); })),
    pairsEditor(c, "onHit", "When they hit, the player also gets", ["stress", "energy"]),
    ...linesBoxes);
}
function daysRow(holder) {
  const days = picker("edit-days", [0, 1, 2, 3, 5, 7, 10, 14, 18, 20, 25, 30, 38, 45, 60, 75, 90, 120].map((one) => [String(one), one === 0 ? "the same day" : `${one} days`]), String(holder.after));
  if (![...days.options].some((one) => one.value === String(holder.after))) days.append(el("option", { value: String(holder.after), selected: "selected" }, `${holder.after} days`));
  days.value = String(holder.after);
  return row(el("label", { for: "edit-days" }, "After"), days, button("Keep", () => { holder.after = Number(days.value); changed(); }));
}
function placeRow(holder) {
  const place = picker("edit-place", [["", "the story's first place"], ...state.places.map((one) => [one.id, one.name])], holder.place ?? "");
  const big = checkBox("edit-big", holder.big);
  return row(el("label", { for: "edit-place" }, "Where"), place, el("label", { for: "edit-big" }, "everyone who knows the place hears it"), big, button("Keep", () => { if (place.value) holder.place = place.value; else delete holder.place; if (big.checked) holder.big = true; else delete holder.big; changed(); }));
}
function stageLeadRow(stage) {
  const area = textarea("edit-lead", stage.lead ?? "", 4);
  return fill(el("div", {}), el("label", { for: "edit-lead" }, "What the lead says from then on"), area, row(button("Keep", () => { const text = area.value.trim(); if (text) stage.lead = text; else delete stage.lead; changed(); })));
}
function stageEndingRow(stage) {
  const ending = picker("edit-ending", [["", "the story goes on"], ...endingIds().map((one) => [one, `it ends: ${spaced(one)}`])], stage.ending ?? "");
  return row(el("label", { for: "edit-ending" }, "And then"), ending, button("Keep", () => { if (ending.value) stage.ending = ending.value; else delete stage.ending; changed(); }));
}

function subFacts(holder) {
  const box = el("div", { class: "subfacts" });
  const draw = () => {
    box.replaceChildren(el("label", {}, "Facts it puts on the record"));
    for (const [name, line] of Object.entries(holder.facts ?? {})) {
      const input = textBox(`edit-subfact-${name}`, line);
      box.append(row(el("span", { class: "fact-name" }, spaced(name)), button("Remove", () => { delete holder.facts[name]; if (!Object.keys(holder.facts).length) delete holder.facts; changed(); }, { class: "danger small" })), input, row(button("Keep", () => { holder.facts[name] = input.value.trim(); changed(); })));
    }
    const pick = picker("edit-subfact", [["", "a fact of this story..."], ...Object.keys(S().gm.facts ?? {}).filter((name) => !holder.facts?.[name]).map((name) => [name, spaced(name)])], "");
    box.append(row(pick, button("+ add it", () => { if (!pick.value) return; (holder.facts ??= {})[pick.value] = S().gm.facts[pick.value]; changed(); })));
  };
  draw();
  return box;
}
function factAfterRow(node) {
  const story = S();
  const after = picker("edit-after-ending", [["", "any ending, or during the story"], ...endingIds().map((one) => [one, `after ${spaced(one)}`])], story.gm.factAfter?.[node.fact] ?? "");
  return row(el("label", { for: "edit-after-ending" }, "It comes"), after, button("Keep", () => { if (after.value) (story.gm.factAfter ??= {})[node.fact] = after.value; else delete story.gm.factAfter?.[node.fact]; changed(); }));
}

// A condition is picked from lists, never typed: if or unless, what kind of thing, and which one.
function conditionPicker(holder, key, label, canBeAlways = false) {
  const current = holder[key] ?? "";
  const parsed = parseCondition(current)[0] ?? { kind: "ended", rest: [state.id], not: false };
  const box = el("div", { class: "condition" });
  const kindPick = picker("cond-kind", [...(canBeAlways ? [["always", "always"]] : []), ["ended", "how a story ended"], ["flag", "a fact on the record"], ["captain", "the player is the captain"], ["act", "the act of the main story"]], current ? (["ended", "flag", "captain", "act"].includes(parsed.kind) ? parsed.kind : "ended") : (canBeAlways ? "always" : "ended"));
  const notPick = picker("cond-not", [["", "if"], ["not", "unless"]], parsed.not ? "not" : "");
  const storyPick = picker("cond-story", state.all.map((one) => [one.id, one.title]), parsed.kind === "ended" && state.all.some((one) => one.id === parsed.rest[0]) ? parsed.rest[0] : state.id);
  const endingPick = el("select", { id: "cond-ending" });
  const fillEndings = () => { endingPick.replaceChildren(el("option", { value: "" }, "any way")); for (const id of state.all.find((one) => one.id === storyPick.value)?.endings ?? []) endingPick.append(el("option", { value: id }, spaced(id))); };
  fillEndings();
  if (parsed.kind === "ended") endingPick.value = parsed.rest[1] ?? "";
  storyPick.addEventListener("change", fillEndings);
  const factPick = picker("cond-fact", state.facts.map((name) => [name, spaced(name)]), parsed.kind === "flag" && state.facts.includes(parsed.rest[0]) ? parsed.rest[0] : state.facts[0] ?? "");
  const actPick = picker("cond-act", [1, 2, 3, 4].map((one) => [String(one), `act ${one} or later`]), parsed.kind === "act" ? String(parsed.rest[1] ?? 2) : "2");
  const rows = { ended: row(storyPick, endingPick), flag: row(factPick), captain: hint("Only when the player is the captain."), act: row(actPick), always: hint("Whatever's on the record.") };
  const showRows = () => { for (const [kind, one] of Object.entries(rows)) one.hidden = kind !== kindPick.value; notPick.hidden = kindPick.value === "always"; };
  showRows();
  kindPick.addEventListener("change", showRows);
  const text = () => {
    const not = notPick.value ? "not " : "";
    if (kindPick.value === "always") return "";
    if (kindPick.value === "ended") return `${not}ended ${storyPick.value}${endingPick.value ? ` ${endingPick.value}` : ""}`;
    if (kindPick.value === "flag") return `${not}flag ${factPick.value}`;
    if (kindPick.value === "act") return `act >= ${actPick.value}`;
    return `${not}captain`;
  };
  const preview = hint("");
  const update = () => { preview.textContent = text() ? `In the file: ${text()}` : "Always."; };
  for (const pick of [kindPick, notPick, storyPick, endingPick, factPick, actPick]) pick.addEventListener("change", update);
  update();
  fill(box, el("label", {}, `${label}. Pick it, no typing.`), row(notPick, kindPick), ...Object.values(rows), preview, row(button("Keep", () => { const value = text(); if (value) holder[key] = value; else delete holder[key]; changed(); })));
  return box;
}

function inspectWire(inspector, wire, index) {
  const from = nodes.find((one) => one.id === wire.from), to = nodes.find((one) => one.id === wire.to);
  if (state.tab === "scene") return inspectChoice(inspector, wire);
  if (wire.stage !== undefined) {
    const stage = C().stages[wire.stage];
    return fill(inspector, h2("The clock"), hint(`From ${from?.name ?? "?"} to day ${stage.after}.`), wire.stage ? conditionPicker(stage, "if", "Only if", true) : hint("The clock starts from the lead when nobody takes the story up."));
  }
  fill(inspector, h2("An arrow"), hint(`From ${from?.name ?? "?"} to ${to?.name ?? "?"}. Click a box to change it.`));
}

// ---- The written scene, or a person's written lines --------------------------------------------------
function inspectPart(inspector, node) {
  if (node.kind === "stub") return fill(inspector, h2("Missing"), hint(`Something leads to a part called ${node.name}, and there's no part with that name in the file. Add it in the file, or point the arrow somewhere else.`));
  const part = state.scene.parts[node.part];
  const area = textarea("edit-part", part.raw, 14);
  fill(inspector,
    h2(node.label),
    el("h3", {}, part.name),
    el("label", { for: "edit-part" }, "The part, as it is in the file: its text, lines people say with @Name:, * effects, > choices and ? rules"),
    area,
    row(button("Keep", () => keepPart(node.part, area.value)), button("Undo", () => inspect())),
    row(button("+ a choice", () => keepPart(node.part, `${part.raw.replace(/\n+$/, "")}\n> Say what the player does -> ${state.scene.parts.find((one) => one.name !== part.name)?.name ?? part.name}\n`))),
    wires.some((one) => one.from === node.id) ? fill(el("div", { class: "choices" }), el("label", {}, "Where it leads"), ...wires.map((one, i) => (one.from === node.id ? button(`${one.words} → ${one.to.replace(/^p_/, "")}`, () => select({ wire: i }), { class: "small" }) : null))) : null,
    part.ai ? hint(`A note for the AI: ${part.ai}`) : null,
    node.problem ? el("div", { class: "problems" }, ...state.scene.problems.filter((one) => one.includes(`part ${part.name}`)).map((one) => el("div", {}, one))) : null,
    hint("Keep changes the part and the file together. Save writes the file, and it plays the new version from the next turn."));
}
async function keepPart(index, raw) {
  state.scene.parts[index].raw = raw;
  await refreshScene();
}
async function refreshScene() {
  state.sceneDirty = true;
  try {
    const view = await call(sceneRoute(), { check: true, text: sceneText() });
    state.scene = { ...state.scene, ...view };
    say(view.problems.length ? `${view.problems.length} ${view.problems.length === 1 ? "thing" : "things"} the checker would like changed. They're marked in red.` : "");
  } catch (err) {
    say(err.message, false);
  }
  redraw();
}
function inspectChoice(inspector, wire) {
  const part = state.scene.parts[wire.part];
  const to = nodes.find((one) => one.id === wire.to);
  const lineIndex = (line) => (line ? line - part.line - 1 : -1);
  const rawLines = part.raw.split("\n");
  let at = -1;
  if (wire.choice !== undefined) at = lineIndex(part.choices[wire.choice]?.line);
  else if (wire.rule !== undefined) at = lineIndex(part.when[wire.rule]?.line);
  if (at < 0 || at >= rawLines.length) return fill(inspector, h2("An arrow"), hint(`From ${part.name} to ${to?.name ?? "?"}: ${wire.words}. This one is changed in the part's own box.`));
  const line = textBox("edit-line", rawLines[at]);
  const parts = state.scene.parts.map((one) => [one.name, one.name]);
  const goes = wire.choice !== undefined && part.choices[wire.choice]?.check
    ? [picker("edit-pass", parts, part.choices[wire.choice].pass ?? ""), picker("edit-fail", parts, part.choices[wire.choice].fail ?? "")]
    : [picker("edit-goes", parts, wire.to.replace(/^p_/, ""))];
  const keep = () => {
    let text = line.value;
    if (goes.length === 2) text = text.replace(/->\s*\S+\s*\|\s*\S+/, `-> ${goes[0].value} | ${goes[1].value}`);
    else text = text.replace(/->\s*\S+/, `-> ${goes[0].value}`);
    rawLines[at] = text;
    keepPart(wire.part, rawLines.join("\n"));
  };
  fill(inspector,
    h2(wire.rule !== undefined ? "A rule" : "A choice"),
    hint(`From ${part.name}.`),
    el("label", { for: "edit-line" }, wire.rule !== undefined ? "The rule, as it is in the file: ? a condition -> the part it goes to" : "The choice, as it is in the file: > what the player can say or do -> the part it goes to"),
    line,
    goes.length === 2 ? [row(el("label", {}, "If the check passes, go to"), goes[0]), row(el("label", {}, "If it fails, go to"), goes[1])] : row(el("label", { for: "edit-goes" }, "Then the story goes to"), goes[0]),
    row(button("Keep", keep), button("Remove", () => { rawLines.splice(at, 1); keepPart(wire.part, rawLines.join("\n")); }, { class: "danger" })),
    hint("A check on a choice is written in brackets at the start of the line: [persuasion:hard] and the two parts, passed | failed."));
}

// ---- Saving --------------------------------------------------------------------------------------------
async function save() {
  try {
    if (state.tab === "scene" || (state.sceneDirty && !state.dirty)) {
      const result = await call(sceneRoute(), { text: sceneText() });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.sceneDirty = false;
      state.scene.problems = result.problems;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. It plays the new version from the next turn.");
    } else if (state.kind === "story") {
      const result = await call(`/api/board/story/${state.id}`, { text: writeStoryText(S(), C()) });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.dirty = false;
      state.problems = result.problems;
      state.stories = (await call("/api/board/stories")).stories;
      state.items = state.stories;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The game plays the new version from the next turn.");
    } else {
      const result = await call(`/api/board/world/${state.kind}/${state.id}`, { text: writeWorldText(state.item, SPECS[state.kind]) });
      if (!result.saved) return say(`Not saved: ${result.problems[0]}`, false);
      state.dirty = false;
      state.problems = result.problems;
      say(result.problems.length ? `Saved. ${result.problems.length} ${result.problems.length === 1 ? "thing" : "things"} the checker would like changed.` : "Saved. The game uses the new version from the next turn.");
    }
    redraw();
  } catch (err) {
    say(err.message, false);
  }
}
