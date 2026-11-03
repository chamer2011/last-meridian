// The talk window: a console over the map, where the captain talks to one person. Opening it,
// closing it and passing on rumors are free. Each thing said goes to the AI as an ordinary turn,
// with the clock stopped. Everything can be clicked, and typing is only there if it's wanted.

import { trimmedArt } from "./art.js";
import { api, el, money, readLines, signed } from "./dom.js";
import { choicesFor, optionContent, storyEntryNode, thinkingNode } from "./story-view.js";
import { WRITING_SPEEDS, holdBack, newPen } from "./writer.js";

const talk = { draft: "", sending: false, live: "", heard: null, message: null, spent: 0, lastId: null, logged: 0, writing: false, words: null, wordsOn: null };

const pen = newPen({
  speed: () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? Infinity : WRITING_SPEEDS[app.reading.writing] ?? WRITING_SPEEDS.normal),
  draw: (count) => talk.words?.show(count),
});

// What the window needs from the main screen. Set once, when the page loads.
let app;

export function initTalk(hooks) {
  app = hooks;
  // This listens first, so that Esc closes a menu over the window before it closes the window.
  document.addEventListener("keydown", onKey, true);
}

export const talkOpen = () => Boolean(app?.ui.game?.talk);

export function resetTalk() {
  pen.stop();
  Object.assign(talk, { draft: "", sending: false, live: "", heard: null, message: null, spent: 0, lastId: null, logged: 0, writing: false, words: null, wordsOn: null });
}

// What someone says is written out as it comes. It's always the newest thing they've said.
function writeThis(node) {
  node.querySelector(".cursor")?.remove();
  if (node !== talk.wordsOn) {
    talk.words = holdBack(node, { skip: ".speaker-line" });
    talk.wordsOn = node;
  }
  pen.aim(talk.words.total);
}

function writeNewest() {
  const view = app.ui.game?.talk;
  const log = document.getElementById("talk-log");
  if (!view || !log || talk.sending) return;
  if (view.log.slice(talk.logged).some((entry) => entry.role === "narrator")) {
    pen.start();
    talk.writing = true;
  }
  talk.logged = view.log.length;
  if (!talk.writing) return;
  const said = [...log.children].filter((one) => one.matches(".passage")).at(-1);
  if (said) writeThis(said);
  talk.writing = pen.busy;
}

// ---- Saying things ------------------------------------------------------

function draw() {
  const node = talkNode();
  const current = document.getElementById("talk");
  if (current && node) current.replaceWith(node);
  focusTalk();
}

function updateLive() {
  const live = document.getElementById("talk-live");
  if (!live) return;
  const entries = [talk.heard && { role: "player", text: talk.heard }, talk.live && { role: "narrator", text: talk.live }].filter(Boolean);
  const nodes = entries.map((entry, i) => storyEntryNode(entry, { streaming: talk.sending && i === entries.length - 1 && entry.role === "narrator" })).filter(Boolean);
  if (talk.sending && !talk.live) nodes.push(thinkingNode());
  live.replaceChildren(...nodes);
  const log = document.getElementById("talk-log");
  const said = talk.live && live.querySelector(".passage");
  if (said) writeThis(said);
  else if (log) log.scrollTop = log.scrollHeight;
}

async function say(text) {
  const line = text.trim();
  if (!line || talk.sending) return;
  Object.assign(talk, { sending: true, heard: line, live: "", draft: "", message: null, writing: true, words: null });
  pen.start();
  app.ui.streaming = true;
  app.render();
  updateLive();
  const handle = (raw) => {
    if (!raw.trim()) return;
    const msg = JSON.parse(raw);
    if (msg.type === "text") {
      talk.live += msg.text;
      updateLive();
    } else if (msg.type === "state") {
      app.ui.game = msg.state;
    } else if (msg.type === "done") {
      app.ui.game = msg.state;
      app.ui.settings.spending = msg.spending;
      talk.spent += msg.spending.lastTurn ?? 0;
    } else if (msg.type === "error") {
      app.ui.game = msg.state;
      app.ui.settings.spending = msg.spending;
      talk.message = msg.message;
      talk.draft = line;
    }
  };
  try {
    const res = await fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "say", text: line }) });
    if (!res.ok) throw new Error((await res.json()).error ?? "Something went wrong.");
    await readLines(res, handle);
  } catch (err) {
    talk.message = err.message;
    talk.draft = line;
  }
  Object.assign(talk, { sending: false, heard: null, live: "", logged: app.ui.game?.talk?.log.length ?? 0, writing: pen.busy });
  app.ui.streaming = false;
  app.render();
}

async function order(body) {
  if (talk.sending) return;
  talk.message = null;
  try {
    const { game } = await api("/api/talk", body);
    app.ui.game = game;
  } catch (err) {
    // Without a window open, the story panel is where it can be seen.
    if (talkOpen()) talk.message = err.message;
    else app.ui.consoleLines = [{ role: "error", text: err.message }];
  }
  app.render();
}

// Walking up to someone opens this. Nothing's said to the AI until the player says something.
export function startTalk(key) {
  talk.spent = 0;
  return order({ action: "open", person: key });
}

export function endTalk() {
  return order({ action: "close" });
}

// ---- The window ---------------------------------------------------------

const ATTITUDES = ["hostile", "wary", "neutral", "friendly", "ally"];
const THEMES = { hostile: "red", wary: "amber", neutral: "teal", friendly: "green", ally: "green" };

function feelingNode(view) {
  if (!view.attitude) return el("div", { class: "talk-feeling tone-dim" }, "You haven't really met.");
  const filled = (ATTITUDES.indexOf(view.attitude) + 1) * 2;
  return el("div", { class: "talk-feeling" },
    el("div", {}, `FEELS ${view.attitude.toUpperCase()}`),
    el("div", {}, `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`),
    view.relationship !== 0 && el("div", { class: "tone-dim" }, `${signed(view.relationship)} on social checks`));
}

function personPanel(view) {
  return el("section", { class: "check-panel talk-person", style: `--speaker:${view.color}` },
    el("header", { class: "check-panel-title" }, el("span", {}, "PERSONNEL"), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    el("div", { class: "check-panel-body talk-person-body" },
      el("pre", { class: "talk-art", "aria-hidden": "true" }, trimmedArt(view.art).join("\n")),
      el("div", { class: "talk-name" }, view.name),
      view.role && el("div", { class: "tone-dim" }, view.role),
      view.doing && el("div", { class: "talk-doing tone-dim" }, `${view.doing[0].toUpperCase()}${view.doing.slice(1)}, when you came over.`),
      feelingNode(view),
      view.note && el("div", { class: "talk-note" }, view.note)));
}

function logPanel(view) {
  return el("section", { class: "check-panel terminal talk-log-panel" },
    el("header", { class: "check-panel-title" }, el("span", {}, `TALKING WITH ${view.short.toUpperCase()}`), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    el("div", { class: "talk-log", id: "talk-log", role: "log", onclick: (event) => { if (!event.target.closest("[data-lore], summary")) pen.finish(); } },
      view.log.map((entry) => storyEntryNode(entry)),
      el("div", { id: "talk-live" })));
}

// What the person just offered comes first, then what the map file suggests, then the free ones.
function optionsFor(view) {
  const offered = view.lastReply ? choicesFor([{ role: "narrator", text: view.lastReply }]) : [];
  const shown = new Set(offered.map((choice) => choice.label));
  const asks = view.asks.filter((ask) => !shown.has(ask)).slice(0, offered.length ? 1 : 3);
  const withCheck = (choice) => choice.tags?.some((tag) => tag.kind === "check" && tag.difficulty);
  return [
    ...offered.map((choice) => ({ ...choice, ...(view.written && view.typed ? { detail: "free" } : {}), run: () => (withCheck(choice) ? order({ action: "check", label: choice.label }) : say(choice.label)) })),
    ...asks.map((ask) => ({ label: ask, run: () => say(ask) })),
    view.rumors > 0 && { label: view.rumorLabel, detail: "free", run: () => order({ action: "rumor" }) },
    { label: view.goodbyeLabel, detail: "free", run: endTalk },
  ].filter(Boolean);
}

function optionsNode(view) {
  return el("div", { class: "options talk-options" }, optionsFor(view).map((option, i) => el("button", {
    "data-choice": String(i + 1),
    disabled: talk.sending,
    onclick: option.run,
  }, el("span", { class: "option-number" }, `${i + 1})`), optionContent(option))));
}

function inputNode() {
  return el("div", { class: "check-prompt" },
    el("label", { for: "talk-input", class: "tone-dim" }, "say>"),
    el("input", {
      id: "talk-input",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "or type your own words, if you'd like",
      value: talk.draft,
      disabled: talk.sending,
      oninput: (event) => { talk.draft = event.target.value; },
      onkeydown: (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          say(talk.draft);
        }
      },
    }),
    el("button", { class: "check-run", disabled: talk.sending, onclick: () => say(talk.draft) }, "Say it"));
}

// What the footer says about what costs what.
function talkHint(view) {
  if (!view.written) return "Each thing you say is one call to the AI. Free ones are marked.";
  if (view.typed) return "A written conversation: the listed lines are free. Your own words are one call to the AI.";
  return "A written conversation. Nothing here uses the AI, so it's all free.";
}

export function talkNode() {
  const view = app.ui.game?.talk;
  if (!view) return null;
  if (view.id !== talk.lastId) {
    talk.lastId = view.id;
    talk.spent = 0;
    talk.logged = 0;
  }
  return el("div", { class: "check-overlay", id: "talk" },
    el("div", { class: "check-window talk-window", id: "talk-window", "data-theme": THEMES[view.attitude] ?? "blue", role: "dialog", "aria-label": `Talking with ${view.name}`, tabindex: "-1" },
      el("header", { class: "check-title" },
        el("span", { class: "check-name" }, view.name),
        el("span", { class: "check-skill" }, view.where),
        el("span", { class: "check-difficulty" }, "THE CLOCK IS STOPPED"),
        el("button", { class: "mobile-toggle", onclick: () => app.openMenu(app.ui.tab) }, "Menu")),
      el("div", { class: "talk-desk" }, personPanel(view), logPanel(view)),
      talk.message && el("div", { class: "notice-inline fail talk-message" }, talk.message),
      el("div", { class: "check-controls" }, optionsNode(view), view.typed && inputNode()),
      el("footer", { class: "check-taskbar" },
        el("span", { class: "check-hint" }, talkHint(view)),
        el("span", { class: "check-spacer" }),
        el("span", { class: "check-meter" }, `THIS TALK ${money(talk.spent)}`))));
}

// Puts the keyboard on the typing line, and shows the latest of what's been said.
export function focusTalk() {
  const log = document.getElementById("talk-log");
  if (log) log.scrollTop = log.scrollHeight;
  writeNewest();
  if (app.ui.sideOpen) return;
  document.getElementById("talk-input")?.focus({ preventScroll: true });
}

function onKey(event) {
  if (app.ui.screen !== "game" || !talkOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.ui.game.combat || app.ui.game.check) return;
  if (event.key === "Escape") {
    if (!talk.sending) endTalk();
    return;
  }
  if (talk.sending || talk.draft.length > 0 || !/^[1-9]$/.test(event.key)) return;
  const choice = document.querySelector(`#talk [data-choice="${event.key}"]`);
  if (choice) {
    event.preventDefault();
    choice.click();
  }
}
