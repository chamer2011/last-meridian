import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributeSpeech, buildLoreIndex, buildVocab, colorForName, combatTone, findLoreEntry, findLoreIds, latestOptions, loreEntries,
  oddsFor, parseNarration, parseNotice, parseOption, parseOptions, segmentLore, splitQuotes,
} from "../public/story.js";
import { AXES, NOTABLES, POLES, SKILLS, SPECIES } from "../src/character-data.js";
import { creatorSetup, createGameFromDraft, randomDraft } from "../src/creator.js";
import { FACTIONS, LOCATIONS } from "../src/data.js";
import { LORE, hasStaticLore, noteLoreSeen, startingLoreIds } from "../src/lore.js";
import { migrateGame } from "../src/migrate.js";
import { oddsFor as rulesOddsFor, publicState } from "../src/rules.js";
import { newTurnLimits, runTool } from "../src/tools.js";

const setup = creatorSetup();
const vocab = buildVocab(setup.skills, setup.axes);
const staticIndex = buildLoreIndex(LORE);

// Who each paragraph of a passage goes to, or null for narration.
const speakersIn = (text) => attributeSpeech(parseNarration(text), staticIndex)
  .filter((block) => block.type !== "consequence")
  .map((block) => (block.type === "speech" ? block.speaker : null));
const newGame = () => createGameFromDraft(randomDraft({ seed: 21, archetype: "officer" }));

// ---- Narration ----------------------------------------------------------

test("marked speech gets a speaker, a voice, and separated quotes and beats", () => {
  const [block] = parseNarration('@Ilya Voss: "We have nine minutes." She doesn\'t look up. "Maybe less."');
  assert.equal(block.type, "speech");
  assert.equal(block.speaker, "Ilya Voss");
  assert.equal(block.voice, null);
  assert.deepEqual(block.parts.map((p) => p.kind), ["quote", "beat", "quote"]);
  assert.equal(block.parts[0].text, '"We have nine minutes."');

  const [comm] = parseNarration('@Dunn Marrow [comm]: "Who\'s listening?"');
  assert.equal(comm.speaker, "Dunn Marrow");
  assert.equal(comm.voice, "comm");
  assert.equal(parseNarration('@Ship [machine]: "Warning."')[0].voice, "machine");
  assert.equal(parseNarration('@The Choir: "we remember."')[0].voice, "choir");
  assert.equal(parseNarration('@Voss [dancing]: "Hm."')[0].voice, null);
});

test("speech with no quotation marks still counts as speech", () => {
  const [block] = parseNarration("@Voss: We have nine minutes.");
  assert.deepEqual(block.parts, [{ kind: "quote", text: "We have nine minutes." }]);
});

test("speech works in other quote styles, and in the styles other models use", () => {
  assert.equal(parseNarration("@Voss: “Hello.”")[0].parts[0].kind, "quote");
  for (const line of ['Voss: "Hello."', '**Voss:** "Hello."', '**Voss**: "Hello."', 'Ilya Voss: “Hello.”']) {
    const [block] = parseNarration(line);
    assert.equal(block.type, "speech", line);
    assert.equal(block.marked, false, line);
    assert.match(block.speaker, /Voss/, line);
  }
  // Ordinary sentences with colons aren't speech.
  assert.equal(parseNarration("There's one problem: the fuel.")[0].type, "narration");
  assert.equal(parseNarration('The sign reads: "No entry."')[0].type, "narration");
});

test("narration, consequences and choices are told apart, whatever the spacing", () => {
  const blocks = parseNarration('The bridge hums.\n\n=> Voss will remember this.\n\n\n@Voss: "Orders?"\n\n> [tactics:hard] Hold\n> Run');
  assert.deepEqual(blocks.map((b) => b.type), ["narration", "consequence", "speech"]);
  assert.equal(blocks[1].text, "Voss will remember this.");
  assert.deepEqual(parseNarration("> Only a choice"), []);
  assert.deepEqual(parseNarration(""), []);
  assert.deepEqual(parseNarration("=>"), []);
});

test("half-written markers never flash up while text is arriving", () => {
  assert.deepEqual(parseNarration("@Ilya Vo", { streaming: true }), []);
  assert.deepEqual(parseNarration("=", { streaming: true }), []);
  assert.deepEqual(parseNarration("=>", { streaming: true }), []);
  assert.deepEqual(parseNarration(">", { streaming: true }), []);
  assert.deepEqual(parseNarration("The hum.\n@Ilya Vo", { streaming: true }).map((b) => b.type), ["narration"]);
  const [early] = parseNarration("@Ilya Voss:", { streaming: true });
  assert.equal(early.speaker, "Ilya Voss");
  assert.deepEqual(early.parts, []);
  const [midQuote] = parseNarration('@Ilya Voss: "We have nine', { streaming: true });
  assert.deepEqual(midQuote.parts, [{ kind: "quote", text: '"We have nine' }]);
  // Once text has stopped arriving, a stray @ is just text.
  assert.equal(parseNarration("@Ilya Vo")[0].type, "narration");
});

test("quotes split cleanly, even with an unfinished one", () => {
  assert.deepEqual(splitQuotes("no quotes"), [{ kind: "beat", text: "no quotes" }]);
  assert.deepEqual(splitQuotes('"all"'), [{ kind: "quote", text: '"all"' }]);
  assert.deepEqual(splitQuotes('a "b" c').map((p) => p.kind), ["beat", "quote", "beat"]);
  assert.deepEqual(splitQuotes('a "b').map((p) => p.kind), ["beat", "quote"]);
  assert.deepEqual(splitQuotes(""), []);
});

test("Claude's real narration from before this update is still readable", () => {
  const real = `Someone has scratched the old captain's name off the bridge chair with a knife.

"Captain." Commander Ilya Voss doesn't salute. She puts a data slate in your hand. "Comms caught this forty minutes ago."

Voss is watching your face closely. "Lieutenant Tarrow has already asked to have a security detail posted," she says flatly.

> Analyze the Beacon's lattice structure yourself.
> Address the fleet before rumors spread.`;
  const blocks = parseNarration(real);
  assert.equal(blocks.length, 3);
  assert.equal(blocks[0].type, "narration");
  // With no markers, the person named outside the quotes is taken as the speaker.
  assert.deepEqual(speakersIn(real), [null, "Ilya Voss", "Ilya Voss"]);
  assert.deepEqual(parseOptions(real, vocab).map((o) => o.label), ["Analyze the Beacon's lattice structure yourself.", "Address the fleet before rumors spread."]);
});

test("the speakers are worked out in a scene real Opus wrote without marking them", () => {
  assert.deepEqual(speakersIn(`You finish. The display goes still. It has taken fifty-eight minutes.

Voss looks at the coordinates and doesn't look at you. "So it's real."

"It's a place," you could tell her. Whether it's a *harbor* is another question.

The lift doors hiss open. Lieutenant Kara Tarrow steps onto the bridge with two armed security officers and stops at a precise, regulation distance from your chair.

"Captain." She makes the word sound polite and sharp at the same time. "Speaker Halm wants to know why the fleet's new captain locked the bridge." Her eyes go to the screen, then to your hands. "I said I would ask you directly."`), [null, "Ilya Voss", null, null, "Kara Tarrow"]);
});

test("the player's own words are never given to someone else", () => {
  assert.deepEqual(speakersIn(`Tarrow comes around the corner at a run.

Then you lower the weapon, slowly, and set it on the deck. "It's over, Lieutenant," you say. "He's hurt."

"Fine," she says at last.`), [null, null, "Kara Tarrow"]);
});

test("a quoted phrase in the middle of a sentence isn't someone speaking", () => {
  assert.deepEqual(speakersIn(`Halm's motion passes by a narrow margin, and a "review panel" is formed. You are invited to "cooperate fully."`), [null]);
  assert.deepEqual(speakersIn(`Tarrow says "Stop."`), ["Kara Tarrow"]);
});

test("when it isn't clear who's talking, there's no name rather than a wrong one", () => {
  // Someone who isn't on file.
  assert.deepEqual(speakersIn(`Voss glances up.\n\nThen a man near the aisle calls out, "And what are you, Captain?"`), [null, null]);
  // The pronoun doesn't fit the last person mentioned.
  assert.deepEqual(speakersIn(`Voss glances up.\n\n"Stand down," he says.`), [null, null]);
  // Two people were just mentioned.
  assert.deepEqual(speakersIn(`Voss glares at Tarrow.\n\n"Enough," she says.`), [null, null]);
  // Nobody was just mentioned.
  assert.deepEqual(speakersIn(`The hatch opens.\n\n"Captain!"`), [null, null]);
  assert.deepEqual(speakersIn(`Voss glances up. The hatch opens.\n\nThe lights dim.\n\n"Captain!"`), [null, null, null]);
});

test("marked and unmarked speech work together in one scene", () => {
  assert.deepEqual(speakersIn(`@Ilya Voss: "Go."\n\n"And take Pell with you."\n\nTarrow's voice carries down the corridor: "Drop the weapon."`), ["Ilya Voss", "Ilya Voss", "Kara Tarrow"]);
  assert.deepEqual(speakersIn(`@Dunn Marrow [comm]: "We've lost the port coupling." He coughs.\n\nHe wipes his hands. "Maybe worse."`), ["Dunn Marrow", "Dunn Marrow"]);
  // Consequences don't get in the way.
  const blocks = attributeSpeech(parseNarration(`Voss glances up.\n\n=> She'll remember this.\n\n"Well?" she says.`), staticIndex);
  assert.deepEqual(blocks.map((b) => b.type), ["narration", "consequence", "speech"]);
  // Someone with no file who was marked still gets their own lines.
  assert.deepEqual(speakersIn(`@Keth Amari: "Go on."\n\nHe spits on the deck. "Clean job."`), ["Keth Amari", "Keth Amari"]);
});

// ---- Choices ------------------------------------------------------------

test("choice tags are recognized, and the words are kept clean", () => {
  const option = parseOption("[persuasion:hard] [mercy] [+Voss] [-Tarrow] [!costs 200 credits] Talk them down", vocab);
  assert.equal(option.label, "Talk them down");
  assert.deepEqual(option.tags, [
    { kind: "check", skill: "persuasion", difficulty: "hard" },
    { kind: "belief", pole: "mercy" },
    { kind: "approve", name: "Voss" },
    { kind: "disapprove", name: "Tarrow" },
    { kind: "warn", text: "costs 200 credits" },
  ]);
});

test("choice tags cope with the variations a model might write", () => {
  const check = (raw) => parseOption(`${raw} Go`, vocab).tags[0];
  assert.deepEqual(check("[Persuasion: Hard]"), { kind: "check", skill: "persuasion", difficulty: "hard" });
  assert.deepEqual(check("[persuasion hard]"), { kind: "check", skill: "persuasion", difficulty: "hard" });
  assert.deepEqual(check("[void ops:very hard]"), { kind: "check", skill: "void_ops", difficulty: "very_hard" });
  assert.deepEqual(check("[Void Ops: nearly impossible]"), { kind: "check", skill: "void_ops", difficulty: "nearly_impossible" });
  assert.deepEqual(check("[piloting]"), { kind: "check", skill: "piloting", difficulty: null });
  assert.deepEqual(check("[piloting:ludicrous]"), { kind: "check", skill: "piloting", difficulty: null });
  assert.deepEqual(check("[MERCY]"), { kind: "belief", pole: "mercy" });
  assert.deepEqual(check("[+Commander Voss]"), { kind: "approve", name: "Commander Voss" });
  assert.deepEqual(check("[-1 fuel]"), { kind: "note", text: "-1 fuel" });
  assert.deepEqual(check("[something odd]"), { kind: "note", text: "something odd" });
  // Tags can come after the words too, and a choice that's all tags keeps its text.
  assert.equal(parseOption("Hold the line [tactics:hard]", vocab).label, "Hold the line");
  assert.equal(parseOption("[mercy]", vocab).label, "[mercy]");
});

test("every skill and belief can be used as a choice tag", () => {
  for (const [id, skill] of Object.entries(SKILLS)) {
    assert.equal(parseOption(`[${id}:easy] Go`, vocab).tags[0].skill, id);
    assert.equal(parseOption(`[${skill.name}:easy] Go`, vocab).tags[0].skill, id);
  }
  for (const id of Object.keys(POLES)) assert.deepEqual(parseOption(`[${id}] Go`, vocab).tags[0], { kind: "belief", pole: id });
  assert.equal(Object.keys(setup.axes).length, Object.keys(AXES).length);
});

test("the current choices are the latest ones, and old ones don't linger", () => {
  const says = (text) => ({ role: "narrator", text });
  const picks = (t) => latestOptions(t, vocab).map((o) => o.label);
  assert.deepEqual(picks([]), []);
  assert.deepEqual(picks([says("Hi\n> One\n> Two")]), ["One", "Two"]);
  assert.deepEqual(picks([says("Hi\n> One"), { role: "notice", text: "[XP] +5: x" }]), ["One"]);
  assert.deepEqual(picks([says("Hi\n> One"), says("More text")]), ["One"]);
  assert.deepEqual(picks([says("Hi\n> Old"), says("> New")]), ["New"]);
  assert.deepEqual(picks([says("Hi\n> Old"), { role: "player", text: "1" }]), []);
  assert.deepEqual(picks([says("Hi\n> Old"), { role: "combat", text: "You hit." }]), []);
});

test("the browser's odds match the rules", () => {
  for (let bonus = -6; bonus <= 25; bonus += 1) {
    for (const dc of Object.values(setup.difficulty)) assert.equal(oddsFor(bonus, dc), rulesOddsFor(bonus, dc));
  }
});

// ---- Game messages ------------------------------------------------------

test("checks are read into their parts", () => {
  const [line] = parseNotice("[ROLL] Convince Voss: 15 + Presence 0 + Persuasion 2 - bonuses 3 = 14 vs 12: SUCCESS");
  assert.equal(line.tag, "CHECK");
  assert.equal(line.reason, "Convince Voss");
  assert.equal(line.math, "15 + Presence 0 + Persuasion 2 - bonuses 3");
  assert.equal(line.total, 14);
  assert.equal(line.dc, 12);
  assert.equal(line.result, "SUCCESS");
  assert.equal(line.tone, "good");
  assert.equal(parseNotice("[ROLL] Hold: 1 - Might 2 = -1 vs 8: CRITICAL FAILURE")[0].tone, "bad");
  assert.equal(parseNotice("[ROLL] Odd reason: with colon: 5 + Might 1 = 6 vs 8: FAILURE")[0].reason, "Odd reason: with colon");
});

test("good and bad news are told apart", () => {
  const tone = (text) => parseNotice(text)[0].tone;
  assert.equal(tone("[CREDITS] +200: Reward"), "good");
  assert.equal(tone("[CREDITS] -200: Bribe"), "bad");
  assert.equal(tone("[HEALTH] +5: Doctor"), "good");
  assert.equal(tone("[HEALTH] -5: Blast"), "bad");
  assert.equal(tone("[HEALTH] Concussion: Blast"), "bad");
  assert.equal(tone("[HEALTH] Recovered from Concussion: Medbay"), "good");
  assert.equal(tone("[HEALTH] You've recovered: Shaken."), "good");
  assert.equal(tone("[STRESS] +12: Blast (now 27/100)"), "bad");
  assert.equal(tone("[STRESS] -5: Rest (now 7/100)"), "good");
  assert.equal(tone("[ITEM] Received: Medkit"), "good");
  assert.equal(tone("[ITEM] Lost: Medkit"), "bad");
  assert.equal(tone("[FACTION] Hegemony -10: Insult"), "bad");
  assert.equal(tone("[FACTION] Refugee Fleet +10: Rescue"), "good");
  assert.equal(tone("[SHIP] Hull -10, Morale +5: Battle"), "bad");
  assert.equal(tone("[SHIP] Morale +5: Speech"), "good");
  assert.equal(tone("[SHIP] Nothing changed"), "info");
  assert.equal(tone("[QUEST] completed: Fuel"), "good");
  assert.equal(tone("[QUEST] failed: Fuel"), "bad");
  assert.equal(tone("[QUEST] updated: Fuel"), "info");
  assert.equal(tone("[RELATION] Ilya Voss: friendly -> wary"), "bad");
  assert.equal(tone("[RELATION] Ilya Voss: wary -> ally"), "good");
  assert.equal(tone("[BELIEF] You move toward Iron"), "belief");
  assert.equal(tone("[BREAK] The stress overwhelms you."), "bad");
  assert.equal(tone("Level up! You are now level 2."), "good");
});

test("messages of several lines, old saves and stray text all work", () => {
  const lines = parseNotice("[BELIEF] Spared them\n[BELIEF] You move toward Mercy (-3 on Conflict).");
  assert.equal(lines.length, 2);
  assert.equal(parseNotice("🎲 Convince Voss: 3 + Presence 3 = 6 vs 12: FAILURE")[0].tag, "GAME");
  assert.equal(parseNotice("⚔️ Combat: Dock Thug")[0].text, "Combat: Dock Thug");
  assert.equal(parseNotice("Learned Toughened.")[0].tag, "GAME");
  assert.deepEqual(parseNotice(""), []);
});

test("fight lines are colored by who they're good for", () => {
  assert.equal(combatTone("Dock Thug hits you for 4."), "bad");
  assert.equal(combatTone("You attack and hit for 4."), "good");
  assert.equal(combatTone("You attack and miss (7 vs defense 11)."), "dim");
  assert.equal(combatTone("Dock Thug attacks and misses (8 vs defense 13)."), "dim");
  assert.equal(combatTone("Dock Thug is defeated! +20 XP."), "good");
});

test("every game message the AI can cause gets a sensible tone", () => {
  const game = newGame();
  const turn = () => newTurnLimits();
  const notice = (name, input) => runTool(game, name, input, turn()).notice;
  assert.equal(parseNotice(notice("change_stress", { amount: 10, reason: "Blast" }))[0].tone, "bad");
  assert.equal(parseNotice(notice("change_stress", { amount: -3, reason: "Rest" }))[0].tone, "good");
  assert.equal(parseNotice(notice("change_ship", { hull: -10, fuel: 0, morale: 0, reason: "Hit" }))[0].tone, "bad");
  assert.match(notice("change_ship", { hull: 5, fuel: 0, morale: 3, reason: "Repairs" }), /Hull \+5, Morale \+3: Repairs/);
  assert.equal(parseNotice(notice("change_faction", { faction: "fleet", amount: 5, reason: "Help" }))[0].tone, "good");
  assert.equal(parseNotice(notice("change_faction", { faction: "fleet", amount: -5, reason: "Harm" }))[0].tone, "bad");
  assert.equal(parseNotice(notice("change_credits", { amount: 50, reason: "Pay" }))[0].tone, "good");
  assert.equal(parseNotice(notice("change_health", { amount: -5, reason: "Fall" }))[0].tone, "bad");
});

test("a changed attitude shows up as a consequence, and an unchanged one stays quiet", () => {
  const game = newGame();
  game.contacts = [{ name: "Ilya Voss", attitude: "friendly", note: "XO" }];
  const change = runTool(game, "note_contact", { name: "ilya voss", attitude: "wary", note: "You lied." }, newTurnLimits());
  assert.equal(change.notice, "[RELATION] Ilya Voss: friendly -> wary");
  const same = runTool(game, "note_contact", { name: "Ilya Voss", attitude: "wary", note: "Still wary." }, newTurnLimits());
  assert.equal(same.notice, undefined);
  assert.equal(game.contacts.length, 1);
});

// ---- Lore ---------------------------------------------------------------

const links = (text, index = staticIndex, used = new Set()) => segmentLore(text, index, used).filter((s) => s.entry).map((s) => s.entry.id);

test("lore covers the setting, and everything has text and a known kind", () => {
  for (const id of Object.keys(NOTABLES)) assert.ok(LORE.some((e) => e.id === `person:${id}`), id);
  for (const id of Object.keys(FACTIONS)) assert.ok(LORE.some((e) => e.id === `faction:${id}`), id);
  for (const id of Object.keys(LOCATIONS)) assert.ok(LORE.some((e) => e.id === `place:${id}`), id);
  for (const id of Object.keys(SPECIES)) assert.ok(LORE.some((e) => e.id === `people:${id}`), id);
  assert.equal(new Set(LORE.map((e) => e.id)).size, LORE.length);
  for (const entry of LORE) {
    assert.ok(entry.name && entry.text, entry.id);
    assert.ok(Array.isArray(entry.aliases), entry.id);
  }
});

test("the setting's secrets stay out of the codex", () => {
  const all = LORE.map((e) => e.text).join(" ").toLowerCase();
  for (const secret of ["warning light", "guardians", "keep that thing asleep", "preserve minds", "choir-related secret", "hiding something"]) {
    assert.ok(!all.includes(secret), secret);
  }
});

test("names and terms are found in any form, and only whole words count", () => {
  assert.deepEqual(links("Commander Voss looks at the Hegemony."), ["person:voss", "faction:hegemony"]);
  assert.deepEqual(links("Voss's slate."), ["person:voss"]);
  assert.deepEqual(links("The Choir sings on."), ["concept:choir"]);
  assert.deepEqual(links("Word from Haven Station."), ["place:haven"]);
  assert.deepEqual(links("The Order of Ilun remembers."), ["faction:ilun"]);
  assert.deepEqual(links("A Korrun and two Synthetics."), ["people:korrun", "people:synthetic"]);
  assert.deepEqual(links("It's in the resonance."), ["concept:resonance"]);
  assert.deepEqual(links("A vossian herald, the choirmaster, Havens."), []);
  assert.deepEqual(links("Nothing to see."), []);
});

test("only the first mention in a passage is highlighted, and all the text is kept", () => {
  const used = new Set();
  const text = "Voss nods. Voss frowns. The Hegemony waits, and Voss sighs.";
  const pieces = segmentLore(text, staticIndex, used);
  assert.deepEqual(pieces.filter((p) => p.entry).map((p) => p.text), ["Voss", "The Hegemony"]);
  assert.equal(pieces.map((p) => p.text).join(""), text);
  assert.deepEqual(links("Voss returns.", staticIndex, used), []);
  assert.equal(segmentLore("Plain.", buildLoreIndex([]))[0].text, "Plain.");
});

test("speakers are matched by the name the AI used", () => {
  for (const name of ["Commander Ilya Voss", "Ilya Voss", "Commander Voss", "Voss", "Old Voss"]) {
    assert.equal(findLoreEntry(name, staticIndex)?.id, "person:voss", name);
  }
  assert.equal(findLoreEntry("Lt. Kara Tarrow", staticIndex)?.id, "person:tarrow");
  assert.equal(findLoreEntry("The Choir", staticIndex)?.id, "concept:choir");
  assert.equal(findLoreEntry("Meridian", staticIndex)?.id, "place:meridian");
  assert.equal(findLoreEntry("A Nervous Ensign", staticIndex), null);
});

test("each person keeps a steady color, and notable people have their own", () => {
  assert.equal(colorForName("Tal Verrin"), colorForName("Tal Verrin"));
  assert.match(colorForName("Tal Verrin"), /^#[0-9a-f]{6}$/);
  const colors = Object.values(NOTABLES).map((n) => n.color);
  assert.equal(new Set(colors).size, colors.length);
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("lore shows what's true in this game", () => {
  const game = newGame();
  const state = publicState(game);
  const entries = loreEntries(setup.lore, state);
  const entry = (id) => entries.find((e) => e.id === id);
  assert.match(entry("faction:hegemony").status, /Your standing/);
  assert.match(entry("person:voss").status, /Attitude toward you/);
  assert.equal(entry("place:meridian").status, "You are here.");
  assert.equal(entry("place:haven").status, undefined);
  assert.equal(entry("person:quill").status, undefined);
});

test("contacts from your past are highlighted too", () => {
  const state = { contacts: [{ name: "Tal Verrin", attitude: "wary", note: "Old rival." }, { name: "Echo", attitude: "ally", note: "A ship-mind." }, { name: "Ilya Voss", attitude: "ally", note: "XO" }] };
  const index = buildLoreIndex(loreEntries(LORE, state));
  assert.deepEqual(links("Tal Verrin waves.", index), ["contact:Tal Verrin"]);
  assert.deepEqual(links("Verrin waves.", index), ["contact:Tal Verrin"]);
  assert.deepEqual(links("Echo answers. An echo fades.", index), ["contact:Echo"]);
  assert.deepEqual(links("Voss waves.", index), ["person:voss"]);
  assert.equal(index.byId.get("contact:Tal Verrin").kind, "person");
});

test("names with odd characters can't break the highlighter", () => {
  const state = { contacts: [{ name: "Dr. (Ex) Rell+", attitude: "wary", note: "?" }], lore: [{ id: "custom:0", name: "The [Rim]*", kind: "place", text: "Far." }] };
  const index = buildLoreIndex(loreEntries(LORE, state));
  assert.ok(index.regex);
  assert.deepEqual(links("Past The [Rim]* lies nothing.", index), ["custom:0"]);
});

test("the AI can add to the codex, within limits", () => {
  const game = newGame();
  const turn = newTurnLimits();
  const added = runTool(game, "add_lore", { term: "The Rim", kind: "place", text: "The edge of the mapped galaxy." }, turn);
  assert.equal(added.notice, "[LORE] New codex entry: The Rim");
  assert.equal(game.lore.length, 1);
  const updated = runTool(game, "add_lore", { term: "the rim", kind: "place", text: "Farther than anyone thought." }, turn);
  assert.equal(updated.notice, undefined);
  assert.equal(game.lore.length, 1);
  assert.equal(game.lore[0].text, "Farther than anyone thought.");

  assert.equal(runTool(game, "add_lore", { term: "The Choir", kind: "concept", text: "x" }, turn).isError, true);
  assert.equal(runTool(game, "add_lore", { term: "voss", kind: "person", text: "x" }, turn).isError, true);
  assert.equal(runTool(game, "add_lore", { term: "x", kind: "nonsense", text: "x" }, turn).isError, true);
  assert.equal(runTool(game, "add_lore", { term: "  ", kind: "place", text: "x" }, turn).isError, true);
  assert.equal(runTool(game, "add_lore", { term: "A", kind: "place", text: "x" }, turn).isError, true);
  runTool(game, "add_lore", { term: "Alpha Base", kind: "place", text: "x" }, turn);
  runTool(game, "add_lore", { term: "Beta Base", kind: "place", text: "x" }, turn);
  assert.equal(runTool(game, "add_lore", { term: "Gamma Base", kind: "place", text: "x" }, turn).isError, true);
  assert.equal(hasStaticLore("the choir"), true);
  assert.equal(hasStaticLore("the rim"), false);

  const index = buildLoreIndex(loreEntries(LORE, publicState(game)));
  assert.deepEqual(links("Past The Rim.", index), [game.lore[0].id]);
  assert.deepEqual(links("Past the Rim.", index), [game.lore[0].id]);
  assert.deepEqual(links("A Rim outpost.", index), [game.lore[0].id]);
  assert.deepEqual(links("The rim of the cup.", index), []);
});

test("the codex fills up as things are mentioned", () => {
  const game = newGame();
  assert.deepEqual(game.seenLore, startingLoreIds());
  assert.ok(!game.seenLore.includes("place:vantor"));
  noteLoreSeen(game, "A courier from Vantor Prime and Mother Quill.");
  assert.ok(game.seenLore.includes("place:vantor"));
  assert.ok(game.seenLore.includes("person:quill"));
  const count = game.seenLore.length;
  noteLoreSeen(game, "Vantor again.");
  assert.equal(game.seenLore.length, count);
  assert.deepEqual([...findLoreIds("Nothing here.", staticIndex)], []);
});

test("saves from before the codex pick up what they've already seen", () => {
  const game = newGame();
  const old = JSON.parse(JSON.stringify({ ...game, version: 2, transcript: [{ role: "narrator", text: "Mother Quill smiles." }, { role: "player", text: "Vantor Prime" }] }));
  delete old.lore;
  delete old.seenLore;
  const migrated = migrateGame(old);
  assert.equal(migrated.version, 14);
  assert.deepEqual(migrated.lore, []);
  assert.ok(migrated.seenLore.includes("person:quill"));
  assert.ok(!migrated.seenLore.includes("place:vantor"));
  assert.ok(migrated.seenLore.includes("concept:choir"));
  JSON.stringify(publicState(migrated));
});
