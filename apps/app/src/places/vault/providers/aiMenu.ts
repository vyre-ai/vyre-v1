// The menu every "AI account" choice opens: Automatic, then each Space AI account. One that is not kept for the work is shown but cannot be picked, with the reason on hover.
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { aiOptions } from "./pick.ts";
import type { PickRow, Work } from "./pick.ts";

export function aiMenu(rows: readonly PickRow[], work: Work, current: string | undefined, choose: (handle: string | undefined) => void, o: { agentId?: string; none?: string; skip?: readonly string[] } = {}): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const opt of aiOptions(rows, work, o.agentId)) {
    if (opt.value !== "" && o.skip?.includes(opt.value)) continue;
    if (opt.value === "") { entries.push({ label: o.none ?? opt.label, checked: !current, onSelect: () => choose(undefined) }, { separator: true }); continue; }
    entries.push({ label: opt.capped ? `${opt.label} (at its cap)` : opt.label, checked: current === opt.value, ...(opt.blocked ? { disabled: true, reason: opt.blocked } : {}), onSelect: () => choose(opt.value) });
  }
  const last = entries[entries.length - 1];
  if (last && "separator" in last) entries.pop();
  return entries;
}
