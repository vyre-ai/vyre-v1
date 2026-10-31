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
  // The installations are asked for only once the GitHub App exists: with no App the call is sure to fail (a 502 in the network log), and the sheet just says GitHub is not connected.
  const health = await (call("github.health", {}) as Promise<{ state?: string; detail?: string }>).then((h) => h, () => null);
  const appSetUp = health !== null && !/not set up/i.test(health.detail ?? "");
  const installs = appSetUp ? await (call("github.installations.list", {}) as Promise<{ installations: Array<{ account: string }> }>).then((o) => o.installations, () => []) : [];
  const none = { label: "", connected: false };
  return {
    google_drive: google ? { label: google.title, connected: true, connectionId: google.connectionId } : none,
    microsoft: ms ? { label: ms.title, connected: true, connectionId: ms.connectionId } : none,
    local: device ? { label: device.name, connected: true, deviceId: device.id } : none,
    github: installs[0] ? { label: installs[0].account, connected: true } : none,
  };
}

const WEB = "https://github.com";

/**
 * Connect GitHub without leaving the sheet: open the App's install page, then ask for installations until one appears, and hand its account back. With no App set up (an admin makes it in
 * Connections) there is no page to open and the answer is "not_set_up", so the shell can send the person there. `sleep` and `tries` are the polling clock; the signal stops it when the sheet closes.
 */
export async function connectGithub(call: Call, openUrl: (url: string) => void, o: { sleep?: (ms: number) => Promise<void>; tries?: number; everyMs?: number; signal?: AbortSignal } = {}): Promise<{ label: string; connected: true } | "not_set_up" | null> {
  const app = await (call("github.app.get", {}) as Promise<{ slug?: string }>).then((a) => a, () => null);
  if (!app?.slug) return "not_set_up";
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const read = (): Promise<string | null> => (call("github.installations.list", {}) as Promise<{ installations: Array<{ account: string }> }>).then((r) => r.installations[0]?.account ?? null, () => null);
  const already = await read();
  if (already) return { label: already, connected: true };
  openUrl(`${WEB}/apps/${encodeURIComponent(app.slug)}/installations/new`);
  for (let i = 0; i < (o.tries ?? 72); i++) {
    await sleep(o.everyMs ?? 2500);
    if (o.signal?.aborted) return null;
    const account = await read();
    if (account) return { label: account, connected: true };
  }
  return null;
}

/** This computer: the device the person is signed in on, when it can hold a folder. */
export async function thisDevice(call: Call): Promise<{ id: string; name: string } | null> {
  try {
    const out = (await call("devices.mine", {})) as { devices: Array<{ id: string; name: string; class?: string; current?: boolean; revokedAt?: number }> };
    const here = out.devices.find((d) => d.current === true && d.revokedAt === undefined);
    return here ? { id: here.id, name: here.name } : null;
  } catch { return null; }
}

/** The folders a mount can go into: the person's own top folder first (Personal, from files.tree), then the folders in it. files.list with no folder answers only the children of Personal, which is empty in a new Space. */
export async function writableFolders(call: Call): Promise<Array<{ id: string; name: string }>> {
  const top = await (call("files.tree", {}) as Promise<{ roots?: Array<{ key: string; title: string; kind: string; folderId?: string }> }>).then(
    (o) => (o.roots ?? []).find((r) => r.key === "personal" && r.kind === "folder" && r.folderId !== undefined), () => undefined);
  const out = (await call("files.list", {}).catch(() => ({ folders: [] }))) as { folders?: Array<{ folderId: string; name: string }> };
  const kids = (out.folders ?? []).map((f) => ({ id: f.folderId, name: f.name }));
  return top?.folderId ? [{ id: top.folderId, name: top.title }, ...kids.filter((k) => k.id !== top.folderId)] : kids;
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
