// P-L8_19: the public form pages answer on a real booted daemon. The owner makes and publishes a form through the gateway, then a signed-out visitor (no token) reads GET /f/<slug>, is
// refused a draft with the same 404 as a form that never existed, and posts to /f/submit: an answer to a question the form's logic hides is dropped before the record is written.
// Path mapping: the packet owns host/src/routes/forms-page.ts; this test sits in host/tests because it boots the daemon.
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
const RECORD_TYPE = "rt_lead";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const LEAD = {
  op: "type.create", type: RECORD_TYPE,
  def: { title: "Lead", plural: "Leads", icon: "user", titleField: "email", fields: ["email", "kind", "company_name", "resume"].map((key) => ({ key, type: "text", title: key })) },
};

/** A fresh Space the owner claims and signs in to (ruling 71), the way a person gets in; the returned token is a real session. */
async function boot(): Promise<{ d: Daemon; owner: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-forms-page-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_forms", "--space-name", "Forms Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "forms-page", free: 80e9,
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
  const claimed = await post("/v1/identity/claim_owner", { code, spaceId: "spc_forms", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post("/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const owner = signedIn.json.data.session.token as string;
  const type = await post("/v1/schema/apply", { idempotencyKey: "forms-page-type", ops: [LEAD] }, owner);
  assert.equal(type.status, 200, JSON.stringify(type.json));
  return { d, owner };
}

async function call<T>(d: Daemon, owner: string, p: string, body: unknown, token: string | null = owner): Promise<{ status: number; data?: T; error?: { code: string; details?: { field?: string } } }> {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: T; error?: { code: string; details?: { field?: string } } };
  return { status: r.status, ...j };
}

async function makeForm(d: Daemon, owner: string, name: string, publish: boolean): Promise<{ formId: string; slug: string }> {
  const made = await call<{ form: { formId: string; slug: string } }>(d, owner, "/v1/forms/create", { name, recordType: RECORD_TYPE, kind: "public", idempotencyKey: `forms-page-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made));
  const { formId, slug } = made.data!.form;
  const fields = await call(d, owner, "/v1/forms/fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "kind", mode: "ask" }, { field: "company_name", mode: "ask" }, { field: "resume", mode: "ask" }] });
  assert.equal(fields.status, 200, JSON.stringify(fields));
  const policy = await call(d, owner, "/v1/forms/update", { formId, uploadPolicy: { fields: ["resume"], folderId: "fld_forms_uploads", maxBytes: 1_000_000 } });
  assert.equal(policy.status, 200, JSON.stringify(policy));
  const design = await call(d, owner, "/v1/forms/design_set", { formId, logic: { rules: [{ when: { field: "kind", op: "eq", value: "company" }, show: ["company_name"] }] } });
  assert.equal(design.status, 200, JSON.stringify(design));
  if (publish) assert.equal((await call(d, owner, "/v1/forms/publish", { formId })).status, 200);
  return { formId, slug };
}

test("a booted daemon serves a published form to a signed-out visitor, hides a draft, and drops a hidden question's answer at submit", async () => {
  const { d, owner } = await boot();
  try {
    const open = await makeForm(d, owner, "Page open", true);
    const draft = await makeForm(d, owner, "Page draft", false);

    const page = await fetch(`${d.url}/f/${open.slug}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    const html = await page.text();
    assert.match(html, /<title>Page open<\/title>/);
    assert.match(html, /data-field="email"/);
    assert.match(html, /data-field="company_name"/);
    assert.match(html, /"logic":\{"rules":\[/, "the logic travels with the page so the browser can show and hide");

    for (const slug of [draft.slug, "no-such-form"]) {
      const r = await fetch(`${d.url}/f/${slug}`);
      assert.equal(r.status, 404, slug);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, "validation.not_found");
    }
    assert.equal((await fetch(`${d.url}/book/${open.slug}`)).status, 404, "a public form has no booking address");

    // the owner's gateway still works beside the page route
    assert.equal((await call(d, owner, "/v1/forms/list", {})).status, 200);

    const sent = await call<{ recordId: string }>(d, owner, "/f/submit", { slug: open.slug, idempotencyKey: "forms-page-submit-1", answers: { email: "visitor@x.example", kind: "person", company_name: "Hidden Co" } }, null);
    assert.equal(sent.status, 200, JSON.stringify(sent));
    const rec = await call<{ record: { fields: Record<string, unknown> } }>(d, owner, "/v1/records/get", { type: RECORD_TYPE, recordId: sent.data!.recordId });
    assert.equal(rec.status, 200, JSON.stringify(rec));
    assert.equal(rec.data!.record.fields["email"], "visitor@x.example");
    assert.equal(rec.data!.record.fields["kind"], "person");
    assert.equal(rec.data!.record.fields["company_name"], undefined, "the answer to a hidden question is never written");

    // a visitor cannot attach a file that already exists in the Space: a file answer must be an upload id this form issued to this visitor
    const stolen = await call(d, owner, "/f/submit", { slug: open.slug, idempotencyKey: "forms-page-submit-2", answers: { email: "thief@x.example", resume: { fileId: "fil_internal_secret" } } }, null);
    assert.equal(stolen.status, 422, JSON.stringify(stolen));
    assert.equal(stolen.error?.code, "validation.bad_input");
  } finally { await d.stop(); }
});
