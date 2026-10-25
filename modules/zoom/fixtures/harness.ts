// Test harness for the zoom handlers: an in-memory database, a recording ctx, a scripted Zoom (recorded responses matched by method and path, no socket is opened), a fake host seam (made-up credentials,
// downloads in memory) and the capabilities zoom calls (meetings, files, runs) as scripted answers. Every call to another capability is checked against that capability's frozen input schema, every
// answer against its output schema, and every event against its payload schema. The recorded bodies follow Zoom's API documentation as of the recording; live-account proof waits on the owner's accounts
// (lead ruling 15); until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import type { HostError } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { setZoomHost } from "../projections.ts";
import type { ZoomCtx, ZoomHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya0001";
export const ACCOUNT = "acct_not_real";
export const CLIENT = "client_not_real";
export const SECRET = "secret_not_real";
export const WEBHOOK = "webhook_secret_not_real";
export const ZOOM_ID = "81234567890";
export const BASIC = `Basic ${Buffer.from(`${CLIENT}:${SECRET}`).toString("base64")}`;
export const START = "2025-10-09T10:00:00Z";

export const RECORDED = {
  token: { access_token: "tok-1", token_type: "bearer", expires_in: 3600 },
  token2: { access_token: "tok-2", token_type: "bearer", expires_in: 3600 },
  me: { id: "u_host1", email: "dana@firm.example", account_id: "acct_not_real" },
  meeting: { id: 81234567890, uuid: "abc==", topic: "Estate consult", start_time: START, duration: 60, join_url: "https://us02web.zoom.us/j/81234567890?pwd=abc", password: "123456", host_email: "dana@firm.example", timezone: "America/New_York" },
  meetings: { meetings: [{ id: 81234567890, uuid: "abc==", topic: "Estate consult", start_time: START, duration: 60, join_url: "https://us02web.zoom.us/j/81234567890" }, { id: 81234567891, topic: "Instant", join_url: "https://us02web.zoom.us/j/81234567891" }], next_page_token: "np1" },
  recordings: {
    id: 81234567890, uuid: "abc==", topic: "Estate consult", start_time: START, share_url: "https://us02web.zoom.us/rec/share/xyz",
    recording_files: [
      { id: "REC0000MP4", file_type: "MP4", recording_type: "shared_screen_with_speaker_view", file_size: 5000, download_url: "https://us02web.zoom.us/rec/download/mp4", status: "completed" },
      { id: "REC0000VTT", file_type: "TRANSCRIPT", recording_type: "audio_transcript", file_size: 200, download_url: "https://us02web.zoom.us/rec/download/vtt", status: "completed" },
    ],
  },
  recordingList: { meetings: [{ id: 81234567890, uuid: "abc==", topic: "Estate consult", start_time: START, recording_files: [{ id: "REC0000MP4", file_type: "MP4", file_size: 5000, download_url: "https://us02web.zoom.us/rec/download/mp4", status: "completed" }] }], next_page_token: "" },
  vtt: "WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nDana Wine: Hello.",
} as const;

export interface Reply { status: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; url: string; path: string; headers: Record<string, string>; body: unknown }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
type Script = (input: Record<string, unknown>) => unknown;

export function harness(o: { noHost?: boolean } = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const downloads: { url: string; bearer: string; mime?: string }[] = [];
  const scripted = new Map<string, Reply[]>();
  const scripts = new Map<string, Script>();
  let clock = NOW;
  let seq = 0;
  let fileSeq = 0;   // files and runs are numbered apart, so a test names a file without counting the runs before it
  const err = (code: string, message: string): HostError => fail(code as never, TRACE, { message });

  const host: ZoomHost = {
    async secret(_ctx, handle) {
      if (handle === "#Zoom_S2S.account_id") return ACCOUNT;
      if (handle === "#Zoom_S2S.client_id") return CLIENT;
      if (handle === "#Zoom_S2S.client_secret") return SECRET;
      if (handle === "#Zoom_Webhook_Secret") return WEBHOOK;
      throw fail("provider.auth_failed", TRACE);
    },
    async download(_ctx, a) {
      downloads.push(a);
      return { blobId: `blb_${"0".repeat(31)}${downloads.length}`, size: 5000, mime: a.mime ?? "application/octet-stream" };
    },
  };
  setZoomHost(o.noHost ? null : host);

  const defaults: Record<string, Script> = {
    "meetings.ingest": (i) => ({ meetingId: i["providerRef"] === "unknown0" ? "rec_new00000" : "rec_mtg00001", created: true, merged: false }),
    "meetings.set_state": (i) => ({ meetingId: i["meetingId"] }),
    "meetings.attach_recording": () => ({ runId: "run_attach001" }),
    "files.tree": () => ({ roots: [{ key: "personal", title: "Personal", kind: "folder", folderId: "fld_personal1", count: 0 }] }),
    "files.create": (i) => ({
      file: {
        fileId: `fil_zrec${++fileSeq}`, folderId: i["folderId"], name: i["name"], kind: i["kind"] ?? "other", mime: i["mime"] ?? "application/octet-stream", size: 5000, version: 1, label: 0, ownerId: MAYA, createdAt: NOW, updatedAt: NOW,
        updatedBy: MAYA, thumb: false, holds: 0,
      },
    }),
    "runs.start": () => ({ runId: `run_zrun${(++seq).toString(36)}` }),
    "runs.finish": (i) => ({ run: { id: i["runId"], kind: "other", owner: MAYA, startedBy: MAYA, status: i["status"], costMicros: 0, startedAt: NOW, traceId: TRACE, ...(i["summary"] ? { summary: i["summary"] } : {}) } }),
  };

  const ctx: ZoomCtx = {
    space: "spc_zoom",
    principal: { kind: "service", id: "svc_engine01" },
    trace: { traceId: TRACE },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload) {
      const e = registry.events.find((x) => x.name === name);
      if (!e) throw new Error(`${name} is not in the registry`);
      const misfit = validate(e.payload, payload, "", registry.$defs);
      if (misfit.length) throw new Error(`${name} was emitted with a payload its contract refuses: ${misfit.join("; ")}`);
      emitted.push({ name, subject, payload: payload as Record<string, unknown> });
      return null;
    },
    async call(cap, input) {
      const body = (input ?? {}) as Record<string, unknown>;
      called.push({ cap, input: body });
      const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
      if (!d) throw new Error(`${cap} is not in the registry`);
      const misfit = validate(d.input, body, "", registry.$defs);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const script = scripts.get(cap) ?? defaults[cap];
      if (!script) throw new Error(`unscripted capability ${cap}`);
      const out = script(body);
      const bad = validate(d.output, out, "", registry.$defs);
      if (bad.length) throw new Error(`the script for ${cap} answered something its contract refuses: ${bad.join("; ")}`);
      return out;
    },
    async http(url, init) {
      const method = init?.method ?? "GET";
      const u = new URL(url);
      const path = `${u.pathname}${u.search}`;
      requests.push({ method, url, path, headers: init?.headers ?? {}, body: init?.body ? safeJson(init.body) : null });
      const queue = scripted.get(`${method} ${u.host}${path}`) ?? scripted.get(`${method} ${u.host}${u.pathname}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${u.host}${path}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, requests, downloads,
    /** Script what Zoom answers to `METHOD host/path[?query]`; several replies are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    /** Replace what another module answers. A thrown HostError is that module refusing. */
    script(cap: string, fn: Script): void { scripts.set(cap, fn); },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    api(): Seen[] { return requests.filter((r) => r.url.startsWith("https://api.zoom.us")); },
    err,
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export type Harness = ReturnType<typeof harness>;

export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!d) return [`${cap} is not in the registry`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}

export const codeOf = (err: unknown): string => (err as { error?: { code?: string } } | null)?.error?.code ?? "";

export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}
