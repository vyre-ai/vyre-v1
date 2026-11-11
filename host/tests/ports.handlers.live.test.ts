// Calls one module makes to another must satisfy the target's contract. These ran against fakes that accepted anything, so three of them were wrong and nobody saw it. Here the real modules answer
// through a real daemon: a document filled from a record and an email previewed as a record (the record's type is not given, so it is looked up), and an import preview that matches a type with
// many existing rows (records.query pages are at most 500).
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
import { docx, para, textOf } from "../../modules/documents/fixtures/world.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string; message?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any

async function withSpace(run: (api: { post(p: string, body: unknown): Promise<{ status: number; body: Json }>; ok(p: string, body: unknown): Promise<any> }) => Promise<void>): Promise<void> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-ports-"));
  const d: Daemon = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_ports", "--space-name", "Ports Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "ports", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  try {
    const raw = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
      const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) as Json : {} };
    };
    const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
    assert.equal((await raw(null, "/v1/identity/claim_owner", { code, spaceId: "spc_ports", username: "olivia", password: PASSWORD, deviceName: "Mac", deviceClass: "desktop", keys: KEYS })).status, 200);
    const owner = (await raw(null, "/v1/identity/sign_in", { username: "olivia", password: PASSWORD, deviceName: "Laptop", deviceClass: "desktop" })).body.data.session.token as string;
    const post = (p: string, body: unknown): Promise<{ status: number; body: Json }> => raw(owner, p, body);
    const ok = async (p: string, body: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await post(p, body);
      assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`);
      return r.body.data;
    };
    // a record type with a name and a company, and one record
    await ok("/v1/schema/apply", { idempotencyKey: "ports-type", ops: [{ op: "type.create", type: "rt_contact", def: { title: "Contact", plural: "Contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "company", type: "text", title: "Company" }] } }] });
    await run({ post, ok });
  } finally { await d.stop(); }
}

test("documents.fill with a recordId and no record type reads the record and fills the template", async () => {
  await withSpace(async ({ ok }) => {
    const rec = (await ok("/v1/records/create", { idempotencyKey: "ports-rec", type: "rt_contact", fields: { name: "Acme Holdings", company: "Acme" } })).record;
    const tree = await ok("/v1/files/tree", {});
    const personal = tree.roots.find((r: { key: string }) => r.key === "personal").folderId as string;
    const template = (await ok("/v1/files/create", { idempotencyKey: "ports-template", folderId: personal, name: "Letter.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: { base64: docx(para("Dear {name} at {company}.")).toString("base64") } })).file;
    const filled = await ok("/v1/documents/fill", { idempotencyKey: "ports-fill", templateFileId: template.fileId, intoFolderId: personal, recordId: rec.id, name: "Letter filled" });
    assert.deepEqual(filled.missing, [], "the record's fields filled every tag");
    const bytes = await ok("/v1/files/read", { fileId: filled.file.fileId, as: "base64" });
    assert.deepEqual(textOf(Buffer.from(bytes.base64 as string, "base64")), ["Dear Acme Holdings at Acme."]);
  });
});

test("email_builder.render as a record reads the record and previews the email", async () => {
  await withSpace(async ({ ok, post }) => {
    const rec = (await ok("/v1/records/create", { idempotencyKey: "ports-rec", type: "rt_contact", fields: { name: "Acme Holdings", company: "Acme" } })).record;
    const email = (await ok("/v1/email_builder/create", { idempotencyKey: "ports-email", name: "Hello", mode: "html" })).email;
    const out = await ok("/v1/email_builder/render", { emailId: email.emailId, variant: "desktop", asRecordId: rec.id });
    assert.ok(typeof out.html === "string" && out.html.length > 0);
    const missing = await post("/v1/email_builder/render", { emailId: email.emailId, variant: "desktop", asRecordId: "rec_0000000000000000000000000000" });
    assert.equal(missing.status, 404, "a record that does not exist is not found");
  });
});

test("import.preview matches against existing rows even when one key matches more than 500 of them", async () => {
  await withSpace(async ({ ok }) => {
    const rows = Array.from({ length: 620 }, (_v, i) => ({ name: `Person ${i}`, company: "Shared Co" }));
    for (let i = 0; i < rows.length; i += 200) await ok("/v1/records/bulk_upsert", { idempotencyKey: `ports-bulk-${i}`, type: "rt_contact", match: ["name"], rows: rows.slice(i, i + 200) });
    const parsed = await ok("/v1/import/parse_csv", { text: "Name,Company\nNewcomer,Shared Co\n" });
    const preview = await ok("/v1/import/preview", { importId: parsed.importId, type: "rt_contact", mapping: [{ column: "Name", field: "name" }, { column: "Company", field: "company" }], match: ["company"], onMatch: "skip" });
    assert.deepEqual([preview.creates, preview.updates, preview.skips], [0, 0, 1], "the one row matches an existing company, however many rows carry it");
  });
});

test("email_builder.html_set and restore_version save through the real pipeline (their saved event is declared in their emits)", async () => {
  await withSpace(async ({ ok }) => {
    const email = (await ok("/v1/email_builder/create", { idempotencyKey: "ports-email-2", name: "Hello", mode: "html" })).email;
    const set = await ok("/v1/email_builder/html_set", { emailId: email.emailId, html: "<p>Hello again</p>" });
    assert.equal(set.ok, true);
    const versions = (await ok("/v1/email_builder/versions", { emailId: email.emailId })).versions as { version: number }[];
    assert.ok(versions.length >= 1, "the HTML was saved as a version");
    const restored = await ok("/v1/email_builder/restore_version", { emailId: email.emailId, version: versions[versions.length - 1]!.version });
    assert.equal(restored.email.emailId, email.emailId);
  });
});
