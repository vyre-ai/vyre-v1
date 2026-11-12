// @heavy docker
// The sign-ins of an old desktop must really reach the next browser. On a real Docker host: an old-style desktop is made from the agent-computer image, its Chrome makes a real profile and sets a cookie,
// a localStorage value and an IndexedDB record on a test page served inside the container (no outside site); the desktop goes to sleep (container stopped), and `chromeData` reads the named sign-in paths
// out of the STOPPED container. The tar must hold the cookie store, Login Data, Local Storage, IndexedDB, Preferences and the extension state with real sizes and none of the caches, and every path the
// module names that Chrome really wrote must be in it: the folder is listed and compared, so a wrong path name is a failed test, never a silent skip.
//
// Runs only with VYRE_HEAVY_DOCKER=1; the image is VYRE_AGENT_COMPUTER_IMAGE (default vyre/agent-computer:1, built with Vyre for Chrome baked in). Prints METRIC lines.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDockerApi, unixSocketHttp } from "../../../sandbox/src/docker.ts";
import { untar } from "../../../sandbox/src/tar.ts";
import { CHROME_DATA, CHROME_ESSENTIAL, createDockerComputerHost } from "../impl.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the 20 s shard never starts containers)";
const IMAGE = process.env["VYRE_AGENT_COMPUTER_IMAGE"] ?? "vyre/agent-computer:1";
const suffix = `${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const PREFIX = `vyre-comp-hv${suffix}-`;
const COMPUTER = `cmt_cc${suffix}`;
const NAME = `${PREFIX}${COMPUTER.replace(/^cmt_/, "")}`;
const http = unixSocketHttp();
const api = createDockerApi(http);
const filesRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-copy-")));
const host = createDockerComputerHost({ api, http, image: IMAGE, prefix: PREFIX, filesRoot: () => filesRoot, startTimeoutMs: 120_000 });
const sleepMs = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const sh = (cmd: string) => api.exec(NAME, { cmd: ["sh", "-c", cmd], env: [], user: "10001:10001" });

const PAGE = "http://127.0.0.1:8765/";
const SERVER = `require('node:' + 'http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<!doctype html><title>t</title><p>test page</p>')}).listen(8765,'127.0.0.1')`;

test("@heavy the sign-in paths of a real Chrome profile are read from a stopped agent computer, caches left out", { skip, timeout: 600_000 }, async () => {
  fs.chmodSync(filesRoot, 0o777);
  try {
    await host.create({ computerId: COMPUTER, agentId: "agt_hv", tabLimit: 4, idleSleepMinutes: 10 });
    await host.start({ computerId: COMPUTER, tabLimit: 4, agentId: "agt_hv" });
    await sh(`nohup node -e "${SERVER.replace(/"/g, '\\"')}" >/dev/null 2>&1 &`);
    await sleepMs(1500);
    const t = (tool: string, args: Record<string, unknown>) => host.tool!({ computerId: COMPUTER, tool, args, timeoutMs: 60_000 });
    await t("chrome_open", { url: PAGE });
    await t("chrome_eval", { expression: `document.cookie = "vyre_cookie=cookie-value-123; max-age=31536000; path=/"; localStorage.setItem("vyre_ls", "ls-value-456"); "set"` });
    const idb = await t("chrome_eval", { expression: `new Promise((res, rej) => { const o = indexedDB.open("vyre_db", 1); o.onupgradeneeded = () => o.result.createObjectStore("s"); o.onsuccess = () => { const tx = o.result.transaction("s", "readwrite"); tx.objectStore("s").put("idb-value-789", "k"); tx.oncomplete = () => res("idb"); }; o.onerror = () => rej(String(o.error)); })` });
    assert.equal((idb as { result?: unknown }).result, "idb");
    // an idle desktop sleeps after ten quiet minutes: Chrome has flushed its cookie store long before. Give it its flush interval.
    await sleepMs(40_000);
    const listing = (await sh(`cd ${CHROME_DATA} && find . -maxdepth 3 -not -path './Default/Cache/*' | sort`)).stdout.split("\n").filter(Boolean);
    console.log(`PROFILE ${listing.length} entries (depth 3): ${listing.slice(0, 80).join(" | ")}`);
    await host.stop({ computerId: COMPUTER, reason: "idle", agentId: "agt_hv" });
    const got = await host.chromeData!(COMPUTER);
    assert.ok(got, "chromeData found Chrome's folder");
    const files = untar(got.tar).filter((e) => e.type === "file");
    const bySize = new Map(files.map((e) => [e.path, e.data.length] as const));
    console.log(`METRIC chrome-copy tar bytes=${got.tar.length} files=${files.length}`);
    console.log(`COPIED ${files.map((e) => `${e.path}(${e.data.length})`).join(" | ")}`);
    const size = (prefix: string): number => files.filter((e) => e.path.startsWith(prefix)).reduce((n, e) => n + e.data.length, 0);
    // the cookie store: Chrome has moved it under Network/ in recent versions; either place, with real bytes
    assert.ok(size("chrome/Default/Network/Cookies") > 0 || size("chrome/Default/Cookies") > 0, "the cookie store was copied and is not empty");
    assert.ok(size("chrome/Default/Login Data") > 0, "Login Data was copied");
    assert.ok(size("chrome/Default/Local Storage/") > 0, "Local Storage was copied");
    assert.ok(size("chrome/Default/IndexedDB/") > 0, "IndexedDB was copied");
    assert.ok(size("chrome/Default/Preferences") > 0, "Preferences was copied");
    assert.ok(size("chrome/Local State") > 0, "Local State was copied");
    assert.ok(size("chrome/Default/Extension State/") > 0 || size("chrome/Default/Local Extension Settings/") > 0, "the extension state was copied");
    assert.ok(![...bySize.keys()].some((p) => /\/(Cache|Code Cache|GPUCache|GrShaderCache|ShaderCache|Service Worker|DawnCache)(\/|$)/.test(p)), "no cache folder came along");
    // every path the module names that Chrome wrote must have been read: a wrong path name is a failed test
    const written = new Set(listing.map((l) => l.replace(/^\.\//, "")));
    for (const rel of CHROME_ESSENTIAL) {
      if (!written.has(rel) && !listing.some((l) => l.startsWith(`./${rel}/`))) continue;   // Chrome did not write this one for this test page
      assert.ok(files.some((e) => e.path === `chrome/${rel}` || e.path.startsWith(`chrome/${rel}/`)), `Chrome wrote ${rel} and it was not copied`);
    }
  } finally {
    await host.remove(COMPUTER).catch(() => undefined);
    fs.rmSync(filesRoot, { recursive: true, force: true });
  }
});

// ---- the sleep path must not lose what was just signed in (the move is lossless only if sleeping a desktop is)

import { DatabaseSync } from "node:sqlite";
import { bindHost } from "../projections.ts";
import { provision, remove, sleep, wake } from "../handlers/lifecycle.ts";
import { harness, INTAKE } from "../fixtures/harness.ts";

test("@heavy sleeping the desktop through the product's own sleep, seconds after a sign-in, keeps the cookie and the localStorage value in the stored files", { skip, timeout: 600_000 }, async () => {
  const root2 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-copy2-")));
  fs.chmodSync(root2, 0o777);
  const host = createDockerComputerHost({ api, http, image: IMAGE, prefix: PREFIX, filesRoot: () => root2, startTimeoutMs: 120_000 });
  const h = harness();
  bindHost(host);
  let computerId = "";
  try {
    computerId = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k-cc2" })).computer.computerId;
    await wake(h.ctx, { computerId });
    const name = `${PREFIX}${computerId.replace(/^cmt_/, "")}`;
    await api.exec(name, { cmd: ["sh", "-c", `nohup node -e "${SERVER.replace(/"/g, '\\"')}" >/dev/null 2>&1 &`], env: [], user: "10001:10001" });
    await sleepMs(1500);
    const t = (tool: string, args: Record<string, unknown>) => host.tool!({ computerId, tool, args, timeoutMs: 60_000 });
    await t("chrome_open", { url: PAGE });
    await t("chrome_eval", { expression: `document.cookie = "vyre_cookie2=fresh-cookie; max-age=31536000; path=/"; localStorage.setItem("vyre_ls2", "fresh-ls-value"); "set"` });
    const t0 = Date.now();
    await sleep(h.ctx, { computerId });   // the product's own sleep, no waiting for a flush
    console.log(`METRIC sleep right after sign-in took ${Date.now() - t0} ms`);
    const got = await host.chromeData!(computerId);
    assert.ok(got, "Chrome's folder was found");
    const files = untar(got.tar).filter((e) => e.type === "file");
    const cookies = files.find((e) => e.path === "chrome/Default/Cookies" || e.path === "chrome/Default/Network/Cookies");
    assert.ok(cookies, "the cookie store was copied");
    const dbFile = path.join(root2, "cookies-check.sqlite");
    fs.writeFileSync(dbFile, cookies.data);
    const journal = files.find((e) => e.path === `${cookies.path}-journal`);
    if (journal && journal.data.length > 0) fs.writeFileSync(`${dbFile}-journal`, journal.data);
    const db = new DatabaseSync(dbFile, { readOnly: false });
    const names = (db.prepare("SELECT name FROM cookies").all() as Array<{ name: string }>).map((r) => r.name);
    db.close();
    console.log(`COOKIES after sleep: ${names.join(",")}`);
    assert.ok(names.includes("vyre_cookie2"), `the cookie set seconds before sleeping is in the stored cookie store (rows: ${names.join(",")})`);
    const ls = files.filter((e) => e.path.startsWith("chrome/Default/Local Storage/")).map((e) => Buffer.from(e.data).toString("latin1")).join("\n");
    assert.ok(ls.includes("fresh-ls-value"), "the localStorage value set seconds before sleeping is in the leveldb files");
  } finally {
    if (computerId) await remove(h.ctx, { computerId }).catch(() => undefined);
    bindHost(null);
    fs.rmSync(root2, { recursive: true, force: true });
  }
});

// ---- the whole move, with both real images: what was signed in on the old desktop is signed in in the agent's Space browser profile

import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createDockerSpaceBrowser } from "../sbrowser/docker.ts";
import { bindSpaceBrowser } from "../sbrowser/port.ts";
import { bindMigrationPort, migrateComputers, migrationRows } from "../migrate.ts";

test("@heavy the whole move: a cookie, a localStorage value and an IndexedDB record set on the old desktop, slept through the product's own sleep, are read back by the page in the agent's Space browser profile", { skip, timeout: 900_000 }, async () => {
  const SB_IMAGE = process.env["VYRE_SPACE_BROWSER_IMAGE"] ?? "vyre/space-browser:heavy";
  const SB_NAME = `vyre-sbrowser-hv${suffix}`;
  let gateway = "172.17.0.1";
  try { gateway = execFileSync("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"], { encoding: "utf8" }).trim().split("\n")[0]! || gateway; } catch { /* the usual bridge address */ }
  const site = createServer((_q, r) => { r.setHeader("content-type", "text/html"); r.end("<!doctype html><title>t</title><p>test page</p>"); });
  const port = await new Promise<number>((res) => site.listen(0, "0.0.0.0", () => res((site.address() as { port: number }).port)));
  const url = `http://${gateway}:${port}/`;
  const root3 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-chrome-move-")));
  fs.chmodSync(root3, 0o777);
  const desk = createDockerComputerHost({ api, http, image: IMAGE, prefix: PREFIX, filesRoot: () => root3, startTimeoutMs: 120_000 });
  const sb = createDockerSpaceBrowser({ api, http, name: SB_NAME, image: SB_IMAGE, user: { uid: 10001, gid: 10001 }, startTimeoutMs: 120_000 });
  const h = harness();
  bindHost(desk);
  bindSpaceBrowser(sb);
  bindMigrationPort("ensureWorkspace", async (_c, a) => ({ workspaceId: `wks_${a.agentId}` }));
  let computerId = "";
  try {
    computerId = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k-cc3" })).computer.computerId;
    await wake(h.ctx, { computerId });
    const t = (tool: string, args: Record<string, unknown>) => desk.tool!({ computerId, tool, args, timeoutMs: 60_000 });
    await t("chrome_open", { url });
    await t("chrome_eval", { expression: `document.cookie = "vyre_move=cookie-ok; max-age=31536000; path=/"; localStorage.setItem("vyre_ls", "ls-ok"); "set"` });
    const idb = await t("chrome_eval", { expression: `new Promise((res, rej) => { const o = indexedDB.open("vyre_db", 1); o.onupgradeneeded = () => o.result.createObjectStore("s"); o.onsuccess = () => { const tx = o.result.transaction("s", "readwrite"); tx.objectStore("s").put("idb-ok", "k"); tx.oncomplete = () => res("idb"); }; o.onerror = () => rej(String(o.error)); })` });
    assert.equal((idb as { result?: unknown }).result, "idb");
    await sleep(h.ctx, { computerId });   // the product's own sleep, seconds after the sign-in
    assert.equal(await sb.profileUsed(INTAKE), false, "the agent's Space browser profile has never been used");
    const r = await migrateComputers(h.ctx);
    console.log(`MOVE ${JSON.stringify(r)} ${JSON.stringify(migrationRows(h.ctx))}`);
    assert.equal(migrationRows(h.ctx)[0]?.state, "done", `the move is done: ${JSON.stringify(migrationRows(h.ctx))}`);
    // the page, in the agent's Space browser profile, reads back everything
    const b = (tool: string, args: Record<string, unknown>) => sb.tool({ profileId: INTAKE, tool, args, timeoutMs: 60_000 });
    await b("chrome_open", { url });
    const seen = {
      cookie: String((await b("chrome_eval", { expression: "document.cookie" }))["result"]),
      ls: String((await b("chrome_eval", { expression: "localStorage.getItem('vyre_ls')" }))["result"]),
      idb: String((await b("chrome_eval", { expression: `new Promise((res) => { const o = indexedDB.open("vyre_db"); o.onsuccess = () => { const g = o.result.transaction("s").objectStore("s").get("k"); g.onsuccess = () => res(String(g.result)); g.onerror = () => res("error"); }; o.onerror = () => res("open error"); })` }))["result"]),
    };
    console.log(`STAGE B page in the Space browser saw: ${JSON.stringify(seen)}`);
    assert.match(seen.cookie, /vyre_move=cookie-ok/, `the cookie survived the move (the page saw: ${JSON.stringify(seen)})`);
    assert.equal(seen.ls, "ls-ok", "the localStorage value survived");
    assert.equal(seen.idb, "idb-ok", "the IndexedDB record survived");
  } finally {
    await sb.forget(INTAKE).catch(() => undefined);
    await api.containerStop(SB_NAME, 5).catch(() => undefined);
    await api.containerRemove(SB_NAME).catch(() => undefined);
    await http({ method: "DELETE", path: `/volumes/${SB_NAME}-data`, query: { force: "true" } }).catch(() => undefined);
    if (computerId) await remove(h.ctx, { computerId }).catch(() => undefined);
    bindHost(null); bindSpaceBrowser(null); bindMigrationPort("ensureWorkspace", null);
    site.close();
    fs.rmSync(root3, { recursive: true, force: true });
  }
});
