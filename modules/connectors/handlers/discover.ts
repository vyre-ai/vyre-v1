// Discovery for an agent filling a SyncSpec: read-only GETs of an app, through a Vault handle, that say what an answer looks like (where the lists are, what one item holds, how the
// next page is asked for, how many there are) so the spec is read off real pages and not guessed from docs. The key is filled by the host at the last moment and never comes back.
// Only GET exists here: there is no way to name another method.
import { refuse } from "../projections.ts";
import type { ConnectorsCtx, ConnectorsDeps, ProbeRequest } from "../projections.ts";
import { analyzeBody } from "../discover.ts";
import type { BodyShape } from "../discover.ts";
import { nextLink } from "../syncspec.ts";

export interface AuthIn { vaultHandle: string; style: "bearer" | "header" | "basic"; header?: string; prefix?: string; headers?: Record<string, string> }
export interface SampleOut {
  status: number; ok: boolean; reason?: string; shape?: BodyShape;
  /** The rel=next address of a Link header, when the app sent one. */
  nextLink?: string;
  /** The first items of the biggest list, long text cut short. */
  items?: unknown[];
  /** A compact copy of a small answer (a field list, a schema), long text cut short. */
  preview?: string;
  /** The most records the app says there are, from a total in the answer. */
  estimate?: { count: number; source: string };
}
export interface SurveyRow { path: string; status: number; reason?: string; lists: { itemsAt: string; count: number; idAt?: string; fields: number }[]; total?: number; nextLink?: boolean }

export interface DiscoverHandlers {
  "sync_specs.sample"(ctx: ConnectorsCtx, input: { auth: AuthIn; domain: string; path: string; query?: Record<string, string>; url?: string; items?: number }): Promise<SampleOut>;
  "sync_specs.survey"(ctx: ConnectorsCtx, input: { auth: AuthIn; domain: string; paths: string[] }): Promise<{ results: SurveyRow[] }>;
}

const HANDLE = /^#[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?$/;
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i;
const MAX_PATHS = 12;

/** Long strings cut short and depth limited, so one page never floods an agent. */
function trim(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}...` : v;
  if (Array.isArray(v)) return depth > 6 ? "[...]" : v.slice(0, 20).map((x) => trim(x, depth + 1));
  if (v !== null && typeof v === "object") return depth > 6 ? "{...}" : Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 60).map(([k, x]) => [k, trim(x, depth + 1)]));
  return v;
}

export function createDiscoverHandlers(deps: ConnectorsDeps): DiscoverHandlers {
  const need = (ctx: ConnectorsCtx, auth: AuthIn, domain: string): ProbeRequest => {
    if (!deps.probe) return refuse(ctx, "internal.unavailable", "Reading the app is not available right now.");
    if (!HANDLE.test(auth.vaultHandle)) return refuse(ctx, "validation.bad_input", "auth.vaultHandle is a Vault handle such as #Acme_API. Never a key value.");
    if (!HOST.test(domain)) return refuse(ctx, "validation.bad_input", "domain is the API host, such as api.example.com.");
    return { handle: auth.vaultHandle, style: auth.style, ...(auth.header ? { header: auth.header } : {}), ...(auth.prefix !== undefined ? { prefix: auth.prefix } : {}), ...(auth.headers ? { headers: auth.headers } : {}), domain, url: "" };
  };
  const address = (ctx: ConnectorsCtx, domain: string, path: string, query?: Record<string, string>): string => {
    if (!path.startsWith("/")) return refuse(ctx, "validation.bad_input", `${path} must start with /.`);
    try {
      const u = new URL(`https://${domain}${path}`);
      for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
      return u.toString();
    } catch { return refuse(ctx, "validation.bad_input", `${path} is not a path.`); }
  };
  const get = async (ctx: ConnectorsCtx, base: ProbeRequest, url: string): Promise<{ status: number; text: string; link?: string }> => {
    try { return await deps.probe!(ctx, { ...base, url }); } catch (e) {
      const err = (e as { error?: { code?: string; message?: string } }).error;
      if (err?.code === "permission.no_grant" || err?.code === "validation.bad_input") throw e;
      return { status: 0, text: err?.message ?? (e instanceof Error ? e.message : "The app could not be reached.") };
    }
  };
  const read = (r: { status: number; text: string; link?: string }, n: number): SampleOut => {
    if (r.status === 0) return { status: 0, ok: false, reason: r.text.slice(0, 200) };
    if (r.status === 401 || r.status === 403) return { status: r.status, ok: false, reason: `The app refused the key (${r.status}). Check the Vault item, its scopes and the header it is sent in.` };
    if (r.status < 200 || r.status >= 300) return { status: r.status, ok: false, reason: `The app answered ${r.status}. Check the path and parameters.` };
    let body: unknown = r.text;
    try { body = r.text === "" ? null : (JSON.parse(r.text) as unknown); } catch { return { status: r.status, ok: false, reason: "The answer is not JSON.", preview: r.text.slice(0, 300) }; }
    const shape = analyzeBody(body);
    const top = shape.lists[0];
    const link = r.link ? nextLink(r.link) : undefined;
    const total = shape.totals[0];
    const items = top ? (top.itemsAt === "/" ? (Array.isArray(body) ? body : []) : findList(body, top.itemsAt)) : undefined;
    const compact = JSON.stringify(trim(body));
    return {
      status: r.status, ok: true, shape, ...(link ? { nextLink: link } : {}),
      ...(items ? { items: items.slice(0, n).map((x) => trim(x)) } : {}),
      ...(compact.length <= 6000 ? { preview: compact } : {}),
      ...(total ? { estimate: { count: total.value, source: total.pointer } } : {}),
    };
  };
  const findList = (body: unknown, pointer: string): unknown[] => {
    let cur: unknown = body;
    for (const raw of pointer.slice(1).split("/")) {
      if (cur === null || typeof cur !== "object") return [];
      cur = (cur as Record<string, unknown>)[raw.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    return Array.isArray(cur) ? cur : [];
  };

  return {
    "sync_specs.sample": async (ctx, input) => {
      const base = need(ctx, input.auth, input.domain);
      let url: string;
      if (input.url !== undefined) {
        try { url = new URL(input.url).hostname === input.domain ? input.url : ""; } catch { url = ""; }
        if (!url) return refuse(ctx, "validation.bad_input", "url must be on the same host as domain.");
      } else url = address(ctx, input.domain, input.path, input.query);
      return read(await get(ctx, base, url), Math.min(Math.max(input.items ?? 3, 1), 10));
    },

    "sync_specs.survey": async (ctx, input) => {
      const base = need(ctx, input.auth, input.domain);
      if (!input.paths.length || input.paths.length > MAX_PATHS) return refuse(ctx, "validation.bad_input", `Give 1 to ${MAX_PATHS} paths.`);
      const results: SurveyRow[] = [];
      for (const path of input.paths) {
        const q = path.indexOf("?");
        const url = address(ctx, input.domain, q < 0 ? path : path.slice(0, q), q < 0 ? undefined : Object.fromEntries(new URLSearchParams(path.slice(q + 1))));
        const r = await get(ctx, base, url);
        const s = read(r, 1);
        results.push({
          path, status: s.status, ...(s.ok ? {} : { reason: s.reason ?? "failed" }),
          lists: (s.shape?.lists ?? []).slice(0, 3).map((l) => ({ itemsAt: l.itemsAt, count: l.count, ...(l.idAt ? { idAt: l.idAt } : {}), fields: l.fields.length })),
          ...(s.estimate ? { total: s.estimate.count } : {}), ...(s.nextLink ? { nextLink: true } : {}),
        });
      }
      return { results };
    },
  };
}
