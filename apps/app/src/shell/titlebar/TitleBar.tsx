// The title bar (spec 3.0): "Vyre · <Space> · <Place>" in the middle, a tiny confirmation replaces it for a moment (with Undo when the action can be taken back),
// the sync chip on the right ("Synced", "Sending 2 changes", "Offline, 3 changes waiting"; click opens Waiting and Conflicts), Search (Cmd-K) and the skin dropdown.
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../ui/src/Menu/index.tsx";
import { ShellIcon } from "../rail/icons.tsx";
import type { StatusLine } from "../spaces/hub.ts";
import { skinMenuEntries, skinName, syncLabel } from "./model.ts";

export const TITLE_BAR_HEIGHT = 38;

export interface TitleBarProps {
  title: string;
  status: StatusLine | null;
  onUndo: () => void;
  online: boolean;
  waiting: number;
  onOpenWaiting: () => void;
  onSearch: () => void;
  /** The open skin's id, or "system". */
  skin: string;
  onSkin: (id: string) => void;
  /** A phone-width window keeps icons and drops labels. */
  compact?: boolean;
  /** The running call as a pill beside the title (the Inbox's CallTitlePill); nothing when there is no call. */
  call?: ReactNode;
}

export function TitleBar(props: TitleBarProps): ReactElement {
  const { title, status, online, waiting, compact = false } = props;
  const sync = syncLabel(online, waiting);
  const { element, show } = useMenu();
  const toneColor = sync.tone === "offline" ? "var(--warn)" : sync.tone === "busy" ? "var(--accent)" : "var(--ok)";
  return (
    <View testID="shell-titlebar" style={styles.bar}>
      <View accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.mid}>
        {status === null ? (
          <Text testID="title-text" numberOfLines={1} style={styles.title}>{title}</Text>
        ) : (
          <View style={styles.statusRow} testID="title-status">
            <Text numberOfLines={1} style={[styles.title, styles.statusText]}>{status.text}</Text>
            {status.undo ? (
              <Pressable role="button" testID="title-undo" aria-label="Undo" onPress={props.onUndo}><Text style={styles.undo}>Undo</Text></Pressable>
            ) : null}
          </View>
        )}
      </View>
      {props.call ? <View testID="title-call" style={styles.call}>{props.call}</View> : null}
      <Chip
        testID="title-sync"
        label={sync.text}
        hideLabel={compact && sync.tone === "ok"}
        onPress={sync.opens ? props.onOpenWaiting : undefined}
        lead={<View style={[styles.sdot, { backgroundColor: toneColor as string }]} />}
      />
      <Chip
        testID="title-search"
        label="Search"
        hideLabel={compact}
        hint={compact ? undefined : "⌘K"}
        onPress={props.onSearch}
        lead={<ShellIcon name="search" size={15} color="var(--ink-2)" />}
        title="Search everything (Cmd-K)"
      />
      <Chip
        testID="title-skin"
        label={skinName(props.skin)}
        hideLabel={compact}
        onPress={(x, y) => show(skinMenuEntries(props.skin, props.onSkin), x, y, "other", { label: "Skin" })}
        lead={null}
        tail={<ShellIcon name="chev" size={10} color="var(--ink-4)" />}
        title="Skin, just for you in this Space"
      />
      {element}
    </View>
  );
}

interface ChipProps {
  testID: string;
  label: string;
  hideLabel?: boolean;
  hint?: string | undefined;
  lead: ReactElement | null;
  tail?: ReactElement;
  title?: string;
  onPress: ((x: number, y: number) => void) | undefined;
}

function Chip({ testID, label, hideLabel = false, hint, lead, tail, title, onPress }: ChipProps): ReactElement {
  const [over, setOver] = useState(false);
  const live = onPress !== undefined;
  return (
    <Pressable
      role="button"
      aria-label={label}
      testID={testID}
      disabled={!live}
      onPress={(e) => {
        if (onPress === undefined) return;
        const ev = e as unknown as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } }; nativeEvent?: { pageX?: number; pageY?: number } };
        const box = ev.currentTarget?.getBoundingClientRect?.();
        onPress(box ? box.left : ev.nativeEvent?.pageX ?? 0, box ? box.bottom + 4 : ev.nativeEvent?.pageY ?? 0);
      }}
      onHoverIn={() => setOver(true)}
      onHoverOut={() => setOver(false)}
      style={[styles.chip, over && live ? styles.chipOver : null]}
      {...(Platform.OS === "web" && title !== undefined ? { title } : {})}
    >
      {lead}
      {hideLabel ? null : <Text numberOfLines={1} style={styles.chipText}>{label}</Text>}
      {hint === undefined || hideLabel ? null : <Text style={styles.kbd}>{hint}</Text>}
      {tail}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  call: { marginRight: 8, justifyContent: "center" },
  bar: { height: TITLE_BAR_HEIGHT, flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 14, paddingRight: 10, backgroundColor: "var(--rail)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  mid: { flex: 1, minWidth: 0, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusText: { color: "var(--ink)" as string },
  undo: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  chip: { height: 26, paddingHorizontal: 9, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  chipOver: { backgroundColor: "var(--hover)" as string },
  chipText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  kbd: { fontSize: 10.5, fontWeight: "500", color: "var(--ink-4)" as string, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: "var(--line-2)" as string },
  sdot: { width: 6, height: 6, borderRadius: 3 },
});
