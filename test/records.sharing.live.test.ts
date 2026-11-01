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

test("records sharing: Ada shares Deals with Bea to edit and Cal to view; Dee sees nothing; Cal exports once allowed; one deal goes Only me", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    const everyone = (await call(d, "access.principals.list", {})).data.principals as Array<{ id: string; kind: string; roles: string[] }>;
    const ada: Person = { id: everyone.find((p) => p.kind === "person" && p.roles.includes("rol_owner") || p.roles.includes("rol_admin"))!.id, token: d.token!, name: "Ada" };
    const A = as(d, ada);
    const roles = (await A("access.roles.list")).data.roles as Array<{ id: string; name: string }>;
    const member = roles.find((r) => r.name === "Member")!.id;
    const bea = await join(d, A, member, "bea", "Bea Baker");
    const cal = await join(d, A, member, "cal", "Cal Cruz");
    const dee = await join(d, A, member, "dee", "Dee Dunn");
    const B = as(d, bea), C = as(d, cal), D = as(d, dee);

    // a Space account in a Shared Vault folder, so every member's turn can run on it (the model vendor is the stand-in)
    const sharedFolder = await A("vault.folders.create", { name: "Space accounts", scope: "shared" });
    assert.equal(sharedFolder.status, 200, JSON.stringify(sharedFolder.data));
    assert.equal((await A("access.share", { resource: { type: "vault_folder", id: sharedFolder.data.folder.id }, subject: { kind: "group", id: "grp_everyone" }, level: "use" })).status, 200, "the members may use the folder's accounts");
    const account = await A("providers.add", { providerKey: "anthropic", connection: "api_key", apiKey: "sk-ant-api03-TESTsecretVALUE0123456789abcdefXYZ", scope: "shared", folderId: sharedFolder.data.folder.id });   // secret-scan: fake
    assert.equal(account.status, 200, JSON.stringify(account.data));
    const listed = (await D("providers.list")).data.providers as Array<{ id: string; state?: string }>;
    assert.ok(listed.some((p) => p.id === account.data.provider.id), `a member sees the Space account: ${JSON.stringify(listed).slice(0, 200)}`);
    const handle = (account.data.provider.handle ?? account.data.provider.itemId) as string;
    assert.equal((await A("providers.set_space_use", { providerId: account.data.provider.id, allow: true })).status, 200);

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
    // a type everyone may see that points into Deals
    const noteType = await A("schema.apply", { ops: [{ op: "type.create", type: "rt_note", def: { title: "Note", plural: "Notes", icon: "task", titleField: "text", fields: [{ key: "text", type: "text", title: "Text", required: true }, { key: "about", type: "relation", title: "About", options: { target: "rt_deal" } }] } }] });
    assert.equal(noteType.status, 200, JSON.stringify(noteType.data));
    const noteMade = await A("records.create", { type: "rt_note", fields: { text: "Call back on Monday" } });
    assert.equal(noteMade.status, 200, JSON.stringify(noteMade.data));
    const noteId = noteMade.data.record.id as string;
    await A("records.relate", { type: "rt_note", recordId: noteId, field: "about", toId: deals["Acme renewal"] });

    // before anything is chosen the Space reaches Deals through its roles
    assert.equal((await D("records.query", { type: "rt_deal" })).status, 200, "a member of the Space sees Deals until it is set to Only people added");

    // Ada sets Only people added and adds Bea as Can edit and Cal as Can view
    const set = await A("access.audience_set", { resource: deal, audience: "added" });
    assert.equal(set.status, 200, JSON.stringify(set.data));
    assert.deepEqual(set.data, { audience: "added", exporters: "admins", outside: false });
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: bea.id }, level: "edit" })).status, 200);
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: cal.id }, level: "view" })).status, 200);

    // Bea edits a deal
    const edit = await B("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], patch: { stage: "won" } });
    assert.equal(edit.status, 200, JSON.stringify(edit.data));
    assert.equal((await A("records.get", { type: "rt_deal", recordId: deals["Acme renewal"] })).data.record.fields.stage, "won");

    // Cal reads it read only, with no export
    assert.equal((await C("records.query", { type: "rt_deal" })).data.rows.length, 3);
    assert.equal((await C("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], patch: { stage: "lost" } })).status, 403, "Can view does not edit");
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

    // a real chat turn for Dee: her agent runs a real tool call as her, and finds nothing; Bea's agent, asked the same, finds the deals
    const sayAs = async (who: Person, agentId: string, body: string): Promise<string> => {
      const ask = as(d, who);
      const started = await ask("chat.start", { kind: "chat", agentIds: [agentId] });
      assert.equal(started.status, 200, JSON.stringify(started.data));
      const threadId = started.data.thread.threadId as string;
      assert.equal((await ask("chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] })).status, 200);
      return waitFor(async () => {
        await d.hooks?.pump?.();
        const r = await ask("chat.messages.list", { threadId });
        return (r.data.messages as Array<{ author?: { kind?: string }; body?: string }> | undefined)?.find((x) => x.author?.kind === "agent" && (x.body ?? "") !== "")?.body ?? null;
      }, 40_000, () => hostLog(d));
    };
    const deeAgent = (await D("agents.create", { name: "Dee helper", role: "You answer questions." })).data.agent.agentId as string;
    const pin = await D("agents.update", { agentId: deeAgent, patch: { accountPolicy: "key", accountKey: handle } });
    assert.equal(pin.status, 200, JSON.stringify(pin.data));
    const beaAgent = (await B("agents.create", { name: "Bea helper", role: "You answer questions." })).data.agent.agentId as string;
    assert.equal((await B("agents.update", { agentId: beaAgent, patch: { accountPolicy: "key", accountKey: handle } })).status, 200);
    // both agents are added to the Deals sheet like people, so the only difference left is whose access they act with
    for (const agentId of [deeAgent, beaAgent]) assert.equal((await A("access.share", { resource: deal, subject: { kind: "agent", id: agentId }, level: "edit" })).status, 200);
    for (const [tool, input] of [["records_query", { type: "rt_deal" }], ["records_get", { type: "rt_deal", recordId: deals["Acme renewal"] }], ["search_query", { q: "Acme" }], ["schema_describe", {}], ["schema_map", {}]] as const) {
      const reply = await sayAs(dee, deeAgent, `TOOL ${tool} ${JSON.stringify(input)}`);
      assert.doesNotMatch(reply, /Acme renewal|Birch lease|Cedar upsell|Dune expansion|rt_deal/, `${tool} through Dee's agent: ${reply.slice(0, 300)}`);
    }
    const beaReply = await sayAs(bea, beaAgent, `TOOL records_query ${JSON.stringify({ type: "rt_deal" })}`);
    assert.match(beaReply, /TOOL RESULT ok/, beaReply);
    assert.match(beaReply, /Birch lease/);

    // her agent acts with her access and no more (the unit test in modules/access proves the agent leg), so global search for Dee is the same wall
    const dSearch = "search.query";
    const found = await D(dSearch, { q: "Acme" });
    assert.ok(found.status !== 200 || !JSON.stringify(found.data).includes("Acme renewal"), `global search must not return the deal to Dee: ${JSON.stringify(found.data).slice(0, 200)}`);
    assert.ok(!((await D("schema.types.list")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"));
    // the same through search for Bea, who was added
    const beaFound = await B("search.query", { q: "Acme" });
    assert.equal(beaFound.status, 200, JSON.stringify(beaFound.data));

    // nothing anywhere tells Dee a Deals type or a deal exists: every read that is keyed by the type or names one is refused or comes back without it
    const rec = deals["Acme renewal"];
    const probes: Array<[string, Record<string, unknown>]> = [
      ["schema.types.get", { type: "rt_deal" }], ["schema.map", { type: "rt_deal" }], ["schema.map", {}], ["schema.layout.get", { type: "rt_deal" }], ["schema.changes.list", { type: "rt_deal" }], ["schema.trash.list", {}],
      ["schema.sensitivity.scan", { type: "rt_deal" }], ["views.list", { type: "rt_deal" }], ["records.counts", { type: "rt_deal" }], ["records.completeness", { type: "rt_deal", recordId: rec }],
      ["records.relations_map", { type: "rt_deal", recordId: rec, hops: 2 }], ["records.history", { type: "rt_deal", recordId: rec }], ["records.activity", { type: "rt_deal", recordId: rec }],
      ["records.comments.list", { type: "rt_deal", recordId: rec }], ["records.versions", { type: "rt_deal", recordId: rec }], ["records.page_prefs.get", { type: "rt_deal" }],
      ["search.query", { q: "Acme" }], ["search.query", { q: "Deals" }], ["search.related", { subject: { type: "record", id: rec } }], ["search.resolve", { q: "Acme" }], ["search.recent.list", {}],
      ["projects.list", { type: "rt_deal" }], ["access.shares_of", { resource: deal }], ["access.record_marks", { type: "rt_deal" }],
    ];
    probes.push(["records.get", { type: "rt_note", recordId: noteId }], ["records.query", { type: "rt_note" }], ["records.relations_map", { type: "rt_note", recordId: noteId, hops: 2 }], ["schema.describe", { type: "rt_note" }], ["schema.types.get", { type: "rt_note" }], ["schema.describe", {}], ["schema.map", { type: "rt_note" }]);
    const leaks: string[] = [];
    for (const [cap, input] of probes) {
      const r = await D(cap, input);
      if (r.status === 200 && /rt_deal|Acme|Birch|Cedar|Dune|\bDeals?\b/.test(JSON.stringify(r.data))) leaks.push(`${cap} ${JSON.stringify(input).slice(0, 60)} -> ${JSON.stringify(r.data).slice(0, 160)}`);
    }
    assert.deepEqual(leaks, [], "Dee sees nothing of Deals anywhere");

    // the deal's folder in Files follows the deal: Dee cannot find it by id, in the tree, in Shared with me or in search
    const folderMade = await A("projects.files_folder", { type: "rt_deal", recordId: rec });
    assert.equal(folderMade.status, 200, JSON.stringify(folderMade.data));
    const dealFolder = folderMade.data.folderId as string;
    assert.ok(dealFolder);
    assert.equal((await A("files.create", { folderId: dealFolder, name: "Acme-contract-secret.txt", content: { text: "Acme renewal terms" } })).status, 200);
    for (const [cap, input] of [["files.folder.get", { folderId: dealFolder }], ["files.list", { folder: dealFolder }], ["files.list", { section: "shared" }], ["files.list", { section: "space" }], ["search.query", { q: "Acme-contract-secret" }], ["search.query", { q: "Acme renewal terms" }], ["files.tree", {}], ["projects.files_folder", { type: "rt_deal", recordId: rec, create: false }], ["access.lists", { type: "file", section: "shared" }], ["access.lists", { type: "folder", section: "space" }]] as const) {
      const r = await D(cap, input as never);
      assert.ok(r.status !== 200 || !/Acme|rt_deal/.test(JSON.stringify(r.data)), `${cap} shows Dee the deal's folder: ${JSON.stringify(r.data).slice(0, 200)}`);
    }
    assert.notEqual((await D("files.list", { folder: dealFolder })).status, 200, "the folder is refused to Dee");
    assert.equal((await C("files.list", { folder: dealFolder })).status, 200, "Cal, who can view the deal, can open its folder");

    // MCP and agent tool descriptions: what an agent is told it can use names no hidden type or record
    const desc = await D("schema.describe", {});
    assert.ok(!JSON.stringify(desc.data).includes("rt_deal"));

    // one deal is Only me before the export, so the export has a row Cal cannot see
    assert.equal((await A("access.audience_set", { resource: { type: "record", id: deals["Cedar upsell"] }, audience: "me" })).status, 200);
    assert.equal((await C("records.get", { type: "rt_deal", recordId: deals["Cedar upsell"] })).status, 403);
    assert.deepEqual(((await C("records.query", { type: "rt_deal" })).data.rows as Array<{ fields: { name: string } }>).map((r) => r.fields.name).sort(), ["Acme renewal", "Birch lease"]);
    assert.equal((await C("access.record_marks", { type: "rt_deal" })).data.rows.length, 0, "the row Cal cannot see is not listed to him");

    // Ada turns Can export on for Cal: he exports a CSV with only the rows he can see
    assert.equal((await A("access.share", { resource: deal, subject: { kind: "person", id: cal.id }, level: "view", export: true })).status, 200);
    assert.equal((await C("access.record_marks", { type: "rt_deal" })).data.can.export, true);
    const exported = await C("records.export", { type: "rt_deal", format: "csv" });
    assert.equal(exported.status, 200, JSON.stringify(exported.data) + hostLog(d));
    const csv = (await C("files.read", { fileId: exported.data.fileId, as: "text" })).data.text as string;
    assert.match(csv, /Acme renewal/);
    assert.match(csv, /Birch lease/);
    assert.doesNotMatch(csv, /Cedar upsell/, "the deal set to Only me is not in his export");
    assert.equal((await C("records.update", { type: "rt_deal", recordId: deals["Acme renewal"], patch: { stage: "lost" } })).status, 403, "export is not edit");
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
    { const r = await A("access.audience_set", { resource: deal, exporters: "admins" }); assert.equal(r.data.exporters, "admins", JSON.stringify(r.data)); }
    assert.equal((await B("records.export", { type: "rt_deal", format: "csv" })).status, 403);
    assert.equal((await C("records.export", { type: "rt_deal", format: "csv" })).status, 403, "the flag Ada gave Cal went with Admins only");

    // links to people outside the Space are off until the type's sheet turns them on
    assert.equal((await A("access.shares_of", { resource: deal })).data.outside, false);
    const view = await A("views.save", { type: "rt_deal", kind: "table", title: "All deals" });
    assert.equal(view.status, 200, JSON.stringify(view.data));
    const viewId = (view.data.view.viewId ?? view.data.view.id) as string;
    assert.equal((await A("views.share_external", { viewId })).status, 422, "off by default, even for an admin");
    assert.equal((await A("access.audience_set", { resource: deal, outside: true })).data.outside, true);
    assert.equal((await A("views.share_external", { viewId })).status, 200);
    assert.equal((await B("access.audience_set", { resource: deal, outside: false })).status, 403, "Bea cannot change it");
    assert.equal((await A("access.audience_set", { resource: deal, outside: false })).data.outside, false);

    // Ada puts Deals back to everyone: Dee sees it again
    assert.equal((await A("access.audience_set", { resource: deal, audience: "space" })).status, 200);
    assert.equal((await D("records.query", { type: "rt_deal" })).status, 200);
    assert.ok(((await D("schema.types.list")).data.types as Array<{ key: string }>).some((t) => t.key === "rt_deal"));
  } finally { await d.stop(); }
});
