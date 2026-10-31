// Every place a terminal can open (rc.8): this computer, your other computers, a Space server and the agent computers you may use. Read from the Space, so a Personal Space lists only computers and
// a Team Space adds its server and agent computers; nothing that does not exist is listed, and nothing says "needs a Team Space". An offline computer is listed but cannot be chosen.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { TerminalHostChoice } from "../../../../../../ui/src/Terminal/index.tsx";

type Call = (cap: string, input: unknown) => Promise<unknown>;
type Device = CapMap["devices.mine"]["out"]["devices"][number];
type Computer = CapMap["computers.list"]["out"]["computers"][number];

export interface HostChoice extends TerminalHostChoice {
  kind: "device" | "server" | "agent";
  deviceId?: string;
  agentId?: string;
  computerId?: string;
}

/** A computer that was seen in the last five minutes is on; this one always is. */
export const ONLINE_MS = 5 * 60_000;

export function deviceHosts(devices: readonly Device[], now: number): HostChoice[] {
  const mine = devices.filter((d) => d.revokedAt === undefined && (d.class === "desktop" || d.class === "daemon"));
  const here = mine.find((d) => d.current === true);
  const out: HostChoice[] = [];
  if (here) out.push({ key: `device:${here.id}`, label: "This computer", kind: "device", online: true, deviceId: here.id });
  for (const d of mine) {
    if (d === here) continue;
    const on = d.lastSeenAt !== undefined && now - d.lastSeenAt <= ONLINE_MS;
    out.push({ key: `device:${d.id}`, label: d.name, kind: "device", online: on, ...(on ? {} : { why: "Offline" }), deviceId: d.id });
  }
  return out;
}

export function agentHosts(computers: readonly Computer[], nameOf: (agentId: string) => string): HostChoice[] {
  return computers.map((c) => {
    const on = c.state !== "error" && c.state !== "provisioning";
    return { key: `agent:${c.computerId}`, label: `${nameOf(c.agentId)}'s computer`, kind: "agent" as const, online: on, ...(on ? {} : { why: c.state === "error" ? "Not working" : "Starting" }), agentId: c.agentId, computerId: c.computerId };
  });
}

/** The hosts of this Space. The server and the agent computers are read only in a Team Space; a read that fails leaves its part out. */
export async function loadHosts(call: Call, o: { team: boolean; now: number; nameOf(agentId: string): string }): Promise<HostChoice[]> {
  const devices = await (call("devices.mine", {}) as Promise<CapMap["devices.mine"]["out"]>).then((r) => r.devices ?? [], () => [] as Device[]);
  const out = deviceHosts(devices, o.now);
  if (o.team) {
    out.push({ key: "server", label: "Space server", kind: "server", online: true });
    const computers = await (call("computers.list", {}) as Promise<CapMap["computers.list"]["out"]>).then((r) => r.computers, () => [] as Computer[]);
    out.push(...agentHosts(computers, o.nameOf));
  }
  return out;
}

/** The id of this computer as the Space knows it (the device the person is signed in on), or the only computer they have; undefined when there is none. A terminal on a computer needs it. */
export async function thisDeviceId(call: Call): Promise<string | undefined> {
  const devices = await (call("devices.mine", {}) as Promise<CapMap["devices.mine"]["out"]>).then((r) => r.devices ?? [], () => [] as Device[]);
  const mine = devices.filter((d) => d.revokedAt === undefined && (d.class === "desktop" || d.class === "daemon"));
  return (mine.find((d) => d.current === true) ?? (mine.length === 1 ? mine[0] : undefined))?.id;
}

/** The call that opens a session on one host. */
export function openHostCall(h: HostChoice, key: string): { cap: "terminal.open" | "terminal.open_server"; input: Record<string, unknown> } {
  if (h.kind === "server") return { cap: "terminal.open_server", input: { idempotencyKey: key } };
  if (h.kind === "agent") return { cap: "terminal.open", input: { host: "agent_computer", ...(h.agentId ? { agentId: h.agentId } : {}), ...(h.computerId ? { computerId: h.computerId } : {}), idempotencyKey: key } };
  return { cap: "terminal.open", input: { host: "device", ...(h.deviceId ? { deviceId: h.deviceId } : {}), idempotencyKey: key } };
}
