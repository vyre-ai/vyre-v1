// Review A1 (12 Nov): a call an agent makes without naming its computer is authorized on the Space; its audit row keeps the Space as its resource, so an admin's export keeps it, and says where the
// call really went (the agent's own browser, the asker's own Chrome, the agent's own computer). Here, beside host/tests/resource.self.test.ts, because it reads through the audit module.
import test from "node:test";
import assert from "node:assert/strict";
import { registry } from "../generated/registry.ts";
import { createInvoke, indexCapabilities } from "../host/src/invoke.ts";
import type { CtxSeed, InvokeDeps } from "../host/src/invoke.ts";
import type { CapabilityDef } from "../packages/contracts/src/types.ts";

function rig() {
  const audits: Array<{ resource: unknown; cap: string }> = [];
  const deps = {
    caps: indexCapabilities(registry.capabilities as unknown as CapabilityDef[]),
    validateInput: () => [],
    authorize: () => ({ effect: "allow", reason: "test", decisionId: "dec_t", steps: [] }),
    handler: () => async () => ({}),
    commit: async (b: { events: unknown[]; audit?: { resource: unknown; cap: string } | null }) => { if (b.audit) audits.push(b.audit); return b.events.map((e, i) => ({ ...(e as object), seq: i + 1 })); },
    audit: async (r: { resource: unknown; cap: string }) => { audits.push(r); },
    now: () => 1_000,
  } as unknown as InvokeDeps;
  return { invoke: createInvoke(deps), audits };
}
const inChat = (thread: string): CtxSeed => ({ space: "spc_1", principal: { kind: "agent", id: "agt_scout" }, actingFor: "usr_maya", thread, origin: "engine" } as CtxSeed);

test("A1: an admin's audit export keeps every self-bound act on the Space the kernel knows, and names whose browser, Chrome or computer it was", async () => {
  const { invoke, audits } = rig();
  const seed = { ...inChat("thr_e"), auditAll: true } as CtxSeed;
  await invoke("computers.chrome.open", { url: "https://www.harborquotes.com/" }, seed);
  await invoke("computers.chrome.snapshot", { inMyChrome: true }, seed);
  await invoke("computers.screen.screenshot", {}, seed);
  // the rows go through the live audit sink into the audit module, and out through audit.export as an admin, where a row stays only on a view allow for its resource
  const { harness } = await import("../modules/audit/fixtures/db.ts");
  const audit = await import("../modules/audit/impl.ts");
  const { createAuditRecorder } = await import("../host/src/seams/audit.ts");
  const h = harness();
  const admin = h.as("usr_admin");
  const record = createAuditRecorder({ space: "spc_1", db: admin.db as never, module: audit as unknown as Record<string, unknown>, principal: (id) => ({ kind: id.startsWith("agt_") ? "agent" : "person" }) });
  for (const a of audits) record(a as never);
  // the kernel's answer for an admin: the Space is theirs to see; anything it does not know is not found (as for browser_profile or agent_computer, which are no resources)
  const saved: string[] = [];
  const ctx = { ...admin, exports: { async save(_n: string, csv: string) { saved.push(csv); return "fil_x"; } }, authorize: (_a: unknown, r: { type: string }) => ({ effect: r.type === "space" ? "allow" : "deny", reason: "t", decisionId: "d" }) };
  await (audit.handlers as Record<string, (c: unknown, i: unknown) => Promise<unknown>>)["audit.export"]!(ctx, {});
  const lines = saved[0]!.trimEnd().split("\n");
  const row = (cap: string): string => lines.find((l) => l.includes(`,${cap},`)) ?? "";
  assert.match(row("computers.chrome.open"), /,space:spc_1,.*,browser:agt_scout$/, "the agent's own Space browser");
  assert.match(row("computers.chrome.snapshot"), /,space:spc_1,.*,chrome:usr_maya$/, "the asker's own Chrome");
  assert.match(row("computers.screen.screenshot"), /,space:spc_1,.*,computer:agt_scout$/, "the agent's own computer");
});
