// Every name a file imports from lazy-pages.tsx is a part that exists there: an import of a name the file does not export is `undefined` at the first draw that uses it, and React stops that place with error
// #130 ("element type is invalid") the moment it is drawn again (rc.41: a merge that kept another version of this file broke the Chats place on return). And every loader of the table resolves to a component.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pages from "./lazy-pages.tsx";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

test("every name imported from lazy-pages.tsx is exported by it, as a component", () => {
  const wanted = new Map<string, string[]>();
  for (const f of sources(root)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*lazy-pages\.tsx["']/g)) {
      if (m[1]) continue; // a type import is not a value
      for (const raw of m[2]!.split(",")) {
        const name = raw
          .trim()
          .split(/\s+as\s+/)[0]!
          .trim();
        if (name !== "" && !name.startsWith("type "))
          wanted.set(name, [...(wanted.get(name) ?? []), path.relative(root, f)]);
      }
    }
  }
  assert.ok(wanted.size > 5, `found the imports (${wanted.size})`);
  const missing = [...wanted].filter(([n]) => typeof (pages as Record<string, unknown>)[n] !== "function");
  assert.deepEqual(
    missing.map(([n, from]) => `${n} (imported by ${from.join(", ")})`),
    [],
    "imported from lazy-pages.tsx but not a component there",
  );
});

test("every part of the table loads and is a component", async () => {
  await pages.preloadChatsPages();
  for (const [name, v] of Object.entries(pages))
    if (name !== "preloadChatsPages") assert.equal(typeof v, "function", name);
});
