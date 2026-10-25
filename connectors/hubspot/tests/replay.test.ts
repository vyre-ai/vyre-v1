// Replay of the HubSpot connector on recorded pages (spec 2.10): connector.toml compiles, equals the frozen contract entry, every recorded case passes,
// pages upsert into a local store without duplicates, and the two-way switches are off until a person turns them on.
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { compileConnector, ConnectorFileError, loadHubspot, parseToml, planPush, pullRows, readPage, replayAction, replayCase, PageError, TomlError } from "../src/index.ts";
import type { Compiled, LocalRecord, LocalStore, RemoteRow } from "../src/index.ts";
import manifest from "../../../manifests/connectors/hubspot.ts";

const c: Compiled = loadHubspot();
const contactT = c.syncedTypes.find((t) => t.type === "contact")!;
const companyT = c.syncedTypes.find((t) => t.type === "company")!;

/** A local store in memory: records by id, and what was written. */
function memory(seed: LocalRecord[] = []): LocalStore & { rows: Map<string, LocalRecord>; writes: string[] } {
  const rows = new Map(seed.map((r) => [r.id, { id: r.id, data: { ...r.data } }]));
  const writes: string[] = [];
  let n = 0;
  return {
    rows, writes,
    all: () => [...rows.values()],
    create: (data, remoteId) => { const r = { id: `rec_${++n}`, data: { ...data } }; rows.set(r.id, r); writes.push(`create ${remoteId}`); return r; },
    update: (id, patch) => { const r = rows.get(id)!; r.data = { ...r.data, ...patch }; writes.push(`update ${id} ${Object.keys(patch).join(",")}`); },
  };
}

/** Pull every page of an object through the connector's own list actions, replaying the recorded answers. */
function listAll(object: "contacts" | "companies"): { rows: RemoteRow[]; sent: number; cursors: (string | undefined)[] } {
  const rows: RemoteRow[] = [];
  const cursors: (string | undefined)[] = [];
  let cursor: string | undefined;
  let sent = 0;
  for (let guard = 0; guard < 10; guard++) {
    const name = cursor ? `list_${object}_after` : `list_${object}`;
    const action = c.def.actions.find((a) => a.name === name)!;
    const recorded = c.def.tests.find((t) => t.action === name)!.responses;
    const res = replayAction(c, action, { limit: 2, ...(cursor ? { cursor } : {}) }, recorded);
    sent += res.sent.length;
    cursors.push(res.sent[0]!.query["after"]);
    const page = readPage(res.output);
    rows.push(...page.rows);
    if (!page.next) break;
    cursor = page.next;
  }
  return { rows, sent, cursors };
}

test("the toml reader handles tables, nested arrays of tables, inline tables, multi-line arrays and comments", () => {
  const t = parseToml(`
# comment
a = "x # not a comment"  # comment
b = [
  1, 2,
  3,
]
[[t]]
n = 1
[[t.u]]
k = 'lit'
[[t.u]]
k = "two\\n"
[[t]]
n = 2
inline = { p = true, q = { r = 1.5 } }
[s]
z = false
`);
  assert.equal(t["a"], "x # not a comment");
  assert.deepEqual(t["b"], [1, 2, 3]);
  assert.deepEqual(t["t"], [{ n: 1, u: [{ k: "lit" }, { k: "two\n" }] }, { n: 2, inline: { p: true, q: { r: 1.5 } } }]);
  assert.deepEqual(t["s"], { z: false });
});

test("the toml reader names the line of a mistake", () => {
  assert.throws(() => parseToml("a = 1\nb"), (e: unknown) => e instanceof TomlError && e.line === 2);
  assert.throws(() => parseToml("a = 1\na = 2"), (e: unknown) => e instanceof TomlError && e.line === 2);
  assert.throws(() => parseToml("a = \"open"), (e: unknown) => e instanceof TomlError && e.line === 1);
  assert.throws(() => parseToml("a = bare"), TomlError);
  assert.throws(() => parseToml("a = [1, 2"), TomlError);
  assert.throws(() => parseToml("[[x]]\n[x]"), TomlError);
});

test("connector.toml compiles to the entry the frozen contract holds", () => {
  const entry = (manifest.connectors ?? [])[0];
  assert.ok(entry, "manifests/connectors/hubspot.ts declares the connector");
  assert.deepEqual(c.contract, {
    key: entry.key, title: entry.title, mode: entry.mode, scope: entry.scope, auth: entry.auth, domains: entry.domains, secrets: entry.secrets, sources: entry.sources,
    syncedTypes: entry.syncedTypes, actions: entry.actions, rate: entry.rate, health: entry.health, tests: entry.tests,
  });
});

test("the runtime definition: oauth sign-in on declared domains, the token named not held, health is an action", () => {
  assert.equal(c.def.key, "hubspot");
  assert.deepEqual(c.def.domains, ["api.hubapi.com", "app.hubspot.com"]);
  assert.equal(c.def.auth.secret, "HubSpot_Token");
  assert.ok(c.def.secrets.some((s) => s.name === "HubSpot_Token"));
  assert.ok(c.def.actions.some((a) => a.name === c.def.health));
  assert.deepEqual(c.def.syncedTypes, ["contacts", "companies"]);
  assert.deepEqual(c.def.sources, ["webhook"]);
  for (const a of c.def.actions) assert.ok(c.def.domains.includes(new URL(a.url).hostname), `${a.name} stays on a declared domain`);
  for (const a of c.def.actions.filter((x) => x.method && x.method !== "GET")) assert.equal(a.write, true, `${a.name} is a write`);
  assert.ok(!JSON.stringify(c.def).includes("pat-na"), "no token value in the definition");
  for (const a of c.def.actions) assert.ok(!a.url.includes("{secret."), "a secret is never part of an address");
});

test("every recorded case in connector.toml passes", () => {
  assert.ok(c.def.tests.length >= 7);
  for (const t of c.def.tests) {
    const r = replayCase(c, t);
    assert.ok(r.ok, `${t.name}: ${r.message ?? ""}`);
  }
});

test("a rejected token and a rate limit map to their own errors; an unrecorded call is refused", () => {
  const auth = c.def.tests.find((t) => t.name.includes("rejected token"))!;
  const limit = c.def.tests.find((t) => t.name.includes("rate limiting"))!;
  const a = replayAction(c, c.def.actions.find((x) => x.name === auth.action)!, {}, auth.responses);
  assert.equal(a.error, "provider.auth_failed");
  const l = replayAction(c, c.def.actions.find((x) => x.name === limit.action)!, limit.input, limit.responses);
  assert.equal(l.error, "provider.rate_limited");
  assert.throws(() => replayAction(c, c.def.actions.find((x) => x.name === "test_connection")!, {}, []), /no recorded response/);
  assert.throws(() => replayAction({ ...c, def: { ...c.def, domains: ["example.test"] } }, c.def.actions[0]!, {}, []), /egress refused/);
});

test("pages follow the cursor: the first call has no after, the second carries it", () => {
  const got = listAll("contacts");
  assert.deepEqual(got.cursors, [undefined, "NTI1Cg"]);
  assert.equal(got.sent, 2);
  assert.deepEqual(got.rows.map((r) => r.id), ["501", "502", "503"]);
});

test("a page that is not a HubSpot list is refused with a clear message", () => {
  assert.throws(() => readPage({ status: "error" }), PageError);
  assert.throws(() => readPage({ results: [{ properties: {} }] }), /no id/);
  assert.deepEqual(readPage({ results: [] }), { rows: [] });
});

test("contacts upsert from recorded pages: created once, a second pass changes nothing", () => {
  const { rows } = listAll("contacts");
  const store = memory();
  const links = new Map<string, string>();
  const first = pullRows(contactT, rows, store, links);
  assert.deepEqual({ created: first.created, updated: first.updated, unchanged: first.unchanged }, { created: 3, updated: 0, unchanged: 0 });
  assert.equal(store.rows.size, 3);
  const ann = store.rows.get(links.get("501")!)!;
  assert.deepEqual(ann.data, { name: "Ann", email: "ann.baker@example.test", phone: "+1 555 0101" });
  assert.equal(store.rows.get(links.get("502")!)!.data["phone"], null, "an empty HubSpot property is null here");
  const again = pullRows(contactT, rows, store, links);
  assert.deepEqual({ created: again.created, updated: again.updated, unchanged: again.unchanged }, { created: 0, updated: 0, unchanged: 3 });
  assert.equal(store.writes.length, 3);
});

test("a changed property updates only that field", () => {
  const { rows } = listAll("contacts");
  const store = memory();
  const links = new Map<string, string>();
  pullRows(contactT, rows, store, links);
  store.writes.length = 0;
  const moved = rows.map((r) => (r.id === "503" ? { ...r, data: { ...r.data, phone: "+1 555 0199" } } : r));
  const rep = pullRows(contactT, moved, store, links);
  assert.deepEqual({ updated: rep.updated, unchanged: rep.unchanged }, { updated: 1, unchanged: 2 });
  assert.deepEqual(store.writes, [`update ${links.get("503")} phone`]);
});

test("the first sync pairs by email without regard to case, and keeps local values where HubSpot is empty", () => {
  const { rows } = listAll("contacts");
  const store = memory([{ id: "loc_omar", data: { name: "Omar R.", email: " Omar.Reyes@Example.test ", phone: "+1 555 0777" } }]);
  const links = new Map<string, string>();
  const rep = pullRows(contactT, rows, store, links);
  assert.equal(rep.linked, 1);
  assert.equal(rep.created, 2);
  assert.equal(links.get("502"), "loc_omar");
  assert.equal(store.rows.get("loc_omar")!.data["name"], "Omar", "a pulled field follows HubSpot");
  assert.equal(store.rows.get("loc_omar")!.data["phone"], "+1 555 0777", "HubSpot has no phone: the local one stays on the first sync");
  assert.equal(store.rows.size, 3, "no duplicate");
});

test("rows that cannot be matched safely are reported, not guessed", () => {
  const row = (id: string, email: string | null): RemoteRow => ({ id, data: { firstname: "X", email, phone: null }, updatedAt: "", archived: false });
  const store = memory([{ id: "a", data: { email: "dup@example.test" } }, { id: "b", data: { email: "dup@example.test" } }]);
  const rep = pullRows(contactT, [row("1", "dup@example.test"), row("2", null), row("3", "")], store, new Map());
  assert.equal(rep.created, 0);
  assert.equal(rep.skipped.length, 3);
  assert.match(rep.skipped[0]!.reason, /share email/);
  assert.match(rep.skipped[1]!.reason, /no email/);
});

test("an archived contact is reported as removed at source and never deleted here", () => {
  const { rows } = listAll("contacts");
  const store = memory();
  const links = new Map<string, string>();
  pullRows(contactT, rows, store, links);
  const archived = rows.map((r) => (r.id === "502" ? { ...r, archived: true } : r));
  const rep = pullRows(contactT, archived, store, links);
  assert.deepEqual(rep.removedAtSource, ["502"]);
  assert.equal(store.rows.size, 3);
  assert.equal(contactT.deletes, "off");
});

test("companies pull the domain, match on it, and skip a company with no domain", () => {
  const rows = readPage(c.def.tests.find((t) => t.action === "list_companies")!.responses[0]!.body).rows;
  const store = memory();
  const links = new Map<string, string>();
  const rep = pullRows(companyT, rows, store, links);
  assert.equal(rep.created, 1);
  assert.equal(rep.skipped.length, 1);
  assert.match(rep.skipped[0]!.reason, /no website/);
  assert.deepEqual(store.rows.get(links.get("9001")!)!.data, { name: "Acme Legal", website: "acmelegal.example.test" });
});

test("two-way is off by default: nothing is created or deleted in HubSpot, and conflicts on people ask", () => {
  for (const t of c.syncedTypes) {
    assert.equal(t.createAtSource, false, `${t.type}: create at source is off`);
    assert.equal(t.deletes, "off", `${t.type}: deletes stay home`);
  }
  assert.equal(contactT.conflict, "ask");
  const noRemote = planPush(contactT, { patch: { name: "New" } });
  assert.deepEqual(noRemote, { skip: "create at source is off for this type" });
  const on = planPush({ ...contactT, createAtSource: true }, { patch: { name: "New", email: "n@example.test" } });
  assert.ok("push" in on && on.push.action === "create_contact");
});

test("a push carries only fields set to push or both, and keeps the replaced value for undo", () => {
  const plan = planPush(companyT, { remoteId: "9001", patch: { name: "Acme LLP", website: "other.example.test" }, remoteNow: { name: "Acme Legal", domain: "acmelegal.example.test" } });
  assert.ok("push" in plan);
  if (!("push" in plan)) return;
  assert.equal(plan.push.action, "update_company");
  assert.deepEqual(plan.push.input, { id: "9001", properties: { name: "Acme LLP" } }, "website is pull only and does not travel");
  assert.deepEqual(plan.push.fields, ["name"]);
  assert.deepEqual(plan.replaced, { name: "Acme Legal" });
  assert.deepEqual(planPush(companyT, { remoteId: "9001", patch: { website: "x.example.test" } }), { skip: "no field of this change is set to push" });
  const contact = planPush(contactT, { remoteId: "501", patch: { phone: null } });
  assert.ok("push" in contact);
  if ("push" in contact) assert.deepEqual(contact.push.input.properties, { phone: "" }, "clearing a value sends an empty property");
});

test("the push actions replay against the recorded update", () => {
  const plan = planPush(contactT, { remoteId: "501", patch: { phone: "+1 555 0100" } });
  assert.ok("push" in plan);
  if (!("push" in plan)) return;
  const action = c.def.actions.find((a) => a.name === plan.push.action)!;
  const t = c.def.tests.find((x) => x.action === "update_contact")!;
  const res = replayAction(c, action, plan.push.input, t.responses);
  assert.deepEqual(res.sent[0], { method: "PATCH", url: "https://api.hubapi.com/crm/v3/objects/contacts/501", query: {}, body: { properties: { phone: "+1 555 0100" } } });
  assert.equal((res.output as { properties: { phone: string } }).properties.phone, "+1 555 0100");
});

test("a connector file with a mistake is refused with the place of the mistake", () => {
  const base = join(dirname(fileURLToPath(import.meta.url)), "..");
  const toml = readFileSync(join(base, "connector.toml"), "utf8");
  const build = (edit: (s: string) => string) => compileConnector(edit(toml), (rel) => readFileSync(join(base, rel), "utf8"));
  assert.doesNotThrow(() => build((s) => s));
  assert.throws(() => build((s) => s.replace('dir = "both"', 'dir = "sideways"')), (e: unknown) => e instanceof ConnectorFileError && /dir must be one of/.test(e.message));
  assert.throws(() => build((s) => s.replace('match = ["email"]', 'match = ["mail"]')), /match field mail is not mapped/);
  assert.throws(() => build((s) => s.replace('health = "test_connection"', 'health = "nope"')), /nope is not an action/);
  assert.throws(() => build((s) => s.replace('secret = "HubSpot_Token"', 'secret = "Other"')), /Other is not declared/);
  assert.throws(() => build((s) => s.replace('file = "tests/recorded/account-details.json"', 'file = "tests/recorded/missing.json"')), /not a readable JSON file/);
});
