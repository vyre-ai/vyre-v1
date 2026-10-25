// Extension core (V1-SPEC 3.12, ARCH 7.12): host matching, the wire to the app, the guarded storage, the popup's rules, the manifest's
// promises (no passkey interception, no network of its own, one native host) and the native messaging host against a fake daemon.
// The end-to-end fill and save flows are in ext-core.fill.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { badgeText, fillablePage, hostUnder, loginRow, pageOf, ruleFor } from "../src/worker/match.js";
import { BridgeFailure, BRIDGE_OPS, CAPABILITIES, HOST_NAME, parseIncoming, request, wordsFor } from "../src/worker/protocol.js";
import { createStore, KEYS, StoreRefusal } from "../src/worker/store.js";
import { createBridge } from "../src/worker/bridge.js";
import { createDecoder, encode, MAX_MESSAGE } from "../src/worker/framing.js";
import { keyAction, letterOf, MENU_KEY, move, rowMenu, viewOf } from "../src/popup/popup-model.js";
import { callerOk, dataDirs, findDaemon, runHost } from "../src/worker/native/host.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(ROOT, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const sources = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(js|html|css|json)$/.test(e.name)).map((e) => path.join(dir, path.relative(path.join(ROOT, dir), path.join(e.parentPath, e.name))));

// ---------- host matching ----------

test("a page address becomes an origin and a host; only web pages count", () => {
  assert.deepEqual(pageOf("https://Login.Acme.test/signin?next=/a#x"), { origin: "https://login.acme.test", host: "login.acme.test", secure: true, local: false });
  assert.deepEqual(pageOf("http://localhost:3000/x"), { origin: "http://localhost:3000", host: "localhost", secure: false, local: true });
  assert.equal(pageOf("chrome://extensions"), null);
  assert.equal(pageOf("file:///etc/passwd"), null);
  assert.equal(pageOf("javascript:alert(1)"), null);
  assert.equal(pageOf(""), null);
  assert.equal(pageOf(undefined), null);
  assert.deepEqual(pageOf("https://acme.test./"), pageOf("https://acme.test/"), "a trailing dot is the same host");
});

test("only the origin is ever sent: no path, query, fragment or credentials", () => {
  const p = pageOf("https://user:pw@acme.test:8443/a/b?token=SECRET#frag")!;
  assert.equal(p.origin, "https://acme.test:8443");
  assert.ok(!p.origin.includes("SECRET") && !p.origin.includes("pw") && !p.origin.includes("/a/b"));
});

test("http is refused except on this computer", () => {
  assert.equal(fillablePage(pageOf("https://acme.test")), true);
  assert.equal(fillablePage(pageOf("http://acme.test")), false);
  assert.equal(fillablePage(pageOf("http://localhost:8080")), true);
  assert.equal(fillablePage(pageOf("http://127.0.0.1:8080")), true);
  assert.equal(fillablePage(null), false);
});

test("a parent domain covers its subdomains, and look-alikes do not match", () => {
  assert.equal(hostUnder("login.acme.test", "acme.test"), true);
  assert.equal(hostUnder("acme.test", "acme.test"), true);
  assert.equal(hostUnder("a.b.acme.test", "acme.test"), true);
  assert.equal(hostUnder("evilacme.test", "acme.test"), false);
  assert.equal(hostUnder("acme.test.evil.net", "acme.test"), false);
  assert.equal(hostUnder("acme.test", "login.acme.test"), false, "a child does not cover its parent");
  assert.equal(hostUnder("bank.co.uk", "co.uk"), false);
  assert.equal(hostUnder("evil.com", "com"), false);
  assert.equal(hostUnder("10.0.0.5", "0.0.5"), false);
  assert.equal(hostUnder("localhost", "localhost"), true);
  assert.equal(hostUnder("a.localhost", "localhost"), false);
  assert.equal(hostUnder("ACME.test", "acme.TEST"), true);
});

test("the most specific site rule wins", () => {
  const rules = [
    { host: "acme.test", neverFill: true, neverSave: false },
    { host: "pay.acme.test", neverFill: false, neverSave: true },
  ];
  assert.deepEqual(ruleFor("pay.acme.test", rules), rules[1]);
  assert.deepEqual(ruleFor("login.acme.test", rules), rules[0]);
  assert.equal(ruleFor("other.test", rules), null);
});

test("the badge says nothing for none and 9+ past nine", () => {
  assert.deepEqual([0, 1, 9, 10, 40].map(badgeText), ["", "1", "9", "9+", "9+"]);
});

test("a login row has the item's name and no username or value", () => {
  const row = loginRow({ item: { id: "vit_1", name: "Acme", kind: "login", handle: "#Acme", fieldKeys: ["username", "password"], owner: "usr_1" }, usernameField: "username" });
  assert.deepEqual(Object.keys(row).sort(), ["fieldKeys", "handle", "hasUsername", "id", "kind", "name", "usernameField"]);
  assert.equal(row.name, "Acme");
});

// ---------- the wire ----------

test("the extension may call only the listed capabilities and bridge operations", () => {
  assert.deepEqual(request("r1", "invoke", "vault.fill", { handle: "#A.password" }), { id: "r1", type: "invoke", capability: "vault.fill", input: { handle: "#A.password" } });
  assert.deepEqual(request("r2", "bridge", "hello"), { id: "r2", type: "bridge", op: "hello", input: {} });
  for (const bad of ["vault.item.reveal", "vault.export", "files.read", "agents.delete"]) {
    assert.throws(() => request("r", "invoke", bad), (e: unknown) => e instanceof BridgeFailure && e.code === "not_allowed", bad);
  }
  assert.throws(() => request("r", "bridge", "shell.exec"), BridgeFailure);
  assert.ok(!("vault.item.reveal" in CAPABILITIES), "an extension can never ask to see a value");
  assert.ok(Object.keys(CAPABILITIES).every((c) => c.startsWith("vault.")));
  assert.ok(Object.keys(BRIDGE_OPS).length >= 6);
});

test("every capability the extension names exists in the frozen contract", () => {
  const manifest = fs.readFileSync(path.join(REPO, "manifests/vault.ts"), "utf8");
  for (const c of Object.keys(CAPABILITIES)) assert.ok(manifest.includes(`'${c}'`), `${c} is in manifests/vault.ts`);
});

test("incoming messages are checked before anyone acts on them", () => {
  assert.deepEqual(parseIncoming({ id: "r1", ok: true, output: { a: 1 } }), { id: "r1", ok: true, output: { a: 1 } });
  assert.deepEqual(parseIncoming({ id: "r1", ok: false, error: { code: "locked", message: "m" } }), { id: "r1", ok: false, error: { code: "locked", message: "m" } });
  assert.deepEqual(parseIncoming({ type: "fill", ref: "w1-aa", value: "v" }), { type: "fill", ref: "w1-aa", value: "v" });
  for (const junk of [null, 5, "x", [], {}, { type: "fill", ref: 1, value: "v" }, { type: "fill", ref: "r" }, { type: "eval", code: "1" }, { id: 4, ok: true }]) assert.equal(parseIncoming(junk), null);
});

test("failures become plain words", () => {
  assert.match(wordsFor(new BridgeFailure("no_host", "x")), /not installed/);
  assert.match(wordsFor({ code: "locked" }), /locked/);
  assert.equal(wordsFor({ code: "weird", message: "A specific thing" }), "A specific thing");
  assert.equal(wordsFor(new Error("")), "Something went wrong. Try again.");
});

function fakePort() {
  const messages: ((m: unknown) => void)[] = [];
  const closes: (() => void)[] = [];
  const sent: any[] = [];
  return {
    sent,
    port: { postMessage: (m: unknown) => { sent.push(m); }, disconnect: () => {}, onMessage: { addListener: (f: (m: unknown) => void) => messages.push(f) }, onDisconnect: { addListener: (f: () => void) => closes.push(f) } },
    reply: (m: unknown) => { for (const f of messages) f(m); },
    drop: () => { for (const f of closes) f(); },
  };
}

test("the bridge matches replies to requests by id and times out silently dead ones", async () => {
  const p = fakePort();
  let timer: (() => void) | null = null;
  const ext = { runtime: { connectNative: (name: string) => { assert.equal(name, HOST_NAME); return p.port; }, lastError: undefined as { message?: string } | undefined } };
  const b = createBridge(ext, { setTimer: (f) => { timer = f; return 1; }, clearTimer: () => {} });
  const a = b.invoke("vault.items.match", { url: "https://acme.test" });
  const c = b.op("hello");
  assert.deepEqual(p.sent.map((m) => m.id), ["r1", "r2"]);
  p.reply({ id: "r2", ok: true, output: { v: 2 } });
  p.reply({ id: "r1", ok: true, output: { v: 1 } });
  assert.deepEqual(await a, { v: 1 });
  assert.deepEqual(await c, { v: 2 });
  assert.equal(b.status, "online");
  const d = b.invoke("vault.site_rules.list");
  timer!();
  await assert.rejects(d, (e: unknown) => e instanceof BridgeFailure && e.code === "timeout");
});

test("the bridge rejects what it may not send, and passes pushes to handlers", async () => {
  const p = fakePort();
  const b = createBridge({ runtime: { connectNative: () => p.port } });
  await assert.rejects(async () => b.invoke("vault.item.reveal", {}), (e: unknown) => e instanceof BridgeFailure && e.code === "not_allowed");
  assert.equal(p.sent.length, 0);
  const got: unknown[] = [];
  b.onPush((m) => got.push(m));
  const hello = b.op("hello");
  p.reply({ type: "fill", ref: "w1-x", value: "v" });
  p.reply({ type: "bogus" });
  assert.deepEqual(got, [{ type: "fill", ref: "w1-x", value: "v" }]);
  p.reply({ id: p.sent[0].id, ok: true, output: {} });
  await hello;
});

test("a missing host and a closed app are told apart, and pending calls fail at once", async () => {
  const p = fakePort();
  const ext = { runtime: { connectNative: () => p.port, lastError: undefined as { message?: string } | undefined } };
  const b = createBridge(ext);
  const seen: string[] = [];
  b.onStatus((s) => seen.push(s));
  const pending = b.op("hello");
  ext.runtime.lastError = { message: "Specified native messaging host not found." };
  p.drop();
  await assert.rejects(pending, (e: unknown) => e instanceof BridgeFailure && e.code === "no_host");
  assert.equal(b.status, "no_host");

  const q = fakePort();
  const ext2 = { runtime: { connectNative: () => q.port, lastError: undefined as { message?: string } | undefined } };
  const b2 = createBridge(ext2);
  const pending2 = b2.op("hello");
  q.drop();
  await assert.rejects(pending2, (e: unknown) => e instanceof BridgeFailure && e.code === "offline");
  assert.equal(b2.status, "offline");

  const b3 = createBridge({ runtime: { connectNative: () => { throw new Error("nope"); } } });
  await assert.rejects(async () => b3.op("hello"), (e: unknown) => e instanceof BridgeFailure && e.code === "no_host");
  assert.ok(seen.includes("connecting") && seen.includes("no_host"));
});

// ---------- storage ----------

function memoryArea() {
  const data: Record<string, unknown> = {};
  return { data, area: { async get(keys: string[]) { return Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])); }, async set(i: Record<string, unknown>) { Object.assign(data, i); }, async remove(keys: string[]) { for (const k of keys) delete data[k]; } } };
}

test("the store keeps only what the extension is allowed to keep, in the shape it expects", async () => {
  const m = memoryArea();
  const s = createStore(m.area);
  await s.set({ activeSpace: "spc_a", spaces: [{ id: "spc_a", name: "Acme", webUrl: "https://acme.vyre.run" }], siteRules: [{ host: "a.test", neverFill: true, neverSave: false }], suggestOnPages: true, offerToSave: false });
  assert.deepEqual(Object.keys(m.data).sort(), [...KEYS].sort());
  assert.equal((await s.get(["activeSpace"]))["activeSpace"], "spc_a");
});

test("the store refuses any key it does not know, a wrong shape, and anything named like a secret", async () => {
  const s = createStore(memoryArea().area);
  await assert.rejects(s.set({ password: "x" }), StoreRefusal);
  await assert.rejects(s.set({ lastFill: { value: "x" } }), StoreRefusal);
  await assert.rejects(s.set({ spaces: "nope" }), /wrong shape/);
  await assert.rejects(s.set({ spaces: [{ id: "a", name: "n", webUrl: "u", token: "t" }] }), /wrong shape/);
  await assert.rejects(s.set({ siteRules: [{ host: "a", neverFill: "yes", neverSave: false }] }), /wrong shape/);
  await assert.rejects(s.get(["session"]), StoreRefusal);
  assert.deepEqual(await s.get(["activeSpace"]), {});
});

test("a stored value that no longer fits its shape reads as absent", async () => {
  const m = memoryArea();
  m.data["activeSpace"] = { evil: true };
  assert.deepEqual(await createStore(m.area).get(["activeSpace"]), {});
});

test("clear forgets everything", async () => {
  const m = memoryArea();
  const s = createStore(m.area);
  await s.set({ activeSpace: "x" });
  await s.clear();
  assert.deepEqual(m.data, {});
});

// ---------- framing and the native host ----------

test("native messaging frames round-trip, split across chunks and joined in one", () => {
  const a = encode({ id: "r1", n: 1 });
  const b = encode({ id: "r2", text: "café ✓" });
  const d = createDecoder();
  assert.deepEqual(d.push(a.subarray(0, 3)), []);
  assert.deepEqual(d.push(Buffer.concat([a.subarray(3), b.subarray(0, 9)])), [{ id: "r1", n: 1 }]);
  assert.deepEqual(d.push(b.subarray(9)), [{ id: "r2", text: "café ✓" }]);
  assert.equal(d.buffered, 0);
  assert.deepEqual(createDecoder().push(Buffer.concat([a, b])).length, 2);
});

test("frames over the limit or that are not JSON throw", () => {
  const head = Buffer.alloc(4);
  head.writeUInt32LE(MAX_MESSAGE + 1, 0);
  assert.throws(() => createDecoder().push(head), RangeError);
  assert.throws(() => encode({ big: "x".repeat(MAX_MESSAGE) }), RangeError);
  const bad = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from("{{{")]);
  assert.throws(() => createDecoder().push(bad), SyntaxError);
});

test("the host only accepts a browser extension as its caller", () => {
  assert.equal(callerOk(["node", "host.js", "chrome-extension://abcdefghijklmnop/"]), true);
  assert.equal(callerOk(["node", "host.js", "moz-extension://abc-def/"]), true);
  assert.equal(callerOk(["node", "host.js"]), true);
  assert.equal(callerOk(["node", "host.js", "https://evil.example/"]), false);
  assert.equal(callerOk(["node", "host.js", "file:///x"]), false);
});

test("the host finds a running daemon on loopback and ignores a stopped or remote one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-host-"));
  try {
    fs.writeFileSync(path.join(dir, "vyred.json"), JSON.stringify({ pid: 4242, url: "http://127.0.0.1:5555" }));
    fs.writeFileSync(path.join(dir, "admin.token"), "tok-1234\n");
    assert.deepEqual(findDaemon([dir], () => true), { url: "http://127.0.0.1:5555", token: "tok-1234" });
    assert.equal(findDaemon([dir], () => false), null, "a stale file from a daemon that exited");
    fs.writeFileSync(path.join(dir, "vyred.json"), JSON.stringify({ pid: 1, url: "http://10.0.0.9:5555" }));
    assert.equal(findDaemon([dir], () => true), null, "never a non-loopback address");
    assert.equal(findDaemon([path.join(dir, "missing")], () => true), null);
    assert.ok(dataDirs({ VYRE_DATA_DIR: "/custom" })[0] === "/custom");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the host relays a request to the daemon and its reply and pushes back to Chrome", async () => {
  const seen: { path: string; auth: string; body: unknown }[] = [];
  const pushes: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/chrome-bridge/v1/events") {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      pushes.push(res);
      res.write(`${JSON.stringify({ type: "spaces", spaces: [], active: null })}\n`);
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      seen.push({ path: String(req.url), auth: String(req.headers.authorization), body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: body.id, ok: true, output: { echoed: body.op } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  const stdin = new PassThrough();
  const out: Buffer[] = [];
  const stdout = { write: (b: Buffer) => { out.push(b); return true; } };
  const done = runHost({ stdin, stdout, daemon: { url: `http://127.0.0.1:${port}`, token: "tok" } });
  stdin.write(encode({ id: "r1", type: "bridge", op: "hello", input: {} }));
  for (let i = 0; i < 100 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  stdin.end();
  await done;
  for (const r of pushes) r.end();
  await new Promise<void>((r) => server.close(() => r()));
  const frames = createDecoder().push(Buffer.concat(out));
  assert.ok(frames.some((f: any) => f.type === "spaces"), "the daemon's push reached Chrome");
  assert.ok(frames.some((f: any) => f.id === "r1" && f.ok && f.output.echoed === "hello"), "the reply reached Chrome");
  assert.equal(seen[0]?.path, "/chrome-bridge/v1/rpc");
  assert.equal(seen[0]?.auth, "Bearer tok");
});

test("with no daemon the host answers every request with an offline error", async () => {
  const stdin = new PassThrough();
  const out: Buffer[] = [];
  const done = runHost({ stdin, stdout: { write: (b: Buffer) => { out.push(b); return true; } }, daemon: null });
  stdin.write(encode({ id: "r9", type: "bridge", op: "hello", input: {} }));
  stdin.end();
  await done;
  const [f] = createDecoder().push(Buffer.concat(out)) as any[];
  assert.deepEqual([f.id, f.ok, f.error.code], ["r9", false, "offline"]);
});

// ---------- the popup's rules ----------

const base = { page: { host: "login.acme.test", origin: "https://login.acme.test", secure: true }, spaces: [{ id: "a", name: "Acme Law", webUrl: "https://acme.vyre.run" }, { id: "p", name: "Personal", webUrl: "http://localhost:8420" }], active: "a", status: "online", rows: [{ id: "v1", name: "Acme Portal", kind: "login", fieldKeys: ["username", "password", "totp"], hasUsername: true }, { id: "v2", name: "Acme Authenticator", kind: "totp", fieldKeys: ["totp"], hasUsername: false }], blocked: null, error: null };

test("the popup lists logins by item name under the Space and the site", () => {
  const v = viewOf(base);
  assert.equal(v.spaceName, "Acme Law");
  assert.equal(v.site, "login.acme.test");
  assert.deepEqual(v.rows.map((r) => [r.name, r.letter, r.trail]), [["Acme Portal", "A", ""], ["Acme Authenticator", "A", "Code"]]);
  assert.equal(v.note, null);
  assert.equal(v.canAsk, true);
});

test("each state has its own words and way forward", () => {
  assert.match(viewOf({ ...base, rows: [] }).note!.text, /No saved login/);
  assert.equal(viewOf({ ...base, blocked: "never_fill", rows: [] }).note!.action!.id, "fillOn");
  assert.match(viewOf({ ...base, page: null, rows: [] }).note!.text, /not a web page/);
  assert.match(viewOf({ ...base, page: { ...base.page, secure: false } }).note!.text, /not secure/);
  const none = viewOf({ ...base, status: "no_host", error: { code: "no_host", message: "Vyre is not installed on this computer." }, rows: [] });
  assert.equal(none.note!.action!.id, "openWeb");
  assert.equal(none.canAsk, false);
  const noWeb = viewOf({ ...base, spaces: [{ id: "a", name: "Acme Law", webUrl: "" }], status: "offline", error: { code: "offline", message: "The Vyre app is not running. Open it and try again." }, rows: [] });
  assert.equal(noWeb.note!.action, undefined, "no web address known, so no link to offer");
  assert.equal(viewOf({ ...base, error: { code: "locked", message: "Your vault is locked." }, rows: [] }).note!.text, "Your vault is locked.");
});

test("the right-click menu has Fill, Fill and Sign In, Open in Vault and Never Fill on This Site", () => {
  const labels = rowMenu({ kind: "login" }, { fieldKeys: ["username", "password"] }).map((m) => ("sep" in m ? "-" : m.label));
  assert.deepEqual(labels, ["Fill", "Fill and Sign In", "Open in Vault", "-", "Never Fill on This Site"]);
  const withCode = rowMenu({ kind: "login" }, { fieldKeys: ["password", "totp"] }).map((m) => ("sep" in m ? "-" : m.label));
  assert.ok(withCode.includes("Fill Code"));
  assert.deepEqual(rowMenu({ kind: "totp" }, null).map((m) => ("sep" in m ? "-" : m.label)), ["Fill Code", "Open in Vault", "-", "Never Fill on This Site"]);
});

test("keys: arrows wrap, Enter fills, Cmd-Enter signs in, slash asks, Escape closes", () => {
  assert.equal(move(-1, "ArrowDown", 3), 0);
  assert.equal(move(2, "ArrowDown", 3), 0);
  assert.equal(move(0, "ArrowUp", 3), 2);
  assert.equal(move(-1, "ArrowUp", 3), 2);
  assert.equal(move(1, "Home", 3), 0);
  assert.equal(move(1, "End", 3), 2);
  assert.equal(move(0, "ArrowDown", 0), -1);
  const out = { inInput: false, menuOpen: false };
  assert.equal(keyAction({ key: "Enter" }, out), "fill");
  assert.equal(keyAction({ key: "Enter", meta: true }, out), "fillSignIn");
  assert.equal(keyAction({ key: "/" }, out), "focusAsk");
  assert.equal(keyAction({ key: MENU_KEY }, out), "menu");
  assert.equal(MENU_KEY, "ContextMenu");
  assert.equal(keyAction({ key: "F10", shift: true }, out), "menu");
  assert.equal(keyAction({ key: "Escape" }, out), "close");
  assert.equal(keyAction({ key: "Escape" }, { inInput: false, menuOpen: true }), "none", "Escape closes the menu first");
  assert.equal(keyAction({ key: "/" }, { inInput: true, menuOpen: false }), "none", "typing a slash in Ask is just a slash");
  assert.equal(letterOf("  → acme"), "A");
  assert.equal(letterOf(""), "V");
});

// ---------- what the manifest and the sources promise ----------

test("the manifest asks for the smallest set of powers and one content script group", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ["activeTab", "nativeMessaging", "scripting", "storage"]);
  assert.ok(!m.permissions.includes("debugger"), "agent control arrives with P-L10_06, not here");
  assert.ok(!m.permissions.includes("webRequest") && !m.permissions.includes("cookies") && !m.permissions.includes("tabs"));
  assert.deepEqual(m.host_permissions, ["https://*/*", "http://localhost/*", "http://127.0.0.1/*"]);
  assert.equal(m.background.service_worker, "src/worker/index.js");
  assert.equal(m.background.type, "module");
  assert.equal(m.action.default_popup, "src/popup/popup.html");
  assert.deepEqual(m.content_scripts[0].js, ["src/content/finder.js", "src/content/autofill.js", "src/content/capture.js", "src/content/prompt.js"]);
  assert.equal(m.commands._execute_action.suggested_key.mac, "Command+Shift+L");
  const csp: string = m.content_security_policy.extension_pages;
  assert.ok(!/connect-src/.test(csp) && /default-src 'none'/.test(csp) && /script-src 'self'/.test(csp), "extension pages can reach no network");
  assert.ok(!/unsafe-eval|unsafe-inline/.test(csp));
  for (const f of [...m.content_scripts[0].js, m.background.service_worker, m.action.default_popup, ...Object.values(m.icons) as string[]]) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  assert.equal(HOST_NAME, "run.vyre.bridge");
  assert.equal(JSON.parse(read("src/worker/native/run.vyre.bridge.json")).name, HOST_NAME);
});

test("no passkey interception and no network of its own anywhere in the extension", () => {
  const code = [...sources("src")].filter((f) => f.endsWith(".js") && !f.includes("native/")).map((f) => [f, read(f)] as const);
  assert.ok(code.length >= 14);
  for (const [f, src] of code) {
    const bare = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/navigator\.credentials|PublicKeyCredential|webauthn\.|\.get\(\s*\{\s*publicKey/i.test(bare), `${f} touches WebAuthn`);
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|new WebSocket|sendBeacon|EventSource/.test(bare), `${f} opens a connection of its own`);
    assert.ok(!/\beval\s*\(|new Function\(|innerHTML\s*=|document\.write/.test(bare), `${f} runs or injects text as code`);
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(bare), `${f} keeps data outside the guarded store`);
    assert.ok(!/console\.(log|info|debug|warn|error)/.test(bare), `${f} logs`);
  }
});

test("only the guarded store writes to chrome.storage", () => {
  for (const f of sources("src").filter((x) => x.endsWith(".js"))) {
    const bare = read(f).replace(/\/\/.*$/gm, "");
    if (f.endsWith("store.js")) continue;
    assert.ok(!/storage\.(local|session|sync)\.(set|get|remove)/.test(bare), `${f} reaches storage directly`);
  }
  const index = read("src/worker/index.js");
  assert.match(index, /createStore\(ext\.storage\.local\)/);
  assert.ok(!/storage\.session|storage\.sync/.test(index), "no value-capable area is touched");
});

test("the sign-in fields are found by what they are for, and a search box is not one", async () => {
  (globalThis as any).document = {};
  await import("../src/content/finder.js");
  const f = (globalThis as any).__vyreExt.finder;
  const el = (a: Record<string, string>) => ({ getAttribute: (n: string) => a[n] ?? null, getClientRects: () => [{}] });
  assert.equal(f.classify(el({ type: "password" })), "password");
  assert.equal(f.classify(el({ type: "email" })), "username");
  assert.equal(f.classify(el({ type: "text", name: "login_id" })), "username");
  assert.equal(f.classify(el({ type: "text", autocomplete: "one-time-code" })), "otp");
  assert.equal(f.classify(el({ type: "text", name: "totp_code", maxlength: "6" })), "otp");
  assert.equal(f.classify(el({ type: "search", name: "q" })), null);
  assert.equal(f.classify(el({ type: "text", name: "search_user" })), "username");
  assert.equal(f.classify(el({ type: "text", name: "coupon" })), null);
  assert.equal(f.classify(el({ type: "checkbox", name: "remember" })), null);
  assert.equal(f.classify(el({ type: "hidden", name: "csrf" })), null);
});

// Final run on the last commit of P-L10_05: this file reports its own ok line (second pass after the popup footer fix).
