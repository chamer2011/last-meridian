// The fleet's screens: the Fleet menu, the star map, and the raid window. Everything here is drawn
// from the game's state, and every button runs on this computer, without the AI.

import { api, el, meter, signed, strainMeter } from "./dom.js";

const raid = { report: null, message: null, sending: false };

// What these screens need from the main screen. Set once, when the page loads.
let app;

export function initFleet(hooks) {
  app = hooks;
  document.addEventListener("keydown", onKey);
}

const inFight = () => Boolean(app.ui.game.combat || app.ui.game.check || app.ui.game.talk);
const cannotAct = () => app.ui.streaming || inFight() || Boolean(app.ui.game.fleet.raid);

// Sends an order, and shows what came of it at the top of the menu.
function order(body, after) {
  return app.runAction(async () => {
    const { game, message, moved } = await api("/api/fleet", body);
    app.ui.game = game;
    if (message) app.ui.menuMessage = { ok: true, text: message };
    // A new place or a raid needs the whole screen, so the menu gets out of the way.
    if (moved || game.fleet.raid) app.closeMenu();
    after?.();
  });
}

const number = (n) => n.toLocaleString("en-US");
const section = (title, ...children) => el("section", { class: "menu-section" }, title && el("h3", {}, title), children);
const muted = (text) => el("div", { class: "muted small" }, text);

// ---- The Fleet menu -----------------------------------------------------

function statusSection(g) {
  const f = g.fleet;
  const hunted = f.raid ? "They're here." : `Raid in about ${f.raidInDays} ${f.raidInDays === 1 ? "day" : "days"} if nothing changes. A jump shakes off ${f.jumpShakes[1]} to ${f.jumpShakes[3]}.`;
  return section("The fleet",
    el("div", { class: "menu-row" }, el("strong", {}, `${f.shipCount} of ${f.shipTotal} ships`), el("strong", {}, `${number(f.people)} people`)),
    muted(`${g.clock.label}. The fleet is ${f.atText}. Crews are working at ${f.work}%.`),
    el("div", { class: "stack gap-small small" },
      meter("MORALE ", g.ship.morale, 100),
      muted(`Settling at ${f.moraleTarget}, with these rations and work orders.`),
      meter("HEALTH ", f.health, 100),
      muted(`Settling at ${f.healthTarget}.`),
      strainMeter("PURSUIT", f.pursuit),
      muted(`Climbing ${f.pursuitRate} a day. ${hunted}`)));
}

function supplyLine(s) {
  const bar = "#".repeat(Math.round(Math.max(0, Math.min(1, s.stock / s.max)) * 10)).padEnd(10, "-");
  const left = s.out ? "OUT" : s.days === null ? "holding" : `${s.days} ${s.days === 1 ? "day" : "days"} left`;
  return el("div", { class: `fleet-supply${s.out || s.low ? " low" : ""}` },
    el("div", { class: "fleet-supply-line" },
      el("span", {}, `${s.name.toUpperCase().padEnd(8)} [${bar}] ${s.stock}${s.unit ? ` ${s.unit}` : ""}`),
      el("strong", {}, left)),
    muted(`Makes ${s.made}, uses ${s.used}, so ${signed(s.net)} a day.`));
}

function suppliesSection(f) {
  return section("Supplies", f.supplies.map(supplyLine),
    f.gathers.length > 0 && muted(`Work crews can gather here: ${f.gathers.map((entry) => `${entry.id} (+${entry.amount} a day)`).join(", ")}.`));
}

function choiceCard({ current, name, detail, desc, onclick, disabled }) {
  return el("button", { class: `card selectable${current ? " selected" : ""}`, "aria-pressed": String(Boolean(current)), disabled, onclick },
    el("strong", {}, name), muted(desc), detail);
}

function rationsSection(f) {
  return section("Rations", f.rations.map((r) => choiceCard({
    current: r.current,
    name: r.name,
    desc: r.desc,
    disabled: cannotAct(),
    detail: el("div", { class: "effects small" }, `Uses ${r.foodUsed} t of food a day. Morale settles at ${r.moraleTarget}, health at ${r.healthTarget}.`),
    onclick: order({ action: "rations", id: r.id }),
  })));
}

function crewsSection(f) {
  return section("Work crews", f.crews.map((c) => choiceCard({
    current: c.current,
    name: c.name,
    desc: c.desc,
    disabled: cannotAct(),
    detail: c.effects.length > 0 && el("div", { class: "small" }, c.effects.map((effect, i) => [i > 0 && ", ", el("span", { class: effect.good ? "tone-good" : "tone-bad" }, effect.text)])),
    onclick: order({ action: "crews", id: c.id }),
  })));
}

function ordersSection(g) {
  const f = g.fleet;
  return section("Orders",
    muted("Waiting costs nothing but what the fleet uses up, and it passes the time faster than walking around does."),
    el("div", { class: "row" },
      el("button", { disabled: cannotAct(), onclick: order({ action: "wait", days: 1 }) }, "Wait 1 day"),
      el("button", { disabled: cannotAct(), onclick: order({ action: "wait", days: 3 }) }, "Wait 3 days")),
    el("div", {}, el("button", {
      disabled: cannotAct() || g.ship.fuel < 1,
      title: "A short blind jump, to nowhere in particular",
      onclick: order({ action: "evade" }),
    }, `Blind jump: 1 fuel, pursuit -${f.evadeShakes}`)),
    el("div", {}, el("button", { onclick: () => app.openMenu("map") }, "Open the star map")),
    f.trade.length > 0 && el("div", { class: "stack gap-small" },
      el("div", { class: "small" }, `Trade with ${f.atName}. You have ${g.credits} credits. Prices move with what's left here, and with each lot you buy or sell.`),
      f.trade.map((t) => el("div", { class: "menu-row small fleet-trade" },
        el("span", {}, `${t.amount} of ${t.name.toLowerCase()}`, t.level && el("span", { class: `muted fleet-trade-level` }, ` ${t.level}`)),
        el("span", { class: "row" },
          el("button", { disabled: cannotAct() || !t.spare, title: t.spare ? "" : "The fleet hasn't got that much", onclick: order({ action: "sell", id: t.id }) }, `Sell ${t.sellFor} cr`),
          el("button", { disabled: cannotAct() || t.none || t.full || g.credits < t.price, title: t.none ? "Nobody here has any left to sell" : "", onclick: order({ action: "buy", id: t.id }) }, t.none ? "None left" : `Buy ${t.price} cr`))))));
}

function councilSection(f) {
  const { off, recent } = f.council;
  return section("Officers and council",
    muted(off
      ? "You've told them to wait for your word, whatever happens."
      : "If something's gone wrong and stayed wrong, they'll deal with it themselves after a day or two, and tell you. An order of your own stands for a few days before they'd change it."),
    el("div", { class: "row" },
      el("button", { class: off ? "" : "primary", "aria-pressed": String(!off), disabled: cannotAct(), onclick: order({ action: "council", on: true }) }, "They can act"),
      el("button", { class: off ? "primary" : "", "aria-pressed": String(off), disabled: cannotAct(), onclick: order({ action: "council", on: false }) }, "Wait for my word")),
    recent.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text))));
}

// What someone who isn't in charge can see of the fleet: what's plain to anyone, and what's going round.
const MOODS = [[60, "People are holding up."], [35, "People are frightened, and they've started saying so."], [15, "People have started talking about leaving."], [0, "The fleet's coming apart, and nobody's pretending otherwise."]];

function outsiderFleet(g) {
  const f = g.fleet;
  const { role } = g;
  const here = role.inFleet;
  return el("div", { class: "menu-columns" },
    section("The fleet",
      el("div", { class: "menu-row" }, el("strong", {}, `${f.shipCount} of ${f.shipTotal} ships`), el("strong", {}, `about ${number(Math.round(f.people / 1000) * 1000)} people`)),
      muted(`${role.chair ?? "Someone else"} has the chair. The fleet is ${f.atText}.`),
      here
        ? [el("div", { class: "small" }, MOODS.find(([from]) => g.ship.morale >= from)[1]),
          f.shortages.length > 0 && el("div", { class: "small tone-bad" }, `Everyone's talking about the ${f.shortages.join(" and the ")}.`)]
        : muted("That's the last anyone here heard. Whatever else is going on out there, you'll hear about it when everyone else does.")),
    section("Waiting",
      muted("Let the time go by, and see what happens without you. The fleet won't wait for you, and nor will anyone else."),
      el("div", { class: "row" },
        el("button", { disabled: cannotAct(), onclick: order({ action: "wait", days: 1 }) }, "Wait 1 day"),
        el("button", { disabled: cannotAct(), onclick: order({ action: "wait", days: 3 }) }, "Wait 3 days")),
      el("div", {}, el("button", { onclick: () => app.openMenu("map") }, "Open the star map"))),
    here && section("What's been decided",
      f.council.recent.length
        ? f.council.recent.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text)))
        : muted("Nothing that's reached you. Rations, work crews and jumps are decided a long way above your head.")),
    here && logSection(f));
}

function logSection(f) {
  return section("Fleet log", f.log.length
    ? f.log.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, entry.day), el("span", {}, entry.text)))
    : muted("Shortages, losses and raids will be recorded here."));
}

const SHIP_FILTERS = {
  all: ["All", (s) => s.status === "active"],
  hurt: ["Hurt", (s) => s.status === "active" && s.condition < 50],
  makes: ["Makers", (s) => s.status === "active" && s.makes.length > 0],
  gone: ["Gone", (s) => s.status !== "active"],
};

const GONE_LABELS = { lost: "lost", gone: "left the fleet", stripped: "stripped" };

function conditionBar(condition) {
  const filled = Math.round(condition / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${condition}%`;
}

function stripControl(s) {
  const { ui, renderMenus } = app;
  if (!s.strip || s.status !== "active") return null;
  const gain = [s.strip.parts && `${s.strip.parts} parts`, s.strip.fuel && `${s.strip.fuel} fuel`].filter(Boolean).join(" and ");
  if (ui.stripping === s.id) {
    return el("div", { class: "fleet-confirm small" },
      el("div", { class: "tone-bad" }, `Really strip her? You get ${gain}. Morale falls, and ${number(s.aboard)} people have to be packed onto other ships. There's no undoing it.`),
      el("div", { class: "row" },
        el("button", { class: "danger", disabled: cannotAct(), onclick: order({ action: "strip", id: s.id }, () => { ui.stripping = null; }) }, "Yes, strip her"),
        el("button", { onclick: () => { ui.stripping = null; renderMenus(); } }, "Keep her")));
  }
  return el("div", {}, el("button", { class: "small", disabled: cannotAct(), onclick: () => { ui.stripping = s.id; renderMenus(); } }, `Strip for ${gain}`));
}

function shipRow(s) {
  const active = s.status === "active";
  const makes = s.makes.map((entry) => `+${entry.amount} ${entry.id}`);
  const uses = s.uses.map((entry) => `-${entry.amount} ${entry.id}`);
  const tags = [s.guns > 0 && `${s.guns} ${s.guns === 1 ? "gun" : "guns"}`, s.slow && "slow"].filter(Boolean);
  const { role } = app.ui.game;
  return el("div", { class: `fleet-ship${active ? "" : " gone"}` },
    el("div", { class: "fleet-ship-name" },
      el("strong", {}, s.name),
      el("div", { class: "muted small" }, `${s.role}. ${s.class}.`)),
    el("div", { class: "fleet-ship-captain small" }, s.captain),
    el("div", { class: "fleet-ship-aboard small" }, `${number(s.aboard)} aboard`),
    el("div", { class: `fleet-ship-condition small${active && s.condition < 25 ? " tone-bad" : ""}` },
      active ? conditionBar(s.condition) : el("span", { class: "tag bad" }, `${GONE_LABELS[s.status]}, day ${s.lostDay}`)),
    el("div", { class: "fleet-ship-flow small" },
      makes.length > 0 && el("span", { class: "tone-good" }, makes.join(", ")),
      makes.length > 0 && " ",
      el("span", { class: "muted" }, uses.join(", ")),
      tags.length > 0 && el("span", { class: "muted" }, ` <${tags.join(", ")}>`)),
    el("div", { class: "fleet-ship-note muted small" }, s.note),
    active && el("div", { class: "fleet-ship-actions" },
      s.place && !s.here && (role.captain || role.inFleet) && el("button", { class: "small", disabled: cannotAct(), onclick: order({ action: "course", id: s.place }) }, "Go aboard"),
      s.here && el("span", { class: "tag on" }, "you are here"),
      role.captain && stripControl(s)));
}

function shipsSection(f) {
  const { ui, renderMenus } = app;
  const filter = SHIP_FILTERS[ui.shipFilter] ? ui.shipFilter : "all";
  const shown = f.ships.filter(SHIP_FILTERS[filter][1]);
  return section(null,
    el("div", { class: "row" }, Object.entries(SHIP_FILTERS).map(([id, [label, test]]) => el("button", {
      class: id === filter ? "primary" : "",
      "aria-pressed": String(id === filter),
      onclick: () => { ui.shipFilter = id; renderMenus(); },
    }, `${label} ${f.ships.filter(test).length}`))),
    shown.length ? el("div", { class: "fleet-ships" }, shown.map(shipRow)) : muted("None."));
}

export function fleetMenu() {
  const { ui, renderMenus } = app;
  const g = ui.game;
  const f = g.fleet;
  const tab = ui.fleetTab === "ships" ? "ships" : "command";
  const tabButton = (id, label) => el("button", {
    class: id === tab ? "primary" : "",
    "aria-pressed": String(id === tab),
    onclick: () => { ui.fleetTab = id; renderMenus(); },
  }, label);
  return [
    el("div", { class: "row" }, tabButton("command", g.role.captain ? "Command" : "How it stands"), tabButton("ships", `Ships (${f.shipCount})`)),
    tab === "ships"
      ? shipsSection(f)
      : !g.role.captain ? outsiderFleet(g) : el("div", { class: "menu-columns" }, statusSection(g), suppliesSection(f), ordersSection(g), rationsSection(f), crewsSection(f), councilSection(f), logSection(f)),
  ];
}

// ---- The star map -------------------------------------------------------

// A framed chart with grid marks and a scatter of faint stars. It's the same every time, so it doesn't flicker.
function chartArt(cols, rows) {
  const lines = [];
  let seed = 12345;
  for (let y = 0; y < rows; y += 1) {
    let line = "";
    for (let x = 0; x < cols; x += 1) {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      const roll = (seed >>> 16) % 100;
      const edgeX = x === 0 || x === cols - 1;
      const edgeY = y === 0 || y === rows - 1;
      if (edgeX && edgeY) line += "+";
      else if (edgeY) line += "-";
      else if (edgeX) line += "|";
      else if (x % 13 === 0 && y % 6 === 0) line += "+";
      else line += roll < 4 ? "." : roll === 4 ? "'" : " ";
    }
    lines.push(line);
  }
  const title = " CONCORD NAVAL CHART, FLEET COPY ";
  lines[0] = `${lines[0].slice(0, 3)}${title}${lines[0].slice(3 + title.length)}`;
  return lines;
}

// The line from the fleet to wherever's selected, one character at a time.
function courseLine(from, to, cols, rows) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i < steps; i += 1) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    if (grid[y]) grid[y][x] = i % 2 ? "." : ":";
  }
  return grid.map((line) => line.join("").trimEnd()).join("\n");
}

const DANGER_MARKS = ["o", "o", "*", "!", "!"];
const DANGER_TONES = ["good", "info", "warn", "bad", "bad"];

function mapStar(place, selected) {
  const { ui, renderMenus } = app;
  // Near the right-hand edge, the name goes on the left of the star.
  const flip = place.x + place.short.length + 3 > app.ui.game.fleet.chart.cols;
  return el("button", {
    class: `map-star tone-${DANGER_TONES[place.danger]}${selected ? " selected" : ""}${flip ? " flip" : ""}`,
    style: `left:${flip ? place.x - place.short.length - 1 : place.x}ch;top:calc(${place.y} * var(--map-row))`,
    "aria-pressed": String(selected),
    "aria-label": `${place.name}: ${place.fuel ? `${place.fuel} fuel, ${place.hours} hours` : "no fuel"}, ${place.dangerLabel}`,
    title: `${place.name}. ${place.fuel} fuel, ${place.hours} hours. ${place.dangerLabel}. ${place.control}.`,
    onclick: () => { ui.mapSelected = place.id; renderMenus(); },
  }, flip ? `${place.short} ${DANGER_MARKS[place.danger]}` : `${DANGER_MARKS[place.danger]} ${place.short}`);
}

function chartNode(g, places, selected) {
  const { chart, start, at } = g.fleet;
  const fleetSpot = places.find((place) => place.id === at) ?? start;
  // Someone who isn't with the fleet sets out from wherever they are.
  const mine = g.role.captain ? fleetSpot : places.find((place) => place.here) ?? fleetSpot;
  const here = mine;
  const course = selected && selected.x !== null && !selected.here && selected.id !== (g.role.captain ? at : null) ? courseLine(here, selected, chart.cols, chart.rows) : "";
  return el("div", { class: "map-frame" },
    el("div", { class: "map-chart", style: `--map-cols:${chart.cols};--map-lines:${chart.rows}` },
      el("pre", { class: "map-stars", "aria-hidden": "true" }, chartArt(chart.cols, chart.rows).join("\n")),
      el("pre", { class: "map-course", "aria-hidden": "true" }, course),
      !g.role.captain && mine !== fleetSpot && el("div", { class: "map-fleet map-fleet-other", style: `left:${fleetSpot.x}ch;top:calc(${fleetSpot.y} * var(--map-row))`, title: "The fleet" }, "F"),
      el("div", { class: "map-fleet", style: `left:${here.x}ch;top:calc(${here.y} * var(--map-row))`, title: g.role.captain ? "The fleet" : "You" }, "@"),
      places.map((place) => mapStar(place, selected?.id === place.id))));
}

function placeDetails(place, g) {
  const f = g.fleet;
  const { captain } = g.role;
  const facts = [
    captain ? ["Fuel", place.fuel ? String(place.fuel) : "None"] : ["Fare", place.jump ? `${place.fare} credits` : "None"],
    ["Time", `${place.hours} ${place.hours === 1 ? "hour" : "hours"}`],
    ["Danger", place.dangerLabel],
    ["Controlled by", place.control],
  ];
  return el("div", { class: "card stack gap-small map-details" },
    el("div", { class: "spread" },
      el("strong", {}, place.name),
      el("span", { class: "row" },
        place.here && el("span", { class: "tag on" }, "you are here"),
        place.fleetIsHere && !place.here && el("span", { class: "tag on" }, "fleet is here"))),
    muted(place.desc),
    !place.here && facts.map(([label, value]) => el("div", { class: "menu-row small" }, el("span", { class: "muted" }, label), el("span", {}, value))),
    place.here && el("div", { class: "menu-row small" }, el("span", { class: "muted" }, "Danger"), el("span", {}, place.dangerLabel)),
    place.here && el("div", { class: "menu-row small" }, el("span", { class: "muted" }, "Controlled by"), el("span", {}, place.control)),
    place.now?.shares.length > 0 && el("div", { class: "map-shares small" },
      el("div", { class: "muted" }, "Who has a say"),
      place.now.shares.map((side) => el("div", { class: "menu-row" }, el("span", {}, side.name), el("span", {}, String(side.share))))),
    place.now?.goods.length > 0 && el("div", { class: "map-goods small" }, place.now.goods.map((good) => el("div", { class: "menu-row" },
      el("span", { class: "muted" }, good.name),
      el("span", { class: good.low ? "tone-bad" : good.high ? "tone-good" : "" }, good.level)))),
    place.now?.going.map((text) => el("div", { class: "small map-going" }, text)),
    captain && place.gathers.length > 0 && muted(`Crews can gather: ${place.gathers.map((entry) => `${entry.id} (+${entry.amount} a day)`).join(", ")}.`),
    captain && place.sells.length > 0 && muted(`Sells to the fleet: ${place.sells.join(", ")}.`),
    place.hasMarket && muted("Has a market."),
    !place.here && place.shakes > 0 && el("div", { class: "small tone-good" }, `Jumping shakes off ${place.shakes} of the Choir's pursuit.`),
    !place.here && place.why && el("div", { class: "small tone-bad" }, place.why),
    !place.here && el("div", {}, el("button", {
      class: "primary",
      disabled: cannotAct() || !place.canGo,
      onclick: order({ action: "course", id: place.id }),
    }, captain ? "Set course" : place.jump ? "Book passage" : "Cross over")),
    f.raid && muted("The fleet's under attack."));
}

function placeTable(places) {
  const { ui, renderMenus } = app;
  const { captain } = ui.game.role;
  const sorted = places.filter((place) => !place.here).sort((a, b) => a.fuel - b.fuel || a.fare - b.fare || a.hours - b.hours || a.name.localeCompare(b.name));
  return section("Known places",
    el("div", { class: "map-table" },
      el("div", { class: "map-row map-head small muted" }, ["Place", captain ? "Fuel" : "Fare", "Time", "Danger", "Controlled by", "Short of", ""].map((label) => el("span", {}, label))),
      sorted.map((place) => el("div", { class: `map-row small${ui.mapSelected === place.id ? " selected" : ""}` },
        el("button", { class: "map-name", onclick: () => { ui.mapSelected = place.id; renderMenus(); } }, place.name),
        el("span", {}, String(captain ? place.fuel : place.fare)),
        el("span", {}, `${place.hours}h`),
        el("span", { class: `tone-${DANGER_TONES[place.danger]}` }, place.dangerLabel),
        el("span", { class: "map-control muted" }, place.control),
        el("span", { class: "map-short tone-bad" }, (place.now?.goods ?? []).filter((good) => good.low).map((good) => good.id).join(", ")),
        el("button", { disabled: cannotAct() || !place.canGo, title: place.why ?? "", onclick: order({ action: "course", id: place.id }) }, captain ? "Set course" : place.jump ? "Book passage" : "Cross over")))));
}

export function mapMenu() {
  const { ui } = app;
  const g = ui.game;
  const f = g.fleet;
  const onChart = g.locations.filter((place) => !place.withFleet && place.x !== null);
  const selected = g.locations.find((place) => place.id === ui.mapSelected) ?? g.locations.find((place) => (g.role.captain ? place.id === f.at : place.here)) ?? null;
  const ships = g.locations.filter((place) => place.withFleet);
  return [
    el("div", { class: "menu-intro small" }, g.role.captain
      ? `The fleet is ${f.atText}, with ${g.ship.fuel} fuel. Click a star to see what it would take to get there. A jump moves the whole fleet, and it costs nothing in AI credit: the story picks it up when you're ready.`
      : `You're at ${g.location.name}, with ${g.credits} credits, and the fleet is ${f.atText}. Click a star to see what a passage there costs, on whatever's going that way. You go by yourself, and it costs nothing in AI credit.`),
    el("div", { class: "map-layout" },
      chartNode(g, onChart, selected),
      el("div", { class: "map-side" },
        selected ? placeDetails(selected, g) : el("div", { class: "card muted small" }, "Click a star for its details."),
        el("div", { class: "small muted map-legend" }, g.role.captain ? "@ the fleet   o quiet   * risky   ! dangerous" : "@ you   F the fleet   o quiet   * risky   ! dangerous"),
        section("With the fleet",
          ships.map((place) => el("div", { class: "menu-row small" },
            el("span", {}, place.name),
            place.here
              ? el("span", { class: "tag on" }, "you are here")
              : el("button", { disabled: cannotAct() || !place.canGo, title: place.why ?? "", onclick: order({ action: "course", id: place.id }) }, g.role.captain || !place.jump ? "Go aboard" : `Go aboard, ${place.fare} cr`)))))),
    placeTable(g.locations.filter((place) => !place.withFleet)),
    section("News from around",
      g.world?.news.length
        ? g.world.news.map((entry) => el("div", { class: "menu-entry small" }, el("span", { class: "muted" }, `Day ${entry.day}`), el("span", {}, ` ${entry.text}`)))
        : muted(`Nothing's reached ${g.role.captain ? "the fleet" : "you"} yet. News comes in as the days go by.`)),
  ];
}

// ---- The raid window ----------------------------------------------------

export const raidOpen = () => Boolean(app?.ui.game?.fleet?.raid || raid.report);

export function resetRaid() {
  Object.assign(raid, { report: null, message: null, sending: false });
}

async function answer(id) {
  if (raid.sending) return;
  raid.sending = true;
  raid.message = null;
  try {
    const { game, report } = await api("/api/fleet", { action: "raid", id });
    app.ui.game = game;
    raid.report = report;
  } catch (err) {
    raid.message = err.message;
  }
  raid.sending = false;
  app.render();
}

function closeReport() {
  raid.report = null;
  app.render();
}

function panel(title, ...body) {
  return el("section", { class: "check-panel" },
    el("header", { class: "check-panel-title" }, el("span", {}, title), el("span", { class: "check-panel-marks", "aria-hidden": "true" }, "_ [] X")),
    el("div", { class: "check-panel-body" }, body));
}

function responseButton(option, i) {
  return el("button", { class: "raid-order card", disabled: !option.available || raid.sending, onclick: (event) => { event.stopPropagation(); answer(option.id); } },
    el("div", { class: "raid-order-name" }, el("span", { class: "check-key" }, `${i + 1}) `), option.name),
    el("div", { class: "check-hint" }, option.desc),
    el("div", { class: "raid-order-cost" }, `${option.losses}.${option.costs.length ? ` Costs ${option.costs.join(", ")}.` : ""} Pursuit falls to ${option.pursuitAfter}.`),
    option.why && el("div", { class: "tone-bad" }, option.why));
}

function alarmWindow(g) {
  const view = g.fleet.raid;
  return el("div", { class: "check-window raid-window", "data-theme": "red", role: "dialog", "aria-label": "Choir raid", tabindex: "-1", id: "raid-window" },
    el("div", { class: "check-title" },
      "Raid alert",
      el("span", { class: "check-skill" }, g.clock.label),
      el("span", { class: "check-difficulty" }, `${g.fleet.shipCount} ships, ${number(g.fleet.people)} people`),
      el("button", { class: "mobile-toggle", onclick: () => app.openMenu("fleet") }, "Menu")),
    el("div", { class: "check-situation" }, el("div", { class: "check-scene raid-intro" }, view.intro)),
    el("div", { class: "check-desk", "data-count": "2" },
      panel("LONG-RANGE", el("pre", { class: "raid-art", "aria-hidden": "true" }, view.art.join("\n"))),
      panel("FLEET STATUS",
        el("div", {}, `Meridian's hull ${g.ship.hull}/${g.ship.maxHull}`),
        el("div", {}, `Fuel ${g.ship.fuel}/${g.ship.maxFuel}`),
        el("div", {}, `Morale ${g.ship.morale}/100`),
        el("div", {}, `Parts ${Math.round(g.fleet.supplies.find((s) => s.id === "parts").stock)}`))),
    el("div", { class: "raid-orders" },
      el("div", { class: "check-hint" }, "What are your orders, Captain? Press a number or click one."),
      raid.message && el("div", { class: "tone-bad" }, raid.message),
      view.responses.map(responseButton),
      el("button", { class: "raid-order card", disabled: raid.sending, onclick: (event) => { event.stopPropagation(); answer("voss"); } },
        el("div", { class: "raid-order-name" }, el("span", { class: "check-key" }, `${view.responses.length + 1}) `), "Leave it to Commander Voss"),
        el("div", { class: "check-hint" }, `She'd order: ${view.responses.find((one) => one.id === view.voss)?.name}. It's her call, and it goes on her record.`))));
}

function reportWindow(g) {
  const { report } = raid;
  return el("div", { class: "check-window raid-window check-result", "data-theme": report.tone === "good" ? "green" : "red", role: "dialog", "aria-label": "How the raid went", tabindex: "-1", id: "raid-window" },
    el("div", { class: "check-title" }, "Raid report", el("span", { class: "check-skill" }, `${report.byVoss ? "Commander Voss ordered" : "You ordered"}: ${report.response}`)),
    el("div", { class: "check-verdict" },
      el("div", { class: `check-verdict-title tone-${report.tone}` }, report.title),
      report.lines.map((line) => el("div", { class: "check-verdict-line" }, line)),
      report.costs.length > 0 && el("div", { class: "check-verdict-math" }, report.costs.join(", ")),
      el("div", { class: "check-verdict-line" }, `The fleet: ${report.shipsLeft} ships, ${report.people} people. Fuel ${g.ship.fuel}, morale ${g.ship.morale}.`),
      el("div", { class: "options" }, el("button", { onclick: closeReport }, el("span", { class: "option-label" }, "Back to the story")))));
}

// Fights and checks come first, if something's started one at the same moment.
export function raidNode() {
  const g = app.ui.game;
  if (!raidOpen() || app.fightOrCheckOpen()) return null;
  return el("div", { class: "check-overlay" }, raid.report ? reportWindow(g) : alarmWindow(g));
}

export function focusRaid() {
  document.getElementById("raid-window")?.focus({ preventScroll: true });
}

function onKey(e) {
  if (!raidOpen() || !app.ui.game || app.fightOrCheckOpen() || app.ui.sideOpen) return;
  if (raid.report) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      closeReport();
    }
    return;
  }
  const { responses } = app.ui.game.fleet.raid ?? { responses: [] };
  const option = responses[Number(e.key) - 1];
  if (option?.available) {
    e.preventDefault();
    answer(option.id);
  } else if (Number(e.key) === responses.length + 1) {
    e.preventDefault();
    answer("voss");
  }
}
