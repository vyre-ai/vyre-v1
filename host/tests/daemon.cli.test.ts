// The vyre command line: the generated table turned into commands, flag and positional mapping onto the capability schema, errors with next steps and trace ids, `run --env`, `connector`,
// and `server start|status|stop` around a real in-process daemon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import { loadConfig, readInfo } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";
import { main, helpText } from "../src/cli/index.ts";
import type { CliIo } from "../src/cli/index.ts";
import type { FetchLike } from "../src/cli/io.ts";
import { commandRows, resolveRow, buildInput, capInfo, coerceValue } from "../src/cli/table.ts";
import { parseArgs, camel, kebab } from "../src/cli/args.ts";

interface Seen { method: string; path: string; headers: http.IncomingHttpHeaders; body: unknown }
type Reply = { status?: number; body: unknown };

/** A stand-in for the gateway: records each request and answers from a function. */
async function fakeServer(answer: (req: Seen, n: number) => Reply) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const s: Seen = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: text ? JSON.parse(text) : undefined };
      seen.push(s);
      const r = answer(s, seen.length);
      res.writeHead(r.status ?? 200, { "content-type": "application/json", "x-vyre-trace": "f".repeat(32) });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, seen, close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }) };
}

function mkIo(env: Record<string, string>, extra: Partial<CliIo> = {}) {
  let out = "", err = "";
  const io: CliIo = {
    out: (t) => { out += t; }, err: (t) => { err += t; }, env: { ...process.env, ...env }, cwd: os.tmpdir(), tty: false, now: Date.now,
    platform: fakePlatform(), fetch: fetch as unknown as FetchLike, sleep: () => Promise.resolve(), inherit: false, ...extra,
  };
  return { io, out: () => out, err: () => err };
}
const dirOf = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "vyre-cli-"));
const target = (url: string, dir: string) => ({ VYRE_SERVER: url, VYRE_TOKEN: "tok", VYRE_DATA_DIR: dir });

// ---- the table

test("the generated table gives every capability that declares a cli name a command, and the longest words win", () => {
  const rows = commandRows();
  assert.ok(rows.length > 80);
  const none = new Map<string, string | true>();
  assert.equal(resolveRow(["records", "query", "contact"], none)?.row.cap, "records.query");
  assert.equal(resolveRow(["records", "query", "contact"], none)?.used, 2);
  assert.equal(resolveRow(["git", "remote", "add", "origin"], none)?.row.cap, "git.remote_add");
  assert.equal(resolveRow(["call"], none)?.row.cap, "telephony.dial");
  assert.equal(resolveRow(["nope"], none), null);
  assert.equal(resolveRow(["run"], none), null, "`run` is only a command with --env");
  assert.equal(resolveRow(["run"], new Map([["env", "fld_x"]]))?.row.cap, "vault.inject_env");
  for (const r of rows) assert.ok(capInfo(r.cap, r.v), `${r.command} names a capability that exists`);
});

test("positionals fill the required fields in order, flags fill the rest, values are typed by the schema, and the idempotency key is minted", () => {
  const info = capInfo("records.create")!;
  const ok = buildInput(info, parseArgs(["records", "create", "contact", "--fields", '{"name":"Ana"}']), 2, () => "idem_fixed");
  assert.deepEqual(ok, { ok: true, input: { type: "contact", fields: { name: "Ana" }, idempotencyKey: "idem_fixed" } });
  const q = buildInput(capInfo("records.query")!, parseArgs(["records", "query", "contact", "--limit", "5", "--sort", '[{"field":"name","dir":"asc"}]', "--filter", '{"a":1}']), 2, () => "x");
  assert.deepEqual(q, { ok: true, input: { type: "contact", limit: 5, sort: [{ field: "name", dir: "asc" }], filter: { a: 1 } } });
  const kebabFlag = buildInput(capInfo("logs.query")!, parseArgs(["logs", "--since-ms", "9", "--trace-id", "abc"]), 1, () => "x");
  assert.deepEqual(kebabFlag, { ok: true, input: { sinceMs: 9, traceId: "abc" } });
  const whole = buildInput(capInfo("records.query")!, parseArgs(["records", "query", "--input-json", '{"type":"deal","limit":2}', "--limit", "3"]), 2, () => "x");
  assert.deepEqual(whole, { ok: true, input: { type: "deal", limit: 3 } }, "a flag overrides the JSON base");
});

test("what cannot be built says why: missing fields, unknown flags, bad numbers, extra words", () => {
  const info = capInfo("records.query")!;
  const bad = (argv: string[]) => { const b = buildInput(info, parseArgs(argv), 2, () => "x"); return b.ok ? [] : b.problems; };
  assert.deepEqual(bad(["records", "query"]), ["missing: type"]);
  assert.match(bad(["records", "query", "contact", "--nope", "1"])[0] ?? "", /--nope is not an input of records\.query/);
  assert.deepEqual(bad(["records", "query", "contact", "--limit", "abc"]), ["--limit is a whole number"]);
  assert.deepEqual(bad(["records", "query", "contact", "extra"]), ['unexpected argument "extra"']);
  assert.deepEqual(bad(["records", "query", "contact", "--input-json", "[1]"]), ["--input-json must be a JSON object"]);
  assert.equal(coerceValue("dry", "false", { type: "boolean" }).ok, true);
  assert.deepEqual(coerceValue("dry", "maybe", { type: "boolean" }), { ok: false, why: "--dry is true or false" });
  assert.deepEqual(coerceValue("n", "1.5", { type: "integer" }), { ok: false, why: "--n is a whole number" });
  assert.deepEqual(coerceValue("x", "text", {}), { ok: true, value: "text" });
});

test("argument parsing: values, =, booleans that do not swallow words, and everything after --", () => {
  const p = parseArgs(["a", "--x", "1", "--y=2", "--flag", "b", "--", "--z", "c"], new Set(["flag"]));
  assert.deepEqual(p.positional, ["a", "b"]);
  assert.equal(p.flags.get("x"), "1");
  assert.equal(p.flags.get("y"), "2");
  assert.equal(p.flags.get("flag"), true);
  assert.deepEqual(p.rest, ["--z", "c"]);
  assert.equal(camel("dry-run"), "dryRun");
  assert.equal(kebab("sinceMs"), "since-ms");
});

// ---- calling the server

test("a table command makes one authenticated call with a trace header and prints the data", async () => {
  const s = await fakeServer(() => ({ body: { data: { rows: [{ id: "rec_1" }], total: 1 } } }));
  const dir = dirOf();
  try {
    const t = mkIo(target(s.url, dir));
    assert.equal(await main(["records", "query", "contact", "--limit", "5", "--filter", '{"a":1}'], t.io), 0);
    const r = s.seen[0]!;
    assert.equal(r.method, "POST");
    assert.equal(r.path, "/v1/records/query");
    assert.equal(r.headers["authorization"], "Bearer tok");
    assert.match(String(r.headers["x-vyre-trace"]), /^[0-9a-f]{32}-[0-9a-f]{16}$/);
    assert.deepEqual(r.body, { type: "contact", limit: 5, filter: { a: 1 } });
    assert.deepEqual(JSON.parse(t.out()), { rows: [{ id: "rec_1" }], total: 1 });
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a command that needs a key mints one, and a connection flag becomes the right field", async () => {
  const s = await fakeServer(() => ({ body: { data: { id: "rec_9" } } }));
  const dir = dirOf();
  try {
    const t = mkIo(target(s.url, dir));
    assert.equal(await main(["records", "create", "contact", "--fields", '{"name":"Ana"}'], t.io), 0);
    const b = s.seen[0]!.body as { idempotencyKey: string; type: string; fields: unknown };
    assert.match(b.idempotencyKey, /^idem_[0-9a-f]{16}$/);
    assert.deepEqual([b.type, b.fields], ["contact", { name: "Ana" }]);
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("an error from the server shows its code, message, next steps and trace id, and exits 1", async () => {
  const error = { code: "permission.no_grant", message: "You do not have access to this.", retryable: false, traceId: "e".repeat(32), next: [{ kind: "ask_access", label: "Ask for access" }, { kind: "report", label: "Report a problem" }] };
  const s = await fakeServer(() => ({ status: 403, body: { error } }));
  const dir = dirOf();
  try {
    const t = mkIo(target(s.url, dir));
    assert.equal(await main(["records", "query", "contact"], t.io), 1);
    assert.match(t.err(), /permission\.no_grant: You do not have access to this\./);
    assert.match(t.err(), /Next: Ask for access \/ Report a problem/);
    assert.match(t.err(), /Trace: f{32}/);
    assert.equal(t.out(), "");
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a 401 points at the token; an unreachable server exits 5 with how to start it; a missing token exits 2", async () => {
  const s = await fakeServer(() => ({ status: 401, body: { error: { code: "auth.unauthenticated", message: "No valid session for this call.", retryable: false, traceId: "a".repeat(32), next: [] } } }));
  const dir = dirOf();
  try {
    const a = mkIo(target(s.url, dir));
    assert.equal(await main(["tasks", "needs-you"], a.io), 1);
    assert.match(a.err(), /Check the token/);
    const b = mkIo(target("http://127.0.0.1:1", dir));
    assert.equal(await main(["tasks", "needs-you"], b.io), 5);
    assert.match(b.err(), /vyre server start/);
    const c = mkIo({ VYRE_DATA_DIR: dir, VYRE_SERVER: "", VYRE_TOKEN: "", VYRE_ADMIN_TOKEN: "" });
    assert.equal(await main(["tasks", "needs-you"], c.io), 2);
    assert.match(c.err(), /No server or token found/);
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("usage errors exit 2 and say where to look; help lists the hand commands and the table", async () => {
  const dir = dirOf();
  try {
    const t = mkIo(target("http://127.0.0.1:1", dir));
    assert.equal(await main(["records", "query"], t.io), 2);
    assert.match(t.err(), /missing: type/);
    assert.match(t.err(), /vyre help records query/);
    const u = mkIo(target("http://127.0.0.1:1", dir));
    assert.equal(await main(["frobnicate"], u.io), 2);
    assert.match(u.err(), /not a command/);
    const h = mkIo({});
    assert.equal(await main(["help"], h.io), 0);
    assert.match(h.out(), /vyre server/);
    assert.match(h.out(), /vyre doctor/);
    assert.match(h.out(), /vyre run --env <folder> -- <cmd>/);
    assert.match(h.out(), /vyre records query/);
    assert.match(h.out(), /vyre connector build/);
    assert.equal(helpText("vyre-server").startsWith("vyre-server commands"), true);
    const one = mkIo({});
    assert.equal(await main(["help", "records", "query"], one.io), 0);
    assert.match(one.out(), /type \(required\)/);
    assert.match(one.out(), /Input fields/);
    const flagHelp = mkIo({});
    assert.equal(await main(["records", "query", "--help"], flagHelp.io), 0);
    assert.match(flagHelp.out(), /vyre records query <type>/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- run --env

test("`vyre run --env` puts the folder's values in the child's environment only", async () => {
  const s = await fakeServer(() => ({ body: { data: { handles: ["hdl_1", "hdl_2"], keys: ["API_KEY", "DB_URL"] } } }));
  const dir = dirOf();
  try {
    const asked: string[] = [];
    const filler = (h: string): Promise<string> => { asked.push(h); return Promise.resolve(h === "hdl_1" ? "k-123" : "postgres://x"); };
    const t = mkIo(target(s.url, dir), { filler });
    const code = await main(["run", "--env", "fld_prod", "--purpose", "deploy", "--", process.execPath, "-e", "process.stdout.write(process.env.API_KEY + '|' + process.env.DB_URL)"], t.io);
    assert.equal(code, 0);
    assert.equal(t.out(), "k-123|postgres://x");
    assert.deepEqual(s.seen[0]!.body, { folderId: "fld_prod", purpose: "deploy" });
    assert.equal(s.seen[0]!.path, "/v1/vault/inject_env");
    assert.deepEqual(asked, ["hdl_1", "hdl_2"]);
    assert.equal(process.env["API_KEY"], undefined, "this process's environment was not touched");
    assert.ok(!JSON.stringify(s.seen).includes("k-123"), "values never went to the server");
    const exit = mkIo(target(s.url, dir), { filler });
    assert.equal(await main(["run", "--env", "fld_prod", "--", process.execPath, "-e", "process.exit(7)"], exit.io), 7, "the child's exit code is ours");
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("`vyre run --env` runs nothing when there is no filler, when the lists disagree, or when the folder is refused", async () => {
  const dir = dirOf();
  const ok = await fakeServer(() => ({ body: { data: { handles: ["hdl_1"], keys: ["A", "B"] } } }));
  const refused = await fakeServer(() => ({ status: 403, body: { error: { code: "permission.no_grant", message: "No access to that folder.", retryable: false, traceId: "b".repeat(32), next: [] } } }));
  try {
    const noFiller = mkIo(target(ok.url, dir));
    assert.equal(await main(["run", "--env", "fld_x", "--", process.execPath, "-e", "0"], noFiller.io), 1);
    assert.match(noFiller.err(), /vault filler is not running/);
    assert.equal(ok.seen.length, 0, "asked nothing of the server before it knew it could fill");
    const mismatch = mkIo(target(ok.url, dir), { filler: () => Promise.resolve("v") });
    assert.equal(await main(["run", "--env", "fld_x", "--", process.execPath, "-e", "0"], mismatch.io), 1);
    assert.match(mismatch.err(), /different number of keys and handles/);
    const denied = mkIo(target(refused.url, dir), { filler: () => Promise.resolve("v") });
    assert.equal(await main(["run", "--env", "fld_x", "--", process.execPath, "-e", "0"], denied.io), 1);
    assert.match(denied.err(), /permission\.no_grant/);
    const usage = mkIo(target(ok.url, dir), { filler: () => Promise.resolve("v") });
    assert.equal(await main(["run", "--env", "fld_x"], usage.io), 2);
  } finally { await ok.close(); await refused.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- connector

test("`vyre connector run` maps key, action and friendly flags onto the capability", async () => {
  const s = await fakeServer(() => ({ body: { data: { output: { n: 1 }, dryRun: true } } }));
  const dir = dirOf();
  try {
    const t = mkIo(target(s.url, dir));
    assert.equal(await main(["connector", "run", "hubspot", "contacts.list", "--connection", "con_a1", "--input", '{"limit":2}', "--dry-run"], t.io), 0);
    const r = s.seen[0]!;
    assert.equal(r.path, "/v1/connectors/run");
    const b = r.body as Record<string, unknown>;
    assert.deepEqual({ ...b, idempotencyKey: "-" }, { key: "hubspot", action: "contacts.list", connectionId: "con_a1", input: { limit: 2 }, dryRun: true, idempotencyKey: "-" });
    assert.match(String(b["idempotencyKey"]), /^idem_/);
    const init = mkIo(target(s.url, dir));
    assert.equal(await main(["connector", "init", "acme", "--title", "Acme", "--mode", "rest", "--docs", "https://acme.dev/docs"], init.io), 0);
    assert.deepEqual({ ...(s.seen[1]!.body as object), idempotencyKey: "-" }, { key: "acme", title: "Acme", mode: "rest", docsUrl: "https://acme.dev/docs", idempotencyKey: "-" });
    const bad = mkIo(target(s.url, dir));
    assert.equal(await main(["connector", "teleport"], bad.io), 2);
    assert.equal(await main(["connector", "run", "a", "b", "c"], mkIo(target(s.url, dir)).io), 2, "an extra word is a usage error");
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test("`vyre connector build` follows the Run to its end and exits by how it ended; --no-wait does not", async () => {
  const dir = dirOf();
  for (const [final, code] of [["succeeded", 0], ["failed", 1]] as const) {
    const s = await fakeServer((req, n) => (req.path === "/v1/connectors/build" ? { body: { data: { runId: "run_1", draftId: "drf_1" } } } : { body: { data: { run: { status: n < 4 ? "running" : final } } } }));
    try {
      const t = mkIo(target(s.url, dir));
      assert.equal(await main(["connector", "build", "hubspot", "--notes", "use v3"], t.io), code);
      assert.match(t.out(), /Build started as run_1/);
      assert.match(t.out(), new RegExp(`"status": "${final}"`));
      assert.deepEqual(s.seen.filter((r) => r.path === "/v1/runs/get").map((r) => r.body), Array.from({ length: 3 }, () => ({ runId: "run_1" })));
      assert.equal((s.seen[0]!.body as { notes: string }).notes, "use v3");
    } finally { await s.close(); }
  }
  const s = await fakeServer(() => ({ body: { data: { runId: "run_2", draftId: "drf_2" } } }));
  try {
    const t = mkIo(target(s.url, dir));
    assert.equal(await main(["connector", "build", "hubspot", "--no-wait"], t.io), 0);
    assert.equal(s.seen.length, 1, "no polling");
  } finally { await s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- server start, status, stop around a real in-process daemon

test("`vyre server start|status|stop` starts the daemon with the flags given, reads its health, and stops it", async () => {
  const dir = dirOf();
  let daemon: Daemon | null = null;
  let startError: unknown = null;
  const io = mkIo({ VYRE_DATA_DIR: dir }, {
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
    spawnDaemon: (args) => {
      void startDaemon({ config: loadConfig(args, {}, "9.9.9"), platform: fakePlatform({ os: "linux", free: 50e9 }), fetch: () => Promise.reject(new Error("no caddy")), intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000 } })
        .then((d) => { daemon = d; }, (e: unknown) => { startError = e; });
      return { pid: process.pid };
    },
    signal: (pid, sig) => { assert.equal(pid, process.pid); assert.equal(sig, "SIGTERM"); void daemon?.stop(); },
  });
  try {
    assert.equal(await main(["server", "status", "--data-dir", dir], io.io), 5, "not running yet");
    assert.match(io.err(), /vyred is not running/);
    assert.equal(await main(["server", "start", "--data-dir", dir, "--space", "spc_cli", "--port", "0"], io.io), 0, String(startError));
    assert.match(io.out(), /vyred started on http:\/\/127\.0\.0\.1:\d+/);
    assert.equal(daemon!.space, "spc_cli", "the flags reached the daemon");
    assert.equal(readInfo(daemon!.paths)?.version, "9.9.9");

    const again = mkIo({ VYRE_DATA_DIR: dir }, { sleep: () => Promise.resolve() });
    assert.equal(await main(["server", "start", "--data-dir", dir], again.io), 0);
    assert.match(again.out(), /already running/);

    const st = mkIo({ VYRE_DATA_DIR: dir });
    assert.equal(await main(["server", "status", "--data-dir", dir], st.io), 0);
    assert.match(st.out(), /vyred 9\.9\.9 runs as pid \d+ on http:\/\/127\.0\.0\.1:\d+/);
    assert.match(st.out(), /roles space {2}space spc_cli/);
    assert.match(st.out(), /healthy\s+gateway/);
    const js = mkIo({ VYRE_DATA_DIR: dir });
    assert.equal(await main(["server", "status", "--json", "--data-dir", dir], js.io), 0);
    assert.equal((JSON.parse(js.out()) as { space: string }).space, "spc_cli");

    // the token file the daemon wrote lets the CLI call it with no flags at all
    const call = mkIo({ VYRE_DATA_DIR: dir });
    assert.equal(await main(["logs", "--limit", "1"], call.io), 1, "the seeded roles of a new Space do not include server.logs");
    assert.match(call.err(), /permission\.|auth\./);
    assert.match(call.err(), /Trace: [0-9a-f]{32}/);

    assert.equal(await main(["server", "stop", "--data-dir", dir], io.io), 0);
    assert.match(io.out(), /vyred stopped/);
    assert.equal(readInfo(daemon!.paths), null);
    assert.equal(await main(["server", "status", "--data-dir", dir], mkIo({ VYRE_DATA_DIR: dir }).io), 5);
    assert.equal(await main(["server", "stop", "--data-dir", dir], mkIo({ VYRE_DATA_DIR: dir }).io), 0, "stopping a stopped server is fine");
  } finally {
    await (daemon as Daemon | null)?.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("`vyre server logs` prints the end of the daemon's output file; an unknown subcommand is a usage error", async () => {
  const dir = dirOf();
  try {
    fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "logs", "vyred.out"), Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const t = mkIo({ VYRE_DATA_DIR: dir });
    assert.equal(await main(["server", "logs", "--lines", "3", "--data-dir", dir], t.io), 0);
    assert.match(t.out(), /line 99/);
    assert.ok(!t.out().includes("line 90"));
    const u = mkIo({ VYRE_DATA_DIR: dir });
    assert.equal(await main(["server", "dance"], u.io), 2);
    assert.match(u.err(), /Use start, stop, restart, status, logs or doctor/);
    const none = mkIo({ VYRE_DATA_DIR: path.join(dir, "nowhere") });
    assert.equal(await main(["server", "logs"], none.io), 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
