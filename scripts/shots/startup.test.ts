// The startup report: chunk sizes, which scripts the entry loads, and the median; and the Metro setting that keeps unused modules from being evaluated at start.
// @reads /apps/app/metro.config.cjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { closure, imports } from "../lib/graph.mjs";
import { MAX_STEAL_PCT, STEAL_ATTEMPTS, chunkSizes, enforceStartupBudget, entryScripts, measureQuiet, median, report, stealPct } from "./startup.mjs";

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
// Add new startup ownership checks above so this file remains the bundle-boundary contract.
test("the median ignores runs with no mark", () => {
  assert.equal(median([300, null, 100, 200]), 200);
  assert.equal(median([null]), null);
});

test("Metro inlines requires, so a module the first screen never touches is not evaluated at start", () => {
  const cfg = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "apps", "app", "metro.config.cjs"), "utf8");
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

test("the production Inbox graph excludes screenshot and test samples", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
  // Type-only edges disappear from Metro's runtime graph. Strip them before
  // walking production edges so this test models emitted JavaScript rather
  // than the broader TypeScript type-checking graph.
  const graph = imports(tracked, (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^\s*import\s+type\b[^;]*;?\s*$/gm, ""));
  for (const entry of ["apps/app/src/shell/providers/inbox.tsx", "apps/app/src/shell/spaces/Shell.tsx"]) {
    const leaked = closure(entry, graph).filter((file) => /\/sample\.tsx?$/.test(file) || file === "generated/screens.ts");
    assert.deepEqual(leaked, [], `${entry} runtime closure must not include sample fixtures or the generated screen registry`);
  }
});

test("the optional phone bootstrap does not load the Inbox place UI", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n"));
  const graph = imports(tracked, (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/^\s*import\s+type\b[^;]*;?\s*$/gm, ""));
  const loaded = closure("apps/app/src/shell/session/phone.ts", graph);
  assert.doesNotMatch(
    loaded.join("\n"),
    /apps\/app\/src\/(?:shell\/providers\/inbox\.tsx|places\/inbox\/(?:calendar|contactlist|contacttab|sidebar)\/)/,
    "phone setup may share Inbox data/navigation, but must not pull the lazy Inbox place into the startup common chunk",
  );
});

test("the Console assistant reuses the lazy Chats place chunk", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const assistant = fs.readFileSync(path.join(root, "apps/app/src/console/Assistant.tsx"), "utf8");
  assert.doesNotMatch(assistant, /from ["']\.\.\/places\/chats\/conversation\/Conversation\.tsx["']/, "Console must not make the Chats renderer common to two place chunks");
  assert.match(assistant, /import\(["']\.\.\/shell\/providers\/chats\.tsx["']\)/, "the assistant loads the already-lazy Chats place chunk when its thread is ready");
});

test("optional Plan views share one on-demand renderer instead of the startup common chunk", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  for (const file of ["apps/app/src/places/home/sections-a/MyWork.tsx", "apps/app/src/places/records/projectpage/ProjectPage.tsx"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /import \{ Plan \} from ["'][^"']*ui\/src\/Plan\/index\.tsx["']/, `${file} must not statically share the optional Plan renderer`);
    assert.match(src, /Plan\/DeferredPlan\.tsx/, `${file} uses the shared deferred Plan boundary`);
  }
  for (const file of ["apps/app/src/places/home/sections-a/MyWork.tsx", "apps/app/src/places/home/sections-a/plan.ts"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /Plan\/logic\.ts/, `${file} may use the tiny date leaf, not the full Plan editor logic`);
    assert.match(src, /Plan\/dates\.ts/);
  }
  const deferred = fs.readFileSync(path.join(root, "ui/src/Plan/DeferredPlan.tsx"), "utf8");
  assert.match(deferred, /lazy\(\(\) => import\(["']\.\/index\.tsx["']\)/, "the full Plan remains available on demand");
});

test("the optional phone dock reuses the lazy Inbox place chunk", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const shell = fs.readFileSync(path.join(root, "apps/app/src/shell/spaces/Shell.tsx"), "utf8");
  for (const eager of ["../../places/inbox/softphone/phone.tsx", "../../places/inbox/softphone/pill.tsx", "../../places/inbox/sidebar/data.tsx"]) {
    assert.doesNotMatch(shell, new RegExp(`^import \\{[^\\n]+\\} from ["']${eager.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "m"), `Shell must not statically share ${eager} with Inbox`);
  }
  assert.match(shell, /import\(["']\.\.\/providers\/inbox\.tsx["']\)/, "the dock and title pill load from the existing Inbox place chunk only after telephony connects");
});

test("places that draw a Composer preload one shared on-demand editor before becoming usable", () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  for (const file of ["apps/app/src/places/home/sections-b/AskBox.tsx", "apps/app/src/places/chats/conversation/Conversation.tsx", "apps/app/src/places/inbox/contacttab/ContactTab.tsx"]) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /^import \{ Composer \} from ["'][^"']*ui\/src\/Composer\/index\.tsx["'];?$/m, `${file} must not promote the editor into the startup common chunk`);
    assert.match(src, /Composer\/Deferred\.tsx/, `${file} renders the shared deferred editor`);
  }
  const loader = fs.readFileSync(path.join(root, "ui/src/Composer/load.ts"), "utf8");
  assert.match(loader, /import\(["']\.\/index\.tsx["']\)/);
  const places = fs.readFileSync(path.join(root, "apps/app/src/shell/places.ts"), "utf8");
  assert.match(places, /Composer\/load\.ts/);
  assert.match(places, /withComposer/);
  for (const id of ["home", "chat", "mail", "sites"]) assert.match(places, new RegExp(`id: ["']${id}["'][^\\n]+withComposer`), `${id} waits for its real composer before PlaceHost marks it usable`);
});

test("steal only ever throws out a slow result: under budget passes whatever the steal, over budget on a busy host is measured again, then unmeasurable", async () => {
  const run = (attempts: { steal: number; ms: number }[]) => { let i = 0; const rejected: number[] = []; return { rejected, go: () => measureQuiet(async () => { const a = attempts[i++]!; return { steal: a.steal, cold: [a.ms] }; }, 1500, (r: { steal: number }) => rejected.push(r.steal)) }; };
  // 1. within budget: a pass however busy the host was (steal can only have added time); the steal is kept on the attempt for the METRIC
  const fast = await run([{ steal: 16, ms: 1000 }]).go();
  assert.equal(fast.accepted?.steal, 16);
  assert.equal(fast.attempts.length, 1);
  // 2. over budget on a busy host: measured again; a quiet re-measure decides (10% then 1%)
  const recheck = run([{ steal: 10, ms: 1600 }, { steal: 1, ms: 1400 }]);
  const b = await recheck.go();
  assert.equal(b.accepted?.steal, 1, "the quiet second measurement is the one that counts");
  assert.deepEqual(recheck.rejected, [10], "the rejected attempt is logged with its steal");
  // ... and over budget on a busy host three times: unmeasurable, which fails
  const busy = run([{ steal: 10, ms: 1600 }, { steal: 10, ms: 1600 }, { steal: 10, ms: 1600 }, { steal: 1, ms: 1000 }]);
  const c = await busy.go();
  assert.equal(c.accepted, null);
  assert.equal(c.attempts.length, STEAL_ATTEMPTS);
  assert.deepEqual(busy.rejected, [10, 10, 10]);
  // 3. over budget on a quiet host: accepted as it is, a real fail (the budget check below turns it red)
  const slow = await run([{ steal: MAX_STEAL_PCT, ms: 1600 }]).go();
  assert.equal(slow.accepted?.cold[0], 1600);
  const prev = process.exitCode;
  assert.equal(enforceStartupBudget([{ size: "phone", kind: "cold", ms: 1600, budget: 1500 }]).length, 1, "a quiet over-budget median fails");
  assert.equal(enforceStartupBudget([{ size: "phone", kind: "cold", ms: null, budget: 1500, unmeasurable: true }]).length, 1, "unmeasurable fails, never passes");
  assert.equal(process.exitCode, 1);
  process.exitCode = prev;
  assert.equal(stealPct({ steal: 10, total: 100 }, { steal: 20, total: 200 }), 10);
  assert.equal(stealPct(null, null), null);
});
