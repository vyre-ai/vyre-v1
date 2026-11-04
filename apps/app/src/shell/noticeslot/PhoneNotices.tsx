// The phone has no top bar: when something needs the person, one slim row above the screen holds the notifications bell with its dot. It takes no room when nothing is live.
import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import { NoticeSlot } from "./NoticeSlot.tsx";
import { notices as shared } from "./model.ts";
import type { NoticeStore } from "./model.ts";

export function PhoneNotices({ store = shared }: { store?: NoticeStore }): ReactElement | null {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  if (snap.live.length === 0) return null;
  return <View testID="mobile-notices" style={st.bar}><NoticeSlot store={store} compact /></View>;
}

const st = StyleSheet.create({
  bar: { height: 36, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, zIndex: 30, overflow: "visible" },
});
