// A person added to a private chat without "Include earlier messages" has a start (thread_member.fromAt). The sync lane holds back every message made before it, with the attachments, reactions and
// pins that are fields of it, so those rows never leave the server: the newcomer's devices pull and snapshot only what came after, and what came before is never in their replica. A thread under the chat
// answers to the chat's start. The person who was always there, and a newcomer added with earlier messages, receive everything.
import test from "node:test";
import assert from "node:assert/strict";
import { AccessSnapshot } from "../../../kernel/src/authorize/snapshot.ts";
import { openSync } from "../impl.ts";
import { NOW } from "../fixtures/world.ts";

const DANA = "usr_dana", MAYA = "usr_maya", LEO = "usr_leo";
const TRACE = "0123456789abcdef0123456789abcdef";
const START = NOW + 10_000;

function access(): AccessSnapshot {
  const snap = new AccessSnapshot();
  snap.putRole({ id: "member", clearance: 1, perms: ["records.read"], name: "Member" });
  for (const id of [DANA, MAYA, LEO]) {
    snap.putPrincipal({ id, kind: "person", status: "active", name: id });
    snap.addPrincipalRole({ holder: id, role: "member" });
    for (const type of ["thread", "space"]) snap.putGrant({ id: `gr_${id}_${type}`, subject_kind: "actor", subject_id: id, resource_type: type, resource_id: null, level: "view" });
  }
  return snap;
}

function world() {
  const snap = access();
  const s = openSync({ access: () => snap, clock: () => NOW });
  let n = 0;
  const row = (entity: string, id: string, fields: Record<string, unknown>): void => {
    s.host.append({ type: "sync.row", sv: 1, trace_id: TRACE, actor: "svc_seed", hlc: `00000000${String(++n).padStart(4, "0")}-0000-srv`, vis: "space", payload: { entity, id, op: "upsert", fields } });
  };
  row("thread", "thr_chat", { kind: "chat", title: "Rivera intake" });
  row("thread", "thr_reply", { kind: "thread", parentThreadId: "thr_chat" });
  row("thread_member", "thm_dana", { thread: "thr_chat", principal: DANA, role: "owner" });
  row("thread_member", "thm_maya", { thread: "thr_chat", principal: MAYA, role: "member", fromAt: START });
  row("thread_member", "thm_leo", { thread: "thr_chat", principal: LEO, role: "member" });
  row("message", "msg_old", { thread: "thr_chat", threadSeq: 1, author: DANA, kind: "text", body: "the old retainer figure", createdAt: NOW, pinned: true, reactions: [{ emoji: "ok", by: [DANA] }], attachments: ["fil_old"] });
  row("message", "msg_old_reply", { thread: "thr_reply", threadSeq: 1, author: DANA, kind: "text", body: "an old inline reply", createdAt: NOW + 1_000 });
  row("message", "msg_new", { thread: "thr_chat", threadSeq: 2, author: DANA, kind: "text", body: "welcome Maya", createdAt: START + 1_000 });
  row("message", "msg_new_reply", { thread: "thr_reply", threadSeq: 2, author: DANA, kind: "text", body: "a new inline reply", createdAt: START + 2_000 });
  const pull = (person: string, device: string, deviceClass: "desktop" | "phone" = "desktop") =>
    s.handlers["sync.pull"]({ trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass }, { cursor: 0, epoch: 0, entities: ["message"] });
  const snapshot = async (person: string, device: string) => {
    const ctx = { trace: { traceId: TRACE }, principal: person, deviceId: device, deviceClass: "desktop" };
    const begin = await s.handlers["sync.snapshot.begin"](ctx, { deviceClass: "desktop", entities: ["message"] }) as { asOfSeq: number };
    const out: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await s.handlers["sync.snapshot.page"](ctx, { entity: "message", asOf: begin.asOfSeq, ...(after ? { after } : {}) }) as { rows: Array<{ id: string }>; done: boolean; next?: string };
      out.push(...page.rows.map((r) => r.id));
      if (page.done || !page.next) break;
      after = page.next;
    }
    return out;
  };
  return { s, pull, snapshot };
}
const ids = (r: { changes: Array<{ entity: string; id: string }> }): string[] => r.changes.filter((c) => c.entity === "message").map((c) => c.id).sort();

test("a newcomer added without history: on two devices, pull never carries a message from before their start, or the pins, reactions and attachments on it", async () => {
  const { pull } = world();
  const laptop = await pull(MAYA, "dev_laptop");
  const phone = await pull(MAYA, "dev_phone", "phone");
  assert.deepEqual(ids(laptop), ["msg_new", "msg_new_reply"], "the laptop gets only what came after");
  assert.deepEqual(ids(phone), ["msg_new", "msg_new_reply"], "and so does the phone");
  const wire = JSON.stringify([laptop, phone]);
  for (const hidden of ["the old retainer figure", "an old inline reply", "fil_old", "msg_old"]) assert.ok(!wire.includes(hidden), `${hidden} never left the server`);
});

test("a snapshot (a new device's first sync) holds the same line", async () => {
  const { snapshot } = world();
  assert.deepEqual((await snapshot(MAYA, "dev_new")).sort(), ["msg_new", "msg_new_reply"]);
});

test("the person who was always there, and a newcomer added with earlier messages, receive everything", async () => {
  const { pull, snapshot } = world();
  assert.deepEqual(ids(await pull(DANA, "dev_dana")), ["msg_new", "msg_new_reply", "msg_old", "msg_old_reply"]);
  assert.deepEqual(ids(await pull(LEO, "dev_leo")), ["msg_new", "msg_new_reply", "msg_old", "msg_old_reply"], "no fromAt: the whole chat");
  assert.equal((await snapshot(LEO, "dev_leo")).length, 4);
});
