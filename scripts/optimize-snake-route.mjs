// Keep snk's wandering route, shortening at most 25% through local shortcuts.
// Every contribution must remain reachable, and the four-part snake must stay
// continuous and collision-free, including the return to its initial pose.
const MAX_REDUCTION = 0.25;
const MAX_SHORTCUT_SPAN = 48;
const MARKER = 'data-route-optimized="true"';
const key = ({ x, y }) => `${x},${y}`;
const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const keyframesPattern = (id) =>
  new RegExp(`@keyframes ${id}\\{((?:[^{}]*\\{[^{}]*\\})*)\\}`);

function keyframes(svg, id) {
  const match = svg.match(keyframesPattern(id));
  if (!match) throw new Error(`SVG contains no ${id} keyframes.`);
  return match[1];
}

function replaceKeyframes(svg, id, frames) {
  keyframes(svg, id);
  return svg.replace(keyframesPattern(id), `@keyframes ${id}{${frames}}`);
}

function positionAt(route, initial, frame, part) {
  return frame >= part ? route[frame - part] : initial[part - frame];
}

function collisionFree(route, initial, from = 0, to = route.length) {
  for (let frame = from; frame < Math.min(to, route.length); frame += 1) {
    for (let part = 1; part < initial.length; part += 1) {
      if (key(route[frame]) === key(positionAt(route, initial, frame, part))) {
        return false;
      }
    }
  }
  return true;
}

// Read the compact CSS emitted by Platane/snk/svg-only@v3. Reject an unfamiliar
// shape instead of silently publishing a broken animation.
export function readSnakeAnimation(svg) {
  const rectangles = [...svg.matchAll(/<rect\b([^>]*)\/?>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]),
    ),
  );
  const dots = rectangles.filter((rect) => /^c(?: |$)/.test(rect.class ?? ""));
  const rows = [...new Set(dots.map((dot) => Number(dot.y)))].sort((a, b) => a - b);
  const size = rows[1] - rows[0];
  if (!(size > 0)) throw new Error("SVG contains no regular contribution grid.");
  const offset = Math.min(...dots.map((dot) => Number(dot.x)));
  const cells = dots
    .filter((dot) => /^c c[0-9a-z]+$/.test(dot.class))
    .map((dot) => ({
      id: dot.class.split(" ")[1],
      x: (Number(dot.x) - offset) / size,
      y: (Number(dot.y) - rows[0]) / size,
    }));
  const initial = [];
  const posePattern = /\.s\.s(\d+)\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\);animation-name:s\d+\}/g;
  for (const match of svg.matchAll(posePattern)) {
    initial[Number(match[1])] = {
      x: Number(match[2]) / size,
      y: Number(match[3]) / size,
    };
  }
  if (initial.length !== 4 || initial.filter(Boolean).length !== 4) {
    throw new Error("SVG must contain the four-part snk snake.");
  }
  const points = [];
  const movePattern = /((?:[\d.]+%,?)+)\{transform:translate\((-?[\d.]+)px,(-?[\d.]+)px\)\}/g;
  for (const match of keyframes(svg, "s0").matchAll(movePattern)) {
    for (const time of match[1].matchAll(/([\d.]+)%/g)) {
      points.push({
        t: Number(time[1]),
        x: Number(match[2]) / size,
        y: Number(match[3]) / size,
      });
    }
  }
  points.sort((a, b) => a.t - b.t);
  if (!points.length || points[0].t !== 0 || key(points[0]) !== key(initial[0])) {
    throw new Error("SVG contains no valid starting snake keyframe.");
  }
  const aligned = (p) => Number.isInteger(p.x) && Number.isInteger(p.y);
  if (![...points, ...initial, ...cells].every(aligned)) {
    throw new Error("Snake coordinates must align to the contribution grid.");
  }
  const route = [{ x: points[0].x, y: points[0].y }];
  for (const point of points.slice(1)) {
    let previous = route.at(-1);
    if (point.x !== previous.x && point.y !== previous.y) {
      throw new Error("Snake route contains a diagonal move.");
    }
    while (key(previous) !== key(point)) {
      previous = {
        x: previous.x + Math.sign(point.x - previous.x),
        y: previous.y + Math.sign(point.y - previous.y),
      };
      route.push(previous);
    }
  }
  const closesLoop = initial.every(
    (p, part) => key(p) === key(positionAt(route, initial, route.length - 1, part)),
  );
  if (!collisionFree(route, initial) || !closesLoop) {
    throw new Error("Snake route is not a collision-free closed loop.");
  }
  const visited = new Set(route.map(key));
  if (cells.some((cell) => !visited.has(key(cell)))) {
    throw new Error("Snake route misses a contribution cell.");
  }
  return { route, initial, cells, size };
}

function shortcut(from, to, axes) {
  const path = [];
  let point = from;
  for (const axis of axes) {
    while (point[axis] !== to[axis]) {
      point = { ...point, [axis]: point[axis] + Math.sign(to[axis] - point[axis]) };
      path.push(point);
    }
  }
  return path;
}

function shortenRoute(original, initial, cells) {
  let route = original;
  const required = new Set(cells.map(key));
  const budget = Math.floor((original.length - 1) * MAX_REDUCTION);
  while (original.length - route.length < budget) {
    const counts = new Map();
    for (const point of route) {
      counts.set(key(point), (counts.get(key(point)) ?? 0) + 1);
    }
    const remaining = budget - (original.length - route.length);
    const lastShortcutFrame = route.length - initial.length - 1;
    let best;
    // Preserve the opening and closing poses. Only change short stretches so
    // the original route keeps its recognizable turns and backtracking.
    for (let from = initial.length - 1; from < lastShortcutFrame; from += 1) {
      const removed = new Map();
      const end = Math.min(from + MAX_SHORTCUT_SPAN, lastShortcutFrame);
      for (let to = from + 1; to <= end; to += 1) {
        const cell = key(route[to]);
        removed.set(cell, (removed.get(cell) ?? 0) + 1);
        const saved = to - from - distance(route[from], route[to]);
        if (saved < 2 || saved > remaining || saved <= (best?.saved ?? 0)) continue;
        for (const axes of [["x", "y"], ["y", "x"]]) {
          const path = shortcut(route[from], route[to], axes);
          const crossed = new Set(path.map(key));
          const skipsCell = [...removed].some(
            ([cell, count]) => required.has(cell) && counts.get(cell) <= count && !crossed.has(cell),
          );
          if (skipsCell) continue;
          const candidate = [
            ...route.slice(0, from + 1),
            ...path,
            ...route.slice(to + 1),
          ];
          // After four unchanged frames, the body is back on the old route.
          const rejoined = from + path.length + initial.length + 1;
          if (!collisionFree(candidate, initial, from + 1, rejoined)) continue;
          best = { from, to, path, saved };
          break;
        }
      }
    }
    if (!best) break;
    route = [
      ...route.slice(0, best.from + 1),
      ...best.path,
      ...route.slice(best.to + 1),
    ];
  }
  return route;
}

export function optimizeSnakeRoute(svg) {
  if (svg.includes(MARKER)) return svg;
  const { route: original, initial, cells, size } = readSnakeAnimation(svg);
  const route = shortenRoute(original, initial, cells);
  if (route.length === original.length) return svg;
  let result = svg;
  const percent = (frame) => Number(((frame / route.length) * 100).toFixed(4));
  for (let part = 0; part < initial.length; part += 1) {
    const points = route.map((_, frame) => positionAt(route, initial, frame, part));
    const frames = points
      .map((point, frame) => {
        const before = points[frame - 1];
        const after = points[frame + 1];
        if (before && after &&
            before.x + after.x === 2 * point.x &&
            before.y + after.y === 2 * point.y) return "";
        return `${percent(frame)}%{transform:translate(${point.x * size}px,${point.y * size}px)}`;
      })
      .join("");
    result = replaceKeyframes(result, `s${part}`, frames);
  }
  for (const cell of cells) {
    const frame = route.findIndex((point) => key(point) === key(cell));
    const color = svg.match(new RegExp(`\\.c\\.${cell.id}\\{fill:(var\\(--c\\d+\\))`))?.[1];
    if (frame < 0 || !color) throw new Error(`Cannot retime contribution ${cell.id}.`);
    const eaten = percent(frame);
    const before = Math.max(0, Number((eaten - 0.01).toFixed(4)));
    result = replaceKeyframes(
      result,
      cell.id,
      `0%,${before}%{fill:${color}}${eaten}%,100%{fill:var(--ce)}`,
    );
  }
  return result.replace("<svg ", `<svg ${MARKER} `);
}
