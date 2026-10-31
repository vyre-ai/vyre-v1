// Records sharing, three people over HTTP with their own tokens (DESIGN-records-sharing): a booted daemon with records, access, members, chat and the turn engine live.
// Ada (owner) makes Deals and sets it to Only people added, then adds Bea as Can edit and Cal as Can view. Bea edits a deal; Cal reads and cannot edit or export; Dee, who was not added, sees no
// Deals type, and her agent cannot read it in chat or in search. Ada turns Can export on for Cal: he exports a CSV with only the rows he can see. Ada sets one deal to Only me: Bea and Cal lose it
// at once. The model stand-in turns "TOOL <name> <json>" into a real tool call, run as the person who asked.
import test from "node:test";
import assert from "node:assert/strict";
import { boot, call, connect, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const PASSWORD = "correct horse battery staple 9";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const DEVICE = { deviceName: "Test browser", deviceClass: "desktop" };

type Out = { status: number; data: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
interface Person { id: string; token: string; name: string }

let keys = 0;
const as = (d: Daemon, who: Person) => async (cap: string, input: Record<string, unknown> = {}): Promise<Out> => {
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${who.token}` }, body: JSON.stringify({ idempotencyKey: `rs-${cap}-${++keys}`, ...input }) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
};

async function join(d: Daemon, owner: ReturnType<typeof as>, roleId: string, username: string, name: string): Promise<Person> {
  const invite = await owner("members.invites.create", { role: roleId });
  assert.equal(invite.status, 200, JSON.stringify(invite.data));
  const code = decodeURIComponent(new URL(invite.data.link).pathname.split("/").pop() ?? "");
  const r = await fetch(`${d.url}/v1/members/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, username, displayName: name, password: PASSWORD, keys: KEYS, ...DEVICE }) });
  const body = (await r.json()) as { data?: { token: string; personId: string } };
  assert.equal(r.status, 200, JSON.stringify(body));
  return { id: body.data!.personId, token: body.data!.token, name };
}

/** One chat turn as this person: the stand-in runs the tool as the asker, and the reply is the tool's result. */
async function sayAs(d: Daemon, who: Person, agentId: string, body: string): Promise<string> {
  const ask = as(d, who);
  const started = await ask("chat.start", { kind: "chat", agentIds: [agentId] });
  assert.equal(started.status, 200, JSON.stringify(started.data));
  const threadId = started.data.thread.threadId as string;
  const posted = await ask("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
  assert.equal(posted.status, 200, JSON.stringify(posted.data));
  return waitFor(async () => {
    await d.hooks?.pump?.();
    const r = await ask("chat.messages.list", { threadId });
    const m = (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "");
    return m?.body ?? null;
  }, 40_000, () => hostLog(d));
}

test("records sharing: Ada shares Deals with Bea to edit and Cal to view; Dee sees nothing; Cal exports once allowed; one deal goes Only me", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const ada: Person = { id: (await call(d, "identity.whoami", {})).data.principal.id as string, token: d.token!, name: "Ada" };
    const A = as(d, ada);
    const roles = (await A("access.roles.list")).data.roles as Array<{ id: string; name: string }>;
    const member = roles.find((r) => r.name === "Member")!.id;
    const bea = await join(d, A, member, "bea", "Bea Baker");
    const cal = await join(d, A, member, "cal", "Cal Cruz");
    const dee = await join(d, A, member, "dee", "Dee Dunn");
    const B = as(d, bea), C = as(d, cal), D = as(d, dee);

    // Deals, three of them
    const made = await A("schema.apply", { ops: [{ op: "type.create", type: "rt_deal", def: { title: "Deal", plural: "Deals", icon: "invoice", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "stage", type: "text", title: "Stage" }] } }] });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    const deals: Record<string, string> = {};
    for (const name of ["Acme renewal", "Birch lease", "Cedar upsell"]) {
      const r = await A("records.create", { type: "rt_deal", fields: { name, stage: "open" } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      deals[name] = r.data.record.id as string;
    }
    const deal = { type: "record_type", id: "rt_deal" };

    // before anything is chosen the Space reaches Deals through its roles
    assert.equal((await D("records.query", { type: "rt_deal" })).status, 200, "a member of the Space sees Deals until it is set to Only people added");

    // Ada sets Only people added and adds Bea as Can edit and Cal as Can view
    const set = await A("access.audience_set", { resource: deal, audience: "added" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual(set.data, { audience: "added", exporters: "admins" });
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: bea.id }, level: "edit" })).status, 200);
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: cal.id }, level: "view" })).status, 200);

    // Bea edits a deal
    const edit = await B("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], fields: { stage: "won" } });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal((await A("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).data.record.fields.stage, "won");

    // Cal reads it read only, with no export
    assert.equal((await C("records.query", { type: "rt_deal" })).data.rows.length, 3);
    assert.equal((await C("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], fields: { stage: "lost" } })).status, 403, "Can view does not edit");
    assert.equal((await C("records.export", { type: "rt_deal", format: "csv" })).status, 403, "no export right yet");
    const marks = await C("access.record_marks", { type: "rt_deal" });
    assert.deepEqual(marks.data.can, { manage: false, share: false, export: false }, "so the app draws no Share and no Export for Cal");
    assert.equal(marks.data.typeShared, true, "and offers Shared with me");
    assert.equal((await B("access.record_marks", { type: "rt_deal" })).data.can.export, false);

    // Dee, who was not added, sees no Deals type at all
    assert.equal((await D("records.query", { type: "rt_deal" })).status, 403);
    assert.equal((await D("records.search", { type: "rt_deal", q: "Acme" })).status, 403);
    assert.equal((await D("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).status, 403);
    const typesForDee = (await D("schema.types.list")).data.types as Array<{ key: string }>;
    assert.ok(!typesForDee.some((t) => t.key === "rt_deal"), "Deals is not in Dee's list of types");
    assert.ok(!((await D("schema.describe")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"));
    assert.equal((await D("schema.describe", { type: "rt_deal" })).status, 403);
    assert.ok(((await C("schema.types.list")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"), "Cal sees the type");
    assert.ok(((await A("schema.types.list")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"), "Ada sees the type");

    // and her agent cannot read it in chat or in search: it acts with the asker's access, never more
    const agent = await D("agents.create", { name: "Dee helper", role: "You answer questions." });
    assert.equal(agent.status, 200, JSON.stringify(agent.data));
    const agentId = agent.data.agent.agentId as string;
    const deeQuery = await sayAs(d, dee, agentId, `TOOL records_query ${JSON.stringify({ type: "rt_deal" })}`);
    assert.match(deeQuery, /TOOL RESULT failed/, deeQuery);
    assert.doesNotMatch(deeQuery, /Acme renewal|Birch lease/);
    const deeSearch = await sayAs(d, dee, agentId, `TOOL search_query ${JSON.stringify({ q: "Acme" })}`);
    assert.doesNotMatch(deeSearch, /Acme renewal/, `search through Dee's agent: ${deeSearch}`);
    // while the same tool through an agent Bea asked reads the rows
    const beaAgent = (await B("agents.create", { name: "Bea helper", role: "You answer questions." })).data.agent.agentId as string;
    const beaQuery = await sayAs(d, bea, beaAgent, `TOOL records_query ${JSON.stringify({ type: "rt_deal" })}`);
    assert.match(beaQuery, /TOOL RESULT ok/, beaQuery);
    assert.match(beaQuery, /Acme renewal/);

    // one deal is Only me before the export, so the export has a row Cal cannot see
    assert.equal((await A("access.audience_set", { resource: { type: "record", id: deals["Cedar upsell"] }, audience: "me" })).status, 200);
    assert.equal((await C("records.get", { type: "rt_deal", recordId: deals["Cedar upsell"] })).status, 403);
    assert.deepEqual(((await C("records.query", { type: "rt_deal" })).data.rows as Array<{ fields: { name: string } }>).map((r) => r.fields.name).sort(), ["Acme renewal", "Birch lease"]);
    assert.equal((await C("access.record_marks", { type: "rt_deal" })).data.rows.length, 0, "the row Cal cannot see is not listed to him");

    // Ada turns Can export on for Cal: he exports a CSV with only the rows he can see
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: cal.id }, level: "view", export: true })).status, 200);
    assert.equal((await C("access.record_marks", { type: "rt_deal" })).data.can.export, true);
    const exported = await C("records.export", { type: "rt_deal", format: "csv" });
    assert.equal(exported.status, 200, JSON.stringify(exported.data));
    const csv = (await C("files.read", { fileId: exported.data.fileId, as: "text" })).data.text as string;
    assert.match(csv, /Acme renewal/);
    assert.match(csv, /Birch lease/);
    assert.doesNotMatch(csv, /Cedar upsell/, "the deal set to Only me is not in his export");
    assert.equal((await C("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], fields: { stage: "lost" } })).status, 403, "export is not edit");
    assert.equal((await B("records.export", { type: "rt_deal", format: "csv" })).status, 403, "and Bea, who was not given it, still cannot");

    // Ada sets one deal to Only me: Bea and Cal lose it at once
    assert.equal((await A("access.audience_set", { resource: { type: "record", id: deals["Acme renewal"] }, audience: "me" })).status, 200);
    for (const who of [B, C]) {
      assert.equal((await who("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).status, 403);
      assert.deepEqual(((await who("records.query", { type: "rt_deal" })).data.rows as Array<{ fields: { name: string } }>).map((r) => r.fields.name), ["Birch lease"]);
      assert.equal((await who("records.counts", { type: "rt_deal" })).data.count, 1);
    }
    assert.equal((await A("records.query", { type: "rt_deal" })).data.rows.length, 3, "Ada still sees all three");
    const aMarks = await A("access.record_marks", { type: "rt_deal" });
    assert.deepEqual(aMarks.data.rows.map((r: { audience: string }) => r.audience).sort(), ["me", "me"]);
    // put it back: it follows the type again
    assert.equal((await A("access.audience_set", { resource: { type: "record", id: deals["Acme renewal"] }, audience: "space" })).status, 200);
    assert.equal((await B("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).status, 200);
    assert.equal((await C("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).status, 200);

    // Anyone who can view may export, when the type says so; Admins only takes it back
    assert.equal((await A("access.audience_set", { resource: deal, exporters: "viewers" })).data.exporters, "viewers");
    assert.equal((await B("records.export", { type: "rt_deal", format: "csv" })).status, 200, "Bea can view, so she may export");
    assert.equal((await D("records.export", { type: "rt_deal", format: "csv" })).status, 403, "Dee still sees nothing");
    assert.equal((await A("access.audience_set", { resource: deal, exporters: "admins" })).data.exporters, "admins");
    assert.equal((await B("records.export", { type: "rt_deal", format: "csv" })).status, 403);
    assert.equal((await C("records.export", { type: "rt_deal", format: "csv" })).status, 403, "the flag Ada gave Cal went with Admins only");

    // Ada puts Deals back to everyone: Dee sees it again
    assert.equal((await A("access.audience_set", { resource: deal, audience: "space" })).status, 200);
    assert.equal((await D("records.query", { type: "rt_deal" })).status, 200);
    assert.ok(((await D("schema.types.list")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"));
  } finally { await d.stop(); }
});
