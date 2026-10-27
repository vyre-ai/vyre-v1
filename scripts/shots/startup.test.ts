// The startup report: chunk sizes, which scripts the entry loads, and the median; and the Metro setting that keeps unused modules from being evaluated at start.
// @reads /apps/app/metro.config.js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chunkSizes, entryScripts, median, report } from "./startup.mjs";

function fakeDist(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"));
  fs.mkdirSync(path.join(d, "_expo/static/js/web"), { recursive: true });
  fs.writeFileSync(path.join(d, "index.html"), '<html><script src="/_expo/static/js/web/entry-abc.js" defer></script></html>');
  fs.writeFileSync(path.join(d, "_expo/static/js/web/entry-abc.js"), "a".repeat(5000));
  fs.writeFileSync(path.join(d, "_expo/static/js/web/records-def.js"), "b".repeat(9000));
  return d;
}

test("chunks are listed largest first with raw and gzip sizes", () => {
  const c = chunkSizes(fakeDist());
  assert.deepEqual(c.map((x) => x.file), ["_expo/static/js/web/records-def.js", "_expo/static/js/web/entry-abc.js"]);
  assert.ok(c.every((x) => x.gzip > 0 && x.gzip < x.raw));
});

test("the entry is what index.html loads, and the report separates it from the lazy chunks", () => {
  const d = fakeDist();
  assert.deepEqual(entryScripts(d), ["_expo/static/js/web/entry-abc.js"]);
  const r = report(d);
  assert.equal(r.entryRaw, 5000);
  assert.equal(r.total, 14000);
  assert.match(r.text, /entry loads 1 script/);
});

test("the median ignores runs with no mark", () => {
  assert.equal(median([300, null, 100, 200]), 200);
  assert.equal(median([null]), null);
});

test("Metro inlines requires, so a module the first screen never touches is not evaluated at start", () => {
  const cfg = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "apps", "app", "metro.config.js"), "utf8");
  assert.match(cfg, /inlineRequires:\s*true/);
  assert.match(cfg, /getDefaultConfig\(__dirname\)/, "it extends Expo's own config");
});

test("all startup paths share one deferred Argon2 loader", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const files = ["apps/app/src/claim/ClaimRoute.tsx", "apps/app/src/shell/session/SessionGate.tsx", "apps/app/src/shell/session/desktop.ts"];
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /(?:from|import\()[^\n]*crypto\/keys\.ts/, `${file} must not pull the 265 KB Argon2 implementation into a shared startup chunk`);
    assert.match(src, /loadCryptoKeys/, `${file} uses the single on-demand loader`);
  }
  const loader = fs.readFileSync(path.join(root, "client/src/crypto/load.ts"), "utf8");
  assert.match(loader, /import\("\.\/keys\.ts"\)/, "the audited key implementation remains behind one dynamic boundary");
});

test("agent portraits do not put the DiceBear catalog in the startup chunk", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const avatar = fs.readFileSync(path.join(root, "ui/src/Avatar/index.tsx"), "utf8");
  assert.doesNotMatch(avatar, /(?:from|export \{)[^\n]*\.\/notionists\.ts/, "Avatar must render its lightweight fallback without statically loading the 386 KB portrait catalog");
  assert.match(avatar, /loadNotionists/, "the full portrait still loads after first paint");
  const loader = fs.readFileSync(path.join(root, "ui/src/Avatar/load.ts"), "utf8");
  assert.match(loader, /import\("\.\/notionists\.ts"\)/, "the catalog remains behind one dynamic boundary");
});

test("the signed-in shell is not parsed before the session gate finds a stored session", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const gate = fs.readFileSync(path.join(root, "apps/app/src/shell/session/SessionGate.tsx"), "utf8");
  for (const eager of ["../spaces/Shell.tsx", "../cmdk/CmdK.tsx", "./PlaceHost.tsx"]) assert.doesNotMatch(gate, new RegExp(`from ["']${eager.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  assert.match(gate, /lazy\(\(\) => import\("\.\/ShellHost\.tsx"\)/, "the authenticated shell has one explicit lazy boundary");
});

test("the web virtual-list boundary excludes the native FlashList runtime", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const shared = fs.readFileSync(path.join(root, "ui/src/VirtualList/index.tsx"), "utf8");
  assert.doesNotMatch(shared, /@shopify\/flash-list/, "the shared web list must not pull FlashList into the production entry");
  assert.match(shared, /from "\.\/NativeList"/, "Metro selects the platform implementation at the boundary");
  const native = fs.readFileSync(path.join(root, "ui/src/VirtualList/NativeList.native.tsx"), "utf8");
  assert.match(native, /@shopify\/flash-list/, "native keeps the existing FlashList implementation");
});
