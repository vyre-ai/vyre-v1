// The title bar on the rail ground: the one search in the middle (Cmd-K). The connection shows only when it is broken ("Sending 2 changes", "Offline, 3 changes waiting"; click opens Waiting and Conflicts),
// so a calm bar is one field. Confirmations are toasts near the composer (shell/spaces/Toast); the skin lives in Settings and Cmd-K.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ShellIcon } from "../rail/icons.tsx";
import { useResume } from "../../onboarding/resume-context.ts";
import { syncLabel } from "./model.ts";

export const TITLE_BAR_HEIGHT = 38;

export interface TitleBarProps {
  /** What the bar says to a screen reader: "Vyre, Northwind, Chats". */
  title: string;
  online: boolean;
  waiting: number;
  onOpenWaiting: () => void;
  onSearch: () => void;
  /** A phone-width window keeps the icon and drops the words. */
  compact?: boolean;
  /** The running call as a pill (the Inbox's CallTitlePill); nothing when there is no call. */
  call?: ReactNode;
}

export function TitleBar(props: TitleBarProps): ReactElement {
  const { title, online, waiting, compact = false } = props;
  const sync = syncLabel(online, waiting);
  const resume = useResume();
  const [over, setOver] = useState(false);
  const toneColor = sync.tone === "offline" ? "var(--warn)" : "var(--accent)";
  return (
    <View testID="shell-titlebar" accessibilityRole="header" accessibilityLabel={title} style={styles.bar}>
      <View style={styles.side}>
        {resume?.pill ? <View testID="title-setup" style={styles.setup}>{resume.pill}</View> : null}
        {props.call ? <View testID="title-call" style={styles.call}>{props.call}</View> : null}
      </View>
      <Pressable
        role="button" aria-label="Search" testID="title-search" onPress={props.onSearch}
        onHoverIn={() => setOver(true)} onHoverOut={() => setOver(false)}
        style={[styles.omni, compact ? styles.omniCompact : null]}
      >
        <ShellIcon name="search" size={13} color={over ? "var(--ink-2)" : "var(--ink-3)"} />
        {compact ? null : <Text numberOfLines={1} style={[styles.omniText, over ? styles.omniOver : null]}>Search or run a command</Text>}
        {compact ? null : <Text style={styles.kbd}>⌘K</Text>}
      </Pressable>
      <View style={[styles.side, styles.right]}>
        {sync.tone === "ok" ? null : (
          <Pressable role="button" aria-label={sync.text} testID="title-sync" disabled={!sync.opens} onPress={sync.opens ? props.onOpenWaiting : undefined} style={styles.state}>
            <View style={[styles.sdot, { backgroundColor: toneColor as string }]} />
            {compact ? null : <Text numberOfLines={1} style={styles.stateText}>{sync.text}</Text>}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: TITLE_BAR_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 14 },
  side: { flex: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 },
  right: { justifyContent: "flex-end" },
  call: { justifyContent: "center" },
  setup: { justifyContent: "center", flexShrink: 0 },
  omni: { width: 340, maxWidth: "60%" as unknown as number, height: 26, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 11, paddingRight: 6, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  omniCompact: { width: 34, paddingLeft: 10, paddingRight: 0 },
  omniText: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-3)" as string },
  omniOver: { color: "var(--ink-2)" as string },
  kbd: { fontSize: 10.5, lineHeight: 15, color: "var(--ink-4)" as string, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: "var(--line-2)" as string },
  state: { flexDirection: "row", alignItems: "center", gap: 6, height: 26, paddingHorizontal: 8, borderRadius: 7 },
  stateText: { fontSize: 12, color: "var(--ink-3)" as string },
  sdot: { width: 6, height: 6, borderRadius: 3 },
});
