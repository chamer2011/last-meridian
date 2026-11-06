// The skill check window: a set of consoles over the story, themed to whichever skill is being
// used. The game on the server decides everything, and this draws what it says. Everything
// can be clicked as well as typed, and nothing here is ever a race against the clock. It floats
// over the room like the game's other windows, with nothing dimmed behind it and the room's clock
// running on, it can be pulled aside with the mouse and slides back when it's let go, and a line
// runs from it to what the check is about (float.js).

import { api, el } from "./dom.js";
import { leaderNode, pullable } from "./float.js";
import { untagged } from "./story.js";

const check = {
  id: null,
  view: null,
  outcome: null,
  rolling: false,
  sim: null,
  seen: 0,
  draft: "",
  sending: false,
  wake: null,
  message: null,
  typed: [],
  typedAt: 0,
  advisor: true,
};

// What the check window needs from the main screen. Set once, when the page loads.
let app;

const PREFERENCE_KEY = "meridian-checks";
const ADVISOR_KEY = "meridian-advisor";
const DIFFICULTIES = ["easy", "moderate", "hard", "very_hard", "nearly_impossible"];

export function initCheck(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  try {
    check.advisor = localStorage.getItem(ADVISOR_KEY) !== "off";
  } catch {
    check.advisor = true;
  }
}

export const checkOpen = () => Boolean(check.view || check.outcome);

// Whether checks open as a game, or just roll. Remembered on this computer.
export function checkStyle() {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === "roll" ? "roll" : "play";
  } catch {
    return "play";
  }
}

export function setCheckStyle(style) {
  try {
    localStorage.setItem(PREFERENCE_KEY, style);
  } catch {
    // The window still works, it just won't remember.
  }
}

function closeCheck() {
  Object.assign(check, { id: null, view: null, outcome: null, rolling: false, seen: 0, draft: "", message: null, typed: [] });
}

export function resetCheck() {
  closeCheck();
  check.sim = null;
}

function sync() {
  if (check.outcome) return;
  const live = app.ui.game?.check ?? null;
  if (!live) {
    closeCheck();
    return;
  }
  if (live.id !== check.id) {
    closeCheck();
    check.id = live.id;
    // Practice is how a player tries a window out, so it always opens one.
    if (checkStyle() === "roll" && !live.training) setTimeout(() => send("roll"), 0);
  }
  check.view = live;
}

// ---- Console text --------------------------------------------------------

function pieceNode(piece) {
  if (typeof piece === "string") return piece;
  if (piece.cmd) {
    return el("button", {
      class: `check-link tone-${piece.tone ?? "link"}`,
      ...(piece.title ? { title: piece.title } : {}),
      disabled: check.sending,
      onclick: (event) => {
        event.stopPropagation();
        send(piece.cmd);
      },
    }, piece.t);
  }
  return el("span", { class: `tone-${piece.tone ?? "info"}` }, piece.t);
}

const lineNode = (pieces) => el("div", { class: "check-line" }, (Array.isArray(pieces) ? pieces : [pieces]).map(pieceNode));

function logLine(entry, isNew) {
  if (entry.you !== undefined) return el("div", { class: `check-line you${isNew ? " new" : ""}` }, el("span", { class: "tone-dim" }, `${check.view?.prompt ?? ">"} `), el("span", { class: "tone-bright" }, entry.you));
  return el("div", { class: `check-line tone-${entry.tone ?? "info"}${isNew ? " new" : ""}` }, entry.text);
}

function panelNode(panel, log) {
  const body = panel.terminal
    ? el("div", { class: "check-panel-body check-log", id: "check-log", role: "log" }, log.map((entry, i) => logLine(entry, i >= check.seen)))
    : el("div", { class: `check-panel-body${panel.grid ? " grid" : ""}` }, panel.lines.map(lineNode));
  return el("section", { class: `check-panel${panel.terminal ? " terminal" : ""}${panel.wide ? " wide" : ""}` },
    el("header", { class: "check-panel-title" }, el("span", {}, panel.title), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    body);
}

// ---- The window ----------------------------------------------------------

const toneForOdds = (odds) => (odds >= 65 ? "good" : odds <= 35 ? "bad" : "warn");

function oddsBar(odds) {
  const filled = Math.round(odds / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

const breakdownTitle = (view) => [...view.parts.map((part) => `${part.label} ${part.value >= 0 ? "+" : ""}${part.value}`), `your work ${view.edge >= 0 ? "+" : ""}${view.edge}`, `against ${view.dc}`].join(", ");

function meterNode(meter) {
  return el("span", { class: `check-meter tone-${meter.tone}` }, `${meter.label} ${meter.text ?? `${meter.value}/${meter.max}`}`);
}

function commandsNode(view) {
  const numbered = view.commands.map((entry, i) => el("button", {
    class: "check-command",
    disabled: entry.disabled || check.sending,
    title: entry.hint || entry.label,
    onclick: (event) => {
      event.stopPropagation();
      send(entry.command);
    },
  }, !view.typedNumbers && el("span", { class: "check-key" }, `${i + 1}`), ` ${entry.label}`, entry.hint && el("span", { class: "check-hint" }, ` ${entry.hint}`)));
  return el("div", { class: "check-commands" }, numbered);
}

function inputNode(view) {
  return el("div", { class: "check-prompt" },
    el("label", { for: "check-input", class: "tone-dim" }, view.prompt),
    el("input", {
      id: "check-input",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: view.decided ? "type a word, or click one" : view.done ? "press Enter when you're ready" : "type a command, or click one",
      value: check.draft,
      oninput: (event) => { check.draft = event.target.value; },
      onkeydown: onInputKey,
    }),
    // A decided game has no roll to make, so there's nothing to press.
    !view.decided && el("button", {
      class: "check-run primary",
      disabled: check.sending,
      title: "Make the final roll, at the odds showing now",
      onclick: (event) => {
        event.stopPropagation();
        send("run");
      },
    }, `${view.runLabel}: ${view.odds}%`));
}

// The advisor: hints by the player's training, on a panel that slides in from the right. Its tab
// slides it away and back, and the choice is remembered on this computer.
function toggleAdvisor() {
  check.advisor = !check.advisor;
  try {
    localStorage.setItem(ADVISOR_KEY, check.advisor ? "on" : "off");
  } catch {
    // It still works, it just won't remember.
  }
  draw();
}

function advisorNode(view) {
  if (!view.hints?.length) return null;
  const shown = check.advisor;
  return el("aside", { class: `check-advisor${shown ? " in" : ""}`, id: "check-advisor", "aria-label": "Hints" },
    el("button", { class: "check-advisor-tab", title: shown ? "Slide the hints away" : "Bring the hints back", "aria-expanded": String(shown), onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, shown ? ">" : "<"),
    el("div", { class: "check-advisor-body" },
      el("header", { class: "check-panel-title" }, el("span", {}, `ADVISOR: ${view.tierName.toUpperCase()}`), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
      el("div", { class: "check-advisor-lines", id: "check-hints" }, view.hints.map((line) => el("div", { class: "check-line" }, line)))));
}

// What the title bar says about how hard this is: the class of computer for a hack, the difficulty word for the rest.
const hardness = (view) => (view.classLabel ?? view.difficulty.replace("_", " ")).toUpperCase();

function windowNode() {
  const view = check.view;
  const moved = view.odds !== view.baseOdds;
  return el("div", { class: `check-window${view.decided ? " decided" : ""}`, id: "check-window", "data-theme": view.theme, role: "dialog", "aria-label": view.window, tabindex: "-1" },
    el("pre", { class: "check-rain", "aria-hidden": "true" }, rainFor(view.id)),
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, view.window),
      el("span", { class: "check-skill" }, `${view.skillName}, ${view.tierName}`),
      el("span", { class: "check-difficulty", title: view.difficulty.replace("_", " ") }, view.training ? `PRACTICE: ${hardness(view)}` : hardness(view)),
      el("button", { class: "mobile-toggle", onclick: (event) => { event.stopPropagation(); app.openMenu(app.ui.tab); } }, "Menu")),
    el("div", { class: "check-situation" },
      el("div", { class: "tone-bright" }, `> ${view.reason}`),
      view.scene && el("div", { class: "check-scene" }, view.scene)),
    el("div", { class: "check-body" },
      el("div", { class: "check-desk", "data-count": String(view.panels.length) }, view.panels.map((panel) => panelNode(panel, view.log))),
      advisorNode(view)),
    check.message && el("div", { class: "notice-inline fail" }, check.message),
    el("div", { class: "check-controls" }, commandsNode(view), inputNode(view)),
    el("footer", { class: "check-taskbar" },
      el("span", { class: "check-start" }, "Start"),
      view.panels.map((panel) => el("span", { class: "check-tab" }, panel.title)),
      el("span", { class: "check-spacer" }),
      view.meters.map(meterNode),
      !view.decided && el("span", { class: `check-odds tone-${toneForOdds(view.odds)}`, title: breakdownTitle(view) }, `ODDS ${moved ? `${view.baseOdds}% -> ` : ""}${view.odds}% ${oddsBar(view.odds)}`)));
}

// ---- How it came out -----------------------------------------------------

function resultNode() {
  const outcome = check.outcome;
  const settled = !check.rolling;
  const tone = outcome.success ? "good" : "bad";
  const harder = DIFFICULTIES[DIFFICULTIES.indexOf(outcome.difficulty) + 1];
  const choices = outcome.training
    ? [["Try it again", () => again(outcome.difficulty)], harder && ["Try something harder", () => again(harder), harder.replace("_", " ")], ["Close", () => closeWindow()]].filter(Boolean)
    : [["Continue the story", () => continueStory(), "the game master picks it up from here"], ["Close, and look around first", () => closeWindow()]];
  return el("div", { class: "check-window check-result", id: "check-window", "data-theme": outcome.theme, role: "dialog", "aria-label": outcome.window, tabindex: "-1", onclick: skipRoll },
    el("pre", { class: "check-rain", "aria-hidden": "true" }, rainFor(outcome.id)),
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, outcome.window),
      el("span", { class: "check-difficulty" }, outcome.training ? `PRACTICE: ${hardness(outcome)}` : hardness(outcome))),
    el("div", { class: "check-situation" }, el("div", { class: "tone-bright" }, `> ${outcome.reason}`)),
    el("div", { class: "check-verdict" },
      settled
        ? el("div", { class: `check-verdict-title tone-${tone}` }, outcome.title)
        : el("div", { class: "check-verdict-title tone-warn", id: "check-die" }, "ROLLING ..."),
      settled && [
        outcome.line && el("div", { class: "check-verdict-line" }, outcome.line),
        el("div", { class: "check-verdict-math" }, `${outcome.label}: ${outcome.math}`),
        outcome.notes?.map((note) => el("div", { class: "tone-good" }, untagged(note))),
        el("div", { class: "options" }, choices.map(([label, run, detail], i) => el("button", {
          "data-choice": String(i + 1),
          onclick: (event) => {
            event.stopPropagation();
            run();
          },
        }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label), detail && el("span", { class: "option-detail" }, detail)))),
      ]));
}

// A little suspense before the result. A click skips it, and so does asking for less motion. A
// decided game has no roll to wait for.
function showResult(outcome) {
  check.outcome = outcome;
  check.view = null;
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (calm || outcome.decided) {
    app.render();
    return;
  }
  check.rolling = true;
  app.render();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    const die = document.getElementById("check-die");
    if (die) die.textContent = `ROLLING ... ${1 + Math.floor(Math.random() * 20)}`;
    if (ticks >= 9) check.wake?.();
  }, 90);
  check.wake = () => {
    clearInterval(timer);
    check.wake = null;
    check.rolling = false;
    draw();
  };
}

function skipRoll() {
  check.wake?.();
}

function closeWindow() {
  closeCheck();
  app.render();
}

function continueStory() {
  closeCheck();
  app.sendChat({ event: "continue" });
}

async function again(difficulty) {
  const { skill } = check.outcome;
  closeCheck();
  await startPractice(skill, difficulty);
  app.render();
}

// ---- Commands -------------------------------------------------------------

async function send(command) {
  if (check.sending || check.outcome || !check.view) return;
  check.sending = true;
  check.message = null;
  check.seen = check.view.log.length;
  try {
    const reply = await api("/api/check", { command });
    app.ui.game = reply.game;
    check.sending = false;
    if (reply.over) {
      // A hack that got in goes straight to the computer: the screen becomes the system's own.
      if (reply.game.computer) {
        closeCheck();
        app.render();
        return;
      }
      showResult(reply.outcome);
      return;
    }
    check.view = reply.game.check;
    draw();
  } catch (err) {
    check.sending = false;
    check.message = err.message;
    draw();
  }
}

function onInputKey(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    const text = check.draft.trim();
    check.draft = "";
    if (text) {
      send(text);
    } else {
      const entry = check.view.commands.find((one) => one.key === "Enter");
      if (entry) send(entry.command);
      else if (check.view.done) send("run");
    }
  }
}

function onKey(event) {
  if (app.ui.screen !== "game" || !checkOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (check.outcome) {
    if (check.rolling) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        skipRoll();
      }
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      document.querySelector(`#check [data-choice="${event.key}"]`)?.click();
    }
    return;
  }
  const typing = event.target.matches?.("input") && check.draft.length > 0;
  if (typing) return;
  const commands = check.view?.commands ?? [];
  const byKey = commands.find((entry) => entry.key === event.key && !entry.disabled);
  if (byKey && event.key !== "Enter") {
    event.preventDefault();
    send(byKey.command);
    return;
  }
  if (/^[1-9]$/.test(event.key) && !check.view?.typedNumbers) {
    const entry = commands[Number(event.key) - 1];
    if (entry && !entry.disabled) {
      event.preventDefault();
      send(entry.command);
      return;
    }
  }
  // A click on a panel takes the keyboard off the console, and typing should bring it back.
  if (event.key.length === 1 && !event.target.matches?.("input")) document.getElementById("check-input")?.focus();
}

// ---- Drawing --------------------------------------------------------------

// The faint rain of characters behind the consoles. It's the same each time for the same check.
function rainFor(seed) {
  let n = Number(seed) % 2147483647 || 7;
  const next = () => {
    n = (n * 48271) % 2147483647;
    return n;
  };
  const rows = [];
  for (let i = 0; i < 70; i += 1) {
    let row = "";
    for (let j = 0; j < 150; j += 1) row += next() % 5 === 0 ? String(next() % 2) : " ";
    rows.push(row);
  }
  return rows.join("\n");
}

export function checkNode() {
  sync();
  if (!checkOpen()) return null;
  // The line points at what the check is about, through to its result.
  const target = check.outcome ? check.outcome.target : check.view?.target;
  return el("div", { class: "check-float", id: "check" }, leaderNode(target), pullable(check.outcome ? resultNode() : windowNode()));
}

function draw() {
  const node = checkNode();
  const current = document.getElementById("check");
  if (current && node) current.replaceWith(node);
  focusCheck();
}

// Puts the keyboard on the console, and shows the latest of what's been said.
export function focusCheck() {
  const log = document.getElementById("check-log");
  if (log) log.scrollTop = log.scrollHeight;
  if (app.ui.sideOpen) return;
  const input = document.getElementById("check-input");
  if (input) input.focus({ preventScroll: true });
  else document.getElementById("check-window")?.focus({ preventScroll: true });
}

// The player clicked a choice tagged with a check, so its window opens instead of calling the AI.
export async function startChoiceCheck(label) {
  const { game } = await api("/api/check/start", { label });
  app.ui.game = game;
}

export async function startPractice(skill, difficulty = "moderate") {
  const { game } = await api("/api/check/start", { practice: skill, difficulty });
  app.ui.game = game;
  app.closeMenu();
}
