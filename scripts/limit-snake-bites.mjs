import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const CONTRIBUTION_RULE = /\.c\.(c[0-9a-z]+)\{([^{}]*)\}/g;
const LOOP_CLASSES = ["c", "s", "u"];

export function limitSnakeBites(svg, interval) {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new TypeError("Bite interval must be a positive integer.");
  }

  let animatedCells = 0;
  const transformed = svg.replace(
    CONTRIBUTION_RULE,
    (rule, id, declarations) => {
      const animationName = `animation-name:${id}`;
      if (!declarations.includes(animationName)) return rule;

      const shouldBeEaten = animatedCells % interval === 0;
      animatedCells += 1;

      if (shouldBeEaten) return rule;

      const staticDeclarations = declarations.replace(
        new RegExp(`${animationName};?`),
        "",
      );
      return `.c.${id}{${staticDeclarations}}`;
    },
  );

  if (animatedCells === 0) {
    throw new Error("SVG contains no animated contribution cells.");
  }

  return transformed.replace(/\.u\{(?!display:none;)/, ".u{display:none;");
}

export function setSnakeLoopDuration(svg, durationMs) {
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    throw new TypeError("Loop duration must be a positive integer.");
  }

  let transformed = svg;

  for (const className of LOOP_CLASSES) {
    const rulePattern = new RegExp(`\\.${className}\\{([^{}]*)\\}`);
    const rule = transformed.match(rulePattern);

    if (!rule) {
      throw new Error(`SVG contains no .${className} animation rule.`);
    }

    const declarations = rule[1].replace(
      /(animation:none[^;]*?)\b\d+ms\b/,
      `$1${durationMs}ms`,
    );

    if (declarations === rule[1]) {
      throw new Error(`SVG .${className} rule contains no loop duration.`);
    }

    transformed = transformed.replace(
      rulePattern,
      `.${className}{${declarations}}`,
    );
  }

  return transformed;
}

async function main() {
  const [rawInterval, rawDuration, ...files] = process.argv.slice(2);
  const interval = Number(rawInterval);
  const durationMs = Number(rawDuration);

  if (!rawInterval || !rawDuration || files.length === 0) {
    throw new Error(
      "Usage: node scripts/limit-snake-bites.mjs <interval> <duration-ms> <svg-file> [svg-file...]",
    );
  }

  const transformedFiles = await Promise.all(
    files.map(async (file) => ({
      file,
      content: setSnakeLoopDuration(
        limitSnakeBites(await readFile(file, "utf8"), interval),
        durationMs,
      ),
    })),
  );

  await Promise.all(
    transformedFiles.map(({ file, content }) => writeFile(file, content)),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
