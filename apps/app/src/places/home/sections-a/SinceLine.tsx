// Home > the first line: what changed since the person was last here, in one sentence, each part a link to where it lives. It reads three counts Home already trusts, so it is true on a Space with no
// assistant. Where the person was last is kept on this device (a convenience: with nothing kept it is the last day), and moves up each time Home is open for a few seconds.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CapMap } from "../../../../../../generated/types.ts";
import { useHomeData } from "./data.tsx";
import { DAY_MS } from "./model.ts";
import { lead, lineParts, sinceWord } from "./since.ts";
import type { Counts, PartKey } from "./since.ts";

const KEY = "vyre.home.lastVisit";
const MARK_AFTER_MS = 5_000;
const read = (): number | null => { try { const v = Number(globalThis.localStorage?.getItem(KEY)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
const write = (t: number): void => { try { globalThis.localStorage?.setItem(KEY, String(t)); } catch { /* storage blocked: the line still works, from the last day */ } };

export function SinceLine({ onOpen }: { onOpen?: (key: PartKey) => void } = {}): ReactElement | null {
  const data = useHomeData();
  const clock = data.clock();
  const [since] = useState(() => read() ?? clock.now - DAY_MS);
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let live = true;
    const ask = async <T,>(cap: string, input: unknown): Promise<T | null> => { try { return (await data.call(cap, input)) as T; } catch { return null; } };
    void (async () => {
      const [activity, inbox, needs] = await Promise.all([
        ask<CapMap["home.activity"]["out"]>("home.activity", { since, limit: 50 }),
        ask<CapMap["inbox.counts"]["out"]>("inbox.counts", {}),
        ask<CapMap["tasks.needs_you"]["out"]>("tasks.needs_you", { limit: 1 }),
      ]);
      if (!live) return;
      // nothing answered (offline, or no access to any of it): say nothing rather than "all quiet"
      if (!activity && !inbox && !needs) return;
      setCounts({ changes: activity?.items.filter((i) => i.kind === "record_change").length ?? 0, unread: inbox?.total ?? 0, match: inbox?.needsMatch ?? 0, waiting: needs?.total ?? 0 });
    })();
    const timer = setTimeout(() => write(data.clock().now), MARK_AFTER_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [data, since]);
  if (counts === null) return null;
  const parts = lineParts(counts);
  const open = (key: PartKey): void => {
    if (onOpen) return onOpen(key);
    if (key === "waiting") data.nav.openNeedsYou();
    else if (key === "changes") data.nav.openActivity();
    else data.nav.openInbox?.(key);
  };
  const linked = (key: PartKey): boolean => onOpen !== undefined || key === "waiting" || key === "changes" || data.nav.openInbox !== undefined;
  return (
    <View style={s.line} testID="home-since" accessibilityRole="summary">
      <Text style={s.lead}>{lead(parts, sinceWord(since, clock))}</Text>
      {parts.map((p, i) => (
        <Text key={p.key} style={s.part} accessibilityRole={linked(p.key) ? "link" : "text"} testID={`since-${p.key}`} onPress={() => open(p.key)}>{`${p.text}${i < parts.length - 1 ? "," : "."}`}</Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: 6, marginTop: 6, marginBottom: 4 },
  lead: { fontSize: 14, color: "var(--ink-2)" as string },
  part: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
});
