// Who the player is. Being captain of the Meridian is one way to start. Anyone else has a job somewhere,
// someone else has the chair, and the fleet goes on without them. world/starts.json has the choices.

import { LOCATIONS } from "./data.js";
import { STARTS } from "./world.js";

export const START_LIST = STARTS.starts ?? {};
export const START_GROUPS = STARTS.groups ?? {};
const STORY_STARTS = "The game is starting. Open the story:";

// A save from before there was any choice about it belongs to a captain.
export const isCaptain = (game) => game.role?.captain !== false;
export const startOf = (game) => START_LIST[game.role?.id] ?? null;

// Aboard one of the fleet's ships, or at the place it's at. A captain's always with their fleet.
export const inTheFleet = (game) => isCaptain(game) || Boolean(LOCATIONS[game.location]?.fleet) || (Boolean(game.fleet?.at) && game.location === game.fleet.at);

// The work they do, if this is where they do it.
export function jobHere(game) {
  const start = startOf(game);
  return !isCaptain(game) && start?.job && start.place === game.location ? start.job : null;
}

// What the character files say about "your" officers is written to the captain.
export const toOutsider = (game, text) => (isCaptain(game) || !text ? text : text.replace(/\bYour\b/g, "The Meridian's").replace(/\byour\b/g, "the Meridian's"));

// How the story opens, for this person.
export function openingFor(game) {
  const start = startOf(game) ?? START_LIST.captain;
  if (isCaptain(game)) return `${STORY_STARTS} ${START_LIST.captain.opening}`;
  return `${STORY_STARTS} ${start.opening} Keep it small and close. This is one person's ordinary day, and whatever's happening to the fleet is happening a long way over their head.`;
}

// What the game master is told about who the player is, whenever a conversation begins.
export function roleBrief(game, chair) {
  const start = startOf(game);
  if (isCaptain(game)) return `Their place in the world: ${START_LIST.captain.gm}`;
  return [
    `Their place in the world: ${start?.gm ?? "They were the captain of the Meridian, and they aren't any more."}`,
    `They are not the captain. ${chair ? `${chair.name} (id ${chair.id}) has the chair, and you play them: call read_character when they come up.` : "Someone else has the chair."}`,
    "Treat them as what they are. Nobody reports to them, nobody owes them anything, and the great events mostly happen over their head, until they do something about it. Don't hand them the captain's scenes. If they get close to the middle of things, they've earned it by their own doing.",
  ].join(" ");
}
