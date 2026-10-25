// The device role (ARCH 1.2, 5.10): `vyred --role device` runs on each person's computer; `--role space,device` on a computer that also hosts a Personal Space. This file is the
// pure part: parse the role list and say what each role runs, so the daemon, the CLI table and doctor agree. It starts nothing.
export type Role = "space" | "device";
export const ROLES: readonly Role[] = ["space", "device"];

export class RoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleError";
  }
}

/** "space", "device" or "space,device" (any order, repeats ignored). Anything else is refused with the allowed values named. */
export function parseRoles(text: string): Role[] {
  const parts = text.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) throw new RoleError("A role is needed: space, device or space,device.");
  const out: Role[] = [];
  for (const p of parts) {
    if (p !== "space" && p !== "device") throw new RoleError(`"${p}" is not a role. Use space, device or space,device.`);
    if (!out.includes(p)) out.push(p);
  }
  return ROLES.filter((r) => out.includes(r));
}

export type HostProbe = "disk_encrypted" | "events_db" | "index_db" | "scheduler" | "docker" | "caddy" | "disk_space" | "time_skew";

export interface RolePlan {
  roles: Role[];
  /** host probes this daemon runs and reports (health.<probe>) */
  probes: HostProbe[];
  /** supervised services; the device ones start when their lanes register them */
  services: string[];
  /** needs a Space id and data directory */
  needsSpace: boolean;
  /** reachable by other computers: opens the HTTP gateway and public ingress */
  serves: boolean;
  /** connects outward to the Space host(s) through the connection manager, no inbound port */
  connectsOut: boolean;
}

const SPACE_PROBES: HostProbe[] = ["disk_encrypted", "events_db", "index_db", "scheduler", "docker", "caddy", "disk_space", "time_skew"];
const DEVICE_PROBES: HostProbe[] = ["disk_encrypted", "scheduler", "disk_space", "time_skew"];
const SPACE_SERVICES = ["gateway", "caddy", "docker", "log-sink", "sync-server"];
const DEVICE_SERVICES = ["connection-manager", "vault-filler", "local-turns", "terminal", "chrome-bridge", "device-replica"];

export function planFor(roles: readonly Role[]): RolePlan {
  const has = (r: Role): boolean => roles.includes(r);
  const probes = SPACE_PROBES.filter((p) => (has("space") ? true : DEVICE_PROBES.includes(p)));
  const services = [...(has("space") ? SPACE_SERVICES : []), ...(has("device") ? DEVICE_SERVICES : [])];
  return { roles: ROLES.filter(has), probes, services, needsSpace: has("space"), serves: has("space"), connectsOut: has("device") };
}
