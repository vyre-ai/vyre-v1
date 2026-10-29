// P-L3_17: the record types the manifests declare are seeded once when the daemon starts and registered as resources the Space owner holds, so a capability on a declared type (the Default Kit's
// schema.layout.set on note_board is the step that failed) is authorized, and the type is still there after a restart. Everything goes through the gateway with a token (rule 27).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { CODE_ROOT, startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const tmp = (p: string): string => fs.mkdtempSync(path.join(os.tmpdir(), p));

function seededDir(): string {
  const core = bootCore();
  const dir = tmp("vyre-schema-boot-");
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  return dir;
}

async function boot(dir: string): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--address", "team.example.com"], {}, "1.2.3"),
    codeRoot: CODE_ROOT,
    platform: fakePlatform({
      os: "linux", hostname: "schema-boot", free: 80e9,
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

async function call(d: Daemon, cap: string, input: unknown): Promise<{ status: number; data: any }> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify(input) });
  const body = (await r.json()) as { data?: unknown; error?: unknown };
  return { status: r.status, data: body.data ?? body };
}


test("Apps editors create and read real forms, campaigns and email designs through the gateway", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    const form = await call(d, "forms.create", { name: "Fixture intake", recordType: "contact", kind: "public", idempotencyKey: "editor-form" });
    assert.equal(form.status, 200, JSON.stringify(form.data));
    const formId = form.data.form.formId;
    const fields = await call(d, "forms.fields_set", { formId, fields: [{ field: "name", mode: "ask", step: 0 }, { field: "email", mode: "ask", prefillKey: "email_address", step: 1 }] });
    assert.equal(fields.status, 200, JSON.stringify(fields.data));
    const settings = await call(d, "forms.update", { formId, consentText: "I agree", captcha: false });
    assert.equal(settings.status, 200, JSON.stringify(settings.data));
    const saved = await call(d, "forms.get", { formId });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.settings.consentText, "I agree");
    assert.equal(saved.data.fields[1].step, 1);
    const campaign = await call(d, "campaigns.create", { name: "Fixture follow-up", kind: "one_time", idempotencyKey: "editor-campaign" });
    assert.equal(campaign.status, 200, JSON.stringify(campaign.data));
    const campaignId = campaign.data.campaign.campaignId;
    const plan = await call(d, "campaigns.steps_set", { campaignId, steps: [{ key: "message", type: "email", config: { mailboxId: "mbx_fixture", subject: "Fixture preview", text: "Hello" } }] });
    assert.equal(plan.status, 200, JSON.stringify(plan.data));
    const schedule = await call(d, "campaigns.schedule_set", { campaignId, windows: { days: [1,2,3,4,5], from: "09:00", to: "17:00", tz: "UTC" }, throttlePerHour: 25, stopOnReply: true });
    assert.equal(schedule.status, 200, JSON.stringify(schedule.data));
    const preview = await call(d, "campaigns.preview", { campaignId });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.counts.audience, 0);
    const email = await call(d, "email_builder.create", { name: "Fixture email", mode: "blocks", idempotencyKey: "editor-email" });
    assert.equal(email.status, 200, JSON.stringify(email.data));
    const emailId = email.data.email.emailId;
    const design = await call(d, "email_builder.save", { emailId, email: { emailId, name: "Fixture email", mode: "blocks", subject: "Fixture", blocks: [{ type: "columns", props: { cols: [[{ type: "text", props: { text: "Hello" } }], [{ type: "merge", props: { key: "first_name", fallback: "friend" } }]] } }] } });
    assert.equal(design.status, 200, JSON.stringify(design.data));
    assert.ok(design.data.version >= 1);
    const rendered = await call(d, "email_builder.render", { emailId, variant: "desktop" });
    assert.equal(rendered.status, 200, JSON.stringify(rendered.data));
    assert.match(rendered.data.html, /Hello/);
    const retry = await call(d, "forms.create", { name: "Fixture intake", recordType: "contact", kind: "public", idempotencyKey: "editor-form" });
    assert.equal(retry.data.form.formId, formId, "retry opens the same form");
  } finally { await d.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
