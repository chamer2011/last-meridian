// The actions the AI game master can request. Each one is checked here before
// anything changes in the game. A rejected request goes back to the AI as an
// error, so it has to narrate around it.

import { characterFileFor, ensureContactFiles, findCharacter, saveCampaignCharacter, saveCampaignEnemy } from "./campaign.js";
import { startCheck } from "./checks.js";
import { FACTIONS, ITEMS, LOCATIONS, STATS } from "./data.js";
import { CONDITIONS, CONTEXTS, POLES, SKILLS, SPECIES, TRAITS } from "./character-data.js";
import { changePlace, markWorldHeard, trackedPlaces, worldLines } from "./daily.js";
import { changeCommand, changeFleet, changeFleetShip, fleetRoster, markFleetHeard } from "./fleet.js";
import { whereNow } from "./life.js";
import { LORE_KINDS, hasStaticLore } from "./lore.js";
import { MYSTERY_TOPICS, beginThread, mysteryNotes, noteThreadEnded, noteThreadStarted, placeFileIfNew, updateStory } from "./story-library.js";
import { FACTS_PER_TURN, endStory, endingOf, recordEnding, recordFact } from "./record.js";
import { NPC_ARCHETYPES, THREAT_LABELS } from "./npc.js";
import {
  DIFFICULTY, TURN_LIMITS, addCondition, addItem, changeStanding, clamp, clockLabel, changeStress, findContact, grantXp, maxHp, passTime, practice,
  removeCondition, removeItem, shiftIdeology, startCombat, travel,
} from "./rules.js";
import { setScene } from "./walk.js";
import { PARLEY, ROOM_KINDS, WORLD_THREADS, endingsOf } from "./world.js";

const obj = (properties, required = Object.keys(properties)) => ({
  type: "object", properties, required, additionalProperties: false,
});
const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });
const oneOf = (values, description) => ({ type: "string", enum: values, description });
const REASONS_TO_FIGHT = Object.keys(PARLEY.motives).filter((id) => !PARLEY.motives[id].fixed);
const earnableTraits = Object.keys(TRAITS).filter((id) => TRAITS[id].earnable);

export const TOOL_DEFS = [
  {
    name: "roll_check",
    description: "Start a skill check for an action whose outcome is uncertain: persuading someone, sneaking, hacking, piloting, resisting fear. The game plays it out with the player in its own window, and your reply ends here, so write nothing else. You'll get the result with the next message, and then you narrate it. Never decide uncertain outcomes yourself. Pick the skill that best fits. Set difficulty by how hard the task is in the world, not by how skilled the player is. Only one check at a time.",
    input_schema: obj({
      skill: oneOf([...Object.keys(SKILLS), "none"], 'The skill being used. Use "none" only for raw ability with no skill involved, and then set attribute.'),
      attribute: oneOf(Object.keys(STATS), "Optional. Overrides the skill's usual attribute, for example Might with Intimidation when physically looming. Required when skill is \"none\"."),
      difficulty: oneOf(Object.keys(DIFFICULTY), "How hard this is, regardless of how well the player argues for it."),
      context: { type: "array", items: oneOf(Object.keys(CONTEXTS), "A situation that applies."), description: "Optional. Situations that apply to this check. The player's traits may react to them." },
      audience: str("Optional. Who is being persuaded, deceived or led: a faction's id, or a person's id or name. Their relationship with the player and shared beliefs change the odds."),
      reason: str("Very short description shown to the player, e.g. 'Bluff past the customs officer'."),
      scene: str("Optional. One sentence the player reads as the check's window opens, setting up what they're facing."),
    }, ["skill", "difficulty", "reason"]),
  },
  {
    name: "start_combat",
    description: "Start a turn-based fight when violence actually breaks out. The game takes over and runs the whole fight by itself from its files, without you, and your reply ends here. Put what the player reads just before the fight in lead_in. Either side can have followers, if the story allows it: up to four fighters on a side, counting the player. Anyone in a list can be written as 'dock_thug as Syndicate Guard' if the story calls them something else. You'll be told how it ended along with the player's next message.",
    input_schema: obj({
      enemy: str("What to fight: the id or name of an enemy type, including one you've just added with create_enemy, or the id or name of a character with a file. Pick something that suits the player's level."),
      lead_in: str("One to three sentences of story leading up to the first blow, in the same format as your narration. Don't describe how the fight goes."),
      called: str("Optional. What the story calls this enemy, if that's not its usual name, such as 'Syndicate Courier' for a dock thug. The fight uses this name."),
      enemy_followers: { type: "array", items: str("An enemy type or person."), description: "Optional. Others fighting on the enemy's side from the start, because they're really there in the story." },
      allies: { type: "array", items: str("A person with a file, or an enemy type fighting for the player."), description: "Optional. Followers fighting on the player's side from the start. Only people who are really with the player in the story." },
      arrivals: {
        type: "array",
        items: obj({
          who: str("An enemy type or a person."),
          side: oneOf(["ally", "enemy"], "Whose side they join."),
          round: num("The round they get there, from 2 up."),
        }),
        description: "Optional. Up to three who join partway through, if the story gives them a reason to come running.",
      },
      why: oneOf(REASONS_TO_FIGHT, "Optional. Why the enemy's side is fighting, if the story knows better than their usual reason. It decides how hard they are to talk down, threaten, pay off or lie to. It doesn't apply to animals, machines or the Choir."),
      reason: str("Optional. One short sentence the player reads in the fight window, saying why they're fighting: 'You owe the Syndicate, and they've come to collect.'"),
      faction: oneOf(Object.keys(FACTIONS), "Optional. The faction they're fighting for, if it isn't the one in their file. How that faction feels about the player changes the odds of talking to them."),
    }, ["enemy", "lead_in"]),
  },
  {
    name: "read_character",
    description: "Read a character's full file: their personality, way of speaking, goals and secrets. Call this before bringing in anyone on the people list whose file you haven't been given yet.",
    input_schema: obj({ name: str("The person's id or name.") }),
  },
  {
    name: "read_thread",
    description: "Read your notes on a story thread, when you bring one into the story yourself: what's really going on, how it might go, and where it can end up. The place files list which threads could start where. If the player chose it from their Leads menu, you've already been given the notes.",
    input_schema: obj({ id: str("The thread's id.") }),
  },
  {
    name: "read_mystery",
    description: "Read your private notes on one part of the main mystery, before a scene that touches it. factions gives each faction's theory and what it wants, reversals lists the wrong things the player should believe along the way, and routes_by_build shows how different kinds of person can get through.",
    input_schema: obj({ topic: oneOf(MYSTERY_TOPICS, "Which part you need.") }),
  },
  {
    name: "update_story",
    description: "Keep track of the main story: call this when the player finds one of its clues, or when the story moves on to a new act.",
    input_schema: obj({ clue: str("Optional. The id of a clue they've just found."), act: num("Optional. The act the main story has just moved into.") }, []),
  },
  {
    name: "create_character",
    description: "Save a new person to the world's files when someone who may matter turns up. The game generates their stats from the archetype and threat, and keeps the file for good, so write down what will keep them consistent. Calling it again with the same name updates their file. Passing extras don't need a file. Write facts about who they are, and use note_contact for what happens between them and the player. To fight them right away, call start_combat in the same reply with their name.",
    input_schema: obj({
      name: str("Their name, without a title."),
      title: str("Optional. A title such as Captain or Dr."),
      pronouns: str("Their pronouns, such as she/her, he/him or they/them."),
      species: oneOf([...Object.keys(SPECIES), "unknown"], "Optional. Their species."),
      faction: oneOf(Object.keys(FACTIONS), "Optional. The faction they belong to, if any."),
      role: str("Who they are, in a few words, e.g. 'Quartermaster of the Long Reach'."),
      location: oneOf(Object.keys(LOCATIONS), "Optional. Where they can usually be found."),
      public: str("One or two sentences the player would know about them, with no secrets."),
      appearance: str("Optional. What they look like."),
      personality: str("Their personality, in a sentence or two."),
      voice: str("How they speak, so that they always sound like themselves."),
      goals: str("Optional. What they want."),
      secrets: str("Optional. What they're hiding. The player never sees this."),
      beliefs: { type: "array", items: oneOf(Object.keys(POLES), "A belief."), description: "Optional. The one to three beliefs they hold most strongly." },
      archetype: oneOf(Object.keys(NPC_ARCHETYPES), "What sort of person they are. This decides how their stats are generated."),
      threat: num("How dangerous they are in a fight, from 1 to 5: 1 minor, 2 capable, 3 dangerous, 4 deadly, 5 legendary."),
      met: { type: "boolean", description: "Optional. True if the player is meeting them right now, which adds them to the player's contacts." },
      attitude: oneOf(["ally", "friendly", "neutral", "wary", "hostile"], "Optional. How they feel about the player, if they've met."),
    }, ["name", "pronouns", "role", "public", "personality", "voice", "archetype", "threat"]),
  },
  {
    name: "create_enemy",
    description: "Save a new type of enemy to the world's files, when the story needs something to fight that isn't on the list. The game generates its stats from the archetype and threat. To fight it right away, call start_combat in the same reply with its name. For a specific named opponent, use create_character instead.",
    input_schema: obj({
      name: str("The enemy's name, e.g. 'Ion Wraith'."),
      archetype: oneOf(Object.keys(NPC_ARCHETYPES), "What sort of thing it is. This decides how its stats are generated."),
      threat: num("How dangerous it is, from 1 to 5: 1 minor, 2 capable, 3 dangerous, 4 deadly, 5 legendary."),
      description: str("One sentence the player will see."),
      tags: { type: "array", items: oneOf(Object.keys(CONTEXTS), "A situation."), description: "Optional. Which situations apply when fighting it, such as choir or machines." },
      why: oneOf(REASONS_TO_FIGHT, "Optional. Why this kind of enemy usually fights. Without this it goes by the archetype."),
      faction: oneOf(Object.keys(FACTIONS), "Optional. The faction it fights for."),
    }, ["name", "archetype", "threat", "description"]),
  },
  {
    name: "give_item",
    description: "Give the player an item they actually found, earned or were handed in the story.",
    input_schema: obj({ item: oneOf(Object.keys(ITEMS), "The item to give.") }),
  },
  {
    name: "take_item",
    description: "Remove an item the player gave away, spent or lost in the story.",
    input_schema: obj({ item: oneOf(Object.keys(ITEMS), "The item to remove.") }),
  },
  {
    name: "change_credits",
    description: "Pay the player or charge them. Use a negative amount for a cost. Fails if the player can't afford it, in which case the deal doesn't happen.",
    input_schema: obj({ amount: num("Positive to give credits, negative to charge them."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_health",
    description: "Hurt or heal the player outside a fight, such as from a trap, an explosion or a doctor. Negative hurts, positive heals. Non-combat harm can't kill the player; they stay at 1 health at worst.",
    input_schema: obj({ amount: num("Negative for damage, positive for healing."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_stress",
    description: "Raise the player's stress after something frightening, horrifying or morally heavy, or lower it after real comfort, connection or a meaningful win. Usually between 3 and 15 either way. High stress gives penalties on all checks, and at 100 the character breaks down.",
    input_schema: obj({ amount: num("Positive adds stress, negative relieves it."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "pass_time",
    description: "Move the clock forward whenever meaningful time passes in the story: a long conversation, a shift of work, a night's sleep. Travel moves the clock by itself. Time heals injuries, builds fatigue, uses up the fleet's supplies and lets the Choir get closer, so keep it honest.",
    input_schema: obj({
      hours: num("Hours passing, from 1 to 72."),
      activity: oneOf(["active", "work", "rest"], "active for normal activity, work for hard labor or a demanding shift, rest for real sleep or recovery."),
      reason: str("Short description shown to the player."),
    }),
  },
  {
    name: "add_condition",
    description: "Apply a lasting injury or state when the story causes one, such as a concussion from an explosion or radiation from a damaged reactor. Each has real penalties, and lasts until it heals with time or is treated.",
    input_schema: obj({ condition: oneOf(Object.keys(CONDITIONS), "The condition to apply."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "remove_condition",
    description: "Remove a condition when it's actually treated in the story, such as by a doctor in the medbay.",
    input_schema: obj({ condition: oneOf(Object.keys(CONDITIONS), "The condition to remove."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "shift_ideology",
    description: "Move the player's beliefs when they make a meaningful choice that expresses a belief or betrays one. Don't call this for small decisions. The game works out the cost to their conscience by itself: acting against a strong belief causes stress, and acting on one relieves it.",
    input_schema: obj({
      toward: oneOf(Object.keys(POLES), "The belief their choice moved them toward."),
      amount: num("1 for a telling choice, 2 for a major one, 3 for a defining moment."),
      reason: str("Short reason shown to the player."),
    }),
  },
  {
    name: "grant_trait",
    description: "Give the player a permanent new trait after a truly life-changing event. This should be rare: at most a few times in a whole story.",
    input_schema: obj({ trait: oneOf(earnableTraits, "The trait they've earned."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "remove_trait",
    description: "Remove a trait when the player has genuinely overcome it through story events, such as finally clearing a debt or making peace with guilt.",
    input_schema: obj({ trait: oneOf(Object.keys(TRAITS), "The trait to remove."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "train_skill",
    description: "Give practice toward a skill when the player spends real time studying or being taught in the story. Skills also improve by themselves through checks, so don't use this for ordinary use of a skill.",
    input_schema: obj({ skill: oneOf(Object.keys(SKILLS), "The skill being trained."), amount: num("Practice points, usually 5 to 20."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_ship",
    description: "Change the ship's hull or fuel, or the fleet's morale, because of something that happened in the story.",
    input_schema: obj({ hull: num("Change in hull, or 0."), fuel: num("Change in fuel, or 0."), morale: num("Change in fleet morale, or 0."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "change_fleet",
    description: "Change the fleet's stores or how close the Choir is, because of something that happened in the story: a supply deal, a looted depot, a broadcast that gives away their position. The daily drain, shortages and raids run by themselves, so never use this for those. Fuel goes through change_ship.",
    input_schema: obj({
      food: num("Optional. Tons of food gained or lost. The whole fleet eats about 30 tons a day."),
      medicine: num("Optional. Crates of medicine gained or lost. The fleet uses about 4 a day."),
      parts: num("Optional. Crates of parts gained or lost. The fleet uses about 3 a day."),
      pursuit: num("Optional. Change in the pursuit meter, from -40 to 25. Negative when the fleet shakes the Choir off."),
      reason: str("Short reason shown to the player."),
    }, ["reason"]),
  },
  {
    name: "change_fleet_ship",
    description: "Change one of the fleet's ships, because of something that happened in the story: damage or repairs, or a ship lost or gone for good. Use a ship the player already knows about. Everyone aboard is lost or leaves with her, unless you say otherwise in the story and move them yourself.",
    input_schema: obj({
      ship: str("The ship's name or id."),
      condition: num("Optional. Change in her condition, from -60 to 40."),
      status: oneOf(["active", "lost", "gone"], "Optional. lost if she's destroyed, gone if she's left the fleet, active if she's come back."),
      reason: str("Short reason shown to the player."),
    }, ["ship", "reason"]),
  },
  {
    name: "change_command",
    description: "Change who has the fleet, because the story really has put the player in the captain's chair or taken them out of it: an appointment, a mutiny, a resignation, a court martial that holds. It's a very big thing, and it stays that way until something else changes it. The rations, the crews, the jumps and the raids go with it.",
    input_schema: obj({ takes: bool("True if the player has just become the captain. False if they've just stopped being it."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "read_fleet",
    description: "Read the fleet's roster, or one ship's entry: role, captain, people aboard, condition. Only call this when a scene needs it, since the Fleet line in the state is usually enough. One ship's entry is much smaller than the whole list.",
    input_schema: obj({ ship: str("Optional. One ship's name or id.") }, []),
  },
  {
    name: "read_world",
    description: "Read how things stand today at every place the player knows of, or at one place: who holds it, how much of a say each side has, what's short, and what's going on there. Only call this when a scene needs it, since the line for wherever the player is comes with the state.",
    input_schema: obj({ place: str("Optional. One place's id.") }, []),
  },
  {
    name: "change_place",
    description: "Change how things stand at a place, because of something that happened in the story: a supply run, a sabotage, a strike broken, a garrison landed. The daily ups and downs run by themselves, so never use this for those. Supplies are levels where 100 is normal for that place.",
    input_schema: obj({
      place: oneOf(trackedPlaces(), "The place's id."),
      food: num("Optional. Change in its food level, from -60 to 60."),
      fuel: num("Optional. Change in its fuel level, from -60 to 60."),
      medicine: num("Optional. Change in its medicine level, from -60 to 60."),
      parts: num("Optional. Change in its parts level, from -60 to 60."),
      side: str("Optional. Which side gains or loses ground there, by the short name given for it in the state or read_world."),
      amount: num("Optional. How much of a say that side gains or loses, from -30 to 30. Whoever has the most holds the place."),
      news: str("Optional. One sentence, for what people will be saying about it from now on."),
      reason: str("Short reason shown to the player."),
    }, ["place", "reason"]),
  },
  {
    name: "award_xp",
    description: "Award experience for clever solutions, completed objectives and good roleplay. Usually 10 to 50. Fights award their own XP, so don't add any for those.",
    input_schema: obj({ amount: num("XP to award."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "travel",
    description: "Move the player to another location. If they're the captain, a jump moves the whole fleet: it costs 1 to 3 fuel and many hours, depending on how far it is, and it shakes off some of the Choir's pursuit, and it fails without enough fuel. If they aren't, they go by themselves and the fleet stays where it is, so charge any fare with change_credits. Crossing to one of the fleet's own ships, or to the place the fleet's already at, takes an hour and no fuel. Use it whenever the player actually arrives somewhere new.",
    input_schema: obj({ destination: oneOf(Object.keys(LOCATIONS), "Where to go.") }),
  },
  {
    name: "set_scene",
    description: "Keep the walk-around map true to the story. Call it with your other tools when the story moves the player to another room, or to somewhere that isn't on the map, or changes who's with them. It takes no time. Never call it for the player's own walking, which the Map line already shows.",
    input_schema: obj({
      area: str("Where the player is now: a room from the place file, or the name of anywhere else, such as 'Section Fourteen', which gets a room of its own, kept for good."),
      people: { type: "array", items: str("A person's id or name."), description: "Optional. Who's with the player there, up to 8. Everyone else goes back to their usual post." },
      kind: oneOf(Object.keys(ROOM_KINDS), "Optional, for somewhere off the map. What sort of room to draw."),
      things: {
        type: "array",
        items: obj({ name: str("What it is, in a few words."), look: str("One or two sentences the player reads when they look at it.") }),
        description: "Optional, for somewhere off the map. Up to 4 things that make this room what it is, for the player to look at.",
      },
    }, ["area"]),
  },
  {
    name: "change_faction",
    description: "Change how a faction regards the player, after something that faction would really notice.",
    input_schema: obj({ faction: oneOf(Object.keys(FACTIONS), "The faction."), amount: num("Change from -15 to 15."), reason: str("Short reason shown to the player.") }),
  },
  {
    name: "add_quest",
    description: "Add a new quest to the player's log when a real new goal comes up in the story.",
    input_schema: obj({ id: str("Short lowercase id with underscores, e.g. 'rescue_the_miners'."), title: str("Quest title."), description: str("One or two sentences of background."), objective: str("What the player should do next.") }),
  },
  {
    name: "update_quest",
    description: "Change a quest's current objective, or mark it complete or failed. Call this as soon as the player makes real progress.",
    input_schema: obj({ id: str("The quest id."), status: oneOf(["active", "completed", "failed"], "The quest's status now."), objective: str("The new current objective, or the final outcome.") }),
  },
  {
    name: "note_contact",
    description: "Add or update a named character in the player's contacts. Call this when the player meets someone memorable, or when a relationship changes. Attitude affects later social checks with them. Everyone added here gets a local file automatically, so use create_character first if they're important enough to deserve a full one.",
    input_schema: obj({
      name: str("The character's name."),
      attitude: oneOf(["ally", "friendly", "neutral", "wary", "hostile"], "How they feel about the player."),
      note: str("One sentence on what has happened between them and the player."),
      status: oneOf(["alive", "dead", "missing", "captured"], "Optional. Set this if something has happened to them."),
    }, ["name", "attitude", "note"]),
  },
  {
    name: "add_journal",
    description: "Record an important event or discovery in the journal. This is your long-term memory: you may later lose older conversation, but never the journal. Call it for major decisions, promises, revealed secrets and plot turns.",
    input_schema: obj({ entry: str("One or two sentences on what happened.") }),
  },
  {
    name: "add_lore",
    description: "Add a new entry to the player's codex when you introduce a new named place, ship, group or idea that may come back. For important people, use create_character instead. The game then highlights that name in the story, and shows this entry when the player hovers over it. Calling it again with the same term updates the entry. Write only what the player's character would know, and never include secrets.",
    input_schema: obj({
      term: str("The exact name as you write it in the story, e.g. 'The Rim'."),
      kind: oneOf(LORE_KINDS, "What sort of thing this is."),
      text: str("One or two sentences, written for the player."),
    }),
  },
  {
    name: "follow_scene",
    description: "Only when the message has a <written_scene> block: the number of the written choice the player's words come to, or 0 when they fit none of them and your short reply answers them instead. The written story plays on from the choice by itself.",
    input_schema: obj({ choice: num("The number of the written choice the player's words mean, or 0 for none of them.") }),
  },
  {
    name: "note_fact",
    description: "Put a lasting fact on the record, for the stories that come later: something the player did or learned that another story should know, such as a door closed to the fleet, a debt owed, or a person who now trusts or hates them. Give it a short name and one line of plain words, and when the story's notes name the facts it can leave, use those names. The record is in your state as Fact lines, so don't note what's already there, and don't note passing things.",
    input_schema: obj({ id: str("A short name in lowercase letters, digits and underscores, like signed_with_quill."), text: str("One line, written for the player, saying what's true now.") }),
  },
  {
    name: "end_story",
    description: "A story from the Leads menu has ended. Say which of the endings in its notes it came to, by name, or other if it ended another way, with one line for the player on how. The game marks its quest done and keeps the ending on the record for the stories that come later.",
    input_schema: obj({ id: str("The story's id, from its notes."), ending: str("The name of the ending in the story's notes that fits best, or other for another way."), summary: str("One line, written for the player, on how it ended.") }),
  },
];

const withNotes = (first, notes = []) => [first, ...notes].filter(Boolean).join("\n");

// Time passing can set off a raid. Like a fight, the game runs it, and the AI hears how it went next.
const RAID_STARTED = "A Choir raid has just hit the fleet. The player is answering it in its own window, and how it went comes next, so write nothing more.";

// The AI hears what the fleet did during this time in the result, so it doesn't need telling again.
function timeResult(game, text) {
  markFleetHeard(game);
  markWorldHeard(game);
  return game.fleet?.raid ? `${text}\n${RAID_STARTED}` : text;
}

// ---- Handlers. Each returns { result, notice }: result goes to the AI, notice to the player. ----

const handlers = {
  roll_check(game, input) {
    if (input.skill === "none" && !input.attribute) throw new Error('When skill is "none", you must set an attribute.');
    if (game.check) throw new Error("A check is already running. Ask for the next one after you've seen its result.");
    if (game.combat) throw new Error("A fight has just started, so this check can't happen. Its result comes first.");
    startCheck(game, {
      skill: input.skill === "none" ? null : input.skill,
      attribute: input.attribute ?? null,
      difficulty: input.difficulty,
      context: input.context ?? [],
      audience: input.audience && input.audience !== "none" ? input.audience : null,
      reason: input.reason,
      scene: input.scene || null,
    });
    return { result: "The player is taking this check in its own window. The result comes next, so continue from there." };
  },
  start_combat(game, input) {
    if (game.check) throw new Error("A check is already running, so this fight can't start yet. Start it after you've seen the result.");
    const notes = startCombat(game, input.enemy, {
      called: input.called,
      followers: input.enemy_followers ?? [],
      allies: input.allies ?? [],
      arrivals: input.arrivals ?? [],
      leadIn: input.lead_in,
      why: input.why,
      reason: input.reason,
      faction: input.faction,
    });
    const foes = game.combat.enemies.map((enemy) => enemy.name).join(", ");
    const friends = game.combat.allies.map((ally) => ally.name).join(", ");
    return {
      narration: input.lead_in,
      result: `The fight against ${foes} began, and the game ran it. How it ended comes next, so continue from there.`,
      notice: withNotes(`[COMBAT] The fight begins: ${foes}${friends ? `, with ${friends} at your side` : ""}`, notes),
    };
  },
  read_character(game, input) {
    const file = characterFileFor(game, input.name);
    if (!file) throw new Error(`There's no file for "${input.name}". If they matter, add them with create_character.`);
    game.ai.sentCharacters = [...new Set([...(game.ai.sentCharacters ?? []), file.id])];
    const now = whereNow(game, file.id);
    return { result: now ? `${file.brief}\nRight now: ${now}.` : file.brief };
  },
  read_thread(game, input) {
    const notes = beginThread(game, input.id);
    if (!notes) throw new Error(`There's no thread called ${input.id}.`);
    return { result: notes };
  },
  read_mystery(game, input) {
    return { result: mysteryNotes(input.topic) };
  },
  update_story(game, input) {
    return { result: updateStory(game, input) };
  },
  create_character(game, input, turn) {
    if (!game.campaign) throw new Error("There's no campaign to save this character to.");
    if (turn.newCharacters >= TURN_LIMITS.newCharacters) throw new Error("That's enough new characters for now.");
    if (input.threat < 1 || input.threat > 5) throw new Error("Threat must be from 1 to 5.");
    const { id, person, created } = saveCampaignCharacter(game.campaign, input);
    if (created) turn.newCharacters += 1;
    game.ai.sentCharacters = [...new Set([...(game.ai.sentCharacters ?? []), id])];
    if (!game.seenLore.includes(`person:${id}`) && input.met) game.seenLore.push(`person:${id}`);
    let notice;
    if (input.met) {
      const existing = game.contacts.find((c) => c.name.toLowerCase() === person.name.toLowerCase());
      if (!existing) {
        game.contacts.push({ id, name: person.name, attitude: input.attitude ?? "neutral", note: person.note });
        notice = `[CONTACT] New: ${person.name}`;
      }
    }
    return { result: `${created ? "Saved a new file" : "Updated the file"} for ${person.name} (id: ${id}). The game generated their stats: threat ${THREAT_LABELS[person.combat.threat]}.`, ...(notice ? { notice } : {}) };
  },
  create_enemy(game, input, turn) {
    if (!game.campaign) throw new Error("There's no campaign to save this enemy to.");
    if (turn.newEnemies >= TURN_LIMITS.newEnemies) throw new Error("That's enough new enemies for now.");
    if (input.threat < 1 || input.threat > 5) throw new Error("Threat must be from 1 to 5.");
    const { id, enemy } = saveCampaignEnemy(game.campaign, input);
    turn.newEnemies += 1;
    return { result: `Saved ${enemy.name} (id: ${id}, threat ${THREAT_LABELS[input.threat]}). Use that id in start_combat.` };
  },
  give_item(game, input, turn) {
    if (turn.itemsGiven >= TURN_LIMITS.itemsGiven) throw new Error("Too many items given this turn. Don't give more.");
    addItem(game, input.item);
    turn.itemsGiven += 1;
    return { result: `Given: ${ITEMS[input.item].name}.`, notice: `[ITEM] Received: ${ITEMS[input.item].name}` };
  },
  take_item(game, input) {
    removeItem(game, input.item);
    return { result: `Removed: ${ITEMS[input.item].name}.`, notice: `[ITEM] Lost: ${ITEMS[input.item].name}` };
  },
  change_credits(game, input, turn) {
    if (input.amount < 0 && game.credits + input.amount < 0) {
      throw new Error(`The player only has ${game.credits} credits and can't afford this. The deal doesn't happen.`);
    }
    let amount = input.amount;
    if (amount > 0) {
      amount = Math.min(amount, TURN_LIMITS.creditsGained - turn.creditsGained);
      if (amount <= 0) throw new Error("The credit limit for this turn has been reached.");
      turn.creditsGained += amount;
    }
    game.credits += amount;
    return { result: `Credits changed by ${amount}. The player now has ${game.credits}.`, notice: `[CREDITS] ${amount > 0 ? "+" : ""}${amount}: ${input.reason}` };
  },
  change_health(game, input, turn) {
    let amount = input.amount;
    if (amount < 0) {
      amount = -Math.min(-amount, TURN_LIMITS.damage - turn.damage);
      turn.damage += -amount;
    } else {
      amount = Math.min(amount, 30);
    }
    const before = game.hp;
    game.hp = clamp(game.hp + amount, 1, maxHp(game));
    const change = game.hp - before;
    return { result: `Health changed by ${change}, now ${game.hp}/${maxHp(game)}.`, notice: `[HEALTH] ${change >= 0 ? "+" : ""}${change}: ${input.reason}` };
  },
  change_stress(game, input, turn) {
    const room = TURN_LIMITS.stress - turn.stress;
    const amount = clamp(input.amount, -room, room);
    if (amount === 0) throw new Error("The stress limit for this turn has been reached.");
    turn.stress += Math.abs(amount);
    const before = game.needs.stress;
    const notes = changeStress(game, amount);
    // A breakdown resets stress, so the change is only meaningful without one.
    const change = notes.length ? amount : game.needs.stress - before;
    return {
      result: `Stress is now ${game.needs.stress}/100.${notes.length ? ` ${notes.join(" ")}` : ""}`,
      notice: withNotes(`[STRESS] ${change >= 0 ? "+" : ""}${change}: ${input.reason} (now ${game.needs.stress}/100)`, notes),
    };
  },
  pass_time(game, input, turn) {
    const hours = clamp(input.hours, 1, 72);
    if (turn.hours + hours > TURN_LIMITS.hours) throw new Error("Too much time has passed this turn already.");
    turn.hours += hours;
    const notes = passTime(game, hours, input.activity);
    return {
      result: timeResult(game, `${hours} hours pass. It's now ${clockLabel(game)}. Fatigue ${game.needs.fatigue}/100.${notes.length ? ` ${notes.join(" ")}` : ""}`),
      notice: withNotes(`[TIME] ${input.reason}: ${hours}h pass. It's now ${clockLabel(game)}.`, notes),
    };
  },
  add_condition(game, input) {
    addCondition(game, input.condition);
    const c = CONDITIONS[input.condition];
    return { result: `Applied ${c.name}. It lasts about ${c.hours} hours unless treated.`, notice: `[HEALTH] ${c.name}: ${input.reason}` };
  },
  remove_condition(game, input) {
    if (!removeCondition(game, input.condition)) throw new Error(`The player doesn't have ${CONDITIONS[input.condition].name}.`);
    return { result: `Removed ${CONDITIONS[input.condition].name}.`, notice: `[HEALTH] Recovered from ${CONDITIONS[input.condition].name}: ${input.reason}` };
  },
  shift_ideology(game, input, turn) {
    if (turn.ideologyShifts >= TURN_LIMITS.ideologyShifts) throw new Error("Their beliefs have already shifted enough this turn.");
    turn.ideologyShifts += 1;
    const notes = shiftIdeology(game, input.toward, input.amount);
    return { result: notes.join(" "), notice: withNotes(`[BELIEF] ${input.reason}`, notes) };
  },
  grant_trait(game, input, turn) {
    if (turn.traitChanges >= TURN_LIMITS.traitChanges) throw new Error("Only one trait can change per turn.");
    const trait = TRAITS[input.trait];
    if (game.traits.includes(input.trait)) throw new Error(`The player already has ${trait.name}.`);
    const clash = trait.excludes?.find((id) => game.traits.includes(id));
    if (clash) throw new Error(`${trait.name} can't be combined with ${TRAITS[clash].name}.`);
    if (trait.notSpecies?.includes(game.character.species)) throw new Error(`${trait.name} doesn't apply to this character's species.`);
    turn.traitChanges += 1;
    game.traits.push(input.trait);
    for (const [id, n] of Object.entries(trait.fx?.factions ?? {})) game.factions[id] = clamp(game.factions[id] + n, -100, 100);
    return { result: `Trait gained: ${trait.name}. ${trait.gm ?? trait.desc}`, notice: `[TRAIT] New trait: ${trait.name}. ${input.reason}` };
  },
  remove_trait(game, input, turn) {
    if (turn.traitChanges >= TURN_LIMITS.traitChanges) throw new Error("Only one trait can change per turn.");
    if (!game.traits.includes(input.trait)) throw new Error(`The player doesn't have ${TRAITS[input.trait].name}.`);
    turn.traitChanges += 1;
    game.traits = game.traits.filter((id) => id !== input.trait);
    return { result: `Trait removed: ${TRAITS[input.trait].name}.`, notice: `[TRAIT] No longer: ${TRAITS[input.trait].name}. ${input.reason}` };
  },
  train_skill(game, input, turn) {
    const amount = clamp(input.amount, 1, 20);
    if (turn.training + amount > TURN_LIMITS.training) throw new Error("That's enough training for one turn.");
    turn.training += amount;
    const notes = practice(game, input.skill, amount);
    return { result: `${SKILLS[input.skill].name} practice recorded.${notes.length ? ` ${notes.join(" ")}` : ""}`, notice: withNotes(`[SKILL] Training ${SKILLS[input.skill].name}: ${input.reason}`, notes) };
  },
  change_ship(game, input) {
    const s = game.ship;
    const before = { hull: s.hull, fuel: s.fuel, morale: s.morale };
    s.hull = clamp(s.hull + clamp(input.hull, -30, 30), 1, s.maxHull);
    s.fuel = clamp(s.fuel + clamp(input.fuel, -3, 6), 0, s.maxFuel);
    s.morale = clamp(s.morale + clamp(input.morale, -15, 15), 0, 100);
    const changes = Object.keys(before)
      .filter((key) => s[key] !== before[key])
      .map((key) => `${key[0].toUpperCase()}${key.slice(1)} ${s[key] > before[key] ? "+" : ""}${s[key] - before[key]}`);
    return { result: `Ship is now hull ${s.hull}, fuel ${s.fuel}, morale ${s.morale}.`, notice: `[SHIP] ${changes.length ? `${changes.join(", ")}: ` : ""}${input.reason}` };
  },
  change_fleet(game, input) {
    const { summary, notice, notes } = changeFleet(game, input);
    return { result: withNotes(`The fleet now has: ${summary}`, notes), notice: withNotes(notice, notes) };
  },
  change_fleet_ship(game, input) {
    const { summary, notice, notes } = changeFleetShip(game, input);
    return { result: withNotes(summary, notes), notice: withNotes(notice, notes) };
  },
  change_command(game, input) {
    const { summary, notice } = changeCommand(game, input);
    return { result: summary, notice };
  },
  read_fleet(game, input) {
    return { result: fleetRoster(game, input.ship) };
  },
  read_world(game, input) {
    return { result: worldLines(game, input.place) };
  },
  change_place(game, input) {
    const { summary, notice } = changePlace(game, input);
    return { result: summary, notice };
  },
  award_xp(game, input, turn) {
    const amount = Math.min(Math.max(input.amount, 0), TURN_LIMITS.xp - turn.xp);
    if (amount <= 0) throw new Error("The XP limit for this turn has been reached.");
    turn.xp += amount;
    const levelUps = grantXp(game, amount);
    return { result: `Awarded ${amount} XP.${levelUps.length ? " The player leveled up." : ""}`, notice: [`[XP] +${amount}: ${input.reason}`, ...levelUps].join("\n") };
  },
  travel(game, input) {
    const { message, notes } = travel(game, input.destination);
    // The notes on where they've arrived come straight back, in time for the AI to write the arrival.
    return { result: timeResult(game, withNotes(message, [...notes, placeFileIfNew(game)])), notice: withNotes(`[NAV] ${message}`, notes) };
  },
  set_scene(game, input) {
    return { result: setScene(game, input.area, input.people ?? [], { kind: input.kind ?? null, things: input.things ?? [] }) };
  },
  change_faction(game, input) {
    const notice = changeStanding(game, input.faction, clamp(input.amount, -15, 15), input.reason);
    return { result: `${FACTIONS[input.faction].name} standing is now ${game.factions[input.faction]}.`, ...(notice ? { notice } : {}) };
  },
  add_quest(game, input) {
    if (game.quests.some((q) => q.id === input.id)) throw new Error(`A quest with the id ${input.id} already exists. Use update_quest.`);
    if (game.quests.filter((q) => q.status === "active").length >= 12) throw new Error("The quest log is full. Resolve an existing quest first.");
    game.quests.push({ id: input.id, title: input.title, main: false, status: "active", desc: input.description, objective: input.objective });
    noteThreadStarted(game, input.id);
    return { result: `Quest added: ${input.title}.`, notice: `[QUEST] New: ${input.title}` };
  },
  update_quest(game, input) {
    const quest = game.quests.find((q) => q.id === input.id);
    if (!quest) throw new Error(`No quest with the id ${input.id}.`);
    quest.status = input.status;
    quest.objective = input.objective;
    if (input.status !== "active") noteThreadEnded(game, input.id);
    // A story's quest settled the old way still leaves its ending on the record, with its last line.
    if (input.status !== "active" && WORLD_THREADS[input.id] && !endingOf(game, input.id)) recordEnding(game, { id: input.id, ending: null, summary: input.objective, failed: input.status === "failed" });
    const label = input.status === "active" ? "updated" : input.status;
    return { result: `Quest ${input.id} ${label}.`, notice: `[QUEST] ${label}: ${quest.title}` };
  },
  note_contact(game, input) {
    if (input.name.trim().length > 60) throw new Error("That's too long for a name. Use what people call them, and put the rest in the note.");
    // Someone with a file is always listed under their full name, whatever the AI called them.
    const name = findCharacter(game.campaign, input.name)?.name ?? input.name;
    const existing = findContact(game, name);
    if (existing) {
      const before = existing.attitude;
      const statusBefore = existing.status ?? "alive";
      existing.attitude = input.attitude;
      existing.note = input.note;
      if (input.status) existing.status = input.status;
      const changes = [
        before !== input.attitude ? `[RELATION] ${existing.name}: ${before} -> ${input.attitude}` : null,
        input.status && input.status !== statusBefore ? `[RELATION] ${existing.name} is now ${input.status}.` : null,
      ].filter(Boolean);
      return { result: `Contact ${name} updated.`, ...(changes.length ? { notice: changes.join("\n") } : {}) };
    }
    game.contacts.push({ name, attitude: input.attitude, note: input.note, ...(input.status ? { status: input.status } : {}) });
    ensureContactFiles(game);
    return { result: `Contact ${name} added.`, notice: `[CONTACT] New: ${name}` };
  },
  add_journal(game, input) {
    game.journal.push({ turn: game.turn, entry: input.entry });
    return { result: "Journal updated." };
  },
  add_lore(game, input, turn) {
    const term = input.term.trim();
    if (term.length < 2 || term.length > 60) throw new Error("The term must be between 2 and 60 characters.");
    if (hasStaticLore(term)) throw new Error(`${term} already has a codex entry.`);
    const existing = game.lore.find((entry) => entry.name.toLowerCase() === term.toLowerCase());
    if (existing) {
      existing.kind = input.kind;
      existing.text = input.text;
      return { result: `Codex entry updated: ${term}.` };
    }
    if (turn.loreEntries >= TURN_LIMITS.loreEntries || game.lore.length >= 300) throw new Error("That's enough new codex entries for now.");
    turn.loreEntries += 1;
    game.lore.push({ id: `custom:${game.lore.length}`, name: term, kind: input.kind, text: input.text });
    return { result: `Codex entry added: ${term}.`, notice: `[LORE] New codex entry: ${term}` };
  },
  // The written story's one tool for the AI: it fits the player's own words to a written choice, and the game plays it.
  follow_scene(game, input, turn) {
    const scene = turn?.scene;
    if (!scene) throw new Error("There's no written scene here to follow. Write the story yourself.");
    const count = scene.choices.length;
    if (input.choice < 0 || input.choice > count) throw new Error(`The written choices here are numbered 1 to ${count}, or 0 for none of them.`);
    scene.followed = input.choice;
    if (input.choice === 0) return { result: "Noted: nothing moves on. Now answer the player in one to three sentences, in the voices of the people there, with no > choices of your own. The written choices are offered again after your words." };
    return { result: `The written story takes choice ${input.choice}, ${scene.choices[input.choice - 1].say}, and plays on from here by itself. Write nothing more.` };
  },
  // The record: a fact for later stories, and how a story ended.
  note_fact(game, input, turn) {
    if (turn && turn.facts >= FACTS_PER_TURN) throw new Error("That's enough facts for one turn. Keep the record to what another story will need.");
    const id = input.id.trim().toLowerCase();
    const text = input.text.trim();
    if (text.length < 3 || text.length > 200) throw new Error("A fact is one line, from 3 to 200 characters.");
    const { known } = recordFact(game, { id, text, from: null });
    if (turn) turn.facts += 1;
    return known
      ? { result: `${id} was already on the record, and its words are kept.` }
      : { result: `On the record: ${id}.`, notice: `[RECORD] ${text}` };
  },
  end_story(game, input) {
    const id = input.id.trim();
    const thread = WORLD_THREADS[id];
    if (!thread) throw new Error(`There's no story called ${id}. The id is in the story's notes.`);
    const names = endingsOf(thread).map((one) => one.id);
    const ending = String(input.ending ?? "").trim().toLowerCase().replace(/\s+/g, "_");
    if (ending !== "other" && !names.includes(ending)) throw new Error(`This story's endings are ${names.join(", ")}, or other for another way.`);
    const summary = input.summary.trim();
    if (summary.length < 3 || summary.length > 200) throw new Error("The summary is one line, from 3 to 200 characters.");
    if (endingOf(game, id)) throw new Error("That story has already ended, and the record keeps its first ending.");
    endStory(game, { id, ending: ending === "other" ? null : ending, summary });
    return { result: `${thread.title} is over, ${ending === "other" ? "another way" : ending}, and it's on the record.`, notice: `[STORY] ${thread.title} has ended: ${summary}` };
  },
};

function checkValue(key, spec, value) {
  if (spec.type === "string" && typeof value !== "string") return `"${key}" must be text.`;
  if (spec.type === "boolean" && typeof value !== "boolean") return `"${key}" must be true or false.`;
  if (spec.type === "integer" && !Number.isInteger(value)) return `"${key}" must be a whole number.`;
  if (spec.type === "array" && !Array.isArray(value)) return `"${key}" must be a list.`;
  if (spec.type === "array") {
    for (const entry of value) {
      const problem = checkValue(key, spec.items, entry);
      if (problem) return problem;
    }
  }
  if (spec.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return `"${key}" must be an object.`;
    for (const field of spec.required ?? []) {
      if (value[field] === undefined) return `"${key}" is missing "${field}".`;
    }
    for (const [field, inner] of Object.entries(spec.properties ?? {})) {
      const problem = value[field] === undefined ? null : checkValue(field, inner, value[field]);
      if (problem) return problem;
    }
  }
  if (spec.enum && !spec.enum.includes(value)) return `"${key}" must be one of: ${spec.enum.join(", ")}.`;
  if (spec.type === "string" && value.length > 1200) return `"${key}" is too long.`;
  return null;
}

// Checks a request against its definition, because the AI's input isn't guaranteed to be valid.
function validate(def, input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "Input must be an object.";
  const { properties, required } = def.input_schema;
  for (const key of required) {
    if (input[key] === undefined) return `Missing "${key}".`;
  }
  for (const [key, spec] of Object.entries(properties)) {
    const value = input[key];
    const optional = !required.includes(key);
    if (optional && (value === undefined || value === null || value === "")) continue;
    const problem = checkValue(key, spec, value);
    if (problem) return problem;
  }
  return null;
}

export function newTurnLimits() {
  return { xp: 0, creditsGained: 0, itemsGiven: 0, damage: 0, stress: 0, ideologyShifts: 0, traitChanges: 0, hours: 0, training: 0, loreEntries: 0, newCharacters: 0, newEnemies: 0, facts: 0 };
}

// The clock stands still in a talk window, and the captain stays where they are, so these can't happen there.
// The tool list itself stays the same, because changing it would make Claude reload the whole story.
const NOT_IN_A_TALK = ["pass_time", "travel", "set_scene"];

// What's wrong with a call before it's made, for checking written scenes. Null means it would be accepted.
export function toolProblem(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  return def ? validate(def, input) : `Unknown tool: ${name}`;
}

export function runTool(game, name, input, turn) {
  const def = TOOL_DEFS.find((t) => t.name === name);
  if (!def) return { result: `Unknown tool: ${name}`, isError: true };
  if (turn?.talking && NOT_IN_A_TALK.includes(name)) return { result: "The clock is stopped in a talk window, and the player stays where they are, so that can't happen here. Just answer in words.", isError: true };
  // In a written part, the written story is the only thing that can change the game.
  if (turn?.scene && name !== "follow_scene") return { result: "This part of the story is written in advance, so nothing changes here except through follow_scene: give the number of the written choice the player's words mean, or 0 and answer them in a few words.", isError: true };
  const problem = validate(def, input);
  if (problem) return { result: problem, isError: true };
  try {
    return handlers[name](game, input, turn);
  } catch (err) {
    return { result: err.message, isError: true };
  }
}
