// Every agent tool can be called with only its required inputs (f-wire, 12 Nov). The chrome tools' resource binding pointed at an optional computerId, so the gateway refused every call that
// left it out before any handler ran ("/computerId: the id is missing"), and no agent without an old desktop could browse. This calls each capability that has an MCP tool through the same
// invoke the engine's tool calls go through, as an agent, with its required inputs only, and fails when the refusal names a field the contract does not require.
import test from "node:test";
import assert from "node:assert/strict";
import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import { registry } from "../../generated/registry.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

type Schema = { $ref?: string; properties?: Record<string, unknown>; required?: string[] };
const defs = (registry as unknown as { $defs: Record<string, Schema> }).$defs;
const resolve = (s: Schema): Schema => { let x = s; while (x.$ref) x = defs[x.$ref.split("/").pop()!]!; return x; };
const caps = registry.capabilities as unknown as CapabilityDef[];
const tools = caps.filter((c) => (c.surfaces as { mcp?: unknown }).mcp !== undefined);

/** The capability's own first example, kept to its required fields: what an agent that sends only what it must would send. */
function requiredOnly(c: CapabilityDef): Record<string, unknown> {
  const ex = (c.examples[0]?.input ?? {}) as Record<string, unknown>;
  const need = resolve(c.input as Schema).required ?? [];
  return Object.fromEntries(Object.entries(ex).filter(([k]) => need.includes(k)));
}

test("every agent tool reaches its handler with only its required inputs: no refusal names a field the contract does not require", async () => {
  assert.ok(tools.length > 300, `found the agent tools (${tools.length})`);
  const reached = new Set<string>();
  const deps: InvokeDeps = {
    caps: indexCapabilities(caps),
    validateInput: () => [],
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_test" }) as never,
    handler: (name) => async () => { reached.add(name); return {}; },
    commit: async (b) => b.events.map((e, i) => ({ ...e, seq: i + 1 })),
    now: () => 1_000,
  } as InvokeDeps;
  const invoke = createInvoke(deps);
  const seed: CtxSeed = { space: "spc_1", principal: { kind: "agent", id: "agt_scout" }, origin: "engine" } as CtxSeed;
  const bad: string[] = [];
  for (const c of tools) {
    const input = requiredOnly(c);
    if ((resolve(c.input as Schema).required ?? []).includes("idempotencyKey")) input["idempotencyKey"] = `k-${c.name}`;
    try { await invoke(c.name, input, seed); }
    catch (e) {
      const details = e instanceof HostError ? (e.error.details as { errors?: string[] } | undefined) : undefined;
      for (const line of details?.errors ?? []) {
        const field = /^\/([A-Za-z0-9_]+)/.exec(line)?.[1];
        if (field && !(resolve(c.input as Schema).required ?? []).includes(field)) bad.push(`${c.name}: ${line}`);
      }
    }
  }
  assert.deepEqual(bad, [], "a tool refused for a field its contract says it may leave out can never be called that way");
  assert.ok(reached.has("computers.chrome.open"), "chrome_open with only a url reaches its handler");
});
