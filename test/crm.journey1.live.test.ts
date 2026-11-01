// CRM to Records journeys, group 1 of 3 (shared parts in test/support/crm-journey-helpers.ts); each file finishes well inside the 120 s a test file may take.
import test from "node:test";
import assert from "node:assert/strict";
import { agentSaid, chatSetup, joinMember, ok, shots, startSpace, until, vaultItemOf, withHandle } from "./support/crm-journey-kit.ts";
import { OUT, afterPass, ledgerKnow, nameOf, openSync, rows, session, tapIn } from "./support/crm-journey-helpers.ts";
import { orbitSpec } from "../modules/connectors/fixtures/crm.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

test("journey 1, Personal: the first hour. In chat the person asks for their CRM, the agent proposes, one tap brings it in, an edit goes back once", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      const pics = page ? shots(OUT, "1-personal-first-hour") : null;
      await chatSetup(s, (h) => ledgerKnow(h), "Ledger", tapIn(page, s, pics));
      await until("the agent applied it and the people arrived", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      assert.equal(s.model.plan, null, "the proposal was applied");
      assert.ok(s.crm.methods().every((m) => m === "GET"), "reading the app is all that happened before the first edit");
      assert.deepEqual((await rows(s, "org")).map(nameOf).sort(), ["North Works", "South Mill"]);
      const status = await ok(s, "sync_types.status", { type: "person" });
      assert.equal(status.records, 4);
      assert.equal(status.canBackfill, true, "the first pull left one person out and the page offers Bring in everything");
      assert.equal((await ok(s, "sync_specs.apply", { spec: (await ok(s, "sync_specs.get", { type: "person" })).spec, idempotencyKey: "j1-again" })).live, "polling", "a Personal computer has no public address: it polls");

      const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
      await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Called back" } });
      await afterPass(s, "person");
      await until("the app hears the edit", async () => s.crm.c.state.requests.some((r) => r.method === "PATCH"));
      assert.equal(s.crm.c.state.requests.filter((r) => r.method === "PATCH").length, 1);
      assert.equal((s.crm.c.state.people[0]!.attributes as any).note, "Called back");
      assert.ok(s.crm.c.state.requests.every((r) => r.method === "GET" || r.method === "PATCH"), "nothing but reads and the one edit travelled");
      if (page && pics) {
        await page.goto(`${s.web!.origin}/records`);
        await page.getByTestId("records-sidebar").waitFor();
        await pics.take(page, "records-sidebar-with-sync-dot");
        await openSync(s, page);
        assert.match(await page.getByTestId("sync-records-line").innerText(), /4/);
        await pics.take(page, "sync-page");
      }
    });
  } finally { await s.stop(); }
});

test("journey 2, Personal later: the app changes, the person is behind, both sides edit, the newest wins and the older value stays in the history", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      await chatSetup(s, (h) => ledgerKnow(h));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      const ben = s.crm.c.state.people.find((p) => p.attributes.full_name === "Ben Ford")!;
      ben.attributes.status = "client"; ben.modified = new Date().toISOString();
      s.crm.c.state.people.push({ id: 106, attributes: { full_name: "Fay Reed", email: "fay@example.test", phone: "", status: "lead", tier: "gold", note: "" }, org_id: null, modified: new Date().toISOString() });
      await afterPass(s, "person");
      await until("the poll brings Fay", async () => (await rows(s, "person")).some((r) => nameOf(r) === "Fay Reed"));
      const ada = (await rows(s, "person")).find((r) => nameOf(r) === "Ada Stone")!;
      s.crm.c.state.people[0]!.attributes.note = "App says"; s.crm.c.state.people[0]!.modified = new Date(Date.now() + 1000).toISOString();
      await ok(s, "records.update", { type: "person", recordId: ada.id, patch: { note: "Person says" } });
      await afterPass(s, "person");
      await until("the settlement is kept", async () => ((await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[]).length > 0);
      const history = (await ok(s, "sync_types.field_history", { type: "person", recordId: ada.id, field: "note" })).entries as any[];
      assert.ok(history.every((h) => ["app", "you", "push"].includes(h.replacedBy)));
      if (page) { const pics = shots(OUT, "2-personal-later"); await openSync(s, page); await pics.take(page, "sync-page-after-changes"); }
    });
  } finally { await s.stop(); }
});

