// A call the code writes out in full matches its contract (f-wire, 12 Nov). The app and the modules call most capabilities through untyped doors (`data.call(cap: string, input)`), so the type
// checker never sees a missing required field or a field the contract does not have: such a call can only fail with validation.bad_input. Two did: the Live re-run sent automations.replay
// without confirm, and Remove route sent mail.route.remove without its domain. This reads every literal call (the input written as an object with no spread) and checks it against the registry.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registry } from "../generated/registry.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Schema = { $ref?: string; properties?: Record<string, unknown>; required?: string[] };
const defs = (registry as unknown as { $defs: Record<string, Schema> }).$defs;
const resolve = (s: Schema): Schema => { let x = s; while (x.$ref) x = defs[x.$ref.split("/").pop()!]!; return x; };
const inputs = new Map(registry.capabilities.map((c) => [c.name, resolve(c.input as Schema)]));

/** The doors that send the input as written: no wrapper adds a field on the way. */
const DOOR = /\b(?:data\.call|rt\.call|action\.run|ctx\.call)\(\s*["']([a-z][a-z0-9_-]*(?:\.[a-z0-9_]+)+)["']\s*,\s*\{/g;

/** Blank out comments and string bodies, keeping offsets, so braces and keys are read from code only. */
export function codeOnly(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!, n = src[i + 1];
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } out += "\n"; continue; }
    if (c === "/" && n === "*") { while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; } out += "  "; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      out += c; i++;
      while (i < src.length && src[i] !== c) { if (src[i] === "\\") { out += "  "; i += 2; continue; } out += src[i] === "\n" ? "\n" : "_"; i++; }
      out += c; continue;
    }
    out += c;
  }
  return out;
}

/** The keys of the object literal that opens at `at` (just after its `{`), or null when it spreads something in (its keys cannot be read). */
export function keysAt(code: string, at: number, raw: string = code): string[] | null {
  const keys: string[] = [];
  let depth = 1, expectKey = true;
  for (let i = at; i < code.length && depth > 0; i++) {
    const c = code[i]!;
    if ("{[(".includes(c)) { depth++; expectKey = false; continue; }
    if ("}])".includes(c)) { depth--; continue; }
    if (depth !== 1) continue;
    if (c === ",") { expectKey = true; continue; }
    if (!expectKey || /\s/.test(c)) continue;
    if (code.startsWith("...", i)) return null;
    const m = /^([A-Za-z_$][\w$]*)\s*(\??:|,|\})/.exec(code.slice(i));
    if (m) { keys.push(m[1]!); i += m[1]!.length - 1; } else if (/^["']/.test(c)) { const q = /^(["'])([^"']*)\1\s*:/.exec(raw.slice(i)); if (q) { keys.push(q[2]!); i += q[0].length - 1; } }
    expectKey = false;
  }
  return keys;
}

function sources(): string[] {
  const out: string[] = [];
  for (const d of ["apps/app/src", "ui/src", "modules"]) {
    for (const f of fs.readdirSync(path.join(root, d), { recursive: true }) as string[]) {
      const p = `${d}/${f}`;
      if (/\.(ts|tsx)$/.test(p) && !/(\.test\.|\/tests?\/|\/fixtures?\/|sample|\.support\.)/.test(p)) out.push(p);
    }
  }
  return out;
}

test("the key reader takes code keys, skips nested ones, comments and strings, and gives up on a spread", () => {
  const read = (s: string): string[] | null => { const c = codeOnly(s); return keysAt(c, c.indexOf("{") + 1, s); };
  assert.deepEqual(read('{ a: 1, b: { c: 2 }, "d": 3, e }'), ["a", "b", "d", "e"]);
  assert.deepEqual(read("{ // kind: no\n kind: \"ask\", list: [{ x: 1 }] }"), ["kind", "list"]);
  assert.equal(read("{ a: 1, ...rest }"), null);
});

test("every call written out in full names every field its contract requires, and no field it does not have", () => {
  const bad: string[] = [];
  let seen = 0;
  for (const f of sources()) {
    const raw = fs.readFileSync(path.join(root, f), "utf8");
    if (!/\b(?:data\.call|rt\.call|action\.run|ctx\.call)\(/.test(raw)) continue;
    for (const m of raw.matchAll(DOOR)) {
      // read from the call on: the call itself is code, so a quote earlier in the file (an apostrophe in JSX text) cannot shift what counts as a string
      const from = raw.slice(m.index!, m.index! + 4000), code = codeOnly(from);
      const cap = m[1]!, input = inputs.get(cap);
      if (!input?.properties) continue;
      const keys = keysAt(code, m[0].length, from);
      if (keys === null) continue;
      seen++;
      const at = `${f}:${raw.slice(0, m.index).split("\n").length}`;
      // in the app the idempotency key is the door's (client/src/gateway withKey adds one when the call has none); a module's ctx.call must send its own (host/src/invoke.ts refuses one without)
      const appDoor = !f.startsWith("modules/");
      const missing = (input.required ?? []).filter((k) => !(appDoor && k === "idempotencyKey") && !keys.includes(k));
      const unknown = keys.filter((k) => k !== "idempotencyKey" && !(k in input.properties!));
      if (missing.length) bad.push(`${at} ${cap} lacks ${missing.join(", ")}`);
      if (unknown.length) bad.push(`${at} ${cap} sends ${unknown.join(", ")}, which its contract does not have`);
    }
  }
  assert.ok(seen > 500, `read the calls (${seen})`);
  assert.deepEqual(bad, []);
});
