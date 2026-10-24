// Updates, part one: channels, the signed release manifest, status, history, app compatibility and health (spec 3.10, b13 releases; ARCH 7.10).
//
// The server follows one of three channels (stable, beta, nightly). The release feed hands over a manifest and a detached Ed25519 signature; nothing is read
// from a manifest until the signature checks out against the release key the host pinned (the key lives in the `release` GitHub Environment, the public half
// is compiled into the server). The signature covers "vyre-release-sums\n" plus the exact manifest bytes, so a manifest cannot be replayed as another kind
// of signed file. A manifest for another channel, one that is not a version, or one older than the running server is refused.
//
// The manifest carries an entry per independent channel (b13): the server, the apps per platform, Kits and connectors. This module acts on the server entry
// and reads the apps entry for compatibility; Kits and connectors update per Space and never block a server update.
//
// Hashing and signature checks use Web Crypto (no node:crypto in modules, B3).
//
// from vyre 0.6.9 core/update/index.js (the check, the channel pick, the status shape) and lib/releases.js (semver order)

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";

/** The part of the host Ctx the updates handlers use. The full Ctx satisfies it. */
export type UpdateCtx = Pick<Ctx, "space" | "principal" | "actingFor" | "trace" | "now" | "db" | "emit" | "call" | "run">;

// ---- the drivers the host supplies

/** One signed document from the release feed: the manifest text and its detached signature (base64). */
export interface SignedManifest { manifest: string; signature: string }

export interface ReleaseFeed {
  fetch(channel: Channel): Promise<SignedManifest>;
}

export interface ReleaseInfo { version: string; tarball: string; sha256: string; notes?: string; security?: boolean }

/** What changes the running server. The host implements it (the supervisor, the image pull, the restart). */
export interface Installer {
  /** The version that is running now. */
  current(): Promise<string>;
  /** Versions kept on disk that the server can go back to, newest first. */
  previous(): Promise<string[]>;
  /** Fetch the artifact, check its sha256 against the manifest's, switch to it and restart. Resolves once the process is up again. */
  install(release: ReleaseInfo): Promise<void>;
  /** Does the running server answer its health probe? */
  healthy(): Promise<boolean>;
  /** Switch back to a kept version and restart. */
  switchTo(version: string): Promise<void>;
}

export interface UpdateDrivers {
  feed: ReleaseFeed;
  /** The pinned Ed25519 public key (32 bytes) every release manifest must be signed with. */
  releaseKey: Uint8Array;
  installer: Installer;
}

let drivers: UpdateDrivers | null = null;
/** Wire (or, with null, unwire) the host drivers. */
export function configureUpdates(d: UpdateDrivers | null): void {
  drivers = d;
}

// ---- errors and small readers

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

/** Throw a typed error from the global catalogue with the trace id and the catalogue's next steps. */
export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code, message: message ?? def.what, retryable: def.retryable, traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

export type Row = Record<string, unknown>;
export const asRow = (v: unknown): Row | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function mint(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(9));
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `${prefix}_${hex}`;
}

export function need(ctx: UpdateCtx): UpdateDrivers {
  if (!drivers) return failWith(ctx.trace.traceId, "internal.unavailable", "Updates are not available on this server yet.", { service: "updates" });
  return drivers;
}

export const CHANNELS = ["stable", "beta", "nightly"] as const;
export type Channel = (typeof CHANNELS)[number];
export const isChannel = (v: unknown): v is Channel => typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
export const DEFAULT_CHANNEL: Channel = "stable";
/** The server supports apps up to this many minor versions away (spec 3.10). */
export const APP_WINDOW = 2;
const HISTORY_MAX = 200;
/** A last look older than this no longer says the server is current. */
export const STALE_CHECK_MS = 7 * 86_400_000;

// ---- versions

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
export interface Version { major: number; minor: number; patch: number; pre: string[] }

export function parseVersion(v: unknown): Version | null {
  const m = typeof v === "string" ? SEMVER.exec(v.trim()) : null;
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split(".") : [] };
}

/** Semver order, -1, 0 or 1. A prerelease sorts before its release; beta.10 after beta.9. Throws on a string that is not a version. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`);
  for (const k of ["major", "minor", "patch"] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/**
 * The app versions a server of `server` supports: the same minor and the APP_WINDOW minors on either side, any patch. `min` is the first supported
 * minor (never below 0.0.0) and `max` the last supported minor's highest possible patch.
 */
export function appWindow(server: string): { min: string; max: string } | null {
  const v = parseVersion(server);
  if (!v) return null;
  const low = Math.max(0, v.minor - APP_WINDOW);
  return { min: `${v.major}.${low}.0`, max: `${v.major}.${v.minor + APP_WINDOW}.${MAX_PATCH}` };
}
const MAX_PATCH = 9999;

/** Is an app of `app` inside the window of a server of `server`? An app outside it (older or newer) must update; an older one reads only. */
export function appSupported(server: string, app: string): boolean {
  const w = appWindow(server), a = parseVersion(app);
  if (!w || !a) return false;
  const lo = parseVersion(w.min), hi = parseVersion(w.max);
  if (!lo || !hi) return false;
  return compareVersions(`${a.major}.${a.minor}.${a.patch}`, `${lo.major}.${lo.minor}.0`) >= 0 && compareVersions(`${a.major}.${a.minor}.${a.patch}`, `${hi.major}.${hi.minor}.${MAX_PATCH}`) <= 0;
}

// ---- hashing and signature checks over Web Crypto

const enc = new TextEncoder();
const dec = new TextDecoder();
/** The domain-separation prefix every release signature covers (kept from 0.6 core/vyre-core/release.js SUMS_PREFIX). */
export const SIGNATURE_PREFIX = "vyre-release-sums\n";

const copy = (d: Uint8Array) => {
  const out = new Uint8Array(new ArrayBuffer(d.byteLength));
  out.set(d);
  return out;
};

export function fromBase64(s: string): Uint8Array | null {
  const t = s.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(t) || t.length % 4 !== 0) return null;
  return new Uint8Array(Buffer.from(t, "base64"));
}

/** Does the detached Ed25519 signature (base64) cover the manifest text under the pinned key? */
export async function verifySignature(manifest: string, signatureB64: string, key: Uint8Array): Promise<boolean> {
  const sig = fromBase64(signatureB64);
  if (!sig || sig.length !== 64 || key.length !== 32) return false;
  try {
    const k = await globalThis.crypto.subtle.importKey("raw", copy(key), { name: "Ed25519" }, false, ["verify"]);
    return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, k, copy(sig), copy(enc.encode(SIGNATURE_PREFIX + manifest)));
  } catch {
    return false;
  }
}

// ---- the manifest

export interface Manifest {
  channel: Channel;
  server: ReleaseInfo;
  /** app versions on offer, per platform */
  apps: { platform: string; version: string }[];
}

/** Read a manifest's text. Returns null with a reason when it is not one this server may act on. Does not check the signature. */
export function parseManifest(text: string, channel: Channel): { manifest: Manifest } | { reason: string } {
  let doc: Row | null;
  try { doc = asRow(JSON.parse(text)); } catch { return { reason: "the manifest is not JSON" }; }
  if (!doc || doc["v"] !== 1) return { reason: "the manifest version is not one this server reads" };
  if (doc["channel"] !== channel) return { reason: `the manifest is for the ${String(doc["channel"])} channel, not ${channel}` };
  const server = asRow(doc["server"]);
  const version = str(server?.["version"]);
  if (!server || !version || !parseVersion(version)) return { reason: "the manifest has no server version" };
  const tarball = str(server["tarball"]), sha256 = str(server["sha256"]);
  if (!tarball || !sha256 || !/^[0-9a-f]{64}$/.test(sha256)) return { reason: "the manifest does not name the artifact and its sha256" };
  const info: ReleaseInfo = { version, tarball, sha256 };
  const notes = str(server["notes"]);
  if (notes) info.notes = notes.slice(0, 4000);
  if (server["security"] === true) info.security = true;
  const apps: Manifest["apps"] = [];
  const appDoc = asRow(doc["apps"]);
  for (const [platform, v] of Object.entries(appDoc ?? {})) if (typeof v === "string" && parseVersion(v)) apps.push({ platform, version: v });
  return { manifest: { channel, server: info, apps } };
}

/** Fetch the channel's manifest and accept it only if the signature checks and the content is one this server may act on. */
export async function fetchVerified(ctx: UpdateCtx, channel: Channel): Promise<Manifest> {
  const d = need(ctx);
  let signed: SignedManifest;
  try {
    signed = await d.feed.fetch(channel);
  } catch (e) {
    return failWith(ctx.trace.traceId, "provider.unavailable", `The release feed could not be reached: ${e instanceof Error ? e.message : "unknown error"}`);
  }
  if (!(await verifySignature(signed.manifest, signed.signature, d.releaseKey))) {
    return failWith(ctx.trace.traceId, "provider.bad_response", "The release signature does not match Vyre's release key, so nothing was read from it and nothing will be installed.", { reason: "bad_signature" });
  }
  const parsed = parseManifest(signed.manifest, channel);
  if ("reason" in parsed) return failWith(ctx.trace.traceId, "provider.bad_response", `The release manifest was refused: ${parsed.reason}.`, { reason: "bad_manifest" });
  return parsed.manifest;
}

// ---- state rows

export function readState(ctx: UpdateCtx): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of ctx.db.all("SELECT key, value FROM updates_state")) {
    const x = asRow(r);
    if (x && typeof x["key"] === "string" && typeof x["value"] === "string") m.set(x["key"], x["value"]);
  }
  return m;
}

export function writeState(ctx: UpdateCtx, key: string, value: string): void {
  ctx.db.run("INSERT OR REPLACE INTO updates_state (key, value) VALUES (?, ?)", key, value);
}

export function channelOf(state: Map<string, string>): Channel {
  const c = state.get("channel");
  return isChannel(c) ? c : DEFAULT_CHANNEL;
}

export interface HistoryRow { id: string; at: number; from: string; to: string; result: "ok" | "failed" | "rolled_back"; seconds: number; backupId?: string; reason?: string }

export function historyRows(ctx: UpdateCtx, limit = HISTORY_MAX): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const r of ctx.db.all("SELECT * FROM updates_history ORDER BY at DESC LIMIT ?", limit)) {
    const x = asRow(r);
    const id = str(x?.["id"]);
    const result = x?.["result"];
    if (!x || !id || (result !== "ok" && result !== "failed" && result !== "rolled_back")) continue;
    const backupId = str(x["backup_id"]), reason = str(x["reason"]);
    out.push({ id, at: num(x["at"]), from: str(x["from_version"]) ?? "", to: str(x["to_version"]) ?? "", result, seconds: num(x["seconds"]), ...(backupId ? { backupId } : {}), ...(reason ? { reason } : {}) });
  }
  return out;
}

export function recordHistory(ctx: UpdateCtx, h: HistoryRow): void {
  ctx.db.run(
    "INSERT OR REPLACE INTO updates_history (id, at, from_version, to_version, result, seconds, backup_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    h.id, h.at, h.from, h.to, h.result, h.seconds, h.backupId ?? null, h.reason ?? null,
  );
}

/** What the last look found, newer than the running version or null. */
function waiting(state: Map<string, string>, current: string): { version: string; notes?: string; security: boolean; apps: Manifest["apps"] } | null {
  const v = state.get("available");
  if (!v || !parseVersion(v) || compareVersions(v, current) <= 0) return null;
  let apps: Manifest["apps"] = [];
  try {
    const parsed = JSON.parse(state.get("apps_json") ?? "[]") as unknown;
    if (Array.isArray(parsed)) apps = parsed.flatMap((a) => { const r = asRow(a); const p = str(r?.["platform"]), ver = str(r?.["version"]); return p && ver ? [{ platform: p, version: ver }] : []; });
  } catch { /* an unreadable cache is an empty one */ }
  const notes = str(state.get("notes"));
  return { version: v, ...(notes ? { notes } : {}), security: state.get("security") === "1", apps };
}

// ---- handlers

export async function status(ctx: UpdateCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const current = await d.installer.current();
  const state = readState(ctx);
  const w = waiting(state, current);
  const last = historyRows(ctx, 1)[0];
  return {
    current,
    channel: channelOf(state),
    ...(w ? { available: w.version } : {}),
    ...(last ? { lastResult: last.result } : {}),
  };
}

export async function channel_set(ctx: UpdateCtx, input: { channel: string }) {
  need(ctx);
  if (!isChannel(input.channel)) return failWith(ctx.trace.traceId, "validation.bad_input", "Choose stable, beta or nightly.", { errors: ["channel: not a channel"] });
  const state = readState(ctx);
  if (channelOf(state) !== input.channel || !state.has("channel")) {
    writeState(ctx, "channel", input.channel);
    // what the last look found belongs to the old channel
    for (const k of ["available", "notes", "security", "apps_json", "checked_at"]) ctx.db.run("DELETE FROM updates_state WHERE key = ?", k);
  }
  return { ok: true };
}

export async function check(ctx: UpdateCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const channel = channelOf(readState(ctx));
  const current = await d.installer.current();
  const manifest = await fetchVerified(ctx, channel);
  const newer = compareVersions(manifest.server.version, current) > 0;
  writeState(ctx, "checked_at", String(ctx.now()));
  writeState(ctx, "apps_json", JSON.stringify(manifest.apps));
  if (newer) {
    writeState(ctx, "available", manifest.server.version);
    writeState(ctx, "notes", manifest.server.notes ?? "");
    writeState(ctx, "security", manifest.server.security ? "1" : "0");
  } else {
    for (const k of ["available", "notes", "security"]) ctx.db.run("DELETE FROM updates_state WHERE key = ?", k);
  }
  // the apps this server will serve once it is on the version on offer (or the running one when nothing is on offer)
  const target = newer ? manifest.server.version : current;
  const supportedApps = manifest.apps.filter((a) => appSupported(target, a.version)).map((a) => `${a.platform} ${a.version}`);
  return {
    ...(newer ? { available: manifest.server.version } : {}),
    ...(newer && manifest.server.notes ? { notes: manifest.server.notes } : {}),
    supportedApps,
  };
}

export async function history(ctx: UpdateCtx, _input: Record<string, unknown>) {
  return { updates: historyRows(ctx).map((h) => ({ from: h.from, to: h.to, at: h.at, result: h.result, seconds: h.seconds })) };
}

export async function app_compat(ctx: UpdateCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const current = await d.installer.current();
  const w = appWindow(current);
  if (!w) return failWith(ctx.trace.traceId, "internal.unexpected", "The running server version is not a version.", { current });
  // an app older than min gets update_required and opens read-only (ARCH 5.x handshake)
  return { min: w.min, max: w.max, updateRequiredBelow: w.min };
}

export async function health(ctx: UpdateCtx, _input: Record<string, unknown>) {
  const d = need(ctx);
  const started = ctx.now();
  const current = await d.installer.current();
  const latencyMs = Math.max(0, ctx.now() - started);
  const state = readState(ctx);
  const w = waiting(state, current);
  const last = historyRows(ctx, 1)[0];
  if (last && last.result === "failed") return { state: "degraded" as const, detail: `The last update to ${last.to} failed${last.reason ? `: ${last.reason}` : ""}. The server is on ${current}.`, latencyMs };
  if (w?.security) return { state: "degraded" as const, detail: `A security update (${w.version}) is waiting. Update from Console, Infrastructure, Server, Updates.`, latencyMs };
  const checkedAt = Number(state.get("checked_at"));
  if (state.has("checked_at") && Number.isFinite(checkedAt) && ctx.now() - checkedAt > STALE_CHECK_MS) return { state: "degraded" as const, detail: "The server has not looked for updates in over a week.", latencyMs };
  return { state: "healthy" as const, latencyMs };
}
