// Hacking: a console session against a server. The password is hidden among the words in a
// memory dump. Trying a word tells you how many letters match. Wrong tries raise the trace,
// and if the trace completes, you've been caught.

import { bar, between, closest, command, fill, link, meter, panel, pick, randomInt, say, shuffle, tone } from "./kit.js";

const LENGTHS = [5, 6, 7, 8, 9];
const COUNTS = [8, 10, 12, 14, 16];
// How many wrong tries the trace allows, by training.
const TRACE = [3, 4, 5, 6, 6];

const likeness = (a, b) => [...a].filter((letter, i) => b[i] === letter).length;

// Words that share letters with the answer make the clues worth something.
function chooseWords(words, count) {
  const list = shuffle(words);
  const answer = list[0];
  const others = list.slice(1).map((word) => ({ word, score: likeness(word, answer) + Math.random() }));
  others.sort((a, b) => b.score - a.score);
  const chosen = [...others.slice(0, Math.ceil((count - 1) * 0.7)), ...shuffle(others.slice(Math.ceil((count - 1) * 0.7))).slice(0, count)];
  return { answer, words: shuffle([answer, ...chosen.slice(0, count - 1).map((entry) => entry.word)]) };
}

const NOISE = "#$%&*+=!?/<>~^";
const noise = (length) => Array.from({ length }, () => NOISE[randomInt(NOISE.length)]).join("");
const hex = (n, digits = 4) => n.toString(16).toUpperCase().padStart(digits, "0");

// Words the clues so far have ruled out.
const possible = (state) => state.words.filter((word) => !state.removed.includes(word)
  && state.tries.every((attempt) => attempt.word !== word && likeness(attempt.word, word) === attempt.score));

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
    case "exit": case "logout": case "quit":
      return [say("You can't back out now. Execute when you're ready, and take what you've got.", "dim")];
    case "rm": case "del":
      return [say("Tempting, but deleting things gets noticed.", "dim")];
    default:
      return undefined;
  }
}

export default {
  start(ctx) {
    const length = LENGTHS[ctx.level];
    const pool = ctx.text.words?.[length] ?? [];
    const { answer, words } = chooseWords(pool, COUNTS[ctx.level]);
    const base = 0x1000 + randomInt(0xd000);
    return {
      answer,
      words,
      removed: [],
      tries: [],
      lines: words.map(() => ({ before: noise(between(1, 6)), after: noise(between(1, 6)) })),
      base,
      revealed: [],
      trace: 0,
      maxTrace: TRACE[ctx.tier],
      freeProbes: ctx.tier >= 4 ? 2 : ctx.tier >= 2 ? 1 : 0,
      spoofs: ctx.tier >= 3 || ctx.hasGear("lockbreaker") || ctx.hasGear("slicer_rig") ? 1 : 0,
      cracked: false,
      ip: `${between(10, 240)}.${between(0, 255)}.${between(0, 255)}.${between(1, 254)}`,
      node: between(1, 9),
      user: pick(ctx.text.users ?? ["admin"]),
      code: 3,
      files: FILES.map((file) => file.name),
      opened: [],
      done: false,
      forced: false,
    };
  },

  intro(state) {
    return [
      say(`Connecting to node #${state.node} at ${state.ip} ...`, "dim"),
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
    return {
      panels: [
        panel("terminal", consoles.terminal ?? "Programming Console", [], { terminal: true }),
        panel("server", `Server #${state.node} - IP ${state.ip}`, [
          [tone(state.cracked ? "ACCESS GRANTED" : "ACCESS DENIED", state.cracked ? "good" : "bad")],
          [tone("class Target:", "info")],
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
      ],
      meters: [meter("TRACE", state.trace, state.maxTrace, state.trace >= state.maxTrace - 1 ? "bad" : "warn", `${bar(state.trace, state.maxTrace, 8)} ${Math.round((state.trace / state.maxTrace) * 100)}%`)],
    };
  },

  act(state, ctx, words) {
    if (state.done) return [say("The session's over. All that's left is to run it.", "dim")];
    const [verb, ...rest] = words;
    const shell = runShell(state, ctx, verb, rest);
    if (shell) return shell;
    if (verb === "probe" || verb === "scan" || verb === "nmap") {
      const cost = state.freeProbes > 0 ? 0 : 1;
      if (state.freeProbes > 0) state.freeProbes -= 1;
      const duds = shuffle(state.words.filter((word) => word !== state.answer && !state.removed.includes(word) && !state.tries.some((attempt) => attempt.word === word)));
      const taken = duds.slice(0, 1 + Math.floor(ctx.tier / 2));
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
      state.cracked = true;
      state.done = true;
      return [say(`login ${state.user} / ${word}`, "dim"), say("ACCESS GRANTED", "good"), say("You're in. Run it when you're ready.", "good")];
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

  edge(state, ctx) {
    if (state.cracked) return 4 + (state.trace <= state.maxTrace / 2 ? 2 : state.trace < state.maxTrace - 1 ? 1 : 0);
    if (state.trace >= state.maxTrace) return -3;
    const left = possible(state).length;
    return left <= 2 ? 2 : left <= state.words.length / 2 ? 1 : 0;
  },

  story(state) {
    if (state.cracked) return `They cracked the password with the trace at ${Math.round((state.trace / state.maxTrace) * 100)}%, so nobody knows they were there yet.`;
    if (state.trace >= state.maxTrace) return "The trace caught up with them before they got in, so someone knows there was an intruder.";
    return "They ran their exploit without ever finding the password, hoping it would be enough.";
  },
};

function afterTrace(state) {
  if (state.trace < state.maxTrace) return state.trace === state.maxTrace - 1 ? [say("WARNING: trace nearly complete.", "warn")] : [];
  state.done = true;
  state.forced = true;
  return [say("TRACE COMPLETE. They've found you. You yank the connection and take what you've got.", "bad")];
}
