// Artifacts, at the top of Chats: everything a model made to show you, as a grid of the same cards a chat shows. A quiet search, a Mine / Shared with me / All menu, newest update first. A card
// opens the artifact in its own tab (the sidebar stays). Nothing here is a place of its own: the Apps place no longer shows artifacts.
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ARTIFACT_FILTERS, ArtifactCard, emptyLine, filterArtifacts, linkOf } from "../../../../../../ui/src/ArtifactCard/index.tsx";
import type { ArtifactFilter, ArtifactInfo } from "../../../../../../ui/src/ArtifactCard/index.tsx";
import { useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { nameLookup } from "../../../shell/providers/records-live.ts";
import { LIST_PAGE } from "./ThreadsPage.tsx";

type Row = CapMap["sites.list"]["out"]["sites"][number];
let seq = 0;

const infoOf = (a: Row): ArtifactInfo => ({ id: a.siteId, name: a.name, owner: a.owner, access: a.access, updatedAt: a.updatedAt, thumb: undefined, from: undefined, sharedWith: undefined });

export function ArtifactsPage({ rt }: { rt: ShellRuntime }): ReactElement {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [filter, setFilter] = useState<ArtifactFilter>("Mine");
  const [q, setQ] = useState("");
  const { element, show } = useMenu();
  const nameOf = useMemo(() => nameLookup(rt), [rt]);
  const load = useCallback((): (() => void) => {
    let live = true;
    void Promise.resolve(rt.call("sites.list", { kind: "artifact" })).then((o) => { if (live) setRows((o as CapMap["sites.list"]["out"]).sites); }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [rt]);
  useEffect(() => load(), [load]);
  const infos = useMemo(() => (rows ?? []).map(infoOf), [rows]);
  const shown = useMemo(() => filterArtifacts(infos, filter, q, rt.me.id), [infos, filter, q, rt.me.id]);
  const now = rt.clock().now;
  const open = (id: string, share = false): void => rt.open({ subject: { type: "artifact", id }, ...(share ? { args: { share: "1" } } : {}) });
  const address = (id: string): Promise<string> => Promise.resolve(rt.call("sites.artifact_open", { artifactId: id, idempotencyKey: `card-${id}-${rt.clock().now}-${++seq}` })).then((o) => linkOf(o as { path: string; url?: string }, rt.baseUrl));
  const pickFilter = (): void => {
    const doc = (globalThis as { document?: { activeElement?: { getBoundingClientRect?: () => { left: number; bottom: number } } | null } }).document;
    const box = doc?.activeElement?.getBoundingClientRect?.();
    show(ARTIFACT_FILTERS.map((f) => ({ label: `${f === filter ? "✓ " : " "}${f}`, onSelect: () => setFilter(f) })), box?.left ?? 8, box ? box.bottom + 4 : 48, "other", { label: "Show" });
  };
  const empty = rows !== null && shown.length === 0;
  return (
    <ScrollView testID="artifacts-page" style={LIST_PAGE.root} contentContainerStyle={LIST_PAGE.content}>
      <View style={st.col}>
        <Text accessibilityRole="header" aria-level={1} style={st.title}>Artifacts</Text>
        <View style={st.bar}>
          <TextInput testID="artifacts-search" accessibilityLabel="Search artifacts" placeholder="Search" placeholderTextColor="var(--ink-3)" value={q} onChangeText={setQ} editable={infos.length > 0} style={st.search} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Show: ${filter}`} testID="artifacts-filter" onPress={pickFilter} style={({ hovered }: { hovered?: boolean }) => [st.filter, hovered === true && st.hover]}><Text style={st.filterText}>{`${filter} ›`}</Text></Pressable>
        </View>
        {empty ? (
          <View testID="artifacts-empty" style={st.empty}>
            <Text style={st.emptyTitle}>{emptyLine(filter, q, infos.length > 0)}</Text>
            {infos.length === 0 ? <><Text style={st.emptyLine}>Pages, dashboards and apps your agents publish show up here.</Text>
              <Pressable accessibilityRole="button" testID="artifacts-example" onPress={() => rt.open({ screen: "chats.ask", args: { with: "assistant", first: "Make a one page pricing comparison and publish it" } })} style={({ hovered }: { hovered?: boolean }) => [st.example, hovered === true && st.hover]}><Text style={st.exampleText}>{"Try: “Make a one page pricing comparison and publish it”"}</Text></Pressable></> : null}
          </View>
        ) : (
          <View testID="artifacts-grid" style={st.grid}>
            {shown.map((a) => (
              <View key={a.id} style={st.cell}>
                <ArtifactCard
                  grid info={a} meId={rt.me.id} now={now} nameOf={nameOf}
                  onOpen={() => open(a.id)} onShare={() => open(a.id, true)}
                  onCopyLink={() => void address(a.id).then((u) => { void (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard?.writeText?.(u); }, () => undefined)}
                  onBrowser={() => void address(a.id).then((u) => rt.openUrl(u), () => undefined)}
                  onDelete={a.owner === rt.me.id ? () => void Promise.resolve(rt.call("sites.delete", { siteId: a.id })).then(() => load(), () => undefined) : undefined}
                  onFrom={(chatId) => rt.open({ subject: { type: "thread", id: chatId } })}
                />
              </View>
            ))}
          </View>
        )}
      </View>
      {element}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  col: { width: "100%", maxWidth: 1040, paddingHorizontal: 8 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: "600", letterSpacing: -0.5, color: "var(--ink)" as string, marginBottom: 14 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  search: { flex: 1, maxWidth: 320, height: 32, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, color: "var(--ink)" as string, fontSize: 13.5 },
  filter: { height: 32, paddingHorizontal: 10, borderRadius: 10, justifyContent: "center" },
  filterText: { fontSize: 13, color: "var(--ink-3)" as string },
  hover: { backgroundColor: "var(--hover)" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cell: { flexGrow: 1, flexShrink: 1, flexBasis: 340, minWidth: 280 },
  empty: { alignItems: "center", gap: 6, paddingTop: 72, paddingBottom: 40 },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  emptyLine: { fontSize: 13.5, color: "var(--ink-3)" as string },
  example: { marginTop: 14, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 11, borderWidth: 1, borderColor: "var(--line-2)" as string },
  exampleText: { fontSize: 13, color: "var(--ink-2)" as string },
});
