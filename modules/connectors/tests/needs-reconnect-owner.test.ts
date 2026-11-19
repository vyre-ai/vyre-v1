// A connection that stops working must never fail without a word (lead, 19 Nov): the Needs you note goes to whoever owns it, else whoever applied its sync spec, else whoever made it, and when none of them can be told, to the Space's admins.
import test from "node:test";
import assert from "node:assert/strict";
import { ACME } from "../fixtures/acme.ts";
import { kit } from "../fixtures/kit.ts";
import type { Kit } from "../fixtures/kit.ts";

async function refused(k: Kit, o: { ownerKind?: "space" | "person" } = {}): Promise<string> {
  k.install(o.ownerKind === "person" ? { ...ACME, scope: "person" } : ACME);
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "acme",
    title: "Acme",
    ownerKind: o.ownerKind ?? "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  const id = made.connection.connectionId;
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "acme", action: "ping", connectionId: id, input: {} }));
  return id;
}
const assigned = (k: Kit): string[] =>
  k.calls
    .filter((c) => c.cap === "tasks.create")
    .map((c) => {
      const a = (c.input as { assigned: { kind: string; id: string } }).assigned;
      return `${a.kind}:${a.id}`;
    });

test("a Space connection with no sync spec tells the person who made it", async () => {
  const k = kit();
  await refused(k);
  assert.deepEqual(assigned(k), ["person:usr_dana"]);
});

test("a person's own connection tells them; a sync spec's applier comes before the maker", async () => {
  const mine = kit();
  await refused(mine, { ownerKind: "person" });
  assert.deepEqual(assigned(mine), ["person:usr_dana"]);
  const k = kit();
  k.install(ACME);
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  k.tx.run(
    "INSERT INTO cn_sync_specs (connector, spec, connection_id, applied_by, applied_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    "acme",
    "{}",
    made.connection.connectionId,
    "usr_lena",
    1,
    1,
  );
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(
    k.hs["connectors.run"](k.ctx, {
      key: "acme",
      action: "ping",
      connectionId: made.connection.connectionId,
      input: {},
    }),
  );
  assert.deepEqual(assigned(k), ["person:usr_lena"]);
});

test("when the person who made it is gone, the Space's admins are told; so they are when nobody is recorded", async () => {
  const gone = kit();
  gone.tasksGone.add("person:usr_dana");
  await refused(gone);
  assert.deepEqual(assigned(gone), ["person:usr_dana", "role:admin"]);
  const old = kit();
  old.install(ACME);
  const made = await old.hs["connections.create"](old.ctx, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  old.tx.run("DELETE FROM cn_connection_creators WHERE connection_id = ?", made.connection.connectionId);
  old.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(
    old.hs["connectors.run"](old.ctx, {
      key: "acme",
      action: "ping",
      connectionId: made.connection.connectionId,
      input: {},
    }),
  );
  assert.deepEqual(assigned(old), ["role:admin"]);
});

test("the state is on the connection's row, and says it once however many calls fail", async () => {
  const k = kit();
  const id = await refused(k);
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "acme", action: "ping", connectionId: id, input: {} }));
  assert.equal(assigned(k).length, 1, "one note");
  const row = (await k.hs["connections.get"](k.ctx, { connectionId: id } as never)).connection;
  assert.equal(row.state, "needs_reconnect");
});
