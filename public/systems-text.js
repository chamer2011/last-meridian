// A place's systems as plain text: world/systems/<place>.txt. The file names the place, says who guards it and who
// keeps it running, and has one part for each system (Power, Air, Lights, Doors, Cameras, Alarm, Comms, Engines,
// Navigation, Docking, or any other name for a system of the place's own), with a line for each of its parts and
// the room it's in. The Computers part says which computers run which systems. This only reads and writes the
// words: which rooms and computers they name is worked out by src/systems.js, which knows the maps. It runs in the
// browser too, for the Story board. world/systems/_how-to-write-systems.txt explains the format.

// The systems the game knows what to do with, by the names a file can give them.
export const SYSTEM_NAMES = {
  power: "power", electricity: "power",
  air: "air", "life support": "air",
  lights: "lights", lighting: "lights",
  doors: "doors",
  cameras: "cameras", camera: "cameras",
  alarm: "alarm", alarms: "alarm",
  comms: "comms", communications: "comms",
  engines: "engines", engine: "engines",
  navigation: "navigation",
  docking: "docking",
};
export const KNOWN_SYSTEMS = ["power", "air", "lights", "doors", "cameras", "alarm", "comms", "engines", "navigation", "docking"];
// What each known system is called in a file, the way a new one is written.
export const SYSTEM_TITLES = { power: "Power", air: "Air", lights: "Lights", doors: "Doors", cameras: "Cameras", alarm: "Alarm", comms: "Comms", engines: "Engines", navigation: "Navigation", docking: "Docking" };

export const slugOf = (words) => String(words ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
export const systemIdOf = (name) => SYSTEM_NAMES[String(name ?? "").trim().toLowerCase()] ?? slugOf(name);

// The lines at the top of the file.
export const SYSTEMS_HEADER = [
  { key: "draft", path: "draft", type: "string" },
  { key: "guards", path: "guards", type: "list" },
  { key: "engineers", path: "engineers", type: "list" },
  { key: "alarm rings", path: "numbers.alarm", type: "number", unit: "minutes" },
  { key: "air goes bad", path: "numbers.air", type: "number", unit: "minutes" },
  { key: "repairs take", path: "numbers.repair", type: "number", unit: "hours" },
];

const get = (obj, path) => path.split(".").reduce((holder, key) => (holder == null ? undefined : holder[key]), obj);
function set(obj, path, value) {
  const keys = path.split(".");
  let holder = obj;
  for (const key of keys.slice(0, -1)) holder = holder[key] ??= {};
  holder[keys.at(-1)] = value;
}
const listOf = (words) => String(words ?? "").split(/,|\band\b/).map((one) => one.trim()).filter(Boolean);

// ---- Reading a file ---------------------------------------------------------------------------

// The file into { name, draft, guards, engineers, numbers, systems: [{ name, id, lines: [{ text, line }] }],
// computers: [{ text, line }] }, with every line kept as words for src/systems.js to make sense of.
export function parseSystemsText(text, id = "it") {
  const problems = [];
  const problem = (line, message) => problems.push({ line, message });
  // guards and engineers stay unset unless the file names them, so the place's people are found by what they do.
  const value = { name: id, numbers: {}, systems: [], computers: [] };
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const header = new Map(SYSTEMS_HEADER.map((field) => [field.key, field]));
  let titled = false;
  let section = null;
  for (const [index, raw] of lines.entries()) {
    const n = index + 1;
    const line = raw.trim();
    if (!line) continue;
    if (!titled) {
      titled = true;
      const title = line.match(/^#\s*(.+)$/);
      if (title) {
        value.name = title[1].trim();
        continue;
      }
      problem(n, "the first line is the place's name, written # The Name");
    }
    const heading = line.match(/^([A-Za-z][A-Za-z '-]{0,40}):$/);
    if (heading) {
      const name = heading[1].trim();
      if (name.toLowerCase() === "computers") {
        if (section === "computers") problem(n, "\"Computers\" is written twice");
        section = "computers";
        continue;
      }
      const sid = systemIdOf(name);
      if (!sid) {
        problem(n, `"${name}" isn't a name a system can have`);
        continue;
      }
      if (value.systems.some((one) => one.id === sid)) problem(n, `"${name}" is written twice`);
      section = { name, id: sid, lines: [] };
      value.systems.push(section);
      continue;
    }
    const field = line.match(/^([a-z][a-z ]{0,30}):\s*(.*)$/i);
    if (section === null) {
      const known = field && header.get(field[1].trim().toLowerCase());
      if (!known) {
        problem(n, `before the first system, each line is one of ${SYSTEMS_HEADER.map((one) => one.key).join(", ")}, then a colon and its value`);
        continue;
      }
      const words = field[2].trim();
      if (known.type === "list") set(value, known.path, /^(none|nobody)$/i.test(words) ? [] : listOf(words));
      else if (known.type === "number") {
        const amount = words.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/i);
        if (!amount) problem(n, `${known.key} is a number of ${known.unit}, such as ${known.key}: ${known.unit === "hours" ? 3 : 30}`);
        else set(value, known.path, Number(amount[1]));
      } else set(value, known.path, words);
      continue;
    }
    const entry = line.match(/^-\s+(.+)$/);
    if (!entry) {
      problem(n, `under each system, each line starts with - and a space, such as - vent in every room`);
      continue;
    }
    if (section === "computers") value.computers.push({ text: entry[1].trim(), line: n });
    else section.lines.push({ text: entry[1].trim(), line: n });
  }
  if (!titled) problem(1, "the file is empty: it starts with # The Name");
  return { value, problems };
}

// ---- The words of one line --------------------------------------------------------------------

// "junction box in The Docks for The Docks, The Hook: A grey box with a hazard stripe." The part, the room or rooms it's
// in ("every room" for all of them), for a power part the rooms it powers, and after a colon how it looks.
export function readPartLine(text) {
  const [head, ...rest] = String(text).split(":");
  const look = rest.join(":").trim() || null;
  const words = head.trim();
  const at = words.search(/\s+in\s+/i);
  if (at < 0) return { problem: `"${text}" needs to say where it is: the part, then in, then the room, such as vent in every room` };
  const part = words.slice(0, at).trim().replace(/^(an?|the)\s+/i, "");
  let where = words.slice(at).replace(/^\s+in\s+/i, "").trim();
  let feeds = null;
  const forAt = where.search(/\s+for\s+/i);
  if (forAt >= 0) {
    feeds = listOf(where.slice(forAt).replace(/^\s+for\s+/i, ""));
    where = where.slice(0, forAt).trim();
  }
  if (!part) return { problem: `"${text}" needs the part's name before in` };
  const every = /^(every|each|all)\s+rooms?$/i.test(where);
  return { part, every, rooms: every ? [] : listOf(where), feeds, look };
}

// "the door to The Hook" in Doors, and "locks the door to The Hook, The Bar" in Alarm.
export function readDoorLine(text) {
  const [head, ...rest] = String(text).split(":");
  const look = rest.join(":").trim() || null;
  const found = head.trim().match(/^(?:the\s+)?doors?\s+(?:to|into)\s+(.+)$/i);
  if (!found) return { problem: `"${text}" is written door to and the room it leads into, such as door to The Hook` };
  return { rooms: listOf(found[1]), look };
}
export function readLocksLine(text) {
  const found = String(text).trim().match(/^locks?\s+(?:the\s+)?doors?\s+(?:to|into)\s+(.+)$/i);
  return found ? { rooms: listOf(found[1]) } : null;
}

// "haven_berth_board: cameras, alarm", "the plot table: navigation, doors in The Bridge", "a watch console in The
// Consulate Row: cameras, alarm, class hard". The computer, the systems it runs (or everything), the rooms it runs
// them in if not all of them, and for a console the game puts there, its class.
export function readComputerLine(text) {
  const colon = String(text).indexOf(":");
  if (colon < 0) return { problem: `"${text}" is written the computer, a colon, and the systems it runs, such as haven_berth_board: cameras, alarm` };
  const ref = text.slice(0, colon).trim();
  let what = text.slice(colon + 1).trim();
  let classKey = null;
  what = what.replace(/,?\s*class\s+([a-z _]+)$/i, (_, word) => {
    classKey = word.trim().toLowerCase().replace(/\s+/g, "_");
    return "";
  }).trim();
  let rooms = null;
  const inAt = what.search(/\s+in\s+/i);
  if (inAt >= 0) {
    rooms = listOf(what.slice(inAt).replace(/^\s+in\s+/i, ""));
    what = what.slice(0, inAt).trim();
  }
  const systems = listOf(what).map((one) => (/^(everything|all)$/i.test(one) ? "everything" : systemIdOf(one)));
  if (!ref) return { problem: `"${text}" needs the computer before the colon` };
  if (!systems.length) return { problem: `"${text}" needs the systems it runs after the colon, or everything` };
  // "a watch console in The Watch Room" puts a new console there; anything else is a computer or a thing already there.
  const placed = ref.match(/^(.+?)\s+in\s+(.+)$/i);
  return { ref: placed ? placed[1].trim() : ref, room: placed ? placed[2].trim() : null, systems, rooms, classKey };
}

// ---- Writing a file ----------------------------------------------------------------------------
export function writeSystemsText(value) {
  const out = [`# ${value.name ?? ""}`];
  for (const field of SYSTEMS_HEADER) {
    const one = get(value, field.path);
    if (one === undefined || one === null) continue;
    if (field.type === "list") out.push(`${field.key}: ${one.length ? one.join(", ") : "none"}`);
    else out.push(`${field.key}: ${one}`);
  }
  for (const system of value.systems ?? []) {
    out.push("", `${system.name}:`, ...system.lines.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  }
  if (value.computers?.length) out.push("", "Computers:", ...value.computers.map((one) => `- ${typeof one === "string" ? one : one.text}`));
  return `${out.join("\n")}\n`;
}
