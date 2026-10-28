import assert from "node:assert/strict";
import { test } from "node:test";
import { limitSnakeBites, setSnakeLoopDuration } from "./limit-snake-bites.mjs";
import { optimizeSnakeRoute, readSnakeAnimation } from "./optimize-snake-route.mjs";

const initial = [{ x: 0, y: -1 }, { x: 1, y: -1 }, { x: 2, y: -1 }, { x: 3, y: -1 }];
const key = ({ x, y }) => `${x},${y}`;

function routeThrough(corners) {
  const route = [initial[0]];
  for (const [x, y] of corners) {
    let point = route.at(-1);
    assert.ok(point.x === x || point.y === y);
    while (point.x !== x || point.y !== y) {
      point = { x: point.x + Math.sign(x - point.x), y: point.y + Math.sign(y - point.y) };
      route.push(point);
    }
  }
  return route;
}

const wandering = routeThrough([
  [0, 0], [8, 0], [8, 6], [0, 6], [0, 0], [8, 0], [8, 6], [0, 6],
  [-1, 6], [-1, -2], [9, -2], [9, -1], [0, -1],
]);
const compact = routeThrough([[0, 6], [8, 6], [8, -1], [0, -1]]);

function fixture(route, dark = false) {
  const active = [...new Map(route.filter((p) => p.x >= 0 && p.x <= 8 && p.y >= 0 && p.y <= 6).map((p) => [key(p), p])).values()];
  let css = `:root{--cs:${dark ? "#a998ff" : "#6f5be7"};--ce:#e8edf2;--c1:#82d7bd}`;
  css += ".c{fill:var(--ce);animation:none 9000ms linear infinite;width:12px;height:12px}";
  css += ".s{fill:var(--cs);animation:none linear 9000ms infinite}";
  css += ".u{animation:none linear 9000ms infinite}";
  for (let part = 0; part < 4; part += 1) {
    const frames = route.map((_, frame) => {
      const p = frame >= part ? route[frame - part] : initial[part - frame];
      return `${(100 * frame / route.length).toFixed(4)}%{transform:translate(${p.x * 16}px,${p.y * 16}px)}`;
    }).join("");
    css += `@keyframes s${part}{${frames}}.s.s${part}{transform:translate(${initial[part].x * 16}px,-16px);animation-name:s${part}}`;
  }
  for (let i = 0; i < active.length; i += 1) {
    css += `@keyframes c${i}{0%{fill:var(--c1)}99%,100%{fill:var(--ce)}}.c.c${i}{fill:var(--c1);animation-name:c${i}}`;
  }
  let rects = "";
  for (let x = 0; x <= 8; x += 1) {
    for (let y = 0; y <= 6; y += 1) {
      const index = active.findIndex((p) => p.x === x && p.y === y);
      rects += `<rect class="c${index < 0 ? "" : ` c${index}`}" x="${x * 16 + 2}" y="${y * 16 + 2}"/>`;
    }
  }
  for (let part = 0; part < 4; part += 1) rects += `<rect class="s s${part}"/>`;
  return `<svg viewBox="-16 -32 176 192"><style>${css}</style>${rects}</svg>`;
}

function assertSafeAndComplete(svg, expectedCells) {
  const { route, cells } = readSnakeAnimation(svg);
  assert.deepEqual(cells, expectedCells);
  for (let i = 1; i < route.length; i += 1) {
    assert.equal(Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y), 1);
  }
  for (let frame = 0; frame < route.length; frame += 1) {
    const body = initial.map((_, part) => frame >= part ? route[frame - part] : initial[part - frame]);
    assert.equal(new Set(body.map(key)).size, 4, `collision at frame ${frame}`);
  }
  assert.deepEqual(route.slice(-4).reverse(), initial);
  for (const cell of cells) {
    const firstVisit = route.findIndex((p) => key(p) === key(cell));
    assert.ok(firstVisit >= 0);
    const frames = svg.match(new RegExp(`@keyframes ${cell.id}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`))[1];
    const eaten = Number(frames.match(/([\d.]+)%,100%\{fill:var\(--ce\)/)[1]);
    assert.ok(Math.abs(eaten - firstVisit / route.length * 100) < 0.0001, `bite out of sync: ${cell.id}`);
  }
  // Check the rendered tail keyframes, not just the reconstructed head path.
  for (let part = 1; part < 4; part += 1) {
    const frames = svg.match(new RegExp(`@keyframes s${part}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`))[1];
    for (const match of frames.matchAll(/([\d.]+)%\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\)\}/g)) {
      const frame = Math.round(Number(match[1]) / 100 * route.length);
      const expected = frame >= part ? route[frame - part] : initial[part - frame];
      assert.equal(Number(match[2]), expected.x * 16);
      assert.equal(Number(match[3]), expected.y * 16);
    }
  }
  return route;
}

test("shortens wandering detours without losing contributions or breaking the snake", () => {
  const input = fixture(wandering);
  const output = optimizeSnakeRoute(input);
  const route = assertSafeAndComplete(output, readSnakeAnimation(input).cells);
  assert.ok(route.length < wandering.length);
  assert.ok(route.length - 1 >= (wandering.length - 1) * 0.75);
  assert.deepEqual(route.slice(0, 4), wandering.slice(0, 4));
  assert.equal(optimizeSnakeRoute(output), output);
});

test("keeps a compact route when shortcuts would skip required cells", () => {
  const input = fixture(compact);
  assert.equal(optimizeSnakeRoute(input), input);
});

test("light and dark animations keep the same route, all bites and a fixed duration", () => {
  const outputs = [false, true].map((dark) => {
    const input = fixture(wandering, dark);
    const output = setSnakeLoopDuration(limitSnakeBites(optimizeSnakeRoute(input), 1), 37700);
    assertSafeAndComplete(output, readSnakeAnimation(input).cells);
    assert.deepEqual([...output.matchAll(/animation:none[^;}]*?(\d+)ms/g)].map((m) => m[1]), ["37700", "37700", "37700"]);
    assert.equal([...output.matchAll(/\.c\.c[0-9a-z]+\{[^}]*animation-name:/g)].length, readSnakeAnimation(input).cells.length);
    assert.ok(output.includes(dark ? "--cs:#a998ff" : "--cs:#6f5be7"));
    assert.ok(output.includes(".u{display:none;"));
    assert.equal(setSnakeLoopDuration(output, 37700), output);
    return output;
  });
  assert.deepEqual(readSnakeAnimation(outputs[0]).route, readSnakeAnimation(outputs[1]).route);
});

test("rejects unsupported or incomplete input instead of publishing missing bites", () => {
  const input = fixture(wandering);
  assert.throws(() => optimizeSnakeRoute(input.replaceAll("@keyframes s0", "@keyframes other")), /s0 keyframes/);
  assert.throws(() => optimizeSnakeRoute(input.replaceAll("@keyframes s1", "@keyframes other")), /s1 keyframes/);
  assert.throws(() => optimizeSnakeRoute(input.replaceAll("@keyframes c0", "@keyframes other")), /c0 keyframes/);
  assert.throws(() => optimizeSnakeRoute(input.replace('class="c c0" x="2" y="2"', 'class="c c0" x="50" y="50"')), /misses a contribution/);
  assert.throws(() => setSnakeLoopDuration(input, 0), /positive integer/);
  assert.throws(() => setSnakeLoopDuration(input.replace("animation:none 9000ms", "animation:none"), 37700), /no loop duration/);
});
