// The read gate in the pipeline (Redaction for AI): every call an agent is behind hands back the redacted rendition of a file, or a refusal, whoever the call runs as. One leak per test, each
// failing without the gate: an agent's own read, the engine reading context as the person, a setup-grant call rerun as the person, an outside actor, the agent's computer, a nested read whose
// outer answer reaches the model, the copy that would carry a file out of its folder, and the gate failing closed. The files half is the real module over sqlite.
// @reads /host/src/seams/agent-read.ts
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AccessSnapshot, authorize } from "../kernel/src/authorize/index.ts";
import { createInvoke, indexCapabilities } from "../host/src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../host/src/invoke.ts";
import { createAgentGate, gated } from "../host/src/seams/agent-read.ts";
import type { CapabilityDef } from "../packages/contracts/src/types.ts";
import { agentGate } from "../modules/files/handlers/redact.ts";
import { redactWorld, INTAKE, SECRETS } from "../modules/files/fixtures/redact-world.ts";

const cap = (name: string, effects: "read" | "write"): CapabilityDef => ({
  v: 1, name, summary: "s", input: { type: "object" }, output: { type: "object" }, errors: [], resource: { type: "space" }, permission: null, level: "view",
  risk: "low", effects, emits: [], idempotency: "natural", surfaces: {}, examples: [],
} as unknown as CapabilityDef);

async function world(o: { gateDown?: boolean } = {}) {
  const w = redactWorld(new DatabaseSync(":memory:"));
  const r = await w.roots();
  const claim = await w.folder(r["projects"]!, "Rivera injury claim");
  const intake = await w.file(claim, "Rivera intake form.txt", INTAKE);
  const waiting = await w.file(claim, "Rivera retainer.txt", "Retainer with Elena Rivera.");
  await w.call(w.irfad, "files.agent_access.set", { target: { type: "folder", id: claim }, value: "redact" });
  for (const s of SECRETS) await w.call(w.irfad, "files.marks.add", { target: { type: "file", id: intake }, kind: "redact", shape: "span", text: s });
  await w.call(w.irfad, "files.review", { fileId: intake });

  const s = new AccessSnapshot();
  s.putPrincipal({ id: "usr_irfad", kind: "person", status: "active", name: "Irfad" });
  s.putPrincipal({ id: "agt_intake", kind: "agent", status: "active", name: "Intake", owner: "usr_irfad" } as never);
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: "usr_irfad", holds: 0 });
  const hostCtx = w.ctxFor({ kind: "service", id: "svc_host" });
  const asked: string[] = [];
  const gate = createAgentGate({ call: async (n, i) => { asked.push(n); if (o.gateDown) throw new Error("files module is restarting"); if (n === "files.agent_gate") return agentGate(hostCtx, i); return { fileId: null, folderId: null }; } });
  let invoke!: ReturnType<typeof createInvoke>;
  const deps: InvokeDeps = {
    caps: indexCapabilities([cap("files.read", "read"), cap("previews.text", "read"), cap("files.copy", "write"), cap("chat.read", "read")]),
    validateInput: () => [],
    authorize: () => ({ effect: "allow", reason: "ok", decisionId: "dec_1", steps: [], obligations: [] }) as never,
    handler: (name) => {
      if (name === "files.read") return async (_ctx, input) => w.call(w.irfad, "files.read", input);   // the module answers the original: the gate is all that stands between it and a model
      if (name === "previews.text") return async (ctx, input) => ({ text: ((await ctx.call("files.read" as never, { ...(input as object), as: "text" })) as { text: string }).text, pages: 1 });
      if (name === "files.copy") return async () => ({ file: { fileId: "fil_copy" } });
      return async () => ({ messages: ["Elena Rivera wrote in"] });
    },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    publish: () => {},
    now: () => 1_000,
    agentGate: gate,
  };
  void s; void authorize;
  invoke = createInvoke(deps);
  const read = async (seed: Omit<CtxSeed, "space">, fileId = intake) => invoke("files.read", { fileId, as: "text" }, { space: "spc_1", ...seed } as CtxSeed);
  return { w, invoke, read, intake, waiting, asked };
}
const text = (r: { status: string; output?: unknown }): string => JSON.stringify(r);
const noSecret = (r: unknown) => { const s = JSON.stringify(r); for (const x of SECRETS) assert.ok(!s.includes(x), `${x} leaked: ${s.slice(0, 200)}`); };

test("a person on their own screen reads the original; nothing is asked of the gate", async () => {
  const x = await world();
  const r = await x.read({ principal: { kind: "person", id: "usr_irfad" }, origin: "api" });
  assert.match(text(r), /512-44-8391/);
  assert.deepEqual(x.asked, []);
  x.w.done();
});

test("each way an agent can be behind a read gets the redacted rendition", async () => {
  const x = await world();
  const ways: [string, Omit<CtxSeed, "space">][] = [
    ["the agent itself", { principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "agent" }],
    ["the engine reading context as the person", { principal: { kind: "person", id: "usr_irfad" }, origin: "engine" }],
    ["a setup-grant call rerun as the person", { principal: { kind: "person", id: "usr_irfad" }, origin: "api", forAgent: "agt_claude" }],
    ["the MCP door", { principal: { kind: "person", id: "usr_irfad" }, origin: "mcp" }],
    ["an outside API actor", { principal: { kind: "actor", id: "act_robot" }, origin: "api" }],
    ["the agent's computer mirror", { principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "computers" }],
    ["the email helper", { principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "email-ask" }],
  ];
  for (const [what, seed] of ways) {
    const r = await x.read(seed);
    assert.equal(r.status, "ok", what);
    noSecret(r);
    assert.match(text(r), /\[REDACTED\]/, what);
  }
  x.w.done();
});

test("a nested read whose outer answer reaches the model is gated on the way out", async () => {
  const x = await world();
  const r = await x.invoke("previews.text", { fileId: x.intake }, { space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "agent" });
  noSecret(r);
  x.w.done();
});

test("a file waiting for review is refused to an agent and a person is asked; a copy out of the folder is refused before it runs", async () => {
  const x = await world();
  await assert.rejects(() => x.read({ principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", thread: "thr_1", origin: "agent" }, x.waiting), (e: unknown) => {
    const err = (e as { error?: { code?: string; details?: { reason?: string } } }).error;
    return err?.code === "permission.needs_approval" && err.details?.reason === "needs_review";
  });
  assert.ok(x.w.events.some((e) => e.name === "file.redact_requested" && e.payload.fileId === x.waiting && e.payload.threadId === "thr_1"));
  await assert.rejects(() => x.invoke("files.copy", { fileId: x.intake, toFolderId: "fld_x" }, { space: "spc_1", principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "agent" }),
    (e: unknown) => (e as { error?: { details?: { reason?: string } } }).error?.details?.reason === "redacted_file");
  x.w.done();
});

test("the gate fails closed: when it cannot answer, an agent gets nothing", async () => {
  const x = await world({ gateDown: true });
  await assert.rejects(() => x.read({ principal: { kind: "agent", id: "agt_intake" }, actingFor: "usr_irfad", origin: "agent" }), (e: unknown) => (e as { error?: { code?: string } }).error?.code === "internal.unavailable");
  x.w.done();
});

test("which calls pass through the gate", () => {
  for (const c of ["files.read", "files.list", "sheets.read_rows", "previews.text", "changesets.diff", "search.query", "memory.search", "git.diff", "mounts.browse"]) assert.ok(gated(c, "read"), c);
  for (const c of ["google.docs.get_document", "ms.drive.download_item", "mounts.engine_folders"]) assert.ok(gated(c, "write"), c);
  for (const c of ["chat.read", "files.write"]) assert.ok(!gated(c, c === "files.write" ? "write" : "read"), c);
});
