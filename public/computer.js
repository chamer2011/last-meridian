// The computer window: a console over the room, for a computer the player has got into. The game
// on the server holds everything and decides everything; this draws what it says and sends what's
// clicked or typed. What's on the computer is down the left, the screen is in the middle, the
// advisor's hints slide in on the right, and a console at the bottom keeps what's been done.

import { api, el } from "./dom.js";

const comp = { id: null, view: null, sending: false, draft: "", message: null, seen: 0, advisor: true };

// What the window needs from the main screen. Set once, when the page loads.
let app;

const ADVISOR_KEY = "meridian-advisor";

export function initComputer(hooks) {
  app = hooks;
  // This listens first, so that Esc closes a menu over the window before it logs off.
  document.addEventListener("keydown", onKey, true);
  try {
    comp.advisor = localStorage.getItem(ADVISOR_KEY) !== "off";
  } catch {
    comp.advisor = true;
  }
}

export const computerOpen = () => Boolean(app?.ui.game?.computer);

export function resetComputer() {
  Object.assign(comp, { id: null, view: null, sending: false, draft: "", message: null, seen: 0 });
}

function sync() {
  const live = app.ui.game?.computer ?? null;
  if (!live) {
    resetComputer();
    return;
  }
  if (live.id !== comp.id) Object.assign(comp, { id: live.id, draft: "", message: null, seen: 0 });
  comp.view = live;
}

// ---- Talking to the server ----------------------------------------------

async function send(body) {
  if (comp.sending || !comp.view) return;
  comp.sending = true;
  comp.message = null;
  comp.seen = comp.view.log.length;
  try {
    const reply = await api("/api/computer", body);
    app.ui.game = reply.game;
    comp.sending = false;
    if (reply.said) comp.message = reply.said;
    // The whole page, because logging off, being thrown out, or reaching for another computer changes more than this window.
    app.render();
  } catch (err) {
    comp.sending = false;
    comp.message = err.message;
    draw();
  }
}

const logOff = () => send({ action: "logoff" });

// ---- The window -----------------------------------------------------------

function toggleAdvisor() {
  comp.advisor = !comp.advisor;
  try {
    localStorage.setItem(ADVISOR_KEY, comp.advisor ? "on" : "off");
  } catch {
    // It still works, it just won't remember.
  }
  draw();
}

const lineNode = (entry, isNew = false) => {
  if (entry.you !== undefined) return el("div", { class: `check-line you${isNew ? " new" : ""}` }, el("span", { class: "tone-dim" }, `${comp.view?.prompt ?? ">"} `), el("span", { class: "tone-bright" }, entry.you));
  return el("div", { class: `check-line tone-${entry.tone ?? "info"}${isNew ? " new" : ""}` }, entry.text);
};

function sectionNode(title, items, kind) {
  if (!items.length) return null;
  const { screen } = comp.view;
  return el("section", { class: "computer-section" },
    el("header", { class: "check-panel-title" }, el("span", {}, title), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, String(items.length))),
    el("div", { class: "computer-list" }, items.map((item) => el("button", {
      class: `check-link computer-item${item.read || item.ran ? " done" : ""}${screen.kind === kind && screen.id === item.id ? " open" : ""}`,
      title: item.about ? `${item.about}` : item.ran ? "Already run" : item.read ? "Read" : item.name,
      disabled: comp.sending,
      onclick: (event) => {
        event.stopPropagation();
        send({ action: kind, id: item.id });
      },
    }, el("span", { class: "computer-mark", "aria-hidden": "true" }, item.ran ? "x" : item.read ? "-" : item.known === false ? "?" : ">"), ` ${item.name}`, item.className && el("span", { class: "check-hint" }, ` ${item.className.toLowerCase()}${item.known ? ", open to you" : ""}`)))));
}

// The place's systems this computer runs, down the left with the rest.
function systemsSection(view) {
  if (!view.systems?.length) return null;
  const { screen } = view;
  return el("section", { class: "computer-section" },
    el("header", { class: "check-panel-title" }, el("span", {}, "Systems"), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, String(view.systems.length))),
    el("div", { class: "computer-list" }, view.systems.map((system) => {
      const down = system.rows.filter((row) => !row.works).length;
      return el("button", {
        class: `check-link computer-item${screen.kind === "system" && screen.id === system.id ? " open" : ""}`,
        title: `${system.rows.length} ${system.rows.length === 1 ? "part" : "parts"}${down ? `, ${down} not working` : ""}`,
        disabled: comp.sending,
        onclick: (event) => {
          event.stopPropagation();
          send({ action: "show", id: system.id });
        },
      }, el("span", { class: "computer-mark", "aria-hidden": "true" }, down ? "!" : "#"), ` ${system.title}`, down ? el("span", { class: "check-hint" }, ` ${down} down`) : null);
    })));
}

// One system: each part's state, what a camera sees, and the buttons that switch things from here.
function systemScreen(view, screen) {
  const system = view.systems?.find((one) => one.id === screen.id);
  if (!system) return [el("div", { class: "computer-screen-title" }, screen.title ?? "Systems"), el("div", { class: "tone-dim" }, "This computer doesn't run that any more.")];
  return [
    el("div", { class: "computer-screen-title" }, system.title),
    el("div", { class: "computer-rows" }, system.rows.map((row) => el("div", { class: `computer-row${row.works ? "" : " down"}` },
      el("div", { class: "computer-row-head" },
        el("span", { class: "computer-row-name tone-bright" }, row.name),
        el("span", { class: `computer-row-word tone-${row.word === "ringing" ? "bad" : row.works ? "good" : "warn"}` }, row.word.toUpperCase())),
      row.detail && el("div", { class: "tone-dim" }, row.detail),
      row.feed && el("div", { class: "computer-row-feed tone-dim" }, row.feed.length ? `On camera: ${row.feed.join(", ")}` : "On camera: nobody"),
      row.actions.length > 0 && el("div", { class: "computer-row-actions" }, row.actions.map((action) => el("button", {
        class: "check-link tone-link",
        disabled: comp.sending,
        onclick: (event) => {
          event.stopPropagation();
          send({ action: "system", system: system.id, row: row.id, to: action.to });
        },
      }, `[ ${action.label} ]`)))))),
  ];
}

function listScreen(title, items, kind, empty) {
  return [
    el("div", { class: "computer-screen-title" }, title),
    items.length
      ? items.map((item) => el("div", { class: "check-line" }, el("button", { class: "check-link tone-link", disabled: comp.sending, onclick: (event) => { event.stopPropagation(); send({ action: kind, id: item.id }); } }, item.name), item.about && el("span", { class: "tone-dim" }, `  ${item.about}`)))
      : el("div", { class: "tone-dim" }, empty),
  ];
}

function screenNode(view) {
  const { screen } = view;
  switch (screen.kind) {
    case "home":
      return [
        el("div", { class: "computer-screen-title" }, view.name),
        el("div", { class: "tone-bright" }, view.desc),
        el("div", { class: "tone-dim" }, `${view.files.length} files, ${view.mail.length} letters, ${view.logs.length} logs, ${view.programs.length} programs${view.network.length ? `, ${view.network.length} on the network` : ""}. Click one on the left.`),
        view.systems?.length > 0 && el("div", { class: "tone-dim" }, `It runs ${view.systems.map((one) => one.title.toLowerCase()).join(", ")} here.`),
      ];
    case "mail": return listScreen("Mail", view.mail, "mail", "No letters.");
    case "logs": return listScreen("Logs", view.logs, "log", "No logs.");
    case "network": return listScreen("Network", view.network, "connect", "Nothing reachable from here.");
    case "system": return systemScreen(view, screen);
    default:
      return [
        el("div", { class: "computer-screen-title" }, screen.title ?? ""),
        (screen.lines ?? []).map((entry) => el("div", { class: `check-line tone-${entry.tone ?? "info"}` }, entry.text)),
      ];
  }
}

function advisorNode(view) {
  if (!view.hints?.length) return null;
  const shown = comp.advisor;
  return el("aside", { class: `check-advisor${shown ? " in" : ""}`, id: "computer-advisor", "aria-label": "Hints" },
    el("button", { class: "check-advisor-tab", title: shown ? "Slide the hints away" : "Bring the hints back", "aria-expanded": String(shown), onclick: (event) => { event.stopPropagation(); toggleAdvisor(); } }, shown ? ">" : "<"),
    el("div", { class: "check-advisor-body" },
      el("header", { class: "check-panel-title" }, el("span", {}, `ADVISOR: ${view.tierName.toUpperCase()}`), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
      el("div", { class: "check-advisor-lines", id: "computer-hints" }, view.hints.map((text) => el("div", { class: "check-line" }, text)))));
}

function inputNode(view) {
  return el("div", { class: "check-prompt" },
    el("label", { for: "computer-input", class: "tone-dim" }, view.prompt),
    el("input", {
      id: "computer-input",
      type: "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: "type a command, or click what's on the left",
      value: comp.draft,
      disabled: comp.sending,
      oninput: (event) => { comp.draft = event.target.value; },
      onkeydown: (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const text = comp.draft.trim();
        comp.draft = "";
        if (text) send({ action: "type", text });
      },
    }),
    el("button", { class: "check-run", disabled: comp.sending, title: "Log off, or press Esc", onclick: (event) => { event.stopPropagation(); logOff(); } }, "Log off"));
}

function windowNode() {
  const view = comp.view;
  const pct = view.maxTrace ? Math.round((view.trace / view.maxTrace) * 100) : 0;
  return el("div", { class: "check-window computer-window", id: "computer-window", "data-theme": view.theme, role: "dialog", "aria-label": view.name, tabindex: "-1" },
    el("header", { class: "check-title" },
      el("span", { class: "check-name" }, view.name),
      el("span", { class: "check-skill" }, view.hacked ? "hacked" : view.yours ? "yours" : "logged in"),
      el("span", { class: "check-difficulty" }, view.className.toUpperCase()),
      el("button", { class: "mobile-toggle", onclick: (event) => { event.stopPropagation(); app.openMenu(app.ui.tab); } }, "Menu")),
    el("div", { class: "computer-body" },
      el("div", { class: "computer-side" },
        systemsSection(view),
        sectionNode("Files", view.files, "file"),
        sectionNode("Mail", view.mail, "mail"),
        sectionNode("Logs", view.logs, "log"),
        sectionNode("Programs", view.programs, "program"),
        sectionNode("Network", view.network, "connect")),
      el("div", { class: "computer-main" },
        el("div", { class: "computer-screen", id: "computer-screen" }, screenNode(view)),
        el("div", { class: "check-log computer-console", id: "computer-console", role: "log" }, view.log.map((entry, i) => lineNode(entry, i >= comp.seen)))),
      advisorNode(view)),
    comp.message && el("div", { class: "notice-inline fail" }, comp.message),
    el("div", { class: "check-controls" }, inputNode(view)),
    el("footer", { class: "check-taskbar" },
      el("span", { class: "check-start" }, "Start"),
      ["Files", "Mail", "Logs", "Programs"].map((name) => el("span", { class: "check-tab" }, name)),
      el("span", { class: "check-spacer" }),
      el("span", { class: "check-meter tone-dim" }, `${view.actions} ${view.actions === 1 ? "action" : "actions"}`),
      view.hacked && el("span", { class: `check-meter tone-${pct >= 75 ? "bad" : "warn"}` }, `TRACE [${"#".repeat(Math.round(pct / 12.5))}${"-".repeat(8 - Math.round(pct / 12.5))}] ${pct}%`)));
}

export function computerNode() {
  sync();
  if (!computerOpen()) return null;
  return el("div", { class: "check-overlay", id: "computer" }, windowNode());
}

function draw() {
  const node = computerNode();
  const current = document.getElementById("computer");
  if (current && node) current.replaceWith(node);
  focusComputer();
}

// Puts the keyboard on the command line, and shows the latest on the screen and the console.
export function focusComputer() {
  const console = document.getElementById("computer-console");
  if (console) console.scrollTop = console.scrollHeight;
  const screen = document.getElementById("computer-screen");
  if (screen) screen.scrollTop = 0;
  if (app.ui.sideOpen) return;
  document.getElementById("computer-input")?.focus({ preventScroll: true });
}

function onKey(event) {
  if (app.ui.screen !== "game" || !computerOpen() || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (app.ui.game.combat || app.ui.game.check) return;
  if (event.key === "Escape") {
    if (!comp.sending) logOff();
    return;
  }
  // A click on the screen takes the keyboard off the console, and typing should bring it back.
  if (event.key.length === 1 && !event.target.matches?.("input, textarea")) document.getElementById("computer-input")?.focus();
}
