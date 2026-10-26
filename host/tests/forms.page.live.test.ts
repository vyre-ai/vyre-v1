// P-L8_19: the public form pages answer on a real booted daemon. The owner makes and publishes a form through the gateway, then a signed-out visitor (no token) reads GET /f/<slug>, is
// refused a draft with the same 404 as a form that never existed, and posts to /f/submit: an answer to a question the form's logic hides is dropped before the record is written.
// Path mapping: the packet owns host/src/routes/forms-page.ts; this test sits in host/tests because it boots the daemon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const OWNER = "tok-usr_olivia";
const RECORD_TYPE = "rt_contact";

function seededDir(): string {
  const core = bootCore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-forms-page-"));
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(): Promise<Daemon> {
  const dir = seededDir();
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
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
}

async function call<T>(d: Daemon, p: string, body: unknown, token: string | null = OWNER): Promise<{ status: number; data?: T; error?: { code: string; details?: { field?: string } } }> {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: T; error?: { code: string; details?: { field?: string } } };
  return { status: r.status, ...j };
}

async function makeForm(d: Daemon, name: string, publish: boolean): Promise<{ formId: string; slug: string }> {
  const made = await call<{ form: { formId: string; slug: string } }>(d, "/v1/forms/create", { name, recordType: RECORD_TYPE, kind: "public", idempotencyKey: `forms-page-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made));
  const { formId, slug } = made.data!.form;
  const fields = await call(d, "/v1/forms/fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "kind", mode: "ask" }, { field: "company_name", mode: "ask" }] });
  assert.equal(fields.status, 200, JSON.stringify(fields));
  const design = await call(d, "/v1/forms/design_set", { formId, logic: { rules: [{ when: { field: "kind", op: "eq", value: "company" }, show: ["company_name"] }] } });
  assert.equal(design.status, 200, JSON.stringify(design));
  if (publish) assert.equal((await call(d, "/v1/forms/publish", { formId })).status, 200);
  return { formId, slug };
}

test("a booted daemon serves a published form to a signed-out visitor, hides a draft, and drops a hidden question's answer at submit", async () => {
  const d = await boot();
  try {
    const open = await makeForm(d, "Page open", true);
    const draft = await makeForm(d, "Page draft", false);

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
    assert.equal((await call(d, "/v1/forms/list", {})).status, 200);

    const sent = await call<{ recordId: string }>(d, "/f/submit", { slug: open.slug, idempotencyKey: "forms-page-submit-1", answers: { email: "visitor@x.example", kind: "person", company_name: "Hidden Co" } }, null);
    assert.equal(sent.status, 200, JSON.stringify(sent));
    const rec = await call<{ record: { fields: Record<string, unknown> } }>(d, "/v1/records/get", { type: RECORD_TYPE, recordId: sent.data!.recordId });
    assert.equal(rec.status, 200, JSON.stringify(rec));
    assert.equal(rec.data!.record.fields["email"], "visitor@x.example");
    assert.equal(rec.data!.record.fields["kind"], "person");
    assert.equal(rec.data!.record.fields["company_name"], undefined, "the answer to a hidden question is never written");
  } finally { await d.stop(); }
});
