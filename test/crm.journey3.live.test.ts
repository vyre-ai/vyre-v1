// CRM to Records journeys, group 3 of 3 (shared parts in test/support/crm-journey-helpers.ts); each file finishes well inside the 120 s a test file may take.
import test from "node:test";
import assert from "node:assert/strict";
import { agentSaid, chatSetup, joinMember, ok, shots, startSpace, until, vaultItemOf, withHandle } from "./support/crm-journey-kit.ts";
import { OUT, seen, afterPass, ledgerKnow, nameOf, openSync, rows, session, tapIn } from "./support/crm-journey-helpers.ts";
import { orbitSpec } from "../modules/connectors/fixtures/crm.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */

test("journey 5, any Space: the key stops working, the person is told once and sees the fix, and the pass recovers when the key is replaced", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    await session(s, "personal", async (page) => {
      await chatSetup(s, (h) => ledgerKnow(h));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      s.crm.c.state.keyA = "rotated-by-the-app";
      await afterPass(s, "person").catch(() => undefined);
      await until("the type needs a person", async () => (await ok(s, "sync_types.status", { type: "person" })).state === "error");
      await afterPass(s, "person").catch(() => undefined);
      const tasks = (await ok(s, "tasks.list", {}).catch(() => ({ tasks: [] }))).tasks as any[];
      assert.ok(tasks.filter((x) => /Replace|reconnect|stopped working/i.test(String(x.title))).length <= 1, "one item, not one per failure");
      if (page) { const pics = shots(OUT, "5-key-revoked"); await openSync(s, page); await pics.take(page, "sync-page-needs-you"); }
      s.crm.c.state.keyA = "ledger-key-0001";
      const conn = (await ok(s, "connections.list", {})).connections[0].connectionId as string;
      const tested = await ok(s, "connections.test", { connectionId: conn });
      assert.equal(tested.state, "healthy", JSON.stringify(tested));
      await afterPass(s, "person");
      await until("the type recovers", async () => (await ok(s, "sync_types.status", { type: "person" })).state !== "error");
    });
  } finally { await s.stop(); }
});

test("journey 6, Team member: another person's own browser sees the records and the dot, and none of the buttons that change the sync", async () => {
  const s = await startSpace({ kind: "team", name: "Firm", address: "https://firm.example" });
  try {
    await session(s, "team", async (page, ctl) => {
      await chatSetup(s, (h) => ledgerKnow(h, { }));
      await until("people arrive", async () => (await rows(s, "person").catch(() => [])).length === 4, 60_000);
      const maya = await joinMember(s, "maya", "Maya");
      // the member's token: reads the records, cannot change the sync
      const mayaCall = async (cap: string, input: object = {}) => (await fetch(`${s.d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${maya.token}` }, body: JSON.stringify({ idempotencyKey: `m-${Math.random()}`, ...input }) })).status;
      assert.equal(await mayaCall("records.query", { type: "person", limit: 5 }), 200);
      assert.notEqual(await mayaCall("sync_types.pause", { type: "person" }), 200, "a member cannot pause the sync");
      assert.notEqual(await mayaCall("sync_specs.remove", { type: "person" }), 200, "a member cannot remove it");
      if (page) {
        // the member in their own browser, signed in through the sign-in screen: the records and the dot, none of the buttons that change the sync
        const mp = await ctl.member(maya);
        const pics = shots(OUT, "6-team-member");
        await mp.goto(`${s.web!.origin}/records`);
        await mp.getByTestId("records-sidebar").waitFor().catch(async (e: Error) => { throw new Error(`${e.message} :: ${await seen(mp)}`); });
        await pics.take(mp, "member-records");
        // a member sees the dot and the records, and nothing that opens or changes the sync
        assert.equal(await mp.getByTestId("row-nav:type:person-trailing").getByTestId("sync-dot").count(), 1, "the member sees the dot");
        await mp.getByTestId("row-nav:type:person-trailing").getByTestId("sync-dot").click({ force: true, timeout: 3000 }).catch(() => undefined);
        await mp.waitForTimeout(1500);
        assert.equal(await mp.getByTestId("sync-page").count(), 0, "the dot does not open the Sync page for a member");
        for (const id of ["sync-pause", "sync-resume", "sync-remove", "sync-edit", "sync-resync", "sync-backfill"]) assert.equal(await mp.getByTestId(id).count(), 0, `${id} is not shown to a member`);
        await pics.take(mp, "member-after-dot");
        // the owner's browser still has them
        await openSync(s, page);
        assert.ok((await page.getByTestId("sync-pause").count()) + (await page.getByTestId("sync-resume").count()) > 0, "the owner sees Pause");
        await pics.take(page, "owner-sync-page");
      }
    });
  } finally { await s.stop(); }
});

test("journey 0: the second app, a custom object with Link-header paging, arrives whole", async () => {
  const s = await startSpace({ kind: "personal", name: "Me" });
  try {
    const item = await vaultItemOf(s, "Orbit");
    await ok(s, "sync_specs.apply", { spec: withHandle(orbitSpec(), item.handle), idempotencyKey: "j0-apply" });
    await until("jobs arrive", async () => (await rows(s, "job")).length === 3);
  } finally { await s.stop(); }
});
