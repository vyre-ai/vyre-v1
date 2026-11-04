// The top bar's notifications slot (model.ts): right of the search field. A quiet line with the top notice and its one action, "+N" when there are more, a small popover with all of them and the recent
// ones below. On a phone it is a bell with a dot. A persisting notice has no dismiss: it goes when it is resolved.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShellIcon } from "../rail/icons.tsx";
import { PASSING_MS, notices as shared, slotView } from "./model.ts";
import type { Notice, NoticeStore } from "./model.ts";

function ActionButton({ n, testID }: { n: Notice; testID?: string }): ReactElement | null {
  if (!n.action) return null;
  const a = n.action;
  return (
    <Pressable role="button" aria-label={a.label} testID={testID} onPress={(e: { stopPropagation?: () => void }) => { e?.stopPropagation?.(); a.run(); }} style={st.act}>
      <Text style={st.actText}>{a.label}</Text>
    </Pressable>
  );
}

export function NoticeSlot({ store = shared, compact = false }: { store?: NoticeStore; compact?: boolean }): ReactElement | null {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setInterval(() => store.tick(), 500);
    (t as { unref?: () => void }).unref?.();   // a test's process may end with the slot still mounted
    return () => clearInterval(t);
  }, [store]);
  const v = slotView(snap);
  const hasAny = v.top !== null || v.recent.length > 0;
  if (!hasAny && !open) return compact ? <Pressable role="button" aria-label="Notifications" testID="notice-bell" onPress={() => setOpen(true)} style={st.bell}><ShellIcon name="bell" size={16} /></Pressable> : <View testID="notice-slot-empty" style={st.empty} />;
  const popover = open ? (
    <View testID="notice-popover" style={[st.popover, compact ? st.popoverCompact : null]} accessibilityRole="menu">
      {v.live.length === 0 ? <Text style={st.quiet}>Nothing needs you.</Text> : null}
      {/* ui-rows-lint: not a list (notices, each a line with its own action button; nothing to hover or select) */}
      {v.live.map((n) => (
        <View key={n.id} testID={`notice-row-${n.id}`} style={st.row}>
          <ShellIcon name={n.kind === "locked" ? "lock" : n.kind === "offline" ? "cloudOff" : "bell"} size={13} color="var(--ink-3)" />
          <Text style={st.rowText} numberOfLines={2}>{n.text}</Text>
          <ActionButton n={n} testID={`notice-row-action-${n.id}`} />
        </View>
      ))}
      {v.recent.length > 0 ? <Text style={st.head}>Recent</Text> : null}
      {/* ui-rows-lint: not a list (the recent notices as plain lines of text) */}
      {v.recent.map((n) => <Text key={`r-${n.id}`} testID={`notice-recent-${n.id}`} style={st.recent} numberOfLines={1}>{n.text}</Text>)}
    </View>
  ) : null;
  const toggle = (): void => setOpen((o) => !o);
  if (compact) {
    return (
      <View style={st.wrapCompact}>
        <Pressable role="button" aria-label={v.top ? `Notifications: ${v.top.text}` : "Notifications"} testID="notice-bell" onPress={toggle} style={st.bell}>
          <ShellIcon name={v.hasLocked ? "lock" : "bell"} size={16} color={v.top ? "var(--ink-2)" : "var(--ink-3)"} />
          {v.top ? <View testID="notice-dot" style={st.dot} /> : null}
        </Pressable>
        {open ? <Pressable accessible={false} style={st.backdrop} onPress={() => setOpen(false)} /> : null}
        {popover}
      </View>
    );
  }
  return (
    <View style={st.wrap}>
      {v.top ? (
        <Pressable role="button" aria-label={`${v.top.text}${v.more > 0 ? `, and ${v.more} more` : ""}`} testID="notice-slot" onPress={toggle} style={st.pill} {...{ dataSet: { notice: v.top.kind } }}>
          <ShellIcon name={v.top.kind === "locked" ? "lock" : v.top.kind === "offline" ? "cloudOff" : "bell"} size={13} color="var(--ink-3)" />
          <Text numberOfLines={1} testID="notice-text" style={st.text}>{v.top.text}</Text>
          <ActionButton n={v.top} testID="notice-action" />
          {v.more > 0 ? <Text testID="notice-more" style={st.more}>{`+${v.more}`}</Text> : null}
        </Pressable>
      ) : <Pressable role="button" aria-label="Notifications" testID="notice-bell" onPress={toggle} style={st.bell}><ShellIcon name="bell" size={15} /></Pressable>}
      {open ? <Pressable accessible={false} style={st.backdrop} onPress={() => setOpen(false)} /> : null}
      {popover}
    </View>
  );
}

export { PASSING_MS };

const st = StyleSheet.create({
  empty: { width: 0 },
  wrap: { position: "relative", flexShrink: 1, minWidth: 0, justifyContent: "center" },
  wrapCompact: { position: "relative", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, height: 26, paddingHorizontal: 9, borderRadius: 8, maxWidth: 460 },
  text: { flexShrink: 1, fontSize: 12.5, color: "var(--ink-2)" as string },
  more: { fontSize: 11.5, color: "var(--ink-3)" as string },
  act: { paddingHorizontal: 7, height: 20, borderRadius: 6, justifyContent: "center" },
  actText: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  bell: { width: 30, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  dot: { position: "absolute", top: 4, right: 6, width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--accent)" as string },
  backdrop: { position: "fixed" as unknown as "absolute", left: 0, right: 0, top: 0, bottom: 0, zIndex: 70 },
  popover: { position: "absolute", top: 30, left: 0, zIndex: 80, minWidth: 340, padding: 10, gap: 8, borderRadius: 12, backgroundColor: "var(--raised)" as string, borderWidth: 1, borderColor: "var(--line)" as string, boxShadow: "var(--sh-pop)" as string },
  // on a phone the sheet hangs from the top bar across the window, not from the bell
  popoverCompact: { position: "fixed" as unknown as "absolute", top: 40, left: 12, right: 12, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowText: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string, marginTop: 4 },
  recent: { fontSize: 12.5, color: "var(--ink-3)" as string },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string },
});
