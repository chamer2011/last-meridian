// The story files, world/stories/<id>.txt: a story's notes, its endings by name, the facts it leaves, what on the
// record changes it, and what happens on its own clock, all in plain text. This reads a file into the shape the
// game uses, and writes one back from that shape, so the story board in the game and a text editor can both
// change the same file. It runs in the browser and in the game, so it uses nothing from either.
// world/stories/_how-to-write-a-story.txt explains the format for people.

export const SECTIONS = [
  ["The lead", "lead"],
  ["For anyone who isn't the captain", "anyone"],
  ["What's really going on", "truth"],
  ["How it might go", "beats"],
  ["Ways through", "routes"],
  ["Checks that fit", "checks"],
  ["If it comes to a fight", "fights"],
  ["Where it can end up", "outcomes"],
  ["Facts it can leave", "facts"],
  ["What on the record changes it", "reacts"],
  ["If nobody steps in", "stages"],
  ["Consequences", "consequences"],
  ["Rewards", "rewards"],
];
const HEADING_KEY = new Map(SECTIONS.map(([phrase, key]) => [phrase.toLowerCase(), key]));
const PHRASE_OF = Object.fromEntries(SECTIONS.map(([phrase, key]) => [key, phrase]));
const TEXT_SECTIONS = ["lead", "anyone", "truth", "rewards"];
const LIST_SECTIONS = ["beats", "routes", "checks", "fights"];
const HEADER_KEYS = ["kind", "places", "people", "factions", "level", "after", "waits", "clock from"];
export const GOODS = ["food", "fuel", "medicine", "parts"];
export const NAME = /^[a-z][a-z0-9_]{1,39}$/;

const listOf = (words) => words.split(",").map((one) => one.trim()).filter(Boolean);

// Reads one story file. What comes back is the story as the game's code expects it (title, kind, places, people,
// factions, lead, anyone, gm with truth, beats, routes, checks, fights, outcomes, facts, reacts and rewards), its
// clock (stages, consequences, waits, from), and the problems, each with its line, in plain words.
export function parseStoryText(text, id = "the_story") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  const story = { title: "", kind: "", places: [], minLevel: 1, after: null, people: [], factions: [], lead: "", gm: { truth: "", beats: [], routes: [], checks: [], fights: [], outcomes: [], rewards: "" } };
  const clock = { stages: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let section = null;
  const seen = new Set();
  let append = null;
  let item = null;
  let titled = false;
  const numbers = (where, words, into) => {
    for (const piece of words.split(",")) {
      const found = piece.trim().match(/^([a-z][a-z0-9_]*)\s+([+-]?\d+)$/i);
      if (!found) {
        problem(where, `"${piece.trim()}" should be a name and a number, like fuel -15`);
        continue;
      }
      into[found[1]] = Number(found[2]);
    }
  };
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
        story.title = title[1].trim();
        continue;
      }
      problem(n, "the first line is the story's title, written # The Title");
      // Without the #, a line with no colon in it is still most likely the title.
      if (!line.includes(":")) {
        story.title = line;
        continue;
      }
      story.title = id;
    }
    // A short line ending with a colon is a heading, or a mistaken one. A longer one is text that happens to end so.
    const colon = line.match(/^([A-Za-z][^:]{0,60}):$/);
    const heading = colon && colon[1].trim().split(/\s+/).length <= 6 ? colon : null;
    if (heading && HEADING_KEY.has(heading[1].trim().toLowerCase())) {
      section = HEADING_KEY.get(heading[1].trim().toLowerCase());
      if (seen.has(section)) problem(n, `"${heading[1].trim()}" is written twice`);
      seen.add(section);
      append = null;
      item = null;
      if (section === "anyone") story.anyone = "";
      continue;
    }
    if (section === null) {
      const field = line.match(/^(kind|places|people|factions|level|after|waits|clock from):\s*(.*)$/i);
      if (!field) {
        problem(n, heading ? `I don't know a part of a story called "${heading[1].trim()}"` : `before the first part, each line is one of ${HEADER_KEYS.join(", ")}, then a colon and its value`);
        continue;
      }
      const key = field[1].toLowerCase();
      const value = field[2].trim();
      if (key === "kind") story.kind = value;
      else if (key === "places") story.places = listOf(value);
      else if (key === "people") story.people = listOf(value);
      else if (key === "factions") story.factions = listOf(value);
      else if (key === "level") {
        if (!/^\d+$/.test(value)) problem(n, "level is a number: the level the player should have before this story starts");
        else story.minLevel = Number(value);
      } else if (key === "after") story.after = value || null;
      else if (key === "waits") clock.waits = value;
      else {
        const days = value.match(/^(\d+)\s*days?$/i);
        if (!days) problem(n, "clock from is written clock from: 30 days");
        else clock.from = Number(days[1]);
      }
      continue;
    }
    if (heading) {
      problem(n, `I don't know a part of a story called "${heading[1].trim()}". If it's part of the text, don't end the line with a colon`);
      continue;
    }
    if (TEXT_SECTIONS.includes(section)) {
      const holder = section === "lead" || section === "anyone" ? story : story.gm;
      holder[section] = holder[section] ? `${holder[section]} ${line}` : line;
      continue;
    }
    if (LIST_SECTIONS.includes(section)) {
      const list = story.gm[section];
      const entry = line.match(/^-\s+(.*)$/);
      if (entry) {
        list.push(entry[1].trim());
        append = (words) => { list[list.length - 1] += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, `under "${PHRASE_OF[section]}", each one starts with - and a space`);
      continue;
    }
    if (section === "outcomes") {
      const entry = line.match(/^(\S+):\s*(.*)$/);
      if (entry) {
        const outcome = { id: entry[1].toLowerCase(), text: entry[2].trim() };
        if (!NAME.test(entry[1])) problem(n, `an ending's name is lowercase letters, digits and underscores, from 2 to 40 characters, not ${entry[1]}`);
        story.gm.outcomes.push(outcome);
        append = (words) => { outcome.text += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, "an ending is written its_name: what's true if the story ends this way");
      continue;
    }
    if (section === "facts") {
      const entry = line.match(/^(\S+?)(?:,\s*after\s+(\S+))?:\s*(.*)$/);
      if (entry) {
        const name = entry[1].toLowerCase();
        if (!NAME.test(entry[1])) problem(n, `a fact's name is lowercase letters, digits and underscores, from 2 to 40 characters, not ${entry[1]}`);
        (story.gm.facts ??= {})[name] = entry[3].trim();
        if (entry[2]) (story.gm.factAfter ??= {})[name] = entry[2].toLowerCase();
        append = (words) => { story.gm.facts[name] += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, "a fact is written its_name: a line of plain words, or its_name, after an_ending: a line, when one ending leaves it");
      continue;
    }
    if (section === "reacts") {
      const entry = line.match(/^\?\s*(.+?)\s*->\s*(.*)$/);
      if (entry) {
        const one = { to: entry[1].trim(), then: entry[2].trim() };
        (story.gm.reacts ??= []).push(one);
        append = (words) => { one.then += ` ${words}`; };
      } else if (append) append(line);
      else problem(n, "a reaction is written ? a condition -> what changes in this story");
      continue;
    }
    // Stages and consequences: a first line, then lines of their own underneath.
    const stage = section === "stages";
    const start = stage ? line.match(/^after\s+(\d+)\s+days?:\s*(.*)$/i) : line.match(/^\?\s*(.+?),\s*after\s+(\d+)\s+days?:\s*(.*)$/i);
    if (start) {
      item = stage ? { after: Number(start[1]), news: start[2].trim() } : { of: start[1].trim(), after: Number(start[2]), news: start[3].trim() };
      (stage ? clock.stages : (clock.consequences ??= [])).push(item);
      append = (words) => { item.news += ` ${words}`; };
      continue;
    }
    if (!item) {
      problem(n, stage ? "a stage starts with after 18 days: what people hear" : "a consequence starts with ? a condition, after 7 days: what people hear");
      continue;
    }
    const sub = line.match(/^(lead|if|place|fleet|named|ending|big)(?::\s*(.*))?$/i);
    const named = line.match(/^(at|fact)\s+([a-z][a-z0-9_]*):\s*(.*)$/i);
    if (sub) {
      const key = sub[1].toLowerCase();
      const value = (sub[2] ?? "").trim();
      append = null;
      if (key === "big") {
        if (value) problem(n, "big stands alone on its line: it means the news carries to everyone who knows the place");
        item.big = true;
      } else if (key === "lead") {
        item.lead = value;
        append = (words) => { item.lead += ` ${words}`; };
      } else if (key === "if") {
        if (stage) item.if = value;
        else problem(n, "a consequence's condition goes on its first line: ? a condition, after 7 days: ...");
      } else if (key === "place") item.place = value;
      else if (key === "fleet") numbers(n, value, item.fleet ??= {});
      else if (key === "named") {
        const words = value.split(/\s+/);
        if (words.length < 2 || words.length % 2) problem(n, "named is written named: the_ship lost, or gone, then pairs like spared 800 if there's more to it");
        else {
          const who = { id: words[0], status: words[1] };
          for (let i = 2; i < words.length; i += 2) who[words[i]] = /^[+-]?\d+$/.test(words[i + 1]) ? Number(words[i + 1]) : words[i + 1];
          (item.fleet ??= {}).named = who;
        }
      } else if (key === "ending") {
        if (stage) item.ending = value;
        else problem(n, "only a stage can end its story: a consequence leaves facts instead");
      }
      continue;
    }
    if (named) {
      const key = named[1].toLowerCase();
      const name = named[2].toLowerCase();
      append = null;
      if (key === "fact") {
        if (!NAME.test(named[2])) problem(n, `a fact's name is lowercase letters, digits and underscores, not ${named[2]}`);
        (item.facts ??= {})[name] = named[3].trim();
        append = (words) => { item.facts[name] += ` ${words}`; };
      } else {
        const hit = { id: name };
        const found = {};
        numbers(n, named[3], found);
        for (const [what, amount] of Object.entries(found)) {
          if (GOODS.includes(what)) (hit.goods ??= {})[what] = amount;
          else (hit.sides ??= {})[what] = amount;
        }
        (item.places ??= []).push(hit);
      }
      continue;
    }
    if (append) append(line);
    else problem(n, `I don't know a line like that under a ${stage ? "stage" : "consequence"}: it can have lead, if, place, big, at a_place, fleet, named, fact a_name${stage ? " and ending" : ""}`);
  }
  if (!titled) problem(1, "the file is empty: it starts with # The Title");
  return { story, clock, problems };
}

const signed = (amount) => (amount >= 0 ? `+${amount}` : String(amount));

// Writes a story back as its file, from the shape the game uses, the same way every time.
export function writeStoryText(story, clock = { stages: [] }) {
  const gm = story.gm ?? {};
  const out = [`# ${story.title ?? ""}`, `kind: ${story.kind ?? ""}`, `places: ${(story.places ?? []).join(", ")}`, `people: ${(story.people ?? []).join(", ")}`, `factions: ${(story.factions ?? []).join(", ")}`];
  if ((story.minLevel ?? 1) !== 1) out.push(`level: ${story.minLevel}`);
  if (story.after) out.push(`after: ${story.after}`);
  if (clock.waits) out.push(`waits: ${clock.waits}`);
  if (clock.from !== undefined) out.push(`clock from: ${clock.from} days`);
  const section = (key, body) => { out.push("", `${PHRASE_OF[key]}:`, ...body); };
  section("lead", [story.lead ?? ""]);
  if (story.anyone !== undefined) section("anyone", [story.anyone]);
  section("truth", [gm.truth ?? ""]);
  for (const key of LIST_SECTIONS) if (gm[key]?.length) section(key, gm[key].map((one) => `- ${one}`));
  if (gm.outcomes?.length) section("outcomes", gm.outcomes.map((one, i) => (typeof one === "string" ? `ending_${i + 1}: ${one}` : `${one.id}: ${one.text}`)));
  if (gm.facts && Object.keys(gm.facts).length) section("facts", Object.entries(gm.facts).map(([name, line]) => `${name}${gm.factAfter?.[name] ? `, after ${gm.factAfter[name]}` : ""}: ${line}`));
  if (gm.reacts?.length) section("reacts", gm.reacts.map((one) => `? ${one.to} -> ${one.then}`));
  const under = (one) => {
    const lines = [];
    if (one.lead !== undefined) lines.push(`  lead: ${one.lead}`);
    if (one.if) lines.push(`  if: ${one.if}`);
    if (one.place) lines.push(`  place: ${one.place}`);
    if (one.big) lines.push("  big");
    for (const hit of one.places ?? []) lines.push(`  at ${hit.id}: ${[...Object.entries(hit.goods ?? {}), ...Object.entries(hit.sides ?? {})].map(([what, amount]) => `${what} ${signed(amount)}`).join(", ")}`);
    const fleet = Object.entries(one.fleet ?? {}).filter(([key]) => key !== "named");
    if (fleet.length) lines.push(`  fleet: ${fleet.map(([what, amount]) => `${what} ${signed(amount)}`).join(", ")}`);
    if (one.fleet?.named) {
      const { id, status, ...rest } = one.fleet.named;
      lines.push(`  named: ${id} ${status}${Object.entries(rest).map(([key, value]) => ` ${key} ${value}`).join("")}`);
    }
    for (const [name, line] of Object.entries(one.facts ?? {})) lines.push(`  fact ${name}: ${line}`);
    if (one.ending) lines.push(`  ending: ${one.ending}`);
    return lines;
  };
  if (clock.stages?.length) section("stages", clock.stages.flatMap((one) => [`after ${one.after} days: ${one.news}`, ...under(one)]));
  if (clock.consequences?.length) section("consequences", clock.consequences.flatMap((one) => [`? ${one.of}, after ${one.after} days: ${one.news}`, ...under(one)]));
  section("rewards", [gm.rewards ?? ""]);
  return `${out.join("\n")}\n`;
}
