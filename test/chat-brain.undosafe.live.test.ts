// Chat-brain live tests, fourth file: Undo is safe. A record someone changed after the turn is left alone and said so, and what left the Space (a published form) is listed as one that cannot be undone.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, makeAgent, say, scriptedModel, seededDir, waitFor } from "./support/live.ts";

test("undo leaves alone a record changed since the turn, labels a publish as one that cannot be undone, and reverts the rest as the asker", async () => {
  let a = "";
  let b = "";
  let agent = "";
  const model = scriptedModel(async function* (_input, run) {
    const u1 = yield* run("records_update", { type: "contact", recordId: a, patch: { phone: "555-0001" } });
    const u2 = yield* run("records_update", { type: "contact", recordId: b, patch: { phone: "555-0002" } });
    yield* run("tool_search", { query: "create and publish a form" });
    const f = yield* run("forms_create", { name: "Intake", recordType: "contact", kind: "public", idempotencyKey: "us-form" });
    const fid = ((f.content as { data?: { form?: { id?: string; formId?: string } } }).data?.form ?? {}) as { id?: string; formId?: string };
    // the person lets this agent manage the form it made, so the publish goes through and the turn has an act that left the Space
    const shared = await call(d, "access.share", { resource: { type: "form", id: fid.formId ?? fid.id }, subject: { kind: "agent", id: agent }, level: "manage", idempotencyKey: "us-share" });
    if (shared.status !== 200) throw new Error(`share failed ${JSON.stringify(shared.data)}`);
    const set = await call(d, "forms.fields_set", { formId: fid.formId ?? fid.id, fields: [{ field: "name", mode: "ask" }], idempotencyKey: "us-fields" });
    if (set.status !== 200) throw new Error(`fields failed ${JSON.stringify(set.data)}`);
    const p = yield* run("forms_publish", { formId: fid.formId ?? fid.id, idempotencyKey: "us-pub" });
    yield { type: "text", text: u1.ok && u2.ok && f.ok && p.ok ? "done" : `failed ${JSON.stringify([u1.ok, u2.ok, f.content, p.content]).slice(0, 500)}` };
  });
  let d!: Awaited<ReturnType<typeof boot>>;
  d = await boot(seededDir(), model);
  try {
    await connect(d);
    agent = await makeAgent(d, "Editor");
    a = (await call(d, "records.create", { type: "contact", fields: { name: "Keep A", phone: "111" }, idempotencyKey: "us-a" })).data.record.id as string;
    b = (await call(d, "records.create", { type: "contact", fields: { name: "Keep B", phone: "222" }, idempotencyKey: "us-b" })).data.record.id as string;
    const { threadId, reply } = await say(d, agent, "update the contacts and publish the intake form", "us1");
    assert.equal(reply, "done", reply);
    const block = await waitFor(async () => {
      await d.hooks?.pump?.();
      const ms = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{ blocks?: Array<{ type: string; data: { turnId: string; summary: string; changes: Array<{ label: string; undoable: boolean }> } }> }>;
      return ms.flatMap((m) => m.blocks ?? []).find((x) => x.type === "turn_changes") ?? null;
    }, 20_000, () => hostLog(d));
    assert.ok(block.data.changes.some((c) => !c.undoable && /form was published/.test(c.label) && /can't be undone/.test(c.label)), JSON.stringify(block.data.changes));
    assert.match(block.data.summary, /that can't be undone/);
    // someone edits record A after the turn
    assert.equal((await call(d, "records.update", { type: "contact", recordId: a, patch: { title: "Edited by hand" } })).status, 200);
    const turnId = block.data.turnId;
    const shown = (await call(d, "engine.turn.changes", { threadId, turnId })).data.changes as Array<{ label: string; undoable: boolean }>;
    assert.equal(shown.filter((c) => /changed since, left alone/.test(c.label)).length, 1, JSON.stringify(shown));
    const undo = await call(d, "engine.turn.undo", { threadId, turnId });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    assert.equal(undo.data.undone, 1, "only the untouched record was put back");
    assert.ok((undo.data.left as string[]).some((l) => /changed since, left alone/.test(l)));
    assert.ok((undo.data.left as string[]).some((l) => /can't be undone/.test(l)));
    const rows = (await call(d, "records.query", { type: "contact", limit: 100 })).data.rows as Array<{ id: string; fields: Record<string, unknown> }>;
    assert.equal(rows.find((r) => r.id === a)!.fields["phone"], "555-0001", "the record changed since the turn keeps the agent's value");
    assert.equal(rows.find((r) => r.id === b)!.fields["phone"], "222", "the other record is back");
  } finally { await d.stop(); }
});
