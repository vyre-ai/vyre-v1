// What the desktop bundle stages for the vyred sidecar must hold every file the daemon reads at start. A daemon with the Space role (the Personal Space) reads docs/frozen/agent-tools.md when the MCP and
// engine modules load; the bundle left docs/ out, so the gateway failed to start inside the built app (and only there: from a source tree the file is always beside the code), the shell waited out its 25
// seconds, and every built app's Personal Space failed. Every `// @reads /path` a staged module declares must therefore be inside a staged directory, and the bundle check must look for the file.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIRS, REPO, SKIP, STAGE_FILES, plan } from "../src-tauri/stage-runtime.ts";

const staged = (rel: string): boolean => (RUNTIME_DIRS as readonly string[]).some((d) => rel === d || rel.startsWith(`${d}/`)) || (STAGE_FILES as readonly string[]).includes(rel);

test("the plan copies docs/frozen, where agent-tools.md is read at start", () => {
  const p = plan(["lib", "host"], () => true);
  assert.ok(p.copyDirs.includes("docs/frozen"));
  assert.ok(fs.existsSync(path.join(REPO, "docs/frozen/agent-tools.md")));
  assert.equal(SKIP.test("docs/frozen/agent-tools.md"), false, "the skip rule does not drop it");
});

test("every file a staged module declares with @reads is inside a staged directory", () => {
  const stray = new Map<string, string>();
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (SKIP.test(r)) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (/\.(ts|mjs|js)$/.test(e.name)) for (const m of fs.readFileSync(path.join(dir, e.name), "utf8").matchAll(/^\/\/ @reads (\/\S+)/gm)) if (!staged(m[1]!.slice(1))) stray.set(m[1]!, r);
    }
  };
  for (const d of RUNTIME_DIRS) if (fs.existsSync(path.join(REPO, d)) && !d.startsWith("docs/")) walk(path.join(REPO, d), d);
  assert.deepEqual([...stray], [], "a file read at start that the bundle does not carry");
});

test("the bundle check looks for the file, so a bundle without it fails before the app is run", () => {
  const src = fs.readFileSync(path.join(REPO, "apps/desktop/src-tauri/ci/bundle-check.ts"), "utf8");
  assert.ok(src.includes('"docs/frozen/agent-tools.md"'));
});

test("every file a staged module reads by a path relative to itself (new URL(\"../../x\", import.meta.url)) is staged", () => {
  const stray = new Map<string, string>();
  // test helpers that only a test file imports read from a fixtures folder the bundle never carries
  const helper = (rel: string): boolean => /(^|\/)testing\.ts$/.test(rel);
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = `${rel}/${e.name}`;
      if (SKIP.test(r)) continue;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
      if (!/\.(ts|mjs|js)$/.test(e.name) || helper(r)) continue;
      for (const m of fs.readFileSync(path.join(dir, e.name), "utf8").matchAll(/new URL\(\s*[`"']([^`"']*)[`"']\s*,\s*import\.meta\.url/g)) {
        let lit = m[1]!;
        const cut = lit.indexOf("${");
        if (cut >= 0) lit = lit.slice(0, cut);
        if (!lit.startsWith(".")) continue;
        const target = path.relative(REPO, path.resolve(path.dirname(path.join(REPO, r)), lit.endsWith("/") ? lit : cut >= 0 ? path.dirname(lit + "x") : lit));
        if (target === "" || target.startsWith("..") || !fs.existsSync(path.join(REPO, target))) continue;   // "" is the repo root itself (a base for other paths)
        if (!staged(target)) stray.set(`${r} -> ${m[1]}`, target);
      }
    }
  };
  for (const d of RUNTIME_DIRS) if (fs.existsSync(path.join(REPO, d)) && !d.startsWith("docs/")) walk(path.join(REPO, d), d);
  assert.deepEqual([...stray], [], "a path a module reads relative to itself that the bundle does not carry");
});

test("the bundle check looks for every staged single file", () => {
  const src = fs.readFileSync(path.join(REPO, "apps/desktop/src-tauri/ci/bundle-check.ts"), "utf8");
  for (const f of STAGE_FILES) assert.ok(src.includes(`"${f}"`), f);
});
