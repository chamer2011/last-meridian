import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { INTERFACE_SIZES, interfaceZoom, latestSceneStart, personSpeaking, piecesOf, sceneOf } from "../public/scene.js";
import { attributeSpeech, buildLoreIndex, parseNarration } from "../public/story.js";
import { WRITING_SPEEDS } from "../public/writer.js";

const index = buildLoreIndex([]);
const blocksOf = (text, options) => attributeSpeech(parseNarration(text, options), index);
const wordsOf = (beats) => beats.flatMap((beat) => (beat.parts ?? [{ text: beat.text }]).map((part) => part.text)).join("");
const squeezed = (text) => text.replace(/\s+/g, "");

const SCENE = `The engineering deck is a furnace of pipe-heat and swearing.

@Dunn Marrow: "Reactor's alive. That's the good news." He taps the slate. "Core's running at about two-thirds."

He glances aft.

=> The crew heard that.

> [persuasion:moderate] Press him for the real figure
> Ask what's behind the bulkhead`;

test("a scene is the latest thing the player did, or the story picking up after a fight", () => {
  assert.equal(latestSceneStart([]), 0);
  assert.equal(latestSceneStart([{ role: "narrator", text: "a" }]), 0);
  const transcript = [{ role: "narrator" }, { role: "player" }, { role: "narrator" }, { role: "notice" }];
  assert.equal(latestSceneStart(transcript), 1);
  assert.equal(latestSceneStart([...transcript, { role: "combat" }, { role: "combat" }, { role: "narrator" }]), 6);
  assert.equal(latestSceneStart([...transcript, { role: "player" }]), 4);
});

test("a scene comes in pieces, in order, and choices aren't one of them", () => {
  const { beats, said, notes } = sceneOf([{ role: "player", text: "I ask." }, { role: "narrator", text: SCENE }], { blocksOf });
  assert.equal(said, "I ask.");
  assert.deepEqual(notes, []);
  assert.deepEqual(beats.map((beat) => beat.type), ["narration", "speech", "narration", "consequence"]);
  assert.equal(beats[1].speaker, "Dunn Marrow");
  assert.ok(!wordsOf(beats).includes("Press him"));
});

test("a game message comes up with the piece after it, so it doesn't give anything away", () => {
  const entries = [
    { role: "player", text: "I pick the lock." },
    { role: "notice", text: "[TIME] Ten minutes pass." },
    { role: "narrator", text: "You kneel at the door.\n\nThe tumblers click." },
    { role: "notice", text: "[ROLL] Lockpicking: 5 + 2 = 7 vs 12: FAILED" },
    { role: "narrator", text: "It jams." },
    { role: "notice", text: "[STRESS] +2" },
  ];
  const { beats, notes } = sceneOf(entries, { blocksOf });
  assert.equal(beats.length, 3);
  assert.deepEqual(notes.map((note) => note.at), [0, 2, 2]);
  // With nothing to read, a message still has somewhere to go.
  assert.deepEqual(sceneOf([{ role: "notice", text: "[TALK] Done." }], { blocksOf }).notes.map((note) => note.at), [0]);
});

test("a fight's blow-by-blow isn't part of reading the scene", () => {
  const { beats, notes } = sceneOf([{ role: "narrator", text: "They step out." }, { role: "combat", text: "You hit for 5." }], { blocksOf });
  assert.equal(beats.length, 1);
  assert.equal(notes.length, 0);
});

test("a long speech is cut at the end of a sentence, nothing's lost, and a cut quote is still a quote", () => {
  const sentence = "Reactor's alive, and that's about the best I can tell you today. ";
  const said = `"${sentence.repeat(14).trim()}"`;
  const block = blocksOf(`@Dunn Marrow: ${said} He taps the slate. "That's all."`)[0];
  for (const limit of [140, 200, 300, 420]) {
    const pieces = piecesOf(block, limit);
    assert.ok(pieces.length > 1, `${limit}`);
    for (const piece of pieces) {
      assert.equal(piece.speaker, "Dunn Marrow");
      assert.ok(piece.parts.reduce((total, part) => total + part.text.length, 0) <= limit + 2, `${limit}`);
      for (const part of piece.parts) {
        if (part.kind !== "quote") continue;
        assert.ok(part.text.startsWith('"') && part.text.endsWith('"'), part.text);
        assert.ok(part.text.slice(1, -1).trim().length > 0, part.text);
      }
    }
    // What's added is only the quote marks at the cuts.
    const back = squeezed(wordsOf(pieces)).replaceAll('"', "");
    assert.equal(back, squeezed(block.parts.map((part) => part.text).join("")).replaceAll('"', ""));
  }
});

test("curly quotes stay curly, narration can be cut too, and a sentence too long to cut stays whole", () => {
  const curly = piecesOf({ type: "speech", speaker: "Voss", parts: [{ kind: "quote", text: `“${"One more thing. ".repeat(20).trim()}”` }] }, 100);
  assert.ok(curly.length > 1);
  for (const piece of curly) assert.match(piece.parts[0].text, /^“.*”$/);
  const told = piecesOf({ type: "narration", parts: [{ kind: "beat", text: "The pump coughs. ".repeat(30) }] }, 100);
  assert.ok(told.length > 1);
  assert.equal(wordsOf(told), "The pump coughs. ".repeat(30));
  const long = `${"word ".repeat(100)}end.`;
  assert.deepEqual(piecesOf({ type: "narration", parts: [{ kind: "beat", text: long }] }, 100).map((piece) => piece.parts[0].text), [long]);
  const consequence = { type: "consequence", text: "x".repeat(500) };
  assert.deepEqual(piecesOf(consequence, 100), [consequence]);
});

test("while the words are still arriving, the pieces already there don't change", () => {
  const whole = `The pump coughs.\n\n@Dunn Marrow: "${"Reactor's alive, and that's the best I can do. ".repeat(12).trim()}"\n\nHe looks away.\n\n> Go on`;
  let before = [];
  for (let length = 1; length <= whole.length; length += 17) {
    const { beats } = sceneOf([{ role: "narrator", text: whole.slice(0, length) }], { blocksOf, limit: 200, streaming: true });
    // All but the last one, which is the one still being added to.
    for (let i = 0; i < before.length - 1; i += 1) assert.deepEqual(beats[i], before[i], `at ${length}, piece ${i}`);
    assert.ok(beats.length >= before.length - 1, `at ${length}`);
    before = beats;
  }
  const done = sceneOf([{ role: "narrator", text: whole }], { blocksOf, limit: 200 }).beats;
  assert.equal(before.length, done.length);
});

const PEOPLE = [
  { key: "voss", name: "Commander Ilya Voss", short: "Voss" },
  { key: "marrow", name: "Chief Engineer Dunn Marrow", short: "Marrow" },
  { key: "tech", name: "Tech Lena Marsh", short: "Marsh", crowd: true },
];

test("whoever's talking is found from their name as the AI wrote it", () => {
  for (const name of ["Dunn Marrow", "Marrow", "Chief Marrow", "dunn marrow", "Chief Engineer Dunn Marrow", "Dunn", "MARROW"]) {
    assert.equal(personSpeaking(name, PEOPLE)?.key, "marrow", name);
  }
  for (const name of ["Ilya Voss", "Commander Voss", "Voss", "Ilya"]) assert.equal(personSpeaking(name, PEOPLE)?.key, "voss", name);
});

test("a wrong person with words over their head is worse than none", () => {
  for (const name of ["A Stranger", "Pell", "The Voice", "", "   ", "The", "Someone of the"]) assert.equal(personSpeaking(name, PEOPLE), null, name);
  // Someone in the crowd has to be named exactly.
  assert.equal(personSpeaking("Tech Lena Marsh", PEOPLE)?.key, "tech");
  assert.equal(personSpeaking("Marsh", PEOPLE)?.key, "tech");
  assert.equal(personSpeaking("Lena", PEOPLE), null);
  // Two people it could be is nobody.
  const twins = [{ key: "a", name: "Ann Reed", short: "Ann" }, { key: "b", name: "Bo Reed", short: "Bo" }];
  assert.equal(personSpeaking("Reed", twins), null);
  assert.equal(personSpeaking("Ann Reed", twins)?.key, "a");
  assert.equal(personSpeaking("Marrow"), null);
});

test("how big everything's drawn follows the window, or the player's choice, as far as it fits", () => {
  // The window the game opens in is drawn as it always was.
  assert.equal(interfaceZoom("auto", 1400, 900), 1);
  assert.equal(interfaceZoom("auto", 1384, 861), 1);
  assert.equal(interfaceZoom("auto", 830, 640), 1);
  // Bigger windows get bigger everything, by whichever side has less room.
  assert.equal(interfaceZoom("auto", 1920, 1080), 1.2);
  assert.equal(interfaceZoom("auto", 2560, 1440), 1.6);
  assert.equal(interfaceZoom("auto", 3840, 2160), 2.4);
  assert.equal(interfaceZoom("auto", 1920, 600), 1);
  assert.equal(interfaceZoom("auto", 9000, 6000), 2.5);
  // The player's choice.
  assert.equal(interfaceZoom("normal", 2560, 1440), 1);
  assert.equal(interfaceZoom("small", 1400, 900), 0.85);
  assert.equal(interfaceZoom("large", 1400, 900), 1.2);
  assert.equal(interfaceZoom("largest", 1920, 1080), 1.45);
  // No size leaves less room than the smallest window the screens work in.
  assert.equal(interfaceZoom("largest", 1400, 900), 1.4);
  assert.equal(interfaceZoom("largest", 1000, 900), 1.2);
  assert.equal(interfaceZoom("largest", 830, 640), 1);
  assert.equal(interfaceZoom("largest", 500, 400), 1);
  for (const choice of Object.keys(INTERFACE_SIZES)) {
    for (const [width, height] of [[830, 640], [1024, 768], [1280, 720], [1400, 900], [1920, 1080], [2560, 1440], [3840, 2160]]) {
      const zoom = interfaceZoom(choice, width, height);
      assert.ok(zoom >= 0.85 && zoom <= 2.5, `${choice} ${width}x${height}`);
      // Whole steps, because text gets uneven in between.
      assert.equal(Math.round(zoom * 20) / 20, zoom);
      if (zoom > 1) assert.ok(width / zoom >= 829 && height / zoom >= 639, `${choice} ${width}x${height}: ${zoom}`);
    }
  }
});

test("the choices in the Settings menu are ones the game knows, and it starts with popups", () => {
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const menus = fs.readFileSync(new URL("../public/menus.js", import.meta.url), "utf8");
  assert.match(app, /const reading = \{[^}]*story: "popups"/);
  assert.match(app, /const reading = \{[^}]*popFont: "terminal"/);
  assert.match(app, /const reading = \{[^}]*writing: "normal"/);
  assert.match(app, /const reading = \{[^}]*interface: "auto"/);
  for (const value of Object.keys(WRITING_SPEEDS)) assert.ok(menus.includes(`["${value}", "`), value);
  for (const value of Object.keys(INTERFACE_SIZES)) assert.ok(menus.includes(`["${value}", "`), value);
  for (const value of ["popups", "box", "panel"]) {
    assert.ok(menus.includes(`["${value}", "`), value);
    assert.ok(app.includes(`saved?.story === "${value}"`), value);
  }
  assert.ok(WRITING_SPEEDS.slow < WRITING_SPEEDS.normal && WRITING_SPEEDS.normal < WRITING_SPEEDS.fast);
});

test("the popups are in the game's own windows, in its own font", () => {
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  const popups = fs.readFileSync(new URL("../public/popups.js", import.meta.url), "utf8");
  assert.ok(popups.includes('check-window pop-window pop-story'));
  assert.ok(popups.includes('check-window pop-window pop-speaker'));
  assert.ok(popups.includes('check-window pop-window pop-command'));
  assert.match(css, /--pop-font: var\(--mono\)/);
  // And they stay under the windows that have to go over them.
  const zOf = (selector) => Number(css.match(new RegExp(`\\${selector} \\{[^}]*z-index: (\\d+)`))?.[1]);
  assert.ok(zOf(".pops") < zOf(".check-overlay"));
  assert.ok(zOf(".pops") < zOf(".fight-overlay"));
  assert.ok(zOf(".pops") < zOf(".drawer"));
});
