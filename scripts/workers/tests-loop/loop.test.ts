// The tracker-to-worker loop against a stub tracker over HTTP: priority, the sonnet cap, changes_requested first, stale alerts and usage.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOOP = path.resolve(here, "../loop.py");
const SONNET = path.resolve(here, "../sonnet-run.py");
const python = spawnSync("python3", ["--version"]).status === 0;

type Pk = { id: string; lane_id: string; status: string; tier: number; body: string; assignee: string | null; title: string; owns_files: string[]; spec_refs?: string[]; arch_refs?: string[] };
const mk = (id: string, lane: string, tier: number, worker: string, status = "ready"): Pk => ({ id, lane_id: lane, status, tier, body: `Worker: ${worker}. Tier ${tier}.`, assignee: null, title: `packet ${id}`, owns_files: [`src/${id}/**`] });

async function stub(packets: Pk[], stale: { id: string; assignee: string; touched_at: string }[] = []) {
  const calls: { actor: string; method: string; url: string; body: any }[] = [];
  const usage: any[] = [];
  const srv = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const actor = String(req.headers["x-actor"] ?? "");
      const url = new URL(req.url ?? "/", "http://x");
      calls.push({ actor, method: req.method ?? "", url: req.url ?? "", body });
      const ok = (data: unknown) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data }));
      const fail = (code: number, error: string) => res.writeHead(code).end(JSON.stringify({ error }));
      let m: RegExpExecArray | null;
      if (req.method === "GET" && url.pathname === "/api/packets") return ok(packets.filter((p) => p.lane_id === url.searchParams.get("lane")));
      if (req.method === "GET" && (m = /^\/api\/packets\/([\w.-]+)$/.exec(url.pathname))) { const p = packets.find((x) => x.id === m![1]); return p ? ok(p) : fail(404, "nf"); }
      if (req.method === "GET" && (m = /^\/api\/brief\/([\w.-]+)$/.exec(url.pathname))) return res.writeHead(200).end(`PACKET ${m[1]}: brief text`);
      if (req.method === "GET" && url.pathname === "/api/status") return ok({ stale });
      if (req.method === "POST" && (m = /^\/api\/packets\/([\w.-]+)\/(assign|start)$/.exec(url.pathname))) {
        const p = packets.find((x) => x.id === m![1])!;
        if (m[2] === "assign") { if (!["ready", "assigned"].includes(p.status)) return fail(409, "no"); p.status = "assigned"; p.assignee = body.assignee; }
        else { if (!["ready", "assigned", "changes_requested"].includes(p.status)) return fail(409, "no"); p.status = "in_progress"; p.assignee = actor; }
        return ok({ id: p.id });
      }
      if (req.method === "PATCH" && /^\/api\/packets\//.test(url.pathname)) return ok({});
      if (req.method === "POST" && url.pathname === "/api/comments") return ok({ id: 1 });
      if (req.method === "POST" && url.pathname === "/api/usage") { usage.push(body); return ok({}); }
      fail(404, "no route");
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, calls, usage, packets, close: () => srv.close() };
}

function run(script: string, url: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("python3", [script, ...args], { env: { ...process.env, VYRE_TRACKER_URL: url, VYRE_TRACKER_TOKEN: "t", VYRE_TRACKER_ACTOR: "dispatcher" } });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "loop-"));
const fakeGrok = (dir: string) => { const f = path.join(dir, "fake-grok.sh"); fs.writeFileSync(f, "#!/bin/sh\nexit 0\n", { mode: 0o755 }); return `sh ${f} {packet}`; };
const dispatched = (out: string) => [...out.matchAll(/^dispatch (\S+) \((\w+), (\w+)\)$/gm)].map((m) => `${m[1]}:${m[2]}:${m[3]}`);

test("dispatches changes_requested first, then by tier, then id, across lanes", { skip: !python }, async () => {
  const t = await stub([mk("P-A1", "A", 2, "grok"), mk("P-A2", "A", 1, "grok"), mk("P-B1", "B", 3, "grok", "changes_requested"), mk("P-B2", "B", 1, "sonnet")]);
  const dir = tmp();
  try {
    const r = await run(LOOP, t.url, ["--lanes", "A,B", "--once", "--outbox", dir, "--grok-cmd", fakeGrok(dir)]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(dispatched(r.out), ["P-B1:changes_requested:grok", "P-A2:ready:grok", "P-B2:ready:sonnet", "P-A1:ready:grok"]);
    // a grok packet is assigned by the loop (grok-run starts it); a changes_requested one is left for grok-run to start
    assert.ok(t.calls.some((c) => c.url === "/api/packets/P-A2/assign" && c.body.assignee === "grok-P-A2"));
    assert.ok(!t.calls.some((c) => c.url === "/api/packets/P-B1/assign"));
  } finally { t.close(); }
});

test("never runs more than five sonnet packets, frees a slot when one leaves", { skip: !python }, async () => {
  const t = await stub(Array.from({ length: 7 }, (_, i) => mk(`P-S${i + 1}`, "L", 1, "sonnet")));
  const dir = tmp();
  const args = ["--lanes", "L", "--once", "--outbox", dir];
  try {
    const first = await run(LOOP, t.url, args);
    assert.equal(dispatched(first.out).length, 5, first.out);
    assert.deepEqual(t.packets.filter((p) => p.status === "in_progress").map((p) => p.assignee), ["sonnet-w1", "sonnet-w2", "sonnet-w3", "sonnet-w4", "sonnet-w5"]);
    assert.equal(t.packets.filter((p) => p.status === "ready").length, 2);
    const second = await run(LOOP, t.url, args);
    assert.equal(dispatched(second.out).length, 0, "cap holds on the next cycle");
    t.packets.find((p) => p.id === "P-S2")!.status = "in_review";
    const third = await run(LOOP, t.url, args);
    assert.deepEqual(dispatched(third.out), ["P-S6:ready:sonnet"]);
    assert.equal(t.packets.find((p) => p.id === "P-S6")!.assignee, "sonnet-w2", "takes the freed slot");
    assert.ok(fs.existsSync(path.join(dir, "finished", "P-S2.json")));
  } finally { t.close(); }
});

test("a sent-back sonnet packet beats fresh ones for the last slot and carries the redo flag", { skip: !python }, async () => {
  const ps = [...Array.from({ length: 5 }, (_, i) => mk(`P-R${i + 1}`, "L", 1, "sonnet")), mk("P-Z", "L", 9, "sonnet", "changes_requested")];
  const t = await stub(ps);
  const dir = tmp();
  try {
    const r = await run(LOOP, t.url, ["--lanes", "L", "--once", "--outbox", dir]);
    const d = dispatched(r.out);
    assert.equal(d[0], "P-Z:changes_requested:sonnet");
    assert.equal(d.length, 5);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "P-Z.json"), "utf8")).redo, true);
    assert.equal(ps.find((p) => p.id === "P-R5")!.status, "ready", "the fifth fresh packet waits");
  } finally { t.close(); }
});

test("the sonnet brief carries owned files, the loop steps and the usage command", { skip: !python }, async () => {
  const t = await stub([mk("P-B", "L", 1, "sonnet")]);
  const dir = tmp();
  try {
    await run(LOOP, t.url, ["--lanes", "L", "--once", "--outbox", dir]);
    const prompt = fs.readFileSync(path.join(dir, "P-B.prompt.md"), "utf8");
    assert.match(prompt, /worker "sonnet-w1"/);
    assert.match(prompt, /src\/P-B\/\*\*/);
    assert.match(prompt, /Never run node or npm/);
    assert.match(prompt, /no Co-Authored-By/);
    assert.match(prompt, /sonnet-run\.py usage --packet P-B/);
    const u = await run(SONNET, t.url, ["usage", "--packet", "P-B", "--in", "1200", "--out", "300"]);
    assert.equal(u.code, 0, u.out);
    assert.deepEqual(t.usage, [{ lane: "L", worker: "sonnet", tokens_in: 1200, tokens_out: 300, cost_est: 0 }]);
  } finally { t.close(); }
});

test("a stale packet is reported and commented once", { skip: !python }, async () => {
  const t = await stub([], [{ id: "P-OLD", assignee: "sonnet-w3", touched_at: "2026-10-24T10:00:00Z" }]);
  const dir = tmp();
  try {
    const r = await run(LOOP, t.url, ["--lanes", "L", "--once", "--outbox", dir]);
    assert.match(r.out, /^STALE P-OLD assignee=sonnet-w3/m);
    assert.equal(t.calls.filter((c) => c.url === "/api/comments").length, 1);
  } finally { t.close(); }
});

test("a failed claim is skipped, the rest still dispatch", { skip: !python }, async () => {
  const bad = mk("P-BAD", "L", 1, "sonnet"); bad.status = "ready";
  const t = await stub([bad, mk("P-OK", "L", 2, "sonnet")]);
  const orig = t.packets;
  // the stub refuses to start P-BAD: pretend it moved to blocked between list and claim
  Object.defineProperty(bad, "status", { get: () => (t.calls.some((c) => c.url === "/api/packets/P-BAD/assign") ? "blocked" : "ready"), set: () => {}, configurable: true });
  const dir = tmp();
  try {
    const r = await run(LOOP, t.url, ["--lanes", "L", "--once", "--outbox", dir]);
    assert.match(r.out, /cannot claim P-BAD/);
    assert.ok(dispatched(r.out).includes("P-OK:ready:sonnet"), r.out);
    assert.equal(orig.length, 2);
  } finally { t.close(); }
});

const repoRoot = path.resolve(here, "../../..");
const sample = (): Pk => ({ ...mk("P-CTX", "L1", 1, "sonnet"), spec_refs: ["2.1", "5 b14", "speed"], arch_refs: ["ARCH 10.7", "F10", "ARCH-DECISIONS 2"] });

test("ruling 13: the sonnet prompt embeds the brief, the lane doc and the text of every referenced spec and arch section", { skip: !python }, async () => {
  const docs = tmp();
  fs.mkdirSync(path.join(docs, "docs/spec"), { recursive: true }); fs.mkdirSync(path.join(docs, "docs/lanes"), { recursive: true });
  fs.writeFileSync(path.join(docs, "docs/lanes/L1.md"), "# Lane L1: Sync\nLANE-MARKER read me first\n");
  fs.writeFileSync(path.join(docs, "docs/spec/V1-SPEC.md"), "# spec\n## 2. Primitives\n### 2.1 Space\nSPACE-MARKER isolation unit\n### 2.2 Principal\nPRINCIPAL-MARKER not asked for\n## 5. Platform\n- **b13 Releases**: nope\n- **b14 How we know**: B14-MARKER contract tests\n## Speed and smoothness (binding)\nSPEED-MARKER 100 ms\n");
  fs.writeFileSync(path.join(docs, "docs/spec/ARCHITECTURE-V1.md"), "# arch\n## 10. Testing\n### 10.6 Other\nOTHER-MARKER\n### 10.7 Timing tables\nTIMING-MARKER stages\n## 12. Build\n### 12.2 Frozen\n| ID | Frozen item |\n|---|---|\n| F9 | NINE-MARKER |\n| F10 | CISKEL-MARKER skeleton |\n");
  fs.writeFileSync(path.join(docs, "docs/spec/ARCH-DECISIONS.md"), "# d\n1. one DEC1-MARKER\n2. two DEC2-MARKER\n");
  const t = await stub([sample()]);
  const out = tmp();
  try {
    const r = await run(LOOP, t.url, ["--lanes", "L1", "--once", "--outbox", out, "--docs-root", docs]);
    assert.equal(r.code, 0, r.out);
    const p = fs.readFileSync(path.join(out, "P-CTX.prompt.md"), "utf8");
    for (const m of ["PACKET P-CTX: brief text", "LANE-MARKER", "SPACE-MARKER", "B14-MARKER", "SPEED-MARKER", "TIMING-MARKER", "CISKEL-MARKER", "DEC2-MARKER"]) assert.ok(p.includes(m), `prompt lacks ${m}`);
    for (const m of ["PRINCIPAL-MARKER", "OTHER-MARKER", "NINE-MARKER", "DEC1-MARKER"]) assert.ok(!p.includes(m), `prompt carries unrelated ${m}`);
  } finally { t.close(); }
});

test("ruling 13: a missing section is named in the prompt instead of silently dropped", { skip: !python }, async () => {
  const t = await stub([{ ...sample(), spec_refs: ["9.9"] }]);
  const out = tmp(); const docs = tmp();
  try {
    await run(LOOP, t.url, ["--lanes", "L1", "--once", "--outbox", out, "--docs-root", docs]);
    assert.match(fs.readFileSync(path.join(out, "P-CTX.prompt.md"), "utf8"), /SPEC 9\.9[^\n]*\n\(section not found on main/);
  } finally { t.close(); }
});

test("ruling 13: against the real docs a lane-L1 packet gets its lane brief, spec 2.1 and the ARCH 10.7 timing table", { skip: !python || !fs.existsSync(path.join(repoRoot, "docs/spec/V1-SPEC.md")) }, async () => {
  const t = await stub([sample()]);
  const out = tmp();
  try {
    await run(LOOP, t.url, ["--lanes", "L1", "--once", "--outbox", out, "--docs-root", repoRoot]);
    const p = fs.readFileSync(path.join(out, "P-CTX.prompt.md"), "utf8");
    assert.match(p, /# Lane L1: Sync and search/);
    assert.match(p, /### 2\.1 Space/);
    assert.match(p, /### 10\.7 Timing tables/);
    assert.match(p, /\| F10 \|/);
    assert.match(p, /\*\*b14 How we know it works\*\*/);
    assert.doesNotMatch(p, /section not found/);
  } finally { t.close(); }
});
