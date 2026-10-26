// The staged-writes banner of a folder an agent writes into with review on (spec 3.5, 2.16): "Docs staged 3 writes here. Nothing is saved until you approve." with Review (opens the change
// set in the shell's review surface) and Approve (changesets.approve for every open change set of the folder). It reads changesets.list for the open folder.
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { useFilesData, useLive } from "../tree/data.tsx";

export interface Staged { changesetId: string; by: string; fileCount: number }

/** The words of the banner: who staged how many writes. Several change sets from one agent read as one total. */
export function stagedText(who: string, writes: number): string {
  return `${who} staged ${writes} ${writes === 1 ? "write" : "writes"} here. Nothing is saved until you approve.`;
}

/** Approve: every open change set of the folder goes through changesets.approve. */
export function approveStaged(call: (cap: string, input: unknown) => Promise<unknown>, open: readonly Staged[]): Promise<unknown[]> {
  return Promise.all(open.map((c) => call("changesets.approve", { changesetId: c.changesetId })));
}

export function StagedBanner({ folderId }: { folderId: string }): ReactElement | null {
  const data = useFilesData();
  const q = useLive("changesets.list", { folderId, state: "open" });
  if (q.status !== "ready" || q.data.changesets.length === 0) return null;
  const open: Staged[] = q.data.changesets.map((c) => ({ changesetId: c.changesetId, by: c.by, fileCount: c.fileCount }));
  const first = open[0] as Staged;
  const who = data.nameOf(first.by);
  const writes = open.reduce((n, c) => n + c.fileCount, 0);
  const approve = (): void => { void approveStaged(data.call, open); };
  return (
    <View style={s.bar} accessibilityRole="alert" testID="staged-banner">
      <View style={s.dot} aria-hidden />
      <Avatar name={who} kind="agent" size={18} testID="staged-face" />
      <Text numberOfLines={1} style={s.text} testID="staged-text">{stagedText(who, writes)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Review the staged writes" testID="staged-review" onPress={() => data.nav.reviewChanges?.(first.changesetId)} style={({ hovered }: { hovered?: boolean }) => [s.btn, hovered === true && s.over]}>
        <Text style={s.btnText}>Review</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Approve the staged writes" testID="staged-approve" onPress={approve} style={({ hovered }: { hovered?: boolean }) => [s.btn, s.pri, hovered === true && s.priOver]}>
        <Text style={[s.btnText, s.priText]}>Approve</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingVertical: 6, backgroundColor: "var(--sunk)" as string, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "var(--warn)" as string, flexShrink: 0 },
  text: { flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--ink-2)" as string },
  btn: { height: 26, paddingHorizontal: 10, borderRadius: 7, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  over: { backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  pri: { backgroundColor: "var(--accent)" as string },
  priOver: { opacity: 0.9 },
  priText: { color: "var(--accent-ink)" as string, fontWeight: "600" },
});
