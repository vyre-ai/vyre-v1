// CRM to Records journeys, group 2 of 3 (shared parts in test/support/crm-journey-helpers.ts); each file finishes well inside the 120 s a test file may take.
import test from "node:test";
import assert from "node:assert/strict";
import { agentSaid, chatSetup, joinMember, ok, shots, startSpace, until, vaultItemOf, withHandle } from "./support/crm-journey-kit.ts";
import { OUT, afterPass, ledgerKnow, nameOf, openSync, rows, session, tapIn } from "./support/crm-journey-helpers.ts";
import { orbitSpec } from "../modules/connectors/fixtures/crm.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

test("journey 3, Team: an admin asks in chat, the app is told where to call, a call starts a pass at once, the types are open to people added only from the first moment", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page) => {
      // an admin asks in chat with the choice "people added only": the assistant makes the types for them, so it may narrow them, and the types are narrow from the first moment
      await chatSetup(s, (h) => ledgerKnow(h, { webhook: true, audience: "added" }));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      for (const type of ["person", "org"]) assert.equal((await ok(s, "access.shares_of", { resource: { type: "record_type", id: type } })).audience, "added", `${type} is open to people added only`);
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

