// The live audit sink receives only the invoke pipeline's declared metadata.
// It calls the module export directly: no capability recursion and no caller-supplied row API.
import type { AuditRow } from "../invoke.ts";
import type { RawDb } from "../ctx/db.ts";

type Kind = "person" | "agent" | "actor" | "service";
type Actor = { kind: Kind; id: string };
type Klass = "change" | "sensitive" | "deny" | "admin" | "erase" | "sign_in";
interface AppendContext { space: string; principal: Actor; trace: { traceId: string; spanId: string }; now(): number; db: RawDb; emit(...args: unknown[]): void }
interface ModuleRow { actor: Actor; onBehalfOf?: Actor; action: string; class: Klass; resource?: { type: string; id: string }; after: { decisionId: string; reason: string; capabilityVersion: number; risk: AuditRow["risk"]; outcome: AuditRow["class"]; targets?: AuditRow["targets"] } }

export function createAuditRecorder(options: { space: string; db: RawDb; module: Record<string, unknown> | undefined; principal(id: string): { kind: string } | undefined }): (row: AuditRow) => void {
  const append = options.module?.["appendRow"] as ((ctx: AppendContext, row: ModuleRow) => unknown) | undefined;
  const classify = options.module?.["classOfInvoke"] as ((kind: AuditRow["class"], risk: AuditRow["risk"]) => Klass) | undefined;
  // Deferred modules keep the existing logs sink; a live audit module supplies both exports.
  if (!append || !classify) return () => undefined;
  const actor = (id: string): Actor => {
    const kind = options.principal(id)?.kind;
    if (kind === "person" || kind === "agent" || kind === "actor" || kind === "service") return { kind, id };
    if (/^usr_/.test(id)) return { kind: "person", id };
    if (/^agt_/.test(id)) return { kind: "agent", id };
    if (/^act_/.test(id)) return { kind: "actor", id };
    return { kind: "service", id: /^svc_/.test(id) ? id : "svc_anonymous" };
  };
  return (row) => {
    if (row.cap === "audit.append") return;
    const principal = actor(row.principal);
    append({ space: options.space, principal, trace: { traceId: row.traceId, spanId: row.spanId }, now: () => row.at, db: options.db, emit: () => undefined }, {
      actor: principal,
      ...(row.actingFor ? { onBehalfOf: actor(row.actingFor) } : {}),
      action: row.cap,
      class: classify(row.class, row.risk),
      ...(row.resource?.id ? { resource: { type: row.resource.type, id: row.resource.id } } : {}),
      after: { decisionId: row.decisionId, reason: row.reason, capabilityVersion: row.v, risk: row.risk, outcome: row.class, ...(row.targets ? { targets: row.targets } : {}) },
    });
  };
}
