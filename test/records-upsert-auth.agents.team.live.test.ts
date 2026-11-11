// Issue 909, the agent side, end to end on a booted Team Space with only the model a stand-in. An agent's tool call records_bulk_upsert changes an existing record only where the agent may edit it, like
// records.update: an agent whose role holds records.create and no records.edit adds new contacts but cannot change one (the record is as it was, the row comes back in `refused`), the same agent with
// records.edit succeeds, a locked field (write-once) is not overwritten, and a Space Gate rule on records.update (an edit that waits for a person's approval) holds the row back as it would hold an edit.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const as = (d: Daemon) => async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who}` }, body: JSON.stringify(input) });
  const b = (await r.json()) as { data?: unknown };
  return { status: r.status, data: b.data ?? b };
};

interface Answer { ok: boolean; refused?: Array<{ row: number; reason: string; message: string }>; created?: number; updated?: number; text: string }

test("Team: an agent's bulk_upsert changes an existing contact only where the agent may edit it; refused rows are reported, locked fields and Gate rules hold", async () => {
  const answers: Answer[] = [];
  const model = scriptedModel(async function* (input, run) {
    const ask = String(input.trigger?.body ?? "");
    const mg = /^merge (\S+) (\S+)$/.exec(ask);   // merge <survivorId> <mergedId>
    if (mg) {
      yield* run("tool_search", { query: "records merge" });
      const r = yield* run("records_merge", { type: "contact", survivorId: mg[1], mergedIds: [mg[2]], picks: {}, idempotencyKey: `m-${answers.length}` });
      answers.push({ ok: r.ok, text: JSON.stringify(r.content).slice(0, 400) });
      yield { type: "text", text: "done" };
      return;
    }
    const m = /^upsert (\S+) (\S+) (\S+)$/.exec(ask);   // upsert <email> <field> <value>
    if (!m) return;
    const rows: Array<Record<string, unknown>> = [{ email: m[1], [m[2]!]: m[3] }];
    if (m[3] === "WITHNEW") rows.splice(0, 1, { email: m[1], name: "Hijacked" }, { email: "fresh@acme.test", name: "Fresh" });
    const r = yield* run("records_bulk_upsert", { type: "contact", rows, match: ["email"], idempotencyKey: `u-${answers.length}` });
    const data = ((r.content as { data?: { created?: number; updated?: number; refused?: Answer["refused"] } } | null)?.data ?? {}) as { created?: number; updated?: number; refused?: Answer["refused"] };
    answers.push({ ok: r.ok, ...(data.refused ? { refused: data.refused } : {}), ...(data.created !== undefined ? { created: data.created } : {}), ...(data.updated !== undefined ? { updated: data.updated } : {}), text: JSON.stringify(r.content).slice(0, 400) });
    yield { type: "text", text: "done" };
  });
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      return t === ownerToken.v || t === "usr_olivia" ? { space: CORE_SPACE, principal: { kind: "person" as const, id: "usr_olivia" }, device: "upsert-auth" } : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const keys = await api("usr_olivia", "vault.folders.create", { idempotencyKey: "ua-ai", name: "AI accounts", scope: "shared" });
    const acct = await api("usr_olivia", "providers.add", { idempotencyKey: "ua-acct", providerKey: "anthropic", connection: "api_key", apiKey: `${KEY}A`, name: "Team AI", scope: "shared", folderId: keys.data.folder.id });
    const make = async (name: string): Promise<string> => {
      const a = await api("usr_olivia", "agents.create", { name, role: "You enter contacts.", idempotencyKey: `ua-${name}` });
      assert.equal(a.status, 200, JSON.stringify(a.data));
      const id = a.data.agent.agentId as string;
      assert.equal((await api("usr_olivia", "agents.update", { agentId: id, patch: { accountPolicy: "key", accountKey: acct.data.provider.handle }, idempotencyKey: `ua-u-${name}` })).status, 200);
      return id;
    };
    const entry = await make("Entry");
    const editor = await make("Editor");

    // a role that creates records but does not edit them, held by Entry in place of Member
    const roles = (await api("usr_olivia", "access.roles.list", {})).data.roles as Array<{ id: string; name: string; permissions: string[] }>;
    const member = roles.find((r) => r.name === "Member" || r.id === "rol_member")!;
    const made = (await api("usr_olivia", "access.roles.create", { name: "Entry only", cloneFrom: member.id, idempotencyKey: "ua-role" })).data.role as { id: string; permissions: string[] };
    assert.ok(made.permissions.includes("records.edit") && made.permissions.includes("records.create"), "the clone starts as a Member");
    const permissions = made.permissions.filter((p) => p !== "records.edit");
    const prev = await api("usr_olivia", "access.roles.preview", { roleId: made.id, permissions });
    assert.equal((await api("usr_olivia", "access.roles.apply", { roleId: made.id, permissions, previewHash: prev.data.previewHash })).status, 200);
    assert.equal((await api("usr_olivia", "access.roles.assign", { subject: { kind: "agent", id: entry }, roleId: made.id, idempotencyKey: "ua-assign" })).status, 200);
    assert.equal((await api("usr_olivia", "access.roles.unassign", { subject: { kind: "agent", id: entry }, roleId: member.id, idempotencyKey: "ua-unassign" })).status, 200);

    // a contact Olivia made, and a write-once field on contacts
    const ann = (await api("usr_olivia", "records.create", { type: "contact", fields: { name: "Ann Alder", email: "ann@acme.test", phone: "1" }, idempotencyKey: "ua-ann" }));
    assert.equal(ann.status, 200, JSON.stringify(ann.data));
    const annId = ann.data.record.id as string;
    const annNow = async (): Promise<Record<string, unknown>> => (await api("usr_olivia", "records.get", { type: "contact", recordId: annId })).data.record.fields as Record<string, unknown>;

    const askAgent = async (agentId: string, line: string, n: number): Promise<Answer> => {
      const th = await api("usr_olivia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `ua-chat-${n}` });
      const before = answers.length;
      await api("usr_olivia", "chat.post", { threadId: th.data.thread.threadId, body: line, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `ua-post-${n}` });
      await waitFor(async () => { await d.hooks?.pump?.(); return answers.length > before ? true : null; }, 60_000, () => hostLog(d));
      return answers[answers.length - 1]!;
    };

    // a call the Gate parks does not answer the agent until a person decides, so those asks only post
    const tell = async (agentId: string, line: string, n: number): Promise<void> => {
      const th = await api("usr_olivia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: `ua-chat-${n}` });
      await api("usr_olivia", "chat.post", { threadId: th.data.thread.threadId, body: line, mentions: [{ kind: "agent", id: agentId }], idempotencyKey: `ua-post-${n}` });
    };

    // 1. create without edit: the new row is made, the existing record is not changed, the row is reported
    const a1 = await askAgent(entry, "upsert ann@acme.test name WITHNEW", 1);
    assert.deepEqual([a1.created, a1.updated ?? 0], [1, 0], a1.text);
    assert.deepEqual(a1.refused?.map((r) => [r.row, r.reason]), [[0, "not_allowed"]], a1.text);
    assert.equal((await annNow())["name"], "Ann Alder", "Ann is as Olivia made her");
    const fresh = (await api("usr_olivia", "records.query", { type: "contact", filter: { field: "email", op: "eq", value: "fresh@acme.test" }, limit: 5 })).data.rows as unknown[];
    assert.equal(fresh.length, 1, "the new contact was written");

    // 2. an agent that may edit succeeds on the same call
    const a2 = await askAgent(editor, "upsert ann@acme.test phone 555", 2);
    assert.deepEqual([a2.created ?? 0, a2.updated], [0, 1], a2.text);
    assert.equal(a2.refused, undefined);
    assert.equal((await annNow())["phone"], "555");

    // a locked field: a stage that needs a field filled first (a stage gate the store enforces for every caller) is not entered through bulk_upsert either, and the row says why
    const added = await api("usr_olivia", "schema.apply", { ops: [
      { op: "field.add", type: "contact", field: "code", def: { key: "code", type: "text", title: "Code" } },
      { op: "field.add", type: "contact", field: "stage", def: { key: "stage", type: "status", title: "Stage", options: { stages: [{ key: "lead", title: "Lead" }, { key: "won", title: "Won", needToEnter: ["code"] }] } } },
    ], reason: "A stage that needs a code", idempotencyKey: "ua-stage" });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    assert.equal((await api("usr_olivia", "records.update", { type: "contact", recordId: annId, patch: { stage: "lead" } })).status, 200);
    const gated = await api("usr_olivia", "records.update", { type: "contact", recordId: annId, patch: { stage: "won" } });
    assert.notEqual(gated.status, 200, "records.update itself refuses the stage change while the code is empty");
    const a2b = await askAgent(editor, "upsert ann@acme.test stage won", 4);
    assert.deepEqual(a2b.refused?.map((r) => [r.row, r.reason]), [[0, "stage_gate"]], a2b.text);
    assert.equal((await annNow())["stage"], "lead", "the locked stage change was not written");

    // 3. a Gate rule on records.update: an agent's edit waits for a person, so the row is not written and says so
    assert.equal((await api("usr_olivia", "access.policies.set", { key: "gate.ua-edit", scope: "space", value: { act: "approve", approver: "owner", caps: ["records.update"] } })).status, 200);
    const a3 = await askAgent(editor, "upsert ann@acme.test phone 777", 3);
    assert.deepEqual(a3.refused?.map((r) => [r.row, r.reason]), [[0, "needs_approval"]], a3.text);
    assert.equal((await annNow())["phone"], "555", "the held change was not written");

    // 4. a call a person approved goes through: the Gate parks the agent's whole bulk_upsert, Olivia approves it, and its rows are written (the approval is not asked for again row by row)
    assert.equal((await api("usr_olivia", "access.policies.set", { key: "gate.ua-edit", scope: "space", value: { act: "approve", approver: "owner", caps: ["records.bulk_upsert", "records.update"] } })).status, 200);
    await tell(editor, "upsert ann@acme.test phone 888", 5);
    const hold = await waitFor(async () => {
      await d.hooks?.pump?.();
      const holds = (await api("usr_olivia", "gate.holds.list", { states: ["held"] })).data.holds as Array<{ id: string; taskId: string; capName?: string }>;
      return holds.find((h) => h.capName === "records.bulk_upsert") ?? null;
    }, 60_000, () => hostLog(d));
    assert.equal((await annNow())["phone"], "555", "parked: nothing written yet");
    assert.equal((await api("usr_olivia", "tasks.act", { taskId: hold.taskId, action: "approve" })).status, 200);
    await waitFor(async () => { await d.hooks?.pump?.(); return (await annNow())["phone"] === "888" ? true : null; }, 60_000, () => hostLog(d));

    // 5. an agent cannot merge records into Trash without approval, and once a person approves the merge it goes through
    const mrole = (await api("usr_olivia", "access.roles.create", { name: "Merger", cloneFrom: member.id, idempotencyKey: "ua-mrole" })).data.role as { id: string; permissions: string[] };
    const mperms = [...new Set([...mrole.permissions, "records.delete"])];
    const mprev = await api("usr_olivia", "access.roles.preview", { roleId: mrole.id, permissions: mperms });
    assert.equal((await api("usr_olivia", "access.roles.apply", { roleId: mrole.id, permissions: mperms, previewHash: mprev.data.previewHash })).status, 200);
    const merger = await make("Merger");
    assert.equal((await api("usr_olivia", "access.roles.assign", { subject: { kind: "agent", id: merger }, roleId: mrole.id, idempotencyKey: "ua-massign" })).status, 200);
    assert.equal((await api("usr_olivia", "access.policies.reset", { key: "gate.ua-edit", scope: "space" })).status, 200);
    const bo = (await api("usr_olivia", "records.create", { type: "contact", fields: { name: "Bo Birch", email: "bo@acme.test" }, idempotencyKey: "ua-bo" })).data.record.id as string;
    await tell(merger, `merge ${annId} ${bo}`, 6);
    const mhold = await waitFor(async () => {
      await d.hooks?.pump?.();
      const holds = (await api("usr_olivia", "gate.holds.list", { states: ["held"] })).data.holds as Array<{ id: string; taskId: string; capName?: string }>;
      return holds.find((h) => h.capName === "records.merge") ?? null;
    }, 60_000, () => hostLog(d));
    const boNow = async (): Promise<number> => (await api("usr_olivia", "records.get", { type: "contact", recordId: bo })).status;
    assert.equal(await boNow(), 200, "parked: Bo is not merged away yet");
    assert.equal((await api("usr_olivia", "tasks.act", { taskId: mhold.taskId, action: "approve" })).status, 200);
    await waitFor(async () => { await d.hooks?.pump?.(); return (await boNow()) !== 200 ? true : null; }, 60_000, () => hostLog(d));
  } catch (e) { console.error("ANSWERS:", JSON.stringify(answers.slice(-2))); console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e); throw e; } finally { await stop(d); }
});
