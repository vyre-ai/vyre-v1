// A module's port that only a test ever binds is a part that does nothing in a real Space (12 Nov: the computers module's Vault scrubber was bound only in its test harness, so every browser
// answer went out unscrubbed while its tests passed). Every `export function bindX` in a module must be called by production code (the module itself, or the host), or be listed below with why a
// real Space needs no call.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Ports a real Space never binds, each with the reason. */
const TEST_ONLY: Readonly<Record<string, string>> = {
  "modules/terminal:bindHost": "a stand-in host for tests; a real Space binds the machine's own through bindMachineHost (setTerminalHost)",
  "modules/terminal:bindPlace": "a stand-in for tests; a real Space binds bindMachinePlace (setTerminalHost)",
  "modules/terminal:bindValues": "a stand-in for tests; a real Space binds bindMachineValues (setTerminalHost)",
  "modules/terminal:bindKit": "a stand-in for tests; the real kit (lib/vault-use) is bound from the start",
  "modules/computers:bindKit": "a stand-in for tests; the real scrubber (lib/vault-use) is bound from the start",
  "modules/computers:bindMigration": "all three migration ports at once, for tests; a real Space binds them one by one with bindMigrationPort",
  "modules/engine:bindCompleter": "a stand-in for tests; the runtime sets its own completer when it starts",
  "modules/mail:bindDns": "a per-context stand-in for tests; a real Space uses setDefaultDns",
  "modules/mail:bindImapSession": "a per-context stand-in for tests; a real Space uses setDefaultImapSession",
};

/**
 * Ports nothing binds in a real Space today, found by this test on 12 Nov 2026 and reported to the lead (outside the Vault lane). The list may only shrink: an entry that becomes bound must come off.
 *   bindTeam (terminal, computers): unbound means "a Team Space", so a Personal Space is treated as a team one where nothing else says where a turn runs.
 *   bindSandboxStopper: turning subscription sharing off never stops the person's server sandbox (it reports sandboxStopped false).
 */
const KNOWN_UNBOUND: ReadonlySet<string> = new Set(["modules/terminal:bindTeam", "modules/computers:bindTeam", "modules/engine:bindSandboxStopper"]);

const testy = (rel: string): boolean => /(^|\/)(tests?|fixtures)\//.test(rel) || /\.test\.tsx?$/.test(rel) || /-kit\.test\.ts$/.test(rel);

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "generated" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

test("every port a module exports is bound by production code, or is listed with why not", () => {
  const prod = [...files(path.join(ROOT, "modules")), ...files(path.join(ROOT, "host", "src"))].map((p) => ({ rel: path.relative(ROOT, p).split(path.sep).join("/"), p })).filter((f) => !testy(f.rel));
  const text = new Map(prod.map((f) => [f.rel, fs.readFileSync(f.p, "utf8")] as const));
  const unbound: string[] = [];
  const seen = new Set<string>();
  for (const [rel, src] of text) {
    if (!rel.startsWith("modules/")) continue;
    const mod = rel.split("/").slice(0, 2).join("/");
    for (const m of src.matchAll(/^export (?:function|const) (bind[A-Z][A-Za-z0-9]*)\b/gm)) {
      const name = m[1] as string;
      const key = `${mod}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // a call is the name followed by `(` or `?.(`, on a line that is not its definition, an import or a re-export; in this module or in the host (which binds through the loader by name too)
      const call = new RegExp(`(^|[^A-Za-z0-9_.])${name}(\\?\\.)?\\(`);
      const named = new RegExp(`["'.]${name}["'?]`);
      const called = [...text].some(([r, s]) => (r.startsWith(`${mod}/`) || r.startsWith("host/")) && s.split("\n").some((line) => {
        const t = line.trim();
        if (/^(import|export \{|export \*|\/\/|\*|\/\*\*)/.test(t) || new RegExp(`^export (function|const) ${name}\\b`).test(t)) return false;
        return call.test(line) || (r.startsWith("host/") && named.test(line));
      }));
      if (called && KNOWN_UNBOUND.has(key)) unbound.push(`${key} is bound now: take it off KNOWN_UNBOUND`);
      if (!called && TEST_ONLY[key] === undefined && !KNOWN_UNBOUND.has(key)) unbound.push(`${key} (${rel})`);
    }
  }
  for (const key of Object.keys(TEST_ONLY)) assert.ok(seen.has(key), `${key} is listed as test-only but no longer exists: take it off the list`);
  assert.deepEqual(unbound, [], "ports only a test binds; bind them in production, or list them here with the reason");
});
