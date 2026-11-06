// Two things the player can do to someone in the room from the right-click menu, both the game's own rules and free in
// any game: picking their pocket, which is a Stealth check in the check window, and attacking them, which starts the
// fight window. The numbers, and what each costs when it's seen, are in world/deeds.json. What's left on the record
// is there for the written stories, and the AI hears a line about it with the player's next message.

import { findCharacter, findEnemy } from "./campaign.js";
import { SKILLS } from "./character-data.js";
import { startCheck } from "./checks.js";
import { startCombat } from "./combat.js";
import { LOCATIONS } from "./data.js";
import { holderOf } from "./daily.js";
import { recordFact } from "./record.js";
import { changeStanding, findContact, hoursNow } from "./rules.js";
import { ownedBy, soundAlarm, watched } from "./systems.js";
import { DEEDS } from "./world.js";

const LADDER = ["easy", "moderate", "hard", "very_hard", "nearly_impossible"];
const ATTITUDES = ["hostile", "wary", "neutral", "friendly", "ally"];
const between = (low, high) => low + Math.floor(Math.random() * (high - low + 1));
const placeName = (place) => LOCATIONS[place]?.name ?? place;
const spotOf = (place, key) => `${place}:${key}`;
// Someone without a file whose name says they watch for a living, like a Station Guard or a Hunter.
const watchful = (name) => (DEEDS.watchful ?? []).some((word) => new RegExp(`\\b${word}\\b`, "i").test(String(name)));

// ---- Who's wary, and who's been beaten ------------------------------------------------------------------

// Reading these never writes to the save: showing the game changes nothing.
export const isWary = (game, place, key) => (game.deeds?.wary?.[spotOf(place, key)] ?? -Infinity) > hoursNow(game);
export const isHurt = (game, place, key) => (game.deeds?.hurt?.[spotOf(place, key)] ?? -Infinity) > hoursNow(game);

function markFor(game, list, place, key, hours) {
  game.deeds ??= {};
  game.deeds[list] ??= {};
  // Marks that have run out go, so the save doesn't grow.
  for (const [spot, until] of Object.entries(game.deeds[list])) if (until <= hoursNow(game)) delete game.deeds[list][spot];
  game.deeds[list][spotOf(place, key)] = hoursNow(game) + hours;
}

// ---- Picking a pocket ------------------------------------------------------------------------------------

// How hard someone's pocket is: their Awareness if their file has one, else whether they watch for a living, and one
// step easier while they sleep.
export function pocketDifficulty(game, who) {
  const rules = DEEDS.pickpocket;
  const rank = who.id ? findCharacter(game.campaign, who.id)?.skills?.awareness : undefined;
  let level = rank !== undefined ? rules.awareness.find(([upTo]) => rank <= upTo)?.[1] ?? "very_hard" : watchful(who.name) ? rules.watchful : rules.anyone;
  if (!LADDER.includes(level)) level = "moderate";
  if (who.asleep) level = LADDER[Math.max(0, LADDER.indexOf(level) - 1)];
  return level;
}

// What the menu says beside Pickpocket, like "Stealth check, hard".
export const pocketDetail = (game, who) => `${SKILLS[DEEDS.pickpocket.skill]?.name ?? "Stealth"} check, ${pocketDifficulty(game, who).replace("_", " ")}`;

// The check opens in its own window, and settleDeed settles it once it's over.
export function pickPocket(game, who, where) {
  if (isWary(game, where.place, who.key)) throw new Error(`${who.short} is keeping a hand on their pocket now. Give it a day.`);
  startCheck(game, {
    skill: DEEDS.pickpocket.skill,
    difficulty: pocketDifficulty(game, who),
    reason: `Pick ${who.short}'s pocket`,
    scene: `${who.name}${who.doing ? `, ${who.doing}` : ""}.`,
    source: "person",
    target: `person:${who.key}`,
  });
  game.personAsked = { how: "pickpocket", place: where.place, room: where.room, key: who.key, id: who.id ?? null, name: who.name, short: who.short };
  return { check: true };
}

// A pocket check is over: credits for a clean lift, and when they catch the hand, what being caught costs.
export function settleDeed(game, outcome) {
  const asked = game.personAsked;
  if (!asked) return null;
  game.personAsked = null;
  if (!outcome || outcome.training) return null;
  const rules = DEEDS.pickpocket;
  markFor(game, "wary", asked.place, asked.key, rules.wary_hours ?? 24);
  const where = placeName(asked.place);
  const lines = [];
  if (outcome.success) {
    const got = between(...(asked.id ? rules.credits.named : rules.credits.anyone));
    game.credits += got;
    lines.push(`[STEALTH] You lift ${got} credits from ${asked.short}, and they don't notice a thing.`);
    game.pendingEvents?.push(`The player picked ${asked.name}'s pocket at ${where} and got ${got} credits. Nobody noticed. Bring it into the story only if it matters.`);
  } else {
    lines.push(`[STEALTH] ${asked.short} catches your hand in their pocket.`);
    lines.push(...costs(game, asked.place, rules.caught ?? {}, `You were caught picking ${asked.short}'s pocket.`));
    if (asked.id) lines.push(...worsen(game, asked.id, { note: `Caught the player with a hand in their pocket at ${where}.` }));
    remember(game, `caught_stealing_at_${asked.place}`, `You were caught picking a pocket at ${where}.`);
    lines.push(...alarmIfWatched(game, asked.place, asked.room));
    game.pendingEvents?.push(`The player tried to pick ${asked.name}'s pocket at ${where} and was caught. ${heard(lines)} Bring it into the story.`.replace(/\s+/g, " ").trim());
  }
  game.transcript?.push({ role: "notice", text: lines.join("\n") });
  return lines;
}

// ---- Attacking someone ---------------------------------------------------------------------------------

// The fight opens in its own window. Someone with a file fights from it; anyone else fights as the enemy the file names,
// under their own name.
export function attackPerson(game, who, where) {
  const rules = DEEDS.attack;
  const own = who.id && findEnemy(game.campaign, who.id)?.named ? who.id : null;
  const guard = watchful(who.name);
  const notes = startCombat(game, own ?? `${guard ? rules.as.watchful : rules.as.anyone} as ${who.short}`, {
    leadIn: `You go for ${who.short}.`,
    why: own ? null : guard ? rules.why.watchful : rules.why.anyone,
    reason: "The player went for them out of nowhere.",
    faction: own ? null : holderOf(game, where.place),
    asName: !own,
  });
  game.deedFight = { place: where.place, key: who.key, id: who.id ?? null, short: who.short };
  const place = placeName(where.place);
  const lines = [`[COMBAT] You go for ${who.short}.`, ...notes];
  lines.push(...costs(game, where.place, rules, `You attacked ${who.short} at ${place}.`));
  if (who.id) lines.push(...worsen(game, who.id, { to: "hostile", note: `The player attacked them at ${place}.` }));
  remember(game, who.id ? `attacked_${who.id}` : `attacked_someone_at_${where.place}`, who.id ? `You attacked ${who.name}.` : `You attacked someone at ${place}.`);
  lines.push(...alarmIfWatched(game, where.place, where.room));
  game.pendingEvents?.push(`The player attacked ${who.name} at ${place}, out of nowhere, and the fight is on. ${heard(lines)}`.replace(/\s+/g, " ").trim());
  return { said: lines.join("\n"), combat: true };
}

// A fight the player started is over. Someone beaten is out of sight for a while, to get patched up.
export function afterDeedFight(game, outcome) {
  const deed = game.deedFight;
  if (!deed || !outcome?.over) return [];
  game.deedFight = null;
  if (outcome.training || outcome.result !== "victory") return [];
  markFor(game, "hurt", deed.place, deed.key, DEEDS.attack.hurt_hours ?? 12);
  return [`[COMBAT] ${deed.short} is out of it, and gone to get patched up.`];
}

// ---- What it costs ------------------------------------------------------------------------------------

// Standing with whoever holds the place, or the fleet's morale when it's the captain's own ship.
function costs(game, place, { standing = 0, morale = 0 }, why) {
  if (ownedBy(game, place)) {
    if (!morale || !game.ship) return [];
    game.ship.morale = Math.max(0, Math.min(100, game.ship.morale + morale));
    return [`[SHIP] Morale ${morale}: ${why}`];
  }
  const line = changeStanding(game, holderOf(game, place), standing, why);
  return line ? [line] : [];
}

// Someone with a file thinks less of the player: a step down, or straight to hostile.
function worsen(game, id, { to = null, note }) {
  const person = findCharacter(game.campaign, id);
  if (!person) return [];
  game.contacts ??= [];
  const contact = findContact(game, person.name);
  const before = contact?.attitude ?? "neutral";
  const at = ATTITUDES.indexOf(before);
  const after = to ?? (at < 0 ? "wary" : ATTITUDES[Math.max(0, at - 1)]);
  if (contact) {
    contact.attitude = after;
    contact.note = `${contact.note ?? ""} ${note}`.trim().slice(-400);
  } else game.contacts.push({ name: person.name, attitude: after, note });
  return before === after ? [] : [`[RELATION] ${person.name}: ${before} -> ${after}`];
}

function remember(game, id, text) {
  try {
    recordFact(game, { id: id.slice(0, 40), text, from: "room" });
  } catch {
    // A full record keeps what it has.
  }
}

// A camera on the room rings the place's alarm, and the guards come.
const alarmIfWatched = (game, place, room) => (room && watched(game, place, room) ? soundAlarm(game, place, room, { by: "player" }) : []);

// The lines the AI should hear about.
const heard = (lines) => lines.filter((line) => /^\[(ALARM|FACTION|SHIP|RELATION)\]/.test(line)).join(" ");
