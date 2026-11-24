// The capability caller of a signed-in device (ARCH 4.4), in the client layer because apps and ui never fetch (boundary B4): a capability name goes to the gateway route the generated table names for it, with the session token as the bearer.
// GET routes send the input as the query string, every other route as the JSON body. An answer is `{ data }` or `{ error }`; an error becomes a CapError with the code, the message
// and the trace id, so a screen can show the line and quote the id. The route table is loaded on the first call, not at startup (it is large and the first paint does not need it).
import type { Route } from "../../../generated/routes.ts";

export interface CapErrorInit {
  code: string;
  message: string;
  traceId: string;
  status: number;
  details?: Record<string, unknown>;
}

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

export type RouteRow = Pick<Route, "method" | "path" | "cap" | "v"> & Partial<Pick<Route, "idempotency" | "effects">>;
export type CapCall = (
  cap: string,
  input?: unknown,
  o?: { idempotencyKey?: string; signal?: AbortSignal },
) => Promise<unknown>;

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

/** The reads a chat needs to paint its last messages. */
const OPENS_A_CHAT = new Set(["threads.get", "chat.messages.list"]);
/** The longest any other read waits for those two (a chat that is slow to load holds the rest of the app back this long at most, never more). */
const HOLD_MS = 400;

const loadRoutes = (): Promise<readonly RouteRow[]> => import("../../../generated/routes.ts").then((m) => m.routes);

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

/** The code of the error for an answer that was not a Space's (a 2xx that is not JSON). The app treats it as no answer at all. */
export const BAD_ANSWER = "gateway.bad_answer";
/** The statuses that carry no body by definition (the relay bridge reads them the same way): an answer of one of these says nothing and is not a bad answer. */
const BODYLESS: ReadonlySet<number> = new Set([204, 205, 304]);

function errorOf(status: number, body: unknown, trace: string | null): CapError {
  const e = isObj(body) && isObj(body["error"]) ? body["error"] : null;
  const code =
    e && typeof e["code"] === "string" ? e["code"] : status === 401 ? "auth.unauthenticated" : "internal.unexpected";
  const message = e && typeof e["message"] === "string" ? e["message"] : "Something went wrong on our side.";
  const traceId = e && typeof e["traceId"] === "string" ? e["traceId"] : (trace ?? "");
  const details = e && isObj(e["details"]) ? e["details"] : undefined;
  return new CapError({ code, message, traceId, status, ...(details ? { details } : {}) });
}

/** A 401 that says the person's Mine vault key is locked on this computer is about the vault, not the session: the person stays signed in and the Vault asks for the password. */
export function vaultLocked(body: unknown): boolean {
  const e = isObj(body) && isObj(body["error"]) ? body["error"] : null;
  if (!e) return false;
  const d = isObj(e["details"]) ? e["details"] : null;
  return (
    d?.["reason"] === "vault_locked" ||
    (typeof e["message"] === "string" && /vault key is locked|sign-ins are locked/i.test(e["message"]))
  );
}

let mints = 0;
const mint = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `k_${Date.now().toString(36)}_${(mints++).toString(36)}`;
};

/**
 * A capability whose contract asks for an idempotencyKey (idempotency: "key") gets one when the caller sent none: a screen that forgot it would be refused with "/idempotencyKey: required" and look dead.
 * The key is the caller's own, else the call's `opts.idempotencyKey` (the session sets one per logical call, so a send that is held and sent again, such as after the vault password, reuses it), else a new one.
 */
export function withKey(route: RouteRow, input: unknown, supplied?: string): unknown {
  if (route.idempotency !== "key" || !isObj(input) || input["idempotencyKey"] !== undefined) return input ?? {};
  return { ...input, idempotencyKey: supplied ?? mint() };
}

/** A connection that was reset or hung up before an answer came (Node: ECONNRESET, "socket hang up", on the error or its cause). A browser's own "Failed to fetch" does not say why and is not this. */
export function isConnectionReset(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 3; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    const message = String((x as { message?: unknown }).message ?? "");
    if (code === "ECONNRESET" || code === "UND_ERR_SOCKET" || /ECONNRESET|socket hang up/i.test(message)) return true;
  }
  return false;
}

export function createCapCaller(o: CapCallerOptions): CapCall {
  const base = o.baseUrl.replace(/\/+$/, "");
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const load = o.routes ?? loadRoutes;
  let index: Promise<Map<string, RouteRow>> | null = null;

  // Reads in flight are shared: the same read asked for again while it is out (a screen and its neighbours often ask for the same list or the same thread) is one request. A write in between ends the sharing, so a read
  // asked for after a change is never answered with one that started before it.
  const sharing = new Map<string, { p: Promise<unknown>; writes: number }>();
  let writes = 0;
  // The reads that open a chat (the thread and its last messages) go first: every other READ made through this caller (any screen) waits while one of them is out, at most HOLD_MS. Writes are never held. This caller is one signed-in session's.
  let first = 0;
  const idle: (() => void)[] = [];
  const settle = (): void => {
    if (first === 0) for (const w of idle.splice(0)) w();
  };
  const waitForFirst = (): Promise<void> =>
    first === 0
      ? Promise.resolve()
      : new Promise<void>((r) => {
          const t = setTimeout(r, HOLD_MS);
          idle.push(() => {
            clearTimeout(t);
            r();
          });
        });

  const call: CapCall = async (cap, input = {}, opts = {}) => {
    // The session token is read when the call is made, before anything is awaited: a session that ends while the route table loads must not send this call out without it.
    const token = o.token();
    index ??= load().then(indexByCap);
    const route0 = (await index).get(cap);
    const read = route0?.effects === "read" && opts.signal === undefined;
    if (route0 !== undefined && route0.effects !== "read") writes += 1;
    if (read) {
      // the key names the capability, its exact arguments and the session token it goes out with: a read asked with other arguments, or after the token changed, is never answered by this one (and each session has its own caller, so nothing is shared between people)
      const key = `${cap}\u0000${token ?? ""}\u0000${JSON.stringify(input)}`;
      const shared = sharing.get(key);
      if (shared !== undefined && shared.writes === writes) return shared.p;
      const p = (async () => {
        if (!OPENS_A_CHAT.has(cap)) await waitForFirst();
        else first += 1;
        try {
          return await send(cap, input, opts, token);
        } finally {
          if (OPENS_A_CHAT.has(cap)) {
            first -= 1;
            settle();
          }
        }
      })();
      sharing.set(key, { p, writes });
      const done = (): void => {
        if (sharing.get(key)?.p === p) sharing.delete(key);
      };
      p.then(done, done);
      return p;
    }
    return send(cap, input, opts, token);
  };
  return call;

  async function send(
    cap: string,
    input: unknown,
    opts: { idempotencyKey?: string; signal?: AbortSignal },
    token: string | null,
  ): Promise<unknown> {
    const route = (await index!).get(cap);
    if (!route)
      throw new CapError({
        code: "validation.unknown_capability",
        message: "There is no such endpoint.",
        traceId: "",
        status: 404,
        details: { cap },
      });
    const headers: Record<string, string> = { accept: "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    if (opts.idempotencyKey && route.idempotency !== "none" && route.idempotency !== "natural")
      headers["idempotency-key"] = opts.idempotencyKey;
    const get = route.method.toUpperCase() === "GET";
    if (!get) headers["content-type"] = "application/json";
    // The body is made once, so a repeat of the call carries the same key (a key minted for it is part of it).
    const payload = get ? undefined : withKey(route, input, opts.idempotencyKey);
    // only a route whose contract is idempotency "key" is repeated: the server stores the call under (person, capability, key, input) and answers the stored result to a repeat. For "none" and "natural" it never reads the key,
    // and a reset can come after the server ran the call (the connection dies on the way back), so a repeat would do it twice.
    const keyed =
      !get &&
      route.idempotency === "key" &&
      ((isObj(payload) && typeof payload["idempotencyKey"] === "string") || headers["idempotency-key"] !== undefined);
    const go = (): Promise<Response> =>
      doFetch(`${base}${route.path}${get ? queryString(input) : ""}`, {
        method: route.method.toUpperCase(),
        headers,
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    // A connection the server closed as the call went out (a reused connection reset, a socket hang-up) never reached the handler: a call that carries an idempotency key is sent once more, so a person's save does not
    // fail at random. A call without a key is never repeated (it could be done twice), and a call the caller stopped (an abort) is not either.
    let res: Response;
    try {
      res = await go();
    } catch (e) {
      if (!keyed || opts.signal?.aborted || !isConnectionReset(e)) throw e;
      res = await go();
    }
    let body: unknown = null;
    let parsed = true;
    try {
      body = await res.json();
    } catch {
      parsed = false;
      /* an empty or non-JSON answer: the status decides (below) */
    }
    // A success that is not JSON is not a Space's answer: a proxy, a captive portal or a relay page answered in its place. Said as an error, never returned as an empty success (every capability
    // answers with a JSON envelope; only a 204 says nothing). Errors keep going the way they did: the status decides.
    if (!parsed && res.status < 400 && !BODYLESS.has(res.status))
      throw new CapError({
        code: BAD_ANSWER,
        message: "This address did not answer as a Space.",
        traceId: res.headers.get("x-vyre-trace") ?? "",
        status: res.status,
        details: { contentType: res.headers.get("content-type") ?? "" },
      });
    if (res.status === 401 && token && !vaultLocked(body)) o.onUnauthenticated?.();
    if (res.status >= 400 || (isObj(body) && body["error"] !== undefined))
      throw errorOf(res.status, body, res.headers.get("x-vyre-trace"));
    return isObj(body) ? body["data"] : undefined;
  }
}
