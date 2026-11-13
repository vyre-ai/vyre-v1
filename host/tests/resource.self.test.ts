// The self binding (f-wire, 12 Nov): the chrome, screen and files tools name a computer, or an agent leaves it out to mean its own computer or its own Space browser. Before, the binding refused
// every call that left it out, so an agent with no old desktop could not browse at all; a person must still name the computer, and a named one is still that computer.
import test from "node:test";
import assert from "node:assert/strict";
import { BindingError, resolveResource } from "../src/routes/resource.ts";
import { registry } from "../../generated/registry.ts";

const self = { resource: { type: "computer", id: "/computerId", self: "agent" } } as never;
const plain = { resource: { type: "computer", id: "/computerId" } } as never;

test("an agent that leaves the computer out is bound to the Space (its own things); a person is refused; a named computer is that computer", () => {
  assert.deepEqual(resolveResource(self, {}, "spc_1", undefined, { kind: "agent" }), { type: "space", id: "spc_1" });
  assert.throws(
    () => resolveResource(self, {}, "spc_1", undefined, { kind: "person" }),
    BindingError,
    "a person names the computer",
  );
  assert.throws(() => resolveResource(self, {}, "spc_1"), BindingError, "no caller, no self");
  assert.deepEqual(
    resolveResource(self, { computerId: "cmt_7" }, "spc_1", undefined, { kind: "agent" }),
    { type: "computer", id: "cmt_7" },
    "a named computer is checked as that computer, never weaker",
  );
  assert.throws(
    () => resolveResource(plain, {}, "spc_1", undefined, { kind: "agent" }),
    BindingError,
    "a binding without self is unchanged",
  );
});

test("every chrome tool, and every computer tool whose computerId is optional, carries the self binding", () => {
  type Cap = {
    name: string;
    resource: { type: string; id?: string; self?: string };
    input: { required?: string[]; $ref?: string };
    surfaces: { mcp?: { name?: string } };
  };
  const caps = registry.capabilities as unknown as Cap[];
  const chrome = caps.filter((c) => c.surfaces.mcp?.name?.startsWith("chrome_"));
  assert.ok(chrome.length >= 20);
  for (const c of chrome) assert.equal(c.resource.self, "agent", c.name);
  const defs = (registry as unknown as { $defs: Record<string, { required?: string[]; $ref?: string }> }).$defs;
  const inputOf = (i: { required?: string[]; $ref?: string }): { required?: string[] } =>
    i.$ref ? inputOf(defs[i.$ref.split("/").pop()!]!) : i;
  const optional = caps.filter(
    (x) =>
      x.resource.type === "computer" &&
      x.resource.id === "/computerId" &&
      x.surfaces.mcp !== undefined &&
      !(inputOf(x.input).required ?? []).includes("computerId"),
  );
  assert.ok(optional.length >= 35, `found the tools that may leave the computer out (${optional.length})`);
  for (const c of optional) assert.equal(c.resource.self, "agent", c.name);
});

// ---- review S1, S3, S4 (12 Nov): what a self-bound call is noted and audited as, and the plain refusal for a person

import { createInvoke, indexCapabilities } from "../src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../src/invoke.ts";
import { HostError } from "../src/routes/errors.ts";
import { takeReads } from "../src/seams/answer-reads.ts";
import { OUTSIDE_AGENT_LINE, SELF_BINDING_LINE } from "../src/routes/resource.ts";
import type { CapabilityDef } from "../../packages/contracts/src/types.ts";

function rig() {
  const audits: Array<{ resource: unknown; cap: string }> = [];
  const deps = {
    caps: indexCapabilities(registry.capabilities as unknown as CapabilityDef[]),
    validateInput: () => [],
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_t", steps: [] }),
    handler: () => async () => ({}),
    commit: async (b: { events: unknown[]; audit?: { resource: unknown; cap: string } | null }) => {
      if (b.audit) audits.push(b.audit);
      return b.events.map((e, i) => ({ ...(e as object), seq: i + 1 }));
    },
    audit: async (r: { resource: unknown; cap: string }) => {
      audits.push(r);
    },
    now: () => 1_000,
  } as unknown as InvokeDeps;
  return { invoke: createInvoke(deps), audits };
}
const inChat = (thread: string): CtxSeed =>
  ({
    space: "spc_1",
    principal: { kind: "agent", id: "agt_scout" },
    actingFor: "usr_maya",
    thread,
    origin: "engine",
  }) as CtxSeed;

test("S1: a self-bound read is noted as what it reaches, never as the Space: the person's own Chrome, the agent's own browser profile, or unknown", async () => {
  const { invoke } = rig();
  await invoke("computers.chrome.snapshot", { inMyChrome: true }, inChat("thr_a"));
  assert.deepEqual(
    takeReads("thr_a", "agt_scout", "usr_maya"),
    [{ type: "computer", id: "my-chrome" }],
    "the person's own Chrome: only the asker may see what came from it",
  );
  await invoke("computers.chrome.snapshot", {}, inChat("thr_b"));
  assert.deepEqual(
    takeReads("thr_b", "agt_scout", "usr_maya"),
    [{ type: "browser_profile", id: "agt_scout" }],
    "the agent's own Space browser profile",
  );
  await invoke("computers.screen.screenshot", {}, inChat("thr_c"));
  assert.deepEqual(
    takeReads("thr_c", "agt_scout", "usr_maya"),
    [{ type: "*", id: null }],
    "the agent's own computer, not known at the gateway: unknown, which never shares",
  );
  await invoke("computers.chrome.snapshot", { computerId: "cmt_7" }, inChat("thr_d"));
  assert.deepEqual(
    takeReads("thr_d", "agt_scout", "usr_maya"),
    [{ type: "computer", id: "cmt_7" }],
    "a named computer is noted as before",
  );
});

test("S3: a person (or an outside agent's call rerun as its person) who leaves the computer out is told plainly what to pass", async () => {
  const { invoke } = rig();
  await assert.rejects(
    invoke("computers.chrome.snapshot", {}, {
      space: "spc_1",
      principal: { kind: "person", id: "usr_maya" },
      origin: "http",
    } as CtxSeed),
    (e: unknown) => e instanceof HostError && e.error.message === SELF_BINDING_LINE,
  );
  // an outside agent with the setup grant runs as its person: the same plain line, never "/computerId: the id is missing" alone
  await assert.rejects(
    invoke("computers.chrome.snapshot", {}, {
      space: "spc_1",
      principal: { kind: "agent", id: "agt_outside" },
      actingFor: "usr_maya",
      askPerson: "always",
      setupGrant: true,
      origin: "mcp",
    } as CtxSeed),
    (e: unknown) => e instanceof HostError && e.error.message === OUTSIDE_AGENT_LINE,
  );
});
