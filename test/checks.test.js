// The skill check windows: every skill has one, none of them can get stuck or give the answer
// away, a player who plays well does better than one who doesn't, and training makes it easier.

import assert from "node:assert/strict";
import { test } from "node:test";
import { SKILLS } from "../src/character-data.js";
import { CHECK_GAMES, MAX_EDGE, MIN_EDGE, checkCommand, checkView, hackingClasses, startCheck, tierFor } from "../src/checks.js";
import { createGameFromDraft, randomDraft } from "../src/creator.js";
import { migrateGame } from "../src/migrate.js";
import { readRecord } from "../src/record.js";
import { DIFFICULTY, oddsFor, publicState, skillRank } from "../src/rules.js";
import { CHECK_TEXT } from "../src/world.js";

// What ends a window that's still open: a roll, or for a decided game, giving up.
const giveUp = (game) => checkCommand(game, game.check.decided ? "disconnect" : "run");

const newGame = (seed = 21, archetype = "officer") => createGameFromDraft(randomDraft({ seed, archetype }));
const DIFFICULTIES = Object.keys(DIFFICULTY);

const open = (game, skill, difficulty = "moderate", extra = {}) => startCheck(game, { skill, difficulty, reason: "A test", source: "practice", ...extra });

function trained(skill, rank) {
  const game = newGame();
  game.skills[skill] = rank;
  game.perks = [];
  game.traits = [];
  game.inventory = {};
  game.equipped = { weapon: null, armor: null };
  game.ideology = { authority: 0, loyalty: 0, violence: 0, belief: 0, flesh: 0 };
  return game;
}

// Everything the window offers to click right now.
function clickable(view) {
  const found = view.commands.filter((entry) => !entry.disabled).map((entry) => entry.command);
  for (const panel of view.panels) {
    for (const line of panel.lines) {
      for (const piece of Array.isArray(line) ? line : [line]) if (piece?.cmd) found.push(piece.cmd);
    }
  }
  return found;
}

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// Plays by clicking at random until there's nothing left to do, then makes the roll.
function playRandomly(game) {
  for (let step = 0; step < 500; step += 1) {
    if (!game.check) return step;
    const options = clickable(checkView(game));
    if (!options.length) break;
    const reply = checkCommand(game, pickOne(options));
    if (reply.over) return step;
  }
  if (game.check) giveUp(game);
  return null;
}

test("every skill has its own window, with what its game needs", () => {
  for (const skill of Object.keys(SKILLS)) {
    const text = CHECK_TEXT.skills[skill];
    assert.ok(text, `${skill} has no window`);
    assert.ok(CHECK_GAMES[text.game], `${skill} uses a game that doesn't exist: ${text.game}`);
    for (const field of ["window", "theme", "runLabel", "prompt", "help"]) assert.ok(text[field], `${skill} needs ${field}`);
    assert.ok(text.results?.success && text.results?.failure, `${skill} needs its result titles`);
    assert.ok(text.consoles?.terminal, `${skill} needs a console`);
  }
  const titles = Object.values(CHECK_TEXT.skills).map((text) => text.window);
  assert.equal(new Set(titles).size, titles.length, "two skills share a window title");
});

test("the hacking word lists are the right length, with no repeats", () => {
  const { words } = CHECK_TEXT.skills.hacking;
  for (const [length, list] of Object.entries(words)) {
    assert.ok(list.length >= 20, `only ${list.length} words of length ${length}`);
    assert.equal(new Set(list).size, list.length, `repeats in length ${length}`);
    for (const word of list) {
      assert.equal(word.length, Number(length), word);
      assert.match(word, /^[A-Z]+$/, word);
    }
  }
});

test("any way of clicking through any window finishes, at any difficulty and any level of training", () => {
  for (const skill of Object.keys(SKILLS)) {
    for (const difficulty of DIFFICULTIES) {
      for (const rank of [0, 2, 5, 10]) {
        const game = trained(skill, rank);
        open(game, skill, difficulty);
        JSON.stringify(game.check);
        const view = checkView(game);
        assert.ok(view.panels.some((panel) => panel.terminal), `${skill} needs a console`);
        playRandomly(game);
        assert.equal(game.check, null, `${skill} ${difficulty} rank ${rank} didn't finish`);
      }
    }
  }
});

test("each window's state survives being saved, in the middle of a check", () => {
  for (const skill of Object.keys(SKILLS)) {
    const game = newGame();
    open(game, skill, "hard");
    const options = clickable(checkView(game));
    if (options.length) checkCommand(game, options[0]);
    if (!game.check) continue;
    const loaded = JSON.parse(JSON.stringify(game));
    assert.deepEqual(loaded.check, JSON.parse(JSON.stringify(game.check)));
    const more = clickable(checkView(loaded));
    if (more.length) checkCommand(loaded, more[0]);
    if (loaded.check) giveUp(loaded);
    assert.equal(loaded.check, null);
  }
});

test("what the player earns stays within bounds, and the odds shown match the final roll", () => {
  for (const skill of Object.keys(SKILLS)) {
    for (let i = 0; i < 12; i += 1) {
      const game = trained(skill, i % 8);
      open(game, skill, DIFFICULTIES[i % DIFFICULTIES.length]);
      for (let step = 0; step < 300 && game.check; step += 1) {
        const view = checkView(game);
        assert.ok(view.edge >= MIN_EDGE && view.edge <= MAX_EDGE, `${skill} edge ${view.edge}`);
        assert.equal(view.odds, oddsFor(view.bonus + view.edge, view.dc));
        const options = clickable(view);
        if (!options.length) break;
        checkCommand(game, pickOne(options));
      }
      if (game.check) giveUp(game);
    }
  }
});

test("what reaches the browser never includes the puzzle's answer", () => {
  for (const skill of Object.keys(SKILLS)) {
    const game = newGame();
    open(game, skill, "hard");
    const shown = JSON.stringify(publicState(game).check);
    assert.ok(!shown.includes('"state"'), skill);
    assert.ok(!shown.includes('"answer"'), skill);
    assert.ok(!shown.includes('"hidden"'), skill);
    assert.ok(!shown.includes('"floor"'), skill);
    assert.ok(!shown.includes('"code"'), skill);
    assert.ok(!shown.includes('"profile"'), skill);
  }
});

test("typing is forgiving: nonsense does no harm, and help always works", () => {
  for (const skill of Object.keys(SKILLS)) {
    const game = newGame();
    open(game, skill);
    const before = JSON.stringify(game.check.state);
    checkCommand(game, "xyzzy plugh");
    assert.equal(JSON.stringify(game.check.state), before, skill);
    assert.match(game.check.log.at(-1).text, /command not found/, skill);
    checkCommand(game, "help");
    checkCommand(game, "   ");
    assert.ok(game.check, skill);
    assert.equal(JSON.stringify(game.check.state), before, skill);
    checkCommand(game, "run");
  }
});

test("a hacker can type part of a word, or get it slightly wrong", () => {
  const game = trained("hacking", 3);
  open(game, "hacking", "moderate");
  const word = game.check.state.words.find((entry) => entry !== game.check.state.answer);
  checkCommand(game, word.slice(0, 5).toLowerCase());
  assert.ok(game.check.state.tries.some((attempt) => attempt.word === word), "part of a word");
  const next = game.check.state.words.find((entry) => entry !== game.check.state.answer && entry !== word);
  checkCommand(game, `try ${next.slice(0, -1)}x`);
  assert.ok(game.check.state.tries.some((attempt) => attempt.word === next), "a typo");
});

// ---- Playing well pays off ------------------------------------------------

const likeness = (a, b) => [...a].filter((letter, i) => b[i] === letter).length;

// A careful player of each game, who plays by the information the game shows them.
const CAREFUL = {
  crack(game) {
    const { state } = game.check;
    const options = state.words.filter((word) => !state.removed.includes(word) && state.tries.every((attempt) => attempt.word !== word && likeness(attempt.word, word) === attempt.score));
    checkCommand(game, `try ${options[0]}`);
  },
  codebreak(game) {
    const { state } = game.check;
    const count = state.symbols.length;
    const slots = state.code.length;
    const consistent = (guess) => state.guesses.every((entry) => {
      let exact = 0;
      const a = {};
      const b = {};
      guess.forEach((symbol, i) => {
        if (symbol === entry.guess[i]) exact += 1;
        else {
          a[symbol] = (a[symbol] ?? 0) + 1;
          b[entry.guess[i]] = (b[entry.guess[i]] ?? 0) + 1;
        }
      });
      const near = Object.keys(a).reduce((sum, key) => sum + Math.min(a[key], b[key] ?? 0), 0);
      return exact === entry.exact && near === entry.near;
    });
    // Tries codes in order until one fits everything it's been told so far.
    const guess = [];
    const search = (position) => {
      if (position === slots) return consistent(guess) && (state.repeats || new Set(guess).size === slots);
      for (let i = 0; i < count; i += 1) {
        guess[position] = i;
        if (search(position + 1)) return true;
      }
      return false;
    };
    search(0);
    for (const index of guess.slice(0, slots)) if (game.check) checkCommand(game, `add ${index + 1}`);
  },
  switches(game) {
    const { state } = game.check;
    checkCommand(game, `flip ${String.fromCharCode(65 + state.fix[0])}`);
  },
  balance(game) {
    const { state } = game.check;
    const text = CHECK_TEXT.skills[game.check.skill];
    const coming = state.queue[state.turn].deltas;
    const score = (action) => text.meters.reduce((sum, meter) => {
      const value = Math.max(0, Math.min(10, state.values[meter.id] + (action.deltas[meter.id] ?? 0) + (coming[meter.id] ?? 0)));
      const middle = (meter.zone[0] + meter.zone[1]) / 2;
      return sum - Math.abs(value - middle) - (value < meter.zone[0] || value > meter.zone[1] ? 3 : 0);
    }, 0);
    const actions = text.actions.filter((action) => (action.tier ?? 0) <= game.check.tier && (!action.uses || (state.used[action.id] ?? 0) < action.uses));
    const best = actions.reduce((top, action) => (score(action) > score(top) ? action : top));
    checkCommand(game, `do ${best.id}`);
  },
  runner(game) {
    const { state } = game.check;
    // Looks as far ahead as the player can see, and heads for the longest clear stretch.
    const clearFor = (lane, from) => {
      let best = 0;
      const walk = (at, row, depth) => {
        if (depth >= state.sight || row >= state.steps || state.rows[row][at]) { best = Math.max(best, depth); return; }
        for (const next of [at - 1, at, at + 1]) if (next >= 0 && next < 5) walk(next, row + 1, depth + 1);
      };
      walk(lane, from, 0);
      return best;
    };
    const moves = [["straight", state.lane], ["left", state.lane - 1], ["right", state.lane + 1]].filter(([, lane]) => lane >= 0 && lane < 5);
    moves.sort((a, b) => clearFor(b[1], state.at) - clearFor(a[1], state.at));
    checkCommand(game, moves[0][0]);
  },
  sneak(game) {
    // Waits or moves, whichever gets closer without stepping into sight on the next turn.
    const { state } = game.check;
    const walls = new Set(state.walls);
    const sees = (x, y, time) => state.guards.some((guard) => {
      const span = guard.path.length;
      const period = 2 * (span - 1);
      const step = (time + guard.offset) % period;
      const forward = step < span - 1;
      const index = forward ? step : period - step;
      const place = guard.path[index];
      const a = guard.path[0];
      const b = guard.path[span - 1];
      const dir = forward ? { x: Math.sign(b.x - a.x), y: Math.sign(b.y - a.y) } : { x: Math.sign(a.x - b.x), y: Math.sign(a.y - b.y) };
      if (place.x === x && place.y === y) return true;
      let cx = place.x;
      let cy = place.y;
      for (let i = 0; i < 2; i += 1) {
        cx += dir.x;
        cy += dir.y;
        if (walls.has(`${cx},${cy}`)) return false;
        if (cx === x && cy === y) return true;
      }
      return false;
    });
    const frontier = [{ x: state.x, y: state.y, time: state.time, first: null }];
    const seen = new Set();
    while (frontier.length) {
      const now = frontier.shift();
      if (now.x === state.exit.x && now.y === state.exit.y && now.first) {
        checkCommand(game, now.first);
        return;
      }
      for (const [name, dx, dy] of [["up", 0, -1], ["right", 1, 0], ["left", -1, 0], ["down", 0, 1], ["wait", 0, 0]]) {
        const x = now.x + dx;
        const y = now.y + dy;
        if (x < 0 || y < 0 || x >= state.width || y >= state.height || walls.has(`${x},${y}`) || sees(x, y, now.time + 1)) continue;
        const mark = `${x},${y},${(now.time + 1) % 240}`;
        if (seen.has(mark) || seen.size > 40000) continue;
        seen.add(mark);
        frontier.push({ x, y, time: now.time + 1, first: now.first ?? name });
      }
    }
    checkCommand(game, "wait");
  },
  target(game) {
    const { x, y, dx, dy } = game.check.state.target;
    const nx = x + dx < 0 || x + dx >= 10 ? x - dx : x + dx;
    const ny = y + dy < 0 || y + dy >= 6 ? y - dy : y + dy;
    checkCommand(game, `fire ${String.fromCharCode(97 + nx)}${ny + 1}`);
  },
  appeal(game) {
    const { state } = game.check;
    const best = state.order.reduce((top, id) => (state.profile[id] - (state.used[id] ?? 0) > state.profile[top] - (state.used[top] ?? 0) ? id : top));
    checkCommand(game, `say ${best}`);
  },
  cover(game) {
    const { state } = game.check;
    checkCommand(game, state.current.knows ? (state.deflects > 0 ? "deflect" : "plain") : "bold");
  },
  haggle(game) {
    const { state } = game.check;
    const offer = Math.max(state.floor, state.lastOffer + 1);
    checkCommand(game, `offer ${offer}`);
  },
  push(game) {
    const { state } = game.check;
    const safe = state.gauge + state.step[1] <= state.limit;
    checkCommand(game, safe ? "push" : "hold");
  },
  tune(game) {
    const { state } = game.check;
    if (state.dial !== state.hidden) checkCommand(game, `dial ${state.hidden}`);
    else checkCommand(game, "listen");
  },
  route(game) {
    const { state } = game.check;
    const reachable = (from) => [from - 1, from, from + 1].filter((row) => row >= 0 && row < 3);
    const costFrom = (layer, row) => {
      const node = state.chart[layer][row];
      const here = node.cost + (node.hazard ? 3 : 0);
      if (layer === state.chart.length - 1) return here;
      return here + Math.min(...reachable(row).map((next) => costFrom(layer + 1, next)));
    };
    const options = reachable(state.row);
    const best = options.reduce((top, row) => (costFrom(state.layer, row) < costFrom(state.layer, top) ? row : top));
    checkCommand(game, `go ${String.fromCharCode(97 + state.layer)}${best + 1}`);
  },
  scan(game) {
    const { state } = game.check;
    const index = state.hidden.find((cell) => !state.found.includes(cell));
    checkCommand(game, `mark ${String.fromCharCode(97 + (index % state.width))}${Math.floor(index / state.width) + 1}`);
  },
  duel(game) {
    const { state } = game.check;
    const { moves } = CHECK_TEXT.skills[game.check.skill];
    checkCommand(game, `move ${moves[(state.current.move + 1) % moves.length].id}`);
  },
};

function averageEdge(skill, difficulty, rank, player, rounds = 40) {
  let total = 0;
  for (let i = 0; i < rounds; i += 1) {
    const game = trained(skill, rank);
    open(game, skill, difficulty);
    let edge = game.check.edge;
    for (let step = 0; step < 300 && game.check && !game.check.state.done; step += 1) {
      player(game);
      if (game.check) edge = game.check.edge;
      else break;
    }
    if (game.check) edge = game.check.edge;
    total += edge;
    if (game.check) giveUp(game);
  }
  return total / rounds;
}

// How often a player gets in, for a game that decides itself with no roll.
function winRate(skill, difficulty, rank, player, rounds = 40) {
  let wins = 0;
  for (let i = 0; i < rounds; i += 1) {
    const game = trained(skill, rank);
    startCheck(game, { skill, difficulty, reason: "A test", source: "tool" });
    for (let step = 0; step < 300 && game.check; step += 1) player(game);
    if (game.check) giveUp(game);
    if (game.lastCheck?.success) wins += 1;
  }
  return wins / rounds;
}

function clickRandomly(game) {
  const options = clickable(checkView(game));
  if (options.length) checkCommand(game, pickOne(options));
  else giveUp(game);
}

test("in every window, playing carefully earns far more than clicking at random, and enough to matter", () => {
  const report = [];
  for (const skill of Object.keys(SKILLS)) {
    const { game } = CHECK_TEXT.skills[skill];
    if (CHECK_GAMES[game].decided) {
      // A decided game has no roll to improve: careful play has to get in far more often than clicking at random.
      const careful = winRate(skill, "moderate", 3, CAREFUL[game]);
      const random = winRate(skill, "moderate", 3, clickRandomly);
      report.push(`${skill}: careful gets in ${Math.round(careful * 100)}%, random ${Math.round(random * 100)}%`);
      assert.ok(careful >= 0.6, `${skill}: playing carefully only gets in ${Math.round(careful * 100)}% of the time\n${report.join("\n")}`);
      assert.ok(careful > random + 0.2, `${skill}: careful play (${careful}) should beat random (${random}) clearly`);
      continue;
    }
    const careful = averageEdge(skill, "moderate", 3, CAREFUL[game]);
    const random = averageEdge(skill, "moderate", 3, clickRandomly);
    report.push(`${skill}: careful ${careful.toFixed(1)}, random ${random.toFixed(1)}`);
    assert.ok(careful >= 3.5, `${skill}: playing carefully only earns ${careful.toFixed(1)}\n${report.join("\n")}`);
    assert.ok(careful > random, `${skill}: careful play (${careful.toFixed(1)}) should beat random (${random.toFixed(1)})`);
  }
});

test("training gives a player better tools, whatever the game", () => {
  const game = trained("hacking", 0);
  assert.equal(tierFor(game, "hacking"), 0);
  game.skills.hacking = 2;
  assert.equal(tierFor(game, "hacking"), 1);
  game.skills.hacking = 5;
  assert.equal(tierFor(game, "hacking"), 2);
  game.skills.hacking = 8;
  assert.equal(tierFor(game, "hacking"), 3);
  game.skills.hacking = 10;
  assert.equal(tierFor(game, "hacking"), 4);
  assert.equal(skillRank(game, "hacking"), 10);

  const untrained = open(trained("hacking", 0), "hacking", "hard");
  const master = open(trained("hacking", 10), "hacking", "hard");
  assert.ok(master.state.maxTrace > untrained.state.maxTrace);
  assert.ok(master.state.freeProbes > untrained.state.freeProbes);
  const slow = open(trained("piloting", 0), "piloting", "hard");
  const ace = open(trained("piloting", 10), "piloting", "hard");
  assert.ok(ace.state.sight > slow.state.sight);
});

test("gear and perks can make a specialist", () => {
  const game = trained("hacking", 1);
  assert.equal(tierFor(game, "hacking"), 1);
  game.inventory.lockbreaker = 1;
  // Its +2 counts toward how well-equipped the hacker is.
  assert.equal(tierFor(game, "hacking"), 2);
  const check = open(game, "hacking", "hard");
  assert.equal(check.state.spoofs, 1);
});

test("a raw attribute check has a window too", () => {
  const game = newGame();
  for (const attribute of ["might", "endurance", "agility", "perception", "intellect", "willpower", "presence", "resonance"]) {
    startCheck(game, { attribute, difficulty: "easy", reason: "A test", source: "practice" });
    const view = checkView(game);
    assert.ok(view.panels.length >= 1, attribute);
    checkCommand(game, "run");
  }
});

test("practice doesn't count: no skill growth, no story, nothing for the game master", () => {
  const game = newGame();
  const before = structuredClone({ skillXp: game.skillXp, transcript: game.transcript, needs: game.needs, pending: game.pendingEvents });
  for (let i = 0; i < 40; i += 1) {
    open(game, "hacking");
    const { outcome } = checkCommand(game, "run");
    assert.equal(outcome.training, true);
  }
  assert.deepEqual({ skillXp: game.skillXp, transcript: game.transcript, needs: game.needs, pending: game.pendingEvents }, before);
});

test("a real check grows the skill, adds to the story, and tells the game master how it went", () => {
  const game = newGame();
  startCheck(game, { skill: "hacking", difficulty: "hard", reason: "Get in", source: "tool" });
  const { outcome } = checkCommand(game, "run");
  assert.ok((game.skillXp.hacking ?? 0) > 0 || (game.skills.hacking ?? 0) > 0);
  assert.equal(outcome.training, false);
  assert.match(game.transcript.at(-1).text, /^\[ROLL\] Get in:/);
  assert.equal(game.pendingEvents.length, 1);
  assert.match(game.pendingEvents[0], /How it went:/);
});

test("work in the window shows up in the roll, where there is one", () => {
  // A hack that goes straight to the roll, as Settings can ask, still counts the work done in it.
  const game = trained("hacking", 3);
  open(game, "hacking", "hard");
  game.check.state.cracked = true;
  game.check.state.trace = 0;
  const { outcome } = checkCommand(game, "run");
  assert.equal(outcome.decided, false);
  assert.match(outcome.math, /your work 6/);
});

test("a cracked session is a success with no roll, and a disconnect a quiet failure", () => {
  const game = trained("hacking", 3);
  open(game, "hacking", "hard");
  let reply;
  while (game.check) reply = checkCommand(game, `try ${game.check.state.answer}`);
  assert.equal(reply.over, true);
  assert.equal(reply.outcome.success, true);
  assert.equal(reply.outcome.decided, true);
  assert.equal(reply.outcome.label, "ACCESS GRANTED");
  assert.equal(reply.outcome.die, null);
  assert.match(reply.outcome.story, /cracked all 2 passwords/);
  const again = trained("hacking", 3);
  startCheck(again, { skill: "hacking", difficulty: "hard", reason: "Get in", source: "tool" });
  checkCommand(again, "ls");
  const quit = checkCommand(again, "disconnect");
  assert.equal(quit.over, true);
  assert.equal(quit.outcome.success, false);
  assert.equal(quit.outcome.label, "DISCONNECTED");
  assert.match(quit.outcome.story, /nobody the wiser/);
  assert.equal(again.lastCheck.success, false);
  assert.match(again.transcript.at(-1).text, /^\[HACK\] Get in: DISCONNECTED/);
  assert.ok(!readRecord(again).facts.some((fact) => fact.id.startsWith("traced_on")), "no mark for backing out");
  assert.match(again.pendingEvents[0], /Result: FAILURE \(disconnected\)/);
});

test("the computer's class sets the break-in: a door panel is small and patient, the Beacon long and layered", () => {
  const panel = open(trained("hacking", 0), "hacking", "easy").state;
  const beacon = open(trained("hacking", 0), "hacking", "nearly_impossible").state;
  assert.equal(panel.className, "Door panel");
  assert.equal(beacon.className, "The Beacon or the Choir");
  assert.ok(panel.answer.length < beacon.answer.length);
  assert.ok(panel.words.length < beacon.words.length);
  assert.ok(panel.maxTrace > beacon.maxTrace);
  assert.equal(panel.layers, 1);
  assert.equal(beacon.layers, 3);
  for (const state of [panel, beacon]) {
    assert.ok(state.words.includes(state.answer));
    assert.ok(state.words.every((word) => word.length === state.answer.length && CHECK_TEXT.skills.hacking.words[String(word.length)].includes(word)));
    assert.equal(new Set(state.words).size, state.words.length);
  }
  const game = trained("hacking", 0);
  open(game, "hacking", "moderate");
  const view = checkView(game);
  assert.equal(view.classLabel, "Crew terminal");
  assert.equal(view.decided, true);
  assert.ok(view.commands.some((entry) => entry.command === "disconnect"));
  assert.equal(hackingClasses().length, 5);
  assert.equal(hackingClasses()[0].name, "Door panel");
  assert.equal(hackingClasses().at(-1).difficulty, "nearly_impossible");
});

test("an important computer has more than one password, and the trace carries over", () => {
  const game = trained("hacking", 2);
  open(game, "hacking", "hard");
  const { state } = game.check;
  assert.equal(state.layers, 2);
  const first = state.answer;
  checkCommand(game, `try ${state.words.find((word) => word !== first)}`);
  const reply = checkCommand(game, `try ${first}`);
  assert.equal(reply.over, false);
  assert.equal(game.check.state.layer, 2);
  assert.equal(game.check.state.trace, 1);
  assert.equal(game.check.state.tries.length, 0);
  assert.ok(checkView(game).meters.some((meter) => meter.label === "LAYER" && meter.text === "2/2"));
  assert.match(game.check.log.at(-1).text, /wants a password of its own/);
});

test("the advisor's hints grow with training, and follow the clues", () => {
  const hintsAt = (rank, difficulty = "moderate") => {
    const game = trained("hacking", rank);
    open(game, "hacking", difficulty);
    return { game, hints: checkView(game).hints };
  };
  const untrained = hintsAt(0);
  assert.equal(untrained.hints.length, 2);
  assert.match(untrained.hints[0], /letters/);
  assert.ok(hintsAt(2).hints.some((line) => /of the words still fit/.test(line)));
  // A trained hacker gets the list while it's short, and a word about the dump when it's long.
  assert.ok(hintsAt(4, "easy").hints.some((line) => /Still possible:/.test(line)));
  assert.ok(hintsAt(4).hints.some((line) => /Still possible:|the dump dims/.test(line)));
  const expert = hintsAt(7);
  const advice = expert.hints.find((line) => /^Try /.test(line));
  assert.ok(advice, expert.hints.join(" | "));
  assert.ok(expert.game.check.state.words.includes(advice.match(/^Try (\S+) next/)[1]));
  const master = hintsAt(10);
  assert.ok(master.hints.some((line) => /wrong tries left/.test(line)));
  assert.ok(master.hints.length > untrained.hints.length);
  const { game } = master;
  const before = master.hints.find((line) => /of the words still fit/.test(line));
  checkCommand(game, `try ${game.check.state.words.find((word) => word !== game.check.state.answer)}`);
  const after = checkView(game).hints.find((line) => /of the words still fit/.test(line));
  assert.ok(after && after !== before, `${before} -> ${after}`);
});

test("typing run in a hack rolls nothing once it's under way, and a plain roll before playing still works", () => {
  const game = trained("hacking", 3);
  open(game, "hacking", "moderate");
  checkCommand(game, "ls");
  const reply = checkCommand(game, "run");
  assert.equal(reply.over, false);
  assert.ok(game.check);
  assert.match(game.check.log.at(-1).text, /no roll here/);
  const quick = trained("hacking", 3);
  open(quick, "hacking", "moderate");
  const rolled = checkCommand(quick, "roll");
  assert.equal(rolled.over, true);
  assert.equal(typeof rolled.outcome.die, "number");
});

test("a fight and a check can't happen at once, and neither can two checks", () => {
  const game = newGame();
  open(game, "hacking");
  assert.throws(() => open(game, "stealth"), /Finish the check/);
  checkCommand(game, "run");
  game.combat = { enemies: [] };
  assert.throws(() => open(game, "stealth"), /Finish the fight/);
});

test("the hack ends by itself when the trace completes, as a failure, with a mark on an important computer", () => {
  const game = trained("hacking", 0);
  startCheck(game, { skill: "hacking", difficulty: "hard", reason: "Get in", source: "tool" });
  const { state } = game.check;
  let last;
  for (let i = 0; i < 20 && game.check; i += 1) {
    const wrong = state.words.find((word) => word !== state.answer && !state.removed.includes(word) && !state.tries.some((attempt) => attempt.word === word));
    last = checkCommand(game, `try ${wrong}`);
  }
  assert.equal(game.check, null);
  assert.equal(last.over, true);
  assert.equal(last.outcome.success, false);
  assert.equal(last.outcome.label, "TRACED");
  assert.match(last.outcome.story, /trace caught up/);
  assert.equal(game.lastCheck.success, false);
  assert.match(game.transcript.at(-1).text, /^\[HACK\] Get in: TRACED, trace 100%/);
  assert.ok(readRecord(game).facts.some((fact) => fact.id === "traced_on_ships_main_system"), "the mark on the record");
  assert.match(game.pendingEvents[0], /Result: FAILURE \(traced\)/);
  // A crew terminal leaves no mark.
  const small = trained("hacking", 0);
  startCheck(small, { skill: "hacking", difficulty: "moderate", reason: "Peek", source: "tool" });
  for (let i = 0; i < 20 && small.check; i += 1) {
    const wrong = small.check.state.words.find((word) => word !== small.check.state.answer && !small.check.state.tries.some((attempt) => attempt.word === word));
    checkCommand(small, `try ${wrong}`);
  }
  assert.equal(small.check, null);
  assert.ok(!readRecord(small).facts.some((fact) => fact.id.startsWith("traced_on")));
});

test("a social check reads what the person really believes", () => {
  const game = newGame();
  open(game, "persuasion", "moderate", { audience: "voss" });
  const { profile, order } = game.check.state;
  // Voss believes strongly in order and in community, so those appeals land if they're on offer.
  if (order.includes("duty")) assert.ok(profile.duty >= 1);
  if (order.includes("together")) assert.ok(profile.together >= 1);
  if (order.includes("gain")) assert.ok(profile.gain <= 0);
  checkCommand(game, "run");
});

test("an older save, even one with no check system, loads and can start one", () => {
  const save = JSON.parse(JSON.stringify({ ...newGame(), version: 5 }));
  delete save.check;
  delete save.story;
  const migrated = migrateGame(save);
  assert.equal(migrated.version, 15);
  assert.equal(migrated.check, null);
  open(migrated, "hacking");
  assert.ok(publicState(migrated).check);
  checkCommand(migrated, "run");
});
