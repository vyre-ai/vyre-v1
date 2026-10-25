// Calling the running daemon from the CLI: where it is, who we are, one capability call over HTTP with a trace id, and how an error is shown.
import fs from "node:fs";
import path from "node:path";
import { routes } from "../../../generated/routes.ts";
import type { VyreError } from "../../../packages/contracts/src/types.ts";
import { dataHome, pathsFor, readInfo } from "../daemon/config.ts";
import { EXIT, errLine } from "./io.ts";
import type { CliIo, FetchResponse } from "./io.ts";

export interface Target { url: string; token: string; dataDir: string }
export type CallResult =
  | { ok: true; data: unknown; traceId: string }
  | { ok: false; status: number; error: VyreError | { code: string; message: string }; traceId: string };

const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

/** --server and --token, else VYRE_SERVER and VYRE_TOKEN, else the local daemon's own files (vyred.json and admin.token in the data directory). */
export function resolveTarget(io: CliIo, flags: ReadonlyMap<string, string | true>): Target | null {
  const dataDir = path.resolve(typeof flags.get("data-dir") === "string" ? (flags.get("data-dir") as string) : dataHome(io.env));
  const paths = pathsFor(dataDir);
  const server = (flags.get("server") as string | undefined) ?? io.env["VYRE_SERVER"] ?? readInfo(paths)?.url;
  let token = (flags.get("token") as string | undefined) ?? io.env["VYRE_TOKEN"] ?? io.env["VYRE_ADMIN_TOKEN"];
  if (!token) { try { token = fs.readFileSync(paths.adminToken, "utf8").trim(); } catch { token = undefined; } }
  return server && token ? { url: server.replace(/\/$/, ""), token, dataDir } : null;
}

export class NotRunning extends Error {}

export async function callCap(io: CliIo, t: Target, cap: string, input: Record<string, unknown>, v = 1): Promise<CallResult> {
  const route = routes.find((r) => r.cap === cap && r.v === v);
  if (!route) return { ok: false, status: 404, error: { code: "validation.unknown_capability", message: `${cap} has no HTTP route` }, traceId: "" };
  const traceId = hex(16);
  const headers: Record<string, string> = { authorization: `Bearer ${t.token}`, "x-vyre-trace": `${traceId}-${hex(8)}`, accept: "application/json" };
  let url = `${t.url}${route.path}`;
  const init: { method: string; headers: Record<string, string>; body?: string } = { method: route.method, headers };
  if (route.method === "GET") {
    const q = new URLSearchParams();
    for (const [k, val] of Object.entries(input)) q.set(k, typeof val === "string" ? val : JSON.stringify(val));
    if ([...q].length) url += `?${q.toString()}`;
  } else {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(input);
  }
  let res: FetchResponse;
  try { res = await io.fetch(url, init); }
  catch (e) { throw new NotRunning(`could not reach ${t.url}: ${e instanceof Error ? e.message : String(e)}`); }
  const text = await res.text();
  let body: unknown;
  try { body = text ? (JSON.parse(text) as unknown) : null; } catch { body = null; }
  const tr = res.headers.get("x-vyre-trace") ?? traceId;
  const b = body as { data?: unknown; error?: VyreError } | null;
  if (res.ok && b && "data" in b) return { ok: true, data: b.data, traceId: tr };
  return { ok: false, status: res.status, error: b?.error ?? { code: "internal.unexpected", message: `the server answered ${res.status}` }, traceId: tr };
}

/** The error, its next steps and its trace id on stderr. Returns the exit code. */
export function showError(io: CliIo, r: Extract<CallResult, { ok: false }>): number {
  errLine(io, `${r.error.code}: ${r.error.message}`);
  const next = "next" in r.error ? r.error.next : [];
  if (next.length) errLine(io, `Next: ${next.map((n) => n.label).join(" / ")}`);
  if (r.traceId) errLine(io, `Trace: ${r.traceId}`);
  if (r.status === 401) errLine(io, "Check the token: --token, VYRE_TOKEN, or admin.token in the data directory.");
  return EXIT.FAILED;
}

export const notRunningHint = "Start it with: vyre server start";
