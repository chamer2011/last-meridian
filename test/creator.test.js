import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARCHETYPES, ATTR_COST, AXES, BONDS, CONDITIONS, CONTEXTS, CONVICTIONS, DRIVES, HOMEWORLDS, NOTABLES, POLES, SKILLS, SPECIES, TRAITS, UPBRINGINGS,
} from "../src/character-data.js";
import { buildCharacter, createGameFromDraft, creatorSetup, normalizeDraft, randomDraft, simulateLife } from "../src/creator.js";
import { ABILITIES, ENEMIES, FACTIONS, ITEMS, PERKS, STATS } from "../src/data.js";
import { CAREERS, FALL_CHOICES, GENERAL_EVENTS, GENERAL_MISHAPS } from "../src/life-data.js";
import { migrateGame } from "../src/migrate.js";
import { aiDossier, aiSnapshot, maxEnergy, maxHp, publicState } from "../src/rules.js";

// ---- The data has to fit together ---------------------------------------

function checkFx(fx, label) {
  for (const id of Object.keys(fx?.attrs ?? {})) assert.ok(STATS[id], `${label}: attribute ${id}`);
  for (const id of Object.keys(fx?.skills ?? {})) assert.ok(SKILLS[id], `${label}: skill ${id}`);
  for (const id of Object.keys(fx?.context ?? {})) assert.ok(CONTEXTS[id], `${label}: context ${id}`);
  for (const id of Object.keys(fx?.factions ?? {})) assert.ok(FACTIONS[id], `${label}: faction ${id}`);
}

function checkOutcome(o, label) {
  assert.ok(o.text, `${label}: has text`);
  for (const id of Object.keys(o.skills ?? {})) assert.ok(SKILLS[id], `${label}: skill ${id}`);
  for (const id of Object.keys(o.attrs ?? {})) assert.ok(STATS[id], `${label}: attribute ${id}`);
  for (const [id, n] of Object.entries(o.ideology ?? {})) {
    assert.ok(POLES[id], `${label}: belief ${id}`);
    assert.ok(n > 0, `${label}: belief ${id} is positive`);
  }
  for (const id of o.traits ?? []) assert.ok(TRAITS[id], `${label}: trait ${id}`);
  for (const id of Object.keys(o.factions ?? {})) assert.ok(FACTIONS[id], `${label}: faction ${id}`);
  if (o.contact) {
    assert.ok(["ally", "friendly", "neutral", "wary", "hostile"].includes(o.contact.attitude), `${label}: attitude`);
    assert.ok(o.contact.role && o.contact.note, `${label}: contact details`);
  }
}

function checkCheck(c, label) {
  assert.ok(STATS[c.attr], `${label}: attribute ${c.attr}`);
  if (c.skill) assert.ok(SKILLS[c.skill], `${label}: skill ${c.skill}`);
  assert.ok(c.dc >= 1, `${label}: dc`);
}

test("every career and life event refers to things that exist", () => {
  const eventIds = new Set();
  const checkEvent = (event, label) => {
    assert.ok(!eventIds.has(event.id), `duplicate event ${event.id}`);
    eventIds.add(event.id);
    assert.ok(event.choices.length >= 2, `${label}: has choices`);
    for (const choice of event.choices) {
      const where = `${label}/${choice.id}`;
      assert.ok(choice.label, where);
      if (choice.check) {
        checkCheck(choice.check, where);
        checkOutcome(choice.win, `${where}/win`);
        checkOutcome(choice.lose, `${where}/lose`);
      } else {
        checkOutcome(choice.result, where);
      }
    }
  };
  for (const [id, career] of Object.entries(CAREERS)) {
    assert.equal(career.ranks.length, 5, id);
    checkCheck(career.danger, id);
    checkCheck(career.advance, id);
    for (const s of career.core) assert.ok(SKILLS[s], `${id}: core ${s}`);
    for (const item of career.kit) assert.ok(ITEMS[item], `${id}: kit ${item}`);
    assert.ok(PERKS[career.signature]?.starting, `${id}: signature perk`);
    assert.ok(career.events.length >= 3, `${id}: has events`);
    career.events.forEach((event) => checkEvent(event, event.id));
    career.mishaps.forEach((m, i) => checkOutcome(m, `${id} mishap ${i}`));
  }
  GENERAL_EVENTS.forEach((event) => checkEvent(event, event.id));
  assert.ok(GENERAL_EVENTS.length >= 6);
  GENERAL_MISHAPS.forEach((m, i) => checkOutcome(m, `general mishap ${i}`));
  for (const [id, fall] of Object.entries(FALL_CHOICES)) checkOutcome(fall.result, `fall ${id}`);
});

test("every species, origin, trait, drive and conviction refers to things that exist", () => {
  for (const [id, s] of Object.entries(SPECIES)) {
    checkFx(s.fx, id);
    for (const a of Object.keys(s.attrs)) assert.ok(STATS[a], `${id}: ${a}`);
    for (const k of Object.keys(s.skills)) assert.ok(SKILLS[k], `${id}: ${k}`);
  }
  for (const [id, o] of Object.entries({ ...HOMEWORLDS, ...UPBRINGINGS })) {
    for (const k of Object.keys(o.skills)) assert.ok(SKILLS[k], `${id}: ${k}`);
    for (const f of Object.keys(o.factions ?? {})) assert.ok(FACTIONS[f], `${id}: ${f}`);
    for (const p of Object.keys(o.ideology ?? {})) assert.ok(POLES[p], `${id}: ${p}`);
  }
  for (const [id, t] of Object.entries(TRAITS)) {
    checkFx(t.fx, id);
    for (const other of t.excludes ?? []) {
      assert.ok(TRAITS[other], `${id}: excludes ${other}`);
      assert.ok(TRAITS[other].excludes?.includes(id), `${id} and ${other} should exclude each other`);
    }
    assert.ok(t.desc, id);
  }
  for (const [id, d] of Object.entries(DRIVES)) checkFx(d.fx, id);
  for (const [id, c] of Object.entries(CONVICTIONS)) {
    assert.ok(POLES[id], id);
    checkFx(c.fx, id);
  }
  for (const [id, cond] of Object.entries(CONDITIONS)) checkFx(cond.fx, id);
  for (const [id, perk] of Object.entries(PERKS)) {
    checkFx(perk.fx, id);
    if (perk.ability) assert.ok(ABILITIES[perk.ability], `${id}: ability`);
    if (perk.requires) assert.ok(PERKS[perk.requires], `${id}: requires`);
    for (const s of Object.keys(perk.requiresSkill ?? {})) assert.ok(SKILLS[s], `${id}: ${s}`);
  }
  for (const [id, item] of Object.entries(ITEMS)) {
    if (item.type === "weapon") {
      assert.ok(STATS[item.stat], `${id}: stat`);
      assert.ok(SKILLS[item.skill], `${id}: skill`);
    }
    checkFx(item.fx, id);
  }
  for (const [id, n] of Object.entries(NOTABLES)) {
    for (const a of Object.keys(n.beliefs)) assert.ok(AXES[a], `${id}: ${a}`);
    if (n.faction !== null) assert.ok(FACTIONS[n.faction], `${id}: faction`);
  }
  for (const e of Object.values(ENEMIES)) for (const tag of e.tags) assert.ok(CONTEXTS[tag], `${e.name}: ${tag}`);
  for (const [id, a] of Object.entries(ARCHETYPES)) {
    assert.ok(SPECIES[a.species] && HOMEWORLDS[a.homeworld] && UPBRINGINGS[a.upbringing], `${id}: origins`);
    for (const c of a.careers) assert.ok(CAREERS[c], `${id}: career ${c}`);
    for (const t of a.traits) assert.ok(TRAITS[t], `${id}: trait ${t}`);
    for (const s of [...a.tags, ...a.skills]) assert.ok(SKILLS[s], `${id}: skill ${s}`);
    for (const g of a.gear) assert.ok(ITEMS[g], `${id}: gear ${g}`);
    assert.ok(DRIVES[a.drive] && BONDS[a.bond] && FALL_CHOICES[a.fall], `${id}: drive, bond and fall`);
  }
  assert.ok(creatorSetup().gear.every((g) => !g.restricted && g.type !== "story"));
});

// ---- Random and ready-made characters -----------------------------------

function assertPlayable(game, label) {
  assert.ok(game.name, label);
  assert.ok(maxHp(game) >= 10, `${label}: health ${maxHp(game)}`);
  assert.ok(maxEnergy(game) >= 1, label);
  assert.equal(game.hp, maxHp(game), label);
  for (const v of Object.values(game.stats)) assert.ok(Number.isInteger(v) && v >= 1 && v <= 10, `${label}: attribute ${v}`);
  for (const v of Object.values(game.skills)) assert.ok(Number.isInteger(v) && v >= 0, `${label}: skill ${v}`);
  for (const v of Object.values(game.factions)) assert.ok(Number.isFinite(v) && Math.abs(v) <= 100, `${label}: faction ${v}`);
  for (const v of Object.values(game.ideology)) assert.ok(Number.isInteger(v) && Math.abs(v) <= 10, `${label}: belief ${v}`);
  assert.ok(game.credits >= 0, label);
  assert.ok(game.character.biography.length >= 2, label);
  assert.ok(game.contacts.length >= 4, label);
  assert.ok(game.perks.length >= 1, label);
  assert.ok(game.equipped.weapon, `${label}: has a weapon`);
  JSON.stringify(publicState(game));
  assert.ok(aiSnapshot(game).includes(game.name), label);
  assert.ok(aiDossier(game).includes("Life history"), label);
}

test("every archetype produces a valid, playable character for many seeds", () => {
  for (const archetype of Object.keys(ARCHETYPES)) {
    for (let seed = 0; seed < 40; seed += 1) {
      const built = buildCharacter(randomDraft({ seed, archetype }));
      const errors = Object.values(built.view.errors).flat();
      assert.deepEqual(errors, [], `${archetype} seed ${seed}`);
      assertPlayable(built.game, `${archetype} seed ${seed}`);
    }
  }
});

test("fully random characters are always valid and playable", () => {
  const speciesSeen = new Set();
  const careersSeen = new Set();
  for (let seed = 0; seed < 300; seed += 1) {
    const built = buildCharacter(randomDraft({ seed }));
    const errors = Object.values(built.view.errors).flat();
    assert.deepEqual(errors, [], `seed ${seed}`);
    assertPlayable(built.game, `seed ${seed}`);
    speciesSeen.add(built.game.character.species);
    for (const job of built.game.character.careers) careersSeen.add(job.career);
  }
  assert.equal(speciesSeen.size, Object.keys(SPECIES).length);
  assert.ok(careersSeen.size >= Object.keys(CAREERS).length - 1);
});

test("the same draft and seed always give the same life", () => {
  for (let seed = 0; seed < 20; seed += 1) {
    const draft = randomDraft({ seed });
    const a = buildCharacter(draft);
    const b = buildCharacter(JSON.parse(JSON.stringify(draft)));
    assert.deepEqual(a.view.life, b.view.life);
    assert.deepEqual(a.game.stats, b.game.stats);
  }
});

test("different seeds give different lives", () => {
  const bios = new Set();
  for (let seed = 0; seed < 20; seed += 1) bios.add(buildCharacter(randomDraft({ seed, archetype: "officer" })).game.character.biography.join());
  assert.ok(bios.size > 10);
});

// ---- A draft built step by step -----------------------------------------

function originDraft(extra = {}) {
  return normalizeDraft({ name: "Test", species: "human", homeworld: "aurelis", upbringing: "service", life: { seed: 7 }, ...extra });
}

function liveOneTerm(draft, career = "navy") {
  draft.life.terms.push({ career, choice: null });
  const { view } = buildCharacter(draft);
  if (view.life.stage === "event") {
    draft.life.terms.at(-1).choice = view.life.pending.choices[0].id;
  }
  return buildCharacter(draft).view;
}

test("an empty draft doesn't crash, and lists what's missing", () => {
  const { view, complete } = buildCharacter({});
  assert.equal(complete, false);
  assert.ok(view.errors.identity.length && view.errors.species.length && view.errors.life.length && view.errors.drive.length);
  assert.equal(view.life.stage, "origins");
  assert.throws(() => createGameFromDraft({}));
});

test("nonsense from the browser can't break or cheat the creator", () => {
  const junk = [null, 7, "x", [], { attributes: "no" }, { life: 3 }, { life: { terms: "no" } }, { life: { terms: [null, 3, { career: "president" }] } },
    { skills: { firearms: 9999, fake: 3 } }, { traits: ["fake", 3, null] }, { tags: ["fake"] }, { gear: { choir_lance: 5, beacon_shard: 1, fake: 1, medkit: -4 } },
    { attributes: { might: 9999, agility: -50, fake: 4 } }, { ideology: { authority: 9999, fake: 3 } }, { species: "__proto__" }, { species: "constructor", homeworld: "toString" }];
  for (const draft of junk) {
    const { view } = buildCharacter(draft);
    assert.equal(view.complete, false, JSON.stringify(draft));
    assert.ok(view.attributes.might.value <= 10);
  }
  const clean = normalizeDraft({ gear: { choir_lance: 5, beacon_shard: 1, medkit: 2 }, attributes: { might: 9999 }, ideology: { authority: 9999 } });
  assert.deepEqual(clean.gear, { medkit: 2 });
  assert.equal(clean.attributes.might, 8);
  assert.equal(clean.ideology.authority, 6);
});

test("attribute points can't be overspent, and species change them", () => {
  const draft = originDraft();
  for (const id of Object.keys(STATS)) draft.attributes[id] = 8;
  const { view } = buildCharacter(draft);
  assert.ok(view.errors.attributes[0].includes("overspent"));
  assert.ok(view.attrPoints.left < 0);

  const korrun = buildCharacter(originDraft({ species: "korrun", attributes: { might: 5 } })).view;
  assert.equal(korrun.attributes.might.value, 7);
  const human = buildCharacter(originDraft({ attributes: { might: 5 } })).view;
  assert.equal(human.attributes.might.value, 5);
  assert.equal(human.attrPoints.budget, korrun.attrPoints.budget + 2);
  assert.equal(ATTR_COST[8], 10);
});

test("a synthetic can't have Resonance, even by raising it", () => {
  const { view } = buildCharacter(originDraft({ species: "synthetic", attributes: { resonance: 6 } }));
  assert.equal(view.attributes.resonance.value, 1);
  assert.equal(view.attributes.resonance.canRaise, false);
});

test("the life simulation runs term by term, and pauses for choices", () => {
  const draft = originDraft();
  assert.equal(buildCharacter(draft).view.life.stage, "career");
  draft.life.terms.push({ career: "navy", choice: null });
  const first = buildCharacter(draft).view.life;
  // With this seed the first term either pauses for a choice or ends in a mishap.
  if (first.stage === "event") {
    assert.ok(first.pending.choices.length >= 2);
    assert.equal(first.completedTerms, 0);
    draft.life.terms[0].choice = first.pending.choices[0].id;
    const after = buildCharacter(draft).view.life;
    assert.equal(after.completedTerms, 1);
    assert.equal(after.stage, "career");
  } else {
    assert.equal(first.completedTerms, 1);
    assert.equal(first.terms[0].mishap, true);
  }
});

test("each term adds skill points, age and money", () => {
  const draft = originDraft({ attributes: { intellect: 3 } });
  const before = buildCharacter(draft).view;
  const after = liveOneTerm(draft);
  assert.equal(after.skillPoints.budget, before.skillPoints.budget + 3);
  assert.equal(after.sheet.age, before.sheet.age + 4);
  assert.ok(after.credits.start > before.credits.start);
  assert.ok(after.sheet.learning < before.sheet.learning);
});

test("life has to end at the Fall before a character is complete", () => {
  const draft = randomDraft({ seed: 11 });
  assert.equal(buildCharacter(draft).complete, true);
  draft.life.fall = null;
  const noFall = buildCharacter(draft).view;
  assert.equal(noFall.life.stage, "fall");
  assert.ok(noFall.errors.life.length);
  draft.life.fall = "captured";
  const captured = buildCharacter(draft);
  assert.equal(captured.complete || captured.view.errors.traits.length > 0, true);
  assert.ok(captured.game.traits.includes("hears_the_song") || captured.view.life.fall);
  assert.ok(captured.game.character.biography.at(-1).includes("The Fall"));
});

test("you can't serve more than six terms", () => {
  const draft = originDraft({ attributes: { endurance: 8, intellect: 8, presence: 8 } });
  for (let i = 0; i < 12 && draft.life.terms.length < 6; i += 1) {
    const { view } = buildCharacter(draft);
    if (view.life.stage === "event") {
      draft.life.terms.at(-1).choice = view.life.pending.choices[0].id;
    } else {
      const open = view.life.careers.find((c) => !c.blocked);
      draft.life.terms.push({ career: open.id, choice: null });
    }
  }
  for (let i = 0; i < 3; i += 1) {
    const { view } = buildCharacter(draft);
    if (view.life.stage === "event") draft.life.terms.at(-1).choice = view.life.pending.choices[0].id;
  }
  const { view } = buildCharacter(draft);
  assert.equal(view.life.reachedLimit, true);
  assert.equal(view.life.stage, "fall");
  const tooMany = normalizeDraft({ life: { terms: Array.from({ length: 20 }, () => ({ career: "navy" })) } });
  assert.equal(tooMany.life.terms.length, 6);
});

test("careers can have requirements, and being forced out blocks going straight back", () => {
  const lowResonance = buildCharacter(originDraft({ attributes: { resonance: 2 } })).view.life.careers.find((c) => c.id === "adept");
  assert.match(lowResonance.blocked, /Requires Resonance 4/);
  const highResonance = buildCharacter(originDraft({ attributes: { resonance: 5 } })).view.life.careers.find((c) => c.id === "adept");
  assert.equal(highResonance.blocked, null);
  const synthetic = buildCharacter(originDraft({ species: "synthetic" })).view.life.careers.find((c) => c.id === "hegemony");
  assert.match(synthetic.blocked, /Not open/);

  // A term with a forced-out outcome means that career is closed next term, and the sim refuses it.
  let found = 0;
  for (let seed = 0; seed < 60 && found < 3; seed += 1) {
    const draft = originDraft({ life: { seed } });
    const { view } = (draft.life.terms.push({ career: "agent", choice: null }), buildCharacter(draft));
    if (view.life.stage === "event") draft.life.terms[0].choice = view.life.pending.choices[0].id;
    const after = buildCharacter(draft).view;
    if (after.life.blocked) {
      found += 1;
      assert.ok(after.life.careers.find((c) => c.id === "agent").blocked);
      draft.life.terms.push({ career: "agent", choice: null });
      const refused = buildCharacter(draft).view;
      assert.ok(refused.errors.life[0].includes("no longer valid"));
    }
  }
  assert.ok(found >= 1);
});

test("life events change the character", () => {
  // Trying every event and choice directly makes sure each one can actually be applied.
  const base = originDraft();
  const attrs = Object.fromEntries(Object.keys(STATS).map((id) => [id, 5]));
  for (let seed = 0; seed < 400; seed += 1) {
    const draft = { ...base, life: { seed, terms: [], finished: false, fall: null } };
    for (let i = 0; i < 6; i += 1) {
      draft.life.terms.push({ career: Object.keys(CAREERS)[(seed + i) % Object.keys(CAREERS).length], choice: null });
      const life = simulateLife(draft, attrs, {});
      if (life.invalid) {
        draft.life.terms.pop();
        break;
      }
      if (life.stage === "event") {
        const options = life.pending.choices;
        draft.life.terms.at(-1).choice = options[seed % options.length].id;
      }
    }
    const life = simulateLife(draft, attrs, {});
    assert.ok(life.biography.every((line) => !line.includes("{name}") && !line.includes("undefined")), `seed ${seed}`);
    assert.ok(life.terms.every((t) => !t.eventText?.includes("{name}") && !t.outcomeText?.includes("{name}")), `seed ${seed}`);
    assert.ok(life.contacts.every((c) => c.name && !c.note.includes("{name}")), `seed ${seed}`);
    assert.ok(life.hooks.every((h) => !h.includes("{name}")), `seed ${seed}`);
  }
});

test("skill points can't be overspent, tagging gives a free rank, and ranks have a cap", () => {
  const draft = randomDraft({ seed: 3, archetype: "officer" });
  const before = buildCharacter(draft).view;
  const id = Object.keys(SKILLS).find((s) => !before.skills[s].tagged && before.skills[s].rank === 0);
  assert.ok(id);
  draft.tags = [draft.tags[0], draft.tags[1], id];
  const tagged = buildCharacter(draft).view;
  assert.equal(tagged.skills[id].rank, 1);
  assert.equal(tagged.skills[id].free, 1);

  draft.skills = {};
  for (const s of Object.keys(SKILLS)) draft.skills[s] = 6;
  const greedy = buildCharacter(draft).view;
  assert.ok(greedy.errors.skills[0].includes("overspent"));
  assert.ok(Object.values(greedy.skills).every((s) => s.rank <= 6 || s.bought === 0));

  draft.skills = {};
  draft.tags = ["melee"];
  assert.ok(buildCharacter(draft).view.errors.skills[0].includes("Tag 2 more"));
});

test("traits are limited by points, conflicts, species and requirements", () => {
  const draft = randomDraft({ seed: 5, archetype: "marine" });
  draft.traits = [];
  const start = buildCharacter(draft).view;
  const budget = start.traitPoints.left;

  draft.traits = ["iron_constitution", "quick_reflexes", "gene_tailored", "cyber_arm", "born_leader"];
  assert.ok(buildCharacter(draft).view.errors.traits.some((e) => e.includes("overspent")) || budget >= 10);

  draft.traits = ["iron_constitution", "frail"];
  assert.ok(buildCharacter(draft).view.errors.traits.some((e) => e.includes("Can't be combined")));

  const synthetic = randomDraft({ seed: 5, archetype: "ghost" });
  synthetic.traits = ["cyber_arm"];
  assert.ok(buildCharacter(synthetic).view.errors.traits.some((e) => e.includes("Not available")));
  assert.ok(buildCharacter(synthetic).view.traits.latent_resonant.problem);

  draft.traits = ["frail", "chronic_illness", "fear_of_machines"];
  assert.ok(buildCharacter(draft).view.errors.traits.some((e) => e.includes("Flaws")));

  draft.attributes.resonance = 1;
  draft.traits = [];
  assert.match(buildCharacter(draft).view.traits.prophetic_dreams.problem ?? "", /Requires Resonance 3|Can't/);
});

test("flaws earn extra trait points, and traits really change the numbers", () => {
  const draft = randomDraft({ seed: 9, archetype: "doctor" });
  draft.traits = [];
  const plain = buildCharacter(draft);
  draft.traits = ["old_wound"];
  const flawed = buildCharacter(draft);
  if (!plain.game.traits.includes("old_wound")) {
    assert.equal(flawed.view.traitPoints.left, plain.view.traitPoints.left + 1);
    assert.equal(maxHp(flawed.game), maxHp(plain.game) - 5);
  }
  draft.traits = ["iron_constitution"];
  const tough = buildCharacter(draft);
  if (!plain.game.traits.includes("frail")) assert.equal(maxHp(tough.game), maxHp(plain.game) + 12);
});

test("beliefs change faction standing, crew attitudes and convictions", () => {
  const authoritarian = randomDraft({ seed: 2, archetype: "officer" });
  authoritarian.ideology = { authority: -6, loyalty: -3, violence: 5, belief: -3, flesh: -2 };
  const rebel = JSON.parse(JSON.stringify(authoritarian));
  rebel.ideology = { authority: 6, loyalty: 3, violence: -5, belief: 3, flesh: 2 };
  const a = buildCharacter(authoritarian).view;
  const b = buildCharacter(rebel).view;
  const standing = (view, id) => view.factions.find((f) => f.id === id).value;
  assert.ok(standing(a, "hegemony") > standing(b, "hegemony"));
  assert.ok(standing(a, "drift") < standing(b, "drift"));
  assert.ok(a.convictions.some((c) => c.id === "order"));
  assert.ok(!b.convictions.some((c) => c.id === "order"));
  assert.notDeepEqual(a.crew, b.crew);
  assert.notEqual(a.ideologyTitle, b.ideologyTitle);
});

test("gear costs credits, can't be overspent, and the kit is free", () => {
  const draft = randomDraft({ seed: 4, archetype: "officer" });
  draft.gear = {};
  const free = buildCharacter(draft);
  assert.ok(free.game.credits >= ITEMS.medkit.price);
  assert.equal(free.view.credits.spent, 0);
  assert.equal(free.game.credits, free.view.credits.start);
  assert.ok(free.view.kit.every((id) => free.game.inventory[id] >= 1));

  draft.gear = { medkit: 1 };
  const bought = buildCharacter(draft);
  assert.equal(bought.game.credits, free.game.credits - ITEMS.medkit.price);
  assert.equal(bought.game.inventory.medkit, (free.game.inventory.medkit ?? 0) + 1);

  draft.gear = { ghostweave: 9 };
  assert.ok(buildCharacter(draft).view.credits.left < 0 ? buildCharacter(draft).view.errors.gear[0].includes("overspent") : true);
});

test("the best weapon you can actually use is equipped", () => {
  const draft = randomDraft({ seed: 6, archetype: "marine" });
  draft.gear = { heavy_carbine: 1 };
  const game = buildCharacter(draft).game;
  if (game.credits >= 0) assert.equal(game.equipped.weapon, "heavy_carbine");
});

test("the character's identity reaches the AI", () => {
  const draft = randomDraft({ seed: 8, archetype: "adept", keep: { name: "Sel Aurin", pronouns: "custom", customPronouns: "ze/zir", appearance: "A silver scar across one cheek.", callsign: "Echo" } });
  const game = createGameFromDraft(draft);
  const dossier = aiDossier(game);
  assert.equal(game.name, "Sel Aurin");
  assert.match(dossier, /ze\/zir/);
  assert.match(dossier, /silver scar/);
  assert.match(dossier, /Echo/);
  assert.match(dossier, /Ilari/);
  assert.match(aiSnapshot(game), /ze\/zir/);
  assert.match(aiSnapshot(game), /Beliefs:/);
});

test("a chosen bond becomes a contact with the chosen name", () => {
  const draft = randomDraft({ seed: 12, archetype: "officer" });
  draft.bond = "sibling";
  draft.bondName = "Aya";
  const game = buildCharacter(draft).game;
  assert.ok(game.contacts.some((c) => c.name === "Aya" && c.attitude === "friendly"));
  assert.match(aiDossier(game), /Closest bond: Aya/);
  assert.match(publicState(game).dossier.bond, /Aya/);
  draft.bond = "no_one";
  const alone = buildCharacter(draft).game;
  assert.ok(!alone.contacts.some((c) => c.name === "Aya"));
  assert.match(aiDossier(alone), /Closest bond: No one/);
});

// ---- Old saves ----------------------------------------------------------

const oldSave = (background) => ({
  version: 1, name: "Old Hand", background, level: 3, xp: 40, statPoints: 1, perkPoints: 2,
  stats: { might: 3, agility: 3, intellect: 3, presence: 4, resonance: 1 }, hp: 20, energy: 5, credits: 321,
  perks: ["chain_of_command", "steady_aim"], inventory: { sidearm: 1, flak_vest: 1, medkit: 2 }, equipped: { weapon: "sidearm", armor: "flak_vest" },
  ship: { name: "CFS Meridian", hull: 70, maxHull: 100, fuel: 6, maxFuel: 12, morale: 55 }, location: "haven",
  factions: { fleet: 20, hegemony: -10, drift: 0, ilun: 5 }, quests: [], contacts: [{ name: "Ilya Voss", attitude: "friendly", note: "XO" }], journal: [{ turn: 1, entry: "Met Voss." }],
  combat: null, transcript: [{ role: "player", text: "Hello" }], turn: 2, ai: { provider: "claude", messages: [{ role: "user", content: "x" }] },
});

test("old saves still load, keep their progress and work with the new rules", () => {
  for (const background of ["officer", "smuggler", "adept", "engineer", "envoy", "something_unknown"]) {
    const game = migrateGame(oldSave(background));
    assert.equal(game.version, 15);
    assert.deepEqual(game.lore, []);
    assert.ok(game.seenLore.length > 0);
    assert.equal(game.name, "Old Hand");
    assert.equal(game.level, 3);
    assert.equal(game.credits, 321);
    assert.equal(game.journal.length, 1);
    assert.equal(game.transcript.filter((entry) => entry.role === "player").length, 1);
    assert.equal(game.stats.presence, 4);
    assert.equal(game.stats.endurance, 3);
    assert.deepEqual(game.ai, { provider: null, messages: [] });
    assert.equal(game.contacts.filter((c) => c.name === "Ilya Voss").length, 1);
    assert.equal(game.contacts.find((c) => c.name === "Ilya Voss").note, "XO");
    JSON.stringify(publicState(game));
    assert.ok(aiDossier(game).includes("Old Hand"));
    assert.ok(maxHp(game) > 0);
    assert.ok(game.hp <= maxHp(game));
    assert.ok(game.energy <= maxEnergy(game));
    assert.equal(migrateGame({ ...oldSave(background), hp: 9999, energy: 9999 }).hp, maxHp(game));
  }
});

test("migrating twice changes nothing, and new saves are left alone", () => {
  const once = migrateGame(oldSave("engineer"));
  assert.deepEqual(migrateGame(JSON.parse(JSON.stringify(once))), once);
  const fresh = createGameFromDraft(randomDraft({ seed: 1 }));
  assert.equal(migrateGame(fresh), fresh);
});
