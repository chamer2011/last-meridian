// The people, places and species as plain-text files: world/characters/<id>.txt, world/places/<id>.txt and
// world/species/<id>.txt. Each kind has a spec below saying which lines and parts its file has, and one reader and
// one writer serve all three, so the board in the game and a text editor change the same files. This runs in the
// browser and in the game, so it uses nothing from either. The how-to files in those folders explain the formats.

const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function set(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  holder[keys.at(-1)] = value;
}
const isNumber = (text) => /^[+-]?\d+(\.\d+)?$/.test(text);
const listOf = (words) => words.split(",").map((one) => one.trim()).filter(Boolean);

// ---- What each kind of file holds ------------------------------------------------------------
// header: lines at the top, key: value. sections: parts under a heading. Types: string, number (unknown for none),
// flag (yes or no), list (comma-separated), range (2 to 5), pairs (name number, name number), text (a paragraph),
// items (one per line, starting with - ), named (name: words, one per line), fields (key: value lines of their own).

const FIGHT_FIELDS = [
  { path: "threat", key: "threat", type: "number" }, { path: "hp", key: "hp", type: "number" }, { path: "attack", key: "attack", type: "number" }, { path: "defense", key: "defense", type: "number" },
  { path: "damage", key: "damage", type: "range" }, { path: "weapon", key: "weapon", type: "string" }, { path: "xp", key: "xp", type: "number" }, { path: "credits", key: "credits", type: "range" },
  { path: "art", key: "art", type: "string" }, { path: "tags", key: "tags", type: "list" }, { path: "motive", key: "motive", type: "string" }, { path: "machine", key: "machine", type: "flag" }, { path: "boss", key: "boss", type: "flag" }, { path: "onHit", key: "on hit", type: "pairs" },
];

export const PERSON = {
  kind: "person",
  title: "name",
  header: [
    { path: "title", key: "title", type: "string" }, { path: "aliases", key: "also called", type: "list" }, { path: "pronouns", key: "pronouns", type: "string" },
    { path: "species", key: "species", type: "string" }, { path: "age", key: "age", type: "number" }, { path: "faction", key: "faction", type: "name" },
    { path: "role", key: "role", type: "string" }, { path: "location", key: "place", type: "name" }, { path: "crew", key: "crew", type: "flag" },
    { path: "color", key: "color", type: "string" }, { path: "listed", key: "listed", type: "flag" }, { path: "prominent", key: "prominent", type: "flag" },
    { path: "chair", key: "chair", type: "flag" }, { path: "voice_style", key: "voice style", type: "string" },
  ],
  sections: [
    { path: "note", phrase: "In a line", type: "text" }, { path: "appearance", phrase: "Appearance", type: "text" }, { path: "personality", phrase: "Personality", type: "text" },
    { path: "voice", phrase: "Voice", type: "text" }, { path: "goals", phrase: "Goals", type: "text" }, { path: "secrets", phrase: "Secrets", type: "text" },
    { path: "beliefs", phrase: "Beliefs", type: "pairs" }, { path: "attributes", phrase: "Attributes", type: "pairs" }, { path: "skills", phrase: "Skills", type: "pairs" },
    { path: "combat", phrase: "In a fight", type: "fields", fields: FIGHT_FIELDS },
    { path: "combat.lines.intro", phrase: "When the fight starts", type: "items" }, { path: "combat.lines.hit", phrase: "When they hit", type: "items" },
    { path: "combat.lines.miss", phrase: "When they miss", type: "items" }, { path: "combat.lines.crit", phrase: "When they hit hard", type: "items" },
    { path: "combat.lines.defeated", phrase: "When they're beaten", type: "items" },
  ],
};

export const PLACE = {
  kind: "place",
  title: "name",
  header: [
    { path: "aliases", key: "also called", type: "list" }, { path: "faction", key: "faction", type: "name" }, { path: "market", key: "market", type: "list" },
    { path: "fleet", key: "the fleet is here", type: "flag" }, { path: "rest", key: "a place to rest", type: "flag" }, { path: "dangerous", key: "dangerous", type: "flag" }, { path: "hidden", key: "hidden", type: "flag" },
    { path: "gm.people", key: "people", type: "list" }, { path: "gm.enemies", key: "enemies", type: "list" }, { path: "gm.items", key: "items", type: "list" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" }, { path: "gm.feel", phrase: "The feel of it", type: "text" },
    { path: "gm.districts", phrase: "Districts", type: "named" },
    { path: "gm.complications", phrase: "Complications", type: "items" }, { path: "gm.secrets", phrase: "Secrets", type: "items" },
    { path: "encounters", phrase: "Encounters", type: "items" }, { path: "rumors", phrase: "Rumors", type: "items" },
  ],
};

export const SPECIES_SPEC = {
  kind: "species",
  title: "name",
  header: [
    { path: "order", key: "order", type: "number" }, { path: "bonusAttrPoints", key: "extra attribute points", type: "number" }, { path: "bonusTraitPoints", key: "extra trait points", type: "number" },
    { path: "agelessTerms", key: "ageless terms", type: "number" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" }, { path: "gm", phrase: "For the game master", type: "text" },
    { path: "attrs", phrase: "Attributes", type: "pairs" }, { path: "attrCaps", phrase: "Attribute caps", type: "pairs" }, { path: "skills", phrase: "Skills", type: "pairs" },
    { path: "fx", phrase: "Effects", type: "fields", fields: [
      { path: "maxHp", key: "max hp", type: "number" }, { path: "fatigueRate", key: "fatigue rate", type: "number" }, { path: "healRate", key: "heal rate", type: "number" }, { path: "stressRate", key: "stress rate", type: "number" },
      { path: "context", key: "in a setting", type: "pairs" }, { path: "factions", key: "standing with", type: "pairs" }, { path: "skills", key: "skills", type: "pairs" },
    ] },
  ],
};
// The lines an enemy or a person says in a fight, by what's happening.
export const LINE_PHRASES = [
  ["intro", "When the fight starts"], ["hit", "When they hit"], ["miss", "When they miss"], ["crit", "When they hit hard"], ["defeated", "When they're beaten"],
  ["joins", "When they join the fight"], ["stunned", "When they're stunned"], ["persuade_worked", "When persuading works"], ["persuade_failed", "When persuading fails"],
  ["pay_worked", "When paying works"], ["threaten_worked", "When a threat works"], ["lie_worked", "When a lie works"], ["calm_worked", "When calming works"], ["shutdown_worked", "When a shutdown works"],
];

export const ENEMY = {
  kind: "enemy",
  title: "name",
  header: [
    { path: "threat", key: "threat", type: "number" }, { path: "hp", key: "hp", type: "number" }, { path: "attack", key: "attack", type: "number" }, { path: "defense", key: "defense", type: "number" },
    { path: "damage", key: "damage", type: "range" }, { path: "weapon", key: "weapon", type: "string" }, { path: "xp", key: "xp", type: "number" }, { path: "credits", key: "credits", type: "range" },
    { path: "art", key: "art", type: "string" }, { path: "tags", key: "tags", type: "list" }, { path: "motive", key: "motive", type: "string" }, { path: "faction", key: "faction", type: "string" },
    { path: "machine", key: "machine", type: "flag" }, { path: "boss", key: "boss", type: "flag" }, { path: "onHit", key: "on hit", type: "pairs" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" },
    ...LINE_PHRASES.map(([key, phrase]) => ({ path: `lines.${key}`, phrase, type: "items" })),
  ],
};

export const ITEM = {
  kind: "item",
  title: "name",
  header: [
    { path: "order", key: "order", type: "number" }, { path: "type", key: "type", type: "string" }, { path: "price", key: "price", type: "number" },
    { path: "damage", key: "damage", type: "range" }, { path: "stat", key: "stat", type: "string" }, { path: "skill", key: "skill", type: "string" },
    { path: "defense", key: "defense", type: "number" }, { path: "restricted", key: "restricted", type: "flag" }, { path: "effect", key: "effect", type: "pairs" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" },
    { path: "fx", phrase: "Effects", type: "fields", fields: [{ path: "context", key: "in a setting", type: "pairs" }, { path: "skills", key: "skills", type: "pairs" }] },
  ],
};

export const FACTION = {
  kind: "faction",
  title: "name",
  header: [
    { path: "order", key: "order", type: "number" }, { path: "aliases", key: "also called", type: "list" }, { path: "start", key: "starting standing", type: "number" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" },
    { path: "beliefs", phrase: "Beliefs", type: "pairs" },
  ],
};

// What a perk changes, besides skills: the numbers it can carry, by their key in the game and the words in the file.
export const PERK_NUMBERS = [
  ["maxHp", "max hp"], ["maxEnergy", "max energy"], ["attack", "attack"], ["defense", "defense"], ["damage", "damage"], ["flee", "flee"],
  ["healRate", "heal rate"], ["stressRate", "stress rate"], ["stressRecovery", "stress recovery"], ["fatigueRate", "fatigue rate"], ["learnRate", "learn rate"], ["priceBonus", "price bonus"],
];
export const PERK = {
  kind: "perk",
  title: "name",
  header: [
    { path: "order", key: "order", type: "number" }, { path: "starting", key: "starting", type: "flag" }, { path: "requires", key: "needs perk", type: "string" },
    { path: "requiresSkill", key: "needs skill", type: "pairs" }, { path: "requiresStat", key: "needs attribute", type: "pairs" }, { path: "ability", key: "ability", type: "string" },
  ],
  sections: [
    { path: "desc", phrase: "In a line", type: "text" },
    { path: "fx", phrase: "Effects", type: "fields", fields: [
      { path: "skills", key: "skills", type: "pairs" }, { path: "windowTier", key: "better tools in", type: "pairs" }, { path: "context", key: "in a setting", type: "pairs" },
      ...PERK_NUMBERS.map(([path, key]) => ({ path, key, type: "number" })),
    ] },
  ],
};

export const SPECS = { person: PERSON, place: PLACE, species: SPECIES_SPEC, enemy: ENEMY, item: ITEM, faction: FACTION, perk: PERK };

// ---- Reading one value ------------------------------------------------------------------------
function readValue(type, text, problem) {
  const value = text.trim();
  switch (type) {
    case "string": return value;
    // An id, or none.
    case "name": return value === "" || value === "none" ? null : value;
    case "number":
      if (value === "unknown" || value === "") return null;
      if (!isNumber(value)) return problem("needs a number, or unknown");
      return Number(value);
    case "flag":
      if (value === "yes") return true;
      if (value === "no") return false;
      return problem("is yes or no");
    case "list": return listOf(value);
    case "range": {
      const found = value.match(/^(-?\d+)\s+to\s+(-?\d+)$/);
      if (!found) return problem("is written as two numbers: 2 to 5");
      return [Number(found[1]), Number(found[2])];
    }
    case "pairs": {
      const pairs = {};
      for (const piece of listOf(value)) {
        const found = piece.match(/^([A-Za-z][A-Za-z0-9_]*)\s+([+-]?\d+(?:\.\d+)?)$/);
        if (!found) return problem(`has "${piece}", and each one is a name and a number, like might 2`);
        pairs[found[1]] = Number(found[2]);
      }
      return pairs;
    }
    default: return value;
  }
}
function writeValue(type, value) {
  switch (type) {
    case "name": return value === null ? "none" : String(value);
    case "number": return value === null || value === undefined ? "unknown" : String(value);
    case "flag": return value ? "yes" : "no";
    case "list": return (value ?? []).join(", ");
    case "range": return `${value[0]} to ${value[1]}`;
    case "pairs": return Object.entries(value ?? {}).map(([name, amount]) => `${name} ${amount}`).join(", ");
    default: return String(value ?? "");
  }
}

// ---- Reading a file ---------------------------------------------------------------------------
export function parseWorldText(text, spec, id = "it") {
  const problems = [];
  const problem = (line, message) => { problems.push({ line, message }); return undefined; };
  const obj = {};
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const headings = new Map(spec.sections.map((section) => [section.phrase.toLowerCase(), section]));
  const headerKeys = new Map(spec.header.map((field) => [field.key.toLowerCase(), field]));
  let section = null;
  let append = null;
  let titled = false;
  const seen = new Set();
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (!line) {
      append = null;
      continue;
    }
    if (!titled) {
      titled = true;
      const title = line.match(/^#\s*(.+)$/);
      if (title) {
        obj[spec.title] = title[1].trim();
        continue;
      }
      problem(n, "the first line is the name, written # The Name");
      if (!line.includes(":")) {
        obj[spec.title] = line;
        continue;
      }
      obj[spec.title] = id;
    }
    const colon = line.match(/^([A-Za-z][^:]{0,60}):$/);
    const heading = colon && colon[1].trim().split(/\s+/).length <= 6 ? colon[1].trim() : null;
    // A known line of the part we're in comes first, even with nothing after its colon, like tags: with no tags.
    const field = line.match(/^([A-Za-z][A-Za-z ]{0,40}):\s*(.*)$/);
    const ownField = field && (section === null ? headerKeys.get(field[1].trim().toLowerCase()) : section.type === "fields" ? section.fields.find((one) => one.key === field[1].trim().toLowerCase()) : null);
    if (ownField && !(heading && headings.has(heading.toLowerCase()) && section !== null)) {
      const value = readValue(ownField.type, field[2], (why) => problem(n, `${ownField.key} ${why}`));
      if (value !== undefined) {
        if (section === null) set(obj, ownField.path, value);
        else set(get(obj, section.path), ownField.path, value);
      }
      continue;
    }
    if (heading && headings.has(heading.toLowerCase())) {
      section = headings.get(heading.toLowerCase());
      if (seen.has(section.path)) problem(n, `"${heading}" is written twice`);
      seen.add(section.path);
      append = null;
      if (section.type === "text") set(obj, section.path, "");
      else if (section.type === "items" || section.type === "named") set(obj, section.path, []);
      else if (section.type === "pairs") set(obj, section.path, {});
      else if (section.type === "fields") set(obj, section.path, get(obj, section.path) ?? {});
      continue;
    }
    if (section === null) {
      problem(n, heading ? `I don't know a part of a ${spec.kind} called "${heading}"` : `before the first part, each line is one of ${spec.header.map((one) => one.key).join(", ")}, then a colon and its value`);
      continue;
    }
    if (heading) {
      problem(n, `I don't know a part of a ${spec.kind} called "${heading}". If it's part of the text, don't end the line with a colon`);
      continue;
    }
    if (section.type === "text") {
      const had = get(obj, section.path);
      set(obj, section.path, had ? `${had} ${line}` : line);
      continue;
    }
    if (section.type === "items") {
      const list = get(obj, section.path);
      const entry = line.match(/^-\s+(.*)$/);
      if (entry) {
        list.push(entry[1].trim());
        append = (words) => { list[list.length - 1] += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, `under "${section.phrase}", each one starts with - and a space`);
      continue;
    }
    if (section.type === "named") {
      const list = get(obj, section.path);
      const entry = line.match(/^([^:]{1,80}):\s*(.*)$/);
      if (entry) {
        const one = { name: entry[1].trim(), desc: entry[2].trim() };
        list.push(one);
        append = (words) => { one.desc += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, `under "${section.phrase}", each one is written Its Name: what it's like`);
      continue;
    }
    if (section.type === "pairs") {
      const pairs = readValue("pairs", line, (why) => problem(n, `under "${section.phrase}", a line ${why}`));
      if (pairs) Object.assign(get(obj, section.path), pairs);
      continue;
    }
    if (section.type === "fields") {
      problem(n, `under "${section.phrase}", each line is one of ${section.fields.map((one) => one.key).join(", ")}, then a colon and its value`);
      continue;
    }
  }
  if (!titled) problem(1, "the file is empty: it starts with # The Name");
  return { value: obj, problems };
}

// ---- Writing a file ----------------------------------------------------------------------------
export function writeWorldText(obj, spec) {
  const out = [`# ${obj[spec.title] ?? ""}`];
  for (const field of spec.header) {
    const value = get(obj, field.path);
    if (value === undefined) continue;
    out.push(`${field.key}: ${writeValue(field.type, value)}`);
  }
  for (const section of spec.sections) {
    const value = get(obj, section.path);
    if (value === undefined) continue;
    out.push("", `${section.phrase}:`);
    if (section.type === "text") out.push(String(value));
    else if (section.type === "items") out.push(...value.map((one) => `- ${one}`));
    else if (section.type === "named") out.push(...value.map((one) => `${one.name}: ${one.desc}`));
    else if (section.type === "pairs") { const words = writeValue("pairs", value); if (words) out.push(words); }
    else if (section.type === "fields") {
      for (const field of section.fields) {
        const inner = get(value, field.path);
        if (inner === undefined) continue;
        out.push(`${field.key}: ${writeValue(field.type, inner)}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}

export const parsePersonText = (text, id) => parseWorldText(text, PERSON, id);
export const parsePlaceText = (text, id) => parseWorldText(text, PLACE, id);
export const parseSpeciesText = (text, id) => parseWorldText(text, SPECIES_SPEC, id);
export const writePersonText = (person) => writeWorldText(person, PERSON);
export const writePlaceText = (place) => writeWorldText(place, PLACE);
export const writeSpeciesText = (species) => writeWorldText(species, SPECIES_SPEC);
