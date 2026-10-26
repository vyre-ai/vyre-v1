// The host half of the Run executor (P-L6_24; ruling 31). The runs module drives a Run but can see neither the Automation that owns it nor the steps it holds; the host can ask both through
// their host calls, so it builds what `drive` needs and hands it over through setRunsHost:
//   plan  the Automation's pinned definition (automations.run_plan), start node first, each node a PlanStep with the effects of its step kind
//   exec  one step at a time through steps-core (steps-core.run_step), called AS the Run's principal: a person's Automation acts with that person's access, a Space Automation with its own
// The definition's own error rule is applied here: retry runs the step again with a backoff, continue goes on with the error as the step's output, route goes to the named step.
import { registry } from "../../../generated/registry.ts";

type Row = Record<string, unknown>;
interface Node { id: string; key: string; input: Record<string, unknown>; next?: string[]; branches?: unknown[]; onError?: { mode: "fail" | "continue" | "retry" | "route"; max?: number; route?: string } }
interface Plan { link: { principal: { kind: "person" | "agent" | "service"; id: string }; payload?: unknown; automationId: string }; definition: { nodes: Node[]; start?: string[] } }
interface PlanStep { id: string; input?: unknown; retry?: { max: number; backoff: "none" | "linear" | "exp"; baseMs: number }; effects?: "read" | "write" | "outward"; sample?: unknown }
interface StepResult { output?: unknown; next?: string | null; wait?: unknown }
type Call = Row & { attempt: number };

export type HostCall = (name: string, input: unknown, as?: { principal: { kind: "person" | "agent" | "service"; id: string } }) => Promise<unknown>;

const STEPS = new Map((registry.steps as unknown as { key: string; effects: "read" | "write" | "outward"; sample?: unknown }[]).map((s) => [s.key, s] as const));

/** How many Runs one server drives at once; the rest wait their turn. */
export const MAX_DRIVES = 8;
const DENIED = new Set(["not_a_member", "suspended", "revoked"]);

/** A step that ran as a person who is no longer let in (removed, suspended) fails the Run by name, so the Run's owner and the Space see why instead of a bare "unauthenticated". */
function refusal(e: unknown): unknown {
  const err = (e as { error?: { code?: string; details?: { reason?: string } } } | null)?.error;
  const reason = err?.details?.reason;
  if (reason === undefined || !DENIED.has(reason)) return e;
  const code = reason === "suspended" ? "permission.suspended" : "permission.not_a_member";
  return { error: { code, message: reason === "suspended" ? "The person this run acts as is suspended, so the run stopped." : "The person this run acts as is no longer a member of this Space, so the run stopped.", retryable: false } };
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
  return {
    enqueue,
    /** The Runs the last server left queued or running are driven again. */
    async recover(): Promise<number> {
      const ids = (await d.call("runs.interrupted", {})) as string[];
      for (const id of ids) enqueue(id);
      return ids.length;
    },
    /** Shutdown: wait for the drives in flight, but not for ever (a step log makes a half-done Run recoverable). */
    async settle(ms: number): Promise<void> {
      await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, ms))]);
    },
    async resolve(run: { id: string }): Promise<{ plan: PlanStep[]; exec: (step: PlanStep, call: never) => Promise<StepResult> } | undefined> {
      const p = (await d.call("automations.run_plan", { runId: run.id })) as Plan | null;
      if (!p || p.definition.nodes.length === 0) return undefined;
      const nodes = p.definition.nodes;
      const byId = new Map(nodes.map((n) => [n.id, n] as const));
      const first = byId.get(p.definition.start?.[0] ?? "") ?? nodes[0]!;
      const ordered = [first, ...nodes.filter((n) => n !== first)];
      const plan: PlanStep[] = ordered.map((n) => {
        const kind = STEPS.get(n.key);
        const retry = n.onError?.mode === "retry" ? { max: Math.max(1, n.onError.max ?? 3), backoff: "exp" as const, baseMs: 1000 } : undefined;
        return { id: n.id, input: n.input, effects: kind?.effects ?? "write", ...(kind?.sample !== undefined ? { sample: kind.sample } : {}), ...(retry ? { retry } : {}) };
      });
      const exec = async (step: PlanStep, call: never): Promise<StepResult> => {
        const node = byId.get(step.id.replace(/#\d+$/, ""));
        if (!node) throw new Error(`The plan has no step ${step.id}.`);
        const c = call as unknown as Call;
        try {
          const r = (await d.call("steps-core.run_step", { node, call: { ...c, trigger: p.link.payload, vars: {} }, run: { id: run.id, automation: p.link.automationId } }, { principal: p.link.principal })) as StepResult;
          // a step that names no next step goes where the definition says; one that names nothing at all goes to the next node in the list
          if (r.next === undefined && !r.wait && node.next && node.next.length > 0) return { ...r, next: node.next[0]! };
          return r;
        } catch (raw) {
          const e = refusal(raw);
          if (e !== raw) throw e;   // a person who is no longer let in fails the Run whatever the step's own error rule says
          const mode = node.onError?.mode;
          const message = (e as { error?: { message?: string }; message?: string })?.error?.message ?? (e as Error).message ?? "The step failed.";
          if (mode === "continue") return { output: { error: message } };
          if (mode === "route" && node.onError?.route && byId.has(node.onError.route)) return { output: { error: message }, next: node.onError.route };
          throw e;
        }
      };
      return { plan, exec };
    },
  };
}
