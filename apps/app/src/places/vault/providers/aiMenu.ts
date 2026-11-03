// The menu every "AI account" choice opens: Automatic, then each Space AI account. One that is not kept for the work is shown but cannot be picked, with the reason on hover.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { aiOptions, noAccountLine } from "./pick.ts";
import type { PickRow, Work } from "./pick.ts";

export function aiMenu(rows: readonly PickRow[], work: Work, current: string | undefined, choose: (handle: string | undefined) => void, o: { agentId?: string; none?: string; skip?: readonly string[]; openVault?: () => void } = {}): MenuEntry[] {
  const entries: MenuEntry[] = [];
  const opts = aiOptions(rows, work, o.agentId);
  let real = 0;
  for (const opt of opts) {
    if (opt.value !== "" && o.skip?.includes(opt.value)) continue;
    if (opt.value === "") { entries.push({ label: o.none ?? opt.label, checked: !current, onSelect: () => choose(undefined) }); continue; }
    if (real === 0) entries.push({ separator: true });
    real += 1;
    entries.push({ label: opt.capped ? `${opt.label}, at its cap` : opt.label, checked: current === opt.value, onSelect: () => choose(opt.value) });
  }
  // nothing is kept for this work: say so once, and point at where to change it
  if (opts.length === 1) {
    entries.push({ separator: true }, { label: noAccountLine(work), disabled: true });
    if (o.openVault) entries.push({ label: "Open Vault, AI accounts", onSelect: o.openVault });
  }
  return entries;
}
