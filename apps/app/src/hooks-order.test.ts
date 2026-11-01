// A component must call the same hooks on every render. A hook after an early `return` runs only once the early return stops firing (data arrived), so React throws #310 ("rendered more hooks
// than during the previous render") and the place shows "Couldn't draw this page". The Inbox conversation did exactly that, so a person could not open an email. This scans every component
// body in the app for a hook call at the top level of the function after a top-level early return.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));

function files(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") files(f, out); }
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) out.push(f);
  }
  return out;
}

/** Hook calls (use<Name>( ) at the function's own indentation, after an early return at that same indentation, inside one function. */
export function hooksAfterEarlyReturn(text: string): { line: number; code: string }[] {
  const lines = text.split("\n");
  const found: { line: number; code: string }[] = [];
  let early = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\S/.test(l) && !/^[})\]]/.test(l)) early = false;   // a new top-level statement starts a new function
    if (/^  if \([^{]*\) return\b[^;]*;\s*$/.test(l) && !/return null;|return;|return undefined;/.test(l)) early = true;
    else if (early && /^  (const|let) .*= use[A-Z]\w*\(|^  use[A-Z]\w*\(/.test(l)) found.push({ line: i + 1, code: l.trim().slice(0, 100) });
  }
  return found;
}

test("the scan finds a hook after an early return and nothing else", () => {
  const bad = "function A() {\n  const a = useX();\n  if (!a) return <Loading />;\n  const b = useY();\n  return <b />;\n}\nfunction B() {\n  const a = useX();\n  const b = useY();\n  if (!a) return <Loading />;\n  return <b />;\n}\n";
  assert.deepEqual(hooksAfterEarlyReturn(bad).map((f) => f.line), [4]);
});

test("no component in the app calls a hook after an early return", () => {
  const all: string[] = [];
  for (const f of files(ROOT)) for (const hit of hooksAfterEarlyReturn(fs.readFileSync(f, "utf8"))) all.push(`${path.relative(ROOT, f)}:${hit.line} ${hit.code}`);
  assert.deepEqual(all, []);
});
