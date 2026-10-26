// The gateway (ARCH 4.4, flow 137): verify the session, load the route record, shape the input, call invoke, shape the answer.
// Transport-agnostic: it takes a parsed request and returns a status, headers and a { data } or { error } body, so the HTTP server, the tests and the MCP bridge share it.
import type { CapabilityDef, TraceContext, VyreError } from "../../packages/contracts/src/types.ts";
import { HostError, type CapIndex, type CtxSeed, type Invoke, type PrincipalSeed } from "./invoke.ts";
import { makeError, httpOf } from "./routes/errors.ts";
import { indexRoutes, type RouteRec } from "./routes/table.ts";

export { indexRoutes } from "./routes/table.ts";
export type { RouteRec } from "./routes/table.ts";

export interface GatewayReq {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  query?: Readonly<Record<string, string>> | undefined;
  /** parsed JSON body */
  body?: unknown;
}
export interface GatewayRes {
  status: number;
  headers: Record<string, string>;
  body: { data: unknown } | { error: VyreError };
}
export interface SessionInfo {
  space: string; principal: PrincipalSeed; actingFor?: string | undefined; device?: string | undefined; provider?: string | undefined;
  run?: string | undefined; thread?: string | undefined; origin?: string | undefined;
}
export interface GatewayDeps {
  invoke: Invoke;
  caps: CapIndex;
  routes: readonly RouteRec[];
  /** verify the session token and resolve who acts and for whom; null = not signed in */
  session(headers: GatewayReq["headers"]): SessionInfo | null | Promise<SessionInfo | null>;
  /** callers before sign-in (`caller: 'anonymous'`) or invited but not yet members (`'pending'`): a principal id for rate limits and audit, or null to refuse */
  preAuth?(caller: "anonymous" | "pending", headers: GatewayReq["headers"], req: GatewayReq): SessionInfo | null | Promise<SessionInfo | null>;
}

const TRACE = /^([0-9a-f]{32})-([0-9a-f]{16})(?:-([0-9a-f]{16}))?$/;
/** `x-vyre-trace: <traceId>-<spanId>[-<parentSpanId>]` (ARCH 4.9). The caller's span becomes the parent of ours. */
export function parseTrace(h: string | undefined): TraceContext | undefined {
  const m = h ? TRACE.exec(h) : null;
  return m ? { traceId: m[1]!, spanId: m[2]! } : undefined;
}

const errRes = (error: VyreError, status = httpOf(error.code)): GatewayRes => {
  const headers: Record<string, string> = { "x-vyre-trace": error.traceId };
  const per = error.details?.["perSeconds"];
  if (error.code === "rate_limit.exceeded") headers["retry-after"] = String(typeof per === "number" ? Math.max(1, Math.ceil(per)) : 1);
  return { status, headers, body: { error } };
};

export function createGateway(deps: GatewayDeps): (req: GatewayReq) => Promise<GatewayRes> {
  const match = indexRoutes(deps.routes);
  const hex = (n: number): string => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

  return async function handle(req) {
    const incoming = parseTrace(req.headers["x-vyre-trace"]);
    const traceId = incoming?.traceId ?? hex(16);
    try {
      const route = match(req.method, req.path);
      if (!route) return errRes(makeError("validation.unknown_capability", traceId, { message: "There is no such endpoint.", details: { method: req.method, path: req.path } }), 404);
      const cap: CapabilityDef | undefined = deps.caps.get(route.cap, route.v);
      if (!cap) return errRes(makeError("validation.unknown_capability", traceId, { details: { cap: route.cap, v: route.v } }), 404);

      const caller = cap.caller ?? "principal";
      const session = caller === "principal" ? await deps.session(req.headers) : ((await deps.preAuth?.(caller, req.headers, req)) ?? null);
      if (!session) return errRes(makeError("auth.unauthenticated", traceId));

      let input: unknown = req.method.toUpperCase() === "GET" ? { ...(req.query ?? {}) } : (req.body ?? {});
      const idemHeader = req.headers["idempotency-key"];
      if (idemHeader && cap.idempotency === "key" && input !== null && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>)["idempotencyKey"] === undefined) {
        input = { ...(input as Record<string, unknown>), idempotencyKey: idemHeader };
      }
      const seed: CtxSeed = {
        space: session.space, principal: session.principal, actingFor: session.actingFor, device: session.device, provider: session.provider,
        run: session.run, thread: session.thread, origin: session.origin === "mcp" ? "mcp" : "user", v: route.v, preAuth: caller !== "principal",
        ...(incoming ? { trace: incoming } : {}),
      };
      const r = await deps.invoke(route.cap, input, seed);
      const headers = { "x-vyre-trace": r.traceId };
      if (r.status === "held") return { status: 202, headers, body: { data: { status: "held", taskId: r.taskId, ...(r.runId ? { runId: r.runId } : {}) } } };
      return { status: 200, headers, body: { data: r.output } };
    } catch (e) {
      if (e instanceof HostError) return errRes(e.error, e.http);
      return errRes(makeError("internal.unexpected", traceId, { message: "Something went wrong on our side.", details: { traceId } }), 500);
    }
  };
}
