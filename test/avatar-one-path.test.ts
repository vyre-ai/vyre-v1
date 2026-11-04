// Every face in the app goes through ui/Avatar. No place, kit or app draws a face of its own: DiceBear (or an avatar service) is imported only inside ui/src/Avatar, and no source calls a DiceBear address.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "generated", "dist", ".git", ".expo", "target"]);

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

test("no source outside ui/src/Avatar imports DiceBear or draws an avatar of its own", () => {
  const offenders: string[] = [];
  for (const top of ["apps", "ui", "kits", "client", "lib", "packages"]) {
    const dir = path.join(root, top);
    if (!fs.existsSync(dir)) continue;
    for (const file of sources(dir)) {
      const rel = path.relative(root, file);
      if (rel.startsWith(path.join("ui", "src", "Avatar") + path.sep)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (/@dicebear\/|api\.dicebear\.com|createAvatar\(|boring-?avatars|ui-avatars\.com|gravatar\.com\/avatar/.test(text)) offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], "faces are drawn by ui/Avatar only");
});

test("the drawing library never calls a service at runtime", () => {
  for (const f of ["library.ts", "agentface.ts", "index.tsx", "cache.ts"]) {
    const text = fs.readFileSync(path.join(root, "ui", "src", "Avatar", f), "utf8");
    assert.ok(!/fetch\(|XMLHttpRequest|api\.dicebear/.test(text), `${f} makes no network call`);
  }
});
