// Dropbox Sign provider (spec 2.20, 3.6; ARCH 8.4): the API v3 client behind EsignProvider and the reader for its event callback.
// A document goes out in one multipart call (the PDF, each signer, one signature field per signer), is read back by signature request id, cancelled, and
// downloaded as the final PDF (Dropbox Sign appends its audit trail to that PDF, so there is no second file). Auth is HTTP Basic with the API key as user name.
// The callback body carries event_hash = HMAC-SHA256(api key, event_time + event_type); webhook() checks it so a forged POST is refused before the hook looks at it.
// Web Crypto is async and EsignProvider.webhook is sync, so the HMAC below is a small pure SHA-256 (no node:crypto, boundary B3).
// As everywhere in esign, a callback is a hint: esign.hook confirms signed and declined with status() before it changes anything.

import { ProviderPayloadError } from "./send.ts";
import type { EnvelopeRequest, EnvelopeStatus, EsignProvider, ProviderStatus, SignedFiles, WebhookEvent } from "./send.ts";
import type { HttpFn } from "./documenso.ts";

export interface DropboxSignOptions {
  /** the API key (a Vault value, read by the host when it builds the provider); also the callback signing key */
  apiKey: string;
  /** global fetch in the host; tests pass a scripted one */
  http: HttpFn;
  /** default https://api.hellosign.com/v3 */
  baseUrl?: string;
  /** the API app's client id, when documents are sent through an app */
  clientId?: string;
  /** Dropbox Sign test mode: documents are free and not legally binding */
  testMode?: boolean;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

// ---- SHA-256 and HMAC (pure, sync) --------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((data.length * 8) / 0x100000000), false);
  view.setUint32(padded.length - 4, (data.length * 8) >>> 0, false);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!, w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]!, false);
  return out;
}

export function hmacSha256Hex(key: string, message: string): string {
  const enc = new TextEncoder();
  let k = enc.encode(key);
  if (k.length > 64) k = sha256(k);
  const ipad = new Uint8Array(64).fill(0x36);
  const opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < k.length; i++) { ipad[i] = ipad[i]! ^ k[i]!; opad[i] = opad[i]! ^ k[i]!; }
  const m = enc.encode(message);
  const inner = new Uint8Array(64 + m.length);
  inner.set(ipad);
  inner.set(m, 64);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(sha256(inner), 64);
  return Array.from(sha256(outer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- the request body -----------------------------------------------------------------------------------------

/** A multipart/form-data body with plain fields and one PDF part named file[0], built by hand because the injected HttpFn takes bytes. */
export function multipartForm(boundary: string, fields: [string, string][], fileName: string, pdf: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const safeName = fileName.replace(/[^A-Za-z0-9._ -]/g, "_") || "document.pdf";
  const text = fields.map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k.replace(/"/g, "")}"\r\n\r\n${v}\r\n`).join("");
  const head = enc.encode(`${text}--${boundary}\r\nContent-Disposition: form-data; name="file[0]"; filename="${safeName}"\r\nContent-Type: application/pdf\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + pdf.length + tail.length);
  out.set(head, 0);
  out.set(pdf, head.length);
  out.set(tail, head.length + pdf.length);
  return out;
}

/** Page 1 (612 x 792), one box per signer stacked upwards from the bottom of the left margin. y counts from the top. */
function signatureField(index: number, signer: number): Obj {
  return { api_id: `vyre_sig_${index}`, name: `Signature ${index + 1}`, type: "signature", x: 60, y: Math.max(40, 680 - index * 60), width: 200, height: 40, required: true, signer, page: 1 };
}

function mapSignatures(list: unknown[]): ProviderStatus["signers"] {
  return list.filter(isObj).map((x) => {
    const code = s(x.status_code);
    const st: EnvelopeStatus = code === "signed" ? "signed" : code === "declined" ? "declined" : x.last_viewed_at ? "viewed" : "sent";
    return { name: s(x.signer_name), email: s(x.signer_email_address).toLowerCase(), status: st };
  });
}

function mapStatus(req: Obj): ProviderStatus {
  const sigs = Array.isArray(req.signatures) ? req.signatures : [];
  const signers = mapSignatures(sigs);
  let state: EnvelopeStatus;
  if (req.is_declined === true || signers.some((x) => x.status === "declined")) state = "declined";
  else if (req.is_complete === true) state = "signed";
  else state = signers.some((x) => x.status === "viewed" || x.status === "signed") ? "viewed" : "sent";
  const out: ProviderStatus = { state, signers };
  const why = sigs.filter(isObj).find((x) => s(x.status_code) === "declined");
  if (state === "declined" && why && s(why.decline_reason) !== "") out.reason = s(why.decline_reason);
  return out;
}

export function dropboxSign(o: DropboxSignOptions): EsignProvider {
  const base = (o.baseUrl ?? "https://api.hellosign.com/v3").replace(/\/+$/, "");
  const auth = { Authorization: `Basic ${btoa(`${o.apiKey}:`)}` };

  async function api(method: string, path: string): Promise<Response2> {
    const res = await o.http(`${base}${path}`, { method, headers: auth });
    if (!res.ok) throw new Error(`Dropbox Sign answered ${res.status} for ${method} ${path.split("?")[0]}`);
    return res;
  }

  async function request(ref: string): Promise<Obj> {
    const body = await (await api("GET", `/signature_request/${encodeURIComponent(ref)}`)).json();
    const sr = isObj(body) ? body.signature_request : undefined;
    if (!isObj(sr)) throw new Error("Dropbox Sign returned no signature request");
    return sr;
  }

  return {
    async create(req: EnvelopeRequest): Promise<{ ref: string }> {
      const sequential = req.signers.some((x) => x.order > 1);
      const ranks = [...new Set(req.signers.map((x) => x.order))].sort((a, b) => a - b);
      const fields: [string, string][] = [["title", req.title], ["subject", `Please sign: ${req.title}`], ["metadata[vyre_envelope]", req.envelopeId]];
      req.signers.forEach((x, i) => {
        fields.push([`signers[${i}][email_address]`, x.email], [`signers[${i}][name]`, x.name]);
        if (sequential) fields.push([`signers[${i}][order]`, String(ranks.indexOf(x.order))]);
      });
      fields.push(["form_fields_per_document", JSON.stringify([req.signers.map((_, i) => signatureField(i, i))])]);
      if (o.clientId) fields.push(["client_id", o.clientId]);
      if (o.testMode) fields.push(["test_mode", "1"]);
      const boundary = `vyre${req.envelopeId.replace(/[^A-Za-z0-9]/g, "")}`;
      const made = await o.http(`${base}/signature_request/send`, {
        method: "POST", headers: { ...auth, "Content-Type": `multipart/form-data; boundary=${boundary}` }, body: multipartForm(boundary, fields, req.fileName, req.pdf),
      });
      if (!made.ok) throw new Error(`Dropbox Sign refused the document (${made.status})`);
      const json = await made.json();
      const sr = isObj(json) ? json.signature_request : undefined;
      if (!isObj(sr) || typeof sr.signature_request_id !== "string" || sr.signature_request_id === "") throw new Error("Dropbox Sign returned no signature request id");
      return { ref: sr.signature_request_id };
    },

    async status(ref: string): Promise<ProviderStatus> {
      return mapStatus(await request(ref));
    },

    async cancel(ref: string): Promise<void> {
      const res = await o.http(`${base}/signature_request/cancel/${encodeURIComponent(ref)}`, { method: "POST", headers: auth });
      if (!res.ok) throw new Error(`Dropbox Sign answered ${res.status} for POST /signature_request/cancel`);
    },

    async fetchSigned(ref: string): Promise<SignedFiles> {
      const res = await api("GET", `/signature_request/files/${encodeURIComponent(ref)}?file_type=pdf`);
      return { pdf: new Uint8Array(await res.arrayBuffer()) };
    },

    webhook(payload: unknown): WebhookEvent | null {
      let body: unknown = payload;
      // the callback is a form post with one field named json; the route may hand over the field's text or the whole form
      if (isObj(body) && typeof body.json === "string") body = body.json;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { throw new ProviderPayloadError("That is not a Dropbox Sign callback."); }
      }
      if (!isObj(body) || !isObj(body.event)) throw new ProviderPayloadError("That is not a Dropbox Sign callback.");
      const ev = body.event;
      const type = s(ev.event_type), time = s(ev.event_time), hash = s(ev.event_hash);
      if (type === "" || time === "" || hash === "") throw new ProviderPayloadError("That is not a Dropbox Sign callback.");
      if (!sameText(hmacSha256Hex(o.apiKey, time + type), hash.toLowerCase())) throw new ProviderPayloadError("The Dropbox Sign callback signature does not match.");
      const kinds: Record<string, WebhookEvent["kind"]> = {
        signature_request_viewed: "viewed", signature_request_signed: "signed", signature_request_all_signed: "completed",
        signature_request_declined: "declined", signature_request_canceled: "cancelled",
      };
      const kind = kinds[type];
      if (!kind) return null;
      const sr = body.signature_request;
      if (!isObj(sr) || typeof sr.signature_request_id !== "string" || sr.signature_request_id === "") throw new ProviderPayloadError("The callback names no document.");
      const sigs = (Array.isArray(sr.signatures) ? sr.signatures : []).filter(isObj);
      const recipients = sigs.map((x) => ({
        email: s(x.signer_email_address).toLowerCase(), name: s(x.signer_name),
        read: x.last_viewed_at !== null && x.last_viewed_at !== undefined && x.last_viewed_at !== "", signed: s(x.status_code) === "signed", rejected: s(x.status_code) === "declined",
      }));
      const why = sigs.find((x) => s(x.status_code) === "declined");
      const reason = why && s(why.decline_reason) !== "" ? s(why.decline_reason) : undefined;
      const meta = isObj(ev.event_metadata) ? s(ev.event_metadata.related_signature_id) : "";
      return { id: `${type}:${sr.signature_request_id}:${time}:${meta}`, ref: sr.signature_request_id, kind, recipients, ...(reason ? { reason } : {}) };
    },

    async health(): Promise<{ ok: boolean; detail?: string }> {
      const res = await o.http(`${base}/signature_request/list?page_size=1`, { method: "GET", headers: auth });
      return res.ok ? { ok: true } : { ok: false, detail: res.status === 401 ? "Dropbox Sign refused the API key." : `Dropbox Sign answered ${res.status}.` };
    },
  };
}

type Response2 = Awaited<ReturnType<HttpFn>>;
