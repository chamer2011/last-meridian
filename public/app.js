// The browser side of the game: draws the screens and talks to the local server.

import { creatorScreen, initCreator, openCreator, resetCreator } from "./creator.js";
import { checkNode, checkOpen, focusCheck, initCheck, resetCheck, startChoiceCheck, startPractice } from "./check.js";
import { api, el, meter, money, readLines } from "./dom.js";
import { fightNode, fightOpen, focusFight, initFight, resetFight, startSim } from "./fight.js";
import { focusRaid, initFleet, raidNode, raidOpen, resetRaid } from "./fleet.js";
import { openBoard } from "./board.js";
import { MENUS, MENU_GROUPS, initMenus } from "./menus.js";
import { choicesFor, dropStaleTooltip, initStory, loreCatalog, optionContent, setStoryContext, storyEntryNode, thinkingNode } from "./story-view.js";
import { focusTalk, initTalk, resetTalk, startTalk, talkNode, talkOpen } from "./talk.js";
import { beginScene, initPopups, openPopups, popupNext, popupsAttached, popupsOpen, updatePopups } from "./popups.js";
import { INTERFACE_SIZES, interfaceZoom } from "./scene.js";
import { focusThing, initWalk, popupsShown, renderWalk, resetWalk, showWholeStory, thingNode, thingOpen, walkShown, walkViewNode } from "./walk.js";
import { WRITING_SPEEDS } from "./writer.js";

const app = document.getElementById("app");

const ui = {
  game: null,
  saves: [],
  setup: null,
  settings: null,
  screen: "title",
  tab: "character",
  sideOpen: false,
  streaming: false,
  waiting: false,
  liveEntries: [],
  followStream: true,
  renderedCount: 0,
  menuFocus: null,
  peopleFilter: "all",
  fleetTab: "command",
  shipFilter: "all",
  stripping: null,
  mapSelected: null,
  codexSearch: "",
  error: null,
  menuMessage: null,
  settingsMessage: null,
  draft: "",
  consoleLines: [],
};

// ---- Reading preferences ------------------------------------------------

const READING_KEY = "meridian-reading";
const reading = { font: "book", size: 17, view: "iso", chosen: true, story: "popups", popFont: "terminal", writing: "normal", interface: "auto" };
const textSizes = { min: 13, max: 26 };

function applyReading() {
  document.documentElement.dataset.storyFont = reading.font;
  document.documentElement.dataset.popFont = reading.popFont;
  document.documentElement.style.setProperty("--story-size", `${reading.size}px`);
  applyInterface();
}

// How big everything's drawn: it follows the size of the window, or the player's own choice.
function applyInterface() {
  const zoom = interfaceZoom(reading.interface, window.innerWidth, window.innerHeight);
  document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
}

function loadReading() {
  try {
    const saved = JSON.parse(localStorage.getItem(READING_KEY));
    if (saved?.font === "book" || saved?.font === "terminal") reading.font = saved.font;
    if (Number.isInteger(saved?.size)) reading.size = Math.max(textSizes.min, Math.min(textSizes.max, saved.size));
    // A view picked before the game went isometric doesn't count. One picked since then does.
    if (saved?.chosen && (saved.view === "classic" || saved.view === "walk" || saved.view === "iso")) reading.view = saved.view;
    if (saved?.story === "popups" || saved?.story === "box" || saved?.story === "panel") reading.story = saved.story;
    if (saved?.popFont === "terminal" || saved?.popFont === "book") reading.popFont = saved.popFont;
    if (saved?.writing in WRITING_SPEEDS) reading.writing = saved.writing;
    if (saved?.interface in INTERFACE_SIZES) reading.interface = saved.interface;
  } catch {
    // Without saved preferences, the defaults are fine.
  }
  applyReading();
}

function changeReading(change) {
  Object.assign(reading, change);
  try {
    localStorage.setItem(READING_KEY, JSON.stringify(reading));
  } catch {
    // The change still applies until the page is closed.
  }
  applyReading();
  // Switching the story view changes the whole screen, not just the menu it's in.
  if (change.view || change.story) render();
  else renderMenus();
}

// ---- Helpers ------------------------------------------------------------

function runAction(fn) {
  return async (...args) => {
    ui.menuMessage = null;
    try {
      await fn(...args);
    } catch (err) {
      ui.menuMessage = { ok: false, text: err.message };
    }
    render();
  };
}

// ---- Talking to the AI --------------------------------------------------

async function sendChat(body) {
  if (ui.streaming) return;
  ui.streaming = true;
  ui.followStream = true;
  ui.error = null;
  ui.consoleLines = [];
  ui.liveEntries = body.text ? [{ role: "player", text: body.text }] : [];
  ui.draft = "";
  // Anything that moves the story on leaves a talk first, and the server does the same.
  if (ui.game) ui.game.talk = null;
  beginScene();
  render();

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const { error } = await res.json();
      // This page may be behind the game, after a reload or in a second tab, so it catches up first.
      await refreshAll();
      // If what was in the way is a fight or a check, it's on screen now, and that says it all.
      if (!ui.game?.combat && !ui.game?.check) throw new Error(error ?? "Something went wrong.");
      ui.streaming = false;
      ui.liveEntries = [];
      render();
      return;
    }

    await readLines(res, (line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.type === "text") {
        // Narration and game messages stay in the order they happened.
        const last = ui.liveEntries.at(-1);
        if (last?.role === "narrator") last.text += msg.text;
        else ui.liveEntries.push({ role: "narrator", text: msg.text });
        updateLive();
      } else if (msg.type === "notice") {
        ui.liveEntries.push({ role: "notice", text: msg.text });
        updateLive();
      } else if (msg.type === "state") {
        ui.game = msg.state;
        setStoryContext(ui.setup, ui.game);
        renderMenus();
        renderStatus();
        renderWalk();
      } else if (msg.type === "done") {
        ui.game = msg.state;
        ui.settings.spending = msg.spending;
      } else if (msg.type === "error") {
        ui.game = msg.state;
        ui.settings.spending = msg.spending;
        ui.error = { message: msg.message, retry: body };
      }
    });
  } catch (err) {
    ui.error = { message: err.message, retry: body };
  }
  // If it failed, what they typed goes back in the box, so it isn't lost.
  if (ui.error && body.text) ui.draft = body.text;
  ui.streaming = false;
  ui.liveEntries = [];
  // A raid that started during this turn needs the whole screen.
  if (ui.game?.fleet.raid) ui.sideOpen = false;
  render();
}

// ---- Title screen and starting a game -----------------------------------

const SLOT_LABELS = { autosave: "Autosave", previous: "Previous game", slot1: "Slot 1", slot2: "Slot 2", slot3: "Slot 3" };

function titleScreen() {
  const saves = ui.saves.filter((s) => !s.empty);
  return el("div", { class: "screen stack" },
    el("div", {},
      el("div", { class: "boot" }, "MERIDIAN-OS 4.1 // CONCORD FLEET COMMAND\n[ OK ] Reactor: unstable but online\n[ OK ] Fleet link: 41 ships responding\n[WARN] Unknown signal on all channels"),
      el("h1", { class: "title" }, "The Last Meridian"),
      el("p", { class: "subtitle" }, "Thirty thousand survivors. Forty-one ships. One signal from beyond the edge of the map. Where are you in all this?"),
    ),
    el("div", { class: "row" },
      el("button", { class: "primary", onclick: runAction(async () => { ui.screen = "create"; await openCreator(ui.setup); }) }, "New game"),
      ui.game && el("button", { onclick: () => { ui.screen = "game"; render(); } }, `Continue as ${ui.game.name}`),
    ),
    ui.menuMessage && !ui.menuMessage.ok && el("div", { class: "notice-inline fail" }, ui.menuMessage.text),
    saves.length > 0 && el("h3", { class: "muted small" }, "Saved games"),
    saves.map((s) => el("div", { class: "card spread" },
      el("div", {}, el("strong", {}, s.name), ` · level ${s.level} · ${s.location}`,
        el("div", { class: "muted small" }, `${SLOT_LABELS[s.slot]}, ${new Date(s.savedAt).toLocaleString()}`)),
      el("button", { onclick: runAction(async () => loadGame(s.slot)) }, "Load"),
    )),
    !ui.settings.hasKey && ui.settings.provider === "claude" && el("div", { class: "card small" },
      ui.settings.storyApplies === "written"
        ? "No AI is set up, so a new game uses the written story, which is free. For now that's the openings for three lives, the arrival at Haven, the whole of the main story's first act and a story aboard the Meridian, and the rest is being written. An AI, added in the Settings menu once you've started, with an Anthropic API key or a local model, reads whatever you type and writes what isn't written yet."
        : "You'll need to choose an AI before you can play the story. Once you start, open the Settings menu to paste an Anthropic API key or pick a local model."),
  );
}

async function loadGame(slot) {
  const { game, saves } = await api("/api/load", { slot });
  resetFight();
  resetCheck();
  resetRaid();
  resetWalk();
  resetTalk();
  ui.game = game;
  ui.saves = saves;
  ui.screen = "game";
  ui.sideOpen = false;
  ui.error = null;
  ui.consoleLines = [];
}

async function startNewGame(draft) {
  const { game, saves } = await api("/api/new", { draft });
  resetFight();
  resetCheck();
  resetRaid();
  resetWalk();
  resetTalk();
  ui.game = game;
  ui.saves = saves;
  ui.screen = "game";
  ui.tab = "character";
  ui.sideOpen = false;
  ui.error = null;
  ui.consoleLines = [];
  resetCreator();
  // A game with an AI game master and no AI configured opens Settings first. The story starts when the player is ready.
  if (game.mode !== "written" && ui.settings.provider === "claude" && !ui.settings.hasKey) {
    ui.tab = "settings";
    ui.sideOpen = true;
    render();
    return;
  }
  render();
  sendChat({ event: "start" });
}

// ---- Main game screen ---------------------------------------------------

function statusNode() {
  const g = ui.game;
  return el("div", { class: "statusbar", id: "status" },
    el("strong", {}, g.name), el("span", { class: "muted" }, `LVL ${g.level}`),
    meter("HP", g.hp, g.maxHp), meter("EN", g.energy, g.maxEnergy),
    el("span", { class: g.needs.stress >= 50 ? "meter low" : "" }, `STRESS ${g.needs.stress}`),
    el("span", { class: g.needs.fatigue >= 60 ? "meter low" : "" }, `FATIGUE ${g.needs.fatigue}`),
    g.conditions.length > 0 && el("span", { class: "meter low" }, `HURT ${g.conditions.length}`),
    el("span", {}, `CR ${g.credits}`),
    !g.role.captain && el("span", {}, g.role.short.toUpperCase()),
    g.role.captain && el("span", {}, `FLEET ${g.fleet.shipCount}`),
    g.role.captain && el("span", { class: g.fleet.pursuit >= 75 ? "meter low" : "" }, `PURSUIT ${g.fleet.pursuit}`),
    g.role.captain && g.fleet.shortages.length > 0 && el("span", { class: "meter low" }, `SHORT: ${g.fleet.shortages.join(", ").toUpperCase()}`),
    el("span", { class: "muted" }, `${g.clock.label} @ ${g.location.name}`),
    ui.settings.spending.lastTurn !== null && el("span", { class: "muted", title: "What the last AI turn cost. There's more in Settings." }, `LAST TURN ${money(ui.settings.spending.lastTurn)}`),
    el("button", { class: "mobile-toggle", onclick: () => openMenu(ui.tab) }, "Menu"),
  );
}

// The numbered choices on offer right now. Each can be clicked, or picked by typing its number.
function currentOptions() {
  const g = ui.game;
  // A fight, a check, a raid or a talk has its own window, with its own choices.
  if (ui.streaming || ui.waiting || g.combat || g.check || g.talk || g.fleet.raid) return [];
  // After a fight or a check, the game waits. The story only goes on when the player says to carry on.
  const written = g.mode === "written";
  const carryOn = [{ label: "Continue the story", detail: written || g.scene ? "the story picks it up from here" : "the game master picks it up from here", run: () => sendChat({ event: "continue" }) }];
  if (g.pendingEvents > 0) return carryOn;
  // In a written part of a game with an AI, clicking a choice costs nothing: only typing goes to the AI.
  const choices = choicesFor(g.transcript).map((choice) => ({ ...choice, ...(g.scene && !written ? { detail: "free" } : {}), run: () => takeChoice(choice) }));
  // Walking and talking can leave the story with nothing on offer, and there should always be something to click,
  // unless the written story has nothing more to say yet.
  if (written && !g.scene) return choices;
  return !choices.length && walkShown() && g.transcript.length ? carryOn : choices;
}

// A choice with a check on it opens the check's window, and the AI hears how it went afterward.
function takeChoice(choice) {
  if (!choice.tags?.some((tag) => tag.kind === "check" && tag.difficulty)) return sendChat({ text: choice.label });
  return startChoiceCheck(choice.label)
    .catch(async (err) => {
      // Usually this means the page is behind the game, so it catches up, and says why nothing opened.
      await refreshAll();
      ui.consoleLines = [{ role: "error", text: err.message }];
    })
    .then(render);
}

const helpText = (g) => `Type what you want to do, or the number of a listed choice.

${Object.values(MENUS).filter((m) => !m.captainOnly || g.role.captain).map((m) => `/${m.command.padEnd(10)}${m.label}`).join("\n")}
/close     close the open menu
/clear     clear this help text
/help      show this list`;

function runCommand(text) {
  const name = text.slice(1).split(/\s+/)[0].toLowerCase();
  const menu = Object.entries(MENUS).find(([, m]) => (!m.captainOnly || ui.game.role.captain) && (m.command === name || m.label.toLowerCase() === name));
  if (name === "help") ui.consoleLines = [{ role: "console", text: helpText(ui.game) }];
  else if (name === "clear") ui.consoleLines = [];
  else if (name === "close") closeMenu();
  else if (menu) {
    render();
    openMenu(menu[0]);
    return;
  } else ui.consoleLines = [{ role: "error", text: `Unknown command: ${text}. Type /help for the list.` }];
  render();
}

function submitPrompt() {
  const text = ui.draft.trim();
  if (!text) return;
  ui.draft = "";
  ui.consoleLines = [];
  if (text.startsWith("/")) return runCommand(text);

  const options = currentOptions();
  if (/^\d+$/.test(text) && options.length) {
    const option = options[Number(text) - 1];
    if (!option) ui.consoleLines = [{ role: "error", text: `There's no choice ${text}.` }];
    else if (option.disabled) ui.consoleLines = [{ role: "error", text: `${option.label}: ${option.why ?? "not available right now"}.` }];
    else return option.run();
    return render();
  }
  sendChat({ text });
}

function composerNode() {
  const g = ui.game;
  const options = currentOptions();
  const needsStart = g.transcript.length === 0 && !ui.streaming && !ui.waiting && !ui.error;
  // With the story over the room and put away, all that's left of it is the way to bring it back.
  const putAway = popupsShown() && !popupsOpen() && g.transcript.length > 0;
  const hint = ui.streaming || ui.waiting ? "processing..."
    : g.pendingEvents > 0 ? "press 1 to carry on, or type what you do next"
      : g.scene && g.mode !== "written" ? "a choice is free; your own words are one call to the AI"
        : popupsShown() ? "type an action" : "type an action, a number, or /help";
  return el("div", { class: "composer" }, el("div", { class: "composer-inner" },
    options.length > 0 && !putAway && el("div", { class: "options" }, options.map((o, i) => el("button", { disabled: o.disabled, onclick: o.run }, el("span", { class: "option-number" }, `${i + 1})`), optionContent(o)))),
    needsStart
      ? el("div", {}, el("button", { class: "primary", onclick: () => sendChat({ event: "start" }) }, "Start the story"))
      : el("div", { class: "prompt-line" },
        putAway && el("button", { class: "pop-reopen", onclick: openPopups }, options.length ? `Story: ${options.length === 1 ? "1 choice" : `${options.length} choices`} waiting` : "Story"),
        el("label", { class: "prompt", for: "composer" }, g.role.captain ? "captain@meridian:~$" : `${g.role.short.replaceAll(" ", "-")}@${g.location.id.replaceAll("_", "-")}:~$`),
        el("input", {
          id: "composer",
          type: "text",
          autocomplete: "off",
          spellcheck: "false",
          placeholder: hint,
          disabled: ui.streaming || ui.waiting || Boolean(g.combat) || Boolean(g.check) || Boolean(g.talk) || Boolean(g.fleet.raid),
          value: ui.draft,
          oninput: (e) => { ui.draft = e.target.value; },
          onkeydown: (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitPrompt();
            }
            // With nothing typed, these go on to the next piece of the story.
            if (popupsShown() && (e.key === " " || e.key === "Enter") && !e.target.value.trim() && popupNext()) e.preventDefault();
          },
        })),
  ));
}

// With latest, only the newest scene is shown, for the panel under the level.
function logNode({ latest = false } = {}) {
  const inner = el("div", { class: "log-inner", id: "log-inner" });
  // Each thing the player does starts a new section, and so does the story picking up after a fight.
  // Only the latest section stands at full brightness.
  const turns = [];
  let previousRole = null;
  for (const entry of ui.game.transcript) {
    if (entry.role === "player" || !turns.length || (entry.role === "narrator" && previousRole === "combat")) turns.push([]);
    turns.at(-1).push(entry);
    previousRole = entry.role;
  }
  // Every redraw rebuilds what's shown here, so a long story keeps only its latest scenes on screen until asked.
  const hidden = latest ? Math.max(0, turns.length - 1) : ui.showWholeLog ? 0 : Math.max(0, turns.length - 150);
  if (hidden && !latest) inner.append(el("div", { class: "row" }, el("button", { onclick: () => { ui.showWholeLog = true; render(); } }, `Show the ${hidden} earlier scenes`)));
  turns.forEach((entries, i) => {
    if (i < hidden) return;
    const past = ui.streaming || i < turns.length - 1;
    inner.append(el("section", { class: `turn${past ? " past" : ""}` }, entries.map((entry) => storyEntryNode(entry))));
  });
  inner.append(el("section", { class: "turn live", id: "live" }));
  ui.consoleLines.forEach((entry) => inner.append(storyEntryNode(entry)));
  if (ui.error) {
    inner.append(el("div", { class: "entry error" }, ui.error.message, " ",
      el("div", { class: "row", style: "margin-top:8px" },
        el("button", { onclick: () => { const retry = ui.error.retry; ui.error = null; sendChat(retry); } }, "Try again"),
        el("button", { onclick: () => { ui.error = null; render(); openMenu("settings"); } }, "Open Settings"),
      )));
  }
  // Once the reader scrolls by themselves, the page stops following the text.
  const stopFollowing = () => { ui.followStream = false; };
  return el("div", { class: "log", id: "log", onwheel: stopFollowing, ontouchmove: stopFollowing }, inner);
}

function updateLive() {
  if (popupsShown()) {
    updatePopups();
    return;
  }
  const live = document.getElementById("live");
  if (!live) return;
  const nodes = ui.liveEntries.map((entry, i) => storyEntryNode(entry, { streaming: ui.streaming && i === ui.liveEntries.length - 1 }));
  const visible = nodes.filter(Boolean);
  const last = ui.liveEntries.at(-1);
  if (ui.streaming && (last?.role !== "narrator" || !nodes.at(-1))) visible.push(thinkingNode());
  live.replaceChildren(...visible);
  dropStaleTooltip();
  if (ui.streaming && ui.followStream) {
    // Keeps the start of the new text in view. The reader scrolls down when they're ready.
    const log = document.getElementById("log");
    const target = live.offsetTop - 12;
    if (log.scrollTop < target) log.scrollTop = target;
  }
}

function placeLog(previousTop, isNew) {
  const log = document.getElementById("log");
  if (!log) return;
  if (!isNew) {
    log.scrollTop = previousTop;
  } else if (ui.game.combat || ui.game.check || ui.game.fleet.raid || ui.consoleLines.length || ui.error) {
    log.scrollTop = log.scrollHeight;
  } else if (walkShown() && ui.game.transcript.at(-1)?.role === "notice") {
    // A line added under the story, such as the note a talk leaves, has to be in view in that small panel.
    log.scrollTop = log.scrollHeight;
  } else if (ui.game.pendingEvents > 0 || ui.followStream) {
    const turns = log.querySelectorAll(".turn:not(:empty)");
    if (ui.game.pendingEvents > 0) log.scrollTop = log.scrollHeight;
    else log.scrollTop = turns.length ? turns[turns.length - 1].offsetTop - 12 : log.scrollHeight;
  } else {
    log.scrollTop = previousTop;
  }
}

// ---- Slide-over menus ---------------------------------------------------

const act = (body) => runAction(async () => {
  const { game, message } = await api("/api/action", body);
  ui.game = game;
  if (message) ui.menuMessage = { ok: true, text: message };
  // Sleeping can run into a raid, and that needs the whole screen.
  if (game.fleet.raid) ui.sideOpen = false;
});

const menuAlerts = (g) => ({ character: g.statPoints, skills: g.skillPoints, perks: g.perkPoints, fleet: g.role.captain ? g.fleet.shortages.length : 0 });

// The menus, in their groups, each group under its own heading. What a menu holds is on its tooltip, not on the screen.
function menuButtons(g) {
  const alerts = menuAlerts(g);
  return MENU_GROUPS.flatMap((group) => {
    const entries = group.ids.map((id) => [id, MENUS[id]]).filter(([, menu]) => !menu.captainOnly || g.role.captain);
    if (!entries.length) return [];
    return [el("div", { class: "rail-group" }, group.title), ...entries.map(([id, menu]) => el("button", {
      class: ui.sideOpen && id === ui.tab ? "active" : "",
      "aria-pressed": String(ui.sideOpen && id === ui.tab),
      title: menu.about,
      onclick: () => toggleMenu(id),
    }, menu.label, alerts[id] > 0 && el("span", { class: "badge" }, String(alerts[id]))))];
  });
}

const railNode = () => el("nav", { class: "rail", id: "rail", "aria-label": "Menus" }, menuButtons(ui.game));

function drawerNode() {
  const menu = MENUS[ui.tab];
  return el("aside", { class: `drawer${ui.sideOpen ? " open" : ""}`, id: "side", role: "dialog", "aria-label": menu.label, tabindex: "-1" },
    el("div", { class: "drawer-head" },
      el("h2", {}, menu.label),
      ui.menuMessage && el("div", { class: `notice-inline ${ui.menuMessage.ok ? "ok" : "fail"}` }, ui.menuMessage.text),
      el("button", { class: "drawer-close", onclick: closeMenu, title: "Or press Esc" }, "Close")),
    el("nav", { class: "drawer-tabs", "aria-label": "Menus" }, menuButtons(ui.game)),
    // Nothing is drawn inside a closed menu, so it costs nothing while it's hidden.
    el("div", { class: "menu-body" }, ui.sideOpen ? menu.view() : null));
}

const backdropNode = () => el("div", { class: `backdrop${ui.sideOpen ? " open" : ""}`, id: "backdrop", onclick: closeMenu });

function renderRail() {
  document.getElementById("rail")?.replaceWith(railNode());
}

// Redraws the open menu in place, keeping the reader's place in it.
function renderMenus({ animate = false } = {}) {
  if (ui.screen !== "game" || !ui.game) return;
  renderRail();
  if (!ui.sideOpen) return;
  const previous = document.getElementById("side");
  const body = previous?.querySelector(".menu-body");
  const sameMenu = previous?.getAttribute("aria-label") === MENUS[ui.tab].label;
  const top = sameMenu ? body?.scrollTop ?? 0 : 0;
  const node = drawerNode();
  previous?.replaceWith(node);
  document.getElementById("backdrop")?.classList.add("open");
  if (animate) {
    node.classList.remove("open");
    void node.offsetWidth; // Makes the browser notice the closed position, so it slides.
    node.classList.add("open");
    node.focus({ preventScroll: true });
  }
  node.querySelector(".menu-body").scrollTop = top;
}

// Brings a highlighted card into the middle of the open menu.
function showFocusedCard() {
  const body = document.querySelector("#side .menu-body");
  const card = body?.querySelector(".card.focused");
  if (!card) return;
  const offset = card.getBoundingClientRect().top - body.getBoundingClientRect().top;
  body.scrollTop += offset - (body.clientHeight - card.offsetHeight) / 2;
}

function openMenu(id, focus = null) {
  // The story board is a whole screen of its own, not a drawer.
  if (MENUS[id]?.board) {
    closeMenu();
    openBoard();
    return;
  }
  const wasOpen = ui.sideOpen;
  ui.tab = id;
  ui.menuFocus = focus;
  ui.menuMessage = null;
  ui.sideOpen = true;
  renderMenus({ animate: !wasOpen });
  showFocusedCard();
}

function closeMenu() {
  if (!ui.sideOpen) return;
  ui.sideOpen = false;
  ui.menuFocus = null;
  ui.menuMessage = null;
  document.getElementById("side")?.classList.remove("open");
  document.getElementById("backdrop")?.classList.remove("open");
  renderRail();
  if (fightOpen()) focusFight();
  else if (checkOpen()) focusCheck();
  else if (raidOpen()) focusRaid();
  else if (talkOpen()) focusTalk();
  else if (thingOpen()) focusThing();
  else document.getElementById("composer")?.focus({ preventScroll: true });
}

function toggleMenu(id) {
  if (ui.sideOpen && ui.tab === id) closeMenu();
  else openMenu(id);
}

function toTitle() {
  ui.sideOpen = false;
  ui.screen = "title";
  refreshAll();
}

// ---- Drawing ------------------------------------------------------------

function renderStatus() {
  document.getElementById("status")?.replaceWith(statusNode());
}

function render() {
  if (ui.screen === "title") return app.replaceChildren(titleScreen());
  if (ui.screen === "create") return app.replaceChildren(creatorScreen());
  setStoryContext(ui.setup, ui.game);
  const previous = document.getElementById("log");
  const previousTop = previous?.scrollTop ?? 0;
  const previousMenu = document.querySelector("#side .menu-body");
  const sameMenu = document.getElementById("side")?.getAttribute("aria-label") === MENUS[ui.tab].label;
  const menuTop = sameMenu ? previousMenu?.scrollTop ?? 0 : 0;
  const count = ui.game.transcript.length + ui.consoleLines.length + (ui.error ? 1 : 0);
  const isNew = !previous || count !== ui.renderedCount;
  ui.renderedCount = count;
  app.replaceChildren(el("div", { class: "game" },
    el("main", { class: "story" }, statusNode(), walkShown() ? walkViewNode(logNode, composerNode) : logNode(), !popupsShown() && composerNode()),
    fightNode(),
    checkNode(),
    raidNode(),
    talkNode(),
    thingNode(),
    railNode(),
    backdropNode(),
    drawerNode(),
  ));
  if (!popupsShown()) updateLive();
  popupsAttached();
  dropStaleTooltip();
  if (!ui.streaming) placeLog(previousTop, isNew);
  if (fightOpen()) focusFight();
  if (checkOpen()) focusCheck();
  if (ui.sideOpen) {
    const body = document.querySelector("#side .menu-body");
    if (body) body.scrollTop = menuTop;
  } else if (raidOpen() && !fightOpen() && !checkOpen()) {
    focusRaid();
  } else if (talkOpen() && !fightOpen() && !checkOpen()) {
    focusTalk();
  } else if (thingOpen()) {
    focusThing();
  } else if (!fightOpen() && !checkOpen() && !ui.streaming) {
    document.getElementById("composer")?.focus({ preventScroll: true });
  }
}

async function refreshAll() {
  const data = await api("/api/state");
  ui.game = data.game;
  ui.saves = data.saves;
  ui.setup = data.setup;
  ui.settings = data.settings;
  ui.waiting = Boolean(data.busy) && !ui.streaming;
  if (!ui.game && ui.screen === "game") ui.screen = "title";
  render();
  // The game master was already writing when this page loaded, so this looks again until it's done.
  if (ui.waiting) setTimeout(() => refreshAll().catch(() => {}), 1500);
}

loadReading();

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !ui.sideOpen) return;
  closeMenu();
  // That's all this press of Esc was for.
  e.preventDefault();
});
window.addEventListener("resize", applyInterface);
document.addEventListener("fullscreenchange", () => renderMenus());

initStory({
  // Clicking a highlighted word opens more about it in a menu.
  openEntry: (entry) => openMenu(entry.kind === "person" ? "people" : "codex", entry.id),
});

initMenus({
  ui,
  act,
  runAction,
  renderMenus,
  reading,
  changeReading,
  textSizes,
  toggleFullScreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
  loreCatalog,
  loadGame,
  toTitle,
  openMenu,
  startSim: (enemy, followers) => runAction(() => startSim(enemy, followers))(),
  startPractice: (skill) => runAction(() => startPractice(skill))(),
  followLead: (lead) => {
    closeMenu();
    sendChat({ text: `I look into this: ${lead.title}`, thread: lead.id });
  },
  askAbout: (rumor) => {
    closeMenu();
    sendChat({ text: `I ask around about something I heard: "${rumor}"` });
  },
});

initFight({ ui, render, sendChat, openMenu, closeMenu });
initCheck({ ui, render, sendChat, openMenu, closeMenu });
initFleet({ ui, render, runAction, renderMenus, openMenu, closeMenu, fightOrCheckOpen: () => fightOpen() || checkOpen() });
initWalk({ ui, reading, render, renderStatus, sendChat, startTalk, act });
initPopups({
  ui,
  reading,
  render,
  showWholeStory,
  retry: () => {
    const { retry } = ui.error;
    ui.error = null;
    sendChat(retry);
  },
  openSettings: () => {
    ui.error = null;
    render();
    openMenu("settings");
  },
});
initTalk({ ui, reading, render, openMenu, popupsShown });

initCreator({
  render,
  begin: startNewGame,
  hasGame: () => Boolean(ui.game),
  exit: () => {
    ui.screen = "title";
    render();
  },
});

refreshAll().catch((err) => {
  app.replaceChildren(el("div", { class: "screen" }, `The game server isn't responding: ${err.message}`));
});
