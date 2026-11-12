// A web request trigger through the relay: the box's half (host/src/seams/relay.ts serveHook), driven the way the control socket hands it a request. An outside POST of the exact shape starts
// exactly one Run; anything else, and a paused, rotated, trigger-removed or deleted Automation, is the same bare 404; only content-type and an idempotency key go in; the Space's and one hook's
// minute stop a flood before the daemon; and the secret in the path appears in no log, audit row or event.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import { resetRelayHooks, servePublic, RELAY_HOOKS } from "../src/seams/relay.ts";
import type { Daemon, DaemonOptions } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-relay-hook-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

const boot = (dir: string, extra: Partial<DaemonOptions> = {}): Promise<Daemon> => startDaemon({
  config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
  platform: fakePlatform({
    os: "linux", hostname: "relay-hook", free: 80e9,
    commands: {
      [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
      "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
      "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
    },
  }),
  fetch: caddyFetch,
  session: (h) => {
    const t = /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1];
    return t === OWNER ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "relay-hook" } : null;
  },
  intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  ...extra,
});

const call = async (d: Daemon, p: string, body: unknown): Promise<{ status: number; data: Record<string, unknown>; text: string }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  const text = await r.text();
  return { status: r.status, data: ((JSON.parse(text) as { data?: Record<string, unknown> }).data ?? {}), text };
};
const ok = async (d: Daemon, p: string, body: unknown): Promise<Record<string, unknown>> => {
  const r = await call(d, p, body);
  assert.equal(r.status, 200, `${p}: ${r.text}`);
  return r.data;
};
async function until<T>(what: string, ms: number, look: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v !== undefined) return v;
    assert.ok(Date.now() < end, `gave up waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

type Note = { fields: { title?: string } };
// A read that lands while access is being folded answers "Access changed while reading. Refresh the list." (422). That is a read race, so the read is asked again.
const countOf = async (d: Daemon, title: string): Promise<number> => {
  for (let tries = 0; ; tries++) {
    const r = await call(d, "/v1/records/query", { type: "note_board" });
    if (r.status === 422 && tries < 6) { await new Promise((x) => setTimeout(x, 200)); continue; }
    assert.equal(r.status, 200, r.text);
    return (r.data["rows"] as Note[]).filter((row) => row.fields.title === title).length;
  }
};


/** One request as the relay hands it over: the answer's status and body. */
const viaRelay = (d: Daemon, method: string, p: string, body = "{}", headers: Record<string, string> = { "content-type": "application/json" }, ip = "203.0.113.5"): Promise<{ status: number; body: string }> => new Promise((resolve) => {
  let status = 0;
  let out = "";
  const port = Number(new URL(d.url).port);
  servePublic((m) => {
    const x = m as { t: string; status?: number; b?: string };
    if (x.t === "p.res") status = x.status ?? 0;
    if (x.t === "p.data") out += Buffer.from(x.b ?? "", "base64").toString();
    if (x.t === "p.end" || x.t === "p.err") resolve({ status, body: out });
  }, { id: String(Math.random()), method, path: p, ip, headers }, Buffer.from(body), port);
});

test("an outside POST through the relay starts exactly one Run; everything else is the same bare 404; the secret is logged nowhere", async () => {
  resetRelayHooks();
  const dir = seededDir();
  const d = await boot(dir);
  const secrets: string[] = [];
  try {
    const made = await ok(d, "/v1/automations/create", { idempotencyKey: "relay-hook-create", name: "relay hooked" });
    const id = String((made["automation"] as { id?: string } | undefined)?.id ?? made["automationId"]);
    const def = { triggers: [{ key: "webhook" }], nodes: [{ id: "n", key: "records.create", input: { type: "note_board", fields: { title: "From relay" } } }] };
    await ok(d, "/v1/automations/update", { automationId: id, definition: def });
    const pathOf = async (route: string): Promise<string> => String((await ok(d, route, { automationId: id, ...(route.endsWith("rotate") ? { confirm: true } : {}) }))["url"]).replace(/^https?:\/\/[^/]+/, "");
    const p = await pathOf("/v1/automations/webhook_url/get");
    secrets.push(p.split("/").at(-1) as string);
    const bare = async (method: string, at: string, what: string, bodyText = "{}"): Promise<void> => { const r = await viaRelay(d, method, at, bodyText); assert.deepEqual([r.status, r.body], [404, ""], what); };

    await bare("POST", p, "off: 404");
    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    const first = await viaRelay(d, "POST", p, JSON.stringify({ order: 1 }), { "content-type": "application/json", "idempotency-key": "relay-evt-1" });
    assert.deepEqual([first.status, first.body], [200, '{"accepted":true}']);
    const again = await viaRelay(d, "POST", p, JSON.stringify({ order: 1 }), { "content-type": "application/json", "idempotency-key": "relay-evt-1" });
    assert.equal(again.status, 200);
    await until("the note", 10_000, async () => (await countOf(d, "From relay")) >= 1 ? true : undefined);
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await countOf(d, "From relay"), 1, "one outside POST (sent twice with one key) is one Run");
    assert.equal(((await ok(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, limit: 20 }))["runs"] as unknown[]).length, 1);

    // B1 and the two counts: a stranger's guessed ids (refused) stop at 10 a minute here and are counted by the address the relay saw, so another visitor's good POST starts its Run, and so
    // does the stranger's own address on a hook that was accepted this minute
    resetRelayHooks();
    const guesses: number[] = [];
    for (let i = 0; i < 20; i++) guesses.push((await viaRelay(d, "POST", `/hooks/automation/aut_guess${i}/wrongguessxxxx`, "{}", { "content-type": "application/json" }, "198.51.100.66")).status);
    assert.deepEqual([guesses.filter((x) => x === 404).length, guesses.filter((x) => x === 429).length], [10, 10], `10 refusals, then 429: ${guesses.join(",")}`);
    const other = await viaRelay(d, "POST", p, JSON.stringify({ order: 2 }), { "content-type": "application/json", "idempotency-key": "relay-evt-b1" }, "192.0.2.10");
    assert.deepEqual([other.status, other.body], [200, '{"accepted":true}'], "another visitor's good POST still starts its Run");
    const same = await viaRelay(d, "POST", p, JSON.stringify({ order: 3 }), { "content-type": "application/json", "idempotency-key": "relay-evt-b1-same" }, "198.51.100.66");
    assert.deepEqual([same.status, same.body], [200, '{"accepted":true}'], "the guesser's own address still reaches a hook accepted this minute");
    await until("the B1 notes", 10_000, async () => (await countOf(d, "From relay")) >= 3 ? true : undefined);
    resetRelayHooks();

    // the shapes the relay never passes on, and the daemon's own refusals, are all the same bare 404
    await bare("GET", p, "GET");
    await bare("PUT", p, "PUT");
    await bare("POST", `${p}?x=1`, "a query");
    await bare("POST", `${p}/more`, "a longer path");
    await bare("POST", p.replace(/\/[^/]+$/, "/not-the-secret-at-all"), "a wrong secret");
    await bare("POST", p.replace(/aut_[a-z0-9]+/, "aut_000000000000"), "an unknown id");
    await bare("POST", "/hooks/stripe", "another hook");
    await bare("POST", p, "over 1 MB", JSON.stringify({ blob: "x".repeat(RELAY_HOOKS.maxBody) }));
    // paused (turned off), the trigger removed, rotated, deleted
    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: false });
    await bare("POST", p, "turned off");
    await ok(d, "/v1/automations/update", { automationId: id, definition: { ...def, triggers: [{ key: "manual" }] } });
    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    await bare("POST", p, "the web request trigger removed");
    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: false });
    await ok(d, "/v1/automations/update", { automationId: id, definition: def });
    await ok(d, "/v1/automations/set_enabled", { automationId: id, enabled: true });
    const fresh = await pathOf("/v1/automations/webhook_url/rotate");
    secrets.push(fresh.split("/").at(-1) as string);
    await bare("POST", p, "the old secret after a rotate");
    assert.equal((await viaRelay(d, "POST", fresh, "{}", { "content-type": "application/json", "idempotency-key": "relay-evt-2" })).status, 200);
    await ok(d, "/v1/automations/delete", { automationId: id, idempotencyKey: "relay-hook-del" });
    await bare("POST", fresh, "deleted");
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(await countOf(d, "From relay"), 4, "only the four accepted POSTs ran");

    // a flood, against a stand-in daemon that accepts only /aut_real/: refused and accepted are counted apart
    const seen: string[] = [];
    const counter = (await import("node:http")).createServer((req, res) => { seen.push(req.url ?? ""); res.writeHead(/\/aut_real\d*\//.test(req.url ?? "") ? 200 : 404); res.end(); });
    await new Promise<void>((r) => counter.listen(0, "127.0.0.1", r));
    const cport = (counter.address() as { port: number }).port;
    const send = (n: number, at: string, ip: string): Promise<number> => new Promise((resolve) => { let st = 0; servePublic((m) => { const x = m as { t: string; status?: number }; if (x.t === "p.res") st = x.status ?? 0; if (x.t === "p.end") resolve(st); }, { id: String(n), method: "POST", path: at, ip, headers: {} }, Buffer.from("{}"), cport); });
    resetRelayHooks();
    // 200 random ids from one address: 10 reach the daemon, the rest are 429
    let limited = 0;
    for (let i = 0; i < 200; i++) if ((await send(i, `/hooks/automation/aut_r${i}/abcdefghijk`, "203.0.113.77")) === 429) limited++;
    assert.deepEqual([seen.length, limited], [RELAY_HOOKS.refusedPerVisitor, 200 - RELAY_HOOKS.refusedPerVisitor]);
    // a good POST from another address, then from the same address to that real hook: both go through
    assert.equal(await send(1000, "/hooks/automation/aut_real/abcdefghijk", "203.0.113.88"), 200);
    assert.equal(await send(1001, "/hooks/automation/aut_real/abcdefghijk", "203.0.113.77"), 200, "the sprayer's address on a hook accepted this minute");
    // accepted: one address on one hook 20, one hook 30, the Space 120
    resetRelayHooks();
    seen.length = 0;
    for (let i = 0; i < 25; i++) await send(2000 + i, "/hooks/automation/aut_real/abcdefghijk", "198.51.100.1");
    assert.equal(seen.length, RELAY_HOOKS.perVisitorPerMinute, "one address on one hook: 20");
    for (let i = 0; i < 20; i++) await send(3000 + i, "/hooks/automation/aut_real/abcdefghijk", `198.51.100.${10 + i}`);
    assert.equal(seen.length, RELAY_HOOKS.perHookPerMinute, "one hook: 30");
    for (let i = 0; i < 200; i++) await send(4000 + i, `/hooks/automation/aut_real${i % 40}/abcdefghijk`, `192.0.2.${i % 200}`);
    assert.equal(seen.length, RELAY_HOOKS.perMinute, "the Space: 120 accepted");
    counter.close();
  } finally {
    await d.stop();
  }
  // the secret in the path is in no log, audit row or event (the hook table itself holds it; that is modules.db, which is not a log)
  const files = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.startsWith("modules.db") && fs.statSync(path.join(dir, f)).isFile());
  assert.ok(files.length > 0 && secrets.length === 2);
  for (const f of files) {
    const bytes = fs.readFileSync(path.join(dir, f));
    for (const s of secrets) assert.equal(bytes.includes(Buffer.from(s)), false, `${f} carries a hook secret`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

