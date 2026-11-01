// CRM to Records journeys, group 2 of 3 (shared parts in test/support/crm-journey-helpers.ts); each file finishes well inside the 120 s a test file may take.
import test from "node:test";
import assert from "node:assert/strict";
import { agentSaid, chatSetup, joinMember, ok, shots, startSpace, until, vaultItemOf, withHandle } from "./support/crm-journey-kit.ts";
import { OUT, afterPass, ledgerKnow, nameOf, openSync, rows, session, tapIn } from "./support/crm-journey-helpers.ts";
import { orbitSpec } from "../modules/connectors/fixtures/crm.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

test("journey 3, Team: an admin asks in chat, the app is told where to call, a call starts a pass at once, the person narrows who the types are open to", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page) => {
      const known = (h: string) => ledgerKnow(h, { webhook: true, audience: "added" });
      // the assistant holds edit, not the right to choose who a type is open to: the apply stops, says why, and brings in nothing (no fallback to the whole Space)
      const first = await chatSetup(s, known);
      await until("the agent says why", async () => /Nothing was brought in/.test(await agentSaid(s, first.threadId)), 60_000);
      assert.deepEqual(await rows(s, "person").catch(() => []), [], "no person was imported");
      assert.equal(s.crm.c.state.requests.filter((r) => r.path.startsWith("/api/v2/people")).length > 0, true, "the agent only read to propose");
      assert.ok(!(await ok(s, "sync_types.list", {})).syncedTypes.some((t: { type: string }) => t.type === "person"), "nothing was bound");
      assert.deepEqual(((await ok(s, "connectors.list", {})).connectors as { key: string }[]).filter((c) => c.key === "crm_ledger"), [], "no connector was left behind");
      assert.deepEqual((await ok(s, "connections.list", {})).connections, [], "no connection was left behind");
      assert.ok(!((await ok(s, "schema.describe", {})).types as { key: string }[]).some((t) => t.key === "person" || t.key === "org"), "no record type was left behind");
      // the person themself (an admin who can manage the types) brings it in with the same choice: the types are open to people added from the first moment, before anyone is imported
      const { ledgerSpec } = await import("../modules/connectors/fixtures/crm.ts");
      const spec = withHandle(ledgerSpec(), first.item.handle) as { objects: { remote: string; webhook?: unknown }[]; plan: Record<string, unknown> };
      spec.objects.find((o) => o.remote === "people")!.webhook = { events: ["person.updated"], subscribePath: "/api/v2/webhooks", evidence: "https://docs.crm-a.test/webhooks" };
      spec.plan["audience"] = "added";
      await ok(s, "sync_specs.apply", { spec, idempotencyKey: "j3-person-apply" });
      assert.equal((await ok(s, "access.shares_of", { resource: { type: "record_type", id: "person" } })).audience, "added");
      assert.equal((await ok(s, "access.shares_of", { resource: { type: "record_type", id: "org" } })).audience, "added");
      assert.deepEqual(await rows(s, "person").catch(() => []), [], "set before anyone was imported");
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      // telling the app where to call is a write to it, so the first pass a person runs makes the call (the agent's own passes would only wait at the Gate)
      await afterPass(s, "person");
      await until("the Space registered its address with the app", async () => s.crm.c.state.webhooks.length >= 1);
      const hook = new URL(s.crm.c.state.webhooks[0]!.url);
      assert.match(hook.origin, /^https:\/\/firm\.example$/);
      // the app says someone changed; the Space starts a pass without waiting for the next poll
      s.crm.c.state.people.push({ id: 107, attributes: { full_name: "Gil Hart", email: "gil@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
      const res = await fetch(`${s.d.url}${hook.pathname}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "updated" }) });
      assert.ok(res.status < 300, `the hook answered ${res.status}`);
      await until("the webhook pass brings Gil", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Gil Hart"));
      assert.ok(s.crm.methods().every((m) => m === "GET" || m === "POST"), "the pull only reads; the one POST is the hook registration");
      if (page) { const pics = shots(OUT, "3-team-webhook"); await openSync(s, page); await pics.take(page, "sync-page-live"); }
    });
  } finally { await s.stop(); }
});

test("journey 4, Team with several locations: each location is its own account of one type, brought in by chat, every record says where it came from", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page) => {
      const first = await chatSetup(s, (h) => ledgerKnow(h, { account: "Main" }));
      await until("Main arrives", async () => (await rows(s, "person").catch(() => [])).some((r) => nameOf(r) === "Ed Park"), 90_000);
      // the second location: another key, another tenant of the same app, asked for the same way
      const { bringInByChat, trustAssistant } = await import("./support/crm-journey-kit.ts");
      const paris = await vaultItemOf(s, "Ledger", " Paris");
      await trustAssistant(s, paris.id, first.agentId);
      await bringInByChat(s, first.agentId, ledgerKnow(paris.handle, { account: "Paris", tenant: "b" }), paris);
      await until("Paris arrives", async () => (await rows(s, "person").catch(() => [])).some((r) => nameOf(r) === "Gus Hale"), 90_000);
      const people = await rows(s, "person");
      assert.deepEqual([...new Set(people.map((r) => String(r.data?.from ?? r.fields?.from)))].sort(), ["Main", "Paris"]);
      assert.equal((await ok(s, "sync_types.status", { type: "person" })).accounts.length, 2);
      if (page) { const pics = shots(OUT, "4-team-accounts"); await openSync(s, page); await pics.take(page, "sync-page-two-accounts"); }
    });
  } finally { await s.stop(); }
});

