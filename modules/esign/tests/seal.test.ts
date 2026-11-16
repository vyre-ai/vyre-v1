// esign: the cryptographic seal on a finished signed PDF. Seal then verify is intact; one changed byte in the page, in the signature, or appended after it is not; a file sealed by another key is not this Space's;
// a certificate the Space bought (the Vault item Document_Seal, here from a made-up authority) is used instead; the private key is in no table, output or log in the clear.
// @reads /modules/esign/migrations/0003_esign_seal.sql

import test from "node:test";
import assert from "node:assert/strict";
import { FILE, dana, harness, toBase64, withSeal } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { samplePdf, textOf } from "../fixtures/pdf.ts";
import { addSealField, inspect, sealBytes } from "../handlers/pdfseal.ts";
import { fingerprintOf, makeSeal, importKey } from "../handlers/seal.ts";
import { setHostedAccess } from "../handlers/providers.ts";
import { PDFDocument } from "@cantoo/pdf-lib";

const SYSTEM = { id: "system", kind: "service" as const };
const V = { ip: "203.0.113.9", ua: "Mozilla/5.0 Test" };

async function sealedEnvelope(
  h: Harness,
): Promise<{ envelopeId: string; bytes: Uint8Array; status: Record<string, any> }> {
  // eslint-disable-line @typescript-eslint/no-explicit-any
  const sent = await h.call(
    "esign.send",
    { fileId: FILE, signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }], idempotencyKey: "s1" },
    dana,
  );
  const token = sent.links[0].path.split("/")[3] as string;
  await h.call(
    "esign.signer_act",
    {
      token,
      visitor: V,
      op: "sign",
      body: { name: "Andrea Lindahl", consent: true, signature: { kind: "typed", text: "Andrea Lindahl" } },
    },
    SYSTEM,
    false,
  );
  await h.call("esign.fetch_signed", { envelopeId: sent.envelopeId }, dana);
  const bytes = new Uint8Array(Buffer.from(h.created[0]!.base64, "base64"));
  h.callee("files.read", () => ({
    base64: toBase64(bytes),
    mime: "application/pdf",
    size: bytes.length,
    version: 1,
    truncated: false,
  }));
  return {
    envelopeId: sent.envelopeId,
    bytes,
    status: await h.call("esign.status", { envelopeId: sent.envelopeId }, dana),
  };
}
const verify = (h: Harness, bytes: Uint8Array) => {
  h.callee("files.read", () => ({
    base64: toBase64(bytes),
    mime: "application/pdf",
    size: bytes.length,
    version: 1,
    truncated: false,
  }));
  return h.call("esign.verify", { fileId: FILE }, dana);
};

test("a finished signed file is sealed: verify says intact and by this Space, the audit page says so, the status carries the fingerprint", async () => {
  const h = harness({ builtIn: { pdf: await samplePdf(2) } });
  await withSeal(h);
  const { bytes, status } = await sealedEnvelope(h);
  assert.equal(status.sealed, true);
  assert.match(status.sealFingerprint, /^[0-9a-f]{64}$/);
  const v = await verify(h, bytes);
  assert.deepEqual([v.sealed, v.intact, v.bySpace, v.fingerprint], [true, true, true, status.sealFingerprint]);
  assert.ok(Math.abs(v.signedAt - Date.now()) < 120_000, "the signing time is read from the signature");
  const text = textOf(bytes);
  assert.match(text, /Sealed by Northwind with a certificate made by this Space\. Fingerprint SHA-256:/);
  assert.ok(text.includes(status.sealFingerprint));
  const s = Buffer.from(bytes).toString("latin1");
  assert.match(s, /\/SubFilter\s*\/adbe\.pkcs7\.detached/);
  assert.equal((s.match(/\/ByteRange/g) ?? []).length, 1, "one seal");
  assert.equal(
    (await PDFDocument.load(bytes)).getPageCount(),
    4,
    "the file still opens: two pages, the signature page and the audit page",
  );
});

test("a changed byte shows: in the page, in the signature, or anything added after the seal", async () => {
  const h = harness({ builtIn: { pdf: await samplePdf(2) } });
  await withSeal(h);
  const { bytes } = await sealedEnvelope(h);
  const text = Buffer.from(bytes).toString("latin1");
  const br = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text)!;
  const [b, c] = [Number(br[2]), Number(br[3])];
  const page = new Uint8Array(bytes);
  page[Math.floor(b / 3)] = (page[Math.floor(b / 3)] as number) ^ 1;
  assert.equal((await verify(h, page)).intact, false, "a byte of the content");
  const sig = new Uint8Array(bytes);
  const hexEnd = text.slice(b + 1, c - 1).replace(/0+$/, "").length; // the signature value is the last thing in the CMS
  const at = b + 1 + hexEnd - 20;
  sig[at] = sig[at] === 0x31 ? 0x32 : 0x31;
  assert.equal((await verify(h, sig)).intact, false, "a byte of the signature");
  const tail = new Uint8Array(bytes.length + 64);
  tail.set(bytes);
  tail.set(new TextEncoder().encode("\n% added after sealing"), bytes.length);
  tail.fill(0x20, bytes.length + 22);
  assert.equal((await verify(h, tail)).intact, false, "something appended after the seal");
  assert.equal((await verify(h, bytes)).intact, true);
  assert.ok(c > b);
  const plain = await samplePdf(1);
  assert.deepEqual(await verify(h, plain), { sealed: false, intact: false, bySpace: false });
});

async function sealWith(pdf: Uint8Array, name: string): Promise<{ bytes: Uint8Array; fingerprint: string }> {
  const doc = await PDFDocument.load(pdf);
  addSealField(doc, name, new Date());
  const placeholder = await doc.save({ useObjectStreams: false });
  const made = await makeSeal(name);
  const bytes = await sealBytes(placeholder, {
    cert: made.cert,
    chain: [],
    key: await importKey(made.pkcs8),
    fingerprint: await fingerprintOf(made.cert),
    own: false,
  });
  return { bytes, fingerprint: await fingerprintOf(made.cert) };
}

test("a file sealed by another key verifies as intact but is not this Space's", async () => {
  const h = harness({ builtIn: { pdf: await samplePdf(1) } });
  await withSeal(h);
  const other = await sealWith(await samplePdf(1), "Elsewhere Partners");
  const v = await verify(h, other.bytes);
  assert.deepEqual([v.sealed, v.intact, v.bySpace, v.fingerprint], [true, true, false, other.fingerprint]);
  const seen = await inspect(other.bytes);
  assert.equal(seen.covers && seen.cms?.ok, true);
});

test("a certificate the Space bought, kept in the Vault as Document_Seal, is used instead of the one it made", async () => {
  const authority = await makeSeal("Made-up Authority Ltd");
  const pem = (label: string, der: Uint8Array): string =>
    `-----BEGIN ${label}-----\n${Buffer.from(der)
      .toString("base64")
      .replace(/(.{64})/g, "$1\n")}\n-----END ${label}-----\n`;
  const vault = new Map([
    ["#Document_Seal.certificate", pem("CERTIFICATE", authority.cert)],
    // secret-scan: fake
    ["#Document_Seal.key", pem("PRIVATE KEY", authority.pkcs8)],
  ]);
  setHostedAccess({
    secret: async (k) => vault.get(k) ?? Promise.reject(new Error("none")),
    http: async () => Promise.reject(new Error("no network")),
  });
  try {
    const h = harness({ builtIn: { pdf: await samplePdf(1) } });
    await withSeal(h);
    const { bytes, status } = await sealedEnvelope(h);
    assert.equal(status.sealFingerprint, await fingerprintOf(authority.cert), "the bought certificate sealed it");
    const v = await verify(h, bytes);
    assert.deepEqual([v.intact, v.bySpace], [true, true]);
    assert.match(textOf(bytes), /Sealed by Northwind with a certificate it holds\./);
    vault.clear();
    const again = harness({ builtIn: { pdf: await samplePdf(1) } });
    await withSeal(again);
    const second = await sealedEnvelope(again);
    assert.notEqual(
      second.status.sealFingerprint,
      status.sealFingerprint,
      "the Vault item gone: back to the Space's own",
    );
  } finally {
    setHostedAccess(null);
  }
});

test("the Space's key is made once, kept only sealed, and never appears in a table, an answer or a log", async () => {
  const h = harness({ builtIn: { pdf: await samplePdf(1) } }); // no pre-made key: the first seal makes it
  const first = await sealedEnvelope(h);
  const rows = h.rows("esign_seal");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.fingerprint, first.status.sealFingerprint);
  assert.match(String(rows[0]!.sealed_key), /"keyId"/, "the key is the server's own sealing, not a PKCS#8 blob");
  const second = await sealedEnvelope(h);
  assert.equal(second.status.sealFingerprint, first.status.sealFingerprint, "one key per Space, reused");
  assert.equal(h.rows("esign_seal").length, 1);
  assert.ok(!JSON.stringify(h.warnings).includes("PRIVATE"));
  const everything = JSON.stringify([
    ...["esign_seal", "esign_seal_cert", "esign_envelope", "esign_event"].map((t) => h.rows(t)),
    first.status,
    h.calls.map((c) => c.input),
  ]);
  assert.ok(!/BEGIN (RSA )?PRIVATE|"d":"|"p":"/.test(everything));
  assert.match(everything, /"slot":"current"/);
});
