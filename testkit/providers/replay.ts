// Recorded HTTP replay (ARCH 10.1, ARCH 10.4). connectors/*/tests call loadReplay on their
// tests folder and pass replayFetch where a connector would pass fetch into ctx.http.
// Matching is method plus URL. Query order and percent-encoding do not matter. A request
// body is matched only when the recording stored one, so an auth header never breaks a hit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Same call shape as host FetchLike, so a tape can stand in for global fetch. */
export interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: "manual";
}

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface FetchLike {
  (url: string, init?: FetchInit): Promise<FetchResponse>;
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface RecordedResponse {
  status: number;
  headers?: Record<string, string>;
  /** A string is sent as-is. An object or array is JSON. */
  body: unknown;
}

export interface RecordedExchange {
  request: RecordedRequest;
  response: RecordedResponse;
}

export interface ReplayTape {
  exchanges: RecordedExchange[];
}

export interface SeenCall {
  method: string;
  url: string;
  body?: string;
}

export interface HandlerResult {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

export interface Handler {
  method: string;
  match(url: URL): boolean;
  run(url: URL, init: FetchInit): HandlerResult;
}

export class ReplayMiss extends Error {
  readonly method: string;
  readonly url: string;
  constructor(method: string, url: string) {
    super(`no recorded response for ${method} ${url}`);
    this.name = "ReplayMiss";
    this.method = method;
    this.url = url;
  }
}

interface Stored {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Reads one JSON tape, or every top-level .json file in a directory (the connectors/*/tests layout). */
export function loadReplay(source: string | URL): ReplayTape {
  const file = source instanceof URL ? fileURLToPath(source) : source;
  const st = fs.statSync(file);
  if (st.isDirectory()) {
    const names = fs.readdirSync(file).filter((n) => n.endsWith(".json")).sort();
    const exchanges = names.flatMap((n) => loadReplay(path.join(file, n)).exchanges);
    return { exchanges };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`replay file ${file} is not json: ${why}`);
  }
  return { exchanges: exchangesOf(raw, file) };
}

/** Fetch that answers from a tape. The last exchange for a key repeats, so a read page stays available. */
export function replayFetch(tape: ReplayTape): FetchLike {
  const groups = new Map<string, Stored[]>();
  const cursor = new Map<string, number>();
  for (const ex of tape.exchanges) {
    const method = ex.request.method.toUpperCase();
    const key = requestKey(method, ex.request.url, ex.request.body);
    const list = groups.get(key) ?? [];
    const headers = { "content-type": "application/json", ...(ex.response.headers ?? {}) };
    list.push({ status: ex.response.status, headers, body: bodyText(ex.response.body) });
    groups.set(key, list);
  }
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const key = requestKey(method, url, init?.body);
    const bare = init?.body !== undefined ? requestKey(method, url) : undefined;
    const hit = take(groups, cursor, key) ?? (bare !== undefined ? take(groups, cursor, bare) : undefined);
    if (!hit) throw new ReplayMiss(method, url);
    return responseOf(hit.status, hit.headers, hit.body);
  };
}

/** Tape first, then the scripted handlers. A tape miss falls through so a recording overrides one route only. */
export function handledFetch(handlers: readonly Handler[], tape?: ReplayTape): FetchLike {
  const recorded = tape ? replayFetch(tape) : undefined;
  return async (url, init) => {
    if (recorded) {
      try {
        return await recorded(url, init);
      } catch (err) {
        if (!(err instanceof ReplayMiss)) throw err;
      }
    }
    const method = (init?.method ?? "GET").toUpperCase();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new ReplayMiss(method, url);
    }
    const hit = handlers.find((h) => h.method === method && h.match(parsed));
    if (!hit) throw new ReplayMiss(method, url);
    const out = hit.run(parsed, init ?? {});
    return jsonResponse(out.status ?? 200, out.body, out.headers);
  };
}

export function recordingFetch(inner: FetchLike, calls: SeenCall[]): FetchLike {
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const call: SeenCall = { method, url };
    if (init?.body !== undefined) call.body = init.body;
    calls.push(call);
    return inner(url, init);
  };
}

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): FetchResponse {
  const merged = { "content-type": "application/json", ...(headers ?? {}) };
  return responseOf(status, merged, bodyText(body));
}

export function hostIs(url: URL, suffix: string): boolean {
  const h = url.hostname.toLowerCase().replace(/\.$/, "");
  return h === suffix || h.endsWith(`.${suffix}`);
}

function responseOf(status: number, headers: Record<string, string>, text: string): FetchResponse {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) map.set(k.toLowerCase(), v);
  return {
    status,
    headers: { get: (n) => map.get(n.toLowerCase()) ?? null },
    text: () => Promise.resolve(text),
  };
}

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === undefined) return "";
  return JSON.stringify(body);
}

function requestKey(method: string, raw: string, body?: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return body !== undefined ? `${method} ${raw}\n${body}` : `${method} ${raw}`;
  }
  const pairs = [...u.searchParams.entries()].sort((a, b) => {
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    if (a[1] < b[1]) return -1;
    if (a[1] > b[1]) return 1;
    return 0;
  });
  const qs = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const pathOnly = `${u.origin}${u.pathname}${qs ? `?${qs}` : ""}`;
  return body !== undefined ? `${method} ${pathOnly}\n${body}` : `${method} ${pathOnly}`;
}

function take(groups: Map<string, Stored[]>, cursor: Map<string, number>, key: string): Stored | undefined {
  const list = groups.get(key);
  if (!list || list.length === 0) return undefined;
  const i = cursor.get(key) ?? 0;
  const item = list[Math.min(i, list.length - 1)];
  if (!item) return undefined;
  cursor.set(key, i + 1);
  return item;
}

function exchangesOf(raw: unknown, file: string): RecordedExchange[] {
  if (Array.isArray(raw)) return raw.map((x, i) => asExchange(x, `${file}[${i}]`));
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.exchanges)) return o.exchanges.map((x, i) => asExchange(x, `${file} exchanges[${i}]`));
    if (o.request && o.response) return [asExchange(raw, file)];
  }
  throw new Error(`replay file ${file} is not a tape`);
}

function asExchange(v: unknown, where: string): RecordedExchange {
  if (!v || typeof v !== "object") throw new Error(`${where} is not an exchange`);
  const o = v as Record<string, unknown>;
  const req = o.request;
  const res = o.response;
  if (!req || typeof req !== "object" || !res || typeof res !== "object") throw new Error(`${where} needs request and response`);
  const r = req as Record<string, unknown>;
  const s = res as Record<string, unknown>;
  if (typeof r.url !== "string") throw new Error(`${where} request.url must be a string`);
  if (typeof s.status !== "number") throw new Error(`${where} response.status must be a number`);
  const request: RecordedRequest = { method: typeof r.method === "string" ? r.method : "GET", url: r.url };
  if (isStringRecord(r.headers)) request.headers = r.headers;
  if (typeof r.body === "string") request.body = r.body;
  const response: RecordedResponse = { status: s.status, body: s.body ?? "" };
  if (isStringRecord(s.headers)) response.headers = s.headers;
  return { request, response };
}

function isStringRecord(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every((x) => typeof x === "string");
}
