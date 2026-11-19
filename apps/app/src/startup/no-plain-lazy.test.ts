// No part of the app uses React.lazy directly (rc.40): its failed chunk is kept for the life of the page and, with no boundary of its own, takes the whole app down to the root error screen. A part that loads on request is
// lazyPart (ui/src/Lazy). The one exception is the Composer's own loader, which clears and retries a failed load itself.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ALLOWED = new Set(["ui/src/Composer/Deferred.tsx"]);

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
}

test("no source file draws a part with React.lazy", () => {
  const files: string[] = [];
  for (const d of ["apps/app/src", "ui/src"]) walk(path.join(root, d), files);
  const bad = files
    .map((f) => path.relative(root, f))
    .filter((f) => !ALLOWED.has(f))
    .filter((f) =>
      /import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*"react"/.test(fs.readFileSync(path.join(root, f), "utf8")),
    );
  assert.deepEqual(bad, [], "use lazyPart from ui/src/Lazy");
});
