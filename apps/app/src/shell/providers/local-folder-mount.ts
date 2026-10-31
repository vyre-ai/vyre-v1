// One way to add a folder from this computer, shared by the onboarding step and the Files mount sheet: the system folder dialog (the shell's pick_paths), then mounts.add as a live-only local mount.
// The folder stays on this computer. Without the shell (web, phone) there is no dialog and no local folder can be picked.
import type { CapCall } from "../session/caps.ts";
import { thisDevice, writableFolders } from "./files-mounts-data.ts";

export type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
export const shellInvoke = (): Invoke | undefined => (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke;

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
export const parentOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(-3, -1).join("/");

/** The system folder dialog; the picked paths, none when it is closed without a pick. Rejects when the dialog cannot open. */
export async function pickFolders(invoke: Invoke): Promise<string[]> {
  const got = await invoke("pick_paths", { options: { title: "Choose a folder", multiple: false, directory: true, filters: [] } });
  return Array.isArray(got) ? got.filter((p): p is string => typeof p === "string") : [];
}

export interface MountPlace { into: string; deviceId: string }

/** Where a local folder goes: this computer and the top folder it is mounted into. Null while either is not ready. */
export async function mountPlace(call: CapCall): Promise<MountPlace | null> {
  const [device, folders] = await Promise.all([thisDevice(call), writableFolders(call).catch(() => [])]);
  return device && folders[0] ? { into: folders[0].id, deviceId: device.id } : null;
}

/** Mount one folder of this computer, live only. The key is stable for the same folder into the same place, so a repeat mounts once. */
export async function mountLocalFolder(call: CapCall, path: string, at: MountPlace, name?: string): Promise<{ mountId: string; folderId: string }> {
  const out = (await call("mounts.add", { into: at.into, source: { kind: "local", deviceId: at.deviceId, localPath: path }, name: name ?? baseName(path), mode: "live_only", idempotencyKey: `mount:local:${path}:${at.into}` })) as { mountId?: string; folderId?: string } | undefined;
  return { mountId: out?.mountId ?? "", folderId: out?.folderId ?? "" };
}

/** The unmount a row's remove button does: mounts.remove, no copy kept (live only has none). */
export async function unmountFolder(call: CapCall, mountId: string): Promise<void> {
  await call("mounts.remove", { mountId, keepCopy: false });
}
