// A connection that stops working reaches the Space's admins through the real tasks module (no stand-in for it): the task is made for the admin role, an admin has it in Needs you, and nobody else does.
import test from "node:test";
import assert from "node:assert/strict";
import { ACME } from "../modules/connectors/fixtures/acme.ts";
import { kit } from "../modules/connectors/fixtures/kit.ts";
import { harness as tasksHarness } from "../modules/tasks/fixtures/db.ts";

const ADMIN = "usr_admin";
const MEMBER = "usr_member";

test("the admin path: a connection with nobody to tell raises a real task for the admin role, which shows in an admin's Needs you and in no one else's", async () => {
  const tasks = tasksHarness({ authorize: (who) => who.id === ADMIN });
  const k = kit();
  // the connectors module's tasks.create goes to the real tasks module
  const around = k.ctx.call;
  k.ctx.call = async (cap, input) =>
    cap === "tasks.create"
      ? tasks.call("tasks.create", input, { id: "usr_dana", kind: "person" } as never)
      : around(cap, input);
  k.install(ACME);
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  const id = made.connection.connectionId;
  // an older connection: nobody is recorded as having made it
  k.tx.run("DELETE FROM cn_connection_creators WHERE connection_id = ?", id);
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(k.hs["connectors.run"](k.ctx, { key: "acme", action: "ping", connectionId: id, input: {} }));
  assert.equal(
    (await tasks.call("tasks.count_needs_you", {}, { id: ADMIN, kind: "person" } as never)).count,
    1,
    "an admin sees it",
  );
  assert.equal(
    (await tasks.call("tasks.count_needs_you", {}, { id: MEMBER, kind: "person" } as never)).count,
    0,
    "a member does not",
  );
  const listed = (await tasks.call("tasks.list", { scope: "mine" }, { id: ADMIN, kind: "person" } as never)) as {
    tasks: { title: string; assigned: { kind: string; id: string } }[];
  };
  const row = listed.tasks.find((t) => /key stopped working/.test(t.title));
  assert.ok(row, JSON.stringify(listed).slice(0, 300));
  assert.deepEqual(row.assigned, { kind: "role", id: "admin" });
});

test("a maker who has left the Space is skipped: through the real tasks module the admin gets the task and the removed member gets nothing", async () => {
  const tasks = tasksHarness({ authorize: (who) => who.id === ADMIN });
  const k = kit();
  k.people.left.add("usr_dana");
  const around = k.ctx.call;
  const seen: string[] = [];
  k.ctx.call = async (cap, input) => {
    if (cap !== "tasks.create") return around(cap, input);
    seen.push(JSON.stringify((input as { assigned: unknown }).assigned));
    return tasks.call("tasks.create", input, { id: "usr_dana", kind: "person" } as never);
  };
  k.install(ACME);
  const made = await k.hs["connections.create"](k.ctx, {
    connector: "acme",
    title: "Acme",
    ownerKind: "space",
    secrets: { Acme_Key: "#AcmeKey", Acme_Hook: "#AcmeHook" },
  } as never);
  k.state.reply = () => ({ status: 401, body: {} });
  await assert.rejects(
    k.hs["connectors.run"](k.ctx, {
      key: "acme",
      action: "ping",
      connectionId: made.connection.connectionId,
      input: {},
    }),
  );
  assert.deepEqual(seen, ['{"kind":"role","id":"admin"}'], "no task was made for the person who left");
  assert.equal((await tasks.call("tasks.count_needs_you", {}, { id: ADMIN, kind: "person" } as never)).count, 1);
  assert.equal((await tasks.call("tasks.count_needs_you", {}, { id: "usr_dana", kind: "person" } as never)).count, 0);
});
