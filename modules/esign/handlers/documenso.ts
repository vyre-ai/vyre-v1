// Documenso provider and the inbound webhook (spec 2.20, 3.6; ARCH 8.4). Documenso runs unmodified as its own container (images/documenso: pinned digest,
// Postgres sidecar on an internal-only network); Vyre only calls its REST API with an API token. Its AGPL licence is fine because Vyre never forks or links it.
// The API client targets Documenso's v1 REST API: create a document with its recipients, upload the PDF to the returned address, send it, then read status or download.
// esign.hook turns a provider webhook into envelope changes. A webhook is a hint: "signed" and "declined" are applied only after the provider's own API confirms them.
// The route that receives the POST checks Documenso's shared secret header before calling the handler; the handler checks that the document is one of ours.
// @reads ../../../images/documenso/documenso.lock

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ProviderPayloadError, envelopeOf, fail, finishTask, one, providerOf, saveSigned, subject, tellThread, PROVIDER_KEYS } from "./send.ts";
import type { EnvelopeRequest, EnvelopeStatus, EsignProvider, ProviderKey, ProviderStatus, SignedFiles, WebhookEvent } from "./send.ts";

// ---- the pinned container -----------------------------------------------------------------------------------

export interface DocumensoLock {
  documenso: { image: string; digest: string };
  postgres: { image: string; digest: string };
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Reads images/documenso/documenso.lock (KEY=image@sha256:digest lines). Throws when an image is not pinned by digest. */
export function parseLock(text: string): DocumensoLock {
  const vars = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(\S+)$/);
    if (m && m[1] && m[2]) vars.set(m[1], m[2]);
  }
  const pin = (key: string): { image: string; digest: string } => {
    const v = vars.get(key);
    const at = v?.indexOf("@") ?? -1;
    if (!v || at < 1) throw new Error(`${key} is missing or not pinned by digest`);
    const digest = v.slice(at + 1);
    if (!DIGEST.test(digest)) throw new Error(`${key} has a malformed digest`);
    return { image: v.slice(0, at), digest };
  };
  return { documenso: pin("DOCUMENSO_IMAGE"), postgres: pin("POSTGRES_IMAGE") };
}

// ---- the REST client ----------------------------------------------------------------------------------------

export interface HttpResponse {
  status: number;
  ok: boolean;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type HttpFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array }) => Promise<HttpResponse>;

export interface DocumensoOptions {
  /** where the container answers on this server, for example http://127.0.0.1:3010 */
  baseUrl: string;
  /** the API token (a Vault value, read by the host when it builds the provider) */
  apiToken: string;
  /** global fetch in the host; tests pass a scripted one */
  http: HttpFn;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown): string => (typeof v === "string" ? v : "");

function mapStatus(doc: Obj): ProviderStatus {
  const recipients = Array.isArray(doc.recipients) ? doc.recipients.filter(isObj) : Array.isArray(doc.Recipient) ? (doc.Recipient as unknown[]).filter(isObj) : [];
  const signers = recipients
    .filter((r) => s(r.role) === "" || s(r.role) === "SIGNER" || s(r.role) === "APPROVER")
    .map((r) => {
      const sig = s(r.signingStatus);
      const st: EnvelopeStatus = sig === "SIGNED" ? "signed" : sig === "REJECTED" ? "declined" : s(r.readStatus) === "OPENED" ? "viewed" : "sent";
      return { name: s(r.name), email: s(r.email).toLowerCase(), status: st };
    });
  const docStatus = s(doc.status);
  let state: EnvelopeStatus;
  if (docStatus === "COMPLETED") state = "signed";
  else if (docStatus === "REJECTED" || signers.some((x) => x.status === "declined")) state = "declined";
  else if (docStatus === "CANCELLED") state = "cancelled";
  else state = signers.some((x) => x.status === "viewed" || x.status === "signed") ? "viewed" : "sent";
  const out: ProviderStatus = { state, signers };
  const rejected = recipients.find((r) => s(r.signingStatus) === "REJECTED");
  if (state === "declined" && rejected && s(rejected.rejectionReason) !== "") out.reason = s(rejected.rejectionReason);
  return out;
}

export function documenso(o: DocumensoOptions): EsignProvider {
  const base = o.baseUrl.replace(/\/+$/, "");
  const headers = { Authorization: o.apiToken, "Content-Type": "application/json" };

  async function api(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await o.http(`${base}/api/v1${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) throw new Error(`Documenso answered ${res.status} for ${method} ${path}`);
    return res.status === 204 ? {} : res.json();
  }

  return {
    async create(req: EnvelopeRequest): Promise<{ ref: string }> {
      const sequential = req.signers.some((x) => x.order > 1);
      const made = await api("POST", "/documents", {
        title: req.title, externalId: req.envelopeId,
        recipients: req.signers.map((x) => ({ name: x.name, email: x.email, role: "SIGNER", signingOrder: x.order })),
        meta: { signingOrder: sequential ? "SEQUENTIAL" : "PARALLEL", subject: `Please sign: ${req.title}` },
      });
      if (!isObj(made) || typeof made.uploadUrl !== "string" || (typeof made.documentId !== "number" && typeof made.documentId !== "string")) throw new Error("Documenso returned no upload address");
      const put = await o.http(made.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: req.pdf });
      if (!put.ok) throw new Error(`Documenso refused the PDF upload (${put.status})`);
      const ref = String(made.documentId);
      await api("POST", `/documents/${encodeURIComponent(ref)}/send`, { sendEmail: true });
      return { ref };
    },

    async status(ref: string): Promise<ProviderStatus> {
      const doc = await api("GET", `/documents/${encodeURIComponent(ref)}`);
      if (!isObj(doc)) throw new Error("Documenso returned no document");
      return mapStatus(doc);
    },

    async cancel(ref: string): Promise<void> {
      await api("DELETE", `/documents/${encodeURIComponent(ref)}`);
    },

    async fetchSigned(ref: string): Promise<SignedFiles> {
      const link = await api("GET", `/documents/${encodeURIComponent(ref)}/download`);
      if (!isObj(link) || typeof link.downloadUrl !== "string") throw new Error("Documenso returned no download address");
      const res = await o.http(link.downloadUrl, { method: "GET", headers: { Authorization: o.apiToken } });
      if (!res.ok) throw new Error(`Documenso refused the download (${res.status})`);
      // the signing certificate is part of the signed PDF in Documenso, so there is no second file
      return { pdf: new Uint8Array(await res.arrayBuffer()) };
    },

    webhook(payload: unknown): WebhookEvent | null {
      if (!isObj(payload) || typeof payload.event !== "string" || !isObj(payload.payload)) throw new ProviderPayloadError("That is not a Documenso webhook.");
      const doc = payload.payload;
      const id = doc.id;
      if (typeof id !== "number" && typeof id !== "string") throw new ProviderPayloadError("The webhook names no document.");
      const kinds: Record<string, WebhookEvent["kind"]> = {
        DOCUMENT_OPENED: "viewed", DOCUMENT_SIGNED: "signed", DOCUMENT_COMPLETED: "completed", DOCUMENT_REJECTED: "declined", DOCUMENT_CANCELLED: "cancelled",
      };
      const kind = kinds[payload.event];
      if (!kind) return null;
      const list = Array.isArray(doc.Recipient) ? doc.Recipient : Array.isArray(doc.recipients) ? doc.recipients : [];
      const recipients = list.filter(isObj).map((r) => ({
        email: s(r.email).toLowerCase(), name: s(r.name),
        read: s(r.readStatus) === "OPENED", signed: s(r.signingStatus) === "SIGNED", rejected: s(r.signingStatus) === "REJECTED",
      }));
      const rejected = list.filter(isObj).find((r) => s(r.signingStatus) === "REJECTED");
      const reason = rejected && s(rejected.rejectionReason) !== "" ? s(rejected.rejectionReason) : undefined;
      const createdAt = s(payload.createdAt);
      const seen = recipients.filter((r) => r.read || r.signed || r.rejected).map((r) => `${r.email}:${r.read ? "r" : ""}${r.signed ? "s" : ""}${r.rejected ? "x" : ""}`).sort().join(",");
      return { id: `${payload.event}:${String(id)}:${createdAt}:${seen}`, ref: String(id), kind, recipients, ...(reason ? { reason } : {}) };
    },

    async health(): Promise<{ ok: boolean; detail?: string }> {
      const res = await o.http(`${base}/api/health`, { method: "GET" });
      return res.ok ? { ok: true } : { ok: false, detail: `Documenso answered ${res.status}.` };
    },
  };
}

// ---- esign.hook ---------------------------------------------------------------------------------------------

const ORDER: Record<EnvelopeStatus, number> = { sent: 0, viewed: 1, signed: 2, declined: 2, cancelled: 2 };

async function hook(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const o = isObj(input) ? input : {};
  const key = typeof o.provider === "string" && (PROVIDER_KEYS as readonly string[]).includes(o.provider) ? (o.provider as ProviderKey) : undefined;
  if (!key) fail(ctx, "validation.bad_input", "Choose documenso, dropbox_sign or docusign.", { field: "provider" });
  const provider = providerOf(key);
  if (!provider) fail(ctx, "validation.precondition_failed", `${key.replace("_", " ")} is not connected on this server.`);
  let ev: WebhookEvent | null;
  try {
    ev = provider.webhook(o.payload);
  } catch (e) {
    if (e instanceof ProviderPayloadError) fail(ctx, "validation.bad_input", e.message, { field: "payload" });
    throw e;
  }
  if (ev === null) return { ok: true };
  const row = one(ctx, "SELECT * FROM esign_envelope WHERE provider = ? AND provider_ref = ?", key, ev.ref);
  if (!row) {
    ctx.log.warn("esign: webhook for a document that is not ours", { provider: key, ref: ev.ref, kind: ev.kind });
    return { ok: true };
  }
  if (one(ctx, "SELECT * FROM esign_hook_seen WHERE provider = ? AND dedupe_key = ?", key, ev.id)) return { ok: true };
  ctx.db.run("INSERT INTO esign_hook_seen (provider, dedupe_key, at) VALUES (?, ?, ?)", key, ev.id, ctx.now());
  const env = envelopeOf(row);
  if (env.status === "cancelled") return { ok: true };

  if (ev.kind === "viewed") {
    for (const r of ev.recipients.filter((x) => x.read)) {
      const signer = one(ctx, "SELECT * FROM esign_signer WHERE envelope_id = ? AND email = ?", env.id, r.email);
      if (!signer || signer.status !== "sent") continue;
      ctx.db.run("UPDATE esign_signer SET status = ?, viewed_at = ? WHERE envelope_id = ? AND email = ?", "viewed", ctx.now(), env.id, r.email);
      ctx.emit("signature.viewed", subject(env.id), { envelopeId: env.id, signer: r.email });
    }
    if (ORDER[env.status] < ORDER.viewed) ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "viewed", ctx.now(), env.id);
    return { ok: true };
  }

  if (ev.kind === "signed") {
    for (const r of ev.recipients.filter((x) => x.signed)) {
      ctx.db.run("UPDATE esign_signer SET status = ?, signed_at = ? WHERE envelope_id = ? AND email = ? AND status != ?", "signed", ctx.now(), env.id, r.email, "signed");
    }
    return { ok: true };
  }

  // the rest change the envelope for good, so the provider's own answer decides
  const forget = (): void => { ctx.db.run("DELETE FROM esign_hook_seen WHERE provider = ? AND dedupe_key = ?", key, ev.id); };
  let truth: ProviderStatus | null;
  try {
    truth = await provider.status(ev.ref);
  } catch (e) {
    // a document deleted at the provider answers "not found", which is what a cancel looks like
    if (ev.kind === "cancelled") truth = null;
    else {
      ctx.log.warn("esign: could not confirm a webhook with the provider", { provider: key, ref: ev.ref, error: e instanceof Error ? e.message : String(e) });
      forget();
      fail(ctx, "provider.unavailable", "The provider could not confirm that event. It will be retried.");
    }
  }

  if (ev.kind === "completed") {
    if (truth?.state !== "signed") {
      ctx.log.warn("esign: completed webhook not confirmed by the provider", { provider: key, ref: ev.ref, state: truth?.state ?? "gone" });
      forget();
      return { ok: true };
    }
    await saveSigned(ctx, env);
    return { ok: true };
  }

  if (ev.kind === "declined") {
    if (truth?.state !== "declined") {
      ctx.log.warn("esign: declined webhook not confirmed by the provider", { provider: key, ref: ev.ref, state: truth?.state ?? "gone" });
      forget();
      return { ok: true };
    }
    const who = truth.signers.find((x) => x.status === "declined") ?? ev.recipients.find((x) => x.rejected);
    const signer = who ? who.email : "";
    if (signer) ctx.db.run("UPDATE esign_signer SET status = ? WHERE envelope_id = ? AND email = ?", "declined", env.id, signer);
    ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "declined", ctx.now(), env.id);
    const reason = truth.reason ?? ev.reason;
    ctx.emit("signature.declined", subject(env.id), { envelopeId: env.id, signer: signer || "a signer", ...(reason ? { reason } : {}) });
    await finishTask(ctx, env, "canceled", "A signer declined.");
    await tellThread(ctx, env, `${signer || "A signer"} declined to sign ${env.title}${reason ? `: ${reason}` : "."}`, "sig-declined");
    return { ok: true };
  }

  // cancelled at the provider (someone deleted the document there)
  if (truth === null || truth.state === "cancelled") {
    ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "cancelled", ctx.now(), env.id);
    ctx.db.run("UPDATE esign_signer SET status = ? WHERE envelope_id = ? AND status IN (?, ?)", "cancelled", env.id, "sent", "viewed");
    await finishTask(ctx, env, "canceled", "The envelope was cancelled at the provider.");
  }
  return { ok: true };
}

export const hookHandlers = {
  "esign.hook": (ctx: Ctx, input: unknown) => hook(ctx, input),
};
