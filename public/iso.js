// The isometric view: the same rooms, people and clicks as the walk-around view, drawn from an angle
// instead of in console art. The game makes every bit of it itself: the metal, the rock and the rust
// are worked out here, from each level's file and world/looks.json, so every room in the world has it,
// with no art from anywhere else and no graphics engine. walk.js still does the walking, and the
// server still decides everything.

import { el } from "./dom.js";

// A console square is about twice as tall as it's wide, so two columns make one tile.
export const CELL_WIDTH = 0.5;
export const WALL_HEIGHT = 1.7;
export const CUT_WALL_HEIGHT = 0.24;
const CUT_ROCK_HEIGHT = 0.3;
const BUILDING_HEIGHT = 1.25;
const FLOOR_EDGE = 0.22;
const DAIS_HEIGHT = 0.22;
const AMBIENT_BOOST = 1.6;
const SIZES = { smallest: 46, largest: 84 };
const ZOOMS = { smallest: 0.55, largest: 1.7 };
const MOST_TEXTURES = 300;
const FONT = '"Cascadia Mono", Consolas, "Lucida Console", "Courier New", monospace';
const BACKGROUND = "#030403";
const FALLBACK_COLORS = { floor: "#3a4040", walls: "#6a6e6c", scenery: "#8a8e80", writing: "#d8d4c0" };
const FALLBACK_LOOK = { floor: "deck", walls: "panels", rough: "rock", ambient: "#5c5f63", lights: ["#e0b070", "#8fb8c8"], glow: "#6fd0a0", fire: "#ff9a50" };
const SKIN = ["#d8b090", "#b98a64", "#8e6444", "#664834", "#e4c4a8"];
const HAIR = ["#2a2420", "#4a3424", "#6e5a3c", "#8a8680", "#1c1c20", "#5a2c20"];
const TROUSERS = ["#34322c", "#2c3034", "#3a342a", "#2a2c2a", "#40362c"];

// ---- From the plan to the screen ----------------------------------------

// Everything's worked out in tiles, and multiplied up by the size of a tile at the last moment.
export const project = (wx, wy, z = 0) => ({ u: (wx - wy) / 2, v: (wx + wy) / 4 - z / 2 });
export const cellCentre = (x, y) => ({ wx: (x + 0.5) * CELL_WIDTH, wy: y + 0.5 });

// Which square of the plan a point on the screen falls on, at floor level.
export function cellAt(u, v) {
  return { x: Math.floor((2 * v + u) / CELL_WIDTH), y: Math.floor(2 * v - u) };
}

// ---- Working out a level ------------------------------------------------

const kindOfMark = (mark) => (mark === "~" ? "water" : "*'.,`;".includes(mark) ? "spark" : "block");
const seeThrough = (kind) => ["floor", "door", "dim", "thing", "exit"].includes(kind);
const walkable = (kind) => kind === "floor" || kind === "door";
const hashOf = (x, y) => {
  const h = Math.imul((x * 73856093) ^ (y * 19349663), 2654435761) >>> 0;
  return (h >>> 8) / 16777216;
};

function heightOfMark(mark, look) {
  if (mark === "%") return look.rough === "plants" ? 0.3 : look.rough === "scrap" ? 0.6 : 1.05;
  if (mark === "\"") return 0.3;
  if ("|/\\".includes(mark)) return 1.05;
  if ("[]".includes(mark)) return 0.62;
  if (mark === "!") return 0.85;
  return 0.46;
}

// What a mark on the plan is, going by the marks around it.
function styleOfMark(mark, x, y, marks, look) {
  if (mark === "%") return look.rough;
  if (mark === "\"") return "plants";
  if (mark === "!") return "lamp";
  if ("|/\\".includes(mark)) return "post";
  if (mark === "[" && marks[y][x + 1] === "]") return "crate";
  if (mark === "]" && marks[y][x - 1] === "[") return "crate";
  if ("=[]<>(){}^&".includes(mark)) return look.machines === false ? "bench" : "machine";
  return "ledge";
}

// What's on each square, how high it stands and what it's like, from the same layers the console view
// draws. This doesn't touch the screen, so every level in the game can be checked by the tests.
export function buildScene(view) {
  const { cols, lines, layers } = view;
  const look = { ...FALLBACK_LOOK, ...view.look };
  const grid = (fill) => Array.from({ length: lines }, () => Array(cols).fill(fill));
  const kinds = grid("blank");
  const marks = grid(" ");
  const floors = grid(" ");
  const heights = grid(0);
  const styles = grid(null);
  const inPlan = (x, y) => x >= 0 && y >= 0 && x < cols && y < lines;
  const kindAt = (x, y) => (inPlan(x, y) ? kinds[y][x] : "out");
  const charAt = (layer, x, y) => layers[layer]?.[y]?.[x] ?? " ";

  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (charAt("floor", x, y) !== " ") {
        kinds[y][x] = "floor";
        floors[y][x] = charAt("floor", x, y);
      } else if (charAt("doors", x, y) !== " ") kinds[y][x] = "door";
      else if (charAt("walls", x, y) !== " ") kinds[y][x] = "wall";
      else if (charAt("scenery", x, y) !== " ") {
        marks[y][x] = charAt("scenery", x, y);
        kinds[y][x] = kindOfMark(marks[y][x]);
      }
    }
  }
  // Words are painted on whatever's under them.
  (layers.under ?? []).forEach((row, y) => [...row].forEach((was, x) => {
    if (was === "f") kinds[y][x] = "floor";
    else if (was === "w") kinds[y][x] = "wall";
    else if (was === "d") kinds[y][x] = "door";
    else if (was === "s") {
      marks[y][x] = "-";
      kinds[y][x] = "block";
    }
  }));
  // A wave on its own is a cloud or a wisp of steam. It's only water if there are more of them.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (marks[y][x] === "~" && ![-2, -1, 1, 2].some((dx) => marks[y][x + dx] === "~")) kinds[y][x] = "spark";
    }
  }
  // Stars come one at a time. A row of them is something burning.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (marks[y][x] === "*" && (marks[y][x - 1] === "*" || marks[y][x + 1] === "*")) kinds[y][x] = "glow";
    }
  }
  for (const thing of view.things ?? []) if (inPlan(thing.x, thing.y)) kinds[thing.y][thing.x] = "thing";
  for (const exit of view.exits ?? []) if (inPlan(exit.x, exit.y)) kinds[exit.y][exit.x] = "exit";

  const runs = [];
  (layers.writing ?? []).forEach((row, y) => {
    for (const match of row.matchAll(/\S+(?: {1,2}\S+)*/g)) runs.push({ text: match[0], x: match.index, y, length: match[0].length });
  });

  // Gaps between waves are water too.
  const isWave = (x, y) => marks[y]?.[x] === "~" && kinds[y][x] === "water";
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] === "blank" && (isWave(x - 1, y) || isWave(x + 1, y))) kinds[y][x] = "water";
    }
  }

  // Empty squares are outside if they reach the edge of the plan, the ground if they're beside somewhere
  // to walk, and the inside of something if they're shut in by its outline.
  const seen = grid(false);
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] !== "blank" || seen[y][x]) continue;
      const cells = [];
      const stack = [[x, y]];
      seen[y][x] = true;
      let edge = false;
      let beside = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
          const kind = kindAt(nx, ny);
          if (kind === "out") edge = true;
          else if (kind === "floor" || kind === "door") beside = true;
          else if (kind === "blank" && !seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      const kind = edge ? "void" : beside ? "dim" : "inside";
      const height = Math.min(BUILDING_HEIGHT, 0.7 + cells.length * 0.02);
      for (const [cx, cy] of cells) {
        kinds[cy][cx] = kind;
        if (kind === "inside") {
          heights[cy][cx] = height;
          styles[cy][cx] = "body";
        }
      }
    }
  }

  // Walls and rock between the camera and the room are cut down, or nobody could see in.
  const hides = (x, y) => seeThrough(kindAt(x, y - 1)) || seeThrough(kindAt(x - 1, y)) || seeThrough(kindAt(x - 1, y - 1));
  // An outline stands as high as whatever it's the outline of.
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] === "block") {
        let height = heightOfMark(marks[y][x], look);
        let style = styleOfMark(marks[y][x], x, y, marks, look);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (kindAt(x + dx, y + dy) === "inside" && heights[y + dy][x + dx] > height) {
              height = heights[y + dy][x + dx];
              style = "body";
            }
          }
        }
        if ((style === "rock" || style === "ice") && hides(x, y)) height = CUT_ROCK_HEIGHT;
        heights[y][x] = height;
        styles[y][x] = style;
      } else if (kinds[y][x] === "wall") {
        heights[y][x] = hides(x, y) ? CUT_WALL_HEIGHT : WALL_HEIGHT;
        styles[y][x] = "wall";
      }
    }
  }
  // One big thing in place of what's drawn on the plan, standing on a dais that covers whatever can't be walked on.
  const { shape } = look;
  if (shape) {
    for (let y = shape.from[1]; y <= shape.to[1]; y += 1) {
      for (let x = shape.from[0]; x <= shape.to[0]; x += 1) {
        if (!["block", "inside", "dim", "spark", "glow"].includes(kindAt(x, y))) continue;
        kinds[y][x] = "block";
        marks[y][x] = "-";
        heights[y][x] = DAIS_HEIGHT;
        styles[y][x] = "dais";
      }
    }
  }
  for (const run of runs) {
    const kind = kinds[run.y][run.x];
    run.on = kind === "wall" ? "wall" : heights[run.y][run.x] > 0 ? "roof" : "ground";
    // Words on bare ground are on the level's floor, as far as anyone can see.
    if (kind === "dim") for (let i = 0; i < run.length; i += 1) if (kinds[run.y][run.x + i] === "dim") kinds[run.y][run.x + i] = "floor";
  }

  const heightAt = (x, y) => (inPlan(x, y) ? heights[y][x] : 0);
  const blocks = [];
  const ground = [];
  const water = [];
  const sparks = [];
  const glows = [];
  let bounds = null;
  const spanOf = (x, y, top, bottom = 0) => {
    const found = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity };
    for (const [wx, wy] of [[x * CELL_WIDTH, y], [(x + 1) * CELL_WIDTH, y], [x * CELL_WIDTH, y + 1], [(x + 1) * CELL_WIDTH, y + 1]]) {
      for (const z of [top, bottom]) {
        const { u, v } = project(wx, wy, z);
        found.minU = Math.min(found.minU, u);
        found.maxU = Math.max(found.maxU, u);
        found.minV = Math.min(found.minV, v);
        found.maxV = Math.max(found.maxV, v);
      }
    }
    return found;
  };
  const reach = (span) => {
    bounds = bounds ?? { ...span };
    bounds.minU = Math.min(bounds.minU, span.minU);
    bounds.maxU = Math.max(bounds.maxU, span.maxU);
    bounds.minV = Math.min(bounds.minV, span.minV);
    bounds.maxV = Math.max(bounds.maxV, span.maxV);
  };
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const kind = kinds[y][x];
      if (kind === "void") continue;
      const { wx, wy } = cellCentre(x, y);
      reach(spanOf(x, y, heightAt(x, y), -FLOOR_EDGE));
      if (kind === "water") water.push({ x, y, seed: hashOf(x, y) });
      else if (kind === "glow") glows.push({ x, y, seed: hashOf(x, y) });
      else if (kind === "spark") sparks.push({ x, y, seed: hashOf(x, y), mark: marks[y][x] });
      else ground.push({ x, y, kind, seed: hashOf(x, y), mark: floors[y][x] });
      if (heights[y][x] > 0) {
        blocks.push({
          type: "block",
          x,
          y,
          h: heights[y][x],
          style: styles[y][x],
          mark: marks[y][x],
          seed: hashOf(x, y),
          right: heightAt(x + 1, y),
          left: heightAt(x, y + 1),
          back: heightAt(x, y - 1),
          side: heightAt(x - 1, y),
          depth: wx + wy,
          span: spanOf(x, y, heights[y][x]),
        });
      }
    }
  }
  if (shape) {
    const wx = ((shape.from[0] + shape.to[0] + 1) / 2) * CELL_WIDTH;
    const wy = (shape.from[1] + shape.to[1] + 1) / 2;
    const radius = (shape.to[1] - shape.from[1] + 1) / 2 - 0.15;
    const h = DAIS_HEIGHT + 0.32;
    const top = project(wx, wy, h);
    // The whole of it is drawn after the dais under it, though people are only behind it if they're behind the middle of it.
    blocks.push({ type: "block", style: shape.kind, x: shape.from[0], y: shape.from[1], wx, wy, radius, h, seed: 0, mark: " ", right: 0, left: 0, back: 0, side: 0, depth: wx + wy, frontDepth: (shape.to[0] + 1) * CELL_WIDTH + shape.to[1] + 1, span: { minU: top.u - radius, maxU: top.u + radius, minV: top.v - radius / 2, maxV: top.v + radius / 2 + h } });
  }
  blocks.sort((a, b) => a.depth - b.depth);

  // Lamps you can see, on the walls at the back of the room, and a pool of light on the floor in front of each.
  const lights = [];
  const addLight = (x, y, color, radius, power) => {
    const { wx, wy } = cellCentre(x, y);
    lights.push({ wx, wy, color, radius, power });
  };
  const pick = (seed) => look.lights[Math.floor(seed * look.lights.length) % look.lights.length];
  const painted = (x, y) => runs.some((run) => run.y === y && x >= run.x && x < run.x + run.length);
  const fixtures = [];
  for (let y = 0; y < lines; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (kinds[y][x] !== "wall" || heights[y][x] !== WALL_HEIGHT || painted(x, y)) continue;
      const seed = hashOf(x, y);
      if (seeThrough(kindAt(x, y + 1)) && (x + y * 5) % 18 === 7) {
        fixtures.push({ x, y, face: "left", color: pick(seed) });
        addLight(x, y + 2, pick(seed), 3.6 + seed * 1.4, 0.95);
      } else if (!seeThrough(kindAt(x, y + 1)) && seeThrough(kindAt(x + 1, y)) && (x + y * 3) % 9 === 4) {
        fixtures.push({ x, y, face: "right", color: pick(seed) });
        addLight(x + 3, y, pick(seed), 3.6 + seed * 1.4, 0.95);
      }
    }
  }
  // And a thinner scatter over the rest of the floor, so that nowhere's completely black. Where there are no lamps
  // on the walls, this is all the light there is.
  const fill = fixtures.length >= 2 ? 0.5 : 1;
  for (let y = 2; y < lines + 2; y += 6) {
    for (let x = 4; x < cols + 4; x += 15) {
      const seed = hashOf(x, y);
      const lx = x + Math.floor(seed * 7) - 3;
      const ly = y + Math.floor(hashOf(y, x) * 4) - 2;
      if (seeThrough(kindAt(lx, ly))) addLight(lx, ly, pick(seed), 3.2 + seed * 2.6, (0.7 + hashOf(lx, ly) * 0.3) * fill);
    }
  }
  glows.filter((cell) => cell.seed > 0.8).forEach((cell) => addLight(cell.x, cell.y, look.fire, 2.6, 0.9));
  if (!lights.length && ground.length) {
    const middle = ground[Math.floor(ground.length / 2)];
    addLight(middle.x, middle.y, pick(0.3), 5, 0.9);
  }
  blocks.filter((block) => block.style === "lamp" && block.seed > 0.5).forEach((block) => addLight(block.x, block.y, pick(block.seed), 2.4, 0.8));
  blocks.filter((block) => block.style === "machine" && block.seed > 0.86).forEach((block) => addLight(block.x, block.y, look.glow, 1.5, 0.5));
  for (const exit of view.exits ?? []) addLight(exit.x, exit.y, exit.closed ? "#c86048" : "#d8d0b0", 1.8, 0.55);

  return {
    cols,
    lines,
    kinds,
    heights,
    styles,
    blocks,
    ground,
    water,
    sparks,
    glows,
    runs,
    lights,
    fixtures,
    junk: ground.filter((cell) => cell.kind === "dim" && cell.seed > 0.68),
    look,
    bounds: bounds ?? { minU: -1, maxU: 1, minV: -1, maxV: 1 },
    colors: { ...FALLBACK_COLORS, ...view.colors },
  };
}

// ---- Colors -------------------------------------------------------------

function rgbOf(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const see = (hex, alpha) => {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${alpha})`;
};
const mix = (hex, other, by) => {
  const [r, g, b] = rgbOf(hex);
  const [r2, g2, b2] = rgbOf(other);
  return `#${[r + (r2 - r) * by, g + (g2 - g) * by, b + (b2 - b) * by].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
};
const scaled = (hex, by) => mix(hex, by > 1 ? "#ffffff" : "#000000", by > 1 ? by - 1 : 1 - by);
const hexOr = (color, fallback) => (/^#[0-9a-f]{6}$/i.test(color ?? "") ? color : fallback);

// ---- What things are made of --------------------------------------------

// A little random-number maker of its own, so that the same room always gets the same scratches.
function randomFrom(text) {
  let seed = 0;
  for (const ch of text) seed = (Math.imul(seed, 31) + ch.codePointAt(0)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function newCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function grain(ctx, size, amount, random) {
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const by = (random() - 0.5) * amount;
    image.data[i] += by;
    image.data[i + 1] += by;
    image.data[i + 2] += by;
  }
  ctx.putImageData(image, 0, 0);
}

function stains(ctx, size, color, count, spread, strength, random) {
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const r = spread * (0.4 + random());
    const blot = ctx.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, see(color, strength * (0.4 + random() * 0.6)));
    blot.addColorStop(1, see(color, 0));
    ctx.fillStyle = blot;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function scratches(ctx, size, count, random, color = "rgba(255,255,255,.07)") {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i += 1) {
    const x = random() * size;
    const y = random() * size;
    const angle = random() * Math.PI;
    const long = 6 + random() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * long, y + Math.sin(angle) * long);
    ctx.stroke();
  }
}

function crack(ctx, size, random, strength = 0.4) {
  let x = random() * size;
  let y = random() * size;
  ctx.strokeStyle = `rgba(0,0,0,${strength})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let i = 0; i < 7; i += 1) {
    x += (random() - 0.5) * 18 + 3;
    y += (random() - 0.5) * 18 + 3;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function rivet(ctx, x, y) {
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(x - 1, y - 1, 3, 3);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fillRect(x - 1, y - 1, 1, 1);
}

function seams(ctx, size, random) {
  ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.1})`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(0, 0, 2, size);
  ctx.fillRect(0, 0, size, 2);
  ctx.fillStyle = "rgba(255,255,255,.1)";
  ctx.fillRect(2, 2, 1, size - 2);
  ctx.fillRect(2, 2, size - 2, 1);
}

const RUST = "#6a3a18";

// One tile of each floor: 128 by 128, and the size it's drawn at doesn't matter much.
const FLOORS = {
  deck(ctx, size, random, variant) {
    grain(ctx, size, 16, random);
    if (variant === 1) {
      // Tread plate.
      ctx.fillStyle = "rgba(255,255,255,.05)";
      for (let y = 6; y < size; y += 14) for (let x = (y % 28 ? 0 : 7) + 3; x < size; x += 14) ctx.fillRect(x, y, 6, 2);
    }
    stains(ctx, size, RUST, 3 + Math.floor(random() * 4), 26, 0.28, random);
    stains(ctx, size, "#000000", 3, 34, 0.25, random);
    scratches(ctx, size, 7, random);
    if (variant === 3) {
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(40, 44, 48, 40);
      ctx.fillStyle = "rgba(255,255,255,.1)";
      for (let x = 44; x < 88; x += 8) ctx.fillRect(x, 44, 2, 40);
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(40, 44, 48, 40);
    }
    seams(ctx, size, random);
    for (const [x, y] of [[7, 7], [size - 8, 7], [7, size - 8], [size - 8, size - 8]]) rivet(ctx, x, y);
  },
  grate(ctx, size, random) {
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "rgba(255,255,255,.1)";
    for (let i = 0; i < size; i += 10) {
      ctx.fillRect(i, 0, 3, size);
      ctx.fillRect(0, i, size, 3);
    }
    grain(ctx, size, 14, random);
    stains(ctx, size, RUST, 4, 24, 0.3, random);
    seams(ctx, size, random);
  },
  concrete(ctx, size, random) {
    grain(ctx, size, 26, random);
    stains(ctx, size, "#000000", 6, 30, 0.2, random);
    stains(ctx, size, "#ffffff", 3, 24, 0.05, random);
    crack(ctx, size, random);
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(0, 0, size, 1);
    ctx.fillRect(0, 0, 1, size);
  },
  dirt(ctx, size, random) {
    grain(ctx, size, 34, random);
    stains(ctx, size, "#000000", 7, 26, 0.22, random);
    stains(ctx, size, "#b09868", 4, 22, 0.1, random);
    for (let i = 0; i < 26; i += 1) {
      ctx.fillStyle = random() > 0.5 ? "rgba(0,0,0,.35)" : "rgba(255,240,210,.14)";
      ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 2);
    }
  },
  soil(ctx, size, random) {
    grain(ctx, size, 30, random);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    for (let y = 8; y < size; y += 16) ctx.fillRect(0, y, size, 6);
    stains(ctx, size, "#000000", 5, 24, 0.2, random);
  },
  stone(ctx, size, random) {
    const half = size / 2;
    for (const [x, y] of [[0, 0], [half, 0], [0, half], [half, half]]) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.09})`;
      ctx.fillRect(x, y, half, half);
    }
    grain(ctx, size, 20, random);
    stains(ctx, size, "#000000", 5, 26, 0.18, random);
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.fillRect(0, 0, size, 2);
    ctx.fillRect(0, 0, 2, size);
    ctx.fillRect(half, 0, 2, size);
    ctx.fillRect(0, half, size, 2);
    if (random() > 0.6) crack(ctx, size, random, 0.3);
  },
  tile(ctx, size, random) {
    const step = size / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.07})`;
        ctx.fillRect(x * step, y * step, step, step);
      }
    }
    grain(ctx, size, 10, random);
    stains(ctx, size, "#2a2418", 4, 24, 0.22, random);
    ctx.fillStyle = "rgba(0,0,0,.42)";
    for (let i = 0; i < size; i += step) {
      ctx.fillRect(i, 0, 1, size);
      ctx.fillRect(0, i, size, 1);
    }
  },
  wood(ctx, size, random) {
    const plank = size / 4;
    for (let y = 0; y < 4; y += 1) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,220,180" : "0,0,0"},${random() * 0.12})`;
      ctx.fillRect(0, y * plank, size, plank);
    }
    ctx.strokeStyle = "rgba(0,0,0,.14)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 26; i += 1) {
      const y = random() * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(size / 3, y + random() * 4 - 2, (size * 2) / 3, y + random() * 4 - 2, size, y);
      ctx.stroke();
    }
    grain(ctx, size, 14, random);
    stains(ctx, size, "#000000", 3, 26, 0.2, random);
    ctx.fillStyle = "rgba(0,0,0,.6)";
    for (let y = 0; y < 4; y += 1) ctx.fillRect(0, y * plank, size, 1);
    ctx.fillRect(Math.floor(random() * size), 0, 1, plank);
    ctx.fillRect(Math.floor(random() * size), plank * 2, 1, plank);
  },
  carpet(ctx, size, random) {
    grain(ctx, size, 22, random);
    ctx.strokeStyle = "rgba(255,220,160,.1)";
    ctx.lineWidth = 1;
    ctx.strokeRect(size * 0.12, size * 0.12, size * 0.76, size * 0.76);
    ctx.beginPath();
    ctx.moveTo(size / 2, size * 0.28);
    ctx.lineTo(size * 0.72, size / 2);
    ctx.lineTo(size / 2, size * 0.72);
    ctx.lineTo(size * 0.28, size / 2);
    ctx.closePath();
    ctx.stroke();
    stains(ctx, size, "#000000", 5, 28, 0.2, random);
  },
  rock(ctx, size, random) {
    grain(ctx, size, 34, random);
    stains(ctx, size, "#000000", 9, 28, 0.3, random);
    stains(ctx, size, "#ffffff", 3, 18, 0.05, random);
    for (let i = 0; i < 3; i += 1) crack(ctx, size, random, 0.35);
  },
  ice(ctx, size, random) {
    grain(ctx, size, 12, random);
    stains(ctx, size, "#ffffff", 5, 30, 0.12, random);
    stains(ctx, size, "#102030", 4, 26, 0.2, random);
    scratches(ctx, size, 12, random, "rgba(255,255,255,.14)");
    crack(ctx, size, random, 0.2);
  },
  wet(ctx, size, random) {
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 6, 30, 0.3, random);
    stains(ctx, size, "#9fc8d8", 3, 22, 0.14, random);
    crack(ctx, size, random, 0.3);
    seams(ctx, size, random);
  },
  alien(ctx, size, random) {
    grain(ctx, size, 8, random);
    ctx.strokeStyle = "rgba(200,210,255,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(random() * size, 0);
      ctx.bezierCurveTo(random() * size, size / 3, random() * size, (size * 2) / 3, random() * size, size);
      ctx.stroke();
    }
    stains(ctx, size, "#000000", 4, 34, 0.25, random);
  },
};

const pipeAcross = (ctx, size, y, thick) => {
  const pipe = ctx.createLinearGradient(0, y, 0, y + thick);
  pipe.addColorStop(0, "rgba(255,255,255,.16)");
  pipe.addColorStop(0.35, "rgba(255,255,255,.04)");
  pipe.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = pipe;
  ctx.fillRect(0, y, size, thick);
  ctx.fillStyle = "rgba(0,0,0,.4)";
  ctx.fillRect(0, y + thick, size, 2);
};

// One tile's length of each wall, the height of a wall.
const WALLS = {
  panels(ctx, size, random, variant) {
    grain(ctx, size, 14, random);
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, 1, size);
    ctx.fillRect(size / 2, 0, 1, size);
    ctx.fillRect(0, size * 0.34, size, 2);
    ctx.fillRect(0, size * 0.72, size, 2);
    ctx.fillStyle = "rgba(0,0,0,.2)";
    ctx.fillRect(0, size * 0.72, size, size * 0.28);
    for (let x = 6; x < size; x += 20) {
      rivet(ctx, x, size * 0.34 + 5);
      rivet(ctx, x, size * 0.72 + 5);
    }
    pipeAcross(ctx, size, size * 0.1, 9);
    if (variant === 1) pipeAcross(ctx, size, size * 0.21, 5);
    stains(ctx, size, RUST, 3, 18, 0.22, random);
    for (let i = 0; i < 5; i += 1) {
      const x = random() * size;
      const y = size * (0.3 + random() * 0.4);
      const run = ctx.createLinearGradient(0, y, 0, y + 34);
      run.addColorStop(0, see(RUST, 0.4));
      run.addColorStop(1, see(RUST, 0));
      ctx.fillStyle = run;
      ctx.fillRect(x, y, 2 + random() * 3, 34);
    }
    if (variant === 2) {
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(size * 0.58, size * 0.42, size * 0.3, size * 0.2);
      ctx.fillStyle = "rgba(180,220,200,.28)";
      ctx.fillRect(size * 0.6, size * 0.44, size * 0.1, size * 0.04);
    }
  },
  hull(ctx, size, random) {
    grain(ctx, size, 20, random);
    stains(ctx, size, RUST, 8, 26, 0.34, random);
    stains(ctx, size, "#000000", 5, 24, 0.3, random);
    for (let i = 0; i < 2; i += 1) {
      const x = random() * size * 0.6;
      const y = random() * size * 0.6;
      const w = size * (0.25 + random() * 0.3);
      const h = size * (0.2 + random() * 0.3);
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},.06)`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }
    pipeAcross(ctx, size, size * 0.15, 7);
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.fillRect(0, 0, 1, size);
  },
  concrete(ctx, size, random) {
    grain(ctx, size, 24, random);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    for (let y = size / 4; y < size; y += size / 4) ctx.fillRect(0, y, size, 1);
    stains(ctx, size, "#000000", 6, 24, 0.22, random);
    for (let i = 0; i < 5; i += 1) {
      const x = random() * size;
      const run = ctx.createLinearGradient(0, 0, 0, size);
      run.addColorStop(0, "rgba(0,0,0,.25)");
      run.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = run;
      ctx.fillRect(x, 0, 2 + random() * 5, size * (0.4 + random() * 0.6));
    }
    crack(ctx, size, random);
  },
  rock(ctx, size, random) {
    grain(ctx, size, 36, random);
    stains(ctx, size, "#000000", 12, 26, 0.32, random);
    stains(ctx, size, "#ffffff", 5, 16, 0.06, random);
    for (let i = 0; i < 5; i += 1) crack(ctx, size, random, 0.4);
  },
  brick(ctx, size, random) {
    const high = size / 8;
    for (let row = 0; row < 8; row += 1) {
      const offset = row % 2 ? size / 6 : 0;
      for (let x = -size / 3 + offset; x < size; x += size / 3) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,200,170" : "0,0,0"},${random() * 0.16})`;
        ctx.fillRect(x, row * high, size / 3, high);
        ctx.fillStyle = "rgba(0,0,0,.5)";
        ctx.fillRect(x, row * high, 1, high);
      }
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, row * high, size, 1);
    }
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 5, 26, 0.2, random);
  },
  wood(ctx, size, random) {
    const plank = size / 5;
    for (let x = 0; x < 5; x += 1) {
      ctx.fillStyle = `rgba(${random() > 0.5 ? "255,220,180" : "0,0,0"},${random() * 0.14})`;
      ctx.fillRect(x * plank, 0, plank, size);
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(x * plank, 0, 1, size);
    }
    ctx.strokeStyle = "rgba(0,0,0,.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 22; i += 1) {
      const x = random() * size;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + random() * 4 - 2, size / 3, x + random() * 4 - 2, (size * 2) / 3, x, size);
      ctx.stroke();
    }
    grain(ctx, size, 14, random);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, size * 0.14, size, 4);
    ctx.fillRect(0, size * 0.8, size, 4);
  },
  tile(ctx, size, random) {
    const step = size / 6;
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.07})`;
        ctx.fillRect(x * step, y * step, step, step);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,.3)";
    for (let i = 0; i < size; i += step) {
      ctx.fillRect(i, 0, 1, size);
      ctx.fillRect(0, i, size, 1);
    }
    ctx.fillStyle = "rgba(20,50,50,.5)";
    ctx.fillRect(0, size * 0.66, size, size * 0.34);
    grain(ctx, size, 10, random);
    stains(ctx, size, "#2a2418", 4, 22, 0.25, random);
  },
  stone(ctx, size, random) {
    const high = size / 4;
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 ? size / 4 : 0;
      for (let x = -size / 2 + offset; x < size; x += size / 2) {
        ctx.fillStyle = `rgba(${random() > 0.5 ? "255,255,255" : "0,0,0"},${random() * 0.1})`;
        ctx.fillRect(x, row * high, size / 2, high);
        ctx.fillStyle = "rgba(0,0,0,.5)";
        ctx.fillRect(x, row * high, 2, high);
      }
      ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, row * high, size, 2);
    }
    grain(ctx, size, 18, random);
    stains(ctx, size, "#000000", 5, 26, 0.18, random);
  },
  ice(ctx, size, random) {
    grain(ctx, size, 12, random);
    stains(ctx, size, "#ffffff", 7, 24, 0.16, random);
    stains(ctx, size, "#102030", 6, 24, 0.24, random);
    for (let i = 0; i < 4; i += 1) crack(ctx, size, random, 0.25);
  },
  alien(ctx, size, random) {
    grain(ctx, size, 8, random);
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, size * 0.5, size, size * 0.5);
    ctx.fillStyle = "rgba(190,200,255,.16)";
    ctx.fillRect(0, size * 0.48, size, 2);
    ctx.fillRect(size * 0.3, 0, 1, size);
    stains(ctx, size, "#000000", 4, 28, 0.25, random);
  },
};

// The base color of each, which each room's own colors lean on a little.
export const FLOOR_COLORS = { deck: "#6a6e70", grate: "#5a5c5a", concrete: "#74726a", dirt: "#786650", soil: "#5a4a38", stone: "#74726a", tile: "#8a8e8c", wood: "#7a6044", carpet: "#6e3e46", rock: "#6a6054", ice: "#92a4b2", wet: "#566468", alien: "#62667a" };
export const WALL_COLORS = { panels: "#6e7274", hull: "#74624e", concrete: "#7a7870", rock: "#6a6052", brick: "#7a5a4a", wood: "#725a3e", tile: "#969a98", stone: "#7a7870", ice: "#98a8b4", alien: "#6a6e80" };

const textures = new Map();

// Each one's made once and kept, so that going back to a room is no slower than going there the first time.
function madeOnce(key, make) {
  if (!textures.has(key)) {
    if (textures.size >= MOST_TEXTURES) textures.clear();
    const canvas = newCanvas(128, 128);
    make(canvas.getContext("2d", { willReadFrequently: true }), 128, randomFrom(key));
    textures.set(key, canvas);
  }
  return textures.get(key);
}

function textureFor(kind, table, color, variant = 0) {
  return madeOnce(`${kind}|${color}|${variant}`, (ctx, size, random) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    table[kind](ctx, size, random, variant);
  });
}

function consoleTop(steel, glow) {
  return madeOnce(`console|${steel}|${glow}`, (ctx, size, random) => {
    ctx.fillStyle = scaled(steel, 0.7);
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 2; row += 1) {
      const y = 14 + row * 58;
      ctx.fillStyle = "#050807";
      ctx.fillRect(10, y, 108, 40);
      ctx.fillStyle = see(glow, 0.3 + random() * 0.3);
      ctx.fillRect(13, y + 3, 102, 34);
      ctx.fillStyle = see(glow, 0.65);
      for (let i = 0; i < 5; i += 1) ctx.fillRect(18, y + 7 + i * 6, 20 + random() * 70, 2);
    }
    ctx.fillStyle = "rgba(0,0,0,.5)";
    ctx.fillRect(0, 0, 2, size);
  });
}

function crateSide(color) {
  return madeOnce(`crate|${color}`, (ctx, size, random) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, size);
    WALLS.wood(ctx, size, random);
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.lineWidth = 7;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.strokeStyle = scaled(color, 1.1);
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, size - 8, size - 8);
    ctx.beginPath();
    ctx.moveTo(6, 6);
    ctx.lineTo(size - 6, size - 6);
    ctx.stroke();
  });
}

function scrapPile(tint) {
  return madeOnce(`scrap|${tint}`, (ctx, size, random) => {
    ctx.fillStyle = "#26231f";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 46; i += 1) {
      const base = random() > 0.5 ? RUST : mix("#5a5e60", tint, 0.2);
      ctx.fillStyle = scaled(base, 0.5 + random() * 0.8);
      ctx.save();
      ctx.translate(random() * size, random() * size);
      ctx.rotate(random() * Math.PI);
      ctx.fillRect(-4 - random() * 14, -2 - random() * 5, 8 + random() * 22, 3 + random() * 8);
      ctx.restore();
    }
  });
}

function materialsFor(scene) {
  const { look, colors } = scene;
  const floorKind = FLOORS[look.floor] ? look.floor : "deck";
  const wallKind = WALLS[look.walls] ? look.walls : "panels";
  const floorColor = mix(FLOOR_COLORS[floorKind], colors.floor, floorKind === "carpet" ? 0.5 : 0.22);
  const wallColor = mix(WALL_COLORS[wallKind], colors.walls, 0.14);
  const steel = mix("#5a5e60", colors.scenery, 0.12);
  const rock = mix(WALL_COLORS.rock, colors.scenery, 0.2);
  const crate = mix("#7a6040", colors.scenery, 0.1);
  return {
    floor: [0, 1, 2, 3].map((variant) => textureFor(floorKind, FLOORS, floorColor, variant)),
    floorAlt: [0, 1].map((variant) => textureFor(floorKind, FLOORS, scaled(floorColor, 0.78), variant + 8)),
    floorColor,
    wall: [0, 1, 2].map((variant) => textureFor(wallKind, WALLS, wallColor, variant)),
    wallTop: scaled(wallColor, 0.16),
    body: [0, 1].map((variant) => textureFor(wallKind, WALLS, scaled(wallColor, 0.85), variant + 4)),
    roof: textureFor(floorKind === "carpet" || floorKind === "tile" ? "concrete" : floorKind, FLOORS, scaled(wallColor, 0.72), 5),
    steel: textureFor("panels", WALLS, steel, 7),
    steelTop: textureFor("deck", FLOORS, scaled(steel, 0.9), 6),
    console: consoleTop(steel, look.glow),
    crate: crateSide(crate),
    crateTop: textureFor("wood", FLOORS, crate, 3),
    rock: textureFor("rock", WALLS, rock, 1),
    rockTop: textureFor("rock", FLOORS, scaled(rock, 0.8), 1),
    ice: textureFor("ice", WALLS, WALL_COLORS.ice, 1),
    iceTop: textureFor("ice", FLOORS, FLOOR_COLORS.ice, 1),
    scrap: scrapPile(colors.scenery),
    plant: mix("#4e6e38", colors.scenery, 0.3),
  };
}

// ---- Drawing the room ---------------------------------------------------

// Draws in tiles, onto whichever canvas it's given: the kept picture of the room, or the screen itself.
function painterFor(ctx, ratio, unit, ox, oy) {
  const at = (wx, wy, z = 0) => {
    const { u, v } = project(wx, wy, z);
    return [u * unit + ox, v * unit + oy];
  };
  return {
    ctx,
    ratio,
    unit,
    at,
    // Puts the top left corner of an image at one point, with its edges running along two others.
    plane(origin, across, down) {
      ctx.setTransform(
        ratio * (across[0] - origin[0]),
        ratio * (across[1] - origin[1]),
        ratio * (down[0] - origin[0]),
        ratio * (down[1] - origin[1]),
        ratio * origin[0],
        ratio * origin[1],
      );
    },
    flat() {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
  };
}

function polygon(ctx, points, color) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

// Draws an image on a side of something, the right way up, with less light towards the floor.
function drawSide(painter, image, source, top, bottom, darkness, sink) {
  const { ctx } = painter;
  const from = Math.max(0, 128 * (1 - top / WALL_HEIGHT));
  const high = Math.min(128 - from, Math.max(1, 128 * ((top - bottom) / WALL_HEIGHT)));
  ctx.drawImage(image, source[0], from, source[1], high, 0, 0, 1.01, 1);
  const shade = ctx.createLinearGradient(0, 0, 0, 1);
  shade.addColorStop(0, `rgba(0,0,0,${darkness})`);
  shade.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, darkness + sink)})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1.01, 1);
  painter.flat();
}

// The side of something that faces down and to the left of the screen.
function leftFace(painter, image, x, y, top, bottom, darkness) {
  const { at, plane } = painter;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  plane(at(x0, y + 1, top), at(x1, y + 1, top), at(x0, y + 1, bottom));
  drawSide(painter, image, [(x % 2) * 64, 64], top, bottom, darkness, 0.38);
}

// The side of something that faces down and to the right of the screen.
function rightFace(painter, image, x, y, top, bottom, darkness) {
  const { at, plane } = painter;
  const x1 = (x + 1) * CELL_WIDTH;
  plane(at(x1, y + 1, top), at(x1, y, top), at(x1, y + 1, bottom));
  drawSide(painter, image, [0, 128], top, bottom, darkness, 0.3);
}

function topFace(painter, image, x, y, h, overlay = 0) {
  const { ctx, at, plane, flat } = painter;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  plane(at(x0, y, h), at(x1, y, h), at(x0, y + 1, h));
  ctx.drawImage(image, (x % 2) * 64, 0, 64, 128, 0, 0, 1.01, 1.01);
  if (overlay) {
    ctx.fillStyle = `rgba(0,0,0,${overlay})`;
    ctx.fillRect(0, 0, 1.01, 1.01);
  }
  flat();
}

// A great wheel on its dais, the sort people bet on, as round as a wheel ought to be.
function drawWheel(painter, block) {
  const { ctx, at, plane, flat } = painter;
  const { wx, wy, radius, h } = block;
  const onLevel = (z) => plane(at(wx - radius, wy - radius, z), at(wx + radius, wy - radius, z), at(wx - radius, wy + radius, z));
  const disc = (r, color) => {
    ctx.beginPath();
    ctx.arc(0.5, 0.5, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };
  for (let z = DAIS_HEIGHT; z < h; z += 0.03) {
    onLevel(z);
    disc(0.5, "#3e2e12");
  }
  onLevel(h);
  disc(0.5, "#8a6a24");
  const slices = 24;
  for (let i = 0; i < slices; i += 1) {
    const from = (i / slices) * Math.PI * 2;
    const to = ((i + 1) / slices) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0.5, 0.5);
    ctx.arc(0.5, 0.5, 0.46, from, to);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? "#2a5a30" : i % 2 ? "#6a1c18" : "#141210";
    ctx.fill();
    ctx.strokeStyle = "#c8a040";
    ctx.lineWidth = 0.004;
    ctx.stroke();
  }
  ctx.strokeStyle = "#e0bc58";
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.arc(0.5, 0.5, 0.46, 0, Math.PI * 2);
  ctx.stroke();
  disc(0.27, "#5a4020");
  ctx.lineWidth = 0.014;
  ctx.beginPath();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + 0.3;
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(0.5 + Math.cos(angle) * 0.27, 0.5 + Math.sin(angle) * 0.27);
  }
  ctx.stroke();
  disc(0.06, "#e8c868");
  disc(0.025, "#5a4020");
  flat();
}

// Clutter in the corners nobody can walk into: drums, boxes and sacks.
function drawJunk(painter, cell) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
  const kind = (cell.seed * 97) % 1;
  ctx.fillStyle = "rgba(0,0,0,.45)";
  ctx.beginPath();
  ctx.ellipse(x, y, unit * 0.13, unit * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  if (kind < 0.4) {
    const wide = unit * 0.095;
    const high = unit * 0.25;
    const body = ctx.createLinearGradient(x - wide, 0, x + wide, 0);
    body.addColorStop(0, "#5a4a36");
    body.addColorStop(0.45, "#6e5438");
    body.addColorStop(1, "#2a2218");
    ctx.fillStyle = body;
    ctx.fillRect(x - wide, y - high, wide * 2, high);
    ctx.beginPath();
    ctx.ellipse(x, y, wide, wide * 0.45, 0, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "#35291c";
    ctx.beginPath();
    ctx.ellipse(x, y - high, wide, wide * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(x - wide, y - high * 0.62, wide * 2, 1);
    ctx.fillRect(x - wide, y - high * 0.3, wide * 2, 1);
  } else if (kind < 0.75) {
    const x0 = (cell.x + 0.12) * CELL_WIDTH;
    const x1 = (cell.x + 0.88) * CELL_WIDTH;
    const y0 = cell.y + 0.25;
    const y1 = cell.y + 0.75;
    const h = 0.22 + kind * 0.2;
    polygon(ctx, [at(x1, y0, h), at(x1, y1, h), at(x1, y1), at(x1, y0)], "#2c2418");
    polygon(ctx, [at(x0, y1, h), at(x1, y1, h), at(x1, y1), at(x0, y1)], "#463a26");
    polygon(ctx, [at(x0, y0, h), at(x1, y0, h), at(x1, y1, h), at(x0, y1, h)], "#5e4e34");
  } else {
    ctx.fillStyle = "#4e4634";
    ctx.beginPath();
    ctx.ellipse(x, y - unit * 0.05, unit * 0.12, unit * 0.075, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(x + unit * 0.03, y - unit * 0.025, unit * 0.09, unit * 0.045, 0.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A lamp's housing, on the wall.
function drawFixture(painter, fixture) {
  const { ctx } = painter;
  const { left, right, top, bottom } = fixtureCorners(painter, fixture);
  ctx.beginPath();
  ctx.moveTo(...left);
  ctx.lineTo(...right);
  ctx.lineTo(...bottom);
  ctx.lineTo(...top);
  ctx.closePath();
  ctx.fillStyle = "#14130f";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,245,225,.3)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Where a lamp is, on whichever side of the wall faces the room.
function fixtureCorners(painter, { x, y, face }) {
  const { at } = painter;
  const z = WALL_HEIGHT * 0.72;
  const high = 0.12;
  if (face === "left") {
    const wy = y + 1;
    const from = (x + 0.15) * CELL_WIDTH;
    const to = (x + 0.85) * CELL_WIDTH;
    return { left: at(from, wy, z + high), right: at(to, wy, z + high), bottom: at(to, wy, z), top: at(from, wy, z), middle: at((from + to) / 2, wy, z + high / 2) };
  }
  const wx = (x + 1) * CELL_WIDTH;
  return { left: at(wx, y + 0.8, z + high), right: at(wx, y + 0.2, z + high), bottom: at(wx, y + 0.2, z), top: at(wx, y + 0.8, z), middle: at(wx, y + 0.5, z + high / 2) };
}

const PLANT_COLORS = ["#6a8a44", "#54763a", "#7a9650", "#465f30"];

function drawPlants(painter, block, color) {
  const { ctx, at, unit } = painter;
  ctx.lineWidth = Math.max(1, unit * 0.022);
  ctx.lineCap = "round";
  const random = randomFrom(`${block.x},${block.y}`);
  for (let i = 0; i < 7; i += 1) {
    const [x, y] = at((block.x + 0.1 + random() * 0.8) * CELL_WIDTH, block.y + 0.1 + random() * 0.8);
    const lean = (random() - 0.5) * unit * 0.1;
    const high = unit * (0.14 + random() * 0.14);
    ctx.strokeStyle = mix(PLANT_COLORS[Math.floor(random() * PLANT_COLORS.length)], color, 0.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x, y - high * 0.6, x + lean, y - high);
    ctx.stroke();
  }
}

function drawBlock(painter, block, materials) {
  const { ctx, at, unit } = painter;
  const { x, y, h, style } = block;
  const x0 = x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  if (style === "plants") {
    drawPlants(painter, block, materials.plant);
    return;
  }
  if (style === "wheel") {
    drawWheel(painter, block);
    return;
  }
  if (style === "wall") {
    const image = materials.wall[Math.floor(hashOf(Math.floor(x / 2), y) * 3)];
    if (block.left < h) leftFace(painter, image, x, y, h, block.left, 0.05);
    if (block.right < h) rightFace(painter, image, x, y, h, block.right, 0.42);
    polygon(ctx, [at(x0, y, h), at(x1, y, h), at(x1, y + 1, h), at(x0, y + 1, h)], materials.wallTop);
    // A worn edge, so that the top reads as the cut end of a thick wall.
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,245,225,.16)";
    ctx.lineWidth = 1;
    if (block.left < h) {
      ctx.moveTo(...at(x0, y + 1, h));
      ctx.lineTo(...at(x1, y + 1, h));
    }
    if (block.right < h) {
      ctx.moveTo(...at(x1, y, h));
      ctx.lineTo(...at(x1, y + 1, h));
    }
    ctx.stroke();
    return;
  }
  if (style === "post") {
    // Thinner than the square it's on, and round, as far as anyone can tell at this size.
    const inset = 0.09;
    const left = x0 + inset;
    const right = x1 - inset;
    const back = y + inset * 2;
    const front = y + 1 - inset * 2;
    polygon(ctx, [at(right, back, h), at(right, front, h), at(right, front), at(right, back)], "#20211f");
    polygon(ctx, [at(left, front, h), at(right, front, h), at(right, front), at(left, front)], "#3a3c38");
    polygon(ctx, [at(left, back, h), at(right, back, h), at(right, front, h), at(left, front, h)], "#55574f");
    return;
  }
  if (style === "lamp") {
    const [lx, ly] = at(x0 + CELL_WIDTH / 2, y + 0.5);
    ctx.fillStyle = "#26261f";
    ctx.fillRect(lx - 1, ly - unit * 0.42, 2, unit * 0.42);
    ctx.fillStyle = "#ffe0a0";
    ctx.beginPath();
    ctx.arc(lx, ly - unit * 0.44, Math.max(1.5, unit * 0.035), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const side = { crate: materials.crate, rock: materials.rock, ice: materials.ice, scrap: materials.scrap, body: materials.body[Math.floor(block.seed * 2)], bench: materials.body[Math.floor(block.seed * 2)], dais: materials.body[0] }[style] ?? materials.steel;
  const top = { crate: materials.crateTop, machine: materials.console, rock: materials.rockTop, ice: materials.iceTop, scrap: materials.scrap, body: materials.roof, bench: materials.roof, dais: materials.roof }[style] ?? materials.steelTop;
  if (block.left < h) leftFace(painter, side, x, y, h, block.left, 0.08);
  if (block.right < h) rightFace(painter, side, x, y, h, block.right, 0.4);
  topFace(painter, top, x, y, h, style === "body" ? 0.12 : 0);
}

// A way out, as a door in the wall if there's a wall it can be in.
function drawDoor(painter, item) {
  const { ctx, at } = painter;
  const { exit, along, tall } = item;
  const x0 = exit.x * CELL_WIDTH;
  const x1 = x0 + CELL_WIDTH;
  const y0 = exit.y;
  const y1 = y0 + 1;
  const high = tall ? WALL_HEIGHT * 0.86 : 0;
  if (!tall) {
    if (exit.closed) {
      polygon(ctx, [at(x0, y0 + 0.42, 0.75), at(x1, y0 + 0.42, 0.75), at(x1, y0 + 0.58, 0.75), at(x0, y0 + 0.58, 0.75)], "#6e3a2c");
      polygon(ctx, [at(x0, y0 + 0.58, 0.75), at(x1, y0 + 0.58, 0.75), at(x1, y0 + 0.58), at(x0, y0 + 0.58)], "#46251c");
    }
    return;
  }
  const opening = along === "x"
    ? [at(x0, y0, high), at(x1, y0, high), at(x1, y0), at(x0, y0)]
    : [at(x0, y1, high), at(x0, y0, high), at(x0, y0), at(x0, y1)];
  polygon(ctx, opening, exit.closed ? "#3c2a22" : "#050605");
  ctx.strokeStyle = exit.closed ? "#a05840" : "#8a8a78";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(...opening[3]);
  ctx.lineTo(...opening[0]);
  ctx.lineTo(...opening[1]);
  ctx.lineTo(...opening[2]);
  ctx.stroke();
  if (exit.closed) {
    ctx.beginPath();
    ctx.moveTo(...opening[0]);
    ctx.lineTo(...opening[2]);
    ctx.moveTo(...opening[1]);
    ctx.lineTo(...opening[3]);
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.stroke();
  }
}

function drawThing(painter, thing) {
  const { ctx, at } = painter;
  const x0 = thing.x * CELL_WIDTH + 0.05;
  const x1 = x0 + CELL_WIDTH - 0.1;
  const y0 = thing.y + 0.2;
  const y1 = thing.y + 0.8;
  const h = 0.3;
  polygon(ctx, [at(x1, y0, h), at(x1, y1, h), at(x1, y1), at(x1, y0)], "#2c2418");
  polygon(ctx, [at(x0, y1, h), at(x1, y1, h), at(x1, y1), at(x0, y1)], "#463a26");
  polygon(ctx, [at(x0, y0, h), at(x1, y0, h), at(x1, y1, h), at(x0, y1, h)], "#6e5c3c");
}

// Words painted along a level, on the floor, along a wall, or on top of something.
function paintWords(painter, text, where) {
  const { ctx, ratio, unit } = painter;
  const size = where.size ?? unit * 0.42;
  ctx.save();
  ctx.font = `700 ${size}px ${FONT}`;
  const scale = where.length ? (where.length * CELL_WIDTH * unit * 0.5 * 0.92) / Math.max(1, ctx.measureText(text).width) : 1;
  const across = Math.min(scale, 1.1);
  const [px, py] = where.at;
  if (where.upright) ctx.setTransform(ratio * across, ratio * across * 0.5, 0, ratio, ratio * px, ratio * py);
  else ctx.setTransform(ratio * across, ratio * across * 0.5, ratio * -0.72, ratio * 0.36, ratio * px, ratio * py);
  ctx.fillStyle = where.color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// Bits of rubbish on the floor. They're only marks: nobody trips over them.
function drawLitter(painter, cell) {
  const { ctx, at, unit } = painter;
  const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
  const random = randomFrom(`litter${cell.x},${cell.y}`);
  const kind = random();
  if (kind < 0.4) {
    // A dark stain.
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.beginPath();
    ctx.ellipse(x, y, unit * (0.1 + random() * 0.14), unit * (0.05 + random() * 0.06), 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind < 0.7) {
    // Some bits of scrap.
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = random() > 0.5 ? "rgba(90,58,30,.8)" : "rgba(120,122,112,.55)";
      ctx.fillRect(x + (random() - 0.5) * unit * 0.3, y + (random() - 0.5) * unit * 0.14, 1 + random() * unit * 0.05, 1 + random() * unit * 0.02);
    }
  } else if (kind < 0.85) {
    // A scrap of paper.
    ctx.fillStyle = "rgba(190,184,160,.42)";
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(random() * 3);
    ctx.fillRect(-unit * 0.03, -unit * 0.02, unit * 0.06, unit * 0.04);
    ctx.restore();
  } else {
    // A length of cable.
    ctx.strokeStyle = "rgba(10,10,10,.6)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - unit * 0.14, y);
    ctx.bezierCurveTo(x - unit * 0.05, y - unit * 0.06, x + unit * 0.05, y + unit * 0.06, x + unit * 0.15, y - unit * 0.01);
    ctx.stroke();
  }
}

// ---- The kept picture of the room ---------------------------------------

function closedKey(view) {
  return (view.exits ?? []).map((exit) => exit.closed).join();
}

// A lamp's color, a little stronger than it says, because most of it gets lost in the dark.
function vivid(hex) {
  const [r, g, b] = rgbOf(hex);
  const grey = (r + g + b) / 3;
  const push = (n) => Math.max(0, Math.min(255, Math.round(grey + (n - grey) * 1.5)));
  return `#${[push(r), push(g), push(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

// How much light reaches each part of the room. It's multiplied over everything, moving or not. The
// second picture is just the pools of light, which go on top again, faintly, as a colored haze.
function drawLightmap(scene, unit, left, top, width, height) {
  const by = 0.25;
  const canvas = newCanvas(width * by, height * by);
  const ctx = canvas.getContext("2d");
  const haze = newCanvas(width * by, height * by);
  const hazeCtx = haze.getContext("2d");
  hazeCtx.fillStyle = "#000";
  hazeCtx.fillRect(0, 0, haze.width, haze.height);
  hazeCtx.globalCompositeOperation = "lighter";
  const [ar, ag, ab] = rgbOf(hexOr(scene.look.ambient, FALLBACK_LOOK.ambient));
  ctx.fillStyle = `rgb(${Math.min(255, ar * AMBIENT_BOOST)},${Math.min(255, ag * AMBIENT_BOOST)},${Math.min(255, ab * AMBIENT_BOOST)})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = "lighter";
  for (const light of scene.lights) {
    const { u, v } = project(light.wx, light.wy);
    const x = (u * unit - left) * by;
    const y = (v * unit - top) * by;
    const radius = light.radius * unit * 0.66 * by;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.25, 0.72);
    const color = vivid(light.color);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    pool.addColorStop(0, see(color, 0.95 * light.power));
    pool.addColorStop(0.45, see(color, 0.42 * light.power));
    pool.addColorStop(1, see(color, 0));
    ctx.fillStyle = pool;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.restore();
    hazeCtx.save();
    hazeCtx.translate(x, y);
    hazeCtx.scale(1.25, 0.72);
    hazeCtx.fillStyle = pool;
    hazeCtx.fillRect(-radius, -radius, radius * 2, radius * 2);
    hazeCtx.restore();
  }
  return { canvas, haze };
}

// Everything that doesn't move, drawn once. It's far more detail than could be drawn every time.
function drawRoom(view, ratio) {
  const { scene, unit } = iso;
  const key = `${iso.sceneId}|${unit}|${ratio}`;
  if (iso.room?.key === key) return iso.room;
  const { bounds } = scene;
  const pad = unit;
  const width = (bounds.maxU - bounds.minU) * unit + pad * 2;
  const height = (bounds.maxV - bounds.minV) * unit + pad * 2;
  const left = bounds.minU * unit - pad;
  const top = bounds.minV * unit - pad;
  const canvas = newCanvas(width * ratio, height * ratio);
  const ctx = canvas.getContext("2d");
  const painter = painterFor(ctx, ratio, unit, -left, -top);
  const { at, plane, flat } = painter;
  const materials = materialsFor(scene);
  flat();

  // The floor.
  const mainFloor = scene.ground.find((cell) => cell.kind === "floor")?.mark;
  for (const cell of scene.ground) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const corners = [at(x0, cell.y), at(x1, cell.y), at(x1, cell.y + 1), at(x0, cell.y + 1)];
    if (cell.kind === "dim") {
      polygon(ctx, corners, scaled(materials.floorColor, 0.28));
      continue;
    }
    polygon(ctx, corners, scaled(materials.floorColor, 0.7));
    const seed = hashOf(Math.floor(cell.x / 2), cell.y);
    const second = cell.kind === "floor" && cell.mark !== " " && cell.mark !== mainFloor;
    const image = second ? materials.floorAlt[Math.floor(seed * 2)] : materials.floor[Math.floor(seed * 4)];
    plane(corners[0], corners[1], corners[3]);
    ctx.drawImage(image, (cell.x % 2) * 64, 0, 64, 128, 0, 0, 1.01, 1.01);
    flat();
  }
  // Where a floor stops at water or the dark, its edge shows.
  const open = (x, y) => {
    const kind = scene.kinds[y]?.[x];
    return kind === undefined || kind === "water" || kind === "void" || kind === "spark";
  };
  const edge = scaled(materials.floorColor, 0.32);
  for (const cell of scene.ground) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const y1 = cell.y + 1;
    if (open(cell.x + 1, cell.y)) polygon(ctx, [at(x1, cell.y), at(x1, y1), at(x1, y1, -FLOOR_EDGE), at(x1, cell.y, -FLOOR_EDGE)], scaled(edge, 0.7));
    if (open(cell.x, cell.y + 1)) polygon(ctx, [at(x0, y1), at(x1, y1), at(x1, y1, -FLOOR_EDGE), at(x0, y1, -FLOOR_EDGE)], edge);
  }
  // Rubbish, and hazard paint at the doors.
  for (const cell of scene.ground) {
    if (cell.kind === "floor" && cell.seed > 0.84) drawLitter(painter, cell);
    if (cell.kind === "exit" || cell.kind === "door") {
      const x0 = cell.x * CELL_WIDTH;
      for (let i = 0; i < 4; i += 1) {
        polygon(ctx, [at(x0, cell.y + i * 0.25), at(x0 + CELL_WIDTH, cell.y + i * 0.25), at(x0 + CELL_WIDTH, cell.y + i * 0.25 + 0.25), at(x0, cell.y + i * 0.25 + 0.25)], i % 2 ? "#26241c" : "#7c6c30");
      }
    }
  }
  const paint = mix(hexOr(scene.colors.writing, FALLBACK_COLORS.writing), "#c8c4b0", 0.5);
  for (const label of view.labels ?? []) {
    paintWords(painter, label.text, { at: at(label.x * CELL_WIDTH, label.y + 0.5), size: unit * 0.34, color: see(paint, 0.5) });
  }
  for (const run of scene.runs.filter((one) => one.on === "ground")) {
    paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 0.5), size: unit * 0.34, color: see(paint, 0.5) });
  }

  // Soft shadows around everything that stands on the floor, which is most of what makes it look solid.
  const shadow = newCanvas(canvas.width, canvas.height);
  const sctx = shadow.getContext("2d");
  sctx.filter = `blur(${Math.max(2, unit * 0.14 * ratio)}px)`;
  const shadowPainter = painterFor(sctx, ratio, unit, -left, -top);
  shadowPainter.flat();
  sctx.fillStyle = "#000";
  for (const block of scene.blocks) {
    if (block.style === "plants" || block.style === "lamp" || block.wx !== undefined) continue;
    const x0 = block.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const grow = Math.min(0.28, block.h * 0.22);
    sctx.beginPath();
    for (const [wx, wy] of [[x0, block.y], [x1 + grow, block.y], [x1 + grow, block.y + 1 + grow], [x0, block.y + 1 + grow]]) sctx.lineTo(...shadowPainter.at(wx, wy));
    sctx.closePath();
    sctx.fill();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.82;
  ctx.drawImage(shadow, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  flat();

  // Then everything that stands up, from the back of the room to the front.
  const standing = [...scene.blocks];
  for (const thing of view.things) {
    const { wx, wy } = cellCentre(thing.x, thing.y);
    standing.push({ type: "thing", thing, depth: wx + wy });
  }
  for (const exit of view.exits) {
    const { wx, wy } = cellCentre(exit.x, exit.y);
    const tallAt = (x, y) => (scene.heights[y]?.[x] ?? 0) > 1;
    const along = tallAt(exit.x - 1, exit.y) || tallAt(exit.x + 1, exit.y) ? "x" : "y";
    const tall = tallAt(exit.x - 1, exit.y) || tallAt(exit.x + 1, exit.y) || tallAt(exit.x, exit.y - 1) || tallAt(exit.x, exit.y + 1);
    standing.push({ type: "door", exit, along, tall, depth: wx + wy - 0.4 });
  }
  for (const run of scene.runs) {
    if (run.on === "wall" || run.on === "roof") standing.push({ type: "words", run, depth: (run.x + run.length) * CELL_WIDTH + run.y + 1 });
  }
  for (const cell of scene.junk) {
    const { wx, wy } = cellCentre(cell.x, cell.y);
    standing.push({ type: "junk", cell, depth: wx + wy });
  }
  for (const fixture of scene.fixtures) {
    const { wx, wy } = cellCentre(fixture.x, fixture.y);
    standing.push({ type: "fixture", fixture, depth: wx + wy + 0.01 });
  }
  standing.sort((a, b) => (a.frontDepth ?? a.depth) - (b.frontDepth ?? b.depth));
  for (const item of standing) {
    if (item.type === "block") drawBlock(painter, item, materials);
    else if (item.type === "junk") drawJunk(painter, item.cell);
    else if (item.type === "fixture") drawFixture(painter, item.fixture);
    else if (item.type === "thing") drawThing(painter, item.thing);
    else if (item.type === "door") drawDoor(painter, item);
    else if (item.type === "words") {
      const { run } = item;
      const h = scene.heights[run.y][run.x];
      if (run.on === "wall") {
        const low = h < 1;
        paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 1, low ? h : h * 0.52), size: low ? unit * 0.2 : unit * 0.34, length: run.length, upright: true, color: see(paint, 0.62) });
      } else {
        paintWords(painter, run.text, { at: at(run.x * CELL_WIDTH, run.y + 0.5, h), size: unit * 0.3, color: see(paint, 0.62) });
      }
    }
  }

  iso.materials = materials;
  iso.room = { key, canvas, left, top, width, height };
  iso.lightmap = drawLightmap(scene, unit, left, top, width, height);
  return iso.room;
}

// ---- People -------------------------------------------------------------

function lookFor(key, color, crowd) {
  let sum = 0;
  for (const ch of String(key)) sum = (sum * 31 + ch.codePointAt(0)) >>> 0;
  const coat = mix(hexOr(color, "#6a6a60"), "#55544c", crowd ? 0.68 : 0.42);
  return {
    coat,
    coatDark: scaled(coat, 0.62),
    trousers: TROUSERS[sum % TROUSERS.length],
    skin: SKIN[(sum >>> 3) % SKIN.length],
    hair: HAIR[(sum >>> 5) % HAIR.length],
    vest: (sum >>> 7) % 3 === 0,
    pack: (sum >>> 9) % 4 === 0,
    long: (sum >>> 11) % 4 === 0,
    hat: (sum >>> 13) % 5 === 0,
  };
}

const YOU_LOOK = { coat: "#7c9484", coatDark: "#54665a", trousers: "#2c3430", skin: "#d8b090", hair: "#2a2420", vest: true, pack: true, long: false, hat: false };

const limb = (ctx, x0, y0, x1, y1, width, color) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
};

// Someone standing on the floor, with the point between their feet at x, y. They're drawn thirty units
// tall, facing away from the camera or towards it, and a mirror image does for the other direction.
function drawPerson(ctx, x, y, unit, person) {
  const scale = (unit * 0.86) / 30;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.beginPath();
  if (person.asleep) ctx.ellipse(0, 0, unit * 0.3, unit * 0.1, 0, 0, Math.PI * 2);
  else ctx.ellipse(0, 0, unit * 0.15, unit * 0.075, 0, 0, Math.PI * 2);
  ctx.fill();
  if (person.ring) {
    ctx.strokeStyle = person.ring;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, unit * 0.22, unit * 0.11, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.scale(person.flip ? -scale : scale, scale);
  ctx.lineCap = "round";
  const { look } = person;
  if (person.asleep) {
    ctx.fillStyle = look.coat;
    ctx.beginPath();
    ctx.roundRect(-9, -4, 14, 5, 2);
    ctx.fill();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(7, -2, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const swing = person.walking && !iso.calm ? Math.sin(person.step) * 3.2 : 0;
  const lift = person.walking && !iso.calm ? Math.abs(Math.sin(person.step)) * 0.6 : 0;
  ctx.translate(0, -lift);
  // The far leg and arm first.
  limb(ctx, -1.5, -14, -1.8 - swing, -1, 2.6, scaled(look.trousers, 0.8));
  limb(ctx, -1.8 - swing, -1, -1.2 - swing, 0, 2.6, "#141310");
  limb(ctx, -4.3, -23, -5 + swing * 0.7, -14, 2, look.coatDark);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(-5 + swing * 0.7, -13.2, 1, 0, Math.PI * 2);
  ctx.fill();
  limb(ctx, 1.5, -14, 1.8 + swing, -1, 2.6, look.trousers);
  limb(ctx, 1.8 + swing, -1, 2.4 + swing, 0, 2.6, "#1c1a16");
  // A pack on their back goes behind them if they're facing the camera, and in front of the coat if not.
  if (look.pack && !person.back) {
    ctx.fillStyle = "#2c2a20";
    ctx.fillRect(-3.5, -24, 7, 8);
  }
  // The body, with its light side and its dark side.
  const bottom = look.long ? -8 : -13.5;
  ctx.fillStyle = look.coat;
  ctx.beginPath();
  ctx.moveTo(-4.4, -24);
  ctx.lineTo(4.4, -24);
  ctx.lineTo(look.long ? 4 : 3.2, bottom);
  ctx.lineTo(look.long ? -4 : -3.2, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.beginPath();
  ctx.moveTo(0.6, -24);
  ctx.lineTo(4.4, -24);
  ctx.lineTo(look.long ? 4 : 3.2, bottom);
  ctx.lineTo(0.6, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,.14)";
  ctx.fillRect(-4.2, -24, 8.2, 0.8);
  if (person.back) {
    if (look.pack) {
      ctx.fillStyle = "#3a3628";
      ctx.fillRect(-3.2, -23.4, 6.4, 7.6);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0.4, -23.4, 2.8, 7.6);
    }
  } else if (look.vest) {
    ctx.fillStyle = "rgba(20,18,14,.55)";
    ctx.fillRect(-2.8, -23, 5.6, 6.4);
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.fillRect(-2.2, -19.4, 1.8, 1.8);
    ctx.fillRect(0.4, -19.4, 1.8, 1.8);
  }
  ctx.fillStyle = "rgba(10,10,8,.6)";
  ctx.fillRect(-3.2, -15, 6.4, 0.9);
  // The near arm.
  limb(ctx, 4.3, -23, 5 - swing * 0.7, -14, 2.1, look.coat);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(5 - swing * 0.7, -13.2, 1, 0, Math.PI * 2);
  ctx.fill();
  // The head.
  ctx.fillStyle = scaled(look.skin, 0.8);
  ctx.fillRect(-1, -25, 2, 2);
  ctx.fillStyle = look.skin;
  ctx.beginPath();
  ctx.arc(0.3, -27.2, 2.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,.24)";
  ctx.beginPath();
  ctx.arc(0.3, -27.2, 2.7, Math.PI * 1.6, Math.PI * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = look.hat ? scaled(look.coat, 0.7) : look.hair;
  ctx.beginPath();
  if (person.back) ctx.arc(0.3, -27.4, 2.8, 0, Math.PI * 2);
  else ctx.arc(0.3, -27.6, 2.8, Math.PI * 1.02, Math.PI * 1.98);
  ctx.closePath();
  ctx.fill();
  if (look.hat) ctx.fillRect(-3.2, -28.6, 7, 0.9);
  if (!person.back) {
    ctx.fillStyle = "rgba(20,12,8,.7)";
    ctx.fillRect(1, -27.4, 0.9, 0.7);
    ctx.fillRect(2.3, -27.4, 0.5, 0.7);
  }
  ctx.restore();
}

// Which way someone's facing: towards where they've just been going, and otherwise the way they last were.
function faceAlong(shown, dx, dy) {
  const across = dx * CELL_WIDTH - dy;
  const along = dx * CELL_WIDTH + dy;
  if (Math.abs(across) > 0.002) shown.flip = across < 0;
  if (Math.abs(along) > 0.002) shown.back = along < 0;
}

// ---- The view on the screen ---------------------------------------------

const iso = {
  canvas: null,
  hooks: null,
  scene: null,
  sceneId: null,
  room: null,
  lightmap: null,
  materials: null,
  zoom: 1,
  unit: 56,
  camera: null,
  you: null,
  shown: new Map(),
  hits: [],
  pointer: null,
  hover: null,
  frame: 0,
  lastFrame: 0,
  lastDraw: 0,
  fadeFrom: 0,
  calm: false,
  focus: null,
  covered: 0,
};

function useScene(view) {
  const id = `${view.here.id}|${view.cols}x${view.lines}|${closedKey(view)}`;
  if (iso.sceneId === id) return;
  const sameRoom = iso.sceneId?.split("|")[0] === view.here.id;
  iso.scene = buildScene(view);
  iso.sceneId = id;
  iso.room = null;
  if (sameRoom) return;
  iso.camera = null;
  iso.you = null;
  iso.shown = new Map();
  iso.fadeFrom = performance.now();
}

// People glide from square to square, and the player a good deal more quickly.
function ease(current, goal, dt, time) {
  const by = 1 - Math.exp(-dt / time);
  current.x += (goal.x - current.x) * by;
  current.y += (goal.y - current.y) * by;
  if (Math.abs(goal.x - current.x) < 0.01) current.x = goal.x;
  if (Math.abs(goal.y - current.y) < 0.01) current.y = goal.y;
}

function moveOne(shown, goal, dt, time) {
  const beforeX = shown.x;
  const beforeY = shown.y;
  ease(shown, goal, dt, time);
  const dx = shown.x - beforeX;
  const dy = shown.y - beforeY;
  const went = Math.abs(dx) * CELL_WIDTH + Math.abs(dy);
  shown.step += went * 5;
  shown.walking = went > 0;
  faceAlong(shown, dx, dy);
  return went > 0;
}

function moveEveryone(view, dt) {
  let moving = false;
  const spot = iso.hooks.spot();
  if (!iso.you || iso.calm) iso.you = { x: spot.x, y: spot.y, step: 0, back: false, flip: false };
  if (moveOne(iso.you, spot, dt, 70)) moving = true;
  const here = new Set();
  for (const person of view.people) {
    here.add(person.key);
    let shown = iso.shown.get(person.key);
    if (!shown || iso.calm) {
      const seed = hashOf(person.x, person.y);
      shown = { x: person.x, y: person.y, step: seed * 6, back: seed > 0.5, flip: seed % 0.25 > 0.125, look: lookFor(person.key, person.color, person.crowd) };
      iso.shown.set(person.key, shown);
    }
    if (moveOne(shown, person, dt, 200)) moving = true;
  }
  for (const key of iso.shown.keys()) if (!here.has(key)) iso.shown.delete(key);
  return moving;
}

function sizeCanvas() {
  const { canvas } = iso;
  // However big the interface is being drawn, so that the room stays sharp.
  const ratio = (window.devicePixelRatio || 1) * scaleOfCanvas();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  return { width, height, ratio };
}

// The whole room if it fits at a sensible size. If not, the camera stays with the player, and with
// whoever's talking to them. Anything the popups cover at the bottom doesn't count as room.
function aim(width, height, dt) {
  const { bounds } = iso.scene;
  const seen = height - Math.min(iso.covered, height * 0.75);
  const spanU = bounds.maxU - bounds.minU;
  const spanV = bounds.maxV - bounds.minV;
  const fit = Math.min(width / (spanU + 1), height / (spanV + 1));
  const unit = Math.round(Math.min(SIZES.largest, Math.max(SIZES.smallest, fit)) * iso.zoom);
  iso.unit = unit;
  const { wx, wy } = cellCentre(iso.you.x, iso.you.y);
  let here = project(wx, wy);
  const them = iso.focus && iso.shown.get(iso.focus);
  if (them) {
    const spot = cellCentre(them.x, them.y);
    const there = project(spot.wx, spot.wy);
    const both = Math.abs(there.u - here.u) * unit < width * 0.85 && Math.abs(there.v - here.v) * unit < seen * 0.8;
    here = both ? { u: (here.u + there.u) / 2, v: (here.v + there.v) / 2 } : there;
  }
  const onAxis = (at, low, span, room) => {
    const size = room / unit;
    if (span + 1 <= size) return low + span / 2;
    return Math.max(low - 0.5 + size / 2, Math.min(low + span + 0.5 - size / 2, at));
  };
  const goal = { u: onAxis(here.u, bounds.minU, spanU, width), v: onAxis(here.v, bounds.minV, spanV, seen) };
  if (!iso.camera || iso.calm) iso.camera = { ...goal };
  const by = 1 - Math.exp(-dt / 160);
  iso.camera.u += (goal.u - iso.camera.u) * by;
  iso.camera.v += (goal.v - iso.camera.v) * by;
  // Whole pixels, so that the texture on the floor stays crisp while the camera moves.
  return { ox: Math.round(width / 2 - iso.camera.u * unit), oy: Math.round(seen / 2 - iso.camera.v * unit) };
}

function drawWater(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  if (!scene.water.length) return;
  const deep = mix("#0c2230", scene.colors.scenery, 0.1);
  const deeper = mix("#102a3a", scene.colors.scenery, 0.1);
  const wave = see(mix("#7fc8e8", scene.colors.scenery, 0.25), 0.4);
  for (const cell of scene.water) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    polygon(ctx, [at(x0, cell.y), at(x1, cell.y), at(x1, cell.y + 1), at(x0, cell.y + 1)], (Math.floor(cell.x / 2) + cell.y) % 2 ? deep : deeper);
    const swell = Math.sin(now / 900 + cell.seed * 40 + cell.x * 0.35 + cell.y * 0.8);
    if (swell > 0.45) {
      const c = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5);
      ctx.strokeStyle = wave;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c[0] - unit * 0.14, c[1] - unit * 0.02);
      ctx.quadraticCurveTo(c[0], c[1] + unit * 0.04 * swell, c[0] + unit * 0.14, c[1] - unit * 0.02);
      ctx.stroke();
    }
  }
}

// Whatever's burning, under the edges of whatever it's burning in.
function drawGlows(painter, now) {
  const { ctx, at } = painter;
  const { scene } = iso;
  const fire = hexOr(scene.look.fire, FALLBACK_LOOK.fire);
  for (const cell of scene.glows) {
    const x0 = cell.x * CELL_WIDTH;
    const x1 = x0 + CELL_WIDTH;
    const flicker = iso.calm ? 0.5 : 0.5 + 0.5 * Math.sin(now / (240 + cell.seed * 420) + cell.seed * 30);
    polygon(ctx, [at(x0, cell.y), at(x1, cell.y), at(x1, cell.y + 1), at(x0, cell.y + 1)], mix(scaled(fire, 0.55), scaled(fire, 1.25), flicker));
  }
}

// A soft glow, made once and used for every lamp and every flame.
function glowSprite(color) {
  return madeOnce(`glow|${color}`, (ctx, size) => {
    const glow = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    glow.addColorStop(0, see(color, 0.9));
    glow.addColorStop(0.25, see(color, 0.32));
    glow.addColorStop(1, see(color, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  });
}

// What shines through the dark: this goes on after the light in the room, so that it isn't dimmed by it.
function drawShining(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  ctx.globalCompositeOperation = "lighter";
  for (const fixture of scene.fixtures) {
    const { middle } = fixtureCorners(painter, fixture);
    const size = unit * 0.9;
    ctx.drawImage(glowSprite(vivid(fixture.color)), middle[0] - size / 2, middle[1] - size / 2, size, size);
  }
  const flame = glowSprite(vivid(hexOr(scene.look.fire, FALLBACK_LOOK.fire)));
  ctx.globalAlpha = iso.calm ? 0.5 : 0.42 + 0.14 * Math.sin(now / 300);
  for (const cell of scene.glows) {
    if (cell.seed < 0.5) continue;
    const [x, y] = at((cell.x + 0.5) * CELL_WIDTH, cell.y + 0.5, 0.1);
    const size = unit * 1.1;
    ctx.drawImage(flame, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

function drawSparks(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  for (const spark of scene.sparks) {
    const c = at((spark.x + spark.seed) * CELL_WIDTH, spark.y + 1 - spark.seed);
    const glow = 0.45 + 0.55 * Math.abs(Math.sin(now / 1400 + spark.seed * 30));
    ctx.fillStyle = see(scene.colors.writing, glow);
    const size = spark.mark === "*" ? unit * 0.05 : unit * 0.028;
    ctx.fillRect(c[0] - size / 2, c[1] - size / 2, size, size);
  }
}

// The little lights on the machines, which are the only thing in the room that moves by itself.
function drawLights(painter, now) {
  const { ctx, at, unit } = painter;
  const { scene } = iso;
  for (const block of scene.blocks) {
    if (block.style !== "machine" || block.seed < 0.55) continue;
    const middle = at((block.x + 0.5) * CELL_WIDTH, block.y + 0.5, block.h);
    const lit = 0.3 + 0.7 * Math.abs(Math.sin(now / (500 + block.seed * 1500) + block.seed * 20));
    ctx.fillStyle = see(block.seed > 0.8 ? "#f0c060" : scene.look.glow, lit);
    ctx.fillRect(middle[0] - unit * 0.02, middle[1] - unit * 0.012, unit * 0.04, unit * 0.024);
  }
}

function chip(ctx, text, x, y, color, { background = "rgba(4,6,5,.62)", size = 11, width, height }) {
  ctx.font = `700 ${size}px ${FONT}`;
  const wide = ctx.measureText(text).width + 8;
  const left = Math.max(2, Math.min(width - wide - 2, x - wide / 2));
  const top = Math.max(2, Math.min(height - size - 8, y - size - 6));
  ctx.fillStyle = background;
  ctx.fillRect(left, top, wide, size + 5);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + 4, top + (size + 5) / 2 + 0.5);
  return { x: left, y: top, w: wide, h: size + 5 };
}

function draw(now, dt) {
  const { canvas } = iso;
  const view = iso.hooks.view();
  const { width, height, ratio } = sizeCanvas();
  if (!width || !height) return;
  const { scene } = iso;
  const ctx = canvas.getContext("2d");
  const { ox, oy } = aim(width, height, dt);
  const { unit } = iso;
  const room = drawRoom(view, ratio);
  const painter = painterFor(ctx, ratio, unit, ox, oy);
  const { at } = painter;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  painter.flat();

  drawWater(painter, now);
  drawSparks(painter, now);
  drawGlows(painter, now);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(room.canvas, Math.round((ox + room.left) * ratio), Math.round((oy + room.top) * ratio));
  painter.flat();
  drawLights(painter, now);

  // Where the mouse is, if that's somewhere to walk.
  if (iso.hover?.kind === "floor" && !iso.hooks.blocked() && !iso.hooks.reading?.()) {
    const { x, y } = iso.hover;
    if (walkable(scene.kinds[y]?.[x])) {
      const x0 = x * CELL_WIDTH;
      ctx.beginPath();
      for (const [wx, wy] of [[x0, y], [x0 + CELL_WIDTH, y], [x0 + CELL_WIDTH, y + 1], [x0, y + 1]]) ctx.lineTo(...at(wx, wy));
      ctx.closePath();
      ctx.strokeStyle = "rgba(230,225,190,.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // Everyone, from the back of the room to the front, with whatever's in front of each of them put back over them.
  const figures = [];
  const youAt = cellCentre(iso.you.x, iso.you.y);
  figures.push({ type: "you", wx: youAt.wx, wy: youAt.wy, depth: youAt.wx + youAt.wy });
  for (const person of view.people) {
    const shown = iso.shown.get(person.key);
    if (!shown) continue;
    const { wx, wy } = cellCentre(shown.x, shown.y);
    figures.push({ type: "person", person, shown, wx, wy, depth: wx + wy });
  }
  const covering = new Set();
  for (const figure of figures) {
    const { u, v } = project(figure.wx, figure.wy);
    const minU = u - 0.25;
    const maxU = u + 0.25;
    const minV = v - 0.95;
    const maxV = v + 0.05;
    for (const block of scene.blocks) {
      if (block.depth <= figure.depth || block.style === "plants") continue;
      const { span } = block;
      if (span.maxU > minU && span.minU < maxU && span.maxV > minV && span.minV < maxV) covering.add(block);
    }
  }
  const order = [...figures, ...covering].sort((a, b) => a.depth - b.depth);
  const hits = [];
  const hoverKey = iso.hover?.key;
  for (const item of order) {
    if (item.type === "block") drawBlock(painter, item, iso.materials);
    else if (item.type === "person") {
      const { person, shown, wx, wy } = item;
      const [x, y] = at(wx, wy);
      const hovered = hoverKey === `person:${person.key}`;
      drawPerson(ctx, x, y, unit, { look: shown.look, flip: shown.flip, back: shown.back, walking: shown.walking, step: shown.step, asleep: person.asleep, ring: hovered ? "rgba(255,250,220,.9)" : null });
      hits.push({ kind: "person", key: `person:${person.key}`, person, x: x - unit * 0.22, y: y - unit * 0.92, w: unit * 0.44, h: unit * 1, floorX: x, floorY: y });
    } else {
      const [x, y] = at(item.wx, item.wy);
      hits.push({ kind: "you", key: "person:you", x: x - unit * 0.22, y: y - unit * 0.92, w: unit * 0.44, h: unit, floorX: x, floorY: y });
      drawPerson(ctx, x, y, unit, { look: YOU_LOOK, flip: iso.you.flip, back: iso.you.back, walking: iso.you.walking, step: iso.you.step, ring: "rgba(180,240,190,.8)" });
    }
  }

  // The light in the room falls on everything, moving or not.
  const [youX, youY] = at(youAt.wx, youAt.wy);
  painter.flat();
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(iso.lightmap.canvas, ox + room.left, oy + room.top, room.width, room.height);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.14;
  ctx.drawImage(iso.lightmap.haze, ox + room.left, oy + room.top, room.width, room.height);
  ctx.globalAlpha = 1;
  drawShining(painter, now);
  // The player can always see a little way around themselves.
  ctx.globalCompositeOperation = "overlay";
  const lantern = ctx.createRadialGradient(youX, youY - unit * 0.3, 0, youX, youY - unit * 0.3, unit * 3.2);
  lantern.addColorStop(0, "rgba(255,240,215,.42)");
  lantern.addColorStop(1, "rgba(255,240,215,0)");
  ctx.fillStyle = lantern;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  const edges = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.45, width / 2, height / 2, Math.max(width, height) * 0.72);
  edges.addColorStop(0, "rgba(0,0,0,0)");
  edges.addColorStop(1, "rgba(0,0,0,.3)");
  ctx.fillStyle = edges;
  ctx.fillRect(0, 0, width, height);

  // Names go on top of everything, so they can always be read, and only when they're wanted.
  const clip = { width, height };
  const writing = mix(hexOr(scene.colors.writing, FALLBACK_COLORS.writing), "#c8c4b0", 0.5);
  for (const exit of view.exits) {
    const { wx, wy } = cellCentre(exit.x, exit.y);
    // A way out's name goes on the far side of it, out of the way of whoever's standing beside it.
    const away = { v: [-0.5, 0.5], "^": [0.5, -0.5], "<": [-0.7, -0.35], ">": [0.7, 0.35] }[exit.glyph] ?? [0, 0];
    const [x, y] = at(wx + away[0], wy + away[1], 0.2);
    const hovered = hoverKey === `exit:${exit.key}`;
    const rect = chip(ctx, `${exit.glyph} ${exit.label}`, x, y, hovered ? BACKGROUND : exit.closed ? "#c88a70" : writing, { background: hovered ? writing : undefined, ...clip });
    hits.push({ kind: "exit", key: `exit:${exit.key}`, exit, ...rect });
  }
  for (const thing of view.things) {
    const { wx, wy } = cellCentre(thing.x, thing.y);
    const bob = iso.calm ? 0 : Math.sin(now / 600 + thing.x) * unit * 0.02;
    const [x, y] = at(wx, wy, 0.5);
    if (x < -8 || y < -8 || x > width + 8 || y > height + 8) continue;
    const hovered = hoverKey === `thing:${thing.id}`;
    const rect = chip(ctx, hovered ? thing.name : "?", x, y + bob, hovered ? BACKGROUND : "#e8c060", { background: hovered ? "#e8c060" : undefined, size: 12, ...clip });
    hits.push({ kind: "thing", key: `thing:${thing.id}`, thing, ...rect });
  }
  for (const hit of hits.filter((one) => one.kind === "person")) {
    const { person } = hit;
    const hovered = hoverKey === hit.key;
    const shown = iso.shown.get(person.key);
    const near = shown && Math.abs(shown.x - iso.you.x) * CELL_WIDTH + Math.abs(shown.y - iso.you.y) < 5;
    if (!hovered && (person.crowd || person.walking || !near)) continue;
    if (hit.floorX < -8 || hit.floorY < -8 || hit.floorX > width + 8 || hit.floorY - unit > height + 8) continue;
    const text = hovered ? `${person.name}${person.doing ? `, ${person.doing}` : ""}` : person.short;
    const tag = mix(hexOr(person.color, "#a0a090"), "#d8d4c0", 0.3);
    chip(ctx, text, hit.floorX, hit.floorY - unit * 0.95, hovered ? BACKGROUND : tag, { background: hovered ? tag : undefined, size: 11, ...clip });
  }

  // A room the player has just walked into fades up.
  const fade = 1 - (now - iso.fadeFrom) / 300;
  if (fade > 0 && !iso.calm) {
    ctx.fillStyle = `rgba(3,4,3,${fade})`;
    ctx.fillRect(0, 0, width, height);
  }
  iso.hits = hits;
  iso.lastOrigin = { ox, oy };
  iso.hooks.drawn?.();
}

// Who the popups want kept in view, and how much of the bottom of the room they're covering.
export function isoLook({ person = null, bottom = 0 } = {}) {
  if (iso.focus === person && iso.covered === bottom) return;
  iso.focus = person;
  iso.covered = bottom;
  iso.redraw = true;
}

// Where someone is in the view, for putting something over their head.
export function isoSpot(key) {
  return iso.hits.find((hit) => hit.key === `person:${key}`) ?? null;
}

function loop(now) {
  iso.frame = requestAnimationFrame(loop);
  if (!iso.canvas?.isConnected) {
    cancelAnimationFrame(iso.frame);
    iso.frame = 0;
    return;
  }
  const dt = Math.min(100, now - (iso.lastFrame || now));
  iso.lastFrame = now;
  const view = iso.hooks.view();
  if (!view) return;
  iso.calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useScene(view);
  const moving = moveEveryone(view, dt);
  const cameraMoving = iso.camera && iso.lastGoal !== `${Math.round(iso.camera.u * 50)},${Math.round(iso.camera.v * 50)}`;
  iso.lastGoal = iso.camera ? `${Math.round(iso.camera.u * 50)},${Math.round(iso.camera.v * 50)}` : "";
  // Nothing going on: just enough to keep the lights and the water moving.
  const every = moving || cameraMoving || iso.redraw || now - iso.fadeFrom < 320 ? 1000 / 30 : 1000 / 8;
  if (now - iso.lastDraw < every) return;
  const since = now - iso.lastDraw;
  iso.lastDraw = now;
  iso.redraw = false;
  draw(now, Math.min(100, since));
  lookUnderPointer();
}

// ---- Pointing and clicking ----------------------------------------------

function underPointer() {
  if (!iso.pointer) return null;
  const box = iso.canvas.getBoundingClientRect();
  const scale = scaleOfCanvas();
  const px = (iso.pointer.x - box.left) / scale;
  const py = (iso.pointer.y - box.top) / scale;
  // The front of the room first, and names before the people they belong to.
  for (let i = iso.hits.length - 1; i >= 0; i -= 1) {
    const hit = iso.hits[i];
    if (hit.kind === "you") continue;
    if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) return hit;
  }
  if (!iso.lastOrigin) return null;
  const { x, y } = cellAt((px - iso.lastOrigin.ox) / iso.unit, (py - iso.lastOrigin.oy) / iso.unit);
  return x >= 0 && y >= 0 && x < iso.scene.cols && y < iso.scene.lines ? { kind: "floor", x, y, key: `floor:${x},${y}` } : null;
}

function titleFor(hit) {
  if (hit?.kind === "person") return `${hit.person.name}${hit.person.doing ? `, ${hit.person.doing}` : ""}. Click to walk over and talk.`;
  if (hit?.kind === "thing") return `${hit.thing.name}. Click to walk over and take a look.`;
  if (hit?.kind === "exit") return hit.exit.closed ? `${hit.exit.label}. It's closed. Click to walk over and ask.` : `${hit.exit.label}. Click to go through.`;
  return "";
}

// How much bigger than its own measure the canvas is being drawn on the screen.
function scaleOfCanvas() {
  const width = iso.canvas.clientWidth;
  return width ? iso.canvas.getBoundingClientRect().width / width : 1;
}

function lookUnderPointer() {
  const hit = underPointer();
  if ((hit?.key ?? null) !== (iso.hover?.key ?? null)) iso.redraw = true;
  iso.hover = hit;
  const blocked = iso.hooks.blocked();
  iso.canvas.style.cursor = iso.hooks.reading?.() ? "pointer" : blocked ? "default" : hit && hit.kind !== "floor" ? "pointer" : "crosshair";
  const title = titleFor(hit);
  if (iso.canvas.title !== title) iso.canvas.title = title;
}

function onMove(event) {
  iso.pointer = { x: event.clientX, y: event.clientY };
  lookUnderPointer();
}

function onLeave() {
  iso.pointer = null;
  lookUnderPointer();
}

function onClick(event) {
  iso.pointer = { x: event.clientX, y: event.clientY };
  if (iso.hooks.pressed?.()) return;
  const hit = underPointer();
  if (!hit || iso.hooks.blocked()) return;
  if (hit.kind === "floor") iso.hooks.go({ action: "go", x: hit.x, y: hit.y });
  else iso.hooks.go({ action: "go", to: hit.key });
}

function onWheel(event) {
  event.preventDefault();
  iso.zoom = Math.min(ZOOMS.largest, Math.max(ZOOMS.smallest, iso.zoom * (event.deltaY < 0 ? 1.1 : 0.9)));
  iso.redraw = true;
}

// The level, as a canvas that goes where the console art would have gone.
export function isoFrameNode(hooks) {
  iso.hooks = hooks;
  iso.canvas ??= el("canvas", {
    class: "iso-canvas",
    id: "iso-canvas",
    role: "img",
    "aria-label": "The room you're in, drawn from an angle. The list beside it has everyone and everything in it.",
    onclick: onClick,
    onpointermove: onMove,
    onpointerleave: onLeave,
    onwheel: onWheel,
  });
  iso.redraw = true;
  if (!iso.frame) iso.frame = requestAnimationFrame(loop);
  return iso.canvas;
}
