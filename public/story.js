// Reads the game master's text and works out what each piece is: narration, someone
// speaking, a consequence or a choice. Nothing here touches the screen, so the browser,
// the server and the tests can all use it.

// ---- Speakers -----------------------------------------------------------

// Colors for people who aren't notable enough to have their own.
const PALETTE = ["#9fd3ff", "#ffcf8b", "#b9f18d", "#ffa7c4", "#d0b3ff", "#8ff0e4", "#f6e58d", "#ffb3a7"];

export function colorForName(name) {
  let hash = 0;
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.codePointAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

const VOICES = { comm: "comm", comms: "comm", radio: "comm", transmission: "comm", machine: "machine", computer: "machine", synthetic: "machine", choir: "choir" };

function voiceFor(raw, speaker) {
  if (/choir/i.test(speaker)) return "choir";
  return VOICES[raw?.trim().toLowerCase()] ?? null;
}

// ---- Narration ----------------------------------------------------------

// Splits text into the parts inside and outside quotation marks.
export function splitQuotes(text) {
  const parts = [];
  let rest = text;
  while (rest) {
    const start = rest.search(/["“]/);
    if (start < 0) {
      parts.push({ kind: "beat", text: rest });
      break;
    }
    if (start > 0) parts.push({ kind: "beat", text: rest.slice(0, start) });
    const close = rest[start] === "“" ? "”" : '"';
    const end = rest.indexOf(close, start + 1);
    if (end < 0) {
      parts.push({ kind: "quote", text: rest.slice(start) });
      break;
    }
    parts.push({ kind: "quote", text: rest.slice(start, end + 1) });
    rest = rest.slice(end + 1);
  }
  return parts;
}

function speechBlock(speaker, voice, body, marked) {
  const name = speaker.trim();
  const parts = splitQuotes(body);
  return {
    type: "speech",
    speaker: name,
    voice: voiceFor(voice, name),
    marked,
    parts: parts.length && !parts.some((p) => p.kind === "quote") ? [{ kind: "quote", text: body }] : parts,
  };
}

const MARKED_SPEECH = /^@\s*([^:[\]@]{1,60}?)\s*(?:\[([^\]]{1,20})\])?\s*:\s*(.*)$/;
// Local models and older saves may write Voss: "Hello" without the @ marker.
const LOOSE_SPEECH = /^\*{0,2}(\p{Lu}[\p{L}\p{M}'’.\- ]{0,40}?)\*{0,2}\s*(?:\[([^\]]{1,20})\])?\s*:\s*\*{0,2}\s*(["“].*)$/u;
const CONSEQUENCE = /^(?:=>|⇒|→)\s*(.*)$/;

// Tells "Commander Voss" from the start of a sentence like "The sign reads".
function looksLikeName(text) {
  const words = text.trim().split(/\s+/);
  return words.length <= 4 && words.every((word) => /^\p{Lu}/u.test(word) || ["of", "the", "de", "van", "von"].includes(word));
}

// While text is still arriving, a half-written marker on the last line is held back, so it never flashes up.
export function parseNarration(text, { streaming = false } = {}) {
  const blocks = [];
  const lines = text.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith(">")) return;
    const stillArriving = streaming && i === lines.length - 1;
    if (stillArriving && (line === "=" || line === "=>")) return;

    const consequence = line.match(CONSEQUENCE);
    if (consequence) {
      if (consequence[1]) blocks.push({ type: "consequence", text: consequence[1] });
      return;
    }
    const marked = line.match(MARKED_SPEECH);
    if (marked) {
      blocks.push(speechBlock(marked[1], marked[2], marked[3], true));
      return;
    }
    if (line.startsWith("@")) {
      if (!stillArriving) blocks.push({ type: "narration", parts: splitQuotes(line.slice(1).trim()) });
      return;
    }
    const loose = line.match(LOOSE_SPEECH);
    if (loose && looksLikeName(loose[1])) {
      blocks.push(speechBlock(loose[1], loose[2], loose[3], false));
      return;
    }
    blocks.push({ type: "narration", parts: splitQuotes(line) });
  });
  return blocks;
}

// ---- Choices ------------------------------------------------------------

const DIFFICULTY_NAMES = {
  easy: "easy",
  moderate: "moderate",
  medium: "moderate",
  hard: "hard",
  very_hard: "very_hard",
  impossible: "nearly_impossible",
  nearly_impossible: "nearly_impossible",
};

const normalizeWord = (text) => text.trim().toLowerCase().replace(/\s+/g, "_");

function classifyTag(token, vocab) {
  const text = token.trim();
  if (text.startsWith("!")) return { kind: "warn", text: text.slice(1).trim() };
  const person = text.match(/^([+\-−–])\s*(\D.*)$/);
  if (person) return { kind: person[1] === "+" ? "approve" : "disapprove", name: person[2].trim() };

  let [first, second, audience] = text.split(/\s*[:|,]\s*/);
  if (!second) {
    // Also accepts [persuasion hard], without the colon.
    const spaced = first.match(/^(.*?)\s+(easy|moderate|medium|hard|very hard|impossible|nearly impossible)$/i);
    if (spaced) [, first, second] = spaced;
  }
  const key = normalizeWord(first);
  if (vocab.skills?.[key]) {
    return { kind: "check", skill: vocab.skills[key], difficulty: second ? DIFFICULTY_NAMES[normalizeWord(second)] ?? null : null, ...(audience ? { audience: audience.trim() } : {}) };
  }
  if (vocab.poles?.[key]) return { kind: "belief", pole: key };
  return { kind: "note", text };
}

export function parseOption(raw, vocab = {}) {
  const tags = [];
  const label = raw
    .replace(/\[([^\]]{1,80})\]/g, (_, token) => {
      tags.push(classifyTag(token, vocab));
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { label: label || raw.trim(), tags };
}

export function parseOptions(text, vocab = {}) {
  return text.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(">"))
    .map((line) => line.slice(1).trim())
    .filter(Boolean)
    .map((line) => parseOption(line, vocab));
}

// The choices on offer now: the most recent ones since the player last did something.
export function latestOptions(transcript, vocab = {}) {
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const entry = transcript[i];
    if (entry.role === "player" || entry.role === "combat") return [];
    if (entry.role === "narrator") {
      const options = parseOptions(entry.text, vocab);
      if (options.length) return options;
    }
  }
  return [];
}

// What the game knows how to recognize in a choice's tags.
export function buildVocab(skills = {}, axes = {}) {
  const vocab = { skills: {}, poles: {} };
  for (const [id, skill] of Object.entries(skills)) {
    vocab.skills[id] = id;
    vocab.skills[normalizeWord(skill.name)] = id;
  }
  for (const axis of Object.values(axes)) {
    vocab.poles[axis.low.id] = axis.low.id;
    vocab.poles[axis.high.id] = axis.high.id;
  }
  return vocab;
}

// The chance of success, counting the fact that a 1 always fails and a 20 always succeeds.
export function oddsFor(bonus, dc) {
  let wins = 1;
  for (let die = 2; die <= 19; die += 1) if (die + bonus >= dc) wins += 1;
  return wins * 5;
}

// ---- Game messages ------------------------------------------------------

const ATTITUDE_ORDER = ["hostile", "wary", "neutral", "friendly", "ally"];

function toneFor(tag, body) {
  const signedStart = body.match(/^([+-])/)?.[1];
  switch (tag) {
    case "CREDITS": return signedStart === "-" ? "bad" : "good";
    case "HEALTH":
      if (signedStart) return signedStart === "+" ? "good" : "bad";
      return /recover/i.test(body) ? "good" : "bad";
    case "STRESS": return signedStart === "-" ? "good" : "bad";
    case "XP": case "SKILL": return "good";
    case "ITEM": return /^Lost/.test(body) ? "bad" : "good";
    case "FACTION": return / -\d/.test(body) ? "bad" : "good";
    case "SHIP": return /-\d/.test(body) ? "bad" : /\+\d/.test(body) ? "good" : "info";
    case "QUEST": return /^failed/.test(body) ? "bad" : /^completed/.test(body) ? "good" : "info";
    case "RELATION": {
      const change = body.match(/: (\w+) -> (\w+)/);
      if (!change) return "info";
      return ATTITUDE_ORDER.indexOf(change[2]) >= ATTITUDE_ORDER.indexOf(change[1]) ? "good" : "bad";
    }
    case "BELIEF": case "TRAIT": return "belief";
    case "COMBAT": case "BREAK": return "bad";
    case "RAID": return /^Every ship came through/.test(body) ? "good" : "bad";
    case "SUPPLY":
      if (/^Bought|^Sold|^There's|^There are/.test(body)) return "good";
      return /down to/.test(body) ? "warn" : "bad";
    case "FLEET":
      if (/^Rations|^The work crews|real ships/.test(body)) return "info";
      if (/Pursuit -\d|is back with the fleet/.test(body)) return "good";
      return /\+\d/.test(body) && !/-\d/.test(body) ? "good" : "bad";
    case "TIME": return "dim";
    case "HACK": return /GRANTED/.test(body) ? "good" : "bad";
    case "ALARM": return /stops|armed\.$|is armed/.test(body) && !/disarmed/.test(body) ? "info" : "bad";
    case "AIR": return /good again/.test(body) ? "good" : /bad/.test(body) ? "bad" : "warn";
    case "SYSTEMS": return /fixed|working again|back on/.test(body) ? "good" : "info";
    case "DOOR": return /locked|locks|forced|won't lock/.test(body) && !/unlocked/.test(body) ? "warn" : "info";
    default: return "info";
  }
}

// A game message can be several lines. Each comes back with its label and a good or bad tone.
export function parseNotice(text) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((raw) => {
    // Older saves have an emoji at the start of these lines.
    const line = raw.replace(/^[\p{Extended_Pictographic}️\s]+/u, "");
    const tagged = line.match(/^\[([A-Z]+)\]\s*(.*)$/);
    if (!tagged) return { tag: "GAME", text: line, tone: /^Level up/.test(line) ? "good" : "info" };
    const [, tag, body] = tagged;
    if (tag === "ROLL") {
      const roll = body.match(/^(.*): (-?\d+) (.*) = (-?\d+) vs (\d+): (.*)$/);
      if (roll) {
        const result = roll[6];
        return {
          tag: "CHECK",
          reason: roll[1],
          math: `${roll[2]} ${roll[3]}`,
          total: Number(roll[4]),
          dc: Number(roll[5]),
          result,
          tone: /FAIL/.test(result) ? "bad" : "good",
        };
      }
    }
    return { tag, text: body, tone: toneFor(tag, body) };
  });
}

export function combatTone(line) {
  if (/hits you|badly hurt|beaten|can't flee|no effect/i.test(line)) return "bad";
  if (/and hit for|is defeated|restores|recovering|can't act|stops .* cold|break away \(/i.test(line)) return "good";
  return "dim";
}

// ---- Lore ---------------------------------------------------------------

const escapeForRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildLoreIndex(entries) {
  const byId = new Map();
  const byAlias = new Map();
  for (const entry of entries) {
    byId.set(entry.id, entry);
    for (const alias of [entry.name, ...(entry.aliases ?? [])]) {
      if (alias && !byAlias.has(alias)) byAlias.set(alias, entry);
    }
  }
  const terms = [...byAlias.keys()].sort((a, b) => b.length - a.length).map(escapeForRegex);
  // The lookarounds stop "Ilun" from matching inside a longer word.
  const regex = terms.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null;
  return { byId, byAlias, regex };
}

// Splits text into plain pieces and links to lore entries. Only the first mention
// of each entry in a passage is linked, because a page full of links is hard to read.
export function segmentLore(text, index, used = new Set()) {
  if (!index.regex) return [{ text }];
  const pieces = [];
  let at = 0;
  for (const match of text.matchAll(index.regex)) {
    const entry = index.byAlias.get(match[0]);
    if (used.has(entry.id)) continue;
    used.add(entry.id);
    if (match.index > at) pieces.push({ text: text.slice(at, match.index) });
    pieces.push({ text: match[0], entry });
    at = match.index + match[0].length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces;
}

export function findLoreIds(text, index) {
  const ids = new Set();
  if (!index.regex) return ids;
  for (const match of text.matchAll(index.regex)) ids.add(index.byAlias.get(match[0]).id);
  return ids;
}

// Finds the entry for a name as the AI wrote it, such as "Old Voss" for Voss.
export function findLoreEntry(name, index) {
  const exact = index.byAlias.get(name);
  if (exact) return exact;
  const words = name.split(/\s+/);
  for (let i = 1; i < words.length; i += 1) {
    const hit = index.byAlias.get(words.slice(i).join(" "));
    if (hit) return hit;
  }
  return null;
}

const SPEECH_VERB = /\b(?:says?|said|asks?|asked|calls?|called|shouts?|shouted|whispers?|whispered|replies|replied|mutters?|muttered)\s*$/i;

// A quote in the middle of a sentence, like a "review panel", is a phrase and not someone talking.
function hasSpokenWords(parts) {
  return parts.some((part, i) => {
    if (part.kind !== "quote") return false;
    const before = parts[i - 1]?.text.trimEnd() ?? "";
    return !/\p{L}$/u.test(before) || SPEECH_VERB.test(before);
  });
}

// "It's over," you say. Words like these belong to the player, so nobody else gets them.
const PLAYER_SPEECH = /\byou\s+(?:could\s+\w+|say|said|ask|asked|tell|told|reply|replied|answer|answered|whisper|whispered|mutter|muttered|shout|shouted|snap|snapped|add|added)\b/i;
const PRONOUNS = { she: /\b(?:she|her)\b/i, he: /\b(?:he|him|his)\b/i, they: /\b(?:they|them|their)\b/i };
const ANY_PRONOUN = /\b(?:she|her|he|him|his|they|them|their)\b/i;

// Whether a pronoun in the text could mean this person, going by their file when there is one.
function pronounFits(entry, text) {
  const own = PRONOUNS[entry.pronouns?.split("/")[0]?.trim().toLowerCase()];
  return (own ?? ANY_PRONOUN).test(text);
}

function peopleNamedIn(text, index) {
  if (!index.regex) return [];
  const people = [];
  for (const match of text.matchAll(index.regex)) {
    const entry = index.byAlias.get(match[0]);
    if (entry.kind === "person" && !people.includes(entry)) people.push(entry);
  }
  return people;
}

// The AI doesn't always give speech its own line, so this works out who's talking from the
// words around the quotes, and from who the passage was just talking about. When it's unclear,
// a paragraph stays plain narration, because a wrong name is worse than none.
export function attributeSpeech(blocks, index) {
  let current = null;
  let justMentioned = false;
  return blocks.map((block) => {
    if (block.type === "speech") {
      current = findLoreEntry(block.speaker, index) ?? { name: block.speaker };
      justMentioned = true;
      return block;
    }
    if (block.type !== "narration") return block;

    const beats = block.parts.filter((part) => part.kind === "beat").map((part) => part.text).join(" ");
    const named = peopleNamedIn(beats, index);
    if (!hasSpokenWords(block.parts)) {
      // Two people in one paragraph leaves it unclear who "she" means next.
      if (named.length) current = named.length === 1 ? named[0] : null;
      justMentioned = named.length === 1;
      return block;
    }
    if (PLAYER_SPEECH.test(beats)) return block;

    const speaker = named[0]
      ?? (current && (beats.trim() ? pronounFits(current, beats) : justMentioned) ? current : null);
    if (!speaker) {
      justMentioned = false;
      return block;
    }
    current = speaker;
    justMentioned = true;
    return { type: "speech", speaker: speaker.person ?? speaker.name, voice: null, marked: false, parts: block.parts };
  });
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

// Combines the fixed lore with what's true in this game: standings, attitudes and new discoveries.
export function loreEntries(staticLore, game) {
  const contacts = game?.contacts ?? [];
  const entries = staticLore.map((entry) => {
    if (entry.kind === "faction") {
      const faction = game?.factions?.find((f) => f.id === entry.factionId);
      if (!faction) return entry;
      const social = faction.relationship ? ` ${signed(faction.relationship)} on social checks with them.` : "";
      return { ...entry, status: `Your standing: ${signed(faction.value)}.${social}` };
    }
    if (entry.kind === "person") {
      const contact = contacts.find((c) => c.name.toLowerCase() === entry.person.toLowerCase());
      if (!contact) return entry;
      const social = contact.relationship ? ` ${signed(contact.relationship)} on social checks with them.` : "";
      return { ...entry, status: `Attitude toward you: ${contact.attitude}.${social}` };
    }
    if (entry.kind === "place" && game?.location?.id === entry.placeId) return { ...entry, status: "You are here." };
    return entry;
  });
  const known = new Set(staticLore.filter((e) => e.kind === "person").map((e) => e.person.toLowerCase()));
  // People the game master has added in this campaign, from their files.
  for (const person of game?.people ?? []) {
    if (known.has(person.shortName.toLowerCase())) continue;
    known.add(person.shortName.toLowerCase());
    entries.push({
      id: person.loreId,
      name: person.name,
      kind: "person",
      pronouns: person.pronouns,
      aliases: [person.shortName, ...person.aliases],
      text: person.note?.startsWith(person.role) ? person.note : [person.role, person.note].filter(Boolean).join(". "),
      color: person.color ?? colorForName(person.shortName),
      ...(person.attitude ? { status: `Attitude toward you: ${person.attitude}.` } : {}),
    });
  }
  for (const contact of contacts) {
    if (known.has(contact.name.toLowerCase())) continue;
    const words = contact.name.split(/\s+/);
    const lastName = words.length > 1 && /^\p{Lu}.{2,}/u.test(words.at(-1)) ? [words.at(-1)] : [];
    entries.push({
      id: `contact:${contact.name}`,
      name: contact.name,
      kind: "person",
      aliases: lastName,
      text: contact.note,
      color: colorForName(contact.name),
      status: `Attitude toward you: ${contact.attitude}.`,
    });
  }
  for (const entry of game?.lore ?? []) {
    // A name the AI gave as "The Rim" will often appear as "the Rim", or just "Rim".
    const article = entry.name.match(/^The\s+(.+)$/);
    entries.push({
      ...entry,
      aliases: article ? [`the ${article[1]}`, article[1]] : [],
      color: entry.kind === "person" ? colorForName(entry.name) : undefined,
    });
  }
  return entries;
}
