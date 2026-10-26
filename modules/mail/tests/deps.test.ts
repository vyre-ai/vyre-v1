// Every package modules/mail imports by bare name is declared by the mail workspace and resolves from the lockfile at the version it pins (P-L5_14). A dynamic import("imapflow") that no package.json
// lists fails at first use on a real machine, which is the failure this test keeps from coming back.
// @reads /modules/mail/package.json
// @reads /package-lock.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mailDir = path.join(root, "modules/mail");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" || f === "tests" || f === "fixtures" ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

const BARE = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const pkgName = (spec: string): string => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0] as string);

function bareImports(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sources(mailDir)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(BARE)) {
      const spec = m[1] as string;
      if (spec.startsWith(".") || spec.startsWith("/") || builtins.has(spec) || spec.startsWith("node:")) continue;
      found.set(pkgName(spec), path.relative(root, file));
    }
  }
  return found;
}

interface Lock { packages: Record<string, { version?: string; license?: string; link?: boolean }> }
const manifest = JSON.parse(readFileSync(path.join(mailDir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as Lock;

test("every bare import in modules/mail is declared in modules/mail/package.json", () => {
  const imports = bareImports();
  for (const dep of ["imapflow", "mailparser"]) assert.ok(imports.has(dep), `the scan sees ${dep} (impl.ts imports it)`);
  const missing = [...imports].filter(([name]) => manifest.dependencies[name] === undefined).map(([name, file]) => `${name} (${file})`);
  assert.deepEqual(missing, [], "imported but not declared");
});

test("every declared dependency is pinned exactly and resolves from the lockfile at that version", () => {
  for (const [name, range] of Object.entries(manifest.dependencies)) {
    assert.match(range, /^\d+\.\d+\.\d+$/, `${name} is pinned to an exact version, not ${range}`);
    const hit = lock.packages[`node_modules/${name}`];
    assert.ok(hit, `${name} is in package-lock.json`);
    assert.equal(hit.version, range, `${name} resolves to the pinned version`);
  }
  assert.ok(lock.packages["modules/mail"], "the mail workspace is in the lockfile");
});

test("the four mail dependencies carry licenses the allowlist accepts", () => {
  const allowed = JSON.parse(readFileSync(path.join(root, "scripts/allowlist.json"), "utf8")) as { deps: Array<{ name: string }> };
  for (const name of Object.keys(manifest.dependencies)) {
    assert.ok(allowed.deps.some((d) => d.name === name), `${name} has an allowlist entry`);
    const license = lock.packages[`node_modules/${name}`]?.license;
    assert.ok(license === undefined || /^(MIT|MIT-0|Apache-2\.0|BSD-[23]-Clause|ISC)$/.test(license), `${name} license ${String(license)} is permissive`);
  }
});
