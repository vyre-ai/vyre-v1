// Who hears the state events (lead's review, 13 Nov): state is one person's alone, so `state.changed`, `state.scope_read` and `state.layout_changed` are private. Appended to a real log the way the module
// emits them, they reach the person they are about, whoever made the change, and the host's own change made on that person's behalf; the Space owner, an admin, another member, a guest and an agent acting for
// someone else read none of them.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { registry } from "../../generated/registry.ts";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { LogStore } from "../../kernel/src/log/store.ts";
import type { NewEvent } from "../../kernel/src/log/types.ts";
import { createEventLogPort } from "../src/seams/events-ports.ts";

const NOW = 1_760_000_000_000;
const TRACE = "a".repeat(32);

test("the state events are declared private", () => {
  for (const name of ["state.changed", "state.scope_read", "state.layout_changed"])
    assert.equal(registry.events.find((e) => e.name === name)?.vis, "private", name);
});

function snapshot(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 1, perms: [], name: "Member" });
  s.putRole({ id: "admin", clearance: 2, perms: [], name: "Admin" });
  s.putRole({ id: "owner", clearance: 3, perms: [], name: "Owner" });
  s.putRole({ id: "guest", clearance: 0, perms: [], name: "Guest" });
  for (const [id, role] of [
    ["usr_owner", "owner"],
    ["usr_admin", "admin"],
    ["usr_maya", "member"],
    ["usr_sam", "member"],
    ["usr_guest", "guest"],
  ] as const) {
    s.putPrincipal({ id, kind: "person", status: "active" });
    s.addPrincipalRole({ holder: id, role });
  }
  s.putPrincipal({ id: "agt_helper", kind: "agent", owner: "usr_maya", status: "active" });
  s.putPrincipal({ id: "agt_sams", kind: "agent", owner: "usr_sam", status: "active" });
  s.putPrincipal({ id: "agt_shared", kind: "agent", owner: "usr_owner", status: "active" });
  s.addPrincipalRole({ holder: "agt_shared", role: "member" });
  s.addPrincipalRole({ holder: "agt_helper", role: "member" });
  s.addPrincipalRole({ holder: "agt_sams", role: "member" });
  return s;
}

const ev = (o: Partial<NewEvent> & { type: string }): NewEvent => ({
  sv: 1,
  trace_id: TRACE,
  actor: "usr_maya",
  vis: "private",
  payload: { thing: "x" },
  ...o,
});

async function world() {
  const db = new DatabaseSync(":memory:");
  const store = new LogStore({ db, space: "spc_1", clock: () => NOW });
  // Maya's own press; an agent acting for her; the host's mute ending, made on her behalf
  store.appendBatch([
    ev({ type: "state.changed", actor: "usr_maya" }),
    ev({ type: "state.changed", actor: "agt_helper", on_behalf: "usr_maya" }),
    ev({ type: "state.changed", actor: "svc_host", on_behalf: "usr_maya" }),
    ev({ type: "state.scope_read", actor: "usr_maya" }),
    ev({ type: "state.layout_changed", actor: "usr_maya" }),
    // one agent serves several people: what it made for Maya
    ev({ type: "state.changed", actor: "agt_shared", on_behalf: "usr_maya" }),
  ]);
  const snap = snapshot();
  const port = createEventLogPort({
    source: { read: (q) => store.read(q), head: () => store.head.seq },
    access: () => snap,
    owner: () => "usr_owner",
    now: () => NOW,
  });
  return { port };
}

test("only Maya reads Maya's state events: not the owner, an admin, another member, a guest, or an agent acting for someone else", async () => {
  const w = await world();
  const read = async (principal: string, actingFor?: string) =>
    (await w.port.list({ principal, ...(actingFor ? { actingFor } : {}) })).events.map((e) => `${e.actor}:${e.type}`);
  const all = [
    "usr_maya:state.changed",
    "agt_helper:state.changed",
    "svc_host:state.changed",
    "usr_maya:state.scope_read",
    "usr_maya:state.layout_changed",
    "agt_shared:state.changed",
  ];
  assert.deepEqual(await read("usr_maya"), all, "Maya, on one device");
  assert.deepEqual(await read("usr_maya"), all, "and on another: the same person, the same events");
  assert.deepEqual(await read("usr_owner"), [], "the Space owner reads none");
  assert.deepEqual(await read("usr_admin"), [], "an admin reads none");
  assert.deepEqual(await read("usr_sam"), [], "another member reads none");
  assert.deepEqual(await read("usr_guest"), [], "a guest reads none");
  assert.deepEqual(await read("agt_sams", "usr_sam"), [], "an agent acting for someone else reads none");
  assert.deepEqual(
    await read("agt_shared", "usr_sam"),
    [],
    "the agent that made one for Maya reads none while it acts for Sam",
  );
  assert.deepEqual(await read("agt_shared", "usr_owner"), [], "nor while it acts for the Space owner");
  assert.deepEqual(await read("agt_shared", "usr_maya"), all, "it reads them while it acts for Maya");
});
