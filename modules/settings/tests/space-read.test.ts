// Who may read a Space-wide setting: people, the Space's own agents, outside actors acting for a person, and the host service; not a tenant's automation service and not an actor acting for no one.
import test from "node:test";
import assert from "node:assert/strict";
import { codeOf, harness } from "../fixtures/db.ts";
import type { SettingsCtx } from "../handlers/index.ts";
import { handlers } from "../impl.ts";

const get = (ctx: SettingsCtx, key: string) => (handlers as unknown as Record<string, (c: SettingsCtx, i: unknown) => Promise<{ row: { value: unknown } }>>)["settings.get"]!(ctx, { key });
const as = (h: ReturnType<typeof harness>, principal: { kind: string; id: string }, actingFor?: string): SettingsCtx => ({ ...h.as("usr_dana"), principal, ...(actingFor ? { actingFor } : {}) }) as unknown as SettingsCtx;

test("a Space setting is readable by a person, an agent, the host service and an actor acting for a person; not by a tenant service or an actor for no one", async () => {
  const h = harness();
  const key = "memory.require_review";
  assert.equal((await get(as(h, { kind: "person", id: "usr_dana" }), key)).row.value, false);
  assert.equal((await get(as(h, { kind: "agent", id: "agt_intake" }, "usr_dana"), key)).row.value, false);
  assert.equal((await get(as(h, { kind: "agent", id: "agt_intake" }), key)).row.value, false);
  assert.equal((await get(as(h, { kind: "service", id: "svc_host" }), key)).row.value, false);
  assert.equal((await get(as(h, { kind: "actor", id: "act_outside" }, "usr_dana"), key)).row.value, false);
  for (const bad of [as(h, { kind: "service", id: "svc_tenant_automation" }), as(h, { kind: "actor", id: "act_outside" })]) {
    await assert.rejects(() => get(bad, key), (e) => codeOf(e) === "auth.unauthenticated");
  }
  // a person's own setting still needs the person
  await assert.rejects(() => get(as(h, { kind: "agent", id: "agt_intake" }, "usr_dana"), "profile.timezone"), (e) => codeOf(e) === "auth.unauthenticated");
});
