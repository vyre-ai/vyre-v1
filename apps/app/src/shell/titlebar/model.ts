// The title bar's words and the skin menu (spec 3.0 Title bar): Space name, skin dropdown (15 skins plus Vyre, the default, eight dark and seven light; instant; personal per Space),
// tiny confirmations, "Offline, N changes waiting", "Away", Saved. Pure functions, tested without a window.
import { skins, system } from "../../../../../ui/src/tokens/skins.ts";
import type { MenuEntry } from "../../../../../ui/src/Menu/index.tsx";

export type SyncTone = "ok" | "busy" | "offline";

export interface SyncLabel {
  text: string;
  tone: SyncTone;
  /** Offline and waiting changes open Waiting and Conflicts (4.14); a plain connection has nothing to open; "Connected" says the app reaches the Space, not that replication is running. */
  opens: boolean;
}

const changes = (n: number): string => `${n} change${n === 1 ? "" : "s"}`;

export function syncLabel(online: boolean, waiting: number): SyncLabel {
  if (!online) return { text: waiting > 0 ? `Offline, ${changes(waiting)} waiting` : "Offline", tone: "offline", opens: waiting > 0 };
  if (waiting > 0) return { text: `Sending ${changes(waiting)}`, tone: "busy", opens: true };
  return { text: "Connected", tone: "ok", opens: false };
}

export const SYSTEM_SKIN = "system";

export function skinName(id: string): string {
  if (id === SYSTEM_SKIN) return system.name;
  return skins.find((s) => s.id === id)?.name ?? system.name;
}

const SVG_OPEN = 'viewBox="0 0 16 16" width="15" height="15" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"';

/** System: a half-filled circle in the menu's ink. Drawn as markup with attributes only, so the app's style-src has nothing to block. */
export const SYSTEM_ICON = `<svg ${SVG_OPEN} fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" stroke="none"/></svg>`;

/** A skin's swatch: a rounded tile in its background with a surface card and an accent dot. Attributes only (no style tag, no style attribute), so it draws under the Tauri CSP. */
export function skinSwatch(id: string): string {
  const s = skins.find((x) => x.id === id);
  if (!s) return SYSTEM_ICON;
  const p = s.palette;
  return `<svg ${SVG_OPEN}><rect x="0.5" y="0.5" width="15" height="15" rx="4" fill="${p.win}" stroke="${p.me}" stroke-width="1"/>`
    + `<rect x="3" y="3" width="10" height="5.5" rx="1.5" fill="${p.raised}"/><circle cx="10.5" cy="11.5" r="1.8" fill="${p.accent}"/></svg>`;
}

/** The dropdown, as the prototype draws it: "Your skin in <Space>", Vyre (the default), the dark skins, the light ones, then More in Appearance. Each skin has its swatch; the open skin is checked. */
export function skinMenuEntries(current: string, onSkin: (id: string) => void, more?: { space?: string; onMore?: () => void }): MenuEntry[] {
  const out: MenuEntry[] = [];
  if (more?.space) out.push({ head: `Your skin in ${more.space}` });
  out.push({ label: system.name, icon: SYSTEM_ICON, checked: current === SYSTEM_SKIN, onSelect: () => onSkin(SYSTEM_SKIN) });
  const group = (head: string, base: "dark" | "light"): void => {
    out.push({ head });
    for (const s of skins) if (s.base === base) out.push({ label: s.name, icon: skinSwatch(s.id), checked: s.id === current, onSelect: () => onSkin(s.id) });
  };
  group("Dark", "dark");
  group("Light", "light");
  if (more?.onMore) out.push({ separator: true }, { label: "More in Appearance", icon: SYSTEM_ICON, onSelect: more.onMore });
  return out;
}
