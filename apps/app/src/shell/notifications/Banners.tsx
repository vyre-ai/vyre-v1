// Interrupt banners, top right of the window, with the notification's actions inline (spec 2.24, 3.0). Same key collapses; three at most.
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { BannerStack } from "./model.ts";
import type { Banner, Notification, NotificationAction } from "./model.ts";

export interface BannersProps {
  stack: BannerStack;
  /** An inline action ("Approve", "Reply") was pressed. The banner goes once the action is handed over. */
  onAction(item: Notification, action: NotificationAction): void;
  /** The banner body was pressed: open what it is about. */
  onOpen(item: Notification): void;
}

function BannerCard({ b, onAction, onOpen, onDismiss, onHold }: { b: Banner; onAction: BannersProps["onAction"]; onOpen: BannersProps["onOpen"]; onDismiss: () => void; onHold: (on: boolean) => void }): ReactElement {
  const actions: ReactNode[] = [];
  for (const a of b.item.actions) {
    actions.push(
      <Pressable
        key={a.label}
        testID={`banner-action-${a.label}`}
        accessibilityRole="button"
        accessibilityLabel={a.label}
        onPress={() => { onAction(b.item, a); onDismiss(); }}
        style={({ hovered }: { hovered?: boolean }) => [styles.action, hovered === true ? { backgroundColor: "var(--hover)" } : null]}
      >
        <Text style={styles.actionText}>{a.label}</Text>
      </Pressable>,
    );
  }
  return (
    <View testID={`banner-${b.item.id}`} role="alert" style={styles.card} {...(Platform.OS === "web" ? { onPointerEnter: () => onHold(true), onPointerLeave: () => onHold(false) } : {})}>
      <Pressable accessibilityRole="button" accessibilityLabel={b.item.title} onPress={() => { onOpen(b.item); onDismiss(); }} style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{b.item.title}</Text>
        {b.item.body ? <Text style={styles.note} numberOfLines={2}>{b.item.body}</Text> : null}
        {b.count > 1 ? <Text testID={`banner-count-${b.item.id}`} style={styles.note}>{`${b.count} new`}</Text> : null}
      </Pressable>
      {actions.length ? <View style={styles.actions}>{actions}</View> : null}
      <Pressable testID={`banner-close-${b.item.id}`} accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} style={styles.close}>
        <Text style={styles.closeText}>{"×"}</Text>
      </Pressable>
    </View>
  );
}

export function NotificationBanners({ stack, onAction, onOpen }: BannersProps): ReactElement | null {
  const snap = useSyncExternalStore(stack.subscribe, stack.getSnapshot, stack.getSnapshot);
  const [hold, setHold] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = setInterval(() => stack.expire(hold), 1000);
    return () => clearInterval(t);
  }, [stack, hold]);
  if (!snap.visible.length) return null;
  const cards: ReactNode[] = [];
  for (const b of snap.visible) {
    cards.push(<BannerCard key={b.key} b={b} onAction={onAction} onOpen={onOpen} onDismiss={() => stack.dismiss(b.key)} onHold={(on) => setHold(on ? b.key : undefined)} />);
  }
  return <View testID="banners" style={styles.stack} pointerEvents="box-none">{cards}</View>;
}

const FIXED = (Platform.OS === "web" ? "fixed" : "absolute") as unknown as "absolute";

const styles = StyleSheet.create({
  stack: { position: FIXED, top: 44, right: 14, width: 340, maxWidth: "92%", gap: 8, zIndex: 80 },
  card: { backgroundColor: "var(--raised)", borderRadius: 12, paddingVertical: 10, paddingLeft: 14, paddingRight: 34, boxShadow: "0 0 0 1px var(--line-2), var(--sh-pop)" } as object,
  body: { gap: 2 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" },
  note: { fontSize: 12, color: "var(--ink-3)" },
  actions: { flexDirection: "row", gap: 6, marginTop: 8 },
  action: { height: 26, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "var(--line-2)", justifyContent: "center" },
  actionText: { fontSize: 12.5, color: "var(--ink)", fontWeight: "500" },
  close: { position: "absolute", top: 6, right: 6, width: 22, height: 22, alignItems: "center", justifyContent: "center", borderRadius: 6 },
  closeText: { fontSize: 15, color: "var(--ink-3)", lineHeight: 16 },
});
