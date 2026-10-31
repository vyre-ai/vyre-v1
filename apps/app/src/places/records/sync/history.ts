// Records > sync: the earlier values of a field as a menu. Each is the value a newest-wins settlement replaced, with who replaced it, and Restore puts it back (an ordinary edit, so it is the
// newest change and goes out on the next pass).
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { replacedLine } from "./model.ts";
import type { HistoryEntry } from "./model.ts";

const cut = (s: string, n = 48): string => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

export function historyMenu(o: { title: string; app: string; now: number; entries: readonly HistoryEntry[]; show: (v: unknown) => string; onRestore: (e: HistoryEntry) => void }): MenuEntry[] {
  if (o.entries.length === 0) return [{ head: `No earlier values of ${o.title.toLowerCase()}` }];
  const out: MenuEntry[] = [{ head: `Earlier values of ${o.title.toLowerCase()}` }];
  for (const e of o.entries) {
    const text = o.show(e.value);
    out.push({ head: replacedLine(e, o.app, o.now) }, { label: text === "" ? "Restore (empty)" : `Restore ${cut(text)}`, onSelect: () => o.onRestore(e) });
  }
  return out;
}
