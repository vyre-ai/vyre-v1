// Every task a module makes with tasks.create must offer only the actions its kind takes (KIND_ACTIONS). A wrong key is refused at run time with unknown_action, and a caller that swallows
// the error (as a limit card or a sign-in item does) silently makes nothing. This scans the sources, so a new caller is held to it too.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KIND_ACTIONS } from "../handlers/state.ts";

const MODULES = fileURLToPath(new URL("../..", import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["tests", "fixtures", "node_modules", "migrations"].includes(e.name)) sources(f, out); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(f);
  }
  return out;
}

test("every tasks.create in the modules names only actions its kind takes", () => {
  let calls = 0;
  const bad: string[] = [];
  for (const file of sources(MODULES)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/call\("tasks\.create",\s*\{/g)) {
      const window = text.slice(m.index!, m.index! + 1400).split(/\n\s*\}\)\)?;?\n/)[0]!;
      const kind = /kind:\s*"(\w+)"/.exec(window)?.[1] ?? "work";
      const keys = [...window.matchAll(/actions:\s*\[([^\]]*)\]/g)].flatMap((a) => [...a[1]!.matchAll(/key:\s*"(\w+)"/g)].map((k) => k[1]!));
      calls++;
      const allowed = new Set(KIND_ACTIONS[kind as keyof typeof KIND_ACTIONS]?.map((a) => a.key) ?? []);
      for (const k of keys) if (!allowed.has(k)) bad.push(`${path.relative(MODULES, file)}: a ${kind} task has no action called ${k}`);
    }
  }
  assert.ok(calls >= 8, `tasks.create calls found: ${calls}`);
  assert.deepEqual(bad, []);
});
