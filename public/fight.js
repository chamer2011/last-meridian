// The fight window: a popup over the story, with the two sides facing each other in console
// art, and what the player can do down its sides. The game's server works out each round, and
// its events are played back here one at a time. None of this involves the AI.

import { fallenArt, mirrorArt, trimmedArt } from "./art.js";
import { api, el, signed } from "./dom.js";
import { parseNotice } from "./story.js";
import { optionContent, storyEntryNode } from "./story-view.js";

const fight = {
  id: null,
  view: null,
  target: null,
  lines: [],
  playing: false,
  skipping: false,
  wake: null,
  message: null,
  result: null,
  sim: null,
  layout: "sides",
};

// What the fight window needs from the main screen. Set once, when the page loads.
let app;

export function initFight(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", () => {
    fitWindow();
    scrollLog();
  });
}

export const fightOpen = () => Boolean(fight.view);

function closeFight() {
  Object.assign(fight, { id: null, view: null, target: null, lines: [], message: null, result: null });
}

// A different game was loaded, so whatever was on screen no longer applies.
export function resetFight() {
  closeFight();
  fight.sim = null;
}

const alive = (fighters) => fighters.filter((fighter) => fighter.hp > 0 && !fighter.out);

// Keeps the window in step with the game, unless a round is playing or the result is showing.
function sync() {
  if (fight.playing || fight.result) return;
  const live = app.ui.game?.combat ?? null;
  if (!live) {
    closeFight();
    return;
  }
  if (live.id !== fight.id) {
    closeFight();
    fight.id = live.id;
  }
  fight.view = live;
  if (!alive(live.enemies).some((enemy) => enemy.key === fight.target)) fight.target = alive(live.enemies)[0]?.key ?? null;
}

// ---- The fighters -------------------------------------------------------

function healthBar(hp, max) {
  const filled = Math.round(Math.max(0, Math.min(1, hp / max)) * 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${hp}/${max}`;
}

function fighterCard(fighter, side) {
  const down = fighter.hp <= 0;
  const gone = !down && Boolean(fighter.out);
  const targeted = side === "enemy" && !down && !gone && fighter.key === fight.target && !fight.result;
  const drawing = down ? fallenArt(fighter.fallen, fighter.art) : trimmedArt(fighter.art);
  const parts = [
    targeted && alive(fight.view.enemies).length > 1 && el("span", { class: "fighter-aim" }, ">> TARGET"),
    el("pre", { class: "fighter-art", "aria-hidden": "true" }, (side === "enemy" ? mirrorArt(drawing) : drawing).join("\n")),
    el("div", { class: "fighter-name" }, side === "you" ? `${fighter.name} (you)` : fighter.name),
    el("div", { class: `fighter-bar${fighter.hp / fighter.maxHp <= 0.25 ? " low" : ""}` }, `HP ${healthBar(fighter.hp, fighter.maxHp)}`),
    side === "you" && el("div", { class: "fighter-bar" }, `EN ${healthBar(fighter.energy, fighter.maxEnergy)}`),
    el("div", { class: "fighter-stats" }, `ATK ${signed(fighter.attack)} DEF ${fighter.defense} DMG ${fighter.damage.join("-")}`),
    fighter.weapon && el("div", { class: "fighter-stats" }, fighter.weapon),
    fighter.stunned && !down && el("div", { class: "fighter-stats tone-warn" }, "Can't act this round"),
    down && el("div", { class: "fighter-stats tone-bad" }, "Down"),
    gone && el("div", { class: "fighter-stats tone-good" }, fighter.out),
  ];
  const props = {
    class: `card fighter ${side}${down || gone ? " down" : ""}${targeted ? " targeted" : ""}`,
    "data-fighter": fighter.key,
    ...(fighter.color ? { style: `--fighter:${fighter.color}` } : {}),
    ...(fighter.desc ? { title: fighter.desc } : {}),
  };
  if (side !== "enemy" || down || gone || fight.result) return el("div", props, parts);
  return el("button", {
    ...props,
    "aria-pressed": String(targeted),
    "aria-label": `Aim at ${fighter.name}, ${fighter.hp} of ${fighter.maxHp} health`,
    onclick: (event) => {
      event.stopPropagation();
      aimAt(fighter.key);
    },
  }, parts);
}

function sideNode(side, title, cards) {
  return el("div", { class: `fight-side ${side}`, style: `--cols:${Math.min(2, cards.length)}` },
    el("div", { class: "fight-side-title" }, title),
    cards);
}

function arenaNode() {
  const { you, allies, enemies } = fight.view;
  return el("div", { class: "fight-arena", id: "fight-arena" },
    sideNode("friends", allies.length ? "Your side" : "You", [fighterCard(you, "you"), ...allies.map((ally) => fighterCard(ally, "ally"))]),
    el("pre", { class: "fight-clash", id: "fight-clash", "aria-hidden": "true" }, "VS"),
    sideNode("foes", enemies.length > 1 ? "Enemies" : "Enemy", enemies.map((enemy) => fighterCard(enemy, "enemy"))));
}

function aimAt(key) {
  if (fight.playing) return;
  fight.target = key;
  // Aiming shouldn't move what's on screen.
  const scrolled = document.querySelector("#fight .fight-center")?.scrollTop ?? 0;
  draw();
  const center = document.querySelector("#fight .fight-center");
  if (center) center.scrollTop = scrolled;
}

function cycleTarget(step) {
  const keys = alive(fight.view.enemies).map((enemy) => enemy.key);
  if (keys.length < 2) return;
  aimAt(keys[(keys.indexOf(fight.target) + step + keys.length) % keys.length]);
}

// ---- What the player can do ---------------------------------------------

const oddsTone = (odds) => (odds >= 65 ? "good" : odds <= 35 ? "bad" : "warn");

// The odds and limits of an action can depend on which enemy it's aimed at.
function optionFor(action) {
  const aim = action.targets?.[fight.target] ?? {};
  const odds = aim.odds ?? action.odds;
  const blocked = action.disabled || aim.disabled;
  return {
    label: aim.label ?? action.label,
    detail: aim.detail ?? action.detail,
    disabled: blocked || fight.playing,
    why: blocked ? action.why ?? aim.why : null,
    tags: odds === undefined ? [] : [{ kind: "raw", text: `${action.oddsLabel} ${odds}%`, tone: oddsTone(odds), title: aim.title ?? `About a ${odds}% chance.` }],
  };
}

function actionColumn(side, sections, numbered) {
  return el("div", { class: `fight-actions options ${side}` }, sections.map(([title, group]) => {
    const rows = numbered.filter(({ action }) => action.group === group);
    return rows.length > 0 && [el("div", { class: "fight-side-title" }, title), rows.map(({ action, number }) => {
      const option = optionFor(action);
      return el("button", {
        disabled: option.disabled,
        "data-choice": String(number),
        onclick: (event) => {
          event.stopPropagation();
          playRound(action.action);
        },
      }, el("span", { class: "option-number" }, `${number})`), optionContent(option));
    })];
  }));
}

// What the player can tell about whoever they're aiming at, which is what the odds of talking depend on.
function readNode() {
  const enemies = alive(fight.view.enemies);
  const read = fight.view.reads?.[fight.target];
  if (!read || fight.result) return null;
  return el("div", { class: "fight-read" },
    enemies.length > 1 && el("strong", {}, `${enemies.find((enemy) => enemy.key === fight.target)?.name}: `),
    [read.why, read.feels, read.fight].filter(Boolean).join(" "));
}

// ---- The fight log ------------------------------------------------------

function lineNode(line) {
  if (line.round) return el("div", { class: "fight-round" }, `-- Round ${line.round} --`);
  if (line.note) {
    return parseNotice(line.note).map((note) => el("div", { class: `fight-line tone-${note.tone}` }, note.text ?? `${note.reason}: ${note.result}`));
  }
  return el("div", { class: `fight-line tone-${line.tone}` }, line.text, line.math && el("span", { class: "log-math" }, ` (${line.math})`));
}

function logNode() {
  const { opening } = fight.view;
  return el("div", { class: "fight-log", id: "fight-log", role: "log" },
    opening && el("div", { class: "fight-opening" }, storyEntryNode({ role: "narrator", text: opening })),
    fight.lines.map(lineNode));
}

// While a round plays, and at the end, what just happened matters more than the fighters if they
// don't all fit. Between rounds the window goes back to the fighters, ready to aim.
function scrollLog() {
  const log = document.getElementById("fight-log");
  if (log) log.scrollTop = log.scrollHeight;
  const center = log?.closest(".fight-center");
  if (center && (fight.playing || fight.result)) center.scrollTop = center.scrollHeight;
}

// ---- Playing a round back -----------------------------------------------

function pause(event) {
  if (fight.skipping) return Promise.resolve();
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const time = (event.by ? 750 : event.note ? 250 : 450) * (calm ? 0.4 : 1);
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, time);
    fight.wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function skipPlayback() {
  if (!fight.playing) return;
  fight.skipping = true;
  fight.wake?.();
}

const everyone = () => [fight.view.you, ...fight.view.allies, ...fight.view.enemies];
const cardFor = (key) => document.querySelector(`#fight [data-fighter="${key}"]`);

function clashFor(event) {
  if (!event.by || event.on === event.by || !event.on) return "VS";
  const fromEnemy = event.by.startsWith("e");
  if (event.out || event.refused) return event.out ? "..." : "?!";
  if (event.missed) return fromEnemy ? "<-- ?" : "? -->";
  return fromEnemy ? "<==--" : "--==>";
}

function showEvent(event) {
  const view = fight.view;
  if (event.joined) (event.joined === "enemy" ? view.enemies : view.allies).push(event.fighter);
  if (event.out) {
    const leaving = view.enemies.find((enemy) => enemy.key === event.on);
    if (leaving) leaving.out = event.out;
  }
  for (const [key, hp] of Object.entries(event.hp ?? {})) {
    const fighter = everyone().find((one) => one.key === key);
    if (fighter) fighter.hp = hp;
  }
  fight.lines.push(event);
  document.getElementById("fight-arena")?.replaceWith(arenaNode());
  document.getElementById("fight-log")?.append(...[lineNode(event)].flat());
  if (event.joined) fitWindow();
  scrollLog();
  const clash = document.getElementById("fight-clash");
  if (clash) clash.textContent = clashFor(event);
  if (fight.skipping) return;
  // Each of these plays once, because the cards have just been drawn afresh.
  if (event.by) cardFor(event.by)?.classList.add("acting");
  const struck = event.on && cardFor(event.on);
  if (!struck) return;
  if (event.joined) struck.classList.add("arriving");
  else if (event.missed) struck.classList.add("dodging");
  else if (event.gained) struck.classList.add("healed");
  else if (event.damage) struck.classList.add("struck");
  const float = event.damage ? `-${event.damage}` : event.missed ? "miss" : event.refused ? "no" : event.gained > 1 ? `+${event.gained}` : null;
  if (float) struck.append(el("span", { class: `fight-float${event.damage ? " hurt" : event.missed ? "" : " good"}`, "aria-hidden": "true" }, float));
}

async function playRound(action) {
  if (fight.playing) return;
  Object.assign(fight, { playing: true, skipping: false, message: null });
  draw();
  let reply;
  try {
    reply = await api("/api/combat", { ...action, target: fight.target });
  } catch (err) {
    Object.assign(fight, { playing: false, message: err.message });
    draw();
    return;
  }
  app.ui.game = reply.game;
  // Loading another game while this plays out takes the fight away, and this round with it.
  const playing = fight.id;
  fight.lines.push({ round: fight.view.round });
  document.getElementById("fight-log")?.append(...[lineNode(fight.lines.at(-1))].flat());
  for (const event of reply.outcome.events) {
    if (fight.id !== playing) break;
    showEvent(event);
    await pause(event);
  }
  fight.playing = false;
  if (fight.id !== playing) {
    app.render();
    return;
  }
  if (reply.outcome.over) {
    fight.result = reply.outcome;
    app.render();
    return;
  }
  draw();
}

// ---- How it ended -------------------------------------------------------

const RESULT_TITLES = { victory: "Victory", defeat: "Defeat", fled: "You got away", talked: "It's over", surrendered: "You gave up" };
const RESULT_TONES = { victory: "good", defeat: "bad", fled: "info", talked: "good", surrendered: "warn" };

function resultNode() {
  const result = fight.result;
  const choices = result.training
    ? [["Run it again", () => runAgain()], ["Close", () => closeWindow()]]
    : [["Continue the story", () => continueStory(), "the game master picks it up from here"], ["Close, and look around first", () => closeWindow()]];
  return el("div", { class: "fight-result" },
    el("div", { class: `fight-result-title tone-${RESULT_TONES[result.result]}` }, RESULT_TITLES[result.result]),
    el("div", {}, result.training ? result.message : result.summary, result.math && el("span", { class: "log-math" }, ` (${result.math})`)),
    result.followers.map((follower) => el("div", { class: "small" },
      `${follower.name}: ${follower.down ? "knocked out" : `${follower.hp}/${follower.maxHp} health`}`)),
    el("div", { class: "options" }, choices.map(([label, run, detail], i) => el("button", {
      "data-choice": String(i + 1),
      onclick: (event) => {
        event.stopPropagation();
        run();
      },
    }, el("span", { class: "option-number" }, `${i + 1})`), el("span", { class: "option-label" }, label), detail && el("span", { class: "option-detail" }, detail)))));
}

function closeWindow() {
  closeFight();
  app.render();
}

function continueStory() {
  closeFight();
  app.sendChat({ event: "continue" });
}

function runAgain() {
  const { enemy, followers } = fight.sim ?? {};
  closeFight();
  if (!enemy) return app.render();
  return startSim(enemy, followers).then(() => app.render());
}

// ---- The window ---------------------------------------------------------

export async function startSim(enemy, followers = false) {
  const { game } = await api("/api/sim", { enemy, followers });
  fight.sim = { enemy, followers };
  app.ui.game = game;
  app.closeMenu();
}

function windowNode() {
  const view = fight.view;
  const finished = Boolean(fight.result);
  const numbered = ["attack", "talk", "other"].flatMap((group) => view.actions.filter((a) => a.group === group))
    .map((action, i) => ({ action, number: i + 1 }));
  return el("div", {
    class: `fight-window${view.training ? " training" : ""}`,
    id: "fight-window",
    "data-layout": fight.layout,
    role: "dialog",
    "aria-label": "Fight",
    tabindex: "-1",
    onclick: skipPlayback,
  },
  el("div", { class: "fight-title" },
    el("span", {}, view.training ? "Combat simulation" : "Combat"),
    el("span", {}, `Round ${view.round}`),
    el("span", { class: "fight-hint" }, fight.playing ? "Click to skip" : finished ? "" : "Press a number to act. Click an enemy to aim at it."),
    el("button", {
      class: "mobile-toggle",
      onclick: (event) => {
        event.stopPropagation();
        app.openMenu(app.ui.tab);
      },
    }, "Menu")),
  el("div", { class: `fight-body${finished ? " finished" : ""}` },
    !finished && actionColumn("attack", [["Attack", "attack"], ["Another way", "talk"]], numbered),
    el("div", { class: "fight-center" },
      arenaNode(),
      readNode(),
      fight.message && el("div", { class: "notice-inline fail" }, fight.message),
      logNode(),
      finished && resultNode()),
    !finished && actionColumn("other", [["Defend and other", "other"]], numbered)));
}

export function fightNode() {
  sync();
  if (!fight.view) return null;
  return el("div", { class: "fight-overlay", id: "fight" }, windowNode());
}

function draw() {
  const node = fightNode();
  const current = document.getElementById("fight");
  if (current && node) current.replaceWith(node);
  focusFight();
}

// The window takes the size of what it's showing. This tries its roomiest arrangement first,
// and steps down until everything fits on the screen, keeping the actions on the sides if it can.
const LAYOUTS = ["sides", "sides-slim", "below", "below-slim", "stacked"];

function fitWindow() {
  const win = document.getElementById("fight-window");
  const body = win?.querySelector(".fight-body");
  if (!body) return;
  const parts = [body, win.querySelector(".fight-center")];
  // If nothing fits completely, the one that needs the least scrolling wins.
  let best = "stacked";
  let leastScrolling = Infinity;
  for (const layout of LAYOUTS) {
    win.dataset.layout = layout;
    if (layout !== "stacked" && parts.some((part) => part.scrollWidth > part.clientWidth + 1)) continue;
    const scrolling = parts.reduce((total, part) => total + part.scrollHeight - part.clientHeight, 0);
    if (scrolling < leastScrolling) {
      best = layout;
      leastScrolling = scrolling;
    }
    if (scrolling <= 1) break;
  }
  fight.layout = best;
  win.dataset.layout = best;
}

// Sizes the window, puts the keyboard on it, and shows the latest of the log.
export function focusFight() {
  fitWindow();
  scrollLog();
  if (!app.ui.sideOpen) document.getElementById("fight-window")?.focus({ preventScroll: true });
}

function onKey(event) {
  if (!fight.view || app.ui.sideOpen || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.matches?.("input, textarea")) return;
  if (fight.playing) {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      skipPlayback();
    }
    return;
  }
  // There can be more than nine things to do, so 0 is the tenth.
  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    document.querySelector(`#fight [data-choice="${event.key === "0" ? "10" : event.key}"]`)?.click();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    cycleTarget(event.key === "ArrowLeft" ? -1 : 1);
  }
}
