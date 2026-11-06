// Draws the story in the main window: who's speaking, lore links and their
// tooltips, consequences, and what each choice involves.

import { el, signed, zoom } from "./dom.js";
import {
  attributeSpeech, buildLoreIndex, buildVocab, colorForName, combatTone, findLoreEntry, latestOptions, loreEntries, oddsFor,
  parseNarration, parseNotice, segmentLore,
} from "./story.js";

const context = {
  setup: null,
  game: null,
  entries: [],
  index: buildLoreIndex([]),
  vocab: { skills: {}, poles: {} },
  openEntry: () => {},
};

export function initStory({ openEntry }) {
  context.openEntry = openEntry;
  installLoreEvents();
}

export function setStoryContext(setup, game) {
  context.setup = setup;
  context.game = game;
  if (!setup) return;
  context.vocab = buildVocab(setup.skills, setup.axes);
  context.entries = loreEntries(setup.lore, game);
  context.index = buildLoreIndex(context.entries);
}

export const loreCatalog = () => context.entries;
export const choicesFor = (transcript) => latestOptions(transcript, context.vocab);

// ---- Lore links and tooltips --------------------------------------------

function loreSpan(text, entry) {
  return el("span", {
    class: `lore lore-${entry.kind}`,
    tabindex: "0",
    role: "button",
    "data-lore": entry.id,
    "aria-label": `${text}: ${entry.text}`,
    ...(entry.color ? { style: `--speaker:${entry.color}` } : {}),
  }, text);
}

// Text with *emphasis* and links to lore, built as page elements so nothing is ever treated as HTML.
function inlineNodes(text, used) {
  const nodes = [];
  for (const piece of text.split(/(\*\*?[^*\n]+\*\*?)/g)) {
    if (!piece) continue;
    const emphasis = piece.match(/^(\*\*?)([^*\n]+)\*\*?$/);
    if (emphasis) {
      nodes.push(el(emphasis[1] === "**" ? "strong" : "em", {}, inlineNodes(emphasis[2], used)));
    } else {
      for (const segment of segmentLore(piece, context.index, used)) {
        nodes.push(segment.entry ? loreSpan(segment.text, segment.entry) : segment.text);
      }
    }
  }
  return nodes;
}

let tooltip = null;
let tooltipFor = null;

function hideTooltip() {
  tooltip?.remove();
  tooltip = null;
  tooltipFor = null;
}

// A redraw can take away the word under the pointer, and then the browser never says the pointer left it.
export function dropStaleTooltip() {
  if (tooltipFor && !tooltipFor.isConnected) hideTooltip();
}

function showTooltip(target) {
  const entry = context.index.byId.get(target.dataset.lore);
  if (!entry) return;
  hideTooltip();
  tooltipFor = target;
  tooltip = el("div", { class: "tooltip", role: "tooltip", ...(entry.color ? { style: `--speaker:${entry.color}` } : {}) },
    el("div", { class: `tooltip-title lore-${entry.kind}` }, entry.name),
    el("div", {}, entry.text),
    entry.status && el("div", { class: "tooltip-status" }, entry.status),
    !isTouch() && el("div", { class: "tooltip-hint" }, entry.kind === "person" ? "Click to open their file" : "Click to open the Codex"));
  document.body.append(tooltip);
  // Sits below the word if there's room, otherwise above it, and always on screen.
  const box = target.getBoundingClientRect();
  const size = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(box.left, window.innerWidth - size.width - 8));
  const below = box.bottom + 6;
  const top = below + size.height > window.innerHeight - 8 ? Math.max(8, box.top - size.height - 6) : below;
  // The screen's own measure, and the interface may be drawn bigger or smaller than that.
  tooltip.style.left = `${left / zoom()}px`;
  tooltip.style.top = `${top / zoom()}px`;
}

const isTouch = () => window.matchMedia("(hover: none)").matches;
const loreTarget = (event) => event.target.closest?.("[data-lore]");

function installLoreEvents() {
  document.addEventListener("mouseover", (e) => {
    const target = loreTarget(e);
    if (target) showTooltip(target);
  });
  document.addEventListener("mouseout", (e) => {
    if (loreTarget(e)) hideTooltip();
  });
  document.addEventListener("focusin", (e) => {
    const target = loreTarget(e);
    if (target) showTooltip(target);
  });
  document.addEventListener("focusout", (e) => {
    if (loreTarget(e)) hideTooltip();
  });
  document.addEventListener("click", (e) => {
    const target = loreTarget(e);
    if (!target) {
      hideTooltip();
      return;
    }
    // On a phone, a tap only shows the description.
    if (isTouch()) {
      showTooltip(target);
      return;
    }
    hideTooltip();
    const entry = context.index.byId.get(target.dataset.lore);
    if (entry) context.openEntry(entry);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTooltip();
    const target = loreTarget(e);
    if (target && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      target.click();
    }
  });
  document.addEventListener("scroll", hideTooltip, true);
}

// ---- Passages -----------------------------------------------------------

function partsNodes(parts, used) {
  return parts.map((part) => el("span", { class: part.kind }, inlineNodes(part.text, used)));
}

const VOICE_LABELS = { comm: "over comms", machine: "machine voice", choir: "the song" };

// How someone's speech looks: their color, and what kind of voice it is.
export function speakerOf(block) {
  const entry = findLoreEntry(block.speaker, context.index);
  const voice = block.voice ?? entry?.voiceStyle ?? null;
  return { name: block.speaker, entry, color: entry?.color ?? colorForName(block.speaker), voiceStyle: voice, voice: VOICE_LABELS[voice] ?? null };
}

function speechNode(block, used) {
  const { entry, color, voiceStyle: voice } = speakerOf(block);
  if (entry) used.add(entry.id);
  return el("div", { class: `speech${voice ? ` voice-${voice}` : ""}`, style: `--speaker:${color}` },
    el("div", { class: "speaker-line" },
      el("span", {
        class: "speaker",
        ...(entry ? { tabindex: "0", role: "button", "data-lore": entry.id, "aria-label": `${block.speaker}: ${entry.text}` } : {}),
      }, block.speaker),
      VOICE_LABELS[voice] && el("span", { class: "voice-tag" }, VOICE_LABELS[voice])),
    el("div", { class: "speech-body" }, partsNodes(block.parts, used)));
}

// One piece of a passage: narration, someone speaking or a consequence.
export function blockNode(block, used = new Set()) {
  if (block.type === "speech") return speechNode(block, used);
  if (block.type === "consequence") {
    return el("div", { class: "consequence" }, el("div", { class: "consequence-label" }, "Consequence"), el("div", {}, inlineNodes(block.text, used)));
  }
  return el("p", { class: "narration" }, partsNodes(block.parts, used));
}

// The game master's text in pieces, for showing a piece at a time, and the words of one of them.
export const sceneBlocks = (text, options) => attributeSpeech(parseNarration(text, options), context.index);
export const wordNodes = (parts) => partsNodes(parts, new Set());

function passageNode(text, streaming) {
  const blocks = sceneBlocks(text, { streaming });
  const used = new Set();
  const nodes = blocks.map((block) => blockNode(block, used));
  if (!nodes.length) return null;
  if (streaming) (nodes.at(-1).querySelector(".speech-body") ?? nodes.at(-1)).append(el("span", { class: "cursor", "aria-hidden": "true" }));
  return el("div", { class: "passage" }, nodes);
}

function playerNode(text) {
  return el("div", { class: "player-line" },
    el("div", { class: "speaker player-name" }, context.game?.name ?? "You"),
    el("div", { class: "player-text" }, text));
}

function logLineNode(line) {
  if (line.result) {
    return el("div", { class: `log-line tone-${line.tone}` },
      el("span", { class: "log-tag" }, line.tag),
      el("span", { class: "log-text" },
        `${line.reason}: `,
        el("strong", {}, line.result),
        ` (${line.total} vs ${line.dc})`,
        el("span", { class: "log-math" }, ` ${line.math}`)));
  }
  return el("div", { class: `log-line tone-${line.tone}` },
    el("span", { class: "log-tag" }, line.tag),
    el("span", { class: "log-text" }, line.text));
}

// What was said in a talk, folded away under the one line it left in the story.
function talkRecordNode(lines) {
  return el("details", { class: "talk-record" }, el("summary", {}, "What was said"), lines.map((line) => storyEntryNode(line)));
}

// Draws one entry of the story. Returns nothing if there's nothing to show yet.
export function storyEntryNode(entry, { streaming = false } = {}) {
  switch (entry.role) {
    case "narrator": return passageNode(entry.text, streaming);
    case "player": return playerNode(entry.text);
    case "notice": return el("div", { class: "log-lines" }, parseNotice(entry.text).map(logLineNode), entry.talk && talkRecordNode(entry.talk));
    case "combat": return el("div", { class: "log-lines" }, el("div", { class: `log-line tone-${entry.tone ?? combatTone(entry.text)}` },
      el("span", { class: "log-tag" }, entry.tag),
      el("span", { class: "log-text" }, entry.text, entry.math && el("span", { class: "log-math" }, ` (${entry.math})`))));
    case "console": return el("div", { class: "console-text" }, entry.text);
    default: return el("div", { class: `entry ${entry.role}` }, entry.text);
  }
}

export const thinkingNode = () => el("div", { class: "thinking" }, "[GM] processing");

// ---- Choices ------------------------------------------------------------

function chip(text, tone, title, color) {
  return el("span", { class: `chip tone-${tone}`, title, ...(color ? { style: `color:${color}` } : {}) }, text);
}

function checkChip(tag) {
  const skill = context.game.skills.find((s) => s.id === tag.skill);
  if (!skill) return null;
  const name = skill.name.toUpperCase();
  const dc = context.setup.difficulty[tag.difficulty];
  if (!dc) return chip(`${name} ${signed(skill.bonus)}`, "info", `A ${skill.name} check. Your bonus is ${signed(skill.bonus)}.`);
  const odds = oddsFor(skill.bonus, dc);
  const tone = odds >= 65 ? "good" : odds <= 35 ? "bad" : "warn";
  return chip(`${name} ${odds}%`, tone, `${skill.name} check, ${tag.difficulty.replace("_", " ")} (${dc}). Your bonus is ${signed(skill.bonus)}, for about a ${odds}% chance before anything else affects it.`);
}

function beliefChip(tag) {
  const { axes, limits } = context.setup;
  const axis = Object.values(axes).find((a) => a.low.id === tag.pole || a.high.id === tag.pole);
  if (!axis) return null;
  const pole = axis.low.id === tag.pole ? axis.low : axis.high;
  const value = context.game.ideology.find((i) => i.id === axis.id)?.value ?? 0;
  const leaning = value * pole.sign;
  if (leaning <= -limits.convictionThreshold) {
    return chip(pole.name.toUpperCase(), "bad", `This expresses ${pole.name}, which goes against your convictions. Choosing it will cost you stress.`);
  }
  const steadies = leaning >= 3 ? " It fits what you already believe, so acting on it will steady you." : "";
  return chip(pole.name.toUpperCase(), "belief", `This expresses ${pole.name}, and will move your beliefs toward it.${steadies}`);
}

function personChip(tag) {
  const approves = tag.kind === "approve";
  const entry = findLoreEntry(tag.name, context.index);
  const short = tag.name.split(/\s+/).at(-1).toUpperCase();
  return chip(`${short} ${approves ? "+" : "-"}`, approves ? "good" : "bad", `${tag.name} would ${approves ? "approve" : "disapprove"}.`, entry?.color);
}

function tagChip(tag) {
  switch (tag.kind) {
    case "raw": return chip(tag.text, tag.tone, tag.title);
    case "check": return checkChip(tag);
    case "belief": return beliefChip(tag);
    case "approve": case "disapprove": return personChip(tag);
    case "warn": return chip(`! ${tag.text}`, "warn", tag.text);
    default: {
      const words = tag.text.replaceAll("_", " ");
      return chip(words.toUpperCase(), "info", words);
    }
  }
}

// A choice's tags and words, ready to go inside its button.
export function optionContent(option) {
  return [
    (option.tags ?? []).map(tagChip),
    el("span", { class: "option-label" }, option.label),
    option.detail && el("span", { class: "option-detail" }, option.detail),
    option.why && el("span", { class: "option-detail" }, option.why),
  ];
}
