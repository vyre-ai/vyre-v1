// esign core (spec 2.20, 2.14, 3.6; ARCH 8.4): send a file from a record folder for signature, track the envelope, save the signed PDF back.
// Providers sit behind EsignProvider { create, status, cancel, fetchSigned }; Documenso (documenso.ts) is the default, run unmodified as its own container.
// esign.send is a Gate act (signature_send): the invoke pipeline parks the call before this handler runs, so a held send never reaches a provider.
// Webhooks are hints. A "signed" or "declined" webhook is acted on only after the provider's own API confirms it, so a forged call cannot mark a document signed.
// Each send opens a Signature task for the sender; it ends with the envelope. The signed PDF becomes a new version of the original file and the audit
// certificate (when the provider returns one) a file beside it, both in the record's folder.
// @reads ../migrations/0001_esign.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { ErrorCode } from "../../../packages/contracts/src/types.ts";
import { mintUuid } from "../../../lib/ids.ts";
import { fail as hostFail } from "../../../host/src/routes/errors.ts";

export type ProviderKey = "documenso" | "dropbox_sign" | "docusign";
export type EnvelopeStatus = "sent" | "viewed" | "signed" | "declined" | "cancelled";

export const PROVIDER_KEYS: readonly ProviderKey[] = ["documenso", "dropbox_sign", "docusign"];
export const DEFAULT_PROVIDER: ProviderKey = "documenso";
export const MAX_SIGNERS = 20;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;

export interface Signer {
  name: string;
  email: string;
  order?: number;
}

export interface EnvelopeRequest {
  /** our envelope id; providers keep it as their external id */
  envelopeId: string;
  title: string;
  fileName: string;
  pdf: Uint8Array;
  signers: Required<Signer>[];
}

export interface ProviderStatus {
  state: EnvelopeStatus;
  signers: { name: string; email: string; status: EnvelopeStatus }[];
  /** set when state is declined */
  reason?: string;
}

export interface SignedFiles {
  pdf: Uint8Array;
  /** the audit certificate as its own PDF, for providers that keep it apart; Documenso embeds it in the signed PDF */
  certificate?: Uint8Array;
}

/** What a provider webhook says happened, already read out of the provider's own payload shape. */
export interface WebhookEvent {
  /** a key that is the same every time the provider re-delivers this event */
  id: string;
  ref: string;
  kind: "viewed" | "signed" | "completed" | "declined" | "cancelled";
  recipients: { email: string; name?: string; read?: boolean; signed?: boolean; rejected?: boolean }[];
  reason?: string;
}

export class ProviderPayloadError extends Error {}

export interface EsignProvider {
  create(req: EnvelopeRequest): Promise<{ ref: string }>;
  status(ref: string): Promise<ProviderStatus>;
  cancel(ref: string): Promise<void>;
  fetchSigned(ref: string): Promise<SignedFiles>;
  /** null: an event this module does not track. Throws ProviderPayloadError for a payload that is not this provider's. */
  webhook(payload: unknown): WebhookEvent | null;
  health?(): Promise<{ ok: boolean; detail?: string }>;
}

export interface EsignConfig {
  providers: Partial<Record<ProviderKey, EsignProvider>>;
}

let configured: EsignConfig | null = null;

/** The host calls this once at start with the providers whose credentials exist. Tests pass fakes; null clears. */
export function configureEsign(config: EsignConfig | null): void {
  configured = config;
}

export function providerOf(key: ProviderKey): EsignProvider | undefined {
  return configured?.providers[key];
}

type Row = Record<string, unknown>;

// ---- helpers ------------------------------------------------------------------------------------------------

export function fail(ctx: Ctx, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  throw hostFail(code, ctx.trace.traceId, { ...(message ? { message } : {}), ...(details ? { details } : {}) });
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const isNull = (v: unknown): boolean => v === null || v === undefined;
export const one = (ctx: Ctx, sql: string, ...args: unknown[]): Row | undefined => (ctx.db.all(sql, ...args) as Row[])[0];
export const many = (ctx: Ctx, sql: string, ...args: unknown[]): Row[] => ctx.db.all(sql, ...args) as Row[];
const nid = (ctx: Ctx, prefix: string): string => `${prefix}_${mintUuid(ctx.now()).replaceAll("-", "")}`;

function rec(ctx: Ctx, input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) fail(ctx, "validation.bad_input", "The input is not valid.");
  return input as Record<string, unknown>;
}

function reqStr(ctx: Ctx, o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function optStr(ctx: Ctx, o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail(ctx, "validation.bad_input", "The input is not valid.", { field: key });
  return v;
}

function providerKey(ctx: Ctx, v: unknown, field: string): ProviderKey {
  if (typeof v !== "string" || !(PROVIDER_KEYS as readonly string[]).includes(v)) fail(ctx, "validation.bad_input", "Choose documenso, dropbox_sign or docusign.", { field });
  return v as ProviderKey;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const EMAIL = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]{2,}$/;

function readSigners(ctx: Ctx, raw: unknown): Required<Signer>[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(ctx, "validation.bad_input", "Add at least one signer.", { field: "signers" });
  if (raw.length > MAX_SIGNERS) fail(ctx, "validation.too_large", `A document can have at most ${MAX_SIGNERS} signers.`, { field: "signers" });
  const seen = new Set<string>();
  return raw.map((s, i): Required<Signer> => {
    if (typeof s !== "object" || s === null) fail(ctx, "validation.bad_input", "Each signer needs a name and an email.", { field: "signers" });
    const o = s as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const email = typeof o.email === "string" ? o.email.trim().toLowerCase() : "";
    if (name.length === 0 || name.length > 200) fail(ctx, "validation.bad_input", `Signer ${i + 1} needs a name.`, { field: "signers" });
    if (email.length > 254 || !EMAIL.test(email)) fail(ctx, "validation.bad_input", `Signer ${i + 1} needs a valid email.`, { field: "signers" });
    if (seen.has(email)) fail(ctx, "validation.duplicate", `${email} is listed twice.`, { field: "signers" });
    seen.add(email);
    const order = o.order === undefined || o.order === null ? 1 : o.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 1 || order > MAX_SIGNERS) fail(ctx, "validation.bad_input", `Signer ${i + 1} has an order the provider cannot use.`, { field: "signers" });
    return { name, email, order };
  });
}

export function defaultProvider(ctx: Ctx): ProviderKey {
  const r = one(ctx, "SELECT * FROM esign_setting WHERE name = ?", "default_provider");
  return r && (PROVIDER_KEYS as readonly string[]).includes(str(r.value)) ? (str(r.value) as ProviderKey) : DEFAULT_PROVIDER;
}

function connected(ctx: Ctx, key: ProviderKey): EsignProvider {
  const p = providerOf(key);
  if (!p) fail(ctx, "validation.precondition_failed", key === "documenso" ? "The Documenso container is not connected on this server yet." : `${key.replace("_", " ")} is not connected. Connect it in Settings, Connections.`, { provider: key });
  return p;
}

async function viaProvider<T>(ctx: Ctx, key: ProviderKey, what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    ctx.log.warn("esign: provider call failed", { provider: key, what, error: e instanceof Error ? e.message : String(e) });
    fail(ctx, "provider.unavailable", `${key.replace("_", " ")} did not answer (${what}). Nothing was sent. Try again in a minute.`, { provider: key });
  }
}

// ---- row shapes ---------------------------------------------------------------------------------------------

export interface EnvelopeRow {
  id: string;
  provider: ProviderKey;
  ref: string;
  title: string;
  fileId: string;
  folderId: string | null;
  recordId: string | null;
  status: EnvelopeStatus;
  taskId: string | null;
  threadId: string | null;
  signedFileId: string | null;
}

export function envelopeOf(r: Row): EnvelopeRow {
  return {
    id: str(r.id), provider: str(r.provider) as ProviderKey, ref: str(r.provider_ref), title: str(r.title), fileId: str(r.file_id),
    folderId: isNull(r.folder_id) ? null : str(r.folder_id), recordId: isNull(r.record_id) ? null : str(r.record_id), status: str(r.status) as EnvelopeStatus,
    taskId: isNull(r.task_id) ? null : str(r.task_id), threadId: isNull(r.thread_id) ? null : str(r.thread_id), signedFileId: isNull(r.signed_file_id) ? null : str(r.signed_file_id),
  };
}

export function mustEnvelope(ctx: Ctx, envelopeId: string): EnvelopeRow {
  const r = one(ctx, "SELECT * FROM esign_envelope WHERE id = ?", envelopeId);
  if (!r) fail(ctx, "validation.not_found", "That envelope does not exist.");
  return envelopeOf(r);
}

export function subject(envelopeId: string): string {
  return `entity/${envelopeId}`;
}

// ---- neighbours: tasks and the run thread (best effort, never fail the signature) -----------------------------

async function soft(ctx: Ctx, what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    ctx.log.warn(`esign: ${what} failed`, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function finishTask(ctx: Ctx, env: EnvelopeRow, to: "done" | "canceled", note: string): Promise<void> {
  if (env.taskId === null) return;
  await soft(ctx, "closing the signature task", () => ctx.call("tasks.transition", { taskId: env.taskId, to, note, idempotencyKey: `esign-task-${env.id}-${to}` }));
}

export async function tellThread(ctx: Ctx, env: EnvelopeRow, body: string, key: string): Promise<void> {
  if (env.threadId === null) return;
  await soft(ctx, "posting in the run thread", () => ctx.call("chat.post", { threadId: env.threadId, body, idempotencyKey: `${key}-${env.id}` }));
}

function assigneeOf(ctx: Ctx): { kind: "person" | "agent"; id: string } | null {
  if (ctx.actingFor) return { kind: "person", id: ctx.actingFor };
  if (ctx.principal.kind === "person") return { kind: "person", id: ctx.principal.id };
  if (ctx.principal.kind === "agent") return { kind: "agent", id: ctx.principal.id };
  return null;
}

// ---- esign.send ---------------------------------------------------------------------------------------------

async function send(ctx: Ctx, input: unknown): Promise<{ envelopeId: string }> {
  const o = rec(ctx, input);
  const fileId = reqStr(ctx, o, "fileId");
  const recordId = optStr(ctx, o, "recordId");
  const signers = readSigners(ctx, o.signers);
  const key = o.provider === undefined || o.provider === null ? defaultProvider(ctx) : providerKey(ctx, o.provider, "provider");
  const provider = connected(ctx, key);

  const meta = (await ctx.call("files.get", { fileId })) as { file?: { name?: string; mime?: string; folderId?: string; size?: number } };
  const file = meta.file;
  if (!file || typeof file.name !== "string") fail(ctx, "validation.not_found", "That file does not exist.");
  if (file.mime !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) fail(ctx, "validation.bad_input", "Only PDF files can be sent for signature. Export the document as a PDF first.", { field: "fileId" });
  if (typeof file.size === "number" && file.size > MAX_PDF_BYTES) fail(ctx, "validation.too_large", "That PDF is over 25 MB.", { field: "fileId" });
  const body = (await ctx.call("files.read", { fileId, as: "base64" })) as { base64?: string; truncated?: boolean };
  if (typeof body.base64 !== "string" || body.truncated === true) fail(ctx, "validation.too_large", "The whole file could not be read for sending.", { field: "fileId" });
  const pdf = fromBase64(body.base64);
  if (pdf.length === 0 || pdf.length > MAX_PDF_BYTES) fail(ctx, "validation.too_large", "That PDF is empty or over 25 MB.", { field: "fileId" });

  const envelopeId = nid(ctx, "env");
  const title = file.name.replace(/\.pdf$/i, "");
  const created = await viaProvider(ctx, key, "send", () => provider.create({ envelopeId, title, fileName: file.name as string, pdf, signers }));
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO esign_envelope (id, provider, provider_ref, title, file_id, folder_id, record_id, status, task_id, thread_id, signed_file_id, certificate_file_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    envelopeId, key, created.ref, title, fileId, file.folderId ?? null, recordId ?? null, "sent", null, ctx.thread ?? null, null, null, ctx.principal.id, now, now,
  );
  for (const s of signers) {
    ctx.db.run("INSERT INTO esign_signer (envelope_id, email, name, order_no, status, viewed_at, signed_at) VALUES (?, ?, ?, ?, ?, ?, ?)", envelopeId, s.email, s.name, s.order, "sent", null, null);
  }

  const who = assigneeOf(ctx);
  if (who) {
    await soft(ctx, "opening the signature task", async () => {
      const made = (await ctx.call("tasks.create", {
        idempotencyKey: `esign-task-${envelopeId}`, kind: "signature", title: `Waiting for ${signers.map((s) => s.name).join(", ")} to sign ${title}`, assigned: who, fileIds: [fileId],
        ...(recordId ? { recordId } : {}), ...(ctx.run ? { source: { kind: "run", id: ctx.run } } : {}),
      })) as { task?: { id?: string; taskId?: string } };
      const taskId = made.task?.id ?? made.task?.taskId;
      if (typeof taskId === "string") ctx.db.run("UPDATE esign_envelope SET task_id = ? WHERE id = ?", taskId, envelopeId);
    });
  }
  const env = mustEnvelope(ctx, envelopeId);
  await tellThread(ctx, env, `Sent ${title} for signature to ${signers.map((s) => `${s.name} (${s.email})`).join(", ")} through ${key.replace("_", " ")}.`, "sig-sent");
  ctx.emit("signature.sent", subject(envelopeId), { envelopeId, ...(recordId ? { recordId } : {}), provider: key });
  return { envelopeId };
}

// ---- reads --------------------------------------------------------------------------------------------------

async function status(ctx: Ctx, input: unknown): Promise<{ status: EnvelopeStatus; signers: { name: string; status: EnvelopeStatus }[] }> {
  const env = mustEnvelope(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"));
  const signers = many(ctx, "SELECT * FROM esign_signer WHERE envelope_id = ?", env.id)
    .sort((a, b) => num(a.order_no) - num(b.order_no) || str(a.email).localeCompare(str(b.email)))
    .map((s) => ({ name: str(s.name), status: str(s.status) as EnvelopeStatus }));
  return { status: env.status, signers };
}

async function list(ctx: Ctx, input: unknown): Promise<{ envelopes: { envelopeId: string; title: string; status: EnvelopeStatus }[] }> {
  const recordId = optStr(ctx, rec(ctx, input), "recordId");
  const rows = recordId === undefined ? many(ctx, "SELECT * FROM esign_envelope") : many(ctx, "SELECT * FROM esign_envelope WHERE record_id = ?", recordId);
  rows.sort((a, b) => num(b.created_at) - num(a.created_at) || str(b.id).localeCompare(str(a.id)));
  return { envelopes: rows.map((r) => ({ envelopeId: str(r.id), title: str(r.title), status: str(r.status) as EnvelopeStatus })) };
}

async function providers(ctx: Ctx): Promise<{ providers: { key: ProviderKey; default: boolean; connected: boolean }[] }> {
  const def = defaultProvider(ctx);
  return { providers: PROVIDER_KEYS.map((key) => ({ key, default: key === def, connected: providerOf(key) !== undefined })) };
}

async function providerSet(ctx: Ctx, input: unknown): Promise<{ ok: true }> {
  const key = providerKey(ctx, rec(ctx, input).provider, "provider");
  connected(ctx, key);
  if (one(ctx, "SELECT * FROM esign_setting WHERE name = ?", "default_provider")) ctx.db.run("UPDATE esign_setting SET value = ? WHERE name = ?", key, "default_provider");
  else ctx.db.run("INSERT INTO esign_setting (name, value) VALUES (?, ?)", "default_provider", key);
  return { ok: true };
}

async function health(ctx: Ctx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const key = defaultProvider(ctx);
  const p = providerOf(key);
  if (!p) return { state: "down", detail: `${key.replace("_", " ")} is not connected.` };
  if (!p.health) return { state: "healthy", detail: "Connected; this provider has no health check." };
  const t0 = performance.now();
  try {
    const r = await p.health();
    const latencyMs = Math.round(performance.now() - t0);
    if (!r.ok) return { state: "down", ...(r.detail ? { detail: r.detail } : {}), latencyMs };
    return { state: latencyMs > 2000 ? "degraded" : "healthy", ...(r.detail ? { detail: r.detail } : {}), latencyMs };
  } catch (e) {
    return { state: "down", detail: e instanceof Error ? e.message.slice(0, 200) : "The provider did not answer." };
  }
}

// ---- cancel -------------------------------------------------------------------------------------------------

async function cancel(ctx: Ctx, input: unknown): Promise<{ cancelled: true }> {
  const env = mustEnvelope(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"));
  if (env.status === "cancelled") return { cancelled: true };
  if (env.status === "signed" || env.status === "declined") fail(ctx, "validation.precondition_failed", `This envelope is already ${env.status}. It cannot be cancelled.`);
  const provider = connected(ctx, env.provider);
  await viaProvider(ctx, env.provider, "cancel", () => provider.cancel(env.ref));
  const now = ctx.now();
  ctx.db.run("UPDATE esign_envelope SET status = ?, updated_at = ? WHERE id = ?", "cancelled", now, env.id);
  ctx.db.run("UPDATE esign_signer SET status = ? WHERE envelope_id = ? AND status IN (?, ?)", "cancelled", env.id, "sent", "viewed");
  await finishTask(ctx, env, "canceled", "The envelope was cancelled.");
  await tellThread(ctx, env, `Cancelled the signature request for ${env.title}.`, "sig-cancel");
  return { cancelled: true };
}

// ---- esign.fetch_signed -------------------------------------------------------------------------------------

/** Saves the signed PDF as a new version of the sent file and the certificate beside it. Safe to call again: a saved envelope returns its file. */
export async function saveSigned(ctx: Ctx, env: EnvelopeRow): Promise<string> {
  if (env.signedFileId !== null) return env.signedFileId;
  const provider = connected(ctx, env.provider);
  const state = await viaProvider(ctx, env.provider, "status", () => provider.status(env.ref));
  if (state.state !== "signed") fail(ctx, "validation.precondition_failed", "Not every signer has signed yet.", { state: state.state });
  const files = await viaProvider(ctx, env.provider, "download", () => provider.fetchSigned(env.ref));
  if (files.pdf.length === 0) fail(ctx, "provider.bad_response", "The provider returned an empty signed file.");
  const saved = (await ctx.call("files.write", { idempotencyKey: `esign-signed-${env.id}`, fileId: env.fileId, content: { base64: toBase64(files.pdf) }, reason: `Signed by ${state.signers.map((s) => s.name).join(", ")}` })) as { file?: { fileId?: string } };
  const fileId = saved.file?.fileId ?? env.fileId;
  let certificateId: string | null = null;
  if (files.certificate && env.folderId !== null) {
    await soft(ctx, "saving the audit certificate", async () => {
      const made = (await ctx.call("files.create", { idempotencyKey: `esign-cert-${env.id}`, folderId: env.folderId, name: `${env.title} - signature certificate.pdf`, content: { base64: toBase64(files.certificate as Uint8Array) }, mime: "application/pdf" })) as { file?: { fileId?: string } };
      if (typeof made.file?.fileId === "string") certificateId = made.file.fileId;
    });
  }
  const now = ctx.now();
  ctx.db.run("UPDATE esign_envelope SET status = ?, signed_file_id = ?, certificate_file_id = ?, updated_at = ? WHERE id = ?", "signed", fileId, certificateId, now, env.id);
  ctx.db.run("UPDATE esign_signer SET status = ?, signed_at = ? WHERE envelope_id = ? AND status != ?", "signed", now, env.id, "signed");
  ctx.emit("signature.signed", subject(env.id), { envelopeId: env.id, fileId });
  await finishTask(ctx, env, "done", "Everyone signed.");
  await tellThread(ctx, env, `${env.title} is signed. The signed PDF is saved as a new version${certificateId ? " with its certificate beside it" : ""}.`, "sig-signed");
  return fileId;
}

async function fetchSigned(ctx: Ctx, input: unknown): Promise<{ fileId: string }> {
  const env = mustEnvelope(ctx, reqStr(ctx, rec(ctx, input), "envelopeId"));
  return { fileId: await saveSigned(ctx, env) };
}

export const sendHandlers = {
  "esign.send": (ctx: Ctx, input: unknown) => send(ctx, input),
  "esign.status": (ctx: Ctx, input: unknown) => status(ctx, input),
  "esign.cancel": (ctx: Ctx, input: unknown) => cancel(ctx, input),
  "esign.fetch_signed": (ctx: Ctx, input: unknown) => fetchSigned(ctx, input),
  "esign.list": (ctx: Ctx, input: unknown) => list(ctx, input),
  "esign.providers": (ctx: Ctx) => providers(ctx),
  "esign.provider_set": (ctx: Ctx, input: unknown) => providerSet(ctx, input),
  "esign.health": (ctx: Ctx) => health(ctx),
};
