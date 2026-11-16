// esign: the cryptographic seal on a finished signed PDF (owner, 17 Nov 2026: "lets get that na"). A standard PDF digital signature (adbe.pkcs7.detached, SHA-256) over the whole file, made with the Space's own key,
// so one changed byte shows as "the document has been altered" in Adobe Reader, Preview and every validator, and `esign.verify` says the same.
// What it proves, and no more: this file has not changed since THIS Space sealed it. The certificate is the Space's own (self-signed), so a reader shows the signer as unverified (Adobe: yellow, not the green tick);
// the green tick needs a certificate from an authority on the reader's trust list. A Space that has bought one puts it in the Vault as the item Document_Seal (certificate, key, optional chain) and the seal uses that.
// The key: one RSA 3072 key per Space, made the first time a file is sealed, kept ONLY sealed by the server's own sealing (ctx.seal, the way the server keeps its other secrets): the table holds ciphertext, the key
// is opened for the one signature and dropped. No timestamp service is called; `timestamp` is the seam (unset: none).
// @reads ../migrations/0003_esign_seal.sql

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { secretOf } from "./providers.ts";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_DIGEST = "1.2.840.113549.1.9.4";
const OID_TIME = "1.2.840.113549.1.9.5";
const SUBJECT_CN = "2.5.4.3";
const SUBJECT_OU = "2.5.4.11";
const SUBJECT_O = "2.5.4.10";
export const SEAL_UNIT = "Vyre document seal";
const RSA = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const hex = (b: ArrayBuffer | Uint8Array): string =>
  Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const b64 = (u: Uint8Array): string => Buffer.from(u).toString("base64");
const unb64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));

export interface SealMaterial {
  /** the certificate, DER */
  cert: Uint8Array;
  /** certificates above it, DER (a bought certificate's chain); empty for the Space's own */
  chain: Uint8Array[];
  key: CryptoKey;
  fingerprint: string;
  /** a certificate the Space brought (the Vault item Document_Seal) rather than the one it made */
  own: boolean;
}

export const fingerprintOf = async (cert: Uint8Array): Promise<string> =>
  hex(await subtle().digest("SHA-256", ab(cert)));

// ---- the Space's own certificate ----------------------------------------------------------------------------

async function makeCertificate(spaceName: string, keys: CryptoKeyPair, years = 10): Promise<Uint8Array> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  const serial = globalThis.crypto.getRandomValues(new Uint8Array(16));
  serial[0] = (serial[0] as number) & 0x7f;
  cert.serialNumber = new asn1js.Integer({ valueHex: ab(serial) });
  const name = (list: pkijs.RelativeDistinguishedNames): void => {
    list.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({
        type: SUBJECT_O,
        value: new asn1js.Utf8String({ value: spaceName.slice(0, 64) }),
      }),
      new pkijs.AttributeTypeAndValue({ type: SUBJECT_OU, value: new asn1js.Utf8String({ value: SEAL_UNIT }) }),
      new pkijs.AttributeTypeAndValue({
        type: SUBJECT_CN,
        value: new asn1js.Utf8String({ value: spaceName.slice(0, 64) }),
      }),
    );
  };
  name(cert.subject);
  name(cert.issuer);
  const from = new Date(Date.now() - 5 * 60_000);
  cert.notBefore.value = from;
  const to = new Date(from);
  to.setUTCFullYear(to.getUTCFullYear() + years);
  cert.notAfter.value = to;
  cert.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.19",
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: false }).toSchema().toBER(false),
    }),
    new pkijs.Extension({
      extnID: "2.5.29.15",
      critical: true,
      // digitalSignature (bit 0) and nonRepudiation (bit 1)
      extnValue: new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 }).toBER(false),
    }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return new Uint8Array(cert.toSchema(true).toBER(false));
}

/** A new key and its certificate. The key comes back as PKCS#8 bytes, for the caller to seal at once. */
export async function makeSeal(spaceName: string): Promise<{ cert: Uint8Array; pkcs8: Uint8Array }> {
  const keys = (await subtle().generateKey(
    { ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const cert = await makeCertificate(spaceName, keys);
  return { cert, pkcs8: new Uint8Array(await subtle().exportKey("pkcs8", keys.privateKey)) };
}

export const importKey = (pkcs8: Uint8Array): Promise<CryptoKey> =>
  subtle().importKey("pkcs8", ab(pkcs8), RSA, false, ["sign"]);

// ---- PEM ------------------------------------------------------------------------------------------------------

export function pemBlocks(text: string): { label: string; der: Uint8Array }[] {
  const out: { label: string; der: Uint8Array }[] = [];
  for (const m of text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g))
    out.push({ label: m[1] as string, der: unb64((m[2] as string).replace(/\s+/g, "")) });
  return out;
}

/** The Vault item Document_Seal as seal material, or null when it is not all there or not usable. */
export async function boughtSeal(): Promise<SealMaterial | null> {
  const certPem = await secretOf("#Document_Seal.certificate");
  const keyPem = await secretOf("#Document_Seal.key");
  if (certPem === null || keyPem === null) return null;
  try {
    const certs = pemBlocks(certPem).filter((b) => b.label === "CERTIFICATE");
    const key = pemBlocks(keyPem).find((b) => b.label === "PRIVATE KEY");
    if (certs.length === 0 || !key) return null;
    const chainPem = await secretOf("#Document_Seal.chain");
    const chain = [
      ...certs.slice(1),
      ...(chainPem ? pemBlocks(chainPem).filter((b) => b.label === "CERTIFICATE") : []),
    ].map((b) => b.der);
    const cert = certs[0]!.der;
    return { cert, chain, key: await importKey(key.der), fingerprint: await fingerprintOf(cert), own: true };
  } catch {
    return null;
  }
}

// ---- the CMS signature over the byte ranges ---------------------------------------------------------------------

/** Detached CMS SignedData (SHA-256) over `content`, with the certificate (and chain) inside. `timestamp` is the seam for a trusted time: it gets the signature and may return a time-stamp token; unset, none. */
export async function signDetached(
  content: Uint8Array,
  m: SealMaterial,
  timestamp?: (signature: Uint8Array) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  const cert = pkijs.Certificate.fromBER(ab(m.cert));
  const digest = await subtle().digest("SHA-256", ab(content));
  const signed = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID_DATA }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: cert.issuer, serialNumber: cert.serialNumber }),
        signedAttrs: new pkijs.SignedAndUnsignedAttributes({
          type: 0,
          attributes: [
            new pkijs.Attribute({ type: OID_CONTENT_TYPE, values: [new asn1js.ObjectIdentifier({ value: OID_DATA })] }),
            new pkijs.Attribute({ type: OID_TIME, values: [new asn1js.UTCTime({ valueDate: new Date() })] }),
            new pkijs.Attribute({ type: OID_DIGEST, values: [new asn1js.OctetString({ valueHex: digest })] }),
          ],
        }),
      }),
    ],
    certificates: [cert, ...m.chain.map((c) => pkijs.Certificate.fromBER(ab(c)))],
  });
  await signed.sign(m.key, 0, "SHA-256", ab(content));
  if (timestamp) {
    const sig = new Uint8Array(signed.signerInfos[0]!.signature.valueBlock.valueHexView);
    const token = await timestamp(sig);
    if (token)
      signed.signerInfos[0]!.unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({
        type: 1,
        attributes: [
          new pkijs.Attribute({
            type: "1.2.840.113549.1.9.16.2.14",
            values: [asn1js.fromBER(ab(token)).result],
          }),
        ],
      });
  }
  const info = new pkijs.ContentInfo({ contentType: OID_SIGNED, content: signed.toSchema(true) });
  return new Uint8Array(info.toSchema().toBER(false));
}

export interface CmsCheck {
  /** the signature over the content verifies with the certificate inside it */
  ok: boolean;
  cert: Uint8Array | null;
  signedAt: number | null;
}

/** Does this CMS blob verify over `content`; and which certificate and time does it carry. Never throws: anything unreadable is not ok. */
export async function verifyDetached(cms: Uint8Array, content: Uint8Array): Promise<CmsCheck> {
  try {
    const parsed = asn1js.fromBER(ab(cms));
    if (parsed.offset === -1) return { ok: false, cert: null, signedAt: null };
    const info = new pkijs.ContentInfo({ schema: parsed.result });
    if (info.contentType !== OID_SIGNED) return { ok: false, cert: null, signedAt: null };
    const signed = new pkijs.SignedData({ schema: info.content });
    const first = signed.certificates?.[0] as pkijs.Certificate | undefined;
    const cert = first ? new Uint8Array(first.toSchema(true).toBER(false)) : null;
    let signedAt: number | null = null;
    const attr = signed.signerInfos[0]?.signedAttrs?.attributes.find((a) => a.type === OID_TIME);
    const t = attr?.values[0] as { toDate?: () => Date } | undefined;
    if (t?.toDate) signedAt = t.toDate().getTime();
    const ok = await signed.verify({ signer: 0, data: ab(content), checkChain: false, trustedCerts: [] });
    return { ok: ok === true, cert, signedAt };
  } catch (e) {
    if (process.env.ESIGN_DEBUG) console.error(e);
    return { ok: false, cert: null, signedAt: null };
  }
}

// ---- the Space's seal: made once, kept sealed ---------------------------------------------------------------------

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The Space's seal material: a bought certificate from the Vault when there is one, else the Space's own key (made the first time, kept sealed by the server's own sealing). */
export async function ensureSeal(ctx: Ctx, spaceName: string): Promise<SealMaterial> {
  const bought = await boughtSeal();
  if (bought) {
    ctx.db.run(
      "INSERT OR IGNORE INTO esign_seal_cert (fingerprint, cert, made_at, source) VALUES (?, ?, ?, ?)",
      bought.fingerprint,
      b64(bought.cert),
      ctx.now(),
      "vault",
    );
    return bought;
  }
  let row = ctx.db.all("SELECT * FROM esign_seal WHERE slot = ?", "current")[0] as Row | undefined;
  if (!row) {
    const made = await makeSeal(spaceName);
    const fp = await fingerprintOf(made.cert);
    ctx.db.run(
      "INSERT OR IGNORE INTO esign_seal (slot, cert, fingerprint, sealed_key, made_at) VALUES (?, ?, ?, ?, ?)",
      "current",
      b64(made.cert),
      fp,
      JSON.stringify(ctx.seal.seal(made.pkcs8, "esign.seal")),
      ctx.now(),
    );
    ctx.db.run(
      "INSERT OR IGNORE INTO esign_seal_cert (fingerprint, cert, made_at, source) VALUES (?, ?, ?, ?)",
      fp,
      b64(made.cert),
      ctx.now(),
      "made",
    );
    made.pkcs8.fill(0);
    row = ctx.db.all("SELECT * FROM esign_seal WHERE slot = ?", "current")[0] as Row; // a racing first seal: the row that won
  }
  const pkcs8 = ctx.seal.unseal(JSON.parse(str(row.sealed_key)));
  try {
    return {
      cert: unb64(str(row.cert)),
      chain: [],
      key: await importKey(pkcs8),
      fingerprint: str(row.fingerprint),
      own: false,
    };
  } finally {
    pkcs8.fill(0);
  }
}

/** Is this certificate one this Space has sealed with (the one it made or one it brought)? */
export function isSpaceCert(ctx: Ctx, fingerprint: string): boolean {
  return ctx.db.all("SELECT 1 FROM esign_seal_cert WHERE fingerprint = ?", fingerprint).length > 0;
}
