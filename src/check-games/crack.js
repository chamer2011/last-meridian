// Hacking: a console session against a server. The password is hidden among the words in a
// memory dump. Trying a word tells you how many letters match. Wrong tries raise the trace, and
// if the trace completes, you've been caught. What you do here decides it, with no roll on top:
// crack every password and you're in, let the trace complete and you're caught, or disconnect.
// How important the computer is sets the whole session: the password's length, the size of the
// dump, how many wrong tries the trace allows, the decoys that look nearly right, and how many
// passwords stand between you and the inside. Training adds tries and tools, and the advisor's
// hints grow with it.

import { bar, between, closest, command, fill, link, meter, panel, pick, randomInt, say, shuffle, tone } from "./kit.js";

// What each class of computer is like, unless world/checks.json says otherwise. The keys are the
// difficulty words a scene or the game master uses.
const DEFAULT_CLASSES = {
  easy: { name: "Door panel", length: 5, words: 8, tries: 4, decoys: 0, layers: 1, mark: false },
  moderate: { name: "Crew terminal", length: 6, words: 12, tries: 4, decoys: 2, layers: 1, mark: false },
  hard: { name: "Ship's main system", length: 7, words: 14, tries: 3, decoys: 3, layers: 2, mark: true },
  very_hard: { name: "Ministry or Navy server", length: 8, words: 16, tries: 3, decoys: 4, layers: 2, mark: true },
  nearly_impossible: { name: "The Beacon or the Choir", length: 9, words: 16, tries: 3, decoys: 5, layers: 3, mark: true },
};
// What training adds, from untrained to master.
const DEFAULT_TRAINING = { extraTries: [0, 1, 2, 3, 3], freeProbes: [0, 0, 1, 1, 2], probeClears: [1, 1, 2, 2, 3] };
const DEFAULT_LAYERS = ["the account", "root", "the vault"];
// The advisor's hints by training, when the world's file has none. Each level adds its own lines to the ones below.
const DEFAULT_HINTS = {
  0: ["The server says how many letters of your word are right, and in the right place. Start with a word that shares letters with many others.", "Reading a file can cost a try: the useful ones are watched."],
  1: ["{count} of the words still fit everything the server has said."],
  2: ["{possible}", "notes.txt and passwd.bak are safe for you to open: one gives the first letter, the other retires two wrong words."],
  3: ["Try {best} next. Whatever the answer is, its likeness rules out the most.", "A probe clears {clears} wrong words, and you have {probes} free."],
  4: ["{left} wrong tries left before the trace completes.", "Layer {layer} of {layers}: {layerName}."],
};

export const classOf = (text, difficulty) => ({ ...(DEFAULT_CLASSES[difficulty] ?? DEFAULT_CLASSES.moderate), ...(text?.classes?.[difficulty] ?? {}) });
const trainingOf = (text) => ({ ...DEFAULT_TRAINING, ...(text?.training ?? {}) });
// Every class, in order from the least important computer to the most, for a practice picker.
export const allClasses = (text) => Object.keys(DEFAULT_CLASSES).map((difficulty) => ({ difficulty, ...classOf(text, difficulty) }));

const likeness = (a, b) => [...a].filter((letter, i) => b[i] === letter).length;

// Words that share letters with the answer make the clues worth something, and the decoys are the
// ones that share nearly all of them.
function chooseWords(words, count, decoys) {
  const list = shuffle(words);
  const answer = list[0];
  const rest = list.slice(1).map((word) => ({ word, alike: likeness(word, answer), noise: Math.random() }));
  rest.sort((a, b) => b.alike - a.alike || a.noise - b.noise);
  const nearMisses = rest.filter((entry) => entry.alike >= answer.length - 2).slice(0, decoys);
  const left = rest.filter((entry) => !nearMisses.includes(entry));
  const helpful = Math.ceil(Math.max(0, count - 1 - nearMisses.length) * 0.7);
  const chosen = [...nearMisses, ...left.slice(0, helpful), ...shuffle(left.slice(helpful))].slice(0, count - 1);
  return { answer, words: shuffle([answer, ...chosen.map((entry) => entry.word)]) };
}

const NOISE = "#$%&*+=!?/<>~^";
const noise = (length) => Array.from({ length }, () => NOISE[randomInt(NOISE.length)]).join("");
const hex = (n, digits = 4) => n.toString(16).toUpperCase().padStart(digits, "0");

// Words the clues so far have ruled out.
const possible = (state) => state.words.filter((word) => !state.removed.includes(word)
  && state.tries.every((attempt) => attempt.word !== word && likeness(attempt.word, word) === attempt.score));
const untried = (state) => state.words.filter((word) => !state.removed.includes(word) && !state.tries.some((attempt) => attempt.word === word));
const layerName = (state, layer = state.layer) => state.layerNames[layer - 1] ?? `layer ${layer}`;

// A fresh password and dump, for the first layer or the next one. The trace carries over.
function dealLayer(state, ctx) {
  const pool = ctx.text.words?.[state.length] ?? [];
  const { answer, words } = chooseWords(pool, state.count, state.decoys);
  Object.assign(state, {
    answer,
    words,
    removed: [],
    tries: [],
    revealed: [],
    opened: [],
    lines: words.map(() => ({ before: noise(between(1, 6)), after: noise(between(1, 6)) })),
    base: 0x1000 + randomInt(0xd000),
  });
}

// What's lying around on the server. Opening the useful ones risks being noticed, unless you know how.
const FILES = [
  { name: "notes.txt", watched: true, open: (state, ctx) => {
    const letter = state.answer[0];
    if (!state.revealed.includes(0)) state.revealed.push(0);
    return [say(fill(pick(ctx.text.noteLines ?? ["Reminder: the password starts with {letter}."]), { letter }), "good")];
  } },
  { name: "passwd.bak", watched: true, open: (state, ctx, first) => {
    if (!first) return [say("You've been through this backup already. There's nothing more in it.", "dim")];
    const duds = shuffle(state.words.filter((word) => word !== state.answer && !state.removed.includes(word) && !state.tries.some((attempt) => attempt.word === word))).slice(0, 2);
    state.removed.push(...duds);
    return [say(duds.length ? `An old backup. Two of these were retired long ago: ${duds.join(", ")}.` : "An old backup. Nothing in it you don't already know.", "info")];
  } },
  { name: "trace.log", open: (state) => [say(`tracer.exe: hunting for you. ${Math.round((state.trace / state.maxTrace) * 100)}% of the way there.`, "warn")] },
  { name: "motd", open: (state, ctx) => [say(pick(ctx.text.motd ?? ["Welcome. All sessions are monitored."]), "dim")] },
];

function runShell(state, ctx, verb, rest) {
  switch (verb) {
    case "ls": case "dir":
      return [say(state.files.join("   "), "info")];
    case "cat": case "type": case "open": case "read": case "more": case "less": {
      const name = closest(rest.join(""), state.files);
      const file = FILES.find((entry) => entry.name === name);
      if (!file) return [say(`cat: ${rest.join(" ") || "which file"}: no such file. Try ls.`, "dim")];
      const first = !state.opened.includes(name);
      if (first) state.opened.push(name);
      const lines = file.open(state, ctx, first);
      if (file.watched && first && ctx.tier < 2) {
        state.trace += 1;
        lines.push(say("That file was being watched. The trace jumps.", "warn"), ...afterTrace(state));
      }
      return lines;
    }
    case "whoami":
      return [say(`${state.user} (not actually you)`, "dim")];
    case "id":
      return [say(`uid=1001(${state.user}) gid=100(users) groups=100(users)`, "dim")];
    case "ps": case "top":
      return [say(`  PID TTY     CMD\n  101 ?       sshd\n  244 ?       tracer.exe  <- that's looking for you\n  512 pts/0   shell`, "dim")];
    case "kill": case "pkill": case "taskkill":
      return state.spoofs > 0 ? null : [say("Permission denied. It's the one process you can't touch from here.", "bad")];
    case "sudo": case "su":
      return [say(`${state.user} is not in the sudoers file. This incident will be reported.`, "warn")];
    case "ping":
      return [say(`64 bytes from ${state.ip}: time=${between(3, 40)} ms`, "dim")];
    case "uname": case "ver":
      return [say(`MERIDIAN-COMPATIBLE NODE #${state.node}, CONCORD BUILD. Nobody's patched it since the Fall.`, "dim")];
    case "cd": case "pwd":
      return [say("/home/" + state.user, "dim")];
    case "rm": case "del":
      return [say("Tempting, but deleting things gets noticed.", "dim")];
    default:
      return undefined;
  }
}

// The word whose likeness would rule out the most, whatever the answer turns out to be. A word that
// could itself be the answer is worth a little more than one that can't.
function bestSplit(options, stillPossible) {
  let best = null;
  let bestScore = Infinity;
  for (const word of options) {
    const buckets = new Map();
    for (const other of stillPossible) {
      if (other === word) continue;
      const key = likeness(word, other);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const score = Math.max(0, ...buckets.values()) - (stillPossible.includes(word) ? 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = word;
    }
  }
  return best;
}

// What the advisor says, by training. The words come from world/checks.json, with the blanks filled in here.
function hintsFor(state, ctx) {
  if (state.done) return [];
  const texts = ctx.text.hints ?? DEFAULT_HINTS;
  const left = possible(state);
  const options = untried(state);
  const values = {
    count: left.length,
    possible: left.length <= 10 ? `Still possible: ${left.join(", ")}.` : `${left.length} words still fit, and the dump dims the ones that can't be it.`,
    best: bestSplit(options.length ? options : left, left) ?? "any word",
    left: Math.max(0, state.maxTrace - state.trace),
    trace: Math.round((state.trace / state.maxTrace) * 100),
    probes: state.freeProbes,
    clears: state.probeClears,
    layer: state.layer,
    layers: state.layers,
    layerName: layerName(state),
    className: state.className,
  };
  const lines = [];
  for (let tier = 0; tier <= ctx.tier; tier += 1) {
    for (const line of texts[tier] ?? texts[String(tier)] ?? []) lines.push(fill(line, values));
  }
  return lines;
}

export default {
  // What happens here decides the check: there's no roll at the end.
  decided: true,

  start(ctx) {
    const cls = classOf(ctx.text, ctx.difficulty);
    const training = trainingOf(ctx.text);
    const state = {
      classKey: ctx.difficulty,
      className: cls.name,
      mark: Boolean(cls.mark),
      length: cls.length,
      count: cls.words,
      decoys: cls.decoys,
      layers: Math.max(1, cls.layers),
      layer: 1,
      layerNames: ctx.text.layerNames ?? DEFAULT_LAYERS,
      trace: 0,
      maxTrace: cls.tries + (training.extraTries[ctx.tier] ?? 0),
      freeProbes: training.freeProbes[ctx.tier] ?? 0,
      probeClears: Math.max(1, training.probeClears[ctx.tier] ?? 1),
      spoofs: ctx.tier >= 3 || ctx.hasGear("lockbreaker") || ctx.hasGear("slicer_rig") ? 1 : 0,
      cracked: false,
      quit: false,
      ip: `${between(10, 240)}.${between(0, 255)}.${between(0, 255)}.${between(1, 254)}`,
      node: between(1, 9),
      user: pick(ctx.text.users ?? ["admin"]),
      code: 3,
      files: FILES.map((file) => file.name),
      done: false,
      forced: false,
    };
    dealLayer(state, ctx);
    return state;
  },

  intro(state) {
    const between = state.layers > 1 ? `${state.layers} passwords between you and the inside` : "one password between you and the inside";
    return [
      say(`Connecting to node #${state.node} at ${state.ip} ...`, "dim"),
      say(`${state.className}: ${between}. The trace allows ${state.maxTrace} wrong tries.`, "info"),
      say(`Login: ${state.user}`, "dim"),
      say("Password required. Memory dump captured.", "info"),
      say("Try a word from the dump. The server says how many letters are right, and in the right place. Poke around if you like: ls, cat, ps, or click what you see.", "info"),
    ];
  },

  view(state, ctx) {
    const ruledOut = ctx.tier >= 2 ? new Set(state.words.filter((word) => !possible(state).includes(word))) : new Set();
    const dump = state.words.map((word, i) => {
      const gone = state.removed.includes(word);
      const tried = state.tries.some((attempt) => attempt.word === word);
      const { before, after } = state.lines[i];
      const address = `0x${hex(state.base + i * 16)}  `;
      if (gone) return [tone(`${address}${before}${".".repeat(word.length)}${after}`, "dim")];
      return [tone(address, "dim"), tone(before, "dim"),
        tried || state.done ? tone(word, tried ? "bad" : "dim")
          : link(word, `try ${word}`, ruledOut.has(word) ? "dim" : "link", ruledOut.has(word) ? "The clues so far rule this one out." : `Try ${word}`),
        tone(after, "dim")];
    });
    const mask = [...state.answer].map((letter, i) => (state.cracked || state.revealed.includes(i) ? letter : "*")).join("");
    const trying = state.tries.length
      ? state.tries.map((attempt) => [tone(`${attempt.word.padEnd(state.answer.length + 2)}`, attempt.word === state.answer ? "good" : "bad"), tone(`likeness ${attempt.score}/${state.answer.length}`, attempt.word === state.answer ? "good" : "info")])
      : [[tone("No attempts yet.", "dim")]];
    const consoles = ctx.text.consoles ?? {};
    const code = (ctx.text.code ?? []).slice(0, state.code);
    const standing = state.cracked ? "ACCESS GRANTED" : state.quit ? "DISCONNECTED" : state.trace >= state.maxTrace ? "TRACED" : "ACCESS DENIED";
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Programming Console", [], { terminal: true }),
        panel("server", `Server #${state.node} - IP ${state.ip}`, [
          [tone(standing, state.cracked ? "good" : "bad")],
          [tone(`class Target:  # ${state.className}`, "info")],
          ...(state.layers > 1 ? [[tone(`  layer ${state.layer} of ${state.layers}: ${layerName(state)}`, "warn")]] : []),
          [tone("  Attributes:", "dim")],
          [tone(`  - server_address: ${state.ip}`, "dim")],
          [tone(`  - username: ${state.user}`, "dim")],
          [tone("  - password: ", "dim"), tone(mask, state.cracked ? "good" : "warn")],
          state.done ? [tone(" ", "dim")] : [tone("files: ", "dim"), ...state.files.flatMap((name) => [link(name, `cat ${name}`, state.opened.includes(name) ? "dim" : "link", `Read ${name}`), tone(" ", "dim")])],
        ], { grid: true }),
        panel("dump", consoles.dump ?? "Coding Console", dump, { grid: true }),
        panel("decode", consoles.decode ?? "Decoding Console", [
          ...trying,
          ...(code.length ? [[tone(" ", "dim")], ...code.map((line) => [tone(line, "dim")])] : []),
        ], { grid: true }),
      ],
      commands: state.done ? [] : [
        command("probe", "probe", state.freeProbes > 0 ? `clear out wrong words (${state.freeProbes} free)` : "clear out wrong words, +1 trace"),
        ...(state.spoofs > 0 ? [command("spoof", "spoof", "bounce the trace off a dead relay")] : []),
        command("ls", "ls", "see what's on the server"),
        command("ps", "ps", "see what's running"),
        command("disconnect", "disconnect", "give up, before the trace completes"),
      ],
      meters: [
        meter("TRACE", state.trace, state.maxTrace, state.trace >= state.maxTrace - 1 ? "bad" : "warn", `${bar(state.trace, state.maxTrace, 8)} ${Math.round((state.trace / state.maxTrace) * 100)}%`),
        ...(state.layers > 1 ? [meter("LAYER", state.layer, state.layers, "info", `${state.layer}/${state.layers}`)] : []),
      ],
      hints: hintsFor(state, ctx),
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The session's over.", "dim")];
    const [verb, ...rest] = words;
    if (["disconnect", "exit", "logout", "quit", "hangup", "bail"].includes(verb)) {
      state.quit = true;
      state.done = true;
      state.forced = true;
      return [say("You cut the connection before the trace completes. Nothing gained, and nobody the wiser.", "dim")];
    }
    const shell = runShell(state, ctx, verb, rest);
    if (shell) return shell;
    if (verb === "probe" || verb === "scan" || verb === "nmap") {
      const cost = state.freeProbes > 0 ? 0 : 1;
      if (state.freeProbes > 0) state.freeProbes -= 1;
      const duds = shuffle(state.words.filter((word) => word !== state.answer && !state.removed.includes(word) && !state.tries.some((attempt) => attempt.word === word)));
      const taken = duds.slice(0, state.probeClears);
      if (!taken.length) return [say("Nothing left to clear out.", "dim")];
      state.removed.push(...taken);
      state.trace += cost;
      state.code += 1;
      return [say(`Probe clears out: ${taken.join(", ")}.${cost ? " The trace climbs." : ""}`, "info"), ...afterTrace(state)];
    }
    if (verb === "spoof" || verb === "kill" || verb === "pkill" || verb === "taskkill") {
      if (state.spoofs <= 0) return [say("You've got nothing left to spoof with.", "bad")];
      state.spoofs -= 1;
      state.trace = Math.max(0, state.trace - 2);
      return [say("The trace chases a ghost through a dead relay. You've bought a little time.", "good")];
    }
    if (verb === "dump" || verb === "hexdump") return [say("The dump's on your screen. Click a word, or type it.", "dim")];
    const typed = verb === "try" || verb === "login" || verb === "crack" ? rest.join("") : words.join("");
    const word = closest(typed, state.words.filter((entry) => !state.removed.includes(entry)));
    if (!word) return verb === "try" ? [say(`${typed || "That"} isn't in the dump.`, "bad")] : null;
    if (state.tries.some((attempt) => attempt.word === word)) return [say(`You've already tried ${word}.`, "dim")];
    const score = likeness(word, state.answer);
    state.tries.push({ word, score });
    state.code += 1;
    if (word === state.answer) {
      const opened = layerName(state);
      if (state.layer < state.layers) {
        state.layer += 1;
        dealLayer(state, ctx);
        return [say(`login ${state.user} / ${word}`, "dim"), say(`ACCESS GRANTED to ${opened}.`, "good"), say(`${layerName(state)[0].toUpperCase()}${layerName(state).slice(1)} wants a password of its own. New memory dump captured, and the trace keeps counting.`, "info")];
      }
      state.cracked = true;
      state.done = true;
      state.forced = true;
      return [say(`login ${state.user} / ${word}`, "dim"), say("ACCESS GRANTED", "good"), say("You're in.", "good")];
    }
    state.trace += 1;
    const lines = [say(`${word}: ACCESS DENIED. Likeness ${score}/${state.answer.length}.`, "bad")];
    if (ctx.tier >= 3) {
      const hidden = [...state.answer].map((_, i) => i).filter((i) => !state.revealed.includes(i));
      if (hidden.length > 1) {
        const index = pick(hidden);
        state.revealed.push(index);
        lines.push(say(`Your tools pull a letter out of the hash: position ${index + 1} is ${state.answer[index]}.`, "info"));
      }
    }
    return [...lines, ...afterTrace(state)];
  },

  // Only for a check that goes straight to the roll, where the player's work still counts a little.
  edge(state) {
    if (state.cracked) return 4 + (state.trace <= state.maxTrace / 2 ? 2 : state.trace < state.maxTrace - 1 ? 1 : 0);
    if (state.quit) return -2;
    if (state.trace >= state.maxTrace) return -3;
    const left = possible(state).length;
    return left <= 2 ? 2 : left <= state.words.length / 2 ? 1 : 0;
  },

  story(state) {
    const pct = Math.round((state.trace / state.maxTrace) * 100);
    if (state.cracked) return `They cracked ${state.layers > 1 ? `all ${state.layers} passwords` : "the password"} with the trace at ${pct}%, so nobody knows they were there yet.`;
    if (state.quit) return `They disconnected before the trace completed, with nothing to show for it, and nobody the wiser.`;
    if (state.trace >= state.maxTrace) return "The trace caught up with them before they got in, so someone knows there was an intruder.";
    return "They ran their exploit without ever finding the password, hoping it would be enough.";
  },
};

function afterTrace(state) {
  if (state.trace < state.maxTrace) return state.trace === state.maxTrace - 1 ? [say("WARNING: trace nearly complete.", "warn")] : [];
  state.done = true;
  state.forced = true;
  return [say("TRACE COMPLETE. They've found you. The connection drops, and somewhere a log has your name in it.", "bad")];
}
