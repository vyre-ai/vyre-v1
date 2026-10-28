// The host half of the Run executor (P-L6_24; ruling 31). The runs module drives a Run but can see neither the Automation that owns it nor the steps it holds; the host can ask both through
// their host calls, so it builds what `drive` needs and hands it over through setRunsHost:
//   plan  the Automation's pinned definition (automations.run_plan), start node first, each node a PlanStep with the effects of its step kind
//   exec  one step at a time through steps-core (steps-core.run_step), called AS the Run's principal: a person's Automation acts with that person's access, a Space Automation with its own
// The definition's own error rule is applied here through failureResult. Retry throws so the engine runs the step again with a backoff. Continue records the error and goes on.
// Skip records a skipped step and goes on. Substitute goes on with the configured output. Neither runs the effect again. Route goes to the named step when it exists,
// and only for a listed error code when codes is set. Stop, a missing route, and a code that is not listed fail the run.
// Parallel and Loop are coordinators. Each lane and each iteration is its own child Run. Inner nodes are not on the parent plan.
import { registry } from "../../../generated/registry.ts";
import { clampRetry, failureResult } from "../../../lib/step-failure.ts";
import type { StepOnError } from "../../../lib/step-failure.ts";
import { codeForReason } from "../routes/errors.ts";

type Row = Record<string, unknown>;
interface Branch { label?: string; to?: string }
interface GNode {
  id: string; key: string; input: Record<string, unknown>; next?: string[]; branches?: Branch[];
  onError?: StepOnError;
}
interface Scope {
  containerNodeId: string; laneId?: string; iterationIndex?: number; iterationKey?: string; item?: unknown; held?: boolean;
}
interface PlanLink { principal: { kind: "person" | "agent" | "service"; id: string }; payload?: unknown; automationId: string; scope?: Scope; depth?: number }
interface Plan { link: PlanLink; definition: { nodes: GNode[]; start?: string[] } }
interface PlanStep {
  id: string; key?: string; input?: unknown; next?: string | null;
  retry?: { max: number; backoff: "none" | "linear" | "exp"; baseMs: number };
  effects?: "read" | "write" | "outward"; sample?: unknown;
}
interface ChildReport {
  id: string; runId?: string; status: string; error?: string; laneId?: string; iterationKey?: string; iterationIndex?: number; held?: boolean;
}
interface LoopIteration { iterationKey: string; iterationIndex: number; item: unknown }
interface StepResult { output?: unknown; next?: string | null; wait?: unknown; prepare?: { iterations: LoopIteration[] } }
type Call = Row & { attempt: number; prepare?: boolean; children?: ChildReport[]; item?: unknown; index?: number };

export type HostCall = (name: string, input: unknown, as?: { principal: { kind: "person" | "agent" | "service"; id: string } }) => Promise<unknown>;

const STEPS = new Map((registry.steps as unknown as { key: string; effects: "read" | "write" | "outward"; sample?: unknown }[]).map((s) => [s.key, s] as const));

/** How many Runs one server drives at once; the rest wait their turn. */
export const MAX_DRIVES = 8;
const DENIED = new Set(["not_a_member", "suspended", "revoked"]);
const TERMINAL = new Set(["succeeded", "failed", "stopped"]);

/**
 * A step that ran as a person who is no longer let in (removed, suspended, revoked) fails the Run with the error the gateway gives for the same case (codeForReason), and the reason
 * rides in the details, so the Run's owner and the Space see why. Everything that reads Run errors understands catalogued codes only.
 */
function refusal(e: unknown): unknown {
  const err = (e as { error?: { code?: string; details?: { reason?: string } } } | null)?.error;
  const reason = err?.details?.reason;
  if (reason === undefined || !DENIED.has(reason)) return e;
  const why: Record<string, string> = {
    not_a_member: "The person this run acts as is no longer a member of this Space, so the run stopped.",
    suspended: "The person this run acts as is suspended, so the run stopped.",
    revoked: "The person this run acts as has lost access, so the run stopped.",
  };
  return { error: { code: codeForReason(reason), message: why[reason], retryable: false, details: { reason } } };
}

function hostError(code: string, message: string): never {
  const e = new Error(message) as Error & { error: { code: string; message: string; retryable: boolean } };
  e.error = { code, message, retryable: false };
  throw e;
}

function lanesOf(n: GNode): { id: string; entry: string }[] {
  if (n.branches && n.branches.length > 0) {
    return n.branches.map((b, i) => ({ id: (b.label && b.label.trim()) || b.to || `lane_${i + 1}`, entry: b.to ?? "" }));
  }
  const raw = n.input?.["branches"];
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return raw.map((entry) => ({ id: entry, entry }));
  return [];
}

function successorIds(n: GNode): string[] {
  if (n.key === "loop") return n.next ?? [];
  const branched = lanesOf(n).map((l) => l.entry);
  if (n.branches && n.branches.length > 0) return branched;
  if (n.key === "parallel" && branched.length > 0) return branched;
  return n.next ?? [];
}

function reach(by: Map<string, GNode>, from: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (!id || seen.has(id)) return;
    const n = by.get(id);
    if (!n) return;
    seen.add(id);
    out.push(id);
    if (n.key === "loop") {
      const body = lanesOf(n)[0]?.entry;
      if (body) walk(body);
    }
    for (const s of successorIds(n)) walk(s);
  };
  walk(from);
  return out;
}

/** The first node every lane reaches. The same rule as the canvas join. */
function joinOf(by: Map<string, GNode>, n: GNode): string | null {
  const heads = lanesOf(n).map((l) => l.entry).filter((id) => id.length > 0);
  if (heads.length < 2) return null;
  const sets = heads.map((h) => new Set(reach(by, h)));
  for (const id of reach(by, heads[0]!)) if (sets.every((s) => s.has(id))) return id;
  return null;
}

function walkUntil(by: Map<string, GNode>, from: string, stop: Set<string>): GNode[] {
  const out: GNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (!id || seen.has(id) || stop.has(id)) return;
    const n = by.get(id);
    if (!n) return;
    seen.add(id);
    out.push(n);
    if (n.key === "parallel") {
      const j = joinOf(by, n);
      if (j) walk(j);
      else for (const s of n.next ?? []) walk(s);
      return;
    }
    if (n.key === "loop") {
      for (const s of n.next ?? []) walk(s);
      return;
    }
    if ((n.key === "if" || n.key === "paths") && lanesOf(n).some((l) => l.entry)) {
      for (const l of lanesOf(n)) walk(l.entry);
      for (const s of n.next ?? []) walk(s);
      return;
    }
    for (const s of successorIds(n)) walk(s);
  };
  walk(from);
  return out;
}

function contained(by: Map<string, GNode>, nodes: GNode[]): Set<string> {
  const inner = new Set<string>();
  const take = (id: string, stop: Set<string>): void => {
    const seen = new Set<string>();
    const walk = (cur: string): void => {
      if (!cur || seen.has(cur) || stop.has(cur)) return;
      const n = by.get(cur);
      if (!n) return;
      seen.add(cur);
      inner.add(cur);
      if (n.key === "loop") {
        const body = lanesOf(n)[0]?.entry;
        if (body) walk(body);
      }
      for (const s of successorIds(n)) walk(s);
    };
    walk(id);
  };
  for (const n of nodes) {
    if (n.key === "parallel") {
      const stop = new Set<string>([n.id]);
      const j = joinOf(by, n);
      if (j) stop.add(j);
      for (const l of lanesOf(n)) if (l.entry) take(l.entry, stop);
    } else if (n.key === "loop") {
      const entry = lanesOf(n)[0]?.entry;
      if (!entry) continue;
      take(entry, new Set<string>([n.id, ...(n.next ?? [])]));
    }
  }
  return inner;
}

function stepNext(by: Map<string, GNode>, n: GNode): string | null | undefined {
  if (n.key === "parallel") return joinOf(by, n) ?? n.next?.[0] ?? null;
  if (n.key === "loop") return n.next?.[0] ?? null;
  if (n.next && n.next.length > 0) return n.next[0];
  return undefined;
}

/** A next that is not on this plan ends the Run. A child plan stops before the join, so its last step must not walk onto the parent. */
function clippedNext(by: Map<string, GNode>, n: GNode, ids: Set<string>): string | null | undefined {
  const next = stepNext(by, n);
  if (next === undefined) return undefined;
  if (next === null || ids.has(next)) return next;
  return null;
}

/** A nested coordinator keeps the loop item the body steps read. The inner key and index stay the ones just above. */
function carryItem(scope: Scope | undefined): Partial<Scope> {
  if (!scope || (scope.item === undefined && scope.iterationKey === undefined)) return {};
  return { item: scope.item, ...(scope.iterationIndex !== undefined ? { iterationIndex: scope.iterationIndex } : {}), ...(scope.iterationKey !== undefined ? { iterationKey: scope.iterationKey } : {}) };
}

function concurrencyOf(input: Record<string, unknown>): number {
  const n = typeof input["concurrency"] === "number" ? input["concurrency"] : 1;
  return Math.max(1, Math.min(n, 20));
}

function childSlice(by: Map<string, GNode>, scope: Scope): GNode[] {
  const container = by.get(scope.containerNodeId);
  if (!container) return [];
  if (container.key === "loop") {
    const entry = lanesOf(container)[0]?.entry ?? "";
    if (!entry) return [];
    return walkUntil(by, entry, new Set([container.id, ...(container.next ?? [])]));
  }
  const lane = lanesOf(container).find((l) => l.id === scope.laneId);
  if (!lane?.entry) return [];
  const stop = new Set<string>([container.id]);
  const join = joinOf(by, container);
  if (join) stop.add(join);
  return walkUntil(by, lane.entry, stop);
}

export function createRunsHost(d: { call: HostCall; max?: number; log?: (msg: string, attrs: Record<string, unknown>) => void }) {
  const max = d.max ?? MAX_DRIVES;
  const waiting: string[] = [];
  const known = new Set<string>();      // queued or being driven
  const again = new Set<string>();      // asked for again while being driven: driven once more when this one ends
  const inflight = new Set<Promise<void>>();
  let active = 0;
  const pump = (): void => {
    while (active < max && waiting.length > 0) {
      const id = waiting.shift()!;
      active += 1;
      const p: Promise<void> = d.call("runs.drive_run", { runId: id })
        .then(() => undefined, (e: unknown) => d.log?.("runs.drive_failed", { runId: id, error: e instanceof Error ? e.message : String((e as { error?: { message?: string } })?.error?.message ?? e) }))
        .then(() => {
          active -= 1; inflight.delete(p); known.delete(id);
          if (again.delete(id)) enqueue(id); else pump();
        });
      inflight.add(p);
    }
  };
  function enqueue(runId: string): void {
    if (known.has(runId)) { again.add(runId); return; }
    known.add(runId); waiting.push(runId); pump();
  }

  async function reportsOf(parentId: string, containerId: string): Promise<ChildReport[]> {
    const links = (await d.call("automations.child_links", { parentRunId: parentId, containerNodeId: containerId })) as { runId: string; scope: Scope | null }[];
    const out: ChildReport[] = [];
    for (const l of Array.isArray(links) ? links : []) {
      const got = (await d.call("runs.get", { runId: l.runId })) as { run?: { status?: string; summary?: string } };
      const status = got?.run?.status ?? "queued";
      const sc = l.scope ?? { containerNodeId: containerId };
      out.push({
        id: sc.laneId ?? sc.iterationKey ?? l.runId, runId: l.runId, status,
        ...(status === "failed" ? { error: got?.run?.summary ?? "it did not finish" } : {}),
        laneId: sc.laneId, iterationKey: sc.iterationKey, iterationIndex: sc.iterationIndex, held: sc.held === true,
      });
    }
    return out;
  }

  async function spawn(parentId: string, key: string, scope: Scope, hold: boolean): Promise<void> {
    const made = (await d.call("automations.spawn_child", { parentRunId: parentId, key, scope, hold })) as { runId?: string } | null;
    if (made?.runId && !hold) enqueue(made.runId);
  }

  async function stopRun(runId: string, reason: string): Promise<void> {
    try { await d.call("runs.stop", { runId, reason }); } catch { /* already finished */ }
  }

  function toPlan(by: Map<string, GNode>, ordered: GNode[]): PlanStep[] {
    const ids = new Set(ordered.map((n) => n.id));
    return ordered.map((n) => {
      const kind = STEPS.get(n.key);
      const requested = n.onError?.max;
      const retry = n.onError?.mode === "retry"
        ? { max: clampRetry(typeof requested === "number" && Number.isFinite(requested) ? requested : 3), backoff: "exp" as const, baseMs: 1000 }
        : undefined;
      const next = clippedNext(by, n, ids);
      return {
        id: n.id, key: n.key, input: n.input, effects: kind?.effects ?? "write",
        ...(next !== undefined ? { next } : {}),
        ...(kind?.sample !== undefined ? { sample: kind.sample } : {}),
        ...(retry ? { retry } : {}),
      };
    });
  }

  async function resolve(run: { id: string }): Promise<{ plan: PlanStep[]; exec: (step: PlanStep, call: never) => Promise<StepResult> } | undefined> {
    const p = (await d.call("automations.run_plan", { runId: run.id })) as Plan | null;
    if (!p || p.definition.nodes.length === 0) return undefined;
    const nodes = p.definition.nodes;
    const by = new Map(nodes.map((n) => [n.id, n] as const));
    const scope = p.link.scope;
    const ordered = scope?.containerNodeId
      ? childSlice(by, scope)
      : (() => {
          const inner = contained(by, nodes);
          const first = by.get(p.definition.start?.[0] ?? "") ?? nodes.find((n) => !inner.has(n.id)) ?? nodes[0];
          if (!first || inner.has(first.id)) return nodes.filter((n) => !inner.has(n.id));
          return [first, ...nodes.filter((n) => n !== first && !inner.has(n.id))];
        })();
    const plan = toPlan(by, ordered);
    const planIds = new Set(ordered.map((n) => n.id));
    const callStep = async (node: GNode, call: Call, extra: Partial<Call>): Promise<StepResult> => {
      const withItem: Call = {
        ...call, ...extra, trigger: p.link.payload, vars: {},
        ...(scope?.item !== undefined || scope?.iterationKey !== undefined ? { item: scope.item, index: scope.iterationIndex } : {}),
      };
      return (await d.call("steps-core.run_step", {
        node, call: withItem, run: { id: run.id, automation: p.link.automationId, ...(typeof p.link.depth === "number" ? { depth: p.link.depth } : {}) },
      }, { principal: p.link.principal })) as StepResult;
    };
    const finish = (node: GNode, r: StepResult): StepResult => {
      const rest: StepResult = { output: r.output, next: r.next, wait: r.wait };
      if (rest.wait) return rest;
      const chosen = rest.next !== undefined ? rest.next : clippedNext(by, node, planIds);
      if (chosen === undefined) return rest;
      if (chosen !== null && !planIds.has(chosen)) return { ...rest, next: null };
      return { ...rest, next: chosen };
    };
    const runParallel = async (node: GNode, call: Call): Promise<StepResult> => {
      const lanes = lanesOf(node);
      let kids = await reportsOf(run.id, node.id);
      const have = new Set(kids.map((k) => k.laneId));
      for (const lane of lanes) {
        if (!lane.entry || have.has(lane.id)) continue;
        await spawn(run.id, `child:${run.id}:${node.id}:lane:${lane.id}`, { ...carryItem(scope), containerNodeId: node.id, laneId: lane.id }, false);
      }
      kids = await reportsOf(run.id, node.id);
      for (const lane of lanes) if (!lane.entry) kids.push({ id: lane.id, status: "succeeded", laneId: lane.id });
      if (node.input["waitFor"] === "any" && kids.some((k) => k.status === "succeeded")) {
        for (const k of kids) {
          if (k.runId && !TERMINAL.has(k.status)) await stopRun(k.runId, "Another lane finished first. Steps that already ran are not undone.");
        }
        kids = await reportsOf(run.id, node.id);
        for (const lane of lanes) if (!lane.entry && !kids.some((k) => k.laneId === lane.id)) kids.push({ id: lane.id, status: "succeeded", laneId: lane.id });
      }
      return finish(node, await callStep(node, call, { children: kids }));
    };
    const releaseLoop = async (node: GNode, kids: ChildReport[]): Promise<ChildReport[]> => {
      const cap = concurrencyOf(node.input);
      const inflight = kids.filter((k) => k.status === "queued" || k.status === "running" || (k.status === "waiting" && k.held !== true));
      if (kids.some((k) => k.status === "failed")) {
        for (const k of kids) if (k.held && k.runId && !TERMINAL.has(k.status)) await stopRun(k.runId, "A loop iteration failed. Steps that already ran are not undone.");
      } else {
        let room = cap - inflight.length;
        const links = (await d.call("automations.child_links", { parentRunId: run.id, containerNodeId: node.id })) as { runId: string; scope: Scope | null }[];
        const scopes = new Map((Array.isArray(links) ? links : []).map((l) => [l.runId, l.scope] as const));
        const held = kids.filter((k) => k.held && k.runId && (k.status === "waiting" || k.status === "queued")).slice().sort((a, b) => (a.iterationIndex ?? 0) - (b.iterationIndex ?? 0));
        for (const k of held) {
          if (room <= 0 || !k.runId) break;
          const prev = scopes.get(k.runId) ?? { containerNodeId: node.id, iterationKey: k.iterationKey, iterationIndex: k.iterationIndex };
          await d.call("automations.patch_scope", { runId: k.runId, scope: { ...prev, held: false } });
          if (k.status === "waiting") {
            try { await d.call("runs.resume", { runId: k.runId, reason: "background" }); } catch { /* not waiting */ }
          }
          enqueue(k.runId);
          room -= 1;
        }
      }
      return reportsOf(run.id, node.id);
    };
    const runLoop = async (node: GNode, call: Call): Promise<StepResult> => {
      const entry = lanesOf(node)[0]?.entry ?? "";
      const slice = entry ? walkUntil(by, entry, new Set([node.id, ...(node.next ?? [])])) : [];
      if (slice.some((n) => n.key === "loop")) hostError("run.nested_loop", "A loop cannot contain another loop.");
      let kids = await reportsOf(run.id, node.id);
      if (kids.length === 0) {
        const prep = await callStep(node, call, { prepare: true });
        if (!prep.prepare) return finish(node, prep);
        const cap = concurrencyOf(node.input);
        for (const it of prep.prepare.iterations) {
          const hold = it.iterationIndex >= cap;
          await spawn(run.id, `child:${run.id}:${node.id}:iter:${it.iterationKey}`, {
            ...carryItem(scope), containerNodeId: node.id, iterationIndex: it.iterationIndex, iterationKey: it.iterationKey, item: it.item, ...(hold ? { held: true } : {}),
          }, hold);
        }
        kids = await reportsOf(run.id, node.id);
      } else kids = await releaseLoop(node, kids);
      return finish(node, await callStep(node, call, { children: kids }));
    };
    const exec = async (step: PlanStep, call: never): Promise<StepResult> => {
      const node = by.get(step.id.replace(/#\d+$/, ""));
      if (!node) throw new Error(`The plan has no step ${step.id}.`);
      const c = call as unknown as Call;
      try {
        if (node.key === "parallel") return runParallel(node, c);
        if (node.key === "loop") return runLoop(node, c);
        const r = await callStep(node, c, {});
        return finish(node, r);
      } catch (raw) {
        const e = refusal(raw);
        if (e !== raw) throw e;   // a person who is no longer let in fails the Run whatever the step's own error rule says
        const decided = failureResult(node.onError, e);
        if (decided === "throw" || decided === "retry") throw e;
        if (decided.next !== undefined && !by.has(decided.next)) throw e;
        return decided;
      }
    };
    return { plan, exec };
  }

  return {
    enqueue,
    /** The Runs the last server left queued or running are driven again. A parent parked on children that already finished is resumed once. */
    async recover(): Promise<number> {
      const ids = (await d.call("runs.interrupted", {})) as string[];
      for (const id of ids) enqueue(id);
      const index = await d.call("automations.child_index", {});
      if (!Array.isArray(index)) return ids.length;
      const byParent = new Map<string, { runId: string }[]>();
      for (const row of index as { runId?: string; parentRun?: string }[]) {
        if (!row?.parentRun || !row.runId) continue;
        const list = byParent.get(row.parentRun) ?? [];
        list.push({ runId: row.runId });
        byParent.set(row.parentRun, list);
      }
      for (const [parentId, kids] of byParent) {
        const got = (await d.call("runs.get", { runId: parentId })) as { run?: { status?: string } };
        if (got?.run?.status !== "waiting") continue;
        const page = (await d.call("runs.steps", { runId: parentId, limit: 500 })) as { steps?: { step?: string; state?: string }[] };
        const waitingStep = [...(page?.steps ?? [])].reverse().find((s) => s.state === "waiting");
        if (!waitingStep?.step) continue;
        const resolved = await resolve({ id: parentId });
        const base = waitingStep.step.replace(/#\d+$/, "");
        const step = resolved?.plan.find((p) => p.id === waitingStep.step || p.id === base);
        if (!step || (step.key !== "parallel" && step.key !== "loop")) continue;
        let terminal = false;
        for (const k of kids) {
          const g = (await d.call("runs.get", { runId: k.runId })) as { run?: { status?: string } };
          if (g?.run?.status && TERMINAL.has(g.run.status)) terminal = true;
        }
        if (!terminal) continue;
        try { await d.call("runs.resume", { runId: parentId, reason: "background" }); } catch { continue; }
        enqueue(parentId);
      }
      return ids.length;
    },
    /** Shutdown: wait for the drives in flight, but not for ever (a step log makes a half-done Run recoverable). */
    async settle(ms: number): Promise<void> {
      await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, ms))]);
    },
    resolve,
  };
}
