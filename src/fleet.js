// The fleet as real ships: supplies that run out, the Choir closing in, raids, and the
// decisions the player makes about all of it. Everything here runs on this computer. The
// game master only ever gets a compact line about it, and a short report when something
// serious has happened, so none of this adds to what a turn costs.
//
// world/fleet.json has the ships, the numbers and the words, and world/starmap.json has the chart.
// fleetLedger is the one place that works out a day's numbers, so anything that should change
// them later, such as officers at their posts, belongs there.

import { findCharacter } from "./campaign.js";
import { LOCATIONS, FACTIONS } from "./data.js";
import { inTrouble, levelName, noneLeft, placeNow, supplyFactor, tellNews, tradedAt } from "./daily.js";
import { inTheFleet, isCaptain } from "./role.js";
import { addCondition, buyPrice, changeStress, clamp, clockLabel, jumpHours, passTime, practice, sellPrice, skillRank, travel } from "./rules.js";
import { navigationDown } from "./systems.js";
import { FLEET_DATA, STAR_MAP } from "./world.js";

const { rules: RULES, rations: RATIONS, crews: CREWS, supplies: SUPPLIES, raid: RAID, text: TEXT, council: COUNCIL, chair: CHAIR } = FLEET_DATA;

export const FLEET_SHIPS = Object.fromEntries(FLEET_DATA.ships.map((ship) => [ship.id, ship]));
const SUPPLY_IDS = Object.keys(SUPPLIES);
// Fuel lives in the ship's tank, with the jumps it pays for. The other stores live here.
const STORES = SUPPLY_IDS.filter((id) => id !== "fuel");
const MAX_LOG = 40;
const MAX_REPORT_LINES = 5;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const say = (key, vars = {}) => (TEXT[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? "");
// A few of these are written to the captain, and read differently for anyone else.
const sayTo = (game, key, vars) => say(!isCaptain(game) && TEXT[`${key}Other`] ? `${key}Other` : key, vars);

function seedFrom(text) {
  let seed = 7;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) >>> 0;
  return seed;
}

// The fleet's own dice, kept in the save, so reloading doesn't change how a raid goes.
function dice(fleet) {
  fleet.seed = (Math.imul(fleet.seed, 1664525) + 1013904223) >>> 0;
  return fleet.seed / 4294967296;
}

const pick = (fleet, list) => list[Math.floor(dice(fleet) * list.length)];

// ---- The fleet in a saved game ------------------------------------------

function shipStart(ship) {
  return { condition: ship.condition ?? 60, aboard: ship.aboard ?? 0, status: "active" };
}

export function newFleet(game) {
  const here = LOCATIONS[game.location];
  return {
    // The last day the simulation has run. Time before this has already been paid for.
    day: Math.floor(game.clock.hours / 24),
    at: isCaptain(game) && here && !here.fleet ? game.location : null,
    chair: isCaptain(game) ? null : newChair(game),
    food: FLEET_DATA.start.food,
    medicine: FLEET_DATA.start.medicine,
    parts: FLEET_DATA.start.parts,
    fuelBurn: 0,
    hullWear: 0,
    health: FLEET_DATA.start.health,
    pursuit: FLEET_DATA.start.pursuit,
    rations: "standard",
    crews: "upkeep",
    ships: Object.fromEntries(FLEET_DATA.ships.map((ship) => [ship.id, shipStart(ship)])),
    raid: null,
    // How many days each supply has been out, and which have had their warning.
    out: {},
    warned: {},
    lowMorale: 0,
    deaths: 0,
    // What the game master hasn't been told yet, and what the Fleet menu shows.
    unheard: [],
    log: [],
    // What the player has been through, which the end of the story can draw on.
    record: { raids: 0, shipsLost: 0, shipsLeft: 0, shipsStripped: 0, dead: 0 },
    seed: seedFrom(`${game.name}|fleet`),
  };
}

export const fleetOf = (game) => {
  game.fleet ??= newFleet(game);
  return game.fleet;
};

// Who has the chair, if it isn't the player. Each game gets one of them, and it's the same one all the way through.
export function newChair(game) {
  const ids = Object.keys(CHAIR.captains);
  return { id: ids[seedFrom(`${game.name}|chair`) % ids.length], funds: CHAIR.funds, lastJump: -99, lastBuy: -99 };
}

const chairFile = (fleet) => (fleet?.chair ? CHAIR.captains[fleet.chair.id] ?? null : null);

export function chairOf(game) {
  const file = chairFile(game.fleet);
  return file ? { id: game.fleet.chair.id, name: file.name } : null;
}

// Ships added to or removed from world/fleet.json reach saved games too.
export function syncFleetShips(game) {
  const fleet = fleetOf(game);
  for (const ship of FLEET_DATA.ships) fleet.ships[ship.id] ??= shipStart(ship);
  for (const id of Object.keys(fleet.ships)) if (!FLEET_SHIPS[id]) delete fleet.ships[id];
  fleet.at = LOCATIONS[fleet.at] ? fleet.at : null;
}

// Places on every captain's chart from the start, so the star map isn't empty on day one.
export const isCharted = (id) => Boolean(STAR_MAP.places[id]?.charted);

const activeList = (fleet) => FLEET_DATA.ships.filter((ship) => fleet.ships[ship.id]?.status === "active");
const peopleIn = (fleet) => activeList(fleet).reduce((sum, ship) => sum + fleet.ships[ship.id].aboard, 0);

// The Meridian's condition is her hull, so there's only ever one number for it.
function conditionOf(game, id) {
  if (id === "meridian") return Math.round((game.ship.hull / game.ship.maxHull) * 100);
  return game.fleet.ships[id].condition;
}

function setCondition(game, id, value) {
  if (id === "meridian") game.ship.hull = clamp(Math.round((value / 100) * game.ship.maxHull), 1, game.ship.maxHull);
  else game.fleet.ships[id].condition = clamp(round1(value), 0, 100);
}

// A ship in bad shape makes less, and a wreck makes nothing.
const shipOutput = (condition) => (condition >= 50 ? 1 : condition >= 25 ? 0.75 : condition >= 10 ? 0.4 : 0);

// Hungry, sick or hopeless people get less done, and a good mood is worth a little extra.
function workRate(morale, health) {
  const heart = 0.5 + 0.5 * Math.min(1, morale / 50);
  const body = 0.5 + 0.5 * Math.min(1, health / 50);
  return heart * body * (morale >= 75 ? 1.1 : 1);
}

const mapSpot = (id) => (id ? STAR_MAP.places[id] ?? null : null);
const dangerOf = (id) => mapSpot(id)?.danger ?? 2;

// ---- A day's numbers ----------------------------------------------------

// What a day does right now, or what it would do if the rations or the crews' work changed.
export function fleetLedger(game, change = {}) {
  const fleet = fleetOf(game);
  const rations = RATIONS[change.rations ?? fleet.rations] ?? RATIONS.standard;
  const crews = CREWS[change.crews ?? fleet.crews] ?? CREWS.upkeep;
  const shortages = Object.keys(fleet.out).filter((id) => fleet.out[id] > 0);
  const people = peopleIn(fleet);
  const power = shortages.reduce((rate, id) => rate * (RULES.shortage[id]?.output ?? 1), 1);
  const work = workRate(game.ship.morale, fleet.health) * (crews.output ?? 1) * power;

  const made = Object.fromEntries(SUPPLY_IDS.map((id) => [id, 0]));
  const used = Object.fromEntries(SUPPLY_IDS.map((id) => [id, 0]));
  used.food = people * SUPPLIES.food.perPerson * rations.food;
  // Sick people need more medicine, so a medicine shortage feeds itself.
  used.medicine = people * SUPPLIES.medicine.perPerson * (1 + (100 - fleet.health) / 100);
  for (const ship of activeList(fleet)) {
    const output = shipOutput(conditionOf(game, ship.id));
    for (const [id, amount] of Object.entries(ship.produces ?? {})) made[id] += amount * output * work * (crews.boost?.[id] ?? 1);
    for (const [id, amount] of Object.entries(ship.uses ?? {})) used[id] += amount;
  }
  used.parts *= crews.partsRate ?? 1;
  for (const [id, amount] of Object.entries(crews.uses ?? {})) used[id] += amount;
  // Gathering doesn't depend on how the fleet's feeling, so there's always a way back from nothing.
  for (const [id, amount] of Object.entries(crews.adds ?? {})) made[id] += amount;
  if (crews.gathers) made[crews.gathers] += mapSpot(fleet.at)?.yields?.[crews.gathers] ?? 0;

  const net = Object.fromEntries(SUPPLY_IDS.map((id) => [id, made[id] - used[id]]));
  let moraleTarget = rations.morale + (crews.morale ?? 0);
  let healthTarget = rations.health + (crews.health ?? 0);
  for (const id of shortages) {
    moraleTarget += RULES.shortage[id].morale;
    healthTarget += RULES.shortage[id].health;
  }
  return {
    people,
    work,
    made,
    used,
    net,
    moraleTarget: clamp(moraleTarget, 5, 100),
    healthTarget: clamp(healthTarget, 5, 100),
    pursuitRate: RULES.pursuitPerDay * (RULES.pursuitByDanger[fleet.at ? dangerOf(fleet.at) : 2] ?? 1) * (crews.pursuit ?? 1),
    wear: (fleet.out.parts ? RULES.wearNoParts : RULES.wear) * (crews.wear ?? 1),
    repairs: fleet.parts > 0 ? crews.repairs ?? 0 : 0,
    repairShips: crews.repairShips ?? 0,
  };
}

const stockOf = (game, id) => (id === "fuel" ? Math.max(0, game.ship.fuel + game.fleet.fuelBurn) : game.fleet[id]);
const isOut = (game, id) => (id === "fuel" ? game.ship.fuel < 1 : game.fleet[id] <= 0);

function daysLeft(game, id, ledger) {
  const net = ledger.net[id];
  return net < -0.001 ? stockOf(game, id) / -net : null;
}

// ---- What the fleet says ------------------------------------------------

// A line for the story and the Fleet menu. The game master hears it with its next message too,
// unless it's the one that made the time pass, in which case it hears straight away. Only the
// newest line about each supply goes out, since "running low" is old news once it's run out.
function note(game, notes, tag, text, { heard = true, about = null } = {}) {
  const fleet = game.fleet;
  fleet.log.push({ day: clockLabel(game), tag, text });
  if (fleet.log.length > MAX_LOG) fleet.log.splice(0, fleet.log.length - MAX_LOG);
  // Someone who isn't with the fleet doesn't hear about any of this, unless it's big enough to be news.
  if (!inTheFleet(game)) return;
  notes.push(`[${tag}] ${text}`);
  if (!heard) return;
  if (about) fleet.unheard = fleet.unheard.filter((entry) => entry.about !== about);
  fleet.unheard.push({ about, text });
}

// A shortage ended by buying something or by a story reward gets said now, not tomorrow.
function noteRestocked(game, id, notes) {
  if (game.fleet.out[id] && !isOut(game, id)) {
    delete game.fleet.out[id];
    delete game.fleet.warned[id];
    note(game, notes, "SUPPLY", say(`${id}Back`), { about: id });
  }
}

// ---- A day in the fleet -------------------------------------------------

const moveToward = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

function payForDay(game, ledger) {
  const fleet = game.fleet;
  for (const id of STORES) fleet[id] = Math.max(0, round1(fleet[id] + ledger.net[id]));
  // The tank holds whole units, and the fractions wait here until they add up to one.
  fleet.fuelBurn = round2(fleet.fuelBurn + ledger.net.fuel);
  while (fleet.fuelBurn <= -1 && game.ship.fuel > 0) {
    game.ship.fuel -= 1;
    fleet.fuelBurn = round2(fleet.fuelBurn + 1);
  }
  while (fleet.fuelBurn >= 1) {
    game.ship.fuel = Math.min(game.ship.maxFuel, game.ship.fuel + 1);
    fleet.fuelBurn = round2(fleet.fuelBurn - 1);
  }
  if (game.ship.fuel === 0) fleet.fuelBurn = Math.max(0, fleet.fuelBurn);
}

function checkShortages(game, notes) {
  const fleet = game.fleet;
  const ledger = fleetLedger(game);
  for (const id of SUPPLY_IDS) {
    if (isOut(game, id)) {
      fleet.out[id] = (fleet.out[id] ?? 0) + 1;
      if (fleet.out[id] === 1) note(game, notes, "SUPPLY", sayTo(game, `${id}Out`), { about: id });
      else if (fleet.out[id] % 5 === 0) note(game, notes, "SUPPLY", say(`${id}Still`, { days: fleet.out[id] }), { about: id });
      continue;
    }
    noteRestocked(game, id, notes);
    const days = daysLeft(game, id, ledger);
    if (days !== null && days <= RULES.warnAtDays && !fleet.warned[id]) {
      fleet.warned[id] = true;
      note(game, notes, "SUPPLY", say(`${id}Low`, { days: Math.ceil(days) }), { about: id });
    } else if (days === null || days > RULES.warnAtDays + 3) {
      delete fleet.warned[id];
    }
  }
}

function wearShips(game, ledger, notes) {
  const fleet = game.fleet;
  for (const ship of activeList(fleet)) {
    if (ship.id === "meridian") continue;
    setCondition(game, ship.id, conditionOf(game, ship.id) - ledger.wear);
  }
  // The Meridian's hull only moves in whole points.
  fleet.hullWear = round2(fleet.hullWear + ledger.wear);
  while (fleet.hullWear >= 1) {
    game.ship.hull = Math.max(1, game.ship.hull - 1);
    fleet.hullWear = round2(fleet.hullWear - 1);
  }
  if (ledger.repairs > 0) {
    const worst = activeList(fleet).sort((a, b) => conditionOf(game, a.id) - conditionOf(game, b.id)).slice(0, ledger.repairShips);
    for (const ship of worst) {
      if (ship.id === "meridian") game.ship.hull = Math.min(game.ship.maxHull, game.ship.hull + Math.ceil(ledger.repairs));
      else setCondition(game, ship.id, conditionOf(game, ship.id) + ledger.repairs);
    }
  }
  for (const ship of activeList(fleet)) {
    if (conditionOf(game, ship.id) > 0) continue;
    if (ship.story) {
      setCondition(game, ship.id, 5);
      note(game, notes, "FLEET", say("shipLimping", { ship: ship.name }));
    } else {
      const { aboard } = fleet.ships[ship.id];
      loseShip(game, ship.id, "lost", notes, { spared: aboard });
      note(game, notes, "FLEET", say("shipFailed", { ship: ship.name, aboard: aboard.toLocaleString("en-US") }));
    }
  }
}

function countTheDead(game, notes) {
  const fleet = game.fleet;
  if (fleet.health < RULES.deadlyHealth) {
    const people = peopleIn(fleet);
    if (people > RULES.peopleFloor) {
      const dead = Math.min(people - RULES.peopleFloor, Math.round(people * (RULES.deadlyHealth - fleet.health) * 0.00004));
      removePeople(fleet, dead);
      fleet.deaths += dead;
      fleet.record.dead += dead;
    }
  }
  if (fleet.deaths >= 25 && fleet.day % 3 === 0) {
    note(game, notes, "FLEET", say("deaths", { dead: fleet.deaths.toLocaleString("en-US") }));
    notes.push(...changeStress(game, 2));
    fleet.deaths = 0;
  }
}

export const fleetGoingHungry = (game) => inTheFleet(game) && Boolean(game.fleet?.out?.food || game.fleet?.rations === "half");

function feedTheCaptain(game, notes) {
  if (!fleetGoingHungry(game)) return;
  if (!game.conditions.some((c) => c.id === "underfed")) notes.push(`[HEALTH] Underfed: ${say("underfed")}`);
  addCondition(game, "underfed");
}

function checkMorale(game, notes) {
  const fleet = game.fleet;
  fleet.lowMorale = game.ship.morale < RULES.walkoutMorale ? fleet.lowMorale + 1 : 0;
  if (fleet.lowMorale < RULES.walkoutDays) return;
  fleet.lowMorale = 0;
  const candidates = activeList(fleet).filter((ship) => !ship.story);
  if (!candidates.length) return;
  const ship = pick(fleet, candidates);
  const { aboard } = fleet.ships[ship.id];
  loseShip(game, ship.id, "gone", notes, { keepPeople: false, spared: aboard });
  note(game, notes, "FLEET", sayTo(game, "walkout", { ship: ship.name, aboard: aboard.toLocaleString("en-US") }));
}

function runDay(game) {
  const fleet = game.fleet;
  const notes = [];
  const ledger = fleetLedger(game);
  payForDay(game, ledger);
  checkShortages(game, notes);
  // Things get worse faster than they get better, while something's actually run out.
  const step = Object.keys(fleet.out).length ? 2 : 1;
  // People pick themselves up faster when they're being looked after and they've got a long way to climb.
  const climbing = !Object.keys(fleet.out).length && ledger.moraleTarget - game.ship.morale >= RULES.climbFrom;
  game.ship.morale = clamp(moveToward(game.ship.morale, ledger.moraleTarget, climbing ? 2 : step), 0, 100);
  fleet.health = clamp(moveToward(fleet.health, ledger.healthTarget, step), 0, 100);
  wearShips(game, ledger, notes);
  countTheDead(game, notes);
  feedTheCaptain(game, notes);
  checkMorale(game, notes);
  councilDay(game, notes);
  chairDay(game, notes);
  if (!fleet.raid) {
    fleet.pursuit = Math.min(100, round1(fleet.pursuit + ledger.pursuitRate));
    if (fleet.pursuit >= 100) startRaid(game, notes);
  }
  // Whoever has the chair answers a raid there and then. It's their order to give.
  if (fleet.raid && chairFile(fleet)) notes.push(...answerRaid(game, wouldOrder(game, chairFile(fleet).fightGuns), { byChair: true }).notes);
  return notes;
}

// ---- Someone else in the chair ----------------------------------------------------

// What's running out, most urgent first.
function fleetNeeds(game) {
  const ledger = fleetLedger(game);
  // Whatever they're eating today, what counts is whether there's enough to feed people properly.
  const standard = fleetLedger(game, { rations: "standard" });
  return SUPPLY_IDS.map((id) => ({ id, days: isOut(game, id) ? 0 : daysLeft(game, id, id === "food" ? standard : ledger) ?? Infinity })).sort((a, b) => a.days - b.days);
}

function chairBuys(game, chair, notes) {
  const fleet = game.fleet;
  const prices = mapSpot(fleet.at)?.trade;
  if (!prices || fleet.day - fleet.chair.lastBuy < CHAIR.buyEvery) return;
  const bought = [];
  for (const { id } of fleetNeeds(game)) {
    if (!prices[id]) continue;
    let lots = 0;
    while (lots < CHAIR.lotsAtOnce && !noneLeft(game, fleet.at, id)) {
      const days = fleetNeeds(game).find((need) => need.id === id).days;
      const price = Math.round(prices[id] * supplyFactor(game, fleet.at, id) * SUPPLIES[id].lot);
      // A fleet with fuel can go and get anything else, so nobody sails with less than this if they can help it.
      const wanted = id === "fuel" ? game.ship.fuel < CHAIR.fuelReserve || days < chair.stockTo : days < chair.stockTo;
      if (!wanted || fleet.chair.funds < price || (id === "fuel" && game.ship.fuel >= game.ship.maxFuel)) break;
      fleet.chair.funds -= price;
      if (id === "fuel") game.ship.fuel = Math.min(game.ship.maxFuel, game.ship.fuel + SUPPLIES[id].lot);
      else fleet[id] = round1(fleet[id] + SUPPLIES[id].lot);
      tradedAt(game, fleet.at, id);
      lots += 1;
    }
    if (lots) {
      bought.push(SUPPLIES[id].name.toLowerCase());
      noteRestocked(game, id, notes);
    }
  }
  if (!bought.length) return;
  fleet.chair.lastBuy = fleet.day;
  chairRecords(game, say("chairBought", { who: chair.name, what: bought.join(" and "), place: fleetPlaceName(fleet) }));
}

// The everyday decisions aren't news. They're in the log, and on the Fleet menu for anyone who looks.
function chairRecords(game, text) {
  const { fleet } = game;
  const council = councilOf(fleet);
  fleet.log.push({ day: clockLabel(game), tag: "FLEET", text });
  if (fleet.log.length > MAX_LOG) fleet.log.splice(0, fleet.log.length - MAX_LOG);
  council.recent.push({ day: clockLabel(game), text });
  if (council.recent.length > 6) council.recent.shift();
}

// Where's best to go from here for what's needed most, without taking the fleet anywhere this captain wouldn't.
function chairChooses(game, chair, needs) {
  const fleet = game.fleet;
  const worth = (spot, id) => (spot.yields?.[id] ?? 0) * 2 + (spot.trade?.[id] ? 6 : 0);
  let best = null;
  let bestScore = -Infinity;
  for (const id of CHAIR.ports) {
    const spot = mapSpot(id);
    if (!spot || id === fleet.at || spot.danger > chair.risk) continue;
    const { fuel } = fleetJumpCost(fleet, id);
    if (fuel > game.ship.fuel) continue;
    const score = (needs[0] ? worth(spot, needs[0].id) : 5) + (needs[1] ? worth(spot, needs[1].id) / 2 : 0) - fuel * 2 - spot.danger + dice(fleet);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}

function chairMoves(game, chair, notes) {
  const fleet = game.fleet;
  const here = mapSpot(fleet.at);
  const servedHere = (id) => Boolean(here?.yields?.[id]) || Boolean(here?.trade?.[id] && !noneLeft(game, fleet.at, id));
  const lowOnFuel = game.ship.fuel <= CHAIR.fuelLow && !here?.trade?.fuel;
  const needs = fleetNeeds(game).filter((need) => (need.days <= chair.moveAt || (need.id === "fuel" && lowOnFuel)) && !servedHere(need.id));
  if (lowOnFuel) needs.sort((a, b) => Number(b.id === "fuel") - Number(a.id === "fuel"));
  const hunted = fleet.pursuit >= chair.runAt;
  if (!needs.length && !hunted) return;
  // Nobody jumps again straight away, unless something's about to run out altogether.
  if (fleet.day - fleet.chair.lastJump < chair.restDays && !needs.some((need) => need.days <= CHAIR.desperate)) return;
  const to = chairChooses(game, chair, needs);
  if (!to) return;
  const { fuel } = fleetJumpCost(fleet, to);
  // The last of the fuel isn't for running out of something else.
  if (game.ship.fuel - fuel < 1 && needs[0]?.id !== "fuel") return;
  const from = fleet.at;
  const place = LOCATIONS[to]?.name ?? to;
  const wasHere = game.location === from && !LOCATIONS[game.location]?.fleet;
  game.ship.fuel -= fuel;
  fleetJumped(game, to, fuel);
  fleet.chair.lastJump = fleet.day;
  note(game, notes, "FLEET", say("chairJumped", { who: chair.name, place, why: TEXT.chairWhy[needs[0]?.id ?? "run"] }));
  // It's news everywhere. Anyone who was standing on the dock watches it go, and anyone at the other end watches it come.
  tellNews(game, to, say("chairCame", { place }), []);
  if (wasHere) tellNews(game, from, say("chairLeft", { from: LOCATIONS[from]?.name ?? from, place }), notes);
}

function chairSetsCrews(game, chair, notes) {
  const fleet = game.fleet;
  const council = councilOf(fleet);
  if (fleet.day - (council.last.chairCrews ?? -99) < CHAIR.crewsEvery) return;
  const needs = fleetNeeds(game);
  // A fleet with no fuel can't go and get anything else. After that it's whatever's running out, and then whatever's falling apart.
  const urgent = game.ship.fuel < 2 ? "fuel" : needs.find((need) => need.days <= chair.moveAt)?.id;
  const falling = game.ship.hull < CHAIR.repairBelow || activeList(fleet).some((ship) => conditionOf(game, ship.id) < CHAIR.repairBelow);
  const crews = urgent ? CHAIR.crews[urgent] : falling && needs.find((need) => need.id === "parts").days > chair.moveAt ? "repairs" : null;
  if (!crews || fleet.crews === crews) return;
  fleet.crews = crews;
  council.setCrews = crews;
  council.last.chairCrews = fleet.day;
  chairRecords(game, say("chairCrews", { who: chair.name, work: CREWS[crews].name.toLowerCase() }));
}

function chairDay(game, notes) {
  const fleet = game.fleet;
  const chair = chairFile(fleet);
  if (!chair || fleet.raid) return;
  fleet.chair.funds += CHAIR.income;
  chairMoves(game, chair, notes);
  chairBuys(game, chair, notes);
  chairSetsCrews(game, chair, notes);
}

// ---- The fleet's own decisions ---------------------------------------------------

// The fleet isn't thirty thousand people waiting to be told. If something's gone wrong and stayed wrong,
// the officers and the council deal with it themselves, and say so. The captain can overrule any of it,
// and an order of the captain's own stands for a while before anyone would change it.
export function councilOf(fleet) {
  fleet.council ??= { off: false, ordered: {}, waiting: {}, last: {}, setRations: null, setCrews: null, recent: [] };
  return fleet.council;
}

function councilSees(game, ledger, council) {
  const { fleet } = game;
  const left = (id) => (isOut(game, id) ? 0 : daysLeft(game, id, ledger) ?? Infinity);
  return {
    foodBelow: (n) => left("food") <= n,
    foodAbove: (n) => left("food") > n,
    foodAtStandard: (n) => {
      const { net } = fleetLedger(game, { rations: "standard" });
      return net.food >= 0 || fleet.food / -net.food > n;
    },
    medicineBelow: (n) => left("medicine") <= n,
    medicineAbove: (n) => left("medicine") > n,
    partsBelow: (n) => left("parts") <= n,
    partsAbove: (n) => left("parts") > n,
    fuelBelow: (n) => left("fuel") <= n,
    fuelAbove: (n) => left("fuel") > n,
    fuelAtLeast: (n) => game.ship.fuel >= n,
    moraleBelow: (n) => game.ship.morale < n,
    moraleAbove: (n) => game.ship.morale >= n,
    pursuitAbove: (n) => fleet.pursuit >= n,
    rations: (list) => list.includes(fleet.rations),
    crews: (list) => list.includes(fleet.crews),
    theirCrews: () => council.setCrews === fleet.crews,
    theirRations: () => council.setRations === fleet.rations,
    worstShipBelow: (n) => activeList(fleet).some((ship) => conditionOf(game, ship.id) < n),
    worstShipAbove: (n) => activeList(fleet).every((ship) => conditionOf(game, ship.id) >= n),
  };
}

// Whoever would do this, if they can. If they've been lost, the council does it instead.
function whoDecides(game, decision) {
  const person = decision.who ? findCharacter(game.campaign, decision.who) : null;
  const status = person && game.contacts?.find((contact) => contact.name.toLowerCase() === person.name.toLowerCase())?.status;
  return person && (!status || status === "alive") ? decision.name : COUNCIL.anyone;
}

function councilActs(game, decision, notes) {
  const { fleet } = game;
  const council = councilOf(fleet);
  const { rations, crews, jump } = decision.set;
  if (rations) {
    fleet.rations = rations;
    council.setRations = rations;
  }
  if (crews) {
    fleet.crews = crews;
    council.setCrews = crews;
  }
  if (jump) {
    game.ship.fuel -= 1;
    fleet.pursuit = Math.max(0, round1(fleet.pursuit - RULES.evadeShakes));
  }
  const text = decision.text.replaceAll("{who}", whoDecides(game, decision));
  note(game, notes, "COUNCIL", text);
  council.last[decision.id] = fleet.day;
  council.recent.push({ day: clockLabel(game), text });
  if (council.recent.length > 6) council.recent.shift();
}

function councilDay(game, notes) {
  const { fleet } = game;
  const council = councilOf(fleet);
  if (council.off || fleet.raid || !COUNCIL) return;
  const sees = councilSees(game, fleetLedger(game), council);
  let acted = false;
  for (const decision of COUNCIL.decisions) {
    if (!Object.entries(decision.when).every(([test, value]) => sees[test](value))) {
      delete council.waiting[decision.id];
      continue;
    }
    council.waiting[decision.id] ??= fleet.day;
    const waited = fleet.day - council.waiting[decision.id] >= (decision.wait ?? COUNCIL.wait);
    const allowed = Object.keys(decision.set).every((setting) => fleet.day - (council.ordered[setting] ?? -Infinity) >= COUNCIL.respect);
    const rested = fleet.day - (council.last[decision.id] ?? -Infinity) >= (decision.every ?? 0);
    if (acted || !waited || !allowed || !rested) continue;
    councilActs(game, decision, notes);
    delete council.waiting[decision.id];
    // One decision a day. Whatever else is wrong will still be wrong tomorrow.
    acted = true;
  }
}

// Something in a story has hit the fleet. The ships that go are the ones with least reason to stay,
// and the ones the story needs only ever go if it names them.
export function storyHitsFleet(game, { morale = 0, food = 0, medicine = 0, parts = 0, fuel = 0, pursuit = 0, ships = 0, picked = 0, sat = 0, named = null }, notes) {
  const fleet = fleetOf(game);
  game.ship.morale = clamp(game.ship.morale + morale, 0, 100);
  for (const [id, amount] of Object.entries({ food, medicine, parts })) fleet[id] = Math.max(0, round1(fleet[id] + amount));
  game.ship.fuel = clamp(game.ship.fuel + fuel, 0, game.ship.maxFuel);
  if (pursuit) fleet.pursuit = clamp(round1(fleet.pursuit + pursuit), 0, fleet.raid ? 100 : 99);
  const nextToGo = () => activeList(fleet).filter((one) => !one.story).sort((a, b) => conditionOf(game, a.id) - conditionOf(game, b.id))[0];
  for (let i = 0; i < ships + picked + sat; i += 1) {
    const ship = nextToGo();
    if (!ship) break;
    const { aboard } = fleet.ships[ship.id];
    const name = ship.name.replace(/^The /, "");
    const count = aboard.toLocaleString("en-US");
    if (i < ships) {
      loseShip(game, ship.id, "gone", notes, { keepPeople: false, spared: aboard });
      note(game, notes, "FLEET", sayTo(game, "walkout", { ship: ship.name, aboard: count }));
    } else if (i < ships + picked) {
      const dead = Math.round(aboard * (0.25 + dice(fleet) * 0.4));
      fleet.record.dead += dead;
      loseShip(game, ship.id, "lost", notes, { spared: aboard - dead });
      note(game, notes, "FLEET", say("shipLost", { ship: name, dead: dead.toLocaleString("en-US"), aboard: count }));
    } else {
      loseShip(game, ship.id, "lost", notes, { keepPeople: false });
      note(game, notes, "FLEET", say("shipSat", { ship: name, aboard: count }));
    }
  }
  if (named && fleet.ships[named.id]?.status === "active") {
    loseShip(game, named.id, named.status, notes, { keepPeople: Boolean(named.spared), spared: named.spared ?? 0 });
  }
}

// Called whenever the clock moves. Runs one day of the simulation for each midnight that's gone by.
export function advanceFleet(game, today = Math.floor(game.clock.hours / 24)) {
  const fleet = fleetOf(game);
  const notes = [];
  while (fleet.day < today) {
    fleet.day += 1;
    notes.push(...runDay(game));
  }
  return notes;
}

// ---- Losing ships -------------------------------------------------------

function removePeople(fleet, count) {
  const ships = activeList(fleet).map((ship) => fleet.ships[ship.id]).filter((state) => state.aboard > 0);
  const total = ships.reduce((sum, state) => sum + state.aboard, 0);
  if (!total) return;
  let left = Math.min(count, total);
  for (const state of ships) {
    const share = Math.min(state.aboard, left, Math.round((count * state.aboard) / total));
    state.aboard -= share;
    left -= share;
  }
  for (const state of ships) {
    const more = Math.min(state.aboard, left);
    state.aboard -= more;
    left -= more;
  }
}

function movePeopleOff(fleet, fromId, count) {
  const ships = activeList(fleet).filter((ship) => ship.id !== fromId).map((ship) => fleet.ships[ship.id]);
  const total = ships.reduce((sum, state) => sum + state.aboard, 0);
  if (!ships.length || count <= 0) return;
  let left = count;
  for (const state of ships) {
    const share = total ? Math.min(left, Math.round((count * state.aboard) / total)) : 0;
    state.aboard += share;
    left -= share;
  }
  ships[0].aboard += left;
}

// A ship leaves the fleet. Whoever's spared moves to the other ships, unless they went with her.
function loseShip(game, id, status, notes, { keepPeople = true, spared = 0 } = {}) {
  const fleet = game.fleet;
  const state = fleet.ships[id];
  if (keepPeople) movePeopleOff(fleet, id, spared);
  state.status = status;
  state.lostDay = fleet.day;
  state.aboardWhenLost = state.aboard;
  state.aboard = 0;
  if (status === "lost") fleet.record.shipsLost += 1;
  if (status === "gone") fleet.record.shipsLeft += 1;
  if (status === "stripped") fleet.record.shipsStripped += 1;
  game.ship.morale = clamp(game.ship.morale - RULES.moraleHitPerShip, 0, 100);
  if (isCaptain(game)) notes.push(...changeStress(game, RULES.stressPerShip));
}

export const lostShipNames = (game) => FLEET_DATA.ships.filter((ship) => game.fleet?.ships[ship.id] && game.fleet.ships[ship.id].status !== "active").map((ship) => ship.name.replace(/^The /, ""));

// ---- Jumps --------------------------------------------------------------

function fleetSpot(fleet) {
  return mapSpot(fleet.at) ?? STAR_MAP.start;
}

// Each row of the chart is about twice as tall as a column is wide.
function jumpBand(from, to) {
  const distance = Math.hypot(to.x - from.x, (to.y - from.y) * 2);
  return Object.values(STAR_MAP.jumps).find((entry) => distance <= entry.reach) ?? { fuel: 3, hours: 2, fare: 50 };
}

// What it takes the fleet to get somewhere.
function fleetJumpCost(fleet, destination) {
  const to = mapSpot(destination);
  return to ? jumpBand(fleetSpot(fleet), to) : { fuel: 1, hours: 1 };
}

// What a place on someone else's ship costs. Nobody runs passage to some places at any price.
function passageCost(game, destination) {
  const fleet = fleetOf(game);
  const going = LOCATIONS[destination]?.fleet ? fleetSpot(fleet) : mapSpot(destination);
  const from = mapSpot(game.location) ?? fleetSpot(fleet);
  const { hours: base, dangerFare } = STAR_MAP.passage;
  if (!going) return { fuel: 0, fare: STAR_MAP.jumps.long.fare, hours: Math.round(base * STAR_MAP.jumps.long.hours), jump: true };
  const band = jumpBand(from, going);
  const danger = LOCATIONS[destination]?.fleet ? 0 : going.danger ?? 0;
  return { fuel: 0, fare: Math.round(band.fare * (1 + danger * dangerFare)), hours: Math.round(base * band.hours), jump: true, none: Boolean(going.noPassage) };
}

// What it takes to get somewhere: a shuttle hop for anything already with the fleet, and otherwise a jump,
// or for anyone who isn't the captain, a passage.
export function jumpCost(game, destination) {
  const fleet = fleetOf(game);
  if (!isCaptain(game)) {
    const shuttle = inTheFleet(game) && (LOCATIONS[destination]?.fleet || destination === fleet.at);
    return shuttle ? { fuel: 0, fare: 0, hours: 1, jump: false } : passageCost(game, destination);
  }
  if (LOCATIONS[destination]?.fleet || destination === fleet.at) return { fuel: 0, hours: 1, jump: false };
  const to = mapSpot(destination);
  const band = to ? fleetJumpCost(fleet, destination) : { fuel: 1, hours: 1 };
  // With the Meridian's navigation down, the jump's plotted by hand: a fuel more, and half as long again.
  const byHand = navigationDown(game);
  return { fuel: band.fuel + (byHand ? 1 : 0), hours: Math.round(jumpHours(game) * band.hours * (byHand ? 1.5 : 1)), jump: true, ...(byHand ? { byHand: true } : {}) };
}

// The fleet has arrived somewhere new, and anything following has lost the trail for a while.
export function fleetJumped(game, destination, fuel) {
  const fleet = fleetOf(game);
  fleet.at = destination;
  fleet.pursuit = Math.max(0, round1(fleet.pursuit - (RULES.jumpShakes[fuel] ?? RULES.jumpShakes[1])));
}

function evade(game) {
  const fleet = fleetOf(game);
  if (game.ship.fuel < 1) throw new Error("The fleet's out of fuel, so it can't jump.");
  game.ship.fuel -= 1;
  fleet.pursuit = Math.max(0, round1(fleet.pursuit - RULES.evadeShakes));
  const notes = passTime(game, Math.ceil(jumpHours(game) / 2));
  notes.push(...practice(game, "navigation", 1));
  const message = say("evade", { fuel: game.ship.fuel, clock: clockLabel(game) });
  return { message, notes: [`[NAV] ${message}`, ...notes] };
}

// ---- Raids --------------------------------------------------------------

function raidStrength(game) {
  const fleet = fleetOf(game);
  const act = game.story?.act ?? 1;
  return Math.min(4, 1 + fleet.record.raids * 0.2 + (act - 1) * 0.35 + (fleet.at && dangerOf(fleet.at) >= 3 ? 0.5 : 0));
}

function guns(game) {
  const fleet = game.fleet;
  const all = FLEET_DATA.ships.reduce((sum, ship) => sum + (ship.guns ?? 0), 0);
  const live = activeList(fleet).reduce((sum, ship) => sum + (ship.guns ?? 0) * shipOutput(conditionOf(game, ship.id)), 0);
  return all ? live / all : 0;
}

function startRaid(game, notes) {
  const fleet = game.fleet;
  fleet.pursuit = 100;
  fleet.raid = { day: fleet.day, intro: pick(fleet, TEXT.raidIntro) };
  note(game, notes, "RAID", say("raidAlarm"), { heard: false });
}

const lossesText = (expected) => {
  const low = Math.floor(expected);
  const high = Math.ceil(expected);
  return low === high ? `About ${plural(low, "ship")} lost` : `${low} to ${high} ships lost`;
};

// How each answer to a raid would go, as far as anyone can tell, so the player can choose knowing it.
function raidResponses(game) {
  const strength = raidStrength(game);
  const cover = guns(game);
  // It's the captain's skill that counts, so nobody else's helps.
  const skill = (id) => (isCaptain(game) ? skillRank(game, id) * 0.05 : 0);
  const expected = {
    jump: RAID.responses.jump.losses * strength - skill("piloting"),
    fight: RAID.responses.fight.losses * strength * (1 - 0.6 * cover) - skill("tactics"),
    scatter: RAID.responses.scatter.losses * strength - skill("leadership"),
  };
  const hullCost = Math.round(RAID.responses.fight.hull * strength);
  const partsCost = Math.round(RAID.responses.fight.parts * strength);
  return Object.entries(RAID.responses).map(([id, response]) => {
    const costs = [];
    if (response.fuel) costs.push(`${response.fuel} fuel`);
    if (id === "fight") costs.push(`about ${hullCost} of the Meridian's hull`, `${partsCost} parts`, `${response.stress} stress`);
    if (response.morale) costs.push(`${Math.abs(response.morale)} morale`);
    if (response.hours) costs.push(`${plural(Math.round(response.hours / 24), "day")} to regroup`);
    let why = null;
    if (response.fuel && game.ship.fuel < response.fuel) why = "There's no fuel to jump with.";
    if (id === "fight" && game.ship.hull <= hullCost) why = "The Meridian couldn't take another fight.";
    const losses = Math.max(0.2, expected[id]);
    return { id, name: response.name, desc: response.desc, losses, lossesText: lossesText(losses), costs, pursuitAfter: response.pursuitAfter, available: !why, why, hullCost, partsCost };
  });
}

function chooseVictims(game, count, response) {
  const fleet = game.fleet;
  const victims = [];
  let pool = activeList(fleet).filter((ship) => !ship.story);
  while (victims.length < count && pool.length) {
    const weigh = (ship) => (110 - conditionOf(game, ship.id)) * (ship.slow && response === "jump" ? 2.5 : 1);
    let roll = dice(fleet) * pool.reduce((sum, ship) => sum + weigh(ship), 0);
    const chosen = pool.find((ship) => {
      roll -= weigh(ship);
      return roll <= 0;
    }) ?? pool[0];
    victims.push(chosen);
    pool = pool.filter((ship) => ship !== chosen);
  }
  return victims;
}

// Whoever gives the order would rather take the hit than leave the slow ships to it, if they've got the guns they want for it.
function wouldOrder(game, fightGuns) {
  const options = raidResponses(game).filter((entry) => entry.available);
  const fight = options.find((entry) => entry.id === "fight");
  if (fight && guns(game) >= fightGuns && game.ship.hull > fight.hullCost * 2) return "fight";
  return (options.find((entry) => entry.id === "jump") ?? options[0]).id;
}

const vossWouldOrder = (game) => wouldOrder(game, 0.5);

export function answerRaid(game, chosen, { byChair = false } = {}) {
  const fleet = fleetOf(game);
  if (!fleet.raid) throw new Error("There's no raid to answer right now.");
  const byVoss = chosen === "voss";
  const responseId = byVoss ? vossWouldOrder(game) : chosen;
  const option = raidResponses(game).find((entry) => entry.id === responseId);
  if (!option) throw new Error("That isn't one of the orders you can give.");
  if (!option.available) throw new Error(option.why);
  const response = RAID.responses[responseId];
  const notes = [];
  const report = { response: response.name, byVoss, lost: [], crippled: [], damaged: [], costs: [] };

  if (response.fuel) {
    game.ship.fuel -= response.fuel;
    report.costs.push(`Fuel -${response.fuel}`);
  }
  if (response.morale) {
    game.ship.morale = clamp(game.ship.morale + response.morale, 0, 100);
    report.costs.push(`Morale ${response.morale}`);
  }
  if (responseId === "fight") {
    const hit = option.hullCost + Math.round((dice(fleet) - 0.5) * 6);
    const before = game.ship.hull;
    game.ship.hull = Math.max(1, game.ship.hull - hit);
    fleet.parts = Math.max(0, round1(fleet.parts - option.partsCost));
    report.costs.push(`Meridian's hull -${before - game.ship.hull}`, `Parts -${option.partsCost}`);
    if (!byChair) notes.push(...changeStress(game, response.stress), ...practice(game, "tactics", 3));
  }

  const whole = Math.floor(option.losses);
  const count = whole + (dice(fleet) < option.losses - whole ? 1 : 0);
  const victims = chooseVictims(game, count, responseId);
  const lines = [sayTo(game, `${responseId}Line`)];
  for (const ship of victims) {
    const { aboard } = fleet.ships[ship.id];
    const dead = Math.round(aboard * (0.25 + dice(fleet) * 0.4));
    fleet.record.dead += dead;
    loseShip(game, ship.id, "lost", notes, { spared: aboard - dead });
    report.lost.push({ name: ship.name, aboard, dead });
    lines.push(say("shipLost", { ship: ship.name.replace(/^The /, ""), dead: dead.toLocaleString("en-US"), aboard: aboard.toLocaleString("en-US") }));
  }
  // Once there's nothing left to lose but the ships the story needs, they get crippled instead.
  const untouchedStory = activeList(fleet).filter((ship) => ship.story && ship.id !== "meridian" && conditionOf(game, ship.id) > 15);
  for (let i = victims.length; i < count && untouchedStory.length; i += 1) {
    const ship = untouchedStory.splice(Math.floor(dice(fleet) * untouchedStory.length), 1)[0];
    setCondition(game, ship.id, 8 + dice(fleet) * 7);
    report.crippled.push(ship.name);
    lines.push(say("shipCrippled", { ship: ship.name.replace(/^The /, "") }));
  }
  const strength = raidStrength(game);
  const others = activeList(fleet).filter((ship) => ship.id !== "meridian" && !report.crippled.includes(ship.name));
  for (let i = 0; i < 2 + Math.floor(strength) && others.length; i += 1) {
    const ship = others.splice(Math.floor(dice(fleet) * others.length), 1)[0];
    setCondition(game, ship.id, Math.max(5, conditionOf(game, ship.id) - (8 + dice(fleet) * 16)));
    report.damaged.push(ship.name);
  }
  if (report.damaged.length) lines.push(say("shipDamaged", { ships: report.damaged.map((name) => name.replace(/^The /, "")).join(", ") }));
  if (!report.lost.length && !report.crippled.length) {
    lines.push(say("noLoss"));
    game.ship.morale = clamp(game.ship.morale + 2, 0, 100);
  }

  fleet.raid = null;
  fleet.record.raids += 1;
  fleet.pursuit = response.pursuitAfter;
  if (response.hours && !byChair) {
    notes.push(...passTime(game, response.hours, "routine"));
    report.costs.push(`${plural(Math.round(response.hours / 24), "day")} to regroup`);
    fleet.pursuit = response.pursuitAfter;
  }
  const shipsLeft = activeList(fleet).length;
  const people = peopleIn(fleet).toLocaleString("en-US");
  report.lines = lines;
  report.shipsLeft = shipsLeft;
  report.people = people;
  report.tone = report.lost.length ? "bad" : report.crippled.length ? "warn" : "good";
  report.title = report.lost.length ? `${plural(report.lost.length, "ship")} lost` : report.crippled.length ? "Badly hit" : "Every ship came through";

  for (const line of lines) note(game, notes, "RAID", line, { heard: false });
  // A raid is told to the game master like a fight, and the story waits for the player to carry on.
  const lostNames = report.lost.map((entry) => `${entry.name} (${entry.dead} dead)`);
  const result = [lostNames.length ? `Lost: ${lostNames.join(", ")}.` : "No ships lost.", report.crippled.length ? `Crippled: ${report.crippled.join(", ")}.` : null, report.damaged.length ? `Damaged: ${report.damaged.join(", ")}.` : null].filter(Boolean).join(" ");
  const told = say("raidReport", { response: `${byChair ? `${chairFile(fleet).name} ordered` : byVoss ? "The captain left it to Commander Voss, who ordered" : "The captain ordered"}: ${response.name}.`, result, ships: shipsLeft, people });
  if (!byChair) game.pendingEvents.push(told);
  // Anyone aboard is in it, and for anyone else it's news if it cost a ship.
  else if (inTheFleet(game)) fleet.unheard.push({ about: null, text: told });
  else if (report.lost.length) tellNews(game, fleet.at ?? "meridian", say("chairHit", { at: fleet.at ? ` at ${fleetPlaceName(fleet)}` : "", lost: report.lost.length === 1 ? `the ${report.lost[0].name.replace(/^The /, "")} is` : `${report.lost.length} ships are` }), notes, true);
  return { message: report.title, notes, report };
}

// ---- The player's decisions, all made here without the game master ------

function setRations(game, id) {
  const fleet = fleetOf(game);
  if (!RATIONS[id]) throw new Error("There's no such ration level.");
  if (fleet.rations === id) return { message: null, notes: [] };
  fleet.rations = id;
  councilOf(fleet).ordered.rations = fleet.day;
  councilOf(fleet).setRations = null;
  const notes = [];
  const text = `Rations across the fleet are now ${RATIONS[id].name.toLowerCase()}.`;
  note(game, notes, "FLEET", text);
  return { message: text, notes };
}

function setCrews(game, id) {
  const fleet = fleetOf(game);
  if (!CREWS[id]) throw new Error("There's no such work order.");
  if (fleet.crews === id) return { message: null, notes: [] };
  fleet.crews = id;
  councilOf(fleet).ordered.crews = fleet.day;
  councilOf(fleet).setCrews = null;
  const notes = [];
  const text = `The work crews are now on ${CREWS[id].name.toLowerCase()}.`;
  note(game, notes, "FLEET", text);
  return { message: text, notes };
}

function setCouncil(game, on) {
  const fleet = fleetOf(game);
  const council = councilOf(fleet);
  if (council.off === !on) return { message: null, notes: [] };
  council.off = !on;
  council.waiting = {};
  const notes = [];
  const text = on ? COUNCIL.free : COUNCIL.held;
  note(game, notes, "COUNCIL", text);
  return { message: text, notes };
}

function wait(game, requested) {
  const fleet = fleetOf(game);
  const days = clamp(Number.isInteger(requested) ? requested : 1, 1, 3);
  const notes = [];
  let waited = 0;
  while (waited < days && !fleet.raid) {
    notes.push(...passTime(game, 24, "routine"));
    waited += 1;
  }
  const message = sayTo(game, "wait", { days: plural(waited, "day"), clock: clockLabel(game) });
  return { message, notes: [`[TIME] ${message}`, ...notes] };
}

function setCourse(game, id) {
  const place = LOCATIONS[id];
  if (!place) throw new Error("That place isn't on the chart.");
  const from = game.location;
  const cost = jumpCost(game, id);
  const jumped = cost.jump;
  if (!isCaptain(game) && from !== id) {
    if (cost.none) throw new Error(`Nobody runs a ship to ${place.name}.`);
    if (cost.fare > game.credits) throw new Error(`Passage to ${place.name} costs ${cost.fare} credits, and you have ${game.credits}.`);
    game.credits -= cost.fare;
  }
  const { message, notes } = travel(game, id);
  if (from !== game.location) {
    // The written story can have an arrival for this place, played when the player continues.
    game.arrived = game.location;
    if (isCaptain(game)) game.pendingEvents.push(jumped ? `On the captain's order, the fleet jumped to ${place.name}.` : `The captain crossed over to ${place.name}.`);
    else game.pendingEvents.push(jumped ? `The player paid ${cost.fare} credits for passage to ${place.name}, on someone else's ship. They've just arrived, alone.` : `The player crossed over to ${place.name}.`);
  }
  return { message, notes: [`[NAV] ${message}`, ...notes], moved: from !== game.location };
}

function buySupply(game, id) {
  const fleet = fleetOf(game);
  const supply = SUPPLIES[id];
  const prices = mapSpot(fleet.at)?.trade;
  if (!supply || !prices?.[id]) throw new Error("Nobody here is selling that to the fleet.");
  if (noneLeft(game, fleet.at, id)) throw new Error("Nobody here has any left to sell.");
  const price = buyPrice(game, { price: prices[id] * supplyFactor(game, fleet.at, id) * supply.lot });
  if (game.credits < price) throw new Error("You can't afford that.");
  if (id === "fuel" && game.ship.fuel >= game.ship.maxFuel) throw new Error("The tanks are full.");
  game.credits -= price;
  if (id === "fuel") game.ship.fuel = Math.min(game.ship.maxFuel, game.ship.fuel + supply.lot);
  else fleet[id] = round1(fleet[id] + supply.lot);
  tradedAt(game, fleet.at, id);
  const notes = [];
  const amount = supply.unit ? `${supply.lot} ${supply.unit}` : String(supply.lot);
  const message = say("bought", { amount, supply: supply.name.toLowerCase(), price });
  note(game, notes, "SUPPLY", message);
  noteRestocked(game, id, notes);
  return { message, notes };
}

// Where something's short, it can be worth more there than the fleet needs it. It's the player's call.
function sellSupply(game, id) {
  const fleet = fleetOf(game);
  const supply = SUPPLIES[id];
  const prices = mapSpot(fleet.at)?.trade;
  if (!supply || !prices?.[id]) throw new Error("Nobody here is buying that from the fleet.");
  const amount = supply.unit ? `${supply.lot} ${supply.unit}` : String(supply.lot);
  if ((id === "fuel" ? game.ship.fuel : fleet[id]) < supply.lot) throw new Error(`The fleet hasn't got ${amount} of ${supply.name.toLowerCase()} to sell.`);
  const price = sellPrice(game, { price: prices[id] * supplyFactor(game, fleet.at, id) * supply.lot });
  game.credits += price;
  if (id === "fuel") game.ship.fuel -= supply.lot;
  else fleet[id] = round1(fleet[id] - supply.lot);
  tradedAt(game, fleet.at, id, true);
  const notes = [];
  const message = say("sold", { amount, supply: supply.name.toLowerCase(), price });
  note(game, notes, "SUPPLY", message);
  return { message, notes };
}

function stripShip(game, id) {
  const fleet = fleetOf(game);
  const ship = FLEET_SHIPS[id];
  if (!ship || fleet.ships[id]?.status !== "active") throw new Error("That ship isn't in the fleet any more.");
  if (ship.story || !ship.strip) throw new Error(`The ${ship.name.replace(/^The /, "")} can't be stripped from here. That would take a decision in the story.`);
  const { parts = 0, fuel = 0 } = ship.strip;
  const { aboard } = fleet.ships[id];
  const notes = [];
  loseShip(game, id, "stripped", notes, { spared: aboard });
  fleet.parts = round1(fleet.parts + parts);
  game.ship.fuel = Math.min(game.ship.maxFuel, game.ship.fuel + fuel);
  const gain = [parts && `${parts} parts`, fuel && `${fuel} fuel`].filter(Boolean).join(" and ");
  const message = say("strip", { ship: ship.name.replace(/^The /, ""), gain, aboard: aboard.toLocaleString("en-US") });
  note(game, notes, "FLEET", message);
  noteRestocked(game, "parts", notes);
  noteRestocked(game, "fuel", notes);
  return { message: `${ship.name}: stripped for ${gain}.`, notes };
}

// Everything the Fleet menu and the star map can do. None of it talks to the game master.
export function fleetCommand(game, body) {
  const fleet = fleetOf(game);
  if (!isCaptain(game) && body.action !== "wait" && body.action !== "course") throw new Error(say("chairTook", { who: chairOf(game)?.name ?? "Someone else" }));
  if (fleet.raid && body.action !== "raid") throw new Error("The fleet's under attack. Give your orders first.");
  switch (body.action) {
    case "rations": return setRations(game, body.id);
    case "crews": return setCrews(game, body.id);
    case "council": return setCouncil(game, Boolean(body.on));
    case "wait": return wait(game, body.days);
    case "evade": return evade(game);
    case "course": return setCourse(game, body.id);
    case "buy": return buySupply(game, body.id);
    case "sell": return sellSupply(game, body.id);
    case "strip": return stripShip(game, body.id);
    case "raid": return answerRaid(game, body.id);
    default: throw new Error("Unknown order.");
  }
}

// ---- What the browser gets to see ---------------------------------------

function crewEffects(game, id) {
  const base = fleetLedger(game, { crews: "upkeep" });
  const next = fleetLedger(game, { crews: id });
  const crews = CREWS[id];
  const out = [];
  for (const supply of SUPPLY_IDS) {
    const change = next.net[supply] - base.net[supply];
    if (Math.abs(change) >= 0.01) out.push({ text: `${change > 0 ? "+" : ""}${round2(change)} ${supply} a day`, good: change > 0 });
  }
  if (next.moraleTarget !== base.moraleTarget) out.push({ text: `morale settles ${next.moraleTarget > base.moraleTarget ? "higher" : "lower"}, at ${next.moraleTarget}`, good: next.moraleTarget > base.moraleTarget });
  if (next.healthTarget !== base.healthTarget) out.push({ text: `health settles ${next.healthTarget > base.healthTarget ? "higher" : "lower"}, at ${next.healthTarget}`, good: next.healthTarget > base.healthTarget });
  if (crews.pursuit) out.push({ text: `the Choir closes in ${crews.pursuit < 1 ? "half as fast" : `${Math.round((crews.pursuit - 1) * 100)}% faster`}`, good: crews.pursuit < 1 });
  if (crews.wear) out.push({ text: `ships wear out ${Math.round((crews.wear - 1) * 100)}% faster`, good: false });
  if (crews.repairs) out.push({ text: `repairs the ${crews.repairShips} worst ships by ${crews.repairs} a day`, good: true });
  return out;
}

function supplyRow(game, id, ledger) {
  const supply = SUPPLIES[id];
  const days = daysLeft(game, id, ledger);
  const out = isOut(game, id);
  return {
    id,
    name: supply.name,
    unit: supply.unit,
    stock: id === "fuel" ? game.ship.fuel : round1(game.fleet[id]),
    max: id === "fuel" ? game.ship.maxFuel : Math.max(FLEET_DATA.start[id] * 1.5, game.fleet[id]),
    made: round2(ledger.made[id]),
    used: round2(ledger.used[id]),
    net: round2(ledger.net[id]),
    days: days === null ? null : Math.floor(days),
    out,
    low: !out && days !== null && days <= RULES.warnAtDays,
  };
}

function shipRow(game, ship, ledger) {
  const fleet = game.fleet;
  const state = fleet.ships[ship.id];
  const active = state.status === "active";
  const condition = active ? conditionOf(game, ship.id) : 0;
  const output = shipOutput(condition) * ledger.work;
  const crews = CREWS[fleet.crews] ?? CREWS.upkeep;
  return {
    id: ship.id,
    name: ship.name,
    class: ship.class,
    role: ship.role,
    captain: ship.id === "meridian" ? chairOf(game)?.name ?? `Captain ${game.name}` : ship.captain,
    aboard: active ? state.aboard : state.aboardWhenLost ?? 0,
    condition: Math.round(condition),
    status: state.status,
    lostDay: state.lostDay === undefined ? null : state.lostDay + 1,
    makes: Object.entries(ship.produces ?? {}).map(([id, amount]) => ({ id, amount: round2(amount * output * (crews.boost?.[id] ?? 1)) })),
    uses: Object.entries(ship.uses ?? {}).map(([id, amount]) => ({ id, amount })),
    guns: ship.guns ?? 0,
    slow: Boolean(ship.slow),
    note: ship.note,
    place: ship.place && LOCATIONS[ship.place] ? ship.place : null,
    here: ship.place === game.location,
    strip: !ship.story && ship.strip ? ship.strip : null,
  };
}

function raidView(game) {
  const fleet = game.fleet;
  if (!fleet.raid) return null;
  return {
    ...fleet.raid,
    art: RAID.art,
    pursuit: fleet.pursuit,
    responses: raidResponses(game).map(({ id, name, desc, lossesText: losses, costs, pursuitAfter, available, why }) => ({ id, name, desc, losses, costs, pursuitAfter, available, why })),
    voss: vossWouldOrder(game),
  };
}

const fleetPlaceName = (fleet) => LOCATIONS[fleet.at]?.name ?? STAR_MAP.openSpace;

export function fleetView(game) {
  const fleet = fleetOf(game);
  const ledger = fleetLedger(game);
  const ships = FLEET_DATA.ships.filter((ship) => fleet.ships[ship.id]);
  const spot = mapSpot(fleet.at);
  return {
    at: fleet.at,
    atName: fleetPlaceName(fleet),
    atText: fleet.at ? `at ${fleetPlaceName(fleet)}` : `in ${STAR_MAP.openSpace.toLowerCase()}`,
    start: { x: STAR_MAP.start.x, y: STAR_MAP.start.y },
    chart: { cols: STAR_MAP.cols, rows: STAR_MAP.rows, levels: STAR_MAP.dangerLevels },
    shipCount: activeList(fleet).length,
    shipTotal: ships.length,
    people: ledger.people,
    health: fleet.health,
    healthTarget: ledger.healthTarget,
    moraleTarget: ledger.moraleTarget,
    work: Math.round(ledger.work * 100),
    pursuit: Math.round(fleet.pursuit),
    pursuitRate: round1(ledger.pursuitRate),
    raidInDays: fleet.raid ? 0 : Math.ceil((100 - fleet.pursuit) / ledger.pursuitRate),
    jumpShakes: RULES.jumpShakes,
    evadeShakes: RULES.evadeShakes,
    rations: Object.entries(RATIONS).map(([id, rations]) => {
      const next = fleetLedger(game, { rations: id });
      return { id, name: rations.name, desc: rations.desc, current: fleet.rations === id, foodUsed: round1(next.used.food), moraleTarget: next.moraleTarget, healthTarget: next.healthTarget };
    }),
    crews: Object.entries(CREWS).map(([id, crews]) => ({ id, name: crews.name, desc: crews.desc, current: fleet.crews === id, effects: crewEffects(game, id) })),
    supplies: SUPPLY_IDS.map((id) => supplyRow(game, id, ledger)),
    shortages: SUPPLY_IDS.filter((id) => isOut(game, id) || (daysLeft(game, id, ledger) ?? Infinity) <= RULES.warnAtDays),
    gathers: Object.entries(spot?.yields ?? {}).map(([id, amount]) => ({ id, amount })),
    trade: Object.entries(spot?.trade ?? {}).map(([id, each]) => {
      const supply = SUPPLIES[id];
      const worth = each * supplyFactor(game, fleet.at, id) * supply.lot;
      const level = game.world?.places[fleet.at]?.goods[id];
      return {
        id,
        name: supply.name,
        amount: supply.unit ? `${supply.lot} ${supply.unit}` : String(supply.lot),
        price: buyPrice(game, { price: worth }),
        sellFor: sellPrice(game, { price: worth }),
        level: level === undefined ? null : levelName(level),
        none: noneLeft(game, fleet.at, id),
        spare: (id === "fuel" ? game.ship.fuel : fleet[id]) >= supply.lot,
        full: id === "fuel" && game.ship.fuel >= game.ship.maxFuel,
      };
    }),
    ships: ships.map((ship) => shipRow(game, ship, ledger)),
    log: [...fleet.log].reverse().slice(0, 14),
    record: fleet.record,
    council: { off: Boolean(fleet.council?.off), recent: [...(fleet.council?.recent ?? [])].reverse() },
    raid: raidView(game),
  };
}

// What the star map shows about a place the player knows of.
export function chartEntry(game, id) {
  const fleet = fleetOf(game);
  const place = LOCATIONS[id];
  const spot = mapSpot(id);
  const cost = jumpCost(game, id);
  let why = null;
  if (isCaptain(game)) {
    if (cost.fuel > 0 && game.ship.fuel < cost.fuel) why = `Needs ${cost.fuel} fuel, and the fleet has ${game.ship.fuel}.`;
  } else if (cost.none) why = "Nobody runs a ship there.";
  else if (cost.fare > game.credits) why = `Passage costs ${cost.fare} credits, and you have ${game.credits}.`;
  const controller = FACTIONS[place.faction]?.name;
  const usualDanger = place.fleet ? 0 : spot?.danger ?? (place.dangerous ? 3 : 1);
  // Trouble at a place makes it one step more dangerous for as long as it lasts.
  const danger = Math.min(STAR_MAP.dangerLevels.length - 1, usualDanger + (inTrouble(game, id) ? 1 : 0));
  const now = placeNow(game, id);
  return {
    short: spot?.short ?? place.name,
    x: spot?.x ?? null,
    y: spot?.y ?? null,
    hours: cost.hours,
    fuel: cost.fuel,
    fare: cost.fare ?? 0,
    jump: cost.jump,
    fleetIsHere: id === fleet.at,
    danger,
    dangerLabel: STAR_MAP.dangerLevels[danger],
    control: now?.changed ? now.holder : spot?.control ?? controller ?? now?.holder ?? "Nobody in particular",
    now,
    gathers: Object.entries(spot?.yields ?? {}).map(([supply, amount]) => ({ id: supply, amount })),
    sells: Object.keys(spot?.trade ?? {}),
    shakes: isCaptain(game) && cost.jump ? RULES.jumpShakes[cost.fuel] ?? RULES.jumpShakes[1] : 0,
    canGo: !why,
    why,
  };
}

// ---- What the game master gets ------------------------------------------

function dayCount(game, id, ledger) {
  if (isOut(game, id)) return "OUT";
  const days = daysLeft(game, id, ledger);
  return days === null ? "steady" : `${Math.floor(days)}d`;
}

// One compact line in the state block. It's rounded, so that it doesn't change on every turn.
export function fleetLine(game) {
  const fleet = fleetOf(game);
  const ledger = fleetLedger(game);
  const gone = lostShipNames(game);
  const crippled = activeList(fleet).filter((ship) => conditionOf(game, ship.id) <= 15).map((ship) => ship.name.replace(/^The /, ""));
  const supplies = SUPPLY_IDS.map((id) => `${id} ${dayCount(game, id, ledger)}`).join(", ");
  const lost = gone.length ? `${gone.slice(-6).join(", ")}${gone.length > 6 ? ` and ${gone.length - 6} more` : ""}` : "none";
  const chair = chairOf(game);
  if (chair && !inTheFleet(game)) return `The fleet, under ${chair.name}, isn't the player's to command, and they only know what's got around: ${activeList(fleet).length} ships, last heard of at ${fleetPlaceName(fleet)}.`;
  return `${chair ? `The fleet, under ${chair.name}, isn't the player's to command: ` : "Fleet: "}${activeList(fleet).length} ships, ${(Math.round(ledger.people / 100) * 100).toLocaleString("en-US")} people, health ${fleet.health}/100, at ${fleetPlaceName(fleet)}. Left: ${supplies}. Rations ${RATIONS[fleet.rations].name.toLowerCase()}, crews on ${CREWS[fleet.crews].name.toLowerCase()}. Choir pursuit ${Math.round(fleet.pursuit / 5) * 5}/100. Ships gone: ${lost}.${crippled.length ? ` Crippled: ${crippled.slice(0, 3).join(", ")}.` : ""}`;
}

// What's happened since the game master last heard. It goes out once, with the next message.
export function fleetReport(game) {
  const fleet = game.fleet;
  if (!fleet?.unheard?.length) return null;
  const lines = fleet.unheard.splice(0);
  const shown = lines.slice(-MAX_REPORT_LINES);
  const older = lines.length - shown.length;
  return `<fleet_report>Happened in the fleet by itself since your last message${older ? `, among ${older} smaller things` : ""}: ${shown.map((entry) => entry.text).join(" ")} Bring what matters into the story as the serious thing it is.</fleet_report>`;
}

export function markFleetHeard(game) {
  if (game.fleet) game.fleet.unheard = [];
}

// The roster, or one ship's entry, for when a scene needs it.
export function fleetRoster(game, name) {
  const fleet = fleetOf(game);
  const entry = (ship) => {
    const state = fleet.ships[ship.id];
    const makes = Object.entries(ship.produces ?? {}).map(([id, amount]) => `${amount} ${id}`).join(", ");
    const captain = ship.id === "meridian" ? chairOf(game)?.name ?? `Captain ${game.name}` : ship.captain;
    if (state.status !== "active") return `${ship.name} (${ship.role}): ${state.status} on day ${state.lostDay + 1}.`;
    return `${ship.name} (id ${ship.id}): ${ship.role}, ${ship.class}. ${captain}. ${state.aboard} aboard, condition ${Math.round(conditionOf(game, ship.id))}/100.${makes ? ` Makes ${makes} a day.` : ""} ${ship.note}`;
  };
  const ships = FLEET_DATA.ships.filter((ship) => fleet.ships[ship.id]);
  if (!name) return ships.map(entry).join("\n");
  const ship = findFleetShip(name);
  if (!ship || !fleet.ships[ship.id]) throw new Error(`There's no ship called ${name} in the fleet. Call read_fleet with no name for the list.`);
  return entry(ship);
}

export function findFleetShip(name) {
  const lower = String(name).toLowerCase().trim();
  return FLEET_DATA.ships.find((ship) => ship.id === lower || ship.name.toLowerCase() === lower || ship.name.toLowerCase().replace(/^the /, "") === lower || (ship.aliases ?? []).some((alias) => alias.toLowerCase() === lower)) ?? null;
}

// Someone's taken the chair, or lost it, in the story. It takes both sides to mean it, so this comes from the game master.
export function changeCommand(game, { takes, reason }) {
  const fleet = fleetOf(game);
  game.role ??= { id: "captain", captain: true };
  if (takes) {
    if (isCaptain(game)) return { summary: "They already have command." };
    if (!inTheFleet(game)) throw new Error("They have to be with the fleet to take command of it. Use travel first.");
    const was = chairOf(game);
    game.role.captain = true;
    fleet.chair = null;
    return { summary: `They're the captain now. ${was ? `${was.name} isn't, and the rations, the crews, the jumps and the raids are all the player's to answer.` : ""}`, notice: `[FLEET] You have command of the fleet: ${reason}`, notes: [] };
  }
  if (!isCaptain(game)) return { summary: "They aren't in command anyway." };
  game.role.captain = false;
  fleet.chair = newChair(game);
  fleet.raid = null;
  const chair = chairOf(game);
  return { summary: `They aren't the captain any more. ${chair.name} (id ${chair.id}) is, and you play them. The fleet goes on by itself from here, and the player goes where they like.`, notice: `[FLEET] ${chair.name} has command of the fleet now: ${reason}`, notes: [] };
}

// The game master changes the fleet only through these, after something in the story.
export function changeFleet(game, { food = 0, medicine = 0, parts = 0, pursuit = 0, reason }) {
  const fleet = fleetOf(game);
  const notes = [];
  const changes = [];
  const change = (label, key, amount, limit) => {
    const applied = clamp(amount, -limit, limit);
    if (!applied) return;
    const before = fleet[key];
    fleet[key] = Math.max(0, round1(before + applied));
    if (fleet[key] !== before) changes.push(`${label} ${fleet[key] > before ? "+" : ""}${round1(fleet[key] - before)}`);
  };
  change("Food", "food", food, 120);
  change("Medicine", "medicine", medicine, 40);
  change("Parts", "parts", parts, 40);
  const shift = clamp(pursuit, -40, 25);
  if (shift) {
    const before = fleet.pursuit;
    // Only time can set off a raid, so the story can bring the Choir close, but not bring it down on them.
    fleet.pursuit = clamp(round1(before + shift), 0, fleet.raid ? 100 : 99);
    changes.push(`Pursuit ${fleet.pursuit > before ? "+" : ""}${round1(fleet.pursuit - before)}`);
  }
  for (const id of STORES) noteRestocked(game, id, notes);
  const summary = `Food ${Math.round(fleet.food)}, medicine ${Math.round(fleet.medicine)}, parts ${Math.round(fleet.parts)}, pursuit ${Math.round(fleet.pursuit)}.`;
  return { summary, notice: `[FLEET] ${changes.length ? `${changes.join(", ")}: ` : ""}${reason}`, notes };
}

export function changeFleetShip(game, { ship: name, condition = 0, status, reason }) {
  const fleet = fleetOf(game);
  const ship = findFleetShip(name);
  if (!ship || !fleet.ships[ship.id]) throw new Error(`There's no ship called ${name} in the fleet. Call read_fleet for the list.`);
  const state = fleet.ships[ship.id];
  const label = ship.name.replace(/^The /, "");
  const notes = [];
  if (status === "lost" || status === "gone") {
    if (ship.place) throw new Error(`The ${label} is a place in the game, so she can't leave the fleet. Damage her with condition instead.`);
    if (state.status === "active") {
      const aboard = state.aboard;
      loseShip(game, ship.id, status, notes, { keepPeople: false, spared: aboard });
    }
    return { summary: `${ship.name} is now ${status}.`, notice: `[FLEET] ${ship.name} ${status === "lost" ? "is lost" : "has left the fleet"}: ${reason}`, notes };
  }
  if (status === "active" && state.status !== "active") {
    state.status = "active";
    state.aboard = state.aboardWhenLost ?? ship.aboard;
    delete state.lostDay;
    return { summary: `${ship.name} is back with the fleet.`, notice: `[FLEET] ${ship.name} is back with the fleet: ${reason}`, notes };
  }
  if (state.status !== "active") throw new Error(`The ${label} isn't in the fleet any more.`);
  const amount = clamp(condition, -60, 40);
  const before = conditionOf(game, ship.id);
  setCondition(game, ship.id, clamp(before + amount, ship.story ? 5 : 1, 100));
  const after = conditionOf(game, ship.id);
  return { summary: `${ship.name} is now at condition ${Math.round(after)}.`, notice: `[FLEET] ${ship.name} ${after >= before ? "+" : ""}${Math.round(after - before)}: ${reason}`, notes };
}
