// Test support for the tool tests: the generated catalog, a fake invoke that models the Gate, and a session factory. No assertions here.
import { readFileSync } from "node:fs";
import { buildCatalog, parseDefaultTools } from "./catalog.ts";
import { createToolSession } from "./call.ts";
import type { CallDeps, ToolSession } from "./call.ts";
import type { LocalDecision } from "./local.ts";
import type { Invoke } from "../../../host/src/invoke.ts";
import type { AgentToolRow, Catalog, Level, McpToolRow, RegistryCapRow, ThreadFacts, ToolCtx } from "./types.ts";

const read = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), "utf8");

export interface Loaded { catalog: Catalog; caps: Map<string, RegistryCapRow>; defaults: Set<string> }
let cached: Loaded | null = null;

/** The real generated catalog and frozen default list. */
export function loadGenerated(): Loaded {
  if (cached) return cached;
  const reg = JSON.parse(read("generated/registry.json")) as { capabilities: RegistryCapRow[]; agentTools: AgentToolRow[] };
  const tools = (JSON.parse(read("generated/mcp-tools.json")) as { tools: McpToolRow[] }).tools;
  cached = {
    catalog: buildCatalog(reg.capabilities, tools, reg.agentTools),
    caps: new Map(reg.capabilities.map((c) => [c.name, c] as const)),
    defaults: parseDefaultTools(read("docs/frozen/agent-tools.md")),
  };
  return cached;
}

export interface InvokeRecord { cap: string; principal: string; actingFor: string | undefined; approval: string | undefined; preAuth: boolean | undefined }

/** Models what the pipeline does with a Gate: an agent's call to a capability that has a real Gate rule is held until an approval token arrives. */
export function fakeInvoke(caps: ReadonlyMap<string, RegistryCapRow>): { invoke: Invoke; calls: InvokeRecord[] } {
  const calls: InvokeRecord[] = [];
  let n = 0;
  const invoke: Invoke = async (cap, _input, seed) => {
    calls.push({ cap, principal: seed.principal.id, actingFor: seed.actingFor, approval: seed.approval, preAuth: seed.preAuth });
    const row = caps.get(cap);
    const gate = row?.gate as { act?: string } | undefined;
    const traceId = seed.trace?.traceId ?? "trace";
    if (gate && gate.act !== "none" && seed.principal.kind === "agent" && seed.approval === undefined) return { status: "held", taskId: `task_${++n}`, traceId };
    return { status: "ok", output: { cap }, traceId };
  };
  return { invoke, calls };
}

export function thread(over: Partial<ThreadFacts> = {}): ThreadFacts {
  return { threadId: "T1", kind: "chat", planMode: false, ...over };
}

export function ctx(over: Partial<ToolCtx> = {}): ToolCtx {
  return { space: "spc_1", agentId: "agt_intake", asker: "per_dana", thread: thread(), ...over };
}

export function makeSession(o: { levels?: Record<string, Level>; localPolicy?: (...a: Parameters<NonNullable<CallDeps["localPolicy"]>>) => LocalDecision; prompt?: CallDeps["prompt"]; engineer?: boolean } = {}): {
  session: ToolSession; calls: InvokeRecord[]; loaded: Loaded;
} {
  const loaded = loadGenerated();
  const { invoke, calls } = fakeInvoke(loaded.caps);
  const deps: CallDeps = {
    catalog: loaded.catalog, defaults: loaded.defaults, invoke,
    levelFor: (asker, scope) => o.levels?.[`${asker}:${scope.type}:${scope.id}`] ?? null,
    canEngineer: () => o.engineer === true,
    traceId: () => "trace_fixed",
  };
  if (o.localPolicy) deps.localPolicy = o.localPolicy;
  if (o.prompt) deps.prompt = o.prompt;
  return { session: createToolSession(deps), calls, loaded };
}
