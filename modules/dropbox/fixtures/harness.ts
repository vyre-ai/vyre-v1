// Test harness for the dropbox handlers: an in-memory database, a recording ctx, a scripted Dropbox (recorded bodies matched by host and path, no socket is opened), a fake host seam (made-up credentials,
// transfers in memory) and the capabilities dropbox calls in other modules (the Vault) as scripted answers. A call to another capability is checked against that capability's frozen schema in the generated
// registry; the dropbox events and capabilities are checked against manifests/dropbox.ts itself, so these tests do not wait for a regeneration of generated/. The recorded bodies follow Dropbox's API
// documentation; live-account proof waits on the owner's Dropbox app until then these are the contract.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import manifest from "../../../manifests/dropbox.ts";
import { ensure, setDropboxHost } from "../projections.ts";
import type { DropboxCtx, DropboxHost } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;
export const TRACE = "0123456789abcdef0123456789abcdef";
export const MAYA = "usr_maya0001";
export const OTHER = "usr_omar0002";
export const APP_KEY = "appkey_not_real";
export const APP_SECRET = "appsecret_not_real";
export const REFRESH = "refresh_not_real";
export const ACCESS = "sl.access_not_real";

export const RECORDED = {
  account: { account_id: "dbid:AAH4f99T0taONIb", name: { display_name: "Maya Rivera" }, email: "maya@firm.example" },
  folder: { ".tag": "folder", name: "Sales", path_lower: "/sales", path_display: "/Sales", id: "id:fold1" },
  file: { ".tag": "file", name: "Report.docx", path_lower: "/sales/report.docx", path_display: "/Sales/Report.docx", id: "id:file1", rev: "015ab0c1d2e3f4a5", size: 1200, server_modified: "2026-10-20T10:00:00Z", content_hash: "h1" },
  sub: { ".tag": "folder", name: "Q4", path_lower: "/sales/q4", path_display: "/Sales/Q4", id: "id:fold2" },
  deep: { ".tag": "file", name: "Deck é.pptx", path_lower: "/sales/q4/deck é.pptx", path_display: "/Sales/Q4/Deck é.pptx", id: "id:file2", rev: "015ab0c1d2e3f4b6", size: 90, server_modified: "2026-10-21T10:00:00Z" },
} as const;

export interface Reply { status?: number; body?: unknown; throws?: boolean }
export interface Seen { method: string; url: string; host: string; path: string; headers: Record<string, string>; body: unknown }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Emitted { name: string; subject: string; payload: Record<string, unknown> }
type Script = (input: Record<string, unknown>) => unknown;

interface Options { noHost?: boolean; principal?: DropboxCtx["principal"]; actingFor?: string; allow?: boolean; publicUrl?: string }

export function harness(o: Options = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const requests: Seen[] = [];
  const scripted = new Map<string, Reply[]>();
  const scripts = new Map<string, Script>();
  const tokenAsks: { refreshHandle: string; asker?: string; fresh?: boolean }[] = [];
  const uploads: { token: string; arg: Record<string, unknown>; fileId: string }[] = [];
  const downloads: { token: string; arg: Record<string, unknown>; mime?: string }[] = [];
  const transfer: { upload: { status: number; json: Record<string, unknown> }[]; download: { status: number; json: Record<string, unknown>; size?: number }[] } = { upload: [], download: [] };
  let clock = NOW;
  let seq = 0;
  let tokenSeq = 0;

  const host: DropboxHost = {
    async app(_ctx, handle) {
      if (handle === "#Dropbox_Missing") throw fail("provider.auth_failed", TRACE);
      return { appKey: APP_KEY, hasSecret: handle !== "#Dropbox_NoSecret" };
    },
    async appSecret() { return APP_SECRET; },
    async publicUrl() { return o.publicUrl ?? "https://space.vyre.test"; },
    async exchange(_ctx, a) {
      requests.push({ method: "EXCHANGE", url: "exchange", host: "exchange", path: a.code, headers: {}, body: { verifier: a.verifier, redirectUri: a.redirectUri } });
      if (a.code === "bad-code") throw fail("provider.auth_failed", TRACE);
      return { refreshToken: REFRESH, accessToken: ACCESS, expiresAt: clock + 14_400_000, accountId: RECORDED.account.account_id };
    },
    async token(_ctx, a) {
      tokenAsks.push({ refreshHandle: a.refreshHandle, ...(a.asker ? { asker: a.asker } : {}), ...(a.fresh ? { fresh: true } : {}) });
      return { token: `tok-${++tokenSeq}`, expiresAt: clock + 14_400_000 };
    },
    async upload(_ctx, a) {
      uploads.push(a);
      return transfer.upload.shift() ?? { status: 200, json: { ...RECORDED.file, id: "id:file1" } as never };
    },
    async download(_ctx, a) {
      downloads.push(a);
      const r = transfer.download.shift() ?? { status: 200, json: {}, size: 1200 };
      return r.status < 300 ? { status: r.status, json: {}, blob: { blobId: `blb_${"0".repeat(31)}${downloads.length}`, size: r.size ?? 1200, mime: a.mime ?? "application/octet-stream" } } : { status: r.status, json: r.json };
    },
  };
  setDropboxHost(o.noHost ? null : host);

  const defaults: Record<string, Script> = {
    "vault.folders.list": () => ({ folders: [] }),
    "vault.folders.create": (i) => ({ folder: { id: "vfd_conn0001", name: i["name"], scope: i["scope"], owner: MAYA, itemCount: 0, whoCanExport: [], yourLevel: "manage" } }),
    "vault.item.put": (i) => ({
      item: {
        id: `vit_dbx${++seq}`, name: i["name"], kind: "other", folderId: i["folderId"], owner: MAYA, scope: "mine", fieldKeys: ["token"], handle: `#Dropbox_tok${seq}`, spaceOnly: false, injectIntoDeployments: false,
        yourLevel: "manage", label: 0, createdAt: NOW, updatedAt: NOW,
      },
    }),
    "vault.item.update": (i) => ({
      item: {
        id: i["itemId"], name: "Dropbox", kind: "other", folderId: "vfd_conn0001", owner: MAYA, scope: "mine", fieldKeys: ["token"], handle: "#Dropbox_tok1", spaceOnly: false, injectIntoDeployments: false,
        yourLevel: "manage", label: 0, createdAt: NOW, updatedAt: NOW,
      },
    }),
    "vault.item.delete": () => ({ ok: true }),
  };

  const ctx: DropboxCtx = {
    space: "spc_dropbox",
    principal: o.principal ?? { kind: "person", id: MAYA },
    ...(o.actingFor ? { actingFor: o.actingFor } : {}),
    trace: { traceId: TRACE },
    now: () => clock,
    db: memoryDb(),
    authorize: () => ({ effect: o.allow === false ? "deny" : "allow", reason: "test", decisionId: "dec_1" }),
    emit(name, subject, payload) {
      const e = manifest.events?.find((x) => x.name === name);
      if (!e) throw new Error(`${name} is not in the dropbox manifest`);
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
      requests.push({ method, url, host: u.host, path: u.pathname, headers: init?.headers ?? {}, body: init?.body ? safeJson(init.body) : null });
      const queue = scripted.get(`${method} ${u.host}${u.pathname}`);
      if (!queue || queue.length === 0) throw new Error(`unscripted request ${method} ${u.host}${u.pathname}`);
      const reply = queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
      if (reply.throws) throw new Error("socket hang up");
      const text = reply.body === undefined ? "" : typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
      return { status: reply.status ?? 200, text: async () => text };
    },
    log: { info() {}, warn() {} },
  };

  return {
    ctx, emitted, called, requests, tokenAsks, uploads, downloads,
    /** Script what Dropbox answers to `POST host/path`; several replies are answered in order, the last one repeatedly. */
    on(request: string, ...replies: Reply[]): void { scripted.set(request, replies); },
    /** Replace what another module answers. A thrown HostError is that module refusing. */
    script(cap: string, fn: Script): void { scripts.set(cap, fn); },
    /** What the host's upload and download answer next, in order. */
    nextUpload(...r: { status: number; json: Record<string, unknown> }[]): void { transfer.upload.push(...r); },
    nextDownload(...r: { status: number; json: Record<string, unknown>; size?: number }[]): void { transfer.download.push(...r); },
    advance(ms: number) { clock += ms; },
    rows(sql: string, ...args: unknown[]) { return ctx.db.all(sql, ...args) as Record<string, string | number | null>[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
    api(): Seen[] { return requests.filter((r) => r.host.endsWith("dropboxapi.com")); },
    /** The app set up and an account connected, as app.set and connect.complete would have left them. */
    connect(over: { connectionId?: string; ownerKind?: "person" | "space"; ownerId?: string } = {}): string {
      ensure(ctx);
      if (!ctx.db.all(`SELECT "id" FROM dropbox_config WHERE "id" = ?`, "dropbox").length) ctx.db.run(`INSERT INTO dropbox_config ("id", "vaultItem", "appKey", "updated_at") VALUES (?, ?, ?, ?)`, "dropbox", "#Dropbox_App", APP_KEY, NOW);
      const connectionId = over.connectionId ?? "con_dbx0001";
      const ownerKind = over.ownerKind ?? "person";
      ctx.db.run(
        `INSERT INTO dropbox_account ("connectionId", "ownerKind", "ownerId", "accountId", "email", "name", "refreshHandle", "refreshItem", "created_at") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        connectionId, ownerKind, over.ownerId ?? (ownerKind === "space" ? "space" : MAYA), RECORDED.account.account_id, RECORDED.account.email, "Maya Rivera", "#Dropbox_tok0", "vit_dbx0", NOW,
      );
      return connectionId;
    },
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}

export type Harness = ReturnType<typeof harness>;

export const codeOf = (err: unknown): string => (err as { error?: { code?: string } } | null)?.error?.code ?? "";

export async function refusedWith(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return codeOf(e);
  }
  throw new Error("expected a refusal");
}

/** Check a value against one of the dropbox capabilities' frozen schemas, straight from the manifest. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const d = manifest.capabilities?.find((c) => c.name === cap);
  if (!d) return [`${cap} is not in the dropbox manifest`];
  return validate(side === "in" ? d.input : d.output, value, "", registry.$defs);
}
