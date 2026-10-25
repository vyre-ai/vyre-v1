// DocuSign provider (spec 2.20, 3.6; ARCH 8.4): the eSignature REST API v2.1 client behind EsignProvider, the JWT grant that gets its access token, and the reader for
// its Connect webhook (JSON, SIM event names). The service signs a JWT (RS256, scope "signature impersonation") with the integration's RSA key and trades it at
// https://<auth host>/oauth/token for a one-hour token; the token is cached and renewed a minute early or when DocuSign answers 401. The user must have granted consent
// once ("consent_required" comes back with a clear message). The key is a Vault value handed over by the host and never logged.
// Connect's own HMAC header is checked by the route that receives the POST (it holds the raw body); webhook() reads the parsed payload. As everywhere in esign a webhook
// is a hint: esign.hook confirms completed and declined with status() before it changes anything.

import { ProviderPayloadError } from "./send.ts";
import type { EnvelopeRequest, EnvelopeStatus, EsignProvider, ProviderStatus, SignedFiles, WebhookEvent } from "./send.ts";
import type { HttpFn } from "./documenso.ts";

export interface DocuSignOptions {
  /** the integration key (client id) */
  integrationKey: string;
  /** the GUID of the user the service acts as */
  userId: string;
  accountId: string;
  /** where the account's API lives, for example https://demo.docusign.net or https://na3.docusign.net */
  baseUri: string;
  /** the RSA private key, PEM ("BEGIN RSA PRIVATE KEY" as DocuSign hands it out, or PKCS#8) */
  privateKey: string;
  http: HttpFn;
  /** account-d.docusign.com (demo, the default) or account.docusign.com */
  authHost?: string;
  /** a clock in ms, for tests */
  now?: () => number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

// ---- the JWT grant --------------------------------------------------------------------------------------------

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let bin = "";
  for (let i = 0; i < raw.length; i += 0x8000) bin += String.fromCharCode(...raw.subarray(i, i + 0x8000));
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}

/** Reads a PEM private key as PKCS#8 bytes; a PKCS#1 key ("BEGIN RSA PRIVATE KEY", what DocuSign gives out) is wrapped in the PKCS#8 header. */
export function pkcs8FromPem(pem: string): Uint8Array {
  const m = pem.match(/-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (RSA )?PRIVATE KEY-----/);
  if (!m || !m[2]) throw new Error("The DocuSign private key is not a PEM private key.");
  const bin = atob(m[2].replace(/\s+/g, ""));
  const der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  if (m[1] === undefined) return der;
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octet = [0x04, ...derLength(der.length)];
  const inner = 3 + alg.length + octet.length + der.length;
  const out = new Uint8Array(1 + derLength(inner).length + inner);
  let at = 0;
  for (const b of [0x30, ...derLength(inner), 0x02, 0x01, 0x00, ...alg, ...octet]) out[at++] = b;
  out.set(der, at);
  return out;
}

/** A signed JWT for the grant. Exported so a test can verify the signature with the public key. */
export async function signJwt(o: { integrationKey: string; userId: string; authHost: string; privateKey: string; nowSeconds: number }): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: o.integrationKey, sub: o.userId, aud: o.authHost, iat: o.nowSeconds, exp: o.nowSeconds + 3600, scope: "signature impersonation" }));
  const key = await globalThis.crypto.subtle.importKey("pkcs8", pkcs8FromPem(o.privateKey) as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(sig)}`;
}

// ---- mapping --------------------------------------------------------------------------------------------------

function signerState(raw: string): EnvelopeStatus {
  if (raw === "completed" || raw === "signed") return "signed";
  if (raw === "declined") return "declined";
  return raw === "delivered" ? "viewed" : "sent";
}

function signersOf(recipients: unknown): Obj[] {
  return isObj(recipients) && Array.isArray(recipients.signers) ? recipients.signers.filter(isObj) : [];
}

function mapStatus(env: Obj): ProviderStatus {
  const raw = signersOf(env.recipients);
  const signers = raw.map((r) => ({ name: s(r.name), email: s(r.email).toLowerCase(), status: signerState(s(r.status)) }));
  const status = s(env.status);
  let state: EnvelopeStatus;
  if (status === "completed") state = "signed";
  else if (status === "declined" || signers.some((x) => x.status === "declined")) state = "declined";
  else if (status === "voided") state = "cancelled";
  else state = signers.some((x) => x.status === "viewed" || x.status === "signed") ? "viewed" : "sent";
  const out: ProviderStatus = { state, signers };
  const why = raw.find((r) => s(r.status) === "declined");
  const reason = why ? s(why.declinedReason) : "";
  if (state === "declined" && reason !== "") out.reason = reason;
  return out;
}

export function docusign(o: DocuSignOptions): EsignProvider {
  const authHost = o.authHost ?? "account-d.docusign.com";
  const base = `${o.baseUri.replace(/\/+$/, "")}/restapi/v2.1/accounts/${encodeURIComponent(o.accountId)}`;
  const now = o.now ?? ((): number => Date.now());
  let token: { value: string; expires: number } | null = null;

  async function accessToken(force = false): Promise<string> {
    if (!force && token && token.expires - 60_000 > now()) return token.value;
    const assertion = await signJwt({ integrationKey: o.integrationKey, userId: o.userId, authHost, privateKey: o.privateKey, nowSeconds: Math.floor(now() / 1000) });
    const res = await o.http(`https://${authHost}/oauth/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = isObj(body) ? s(body.error) : "";
      if (err === "consent_required") throw new Error("DocuSign needs the user's consent for this integration before it can send. Open the consent link once in DocuSign.");
      throw new Error(`DocuSign refused the sign-in (${res.status}${err ? ` ${err}` : ""})`);
    }
    if (!isObj(body) || typeof body.access_token !== "string" || body.access_token === "") throw new Error("DocuSign returned no access token");
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
    token = { value: body.access_token, expires: now() + ttl * 1000 };
    return token.value;
  }

  /** Calls the API with the token; one 401 renews the token and tries again. */
  async function call(method: string, path: string, body?: unknown): Promise<Awaited<ReturnType<HttpFn>>> {
    for (let attempt = 0; ; attempt++) {
      const t = await accessToken(attempt > 0);
      const res = await o.http(`${base}${path}`, {
        method, headers: { Authorization: `Bearer ${t}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) throw new Error(`DocuSign answered ${res.status} for ${method} ${path.split("?")[0]}`);
      return res;
    }
  }

  return {
    async create(req: EnvelopeRequest): Promise<{ ref: string }> {
      let bin = "";
      for (let i = 0; i < req.pdf.length; i += 0x8000) bin += String.fromCharCode(...req.pdf.subarray(i, i + 0x8000));
      const payload = {
        emailSubject: `Please sign: ${req.title}`,
        status: "sent",
        documents: [{ documentBase64: btoa(bin), name: req.fileName, fileExtension: "pdf", documentId: "1" }],
        customFields: { textCustomFields: [{ name: "vyreEnvelopeId", value: req.envelopeId, show: "false", required: "false" }] },
        recipients: {
          signers: req.signers.map((x, i) => ({
            email: x.email, name: x.name, recipientId: String(i + 1), routingOrder: String(x.order),
            tabs: { signHereTabs: [{ documentId: "1", pageNumber: "1", xPosition: "60", yPosition: String(Math.max(40, 680 - i * 60)) }] },
          })),
        },
      };
      const res = await call("POST", "/envelopes", payload);
      const json = await res.json();
      if (!isObj(json) || typeof json.envelopeId !== "string" || json.envelopeId === "") throw new Error("DocuSign returned no envelope id");
      return { ref: json.envelopeId };
    },

    async status(ref: string): Promise<ProviderStatus> {
      const json = await (await call("GET", `/envelopes/${encodeURIComponent(ref)}?include=recipients`)).json();
      if (!isObj(json)) throw new Error("DocuSign returned no envelope");
      return mapStatus(json);
    },

    async cancel(ref: string): Promise<void> {
      await call("PUT", `/envelopes/${encodeURIComponent(ref)}`, { status: "voided", voidedReason: "Cancelled from Vyre" });
    },

    async fetchSigned(ref: string): Promise<SignedFiles> {
      const id = encodeURIComponent(ref);
      const pdf = new Uint8Array(await (await call("GET", `/envelopes/${id}/documents/combined`)).arrayBuffer());
      const certificate = new Uint8Array(await (await call("GET", `/envelopes/${id}/documents/certificate`)).arrayBuffer());
      return { pdf, certificate };
    },

    webhook(payload: unknown): WebhookEvent | null {
      let body: unknown = payload;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch { throw new ProviderPayloadError("That is not a DocuSign Connect message."); }
      }
      if (!isObj(body) || typeof body.event !== "string" || !isObj(body.data)) throw new ProviderPayloadError("That is not a DocuSign Connect message.");
      const data = body.data;
      const envelopeId = s(data.envelopeId);
      if (envelopeId === "") throw new ProviderPayloadError("The message names no envelope.");
      const kinds: Record<string, WebhookEvent["kind"]> = {
        "recipient-delivered": "viewed", "recipient-completed": "signed", "envelope-completed": "completed",
        "envelope-declined": "declined", "envelope-voided": "cancelled",
      };
      // DocuSign sends recipient-declined and envelope-declined for one decline; only the envelope one is read, so the decline is applied once
      const kind = kinds[body.event];
      if (!kind) return null;
      const summary = isObj(data.envelopeSummary) ? data.envelopeSummary : {};
      const raw = signersOf(summary.recipients);
      const recipients = raw.map((r) => {
        const st = s(r.status);
        return { email: s(r.email).toLowerCase(), name: s(r.name), read: st === "delivered" || st === "completed" || st === "signed", signed: st === "completed" || st === "signed", rejected: st === "declined" };
      });
      const why = raw.find((r) => s(r.status) === "declined");
      const reason = why && s(why.declinedReason) !== "" ? s(why.declinedReason) : undefined;
      // a redelivery repeats the generated time and the recipient, so this key is the same every time Connect retries
      const key = `${body.event}:${envelopeId}:${s(data.recipientId)}:${s(body.generatedDateTime)}`;
      return { id: key, ref: envelopeId, kind, recipients, ...(reason ? { reason } : {}) };
    },

    async health(): Promise<{ ok: boolean; detail?: string }> {
      try {
        await accessToken(true);
        return { ok: true };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
