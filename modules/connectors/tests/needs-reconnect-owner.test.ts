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

test("a person who has left the Space, or is suspended, is skipped before any task is made; the next in the chain is tried, then the admins", async () => {
  const left = kit();
  left.people.left.add("usr_dana");
  await refused(left);
  assert.deepEqual(assigned(left), ["role:admin"], "no task was made for the person who left");
  const suspended = kit();
  suspended.people.suspended.add("usr_dana");
  await refused(suspended);
  assert.deepEqual(assigned(suspended), ["role:admin"]);
  // the maker is gone but the person who applied the sync spec is here
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
  k.people.left.add("usr_lena");
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(
    k.hs["connectors.run"](k.ctx, {
      key: "acme",
      action: "ping",
      connectionId: made.connection.connectionId,
      input: {},
    }),
  );
  assert.deepEqual(assigned(k), ["person:usr_dana"], "the applier left, the maker is still here");
});

test("a connection made by an agent with no person behind it, or by an Automation, records no maker, so the admins are told", async () => {
  const k = kit();
  k.install(ACME);
  const byAgent = { ...k.mk("agt_helper"), callerKind: "agent" } as typeof k.ctx;
  const made = await k.hs["connections.create"](byAgent, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  assert.equal(k.tx.all("SELECT * FROM cn_connection_creators").length, 0);
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(
    k.hs["connectors.run"](k.ctx, {
      key: "acme",
      action: "ping",
      connectionId: made.connection.connectionId,
      input: {},
    }),
  );
  assert.deepEqual(assigned(k), ["role:admin"]);
});

test("a task answer without an id does not make a second task for the admins", async () => {
  const k = kit();
  const call = k.ctx.call;
  k.ctx.call = async (cap, input) => (cap === "tasks.create" ? (void call(cap, input), {}) : call(cap, input));
  await refused(k);
  assert.equal(assigned(k).length, 1);
});

test("a connection an agent made on a person's behalf is credited to that person, who is the one told", async () => {
  const k = kit();
  k.install(ACME);
  // the actor is who the agent acts for, as the host gives it; the caller itself is an agent
  const onBehalf = { ...k.mk("usr_lena"), callerKind: "agent" } as typeof k.ctx;
  const made = await k.hs["connections.create"](onBehalf, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  assert.deepEqual(
    k.tx.all("SELECT created_by FROM cn_connection_creators WHERE connection_id = ?", made.connection.connectionId),
    [{ created_by: "usr_lena" }],
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
