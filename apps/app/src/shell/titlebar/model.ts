// The title bar's words and the skin menu (spec 3.0 Title bar): Space name, skin dropdown (13 skins plus System, seven dark and six light; instant; personal per Space),
// tiny confirmations, "Offline, N changes waiting", "Away", Saved. Pure functions, tested without a window.
import { skins } from "../../../../../ui/src/tokens/skins.ts";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";

export type SyncTone = "ok" | "busy" | "offline";

export interface SyncLabel {
  text: string;
  tone: SyncTone;
  /** Offline and waiting changes open Waiting and Conflicts (4.14); a clean sync has nothing to open. */
  opens: boolean;
}

const changes = (n: number): string => `${n} change${n === 1 ? "" : "s"}`;

export function syncLabel(online: boolean, waiting: number): SyncLabel {
  if (!online) return { text: waiting > 0 ? `Offline, ${changes(waiting)} waiting` : "Offline", tone: "offline", opens: waiting > 0 };
  if (waiting > 0) return { text: `Sending ${changes(waiting)}`, tone: "busy", opens: true };
  return { text: "Synced", tone: "ok", opens: false };
}

export const SYSTEM_SKIN = "system";

export function skinName(id: string): string {
  if (id === SYSTEM_SKIN) return "System";
  return skins.find((s) => s.id === id)?.name ?? "System";
}

/** The dropdown: System first, then the dark skins, then the light ones. The open skin is checked. */
export function skinMenuEntries(current: string, onSkin: (id: string) => void): MenuEntry[] {
  const out: MenuEntry[] = [{ label: "System", checked: current === SYSTEM_SKIN, onSelect: () => onSkin(SYSTEM_SKIN) }];
  const group = (head: string, base: "dark" | "light"): void => {
    out.push({ head });
    for (const s of skins) if (s.base === base) out.push({ label: s.name, checked: s.id === current, onSelect: () => onSkin(s.id) });
  };
  group("Dark", "dark");
  group("Light", "light");
  return out;
}
