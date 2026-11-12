// @heavy docker
// Release gate, 12 Nov (lane f-gate): "a dangerous terminal command needed two Allows" on an API model (deepseek through the gate's key). An API model may put several tool calls in one step, and
// after an approval it may ask for another dangerous command. These run the shapes with a stand-in that batches the way an API session does (tool calls, then tool_wait), on a real daemon and
// real Docker, and count holds, cards and resumes: one Allow must resume the turn, and a second card may only come from a new call the model made after the first was answered.
// Needs VYRE_HEAVY_DOCKER=1; VYRE_WORKSPACE_TEST_IMAGE names an image built from images/agent-workspace.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, waitFor } from "./memory-live-kit.ts";
import { loadConfig } from "../host/src/daemon/config.ts";
import { CODE_ROOT } from "../host/src/daemon/daemon.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const ON = process.env["VYRE_HEAVY_DOCKER"] === "1";
const skip: string | false = ON ? false : "needs VYRE_HEAVY_DOCKER=1 (the workspace is a real container)";
const PRESET = process.env["VYRE_WORKSPACE_TEST_IMAGE"];
const IMAGE = PRESET ?? `vyre/agent-workspace:daemon-${process.pid}${Math.random().toString(36).slice(2, 6)}`;
const KEY = "sk-ant-oat01-TESTsecretVALUE0123456789abcdefXYZ"; // secret-scan: fake
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

function docker(args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("docker", args, { cwd: CODE_ROOT, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? ((err as NodeJS.ErrnoException & { code?: number }).code as number | undefined) ?? 1 : 0, out: `${stdout}\n${stderr}` });
    });
  });
}
type Reply = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(d: Daemon, token: string | null, cap: string, input: unknown): Promise<Reply> {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}
let keys = 0;
const ok = async (d: Daemon, token: string, cap: string, input: Record<string, unknown>): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, token, cap, { idempotencyKey: `hb-${cap}-${++keys}`, ...input });
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

/** What the batching stand-in does. `calls` go out in one step; `then` is one more call the model makes after its first held call is answered. */
interface Script { calls: Array<Record<string, unknown>>; then?: Record<string, unknown> }
const script: { now: Script | null; thenDone: boolean; sends: string[]; slowCloseMs: number } = { now: null, thenDone: false, sends: [], slowCloseMs: 0 };

/** An API-shaped stand-in: one step's tool calls, then tool_wait, then the results in any order (agent/src/drivers/api/session.ts). */
const batching: OpenSession = async () => {
  const results = new Map<string, { ok: boolean; content: unknown }>();
  const waiters = new Map<string, () => void>();
  let n = 0;
  let cancelled = false;
  const wait = async (id: string): Promise<{ ok: boolean; content: unknown }> => {
    for (;;) {
      const r = results.get(id);
      if (r) return r;
      if (cancelled) return { ok: false, content: "cancelled" };
      await new Promise<void>((res) => waiters.set(id, res));
    }
  };
  async function* step(calls: Array<{ name: string; input: Record<string, unknown> }>): AsyncGenerator<DriverEvent, Array<{ ok: boolean; content: unknown }>> {
    const ids = calls.map(() => `call_${++n}`);
    for (let i = 0; i < calls.length; i++) yield { type: "tool_call", id: ids[i]!, name: calls[i]!.name, input: calls[i]!.input };
    yield { type: "tool_wait" } as DriverEvent;
    const out: Array<{ ok: boolean; content: unknown }> = [];
    for (const id of ids) out.push(await wait(id));
    return out;
  }
  return {
    warm: true,
    parallelTools: true,
    async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
      const s = script.now;
      if (input.resumed) {
        script.sends.push(`resumed:${input.resumed.toolName}:${input.resumed.approved}`);
        if (s?.then && !script.thenDone) {
          script.thenDone = true;
          const [r] = yield* step([{ name: "terminal_run", input: s.then }]);
          if (cancelled) return;
          yield { type: "text", text: `THEN RESULT ${JSON.stringify(r)}` };
          yield { type: "done" };
          return;
        }
        yield { type: "text", text: `RESUMED ${input.resumed.toolName} ${input.resumed.approved} ${String(JSON.stringify(input.resumed.result?.content) ?? "").slice(0, 400)}` };
        yield { type: "done" };
        return;
      }
      script.sends.push(`send:${String(input.trigger?.body ?? "").slice(0, 20)}`);
      if (!s || !/^BATCH/.test(String(input.trigger?.body ?? ""))) { yield { type: "text", text: "ok" }; yield { type: "done" }; return; }
      yield* step([{ name: "tool_search", input: { query: "terminal_run" } }]);
      if (cancelled) return;
      const rs = yield* step(s.calls.map((c) => ({ name: "terminal_run", input: c })));
      if (cancelled) return;
      yield { type: "text", text: `BATCH RESULT ${JSON.stringify(rs)}` };
      yield { type: "done" };
    },
    sendToolResult(id: string, r: { ok: boolean; content: unknown }) { results.set(id, r); waiters.get(id)?.(); },
    inject() {},
    async cancel() { cancelled = true; for (const f of waiters.values()) f(); },
    // a busy server (load 17 at the gate) is slow to let a parked session go
    async close() { cancelled = true; for (const f of waiters.values()) f(); if (script.slowCloseMs > 0) await new Promise((r) => setTimeout(r, script.slowCloseMs)); },
  } as EngineSession;
};

type Hold = { id: string; state: string; taskId?: string; capName: string; input?: unknown; createdAt?: number };

async function setUp(t: { after: (f: () => Promise<void>) => void }, tag: string) {
  const savedImage = process.env["VYRE_WORKSPACE_IMAGE"];
  process.env["VYRE_WORKSPACE_IMAGE"] = IMAGE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `vyre-hb-${tag}-`));
  const space = `spc_hb${tag}`;
  const d = await boot(dir, batching, undefined, {
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", space, "--space-name", "Personal", "--space-kind", "personal", "--role", "space,device"], {}, "1.2.3"),
    computersHomeIntervalMs: 300, workspaceIdleMs: 600_000,
  });
  const box = { name: "" };
  t.after(async () => {
    process.env["VYRE_WORKSPACE_IMAGE"] = savedImage ?? "";
    if (savedImage === undefined) delete process.env["VYRE_WORKSPACE_IMAGE"];
    await d.stop();
    if (box.name !== "") { await docker(["rm", "-f", box.name], 60_000); await docker(["volume", "rm", "-f", `${box.name}-home`, `${box.name}-files`], 60_000); }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Dana's Mac", deviceClass: "desktop" };
  assert.equal((await call(d, null, "identity.claim_owner", { code, spaceId: space, username: "dana", displayName: "Dana Reyes", password: PASSWORD, ...device, keys: KEYS })).status, 200);
  const token = ((await call(d, null, "identity.sign_in", { username: "dana", password: PASSWORD, ...device })).data.session as { token: string }).token;
  const unlock = await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 7).toString("base64") }) });
  assert.equal(unlock.status, 204);
  const folder = await ok(d, token, "vault.folders.create", { name: "Accounts", scope: "mine" });
  const flow = await ok(d, token, "providers.subscription_start", { providerKey: "claude-code" });
  await ok(d, token, "vault.item.put", { folderId: folder.folder.id, name: "Dana_Claude", kind: "ai_subscription", fields: [{ key: "setup_token", value: KEY, secret: true }] });
  await ok(d, token, "providers.subscription_complete", { flowId: flow.flowId });
  const agent = (await ok(d, token, "agents.create", { name: "Dex", role: "You help." })).agent.agentId as string;
  box.name = `vyre-ws-${agent}`;
  const threadId = (await ok(d, token, "chat.start", { kind: "chat", agentIds: [agent] })).thread.threadId as string;
  await ok(d, token, "threads.set_mode", { threadId, mode: "auto" });
  const said = async (): Promise<string[]> => { await d.hooks?.pump?.(); const m = ((await call(d, token, "chat.messages.list", { threadId })).data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined) ?? []; return m.filter((x) => x.author?.kind === "agent" && /RESULT|RESUMED/.test(x.body ?? "")).map((x) => x.body ?? ""); };
  const holds = async (): Promise<Hold[]> => { await d.hooks?.pump?.(); return ((await call(d, token, "gate.holds.list", { states: ["held", "approved", "denied", "expired"] })).data.holds ?? []) as Hold[]; };
  const post = (body: string) => ok(d, token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agent }] });
  const allow = async (h: Hold) => { const r = await call(d, token, "tasks.act", { taskId: h.taskId, action: "approve" }); assert.equal(r.status, 200, JSON.stringify(r.data)); };
  const runs = async (file: string): Promise<number> => Number((await docker(["exec", box.name, "sh", "-c", `cat /home/agent/${file} 2>/dev/null | wc -l`], 10_000)).out.trim().split("\n")[0]);
  return { d, token, said, holds, post, allow, runs, box };
}

const rmA = (key: string) => ({ command: "ls ~/a.txt; echo a >> ~/runs-a.log; rm -rf ~/a.txt; echo removed-a", idempotencyKey: key });
const rmB = (key: string) => ({ command: "ls ~/b.txt; echo b >> ~/runs-b.log; rm -rf ~/b.txt; echo removed-b", idempotencyKey: key });

async function shape(t: { after: (f: () => Promise<void>) => void }, tag: string, s: Script, o: { quick?: boolean; slowCloseMs?: number } = {}): Promise<{ log: string[] }> {
  const k = await setUp(t, tag);
  script.now = s; script.thenDone = false; script.sends = []; script.slowCloseMs = o.slowCloseMs ?? 0;
  await k.post(`BATCH ${tag}`);
  const log: string[] = [];
  const first = await waitFor(async () => (await k.holds()).find((h) => h.state === "held") ?? null, 120_000);
  if (!o.quick) await new Promise((r) => setTimeout(r, 3000));
  const before = await k.holds();
  log.push(`holds before Allow: ${JSON.stringify(before.map((h) => [h.capName, h.state, String(JSON.stringify(h.input) ?? "").slice(0, 60)]))}`);
  await k.allow(first);
  const t0 = Date.now();
  const outcome = await waitFor(async () => {
    const r = await k.said();
    const hs = await k.holds();
    const open = hs.filter((h) => h.state === "held" && h.id !== first.id);
    if (r.length > 0) return { kind: "resumed", text: r[r.length - 1]!, open };
    if (open.length > 0 && Date.now() - t0 > 5000) return { kind: "second-card", text: "", open };
    return null;
  }, 60_000).catch(() => ({ kind: "stuck", text: "", open: [] as Hold[] }));
  log.push(`after one Allow (${Date.now() - t0} ms): ${outcome.kind} ${outcome.text.slice(0, 200)} open=${outcome.open.length}`);
  log.push(`sends: ${script.sends.join(" | ")}`);
  log.push(`runs a=${await k.runs("runs-a.log")} b=${await k.runs("runs-b.log")}`);
  const after = await k.holds();
  log.push(`holds after: ${JSON.stringify(after.map((h) => [h.capName, h.state]))}`);
  for (const l of log) console.log(`[${tag}] ${l}`);
  (log as unknown as { outcome: typeof outcome; first: Hold; k: typeof k }).outcome = outcome;
  Object.assign(log, { outcome, first, k });
  return { log };
}

test("one step with the same dangerous command twice: one hold, one Allow resumes the turn, the command runs once", { skip, timeout: 600_000 }, async (t) => {
  const { log } = await shape(t, "same", { calls: [rmA("x1"), rmA("x2")] });
  const o = (log as unknown as { outcome: { kind: string; open: Hold[] } }).outcome;
  assert.equal(o.kind, "resumed", log.join("\n"));
  assert.equal(o.open.length, 0, log.join("\n"));
});

test("one step with two different dangerous commands: one Allow resumes the turn and no card is left open", { skip, timeout: 600_000 }, async (t) => {
  const { log } = await shape(t, "two", { calls: [rmA("y1"), rmB("y2")] });
  const o = (log as unknown as { outcome: { kind: string; open: Hold[] } }).outcome;
  assert.equal(o.kind, "resumed", log.join("\n"));
  assert.equal(o.open.length, 0, log.join("\n"));
});

test("after the first Allow the model asks for a second dangerous command: the first Allow resumed the turn, and the wait is only the new card", { skip, timeout: 600_000 }, async (t) => {
  const { log } = await shape(t, "then", { calls: [rmA("z1")], then: rmB("z2") });
  const o = (log as unknown as { outcome: { kind: string; open: Hold[] } }).outcome;
  // the resume happened (the stand-in was sent the answer) and then it made a new call that is held: a second card by design
  assert.ok(script.sends.some((s) => s.startsWith("resumed:terminal_run:true")), log.join("\n"));
  assert.equal(o.kind, "second-card", log.join("\n"));
});

test("Allow pressed while the parked turn is still letting its session go (a busy server): the turn resumes all the same", { skip, timeout: 600_000 }, async (t) => {
  const { log } = await shape(t, "race", { calls: [rmA("r1")] }, { quick: true, slowCloseMs: 4000 });
  const o = (log as unknown as { outcome: { kind: string; open: Hold[] } }).outcome;
  assert.equal(o.kind, "resumed", log.join("\n"));
  assert.equal(script.sends.filter((x) => x.startsWith("resumed:terminal_run:true")).length, 1, `resumed once: ${log.join("\n")}`);
  // engine.hold_answered sees the parked turn and does not also wake the agent with a held note (that wake is a send with no trigger)
  assert.equal(script.sends.filter((x) => x === "send:").length, 0, `no second wake: ${log.join("\n")}`);
  const runs = Number(/runs a=(\d+)/.exec(log.join("\n"))?.[1]);
  assert.equal(runs, 1, "the command ran once");
});
