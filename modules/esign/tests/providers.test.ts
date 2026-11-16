// esign: Dropbox Sign and DocuSign are built from the Space's Vault each time they are needed (before this, nothing outside a test ever registered them, so a key in the Vault changed nothing).
// A scripted Dropbox Sign stands in for the service; the Vault is a map a test edits between calls.
// @reads /modules/esign/migrations/0001_esign.sql
// @reads /modules/esign/migrations/0002_esign_vyre.sql

import test from "node:test";
import assert from "node:assert/strict";
import { FILE, dana, harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { samplePdf } from "../fixtures/pdf.ts";
import { setHostedAccess } from "../handlers/providers.ts";
import type { HttpFn } from "../handlers/documenso.ts";

const KEY = "db_sign_vault_key_0123456789";
const vault = new Map<string, string>();
const seen: { method: string; url: string; auth: string | undefined; body: string }[] = [];
const http: HttpFn = async (url, init) => {
  const body =
    init?.body === undefined
      ? ""
      : typeof init.body === "string"
        ? init.body
        : Buffer.from(init.body).toString("latin1");
  seen.push({ method: init?.method ?? "GET", url, auth: init?.headers?.Authorization, body });
  const ok = (json: unknown) => ({
    status: 200,
    ok: true,
    json: async () => json,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  if (url.endsWith("/signature_request/send")) return ok({ signature_request: { signature_request_id: "sr_vault_1" } });
  return ok({});
};
test.beforeEach(() => {
  vault.clear();
  seen.length = 0;
  setHostedAccess({
    secret: async (handle) => {
      const v = vault.get(handle);
      if (v === undefined) throw new Error("no such item");
      return v;
    },
    http,
  });
});
test.after(() => setHostedAccess(null));

async function setup(): Promise<Harness> {
  return harness({ builtIn: { pdf: await samplePdf(1) }, providers: {} });
}
const connected = async (h: Harness, key: string): Promise<boolean> =>
  (await h.call("esign.providers", {}, dana)).providers.find((p: { key: string }) => p.key === key).connected;
const SIGNERS = [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }];

test("a Dropbox Sign key in the Vault makes it connected and a send reaches the service; taking the key out stops it at the next call", async () => {
  const h = await setup();
  assert.equal(await connected(h, "dropbox_sign"), false);
  await assert.rejects(
    h.call("esign.send", { fileId: FILE, signers: SIGNERS, provider: "dropbox_sign", idempotencyKey: "a" }, dana),
    /dropbox sign is not connected/,
  );
  assert.equal(seen.length, 0, "nothing was sent anywhere");

  vault.set("#Dropbox_Sign.apiKey", KEY);
  vault.set("#Dropbox_Sign.testMode", "true");
  assert.equal(await connected(h, "dropbox_sign"), true);
  const out = await h.call(
    "esign.send",
    { fileId: FILE, signers: SIGNERS, provider: "dropbox_sign", idempotencyKey: "b" },
    dana,
  );
  const post = seen.find((s) => s.url.endsWith("/signature_request/send"))!;
  assert.equal(post.auth, `Basic ${btoa(`${KEY}:`)}`);
  assert.match(post.body, /name="test_mode"\r\n\r\n1/);
  assert.match(post.body, /andrea@northwind\.example/);
  const row = h.rows("esign_envelope").find((r) => r.id === out.envelopeId)!;
  assert.deepEqual([row.provider, row.provider_ref], ["dropbox_sign", "sr_vault_1"]);
  assert.equal(out.links, undefined, "a hosted provider mails the signer itself");
  await h.call("esign.cancel", { envelopeId: out.envelopeId, idempotencyKey: "cx3454" }, dana);
  assert.ok(seen.some((s) => s.url.endsWith("/signature_request/cancel/sr_vault_1")));

  vault.delete("#Dropbox_Sign.apiKey");
  assert.equal(await connected(h, "dropbox_sign"), false);
  await assert.rejects(
    h.call("esign.send", { fileId: FILE, signers: SIGNERS, provider: "dropbox_sign", idempotencyKey: "c" }, dana),
    /not connected/,
  );
  assert.ok(!JSON.stringify(h.warnings).includes(KEY), "the key is never logged");
});

test("DocuSign needs all five fields; a missing one reads as not connected, with the reason in plain words", async () => {
  const h = await setup();
  for (const f of ["integrationKey", "userId", "accountId", "baseUri"]) vault.set(`#DocuSign.${f}`, `value-${f}`);
  assert.equal(await connected(h, "docusign"), false, "no private key yet");
  const row = (await h.call("esign.providers", {}, dana)).providers.find((p: { key: string }) => p.key === "docusign");
  assert.match(row.why, /DocuSign is not connected/);
  // secret-scan: fake
  vault.set("#DocuSign.privateKey", "-----BEGIN RSA PRIVATE KEY-----\nnot a real key\n-----END RSA PRIVATE KEY-----");
  assert.equal(await connected(h, "docusign"), true);
});

test("a hosted provider can be the default once it is connected, and health says what is true: down when its key is gone, built-in signing otherwise", async () => {
  const h = await setup();
  await assert.rejects(
    h.call("esign.provider_set", { provider: "dropbox_sign" }, { id: "usr_admin" }),
    /not connected|precondition/,
  );
  vault.set("#Dropbox_Sign.apiKey", KEY);
  await h.call("esign.provider_set", { provider: "dropbox_sign" }, { id: "usr_admin" });
  assert.equal(
    (await h.call("esign.providers", {}, dana)).providers.find((p: { default: boolean }) => p.default).key,
    "dropbox_sign",
  );
  assert.equal((await h.call("esign.health", {}, dana)).state, "healthy");
  vault.delete("#Dropbox_Sign.apiKey");
  const gone = await h.call("esign.health", {}, dana);
  assert.deepEqual([gone.state, gone.detail], ["down", "Dropbox Sign is not connected."]);
  await h.call("esign.provider_set", { provider: "vyre" }, { id: "usr_admin" });
  assert.equal((await h.call("esign.health", {}, dana)).state, "healthy");
});

test("without a host there is nothing to build from: the providers a test registered are left alone", async () => {
  setHostedAccess(null);
  const h = harness();
  assert.equal(await connected(h, "documenso"), true);
});
