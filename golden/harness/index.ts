// Golden flow harness (ARCH 10.3, 12.4). A flow declares the modules it needs and the event names it must produce, in order.
// While any needed module is a stub in host/modules.json the flow is PENDING: it does not run and it does not fail.
// Step implementations live in golden/steps/<NN>-<name>.ts (owned by L11): default export `async () => Observed[]`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Flow = { n: number; name: string; title: string; needs: string[]; events: string[] };
export type Observed = { type: string; traceId: string };
export type ModuleStatus = { id: string; status: "stub" | "live" };
export type Status = "pass" | "fail" | "pending";
export type Result = { n: number; name: string; status: Status; line: string; blockers: string[]; reasons: string[] };
export type LoadSteps = (flow: Flow) => Promise<(() => Promise<Observed[]>) | null>;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const defineFlow = (f: Flow): Flow => f;
export const flowId = (f: Flow): string => `${String(f.n).padStart(2, "0")}-${f.name}`;

/** Module ids from generated/registry.json, statuses from host/modules.json (ruling 25: stub or live is runtime state, not contract). */
export function loadRegistryModules(root = ROOT): ModuleStatus[] {
  const reg = JSON.parse(fs.readFileSync(path.join(root, "generated/registry.json"), "utf8"));
  const listed = JSON.parse(fs.readFileSync(path.join(root, "host/modules.json"), "utf8")) as { modules: { id: string; status: string }[] };
  const live = new Set(listed.modules.filter((m) => m.status === "live").map((m) => m.id));
  return reg.modules.map((m: { id: string }) => ({ id: m.id, status: live.has(m.id) ? "live" : "stub" }));
}

/** Event names from generated/registry.json, for checking that a flow only names real events. */
export function loadRegistryEvents(root = ROOT): Set<string> {
  const reg = JSON.parse(fs.readFileSync(path.join(root, "generated/registry.json"), "utf8"));
  return new Set(reg.events.map((e: { name: string }) => e.name));
}

/** The 15 flow definitions in number order (static barrel at golden/flows/index.ts). */
export async function loadFlows(): Promise<Flow[]> {
  return [...(await import("../flows/index.ts")).FLOWS].sort((a, b) => a.n - b.n);
}

/** Needed modules that are still stubs (or missing from the registry), sorted. */
export function blockers(flow: Flow, modules: ModuleStatus[]): string[] {
  const by = new Map(modules.map((m) => [m.id, m.status]));
  return flow.needs.filter((id) => by.get(id) !== "live").sort();
}

/** The declared events must appear in the observed events in that order (other events may sit between them). Returns problems. */
export function checkSequence(expected: string[], observed: Observed[]): string[] {
  const problems: string[] = [];
  let at = 0;
  for (const name of expected) {
    const i = observed.findIndex((o, k) => k >= at && o.type === name);
    if (i < 0) { problems.push(`missing event ${name} after position ${at}`); break; }
    at = i + 1;
  }
  const ids = new Set(observed.map((o) => o.traceId));
  if (ids.size > 1) problems.push(`events carry ${ids.size} trace ids, expected one`);
  if (observed.some((o) => !o.traceId)) problems.push("an event has no trace id");
  return problems;
}

/** Runs one flow. Pending when a needed module is a stub; failed when ready but its steps are missing or its events are wrong. */
export async function evaluate(flow: Flow, modules: ModuleStatus[], loadSteps: LoadSteps): Promise<Result> {
  const base = { n: flow.n, name: flow.name };
  const b = blockers(flow, modules);
  if (b.length) return { ...base, status: "pending", blockers: b, reasons: [], line: `PENDING (${b.length} module${b.length === 1 ? "" : "s"}) ${flowId(flow)}: ${b.join(", ")}` };
  const run = await loadSteps(flow);
  if (!run) return { ...base, status: "fail", blockers: [], reasons: ["no steps file in golden/steps"], line: `FAIL ${flowId(flow)}: no steps file in golden/steps` };
  let reasons: string[];
  try { reasons = checkSequence(flow.events, await run()); } catch (e) { reasons = [`steps threw: ${(e as Error).message}`]; }
  return { ...base, status: reasons.length ? "fail" : "pass", blockers: [], reasons, line: reasons.length ? `FAIL ${flowId(flow)}: ${reasons.join("; ")}` : `ok   ${flowId(flow)}` };
}

/** Loads golden/steps/<id>.ts when it exists. */
export const fileSteps = (root = ROOT): LoadSteps => async (flow) => {
  const f = path.join(root, "golden/steps", `${flowId(flow)}.ts`);
  return fs.existsSync(f) ? ((await import(f)).default as () => Promise<Observed[]>) : null;
};

/** Pending is not red: only failures make the run fail. */
export const exitCode = (rs: Result[]): number => (rs.some((r) => r.status === "fail") ? 1 : 0);

export function summary(rs: Result[]): string {
  const c = (s: Status) => rs.filter((r) => r.status === s).length;
  return `${rs.length} flows: ${c("pass")} pass, ${c("pending")} pending, ${c("fail")} fail`;
}
