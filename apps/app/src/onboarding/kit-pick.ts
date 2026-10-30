// "Your organisation" step, the Kit part: the person picks the Kit that fits their kind of work from the Kits this Space can install. The names come from kits.list, so industry
// words live only in the Kits. The install sheet is shown before anything is applied; a Kit with problems in its sheet is not installable from here.
import type { CapCall } from "../shell/session/caps.ts";

export interface KitRow { kitId: string; title: string; installed: boolean }
export interface KitSheet { tools: number; recordTypes: number; networkDomains: number; vaultNames: number; scripts: number; problems: number }

export async function listKits(call: CapCall): Promise<KitRow[]> {
  const out = await call("kits.list", { limit: 50 }) as { kits: KitRow[] };
  return out.kits.map((k) => ({ kitId: k.kitId, title: k.title, installed: k.installed }));
}

export async function sheetFor(call: CapCall, kitId: string): Promise<KitSheet> {
  const { sheet } = await call("kits.install_sheet", { kitId }) as { sheet: { tools: unknown[]; recordTypes: unknown[]; networkDomains: unknown[]; vaultNames: unknown[]; scripts: number; problems: unknown[] } };
  return { tools: sheet.tools.length, recordTypes: sheet.recordTypes.length, networkDomains: sheet.networkDomains.length, vaultNames: sheet.vaultNames.length, scripts: sheet.scripts, problems: sheet.problems.length };
}

/** Installs as the person who confirmed the sheet and makes it the Space's Kit. */
export async function installKit(call: CapCall, kitId: string): Promise<void> {
  await call("kits.install", { kitId, accepted: true });
  await call("kits.choose", { kitId, scope: "space" });
}

export const sheetLine = (s: KitSheet): string =>
  `This Kit uses ${s.tools} tools and ${s.recordTypes} record types${s.networkDomains ? `, reaches ${s.networkDomains} outside addresses` : ""}${s.vaultNames ? ` and asks for ${s.vaultNames} Vault names` : ""}${s.scripts ? `, and runs ${s.scripts} scripts in a sandbox` : ""}.`;
