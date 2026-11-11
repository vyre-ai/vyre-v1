// The menu every "AI account" choice opens: Automatic, then each Space AI account. One that is not kept for the work is shown but cannot be picked, with the reason on hover.
import { useEffect, useRef } from "react";
import { LOADING_LABEL } from "../../../../../../ui/src/Menu/props.ts";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { aiOptions } from "./pick.ts";
import type { PickRow, Work } from "./pick.ts";

/** `rows` null: the Space's AI accounts have not arrived yet. The list then says Loading and never claims that nothing is kept; `useAiRefill` fills it in place when they arrive. */
export function aiMenu(rows: readonly PickRow[] | null, work: Work, current: string | undefined, choose: (handle: string | undefined) => void, o: { agentId?: string; none?: string; skip?: readonly string[]; openVault?: () => void } = {}): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const opts = aiOptions(rows ?? [], work, o.agentId);
  let real = 0;
  for (const opt of opts) {
    if (opt.value !== "" && o.skip?.includes(opt.value)) continue;
    if (opt.value === "") { entries.push({ label: o.none ?? opt.label, checked: !current, onSelect: () => choose(undefined) }); continue; }
    if (real === 0) entries.push({ separator: true });
    real += 1;
    entries.push({ label: opt.capped ? `${opt.label}, at its cap` : opt.label, checked: current === opt.value, onSelect: () => choose(opt.value) });
  }
  if (rows === null) { entries.push({ separator: true }, { label: LOADING_LABEL, disabled: true }); return entries; }
  // nothing is kept for this work: say so once, and point at where to change it
  if (opts.length === 1) {
    entries.push({ separator: true }, { label: work === "chats" ? "None to choose" : `None kept for ${work === "automations" ? "automations" : "this agent"}`, disabled: true });
    if (o.openVault) entries.push({ label: "Open Vault, AI accounts", onSelect: o.openVault });
  }
  return entries;
}

/**
 * For a screen that opens an AI-account menu from `useSpaceAi` rows that may still be loading: build the menu through the returned function, and when the rows arrive the menu that was opened
 * while they were loading is sent its real rows in place (once). Needs the `update` of the same `useMenu` that shows the menu.
 */
export function useAiRefill(update: (items: readonly MenuEntry[]) => void, rows: readonly PickRow[] | null): (build: (rows: readonly PickRow[] | null) => MenuEntry[]) => MenuEntry[] {
  const waiting = useRef<((rows: readonly PickRow[] | null) => MenuEntry[]) | null>(null);
  useEffect(() => {
    if (rows === null || waiting.current === null) return;
    const build = waiting.current;
    waiting.current = null;
    update(build(rows));
  }, [rows, update]);
  return (build) => { waiting.current = rows === null ? build : null; return build(rows); };
}
