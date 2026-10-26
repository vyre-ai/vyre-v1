// The removal wizard's host calls (<module>.owned_by, <module>.reassign_owned) are reachable only from the host's own hook call, which members.remove and members.remove_preview make as the admin doing the
// removal (P-L7_21). Another module's ctx.call, a gateway call and an MCP call are refused; the capability that carries them needs members.remove; and no registry route or tool names them.
// @reads /generated/registry.json
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GUARDED_CALL, GUARDED_CALL_PERMISSION, createHookRunner } from "../src/daemon/consumers.ts";
import type { ModuleHooks } from "../src/daemon/consumers.ts";
import type { CtxSeed, Invoke } from "../src/invoke.ts";

const TRACE = "0123456789abcdef0123456789abcdef";
const touched: string[] = [];
const hooks: ModuleHooks[] = [{
  module: "files", consumers: [], periodic: [], calls: [
    { name: "files.owned_by", module: "files", run: () => { touched.push("owned_by"); return { files: { count: 0, sample: [], ids: [] } }; } },
    { name: "files.reassign_owned", module: "files", run: () => { touched.push("reassign_owned"); return 3; } },
    { name: "chat.attention", module: "files", run: () => { touched.push("attention"); return 4; } },
  ],
}];

function rig() {
  touched.length = 0;
  const holder: { runner?: ReturnType<typeof createHookRunner> } = {};
  // a pipeline that runs the runner's handler with a ctx built from the seed, the way the real one does
  const invoke: Invoke = (async (cap: string, input: unknown, seed: CtxSeed) => {
    const h = holder.runner!.handlers[cap]!;
    const ctx = { origin: seed.origin ?? "user", depth: seed.depth ?? 0, trace: { traceId: TRACE }, principal: seed.principal };
    return { status: "ok", output: await h(ctx as never, input as never), traceId: TRACE };
  }) as unknown as Invoke;
  holder.runner = createHookRunner({
    space: "spc_t", now: () => 1, db: { all: () => [], run: () => ({ changes: 0 }) }, log: { read: async () => [], currentHead: async () => ({ seq: 0 }) },
    hooks, invoke, emitsOf: () => [], capOf: () => undefined, warn: () => undefined,
  } as never);
  return { runner: holder.runner, invoke };
}
const code = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

test("the capability behind each guarded call needs members.remove; an unguarded host call needs nothing", () => {
  const { runner } = rig();
  const perm = (n: string): string | null | undefined => runner.caps.find((c) => c.name === `host.hook.call.${n}`)?.permission;
  assert.equal(GUARDED_CALL_PERMISSION, "members.remove");
  assert.equal(perm("files.owned_by"), "members.remove");
  assert.equal(perm("files.reassign_owned"), "members.remove");
  assert.equal(perm("chat.attention"), null);
});

test("the host's own hook call, as the admin, runs them; another module's ctx.call, a gateway call and an MCP call are refused and touch nothing", async () => {
  const { runner, invoke } = rig();
  const admin = { kind: "person" as const, id: "usr_admin" };
  assert.equal(await runner.call("files.reassign_owned", { person: "usr_pat" }, { principal: admin }), 3);
  assert.deepEqual(touched, ["reassign_owned"]);

  touched.length = 0;
  const cap = "host.hook.call.files.reassign_owned";
  for (const [why, seed] of [
    ["another module's ctx.call (nested, depth 1) under the host's own hook origin", { origin: "hook", depth: 1 }],
    ["another module's ctx.call under a user's call", { origin: "user", depth: 1 }],
    ["a gateway call (origin user, top level)", { origin: "user", depth: 0 }],
    ["an MCP call", { origin: "mcp", depth: 0 }],
    ["an agent's call", { origin: "agent", depth: 0 }],
  ] as const) {
    await assert.rejects(invoke(cap as never, { input: { person: "usr_pat", kind: "files", action: "reassign", to: "usr_admin" } }, { space: "spc_t", principal: admin, ...seed } as CtxSeed), (e) => code(e) === "permission.no_grant", why);
    await assert.rejects(invoke("host.hook.call.files.owned_by" as never, { input: { person: "usr_pat" } }, { space: "spc_t", principal: admin, ...seed } as CtxSeed), (e) => code(e) === "permission.no_grant", `${why} (owned_by)`);
  }
  assert.deepEqual(touched, [], "none of them ran");
  assert.equal(await runner.call("chat.attention", {}, { principal: admin }), 4, "an unguarded host call keeps working");
});

test("no registry route or tool names a host call: nothing reaches them through the gateway or MCP", () => {
  const reg = JSON.parse(readFileSync(new URL("../../generated/registry.json", import.meta.url), "utf8")) as { capabilities: Array<{ name: string }>; routes?: Array<{ cap: string }> };
  assert.equal(reg.capabilities.some((c) => c.name.startsWith("host.hook.")), false);
  assert.equal((reg.routes ?? []).some((r) => r.cap.startsWith("host.hook.")), false);
  assert.equal(GUARDED_CALL.test("chat.owned_by") && GUARDED_CALL.test("mail.reassign_owned") && !GUARDED_CALL.test("tasks.attention"), true);
});
