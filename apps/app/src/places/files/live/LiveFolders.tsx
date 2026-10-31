// Live folders (rc.8): the Files view that lists every mount with its source logo, live or last synced, lag, conflicts, who can see it, and the buttons that mend or move it. Reads and writes go through
// `data`, which the shell fills; the places's own rows are ui/Row. Empty: a quiet line and the Connect a folder button. Error: a retry.
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Mark } from "../mounts/icons.tsx";
import type { MarkKind } from "../mounts/icons.tsx";
import { ACTION_LABEL, orderRows, summaryLine } from "./model.ts";
import type { LiveAction, LiveRow } from "./model.ts";

export interface LiveFoldersProps {
  /** null while loading; "error" when the read failed. */
  rows: readonly LiveRow[] | null | "error";
  busy: ReadonlySet<string>;
  /** A short line after an action ("Sync started"), or null. */
  said: string | null;
  onAction(row: LiveRow, action: LiveAction): void;
  onConnect(): void;
  onRetry(): void;
}

const markOf = (k: LiveRow["kind"]): MarkKind => (k === "google_drive" ? "google_drive" : k);
const TONE = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--danger)", quiet: "var(--ink-3)" } as const;

export function LiveFolders({ rows, busy, said, onAction, onConnect, onRetry }: LiveFoldersProps): ReactElement {
  const menu = useMenu();
  // On a phone the row is the state and the line; a press opens every action in a menu (there is no room for buttons beside the words)
  const width = useWindowDimensions().width;
  const narrow = width > 0 && width < 560;
  if (rows === null) return <View testID="live-loading" style={st.root}><Text style={st.quiet}>Loading</Text></View>;
  if (rows === "error") {
    return (
      <View testID="live-error" style={st.center}>
        <Text style={st.title}>Could not read your folders.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" testID="live-retry" onPress={onRetry} style={st.btn}><Text style={st.btnText}>Try again</Text></Pressable>
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View testID="live-empty" style={st.center}>
        <Text style={st.title}>No live folders yet</Text>
        <Text style={st.quiet}>Connect Google Drive, OneDrive, SharePoint or GitHub and it stays up to date here.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Connect a folder" testID="live-connect" onPress={onConnect} style={[st.btn, st.btnPrimary]}><Text style={st.btnPrimaryText}>Connect a folder</Text></Pressable>
      </View>
    );
  }
  const list = orderRows(rows);
  const more = (r: LiveRow, e: unknown): void => {
    const box = (e as { currentTarget?: { getBoundingClientRect?: () => { left: number; bottom: number } } }).currentTarget?.getBoundingClientRect?.();
    const entries: MenuEntry[] = (narrow ? r.actions : r.actions.slice(1)).map((a) => ({ label: ACTION_LABEL[a], onSelect: () => onAction(r, a) }));
    menu.show(entries, box?.left ?? 0, (box?.bottom ?? 0) + 4, "other", { label: r.name });
  };
  return (
    <View testID="live-folders" style={st.root}>
      <View style={st.head}>
        <Text style={st.heading}>Live folders</Text>
        <Text testID="live-summary" style={st.quiet}>{said ?? summaryLine(rows)}</Text>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Connect a folder" testID="live-connect" onPress={onConnect} style={st.btn}><Text style={st.btnText}>Connect a folder</Text></Pressable>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {/* ui-rows-lint: not a list (the mounts of the Space, a handful of rows) */}
        {list.map((r) => {
          const first = r.actions[0];
          return (
            <Row
              key={r.mountId} id={`live:${r.mountId}`} title={r.name} tall
              note={[r.provider, r.detail, r.who].filter((x) => x !== "").join(" · ")}
              leading={<View style={st.lead}><Mark kind={markOf(r.kind)} size={24} /></View>}
              trailing={(
                <View style={st.trail}>
                  <View style={[st.dot, { backgroundColor: TONE[r.tone] }]} />
                  <Text testID={`live-state-${r.mountId}`} style={[st.state, { color: TONE[r.tone] }]}>{r.state}</Text>
                  {first && !narrow ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`${ACTION_LABEL[first]} ${r.name}`} testID={`live-act-${r.mountId}`} disabled={busy.has(r.mountId)} onPress={() => onAction(r, first)} style={[st.btn, busy.has(r.mountId) && { opacity: 0.5 }]}>
                      <Text style={st.btnText}>{ACTION_LABEL[first]}</Text>
                    </Pressable>
                  ) : null}
                  {r.actions.length > 1 && !narrow ? (
                    <Pressable accessibilityRole="button" accessibilityLabel={`More for ${r.name}`} testID={`live-more-${r.mountId}`} onPress={(e) => more(r, e)} style={st.btn}><Text style={st.btnText}>{"…"}</Text></Pressable>
                  ) : null}
                </View>
              )}
              onPress={(e) => (narrow ? more(r, e) : onAction(r, "open"))}
            />
          );
        })}
      </ScrollView>
      {menu.element}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, flexWrap: "wrap" },
  heading: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  quiet: { fontSize: 12.5, color: "var(--ink-3)" as string, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { fontSize: 15, fontWeight: "600", color: "var(--ink)" as string },
  lead: { width: 28, alignItems: "center", justifyContent: "center" },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  state: { fontSize: 12.5 },
  btn: { minHeight: 28, paddingHorizontal: 10, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 12.5, color: "var(--accent)" as string },
  btnPrimary: { backgroundColor: "var(--accent)" as string, paddingHorizontal: 14, minHeight: 34 },
  btnPrimaryText: { fontSize: 13.5, fontWeight: "600", color: "var(--accent-ink)" as string },
});
