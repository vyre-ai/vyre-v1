// The capability caller of a signed-in device (ARCH 4.4): a capability name goes to the gateway route the generated table names for it, with the session token as the bearer.
// GET routes send the input as the query string, every other route as the JSON body. An answer is `{ data }` or `{ error }`; an error becomes a CapError with the code, the message
// and the trace id, so a screen can show the line and quote the id. The route table is loaded on the first call, not at startup (it is large and the first paint does not need it).
import type { Route } from "../../../../../generated/routes.ts";

export interface CapErrorInit { code: string; message: string; traceId: string; status: number; details?: Record<string, unknown> }

export class CapError extends Error {
  readonly code: string;
  readonly traceId: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  constructor(init: CapErrorInit) {
    super(init.message);
    this.name = "CapError";
    this.code = init.code;
    this.traceId = init.traceId;
    this.status = init.status;
    this.details = init.details;
  }
}

export type RouteRow = Pick<Route, "method" | "path" | "cap" | "v">;
export type CapCall = (cap: string, input?: unknown, o?: { idempotencyKey?: string; signal?: AbortSignal }) => Promise<unknown>;

export interface CapCallerOptions {
  /** The Space's address, e.g. http://127.0.0.1:7777. No trailing slash needed. */
  baseUrl: string;
  /** The session token; null before sign-in (the caller then sends no Authorization header, for the anonymous capabilities). */
  token(): string | null;
  /** Injectable for tests; defaults to the platform fetch. */
  fetch?: typeof fetch;
  /** The route table; defaults to generated/routes.ts, imported on the first call. */
  routes?: () => Promise<readonly RouteRow[]>;
  /** Called when the gateway answers 401 to a call that carried a token: the session is over. */
  onUnauthenticated?: () => void;
}

const loadRoutes = (): Promise<readonly RouteRow[]> => import("../../../../../generated/routes.ts").then((m) => m.routes);

/** Latest version of each capability's route. */
export function indexByCap(routes: readonly RouteRow[]): Map<string, RouteRow> {
  const out = new Map<string, RouteRow>();
  for (const r of routes) {
    const cur = out.get(r.cap);
    if (!cur || r.v > cur.v) out.set(r.cap, r);
  }
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** A GET's query string: text as is, numbers and booleans as text, objects and lists as JSON. A missing value is left out. */
export function queryString(input: unknown): string {
  if (!isObj(input)) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    p.set(k, typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

function errorOf(status: number, body: unknown, trace: string | null): CapError {
  const e = isObj(body) && isObj(body["error"]) ? body["error"] : null;
  const code = e && typeof e["code"] === "string" ? e["code"] : status === 401 ? "auth.unauthenticated" : "internal.unexpected";
  const message = e && typeof e["message"] === "string" ? e["message"] : "Something went wrong on our side.";
  const traceId = e && typeof e["traceId"] === "string" ? e["traceId"] : (trace ?? "");
  const details = e && isObj(e["details"]) ? e["details"] : undefined;
  return new CapError({ code, message, traceId, status, ...(details ? { details } : {}) });
}

export function createCapCaller(o: CapCallerOptions): CapCall {
  const base = o.baseUrl.replace(/\/+$/, "");
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const load = o.routes ?? loadRoutes;
  let index: Promise<Map<string, RouteRow>> | null = null;

  return async function call(cap, input = {}, opts = {}) {
    index ??= load().then(indexByCap);
    const route = (await index).get(cap);
    if (!route) throw new CapError({ code: "validation.unknown_capability", message: "There is no such endpoint.", traceId: "", status: 404, details: { cap } });
    const token = o.token();
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const get = route.method.toUpperCase() === "GET";
    if (!get) headers["content-type"] = "application/json";
    const res = await doFetch(`${base}${route.path}${get ? queryString(input) : ""}`, {
      method: route.method.toUpperCase(),
      headers,
      ...(get ? {} : { body: JSON.stringify(input ?? {}) }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { /* an empty or non-JSON answer: the status decides */ }
    if (res.status === 401 && token) o.onUnauthenticated?.();
    if (res.status >= 400 || (isObj(body) && body["error"] !== undefined)) throw errorOf(res.status, body, res.headers.get("x-vyre-trace"));
    return isObj(body) ? body["data"] : undefined;
  };
}
