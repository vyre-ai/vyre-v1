// What the host binds into the Machines module (lane l-machines): the live count of turns on a machine, the Space server's own report, the doctor's findings, and the newest version. Unbound
// (a unit test, a host without them) each answers "nothing known" and the module works from its reports alone.
import type { Report } from "../../host/src/machines/report.ts";
import type { MachinesCtx } from "./projections.ts";

export interface DoctorFinding { key: string; state: "healthy" | "degraded" | "down"; detail: string; next: string }
export interface HostSeams {
  /** Turns running on a machine right now, when the host holds its socket (exact), else undefined. */
  turns(machineId: string): number | undefined;
  /** The Space server's own report (specs, load, what it runs), or null when it cannot read itself. */
  own(): Promise<{ name: string; report: Report } | null>;
  /** The doctor's findings for the Space server (host/src/daemon/doctor.ts). */
  findings(): Promise<DoctorFinding[]>;
}

export const hostSeams: HostSeams = { turns: () => undefined, own: () => Promise.resolve(null), findings: () => Promise.resolve([]) };

/** Bind (or, with null, unbind) what the host knows. */
export function bindMachines(h: Partial<HostSeams> | null): void {
  hostSeams.turns = h?.turns ?? (() => undefined);
  hostSeams.own = h?.own ?? (() => Promise.resolve(null));
  hostSeams.findings = h?.findings ?? (() => Promise.resolve([]));
}

/** The version machines should be on: the one waiting to be installed, else the one the Space server runs. Null when the caller may not read it. */
export async function latestVersion(ctx: MachinesCtx): Promise<string | null> {
  if (typeof ctx.call !== "function") return null;
  try {
    const s = (await ctx.call("updates.status", {})) as { current?: string; available?: string };
    return s.available ?? s.current ?? null;
  } catch { return null; }
}
