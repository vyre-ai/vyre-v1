// Publisher-approved public choices on a real booted daemon: the owner publishes a bounded list of companies and people for a relation and a person question, a signed-out visitor sees only labels and
// opaque keys, and every attack (a guessed record id, a key from another form or question, a deleted record, a record raised above the public ceiling, 201 choices) is refused with nothing written.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const LEAD = "rt_lead";
const COMPANY = "rt_company";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";

/** A fresh Space the owner claims and signs in to (ruling 71), the way a person gets in; the returned token is a real session. */
async function boot(): Promise<{ d: Daemon; owner: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-forms-choices-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_choices", "--space-name", "Forms Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "forms-choices", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (p: string, body: unknown, token?: string): Promise<{ status: number; json: { data?: any } }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post("/v1/identity/claim_owner", { code, spaceId: "spc_choices", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post("/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const owner = signedIn.json.data.session.token as string;
  const companies = await post("/v1/schema/apply", { idempotencyKey: "choices-company", ops: [{ op: "type.create", type: COMPANY, def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name" }, { key: "notes", type: "text", title: "Notes" }] } }] }, owner);
  assert.equal(companies.status, 200, JSON.stringify(companies.json));
  const leads = await post("/v1/schema/apply", { idempotencyKey: "choices-lead", ops: [{ op: "type.create", type: LEAD, def: { title: "Lead", plural: "Leads", icon: "user", titleField: "email", fields: [{ key: "email", type: "text", title: "Email" }, { key: "company", type: "relation", title: "Company", required: true, options: { target: COMPANY } }, { key: "owner", type: "person", title: "Owner" }] } }] }, owner);
  assert.equal(leads.status, 200, JSON.stringify(leads.json));
  return { d, owner };
}

async function call<T>(d: Daemon, owner: string, p: string, body: unknown, token: string | null = owner): Promise<{ status: number; data?: T; error?: { code: string; details?: { field?: string } } }> {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: T; error?: { code: string; details?: { field?: string } } };
  return { status: r.status, ...j };
}


const post = async <T>(d: Daemon, p: string, body: unknown, token: string | null): Promise<{ status: number; data?: T; error?: { code: string; message?: string } }> => {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, ...((await r.json()) as object) };
};
async function company(d: Daemon, owner: string, name: string, notes = "private notes"): Promise<string> {
  const r = await post<{ record: { id: string } }>(d, "/v1/records/create", { type: COMPANY, fields: { name, notes }, idempotencyKey: `choices-co-${name}` }, owner);
  assert.equal(r.status, 200, JSON.stringify(r));
  return r.data!.record.id;
}
async function lead(d: Daemon, owner: string, name: string): Promise<{ formId: string; slug: string }> {
  const made = await post<{ form: { formId: string; slug: string } }>(d, "/v1/forms/create", { name, recordType: LEAD, kind: "public", idempotencyKey: `choices-form-${name}` }, owner);
  assert.equal(made.status, 200, JSON.stringify(made));
  const { formId, slug } = made.data!.form;
  assert.equal((await post(d, "/v1/forms/fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "company", mode: "ask" }, { field: "owner", mode: "ask" }] }, owner)).status, 200);
  return { formId, slug };
}
const picks = async (d: Daemon, owner: string, formId: string) => (await post<{ choices: Record<string, { key: string; refId: string; label: string }[]> }>(d, "/v1/forms/get", { formId }, owner)).data!.choices;

test("publisher-approved choices: labels only on the public page, one real relation per pick, every attack refused", async () => {
  const { d, owner } = await boot();
  try {
    const acme = await company(d, owner, "Northwind Traders"), globex = await company(d, owner, "Contoso Supply");
    const form = await lead(d, owner, "Choices form"), other = await lead(d, owner, "Other form");
    const you = (await post<{ principals: { id: string; kind: string; name?: string }[] }>(d, "/v1/access/principals/list", { kind: "person" }, owner)).data!.principals[0]!;

    // the publish guard holds until the publisher picks the choices
    const blocked = await post(d, "/v1/forms/publish", { formId: form.formId }, owner);
    assert.equal(blocked.status, 422, JSON.stringify(blocked));
    assert.match(JSON.stringify(blocked), /Company.*publisher-approved/);
    const cand = await post<{ candidates: { refId: string; label: string }[] }>(d, "/v1/forms/choices_candidates", { formId: form.formId, field: "company" }, owner);
    assert.equal(cand.status, 200, JSON.stringify(cand));
    assert.deepEqual(cand.data!.candidates.map((c) => c.label).sort(), ["Contoso Supply", "Northwind Traders"]);
    assert.ok(!JSON.stringify(cand.data).includes("private notes"), "candidates carry labels, never other record data");

    assert.equal((await post(d, "/v1/forms/choices_set", { formId: form.formId, field: "company", choices: [{ refId: acme }, { refId: globex }] }, owner)).status, 200);
    assert.equal((await post(d, "/v1/forms/choices_set", { formId: other.formId, field: "company", choices: [{ refId: globex }] }, owner)).status, 200);
    assert.equal((await post(d, "/v1/forms/choices_set", { formId: form.formId, field: "owner", choices: [{ refId: you.id }] }, owner)).status, 200);
    assert.equal((await post(d, "/v1/forms/publish", { formId: form.formId }, owner)).status, 200);
    assert.equal((await post(d, "/v1/forms/publish", { formId: other.formId }, owner)).status, 200);

    // the public page: labels and opaque keys only
    const html = await (await fetch(`${d.url}/f/${form.slug}`)).text();
    assert.match(html, /<option value="chc_[A-Za-z0-9_-]+">Northwind Traders<\/option>/);
    assert.match(html, /<option value="chc_[A-Za-z0-9_-]+">Contoso Supply<\/option>/);
    for (const secret of [acme, globex, you.id, "private notes"]) assert.ok(!html.includes(secret), `the page leaked ${secret}`);

    const mine = await picks(d, owner, form.formId), theirs = await picks(d, owner, other.formId);
    const keyAcme = mine["company"]!.find((c) => c.refId === acme)!.key, keyOther = theirs["company"]![0]!.key;
    const submit = (answers: Record<string, unknown>, n: string) => post<{ recordId: string }>(d, "/f/submit", { slug: form.slug, idempotencyKey: `choices-${n}`, answers: { email: `v${n}@x.example`, ...answers } }, null);

    // attacks: a guessed record id, a key from another form, an invented key, a list, a person id where a key belongs
    for (const [n, bad] of [["1", acme], ["2", keyOther], ["3", "chc_notarealkey0001"], ["4", [keyAcme, "chc_notarealkey0001"]], ["5", you.id], ["6", { urn: acme }]] as const) {
      const r = await submit({ company: bad }, n);
      assert.equal(r.status, 422, `${n}: ${JSON.stringify(r)}`);
    }
    // a key from the company question cannot answer the person question either
    assert.equal((await submit({ owner: keyAcme }, "7")).status, 422);

    // a real pick lands as a real relation, and a person pick stores the member
    const ok = await submit({ company: keyAcme, owner: mine["owner"]![0]!.key }, "8");
    assert.equal(ok.status, 200, JSON.stringify(ok));
    const rec = await post<{ record: { fields: Record<string, unknown> } }>(d, "/v1/records/get", { type: LEAD, recordId: ok.data!.recordId }, owner);
    assert.ok(JSON.stringify(rec.data!.record.fields["company"]).includes(acme), JSON.stringify(rec.data));
    assert.equal(rec.data!.record.fields["owner"], you.id);

    // a record raised above the public ceiling stops being accepted at submit, with the same generic refusal
    { const sl = await post(d, "/v1/schema/set_label", { type: COMPANY, label: "confidential" }, owner); assert.equal(sl.status, 200, JSON.stringify(sl)); }
    assert.equal((await submit({ company: keyAcme }, "9")).status, 422);
    assert.equal((await post(d, "/v1/schema/set_label", { type: COMPANY, label: "public" }, owner)).status, 200);
    assert.equal((await submit({ company: keyAcme }, "10")).status, 200);

    // a deleted record stops being accepted
    assert.equal((await post(d, "/v1/records/delete", { type: COMPANY, recordId: acme }, owner)).status, 200);
    assert.equal((await submit({ company: keyAcme }, "11")).status, 422);

    // over the ceiling at publish time: the publisher cannot offer it; 201 choices are refused whole
    assert.equal((await post(d, "/v1/schema/set_label", { type: COMPANY, label: "restricted" }, owner)).status, 200);
    const high = await post(d, "/v1/forms/choices_set", { formId: other.formId, field: "company", choices: [{ refId: globex }] }, owner);
    assert.ok(high.status >= 400 && /Confidential|Restricted/.test(JSON.stringify(high)), JSON.stringify(high));
    const many = await post(d, "/v1/forms/choices_set", { formId: other.formId, field: "company", choices: Array.from({ length: 201 }, (_, i) => ({ refId: `rec_${i}` })) }, owner);
    assert.equal(many.status, 422, JSON.stringify(many));

    // a signed-out caller cannot publish choices or read candidates
    assert.ok((await post(d, "/v1/forms/choices_set", { formId: form.formId, field: "company", choices: [{ refId: globex }] }, null)).status >= 401);
    assert.ok((await post(d, "/v1/forms/choices_candidates", { formId: form.formId, field: "company" }, null)).status >= 401);
  } finally { await d.stop(); }
});

test("a form published by a non-owner stops accepting a choice when that publisher loses access", async () => {
  const { d, owner } = await boot();
  try {
    const invite = await post<{ link: string }>(d, "/v1/members/invites/create", { role: "rol_member", idempotencyKey: "choices-invite" }, owner);
    assert.equal(invite.status, 200, JSON.stringify(invite));
    const code = decodeURIComponent(new URL(invite.data!.link).pathname.split("/").pop() ?? "");
    const joined = await post<{ personId: string; token: string }>(d, "/v1/members/accept", { code, username: "pia", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS }, null);
    assert.equal(joined.status, 200, JSON.stringify(joined));
    const { personId, token: pia } = joined.data!;
    // Pia owns the company record she offers, and publishes her own form
    const acme = (await post<{ record: { id: string } }>(d, "/v1/records/create", { type: COMPANY, fields: { name: "Pia Partners" }, idempotencyKey: "choices-pia-co" }, pia));
    assert.equal(acme.status, 200, JSON.stringify(acme));
    const made = await post<{ form: { formId: string; slug: string } }>(d, "/v1/forms/create", { name: "Pia form", recordType: LEAD, kind: "public", idempotencyKey: "choices-pia-form" }, pia);
    assert.equal(made.status, 200, JSON.stringify(made));
    const { formId, slug } = made.data!.form;
    assert.equal((await post(d, "/v1/forms/fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "company", mode: "ask" }] }, pia)).status, 200);
    const set = await post(d, "/v1/forms/choices_set", { formId, field: "company", choices: [{ refId: acme.data!.record.id }] }, pia);
    assert.equal(set.status, 200, JSON.stringify(set));
    assert.equal((await post(d, "/v1/forms/publish", { formId }, pia)).status, 200);
    const key = (await post<{ choices: Record<string, { key: string }[]> }>(d, "/v1/forms/get", { formId }, pia)).data!.choices["company"]![0]!.key;
    const submit = (n: string) => post<{ recordId: string }>(d, "/f/submit", { slug, idempotencyKey: `choices-pia-${n}`, answers: { email: `p${n}@x.example`, company: key } }, null);
    assert.equal((await submit("1")).status, 200, "while Pia can see the record, the pick is accepted");
    assert.equal((await post(d, "/v1/members/suspend", { personId }, owner)).status, 200);
    const after = await submit("2");
    assert.ok(after.status === 422 || after.status === 403, `a suspended publisher's choices are refused: ${JSON.stringify(after)}`);
  } finally { await d.stop(); }
});
