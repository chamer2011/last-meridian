// Everything a character can be: skills, species, origins, traits and beliefs.
// You can safely edit names, descriptions and numbers here. The game works out
// the effect text you see on screen from these numbers, so it can't go stale.
//
// "fx" is a passive effect. It can contain any of:
//   attrs: { might: 1 }        changes an attribute
//   skills: { stealth: 2 }     bonus on checks with a skill (not the same as skill ranks)
//   context: { choir: 2 }      bonus on any check in that situation
//   maxHp, maxEnergy, attack, defense, damage, flee    added to that number
//   stressRate, fatigueRate, stressRecovery, learnRate, healRate    multipliers
//   priceBonus: 0.05           market prices 5% better
//   stressOnKill: 10           stress added each time you win a fight
//   checks: -1                 bonus or penalty on every check
//   credits: 500               starting credits (only applied at creation)
//   factions: { fleet: 10 }    one-time change in faction standing
// "gm" is a note for the AI game master about how to play this in the story.

import { WORLD_CHARACTERS, WORLD_FACTIONS } from "./world.js";

export const ATTR_START = 2;
export const ATTR_MIN = 1;
export const ATTR_MAX_BUY = 8;
export const ATTR_MAX = 10;
export const ATTR_POINTS = 16;
// Total cost of raising an attribute to each value, starting from ATTR_START.
export const ATTR_COST = { 1: -1, 2: 0, 3: 1, 4: 2, 5: 3, 6: 5, 7: 7, 8: 10 };

export const SKILL_BASE_POINTS = 6;
export const SKILL_POINTS_PER_TERM = 3;
export const SKILL_CREATION_CAP = 6;
export const SKILL_MAX = 10;
export const TAG_COUNT = 3;
export const TAG_LEARN_RATE = 1.5;

export const TRAIT_POINTS = 3;
export const MAX_TRAITS = 6;
export const MAX_NEGATIVE_TRAIT_POINTS = 5;

export const MAX_TERMS = 6;
export const STANCE_LIMIT = 6;
export const IDEOLOGY_LIMIT = 10;
export const CONVICTION_THRESHOLD = 5;

export const SKILL_GROUPS = {
  combat: "Combat",
  space: "Space",
  tech: "Technical",
  social: "Social",
  field: "Field",
  resonance: "Resonance",
};

export const SKILLS = {
  firearms: { name: "Firearms", attr: "agility", group: "combat", desc: "Pistols, rifles and anything else that shoots." },
  melee: { name: "Melee", attr: "might", group: "combat", desc: "Blades, batons and fists." },
  tactics: { name: "Tactics", attr: "intellect", group: "combat", desc: "Reading a battle and giving the right order." },
  gunnery: { name: "Gunnery", attr: "perception", group: "space", desc: "Ship weapons and targeting." },
  piloting: { name: "Piloting", attr: "agility", group: "space", desc: "Flying anything, ideally without hitting things." },
  navigation: { name: "Navigation", attr: "intellect", group: "space", desc: "Plotting jumps. Shortens travel and can save fuel." },
  void_ops: { name: "Void Ops", attr: "endurance", group: "space", desc: "Vacuum, zero gravity and working outside the hull." },
  engineering: { name: "Engineering", attr: "intellect", group: "tech", desc: "Building and repairing. Hull repair kits restore more." },
  hacking: { name: "Hacking", attr: "intellect", group: "tech", desc: "Getting into systems that would prefer you didn't." },
  science: { name: "Science", attr: "intellect", group: "tech", desc: "Sensors, analysis and how things work." },
  medicine: { name: "Medicine", attr: "intellect", group: "tech", desc: "Treating the living. Medkits heal more." },
  lore: { name: "Lore", attr: "intellect", group: "tech", desc: "History, cultures, languages and the First Builders." },
  persuasion: { name: "Persuasion", attr: "presence", group: "social", desc: "Changing minds honestly." },
  deception: { name: "Deception", attr: "presence", group: "social", desc: "Changing minds dishonestly." },
  intimidation: { name: "Intimidation", attr: "presence", group: "social", desc: "Changing minds by frightening them." },
  leadership: { name: "Leadership", attr: "presence", group: "social", desc: "Getting people to follow you into the dark." },
  commerce: { name: "Commerce", attr: "presence", group: "social", desc: "Deals and haggling. Gives better market prices." },
  streetwise: { name: "Streetwise", attr: "perception", group: "field", desc: "Knowing who to ask, what to pay and when to leave." },
  stealth: { name: "Stealth", attr: "agility", group: "field", desc: "Not being seen, heard or scanned." },
  awareness: { name: "Awareness", attr: "perception", group: "field", desc: "Noticing the thing that's about to go wrong." },
  survival: { name: "Survival", attr: "endurance", group: "field", desc: "Staying alive where nothing wants you to." },
  athletics: { name: "Athletics", attr: "might", group: "field", desc: "Running, climbing and escaping fights." },
  composure: { name: "Composure", attr: "willpower", group: "field", desc: "Holding steady against fear, pain and interrogation." },
  attunement: { name: "Attunement", attr: "resonance", group: "resonance", desc: "Sensing minds, places and what's coming." },
  manifestation: { name: "Manifestation", attr: "resonance", group: "resonance", desc: "Bending the world through Resonance." },
};

// Situations the AI can flag on a check. Traits can give bonuses or penalties in them.
export const CONTEXTS = {
  choir: "against the Choir",
  machines: "against machines",
  hegemony: "against the Hegemony",
  syndicate: "against the Syndicate",
  resonance: "against Resonance",
  vacuum: "in vacuum",
  confined: "in confined spaces",
  crowd: "in crowds",
  authority: "facing authority",
  low_light: "in the dark",
  heavy_gravity: "in heavy gravity",
  loved_one: "when a loved one is at stake",
};

export const SPECIES = {
  human: {
    name: "Human",
    desc: "The Concord's most numerous people: stubborn, adaptable and everywhere.",
    gm: "Human. Unremarkable anywhere in the fleet.",
    attrs: {},
    bonusAttrPoints: 2,
    bonusTraitPoints: 1,
    skills: {},
    fx: { factions: { fleet: 5 } },
  },
  korrun: {
    name: "Korrun",
    desc: "Broad, heavy-boned people from high-gravity worlds. They treat ordinary ships as gently floating and doorways as an insult.",
    gm: "Korrun: wide and immensely strong, built for high gravity. Normal ship corridors are a tight fit. Korrun culture prizes blunt speech and keeping your word.",
    attrs: { might: 2, endurance: 1, agility: -1 },
    skills: { athletics: 1 },
    fx: { maxHp: 5, context: { heavy_gravity: 3 } },
  },
  veshti: {
    name: "Veshti",
    desc: "Long-limbed spacers whose families haven't touched a planet in nine generations. Open skies make them queasy.",
    gm: "Veshti: tall, thin and long-limbed, born in orbit. Planetary gravity tires them and open skies unsettle them. Excellent in zero gravity.",
    attrs: { agility: 2, perception: 1, might: -1, endurance: -1 },
    skills: { void_ops: 2, piloting: 1 },
    fx: { context: { vacuum: 1, heavy_gravity: -3 } },
  },
  ilari: {
    name: "Ilari",
    desc: "Empaths whose skin carries slow patterns of light that show what they feel. They make wonderful friends and terrible liars.",
    gm: "Ilari: skin patterns of soft light shift with emotion, so feelings are hard to hide. Naturally sensitive to Resonance, which makes them a target for Hegemony Inquisitors.",
    attrs: { resonance: 2, presence: 1, willpower: -1 },
    skills: { attunement: 1 },
    fx: { skills: { deception: -2, persuasion: 1 }, factions: { hegemony: -15, ilun: 10 } },
  },
  thessan: {
    name: "Thessan",
    desc: "Cold-blooded archivists who live for centuries and take the long view of everything, including you.",
    gm: "Thessan: scaled, cold-blooded and very long-lived. They're slow to anger, remember everything and struggle in the cold. Younger species find them patronizing.",
    attrs: { intellect: 2, willpower: 1, agility: -1, presence: -1 },
    skills: { lore: 2 },
    agelessTerms: 8,
    fx: { factions: { ilun: 5 } },
  },
  synthetic: {
    name: "Synthetic",
    desc: "A free machine person, granted citizenship by the Concord. The Choir has made every human in the fleet look at you differently.",
    gm: "Synthetic: an artificial person. They don't tire like organics, medkits barely help them and they have no Resonance at all. Since the Choir, many in the fleet fear or hate synthetics, and some suspect the player is a Choir infiltrator. Play this as real tension.",
    attrs: { intellect: 1, might: 1, endurance: 1, presence: -1 },
    attrCaps: { resonance: 1 },
    skills: { hacking: 1 },
    agelessTerms: 99,
    fx: { fatigueRate: 0.25, healRate: 0.5, stressRate: 0.85, factions: { fleet: -15 } },
  },
};

export const HOMEWORLDS = {
  aurelis: {
    name: "Aurelis, Concord Core",
    desc: "The capital's glittering towers, parliaments and universities. Now a slowly cooling ruin.",
    gm: "Grew up on Aurelis, the Concord's capital. It burned in the Fall.",
    skills: { lore: 1, persuasion: 1 },
    credits: 150,
    factions: { fleet: 5 },
    ideology: { community: 1 },
  },
  orbitals: {
    name: "The Tannhal Orbitals",
    desc: "A chain of spinning habitats where air is a utility bill and everyone can patch a hull.",
    gm: "Raised on the Tannhal Orbitals, a habitat chain where everyone is one bad seal from death.",
    skills: { void_ops: 1, engineering: 1 },
    credits: 80,
    ideology: { community: 2 },
  },
  tessen: {
    name: "Tessen Colony",
    desc: "Hard farms beyond the patrol routes. Your neighbors were a day's ride away and the raiders were closer.",
    gm: "Raised on Tessen, a frontier farm colony the Concord mostly forgot.",
    skills: { survival: 1, firearms: 1 },
    credits: 40,
    factions: { hegemony: -5 },
    ideology: { freedom: 1, self: 1 },
  },
  vantor: {
    name: "Vantor Prime",
    desc: "The Hegemony's perfect capital. The trains run on time, and so do the arrests.",
    gm: "Born in the Hegemony, on Vantor Prime. Fleet refugees may treat them as a spy.",
    skills: { awareness: 1, leadership: 1 },
    credits: 120,
    factions: { hegemony: 15, fleet: -10 },
    ideology: { order: 2 },
  },
  kessara: {
    name: "Kessara Drift",
    desc: "A lawless asteroid warren. You learned to count, fight and lie at about the same age.",
    gm: "Raised in Kessara Drift among smugglers and raiders.",
    skills: { streetwise: 2 },
    credits: 60,
    factions: { drift: 15, fleet: -5 },
    ideology: { freedom: 2, self: 1 },
  },
  ilun: {
    name: "The Ilun Monasteries",
    desc: "Carved stone, long silences and a hum in the bones of the world.",
    gm: "Raised near the Ilun monasteries, where the stones hum at night.",
    skills: { attunement: 1, lore: 1 },
    credits: 20,
    factions: { ilun: 15 },
    ideology: { faith: 2 },
  },
  long_haul: {
    name: "The Long Haul",
    desc: "A generation ship, three centuries out from anywhere. Everyone has a job, and the job was your grandmother's.",
    gm: "Born aboard the Long Haul, a generation ship with a rigid, close-knit crew culture.",
    skills: { engineering: 1, leadership: 1 },
    credits: 50,
    ideology: { community: 2, order: 1 },
  },
};

export const UPBRINGINGS = {
  privilege: {
    name: "Family of Privilege",
    desc: "Senators and shipping magnates at the dinner table. You learned that everything is negotiable.",
    gm: "Comes from a wealthy, political family. Some fleet survivors resent that.",
    skills: { persuasion: 1, commerce: 1 },
    credits: 400,
    ideology: { order: 1, self: 1 },
  },
  service: {
    name: "Service Family",
    desc: "Your parents wore a uniform, and you learned to salute before you could read.",
    gm: "Grew up a military child, moving from base to base.",
    skills: { firearms: 1, tactics: 1 },
    credits: 80,
    factions: { fleet: 5 },
    ideology: { order: 2 },
  },
  dockside: {
    name: "Dockside Workers",
    desc: "Union halls, long shifts and a father who could fix anything except money.",
    gm: "Grew up in a working family on the docks.",
    skills: { engineering: 1, commerce: 1 },
    credits: 100,
    ideology: { community: 2 },
  },
  undercity: {
    name: "Orphan of the Undercity",
    desc: "No family and no name on any list. You survived by being quick and being forgotten.",
    gm: "An orphan who grew up on the streets, with no family and a deep distrust of institutions.",
    skills: { streetwise: 1, stealth: 1 },
    credits: 0,
    ideology: { self: 2, freedom: 1 },
  },
  academy: {
    name: "Academy Household",
    desc: "Two professors, thousands of books and dinner conversations with footnotes.",
    gm: "Raised by academics, with an early education and high expectations.",
    skills: { science: 1, hacking: 1 },
    credits: 150,
    ideology: { reason: 2 },
  },
  devout: {
    name: "Devout Community",
    desc: "A faith that shaped every day of your childhood, whether or not you still keep it.",
    gm: "Raised in a tight-knit religious community.",
    skills: { composure: 1, attunement: 1 },
    credits: 60,
    factions: { ilun: 5 },
    ideology: { faith: 2, community: 1 },
  },
  homestead: {
    name: "Homesteaders",
    desc: "Up before dawn, every day, for a crop that might fail anyway.",
    gm: "Raised on a small family homestead, used to hard work and bad luck.",
    skills: { survival: 1, athletics: 1 },
    credits: 50,
    ideology: { self: 1, mercy: 1 },
  },
};

// Each axis runs from its low pole (negative numbers) to its high pole (positive numbers).
export const AXES = {
  authority: { name: "Authority", low: "order", high: "freedom", question: "When rules and conscience conflict, who decides?" },
  loyalty: { name: "Loyalty", low: "community", high: "self", question: "Who do you owe first?" },
  violence: { name: "Conflict", low: "mercy", high: "iron", question: "What are you willing to do to win?" },
  belief: { name: "Belief", low: "reason", high: "faith", question: "How do you know what's true?" },
  flesh: { name: "Humanity", low: "purity", high: "ascension", question: "Should people and machines be kept apart?" },
};

export const POLES = {
  order: { name: "Order", axis: "authority", sign: -1, adj: "Disciplined", noun: "Loyalist", desc: "Laws and chains of command are what stand between people and the dark." },
  freedom: { name: "Freedom", axis: "authority", sign: 1, adj: "Free-Thinking", noun: "Libertarian", desc: "Nobody gets to own you, not even for your own good." },
  community: { name: "Community", axis: "loyalty", sign: -1, adj: "Communal", noun: "Collectivist", desc: "No one survives alone, so no one should have to." },
  self: { name: "Self", axis: "loyalty", sign: 1, adj: "Self-Reliant", noun: "Individualist", desc: "Look after yourself and yours, because no one else will." },
  mercy: { name: "Mercy", axis: "violence", sign: -1, adj: "Merciful", noun: "Peacemaker", desc: "A victory bought with cruelty isn't worth surviving." },
  iron: { name: "Iron", axis: "violence", sign: 1, adj: "Militant", noun: "Warlord", desc: "The enemy won't hesitate, so you can't afford to." },
  reason: { name: "Reason", axis: "belief", sign: -1, adj: "Rational", noun: "Empiricist", desc: "If it can't be measured, it isn't a plan." },
  faith: { name: "Faith", axis: "belief", sign: 1, adj: "Devout", noun: "Mystic", desc: "There's something larger at work, and it can be heard." },
  purity: { name: "Purity", axis: "flesh", sign: -1, adj: "Purist", noun: "Humanist", desc: "Machines are tools. Look at what happened when we forgot." },
  ascension: { name: "Ascension", axis: "flesh", sign: 1, adj: "Transhuman", noun: "Synthesist", desc: "Flesh is a starting point. The future belongs to whatever comes next." },
};

// Passive effects gained while a belief is strong enough. They can come and go as beliefs drift in play.
export const CONVICTIONS = {
  order: { name: "Chain of Command", fx: { skills: { leadership: 1, tactics: 1, deception: -1 } } },
  freedom: { name: "Unchained", fx: { skills: { deception: 1, streetwise: 1, leadership: -1 } } },
  community: { name: "One Fleet", fx: { skills: { persuasion: 1, medicine: 1, commerce: -1 } } },
  self: { name: "Self-Made", fx: { skills: { commerce: 1, stealth: 1, leadership: -1 } } },
  mercy: { name: "Open Hand", fx: { skills: { persuasion: 2 }, attack: -1 } },
  iron: { name: "Iron Will", fx: { skills: { intimidation: 2, persuasion: -2 }, attack: 1 } },
  reason: { name: "Empiricist", fx: { skills: { science: 2, lore: 1, attunement: -2 } } },
  faith: { name: "True Believer", fx: { skills: { attunement: 2, composure: 1, science: -2 } } },
  purity: { name: "Flesh Over Steel", fx: { context: { choir: 2, machines: 1 }, skills: { hacking: -2 } } },
  ascension: { name: "Beyond the Flesh", fx: { skills: { hacking: 2, engineering: 1, composure: -2 } } },
};

// What each faction believes. Sharing their beliefs improves your standing and your social checks.
export const FACTION_BELIEFS = {
  fleet: { loyalty: -6, violence: -1 },
  hegemony: { authority: -8, loyalty: -3, violence: 5, belief: -3, flesh: -2 },
  drift: { authority: 8, loyalty: 6, violence: 2 },
  ilun: { belief: 9, violence: -4, flesh: -3 },
  ...Object.fromEntries(Object.entries(WORLD_FACTIONS).map(([id, faction]) => [id, faction.beliefs ?? {}])),
};

// The important people in the world, whether the player has met them or not. Each has a
// file in world/characters, with their personality, secrets and stats.
export const NOTABLES = WORLD_CHARACTERS;

export const ATTITUDE_VALUES = { ally: 2, friendly: 1, neutral: 0, wary: -1, hostile: -2 };

export const TRAIT_GROUPS = { physical: "Body", mind: "Mind", social: "Reputation", resonance: "Resonance" };

// cost above 0 spends trait points, below 0 gives them back, and 0 is a pure tradeoff.
// earnable traits can also be gained during play, if the AI thinks the story has earned them.
export const TRAITS = {
  // Body
  iron_constitution: { name: "Iron Constitution", group: "physical", cost: 2, desc: "You've never had a sick day, and your doctors find it rude.", excludes: ["frail", "chronic_illness"], fx: { maxHp: 12, fatigueRate: 0.75 } },
  quick_reflexes: { name: "Quick Reflexes", group: "physical", cost: 2, desc: "You've moved before you've finished deciding to.", fx: { defense: 1, flee: 2, skills: { piloting: 1 } } },
  gene_tailored: { name: "Gene-Tailored", group: "physical", cost: 2, desc: "Someone paid to have you designed, and it shows.", notSpecies: ["synthetic"], fx: { attrs: { endurance: 1, agility: 1 } }, gm: "Visibly gene-tailored. Purists sneer at this." },
  cyber_arm: { name: "Cybernetic Arm", group: "physical", cost: 2, desc: "It's stronger than the original. It also sets off scanners.", notSpecies: ["synthetic"], fx: { attrs: { might: 1 }, skills: { melee: 1 } }, gm: "Has an obvious cybernetic arm. Purists like Lt. Tarrow distrust it, and security scanners notice it." },
  steady_hands: { name: "Steady Hands", group: "physical", cost: 1, desc: "Your pulse doesn't reach your fingers.", fx: { skills: { firearms: 1, medicine: 1 } } },
  zero_g_native: { name: "Zero-G Native", group: "physical", cost: 1, desc: "Up and down are just suggestions.", excludes: ["void_sick"], fx: { skills: { void_ops: 2, piloting: 1 } } },
  cyber_eye: { name: "Cybernetic Eye", group: "physical", cost: 1, desc: "A targeting lens where your left eye used to be.", notSpecies: ["synthetic"], excludes: ["one_eyed"], fx: { skills: { awareness: 2, gunnery: 1 }, context: { low_light: 2 } }, gm: "Has a visible cybernetic eye that can see in the dark." },
  frail: { name: "Frail", group: "physical", cost: -2, desc: "You've always broken more easily than other people.", notSpecies: ["synthetic"], excludes: ["iron_constitution"], fx: { maxHp: -10, attrs: { might: -1 } } },
  chronic_illness: { name: "Chronic Illness", group: "physical", cost: -2, desc: "Without your medication you have a few bad days. Then a few worse ones.", notSpecies: ["synthetic"], excludes: ["iron_constitution"], fx: { attrs: { endurance: -1 }, fatigueRate: 1.5 }, gm: "Has a chronic illness that needs regular medication, which is hard to find in a refugee fleet. Let this create real problems." },
  one_eyed: { name: "One-Eyed", group: "physical", cost: -1, earnable: true, desc: "Depth perception is a luxury.", excludes: ["cyber_eye"], fx: { skills: { awareness: -2, firearms: -1, gunnery: -1 } } },
  old_wound: { name: "Old Wound", group: "physical", cost: -1, earnable: true, desc: "It aches when the weather changes, and on ships that means when the air recyclers cycle.", fx: { maxHp: -5, fatigueRate: 1.25 } },
  void_sick: { name: "Void-Sick", group: "physical", cost: -1, desc: "Zero gravity turns your stomach inside out, which is awkward out here.", excludes: ["zero_g_native"], fx: { skills: { void_ops: -2, piloting: -1 }, context: { vacuum: -1 } } },
  stim_addict: { name: "Stim Addict", group: "physical", cost: -2, earnable: true, desc: "Just one more shift. Just one more dose.", notSpecies: ["synthetic"], fx: { stressRate: 1.25, skills: { composure: -1 } }, gm: "Addicted to combat stims. Cravings come at bad moments, and supplies in the fleet are scarce." },
  // Mind
  eidetic_memory: { name: "Eidetic Memory", group: "mind", cost: 2, desc: "You remember everything, which is a mixed blessing since the Fall.", fx: { skills: { lore: 1, science: 1 }, learnRate: 1.1 } },
  quick_study: { name: "Quick Study", group: "mind", cost: 2, desc: "Show you something once and you've got the shape of it.", excludes: ["slow_learner"], fx: { learnRate: 1.25 } },
  cool_headed: { name: "Cool-Headed", group: "mind", cost: 2, desc: "When the alarms start, you get quieter.", excludes: ["hot_headed"], fx: { stressRate: 0.7, skills: { composure: 1 } } },
  born_leader: { name: "Born Leader", group: "mind", cost: 2, desc: "People look to you before they've decided to.", fx: { skills: { leadership: 2 } }, gm: "People instinctively look to them in a crisis." },
  battle_hardened: { name: "Battle-Hardened", group: "mind", cost: 2, earnable: true, desc: "You've been shot at enough to stop taking it personally.", fx: { stressRate: 0.9, skills: { composure: 1, tactics: 1 } } },
  savant: { name: "Mathematical Savant", group: "mind", cost: 1, desc: "You do jump calculations for fun.", fx: { skills: { navigation: 2, hacking: 1 } } },
  polyglot: { name: "Polyglot", group: "mind", cost: 1, desc: "Eleven languages, four of them extinct.", fx: { skills: { lore: 2, persuasion: 1 } }, gm: "Speaks many languages, including rare and dead ones." },
  paranoid: { name: "Paranoid", group: "mind", cost: 0, earnable: true, desc: "You're not wrong. That's the worst part.", fx: { skills: { awareness: 2, persuasion: -1 } } },
  reckless: { name: "Reckless", group: "mind", cost: 0, earnable: true, desc: "Plans are for people who expect to be around later.", fx: { attack: 1, defense: -1 } },
  nightmares: { name: "Nightmares", group: "mind", cost: -1, earnable: true, desc: "You see them every time you close your eyes.", fx: { stressRecovery: 0.5 } },
  survivors_guilt: { name: "Survivor's Guilt", group: "mind", cost: -1, earnable: true, desc: "Why you? Why not them?", fx: { stressRate: 1.1, context: { loved_one: 2 } }, gm: "Haunted by surviving when others didn't. Will take terrible risks to avoid losing anyone else." },
  hot_headed: { name: "Hot-Headed", group: "mind", cost: -1, desc: "You've apologized for a lot of things you meant.", excludes: ["cool_headed"], fx: { skills: { deception: -2, persuasion: -1, melee: 1 } } },
  claustrophobic: { name: "Claustrophobic", group: "mind", cost: -1, desc: "You chose a career on starships. It was a mistake you can't admit.", fx: { context: { confined: -3 } }, gm: "Claustrophobic. Tight ducts and sealed compartments are genuinely frightening." },
  bloodlust: { name: "Bloodlust", group: "mind", cost: -1, earnable: true, desc: "It's the only time it goes quiet.", excludes: ["pacifist"], fx: { stressOnKill: -5, damage: 1, skills: { persuasion: -2 } }, gm: "Enjoys violence more than they want to admit, and others can tell." },
  slow_learner: { name: "Slow Learner", group: "mind", cost: -2, desc: "You get there. Eventually. Usually after everyone else.", excludes: ["quick_study"], fx: { learnRate: 0.75 } },
  fear_of_machines: { name: "Fear of Machines", group: "mind", cost: -2, earnable: true, desc: "You saw what they did. Your hands shake when a drone powers up.", notSpecies: ["synthetic"], fx: { context: { choir: -2, machines: -1 } }, gm: "Deeply afraid of machines since the Fall. Call for Composure checks around the Choir and add stress." },
  pacifist: { name: "Pacifist", group: "mind", cost: -2, desc: "You have sworn not to kill, or have tried to.", excludes: ["bloodlust"], fx: { stressOnKill: 10, attack: -1, skills: { persuasion: 2 } }, gm: "Abhors killing. Offer them non-violent paths, and let killing weigh on them." },
  // Reputation
  honeyed_voice: { name: "Honeyed Voice", group: "social", cost: 2, desc: "You could read out a repair manual and people would lean in.", fx: { skills: { persuasion: 2, deception: 1 } } },
  war_hero: { name: "War Hero", group: "social", cost: 2, earnable: true, desc: "There's a story about you. It's mostly true.", fx: { skills: { leadership: 1 }, factions: { fleet: 15 } }, gm: "A known war hero. Refugees recognize them, and some expect miracles." },
  wealthy_patron: { name: "Wealthy Patron", group: "social", cost: 2, desc: "Someone wealthy backs you, and sooner or later they'll want something.", fx: { credits: 500 }, gm: "Has a wealthy patron in the fleet who will eventually ask for a favor. Make it uncomfortable." },
  menacing: { name: "Menacing", group: "social", cost: 1, desc: "Conversations tend to end when you stand up.", fx: { skills: { intimidation: 2 } } },
  honest_face: { name: "Honest Face", group: "social", cost: 1, desc: "People tell you things, then wonder why they did.", fx: { skills: { persuasion: 1, deception: 1 } } },
  haggler: { name: "Haggler", group: "social", cost: 1, desc: "You've never paid the first price in your life.", fx: { skills: { commerce: 2 }, priceBonus: 0.05 } },
  syndicate_ties: { name: "Syndicate Ties", group: "social", cost: 1, desc: "You know a guy. The guy knows Mother Quill.", fx: { skills: { streetwise: 1 }, factions: { drift: 15, fleet: -5 } } },
  wanted: { name: "Wanted", group: "social", cost: -2, earnable: true, desc: "There's a price on your head, and it's going up.", fx: { context: { hegemony: -1 }, factions: { hegemony: -25 } }, gm: "Wanted by the Hegemony. Bounty hunters and informants should turn up from time to time." },
  deep_debt: { name: "Deep Debt", group: "social", cost: -2, earnable: true, desc: "You owe the Syndicate more than you'll ever earn.", fx: { credits: -300, factions: { drift: -15 } }, gm: "Owes the Kessara Syndicate a fortune. Mother Quill's collectors will come, and they accept favors." },
  disgraced: { name: "Disgraced", group: "social", cost: -2, earnable: true, desc: "Half the fleet thinks you shouldn't be in that chair.", fx: { skills: { leadership: -1 }, factions: { fleet: -15 } }, gm: "Publicly disgraced. Some officers doubt them openly, and mutiny is a real possibility." },
  secret_identity: { name: "False Name", group: "social", cost: -1, desc: "The person everyone thinks they know doesn't exist. You do, unfortunately.", fx: { skills: { deception: 1 } }, gm: "Living under a false name. Someone from their real past should turn up eventually." },
  awkward: { name: "Awkward", group: "social", cost: -1, desc: "You rehearse conversations and they still go wrong.", fx: { skills: { persuasion: -1, leadership: -1 } } },
  // Resonance
  latent_resonant: { name: "Latent Resonant", group: "resonance", cost: 2, desc: "You feel it in your teeth when someone's lying, and you've never told anyone.", notSpecies: ["synthetic"], excludes: ["null_field"], fx: { attrs: { resonance: 1 }, skills: { attunement: 1 } } },
  null_field: { name: "Null Field", group: "resonance", cost: 2, desc: "Resonance slides off you. The monks find you unsettling.", excludes: ["latent_resonant", "prophetic_dreams"], fx: { context: { resonance: 3 }, skills: { attunement: -3, manifestation: -3 } }, gm: "A Resonance null. Adepts can't read them and find them unsettling." },
  prophetic_dreams: { name: "Prophetic Dreams", group: "resonance", cost: 1, earnable: true, desc: "You've been dreaming of a dead star. It's getting closer.", notSpecies: ["synthetic"], excludes: ["null_field"], requires: { resonance: 3 }, fx: { skills: { attunement: 1 } }, gm: "Has prophetic dreams. Occasionally give them a vague, unsettling vision that later proves true." },
  hears_the_song: { name: "Hears the Song", group: "resonance", cost: -1, earnable: true, desc: "It's always there now, just under the silence. The Choir, singing.", fx: { stressRate: 1.15, context: { choir: 1 } }, gm: "Can faintly hear the Choir's song, and it may be able to sense them too. Use this for dread, and for useful warnings." },
  resonance_scarred: { name: "Resonance Scarred", group: "resonance", cost: -1, earnable: true, desc: "You reached too far once, and something reached back.", fx: { maxEnergy: -3, skills: { composure: 1 } } },
};

export const DRIVES = {
  protect: { name: "Keep Them Alive", desc: "Thirty thousand people. Every one of them is your responsibility now.", fx: { skills: { leadership: 1 }, factions: { fleet: 5 } }, gm: "Their driving goal is protecting the fleet's people. Test it with choices between the many and the few." },
  vengeance: { name: "Make Them Pay", desc: "The Choir took everything. You're going to return the favor.", fx: { context: { choir: 2 } }, gm: "Their driving goal is revenge on the Choir. Tempt them with revenge at terrible cost." },
  lost_one: { name: "Find Someone Lost", desc: "Their ship was on the wrong side of the line when it fell. You never saw a body.", fx: { skills: { streetwise: 1, awareness: 1 }, context: { loved_one: 1 } }, gm: "Searching for a loved one lost in the Fall. Offer rumors and false hopes, and consider the Choir wearing that person's face." },
  redemption: { name: "Atone", desc: "You did something, or failed to. Nobody here knows. Yet.", fx: { skills: { composure: 1, medicine: 1 } }, gm: "Seeking to atone for a past wrong. Bring that wrong back to haunt them." },
  truth: { name: "Uncover the Truth", desc: "Someone built the Choir. The Beacon means something. You have to know.", fx: { skills: { science: 1, lore: 1 } }, gm: "Obsessed with the truth about the Choir and the First Builders. Reward curiosity with answers that cost something." },
  power: { name: "Take What's Owed", desc: "The old powers failed. Whoever holds this fleet could become something new.", fx: { skills: { intimidation: 1, commerce: 1 } }, gm: "Ambitious. Offer real chances to gain power at the expense of others." },
  liberty: { name: "Never Kneel Again", desc: "You've worn someone's chains before, and you won't wear the Hegemony's.", fx: { skills: { stealth: 1, deception: 1 } }, gm: "Fiercely refuses to be controlled. The Hegemony's offer of safety should be a recurring temptation for those around them." },
  calling: { name: "Answer the Call", desc: "The signal is for you, somehow. You've known since the first time you heard it.", fx: { skills: { attunement: 1, composure: 1 } }, gm: "Believes they have a sacred calling tied to the Beacon. Keep it ambiguous whether they're right." },
  new_home: { name: "Build a New Home", desc: "Everyone keeps talking about what was lost. Someone has to think about what's next.", fx: { skills: { engineering: 1, survival: 1 } }, gm: "Dreams of founding a real home for survivors. Offer settlement opportunities that aren't quite safe." },
};

export const BONDS = {
  sibling: { name: "A Sibling in the Fleet", attitude: "friendly", desc: "You've argued every day of your life, and they're still the only family you have left.", note: "Your sibling, serving elsewhere in the fleet." },
  child: { name: "A Child in the Fleet", attitude: "ally", desc: "They're on a transport four ships over, and you think about that every time the alarms sound.", note: "Your child, aboard a civilian transport in the fleet." },
  spouse: { name: "A Spouse", attitude: "ally", desc: "You married in better times, and neither of you has had a good night's sleep since.", note: "Your spouse, working in the fleet's civil administration." },
  old_friend: { name: "An Old Friend", attitude: "friendly", desc: "They knew you before all this, and they're the one person who still uses your first name.", note: "Your oldest friend, now master of a fleet freighter." },
  mentor: { name: "A Mentor", attitude: "friendly", desc: "They taught you everything, and they think you should have asked more questions.", note: "Your old mentor, now a senior voice on the fleet's civil council." },
  rival: { name: "A Rival", attitude: "hostile", desc: "They wanted what you've got, and they're convinced they'd do better with it. They might be right.", note: "Your rival, who's in the fleet, and who's wanted what you've got for years." },
  protege: { name: "A Protege", attitude: "friendly", desc: "A young officer who looks at you as though you know what you're doing.", note: "A young officer on the Meridian who idolizes you." },
  no_one: { name: "No One", attitude: null, desc: "Everyone you knew died in the Fall. It does make things simpler.", note: "" },
};

// Temporary injuries and states. hours is how long they last unless treated.
export const CONDITIONS = {
  concussed: { name: "Concussion", hours: 48, wound: true, desc: "Your head rings and the room won't stay still.", fx: { attrs: { intellect: -1, perception: -1 } } },
  cracked_ribs: { name: "Cracked Ribs", hours: 96, wound: true, desc: "Every breath is an argument.", fx: { attrs: { might: -1, endurance: -1 } } },
  broken_arm: { name: "Broken Arm", hours: 240, wound: true, desc: "It's splinted, and it's still in the way.", fx: { skills: { firearms: -2, melee: -2, piloting: -1 } } },
  deep_burn: { name: "Deep Burn", hours: 120, wound: true, desc: "Plasma doesn't leave clean edges.", fx: { maxHp: -10 } },
  blood_loss: { name: "Blood Loss", hours: 36, wound: true, desc: "You're cold, and it's hard to stand.", fx: { attrs: { endurance: -2 } } },
  radiation_sickness: { name: "Radiation Sickness", hours: 168, desc: "Your hair is coming out, and food tastes of metal.", fx: { maxHp: -5, fatigueRate: 1.5 } },
  resonance_burn: { name: "Resonance Burn", hours: 72, desc: "You reached too far, and now everything hums too loudly.", fx: { maxEnergy: -4, skills: { attunement: -2, manifestation: -2 } } },
  infected: { name: "Infection", hours: 120, desc: "The wound has gone hot and wrong.", fx: { attrs: { endurance: -1 }, fatigueRate: 1.25 } },
  shaken: { name: "Shaken", hours: 24, desc: "Your hands won't stop shaking.", fx: { checks: -1 } },
  inspired: { name: "Inspired", hours: 24, desc: "For a moment, you remember what it's all for.", fx: { checks: 1 } },
  intoxicated: { name: "Intoxicated", hours: 8, desc: "Everything is funny and slightly to the left.", fx: { attrs: { agility: -1, intellect: -1 }, skills: { persuasion: 1 } } },
  underfed: { name: "Underfed", hours: 72, desc: "You've been eating what the fleet's eating, and it isn't enough.", fx: { attrs: { endurance: -1 }, fatigueRate: 1.25 } },
};

export const NAMES = [
  "Tal Verrin", "Mirel Ashe", "Dorn Kessik", "Sana Vey", "Oren Halloway", "Ixa Toren", "Bren Castellane", "Yara Moss",
  "Lio Tannen", "Kell Durant", "Nessa Quorl", "Arun Shale", "Petra Lunt", "Corvin Vale", "Hana Reth", "Jonah Pike",
  "Maren Oduya", "Tobin Greer", "Zhen Marlowe", "Iris Kavan", "Rook Adeyemi", "Sefa Lindqvist", "Emric Dray", "Noor Valente",
  "Cato Rysk", "Dalia Fenn", "Marek Ansel", "Tessaly Oon", "Vance Okoro", "Wren Calloway", "Ilse Morrow", "Bastien Roe",
  "Asha Tembe", "Gideon Sarr", "Lena Hask", "Quen Vassar", "Rhea Solano", "Tomas Ekene", "Una Brandt", "Xan Mercer",
];

// Ready-made starting points. "Randomize" fills in everything else around these choices.
export const ARCHETYPES = {
  officer: {
    name: "Fleet Officer",
    blurb: "A career navy officer, disciplined, respected and carrying the weight of every order.",
    species: "human", homeworld: "aurelis", upbringing: "service",
    attributes: { might: 3, endurance: 4, agility: 3, perception: 4, intellect: 5, willpower: 5, presence: 6, resonance: 1 },
    careers: ["navy", "navy", "navy"], fall: "last_stand",
    tags: ["leadership", "tactics", "piloting"],
    skills: ["leadership", "tactics", "firearms", "piloting", "gunnery", "composure", "navigation", "persuasion"],
    traits: ["born_leader", "cool_headed", "nightmares"],
    ideology: { authority: -3, loyalty: -3, violence: 1, belief: -2, flesh: -1 },
    drive: "protect", bond: "old_friend", gear: ["medkit", "stim"],
  },
  smuggler: {
    name: "Smuggler",
    blurb: "Every blockade has a gap, and every customs officer has a price. Now you're respectable. Somehow.",
    species: "human", homeworld: "kessara", upbringing: "undercity",
    attributes: { might: 3, endurance: 3, agility: 6, perception: 5, intellect: 4, willpower: 3, presence: 6, resonance: 1 },
    careers: ["smuggler", "smuggler", "smuggler"], fall: "fled",
    tags: ["piloting", "deception", "streetwise"],
    skills: ["piloting", "deception", "firearms", "streetwise", "commerce", "stealth", "navigation", "awareness"],
    traits: ["honest_face", "haggler", "quick_reflexes", "deep_debt"],
    ideology: { authority: 4, loyalty: 3, violence: 0, belief: -1, flesh: 1 },
    drive: "liberty", bond: "rival", gear: ["stim", "lockbreaker"],
  },
  adept: {
    name: "Resonant Adept",
    blurb: "You hear the hum beneath the stars. The Ilun monks taught you to answer it, and the fleet fears that you can.",
    species: "ilari", homeworld: "ilun", upbringing: "devout",
    attributes: { might: 1, endurance: 3, agility: 4, perception: 4, intellect: 4, willpower: 6, presence: 3, resonance: 6 },
    careers: ["adept", "adept", "envoy"], fall: "captured",
    tags: ["attunement", "manifestation", "composure"],
    skills: ["attunement", "manifestation", "composure", "melee", "lore", "persuasion", "awareness"],
    traits: ["prophetic_dreams", "cool_headed", "old_wound"],
    ideology: { authority: 1, loyalty: -2, violence: -4, belief: 5, flesh: -2 },
    drive: "calling", bond: "mentor", gear: ["energy_cell", "medkit"],
  },
  engineer: {
    name: "Salvage Engineer",
    blurb: "You've rebuilt reactors with sealant and prayer. Machines tell you their secrets.",
    species: "korrun", homeworld: "orbitals", upbringing: "dockside",
    attributes: { might: 3, endurance: 4, agility: 3, perception: 4, intellect: 7, willpower: 4, presence: 3, resonance: 1 },
    careers: ["engineer", "engineer", "engineer"], fall: "evacuated",
    tags: ["engineering", "hacking", "void_ops"],
    skills: ["engineering", "void_ops", "hacking", "science", "firearms", "survival", "leadership"],
    traits: ["savant", "steady_hands", "awkward"],
    ideology: { authority: 2, loyalty: -3, violence: -1, belief: -4, flesh: 3 },
    drive: "new_home", bond: "sibling", gear: ["repair_kit", "medkit"],
  },
  envoy: {
    name: "Diplomatic Envoy",
    blurb: "You've ended two wars with a conversation, and started one by accident.",
    species: "thessan", homeworld: "aurelis", upbringing: "privilege",
    attributes: { might: 2, endurance: 3, agility: 3, perception: 5, intellect: 5, willpower: 4, presence: 7, resonance: 2 },
    careers: ["envoy", "envoy", "envoy", "envoy"], fall: "away",
    tags: ["persuasion", "lore", "deception"],
    skills: ["persuasion", "deception", "lore", "leadership", "commerce", "awareness", "composure"],
    traits: ["honeyed_voice", "polyglot", "paranoid"],
    ideology: { authority: -1, loyalty: -2, violence: -5, belief: -1, flesh: 0 },
    drive: "truth", bond: "mentor", gear: ["medkit", "forged_papers"],
  },
  marine: {
    name: "Marine Sergeant",
    blurb: "You've gone through more airlocks under fire than anyone alive, largely because the others aren't.",
    species: "korrun", homeworld: "tessen", upbringing: "homestead",
    attributes: { might: 6, endurance: 6, agility: 4, perception: 4, intellect: 3, willpower: 5, presence: 3, resonance: 1 },
    careers: ["marines", "marines", "marines", "marines"], fall: "last_stand",
    tags: ["firearms", "tactics", "athletics"],
    skills: ["firearms", "melee", "tactics", "athletics", "composure", "void_ops", "leadership"],
    traits: ["iron_constitution", "menacing", "old_wound", "survivors_guilt"],
    ideology: { authority: -2, loyalty: -3, violence: 5, belief: 0, flesh: -3 },
    drive: "vengeance", bond: "protege", gear: ["heavy_carbine", "stim", "medkit"],
  },
  doctor: {
    name: "Ship's Doctor",
    blurb: "You took an oath. It didn't say what to do when there are thirty thousand patients and no more medicine.",
    species: "human", homeworld: "orbitals", upbringing: "academy",
    attributes: { might: 2, endurance: 4, agility: 3, perception: 5, intellect: 7, willpower: 5, presence: 4, resonance: 2 },
    careers: ["scholar", "medic", "medic", "medic"], fall: "evacuated",
    tags: ["medicine", "science", "persuasion"],
    skills: ["medicine", "science", "persuasion", "composure", "leadership", "awareness", "lore"],
    traits: ["steady_hands", "eidetic_memory", "pacifist"],
    ideology: { authority: 0, loyalty: -5, violence: -6, belief: -3, flesh: 1 },
    drive: "protect", bond: "child", gear: ["medkit", "medkit", "stim"],
  },
  ghost: {
    name: "Synthetic Ghost",
    blurb: "A machine among people who have all watched machines kill their families.",
    species: "synthetic", homeworld: "long_haul", upbringing: "academy",
    attributes: { might: 3, endurance: 3, agility: 5, perception: 6, intellect: 6, willpower: 4, presence: 3, resonance: 1 },
    careers: ["agent", "agent", "agent"], fall: "away",
    tags: ["hacking", "stealth", "deception"],
    skills: ["hacking", "stealth", "deception", "firearms", "awareness", "science", "persuasion"],
    traits: ["quick_study", "secret_identity"],
    ideology: { authority: 2, loyalty: -1, violence: 0, belief: -4, flesh: 6 },
    drive: "truth", bond: "no_one", gear: ["lockbreaker", "forged_papers"],
  },
};
