// The data behind Files > Mounts in the shell (spec 2.16 Mounts, 3.5): who is connected to each source, the folders a mount can go into, and the words a mounted folder's status line says.
// Pure where it can be, so the sheet, the status line and the tests read one thing. Nothing here talks to a provider: every read is a capability of the Space.
import type { Accounts, MountRow, Person } from "../../places/files/mounts/index.ts";

type Call = (cap: string, input: unknown) => Promise<unknown>;

const GOOGLE = /google/i;
const MICROSOFT = /microsoft|graph|sharepoint|onedrive|\bms\b/i;

interface Conn { connectionId: string; connector: string; title: string; state: string }

/** Who is connected where. Google Drive and Microsoft 365 are the Space's connections; GitHub is the GitHub App's installation; this computer is the device the person is on. A source with no connection says so, and the sheet sends the person to connect it. */
export async function loadAccounts(call: Call, device?: { id: string; name: string } | null): Promise<Accounts> {
  const conns = await (call("connections.list", {}) as Promise<{ connections: Conn[] }>).then((o) => o.connections, () => [] as Conn[]);
  const active = (re: RegExp): Conn | undefined => conns.find((c) => c.state === "active" && re.test(c.connector));
  const google = active(GOOGLE);
  const ms = active(MICROSOFT);
  const installs = await (call("github.installations.list", {}) as Promise<{ installations: Array<{ account: string }> }>).then((o) => o.installations, () => []);
  const none = { label: "", connected: false };
  return {
    google_drive: google ? { label: google.title, connected: true, connectionId: google.connectionId } : none,
    microsoft: ms ? { label: ms.title, connected: true, connectionId: ms.connectionId } : none,
    local: device ? { label: device.name, connected: true, deviceId: device.id } : none,
    github: installs[0] ? { label: installs[0].account, connected: true } : none,
  };
}

/** This computer: the device the person is signed in on, when it can hold a folder. */
export async function thisDevice(call: Call): Promise<{ id: string; name: string } | null> {
  try {
    const out = (await call("devices.mine", {})) as { devices: Array<{ id: string; name: string; class?: string; current?: boolean; revokedAt?: number }> };
    const here = out.devices.find((d) => d.current === true && d.revokedAt === undefined);
    return here ? { id: here.id, name: here.name } : null;
  } catch { return null; }
}

/** The folders a mount can go into: every folder the person may write to, the top of Files first. */
export async function writableFolders(call: Call): Promise<Array<{ id: string; name: string }>> {
  const out = (await call("files.list", {})) as { folders: Array<{ folderId: string; name: string; parentId?: string | null; mine?: boolean }> };
  return out.folders.map((f) => ({ id: f.folderId, name: f.name }));
}

export function peopleOf(list: readonly { id: string; name: string; kind: string }[], meId: string): Person[] {
  return list.filter((p) => p.kind === "person" && p.id !== meId).map((p) => ({ id: p.id, name: p.name }));
}

const ago = (t: number, now: number): string => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

export interface MountLine { source: string; state: string; tone: "ok" | "warn" | "bad"; detail: string; canSync: boolean; paused: boolean }

/** The words of a mounted folder's status line: where it comes from, how it is doing, when it last synced, what waits. */
export function mountLine(m: MountRow, now: number): MountLine {
  const source = m.kind === "local" ? `Folder on ${m.fromDevice ?? "a computer"}` : m.kind === "github" ? `GitHub ${m.ref ?? m.name}` : `${m.provider}${m.ref ? ` ${m.name}` : ""}`;
  const parts: string[] = [];
  if (m.lastSyncAt !== undefined) parts.push(`Synced ${ago(m.lastSyncAt, now)}`); else parts.push("Not synced yet");
  if (m.pendingChanges > 0) parts.push(`${m.pendingChanges} ${m.pendingChanges === 1 ? "change" : "changes"} waiting`);
  if (m.conflicts > 0) parts.push(`${m.conflicts} ${m.conflicts === 1 ? "conflict" : "conflicts"}`);
  const base = { source, canSync: m.kind !== "local" && m.state !== "paused", paused: m.state === "paused" };
  if (m.state === "failing") return { ...base, state: "Needs attention", tone: "bad", detail: m.error ?? parts.join(" · ") };
  if (m.state === "paused") return { ...base, state: "Paused", tone: "warn", detail: parts.join(" · ") };
  if (m.state === "syncing") return { ...base, state: "Syncing", tone: "ok", detail: parts.join(" · ") };
  if (m.state === "device_offline") return { ...base, state: "Computer offline", tone: "warn", detail: `${m.fromDevice ?? "That computer"} syncs when it is on. ${parts.join(" · ")}` };
  if (m.conflicts > 0) return { ...base, state: "Needs a look", tone: "warn", detail: parts.join(" · ") };
  return { ...base, state: "Up to date", tone: "ok", detail: parts.join(" · ") };
}
