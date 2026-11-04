// A live block on the Overview: the project's real data, read when the page is shown and through the reader's own access (what they may not open is counted, never listed). The block stores only its
// settings; this draws them as a list, a table, cards or a count. The Edit button opens the block's settings; the menu removes it.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMenu } from "../../../../../../../ui/src/Menu/index.tsx";
import { useProjectPageData } from "../data.tsx";
import { countLine, hiddenLine, kindOf, liveReady, liveTitle } from "./model.ts";
import type { LiveOut, LiveRowOut, View as LiveView } from "./model.ts";

export interface LiveAttrs { blockId: string | null; type: string; spec: unknown; view: string }
export interface LiveApi { update(patch: { type?: string; spec?: unknown; view?: string }): void; remove(): void }

const STATE_TONE: Readonly<Record<string, string>> = { done: "var(--ok)", succeeded: "var(--ok)", success: "var(--ok)", on_track: "var(--ok)", late: "var(--danger)", failed: "var(--danger)", blocked: "var(--danger)", at_risk: "var(--warn)", waiting: "var(--warn)" };
const wordOf = (s: string | undefined): string => (s ?? "").replace(/_/g, " ");

/** The data of one live block; null while it loads, "error" when it could not be read. */
export function useLive(projectId: string, a: Pick<LiveAttrs, "type" | "spec">, key: number): LiveOut | "error" | null {
  const d = useProjectPageData();
  const [out, setOut] = useState<LiveOut | "error" | null>(null);
  const specKey = JSON.stringify(a.spec);
  useEffect(() => {
    if (!liveReady(a.type, a.spec)) { setOut(null); return; }
    let live = true;
    void Promise.resolve(d.call("projects.live_block.query", { projectId, type: a.type, spec: a.spec ?? {} })).then((o) => { if (live) setOut(o as LiveOut); }, () => { if (live) setOut("error"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the spec is compared by value
  }, [d, projectId, a.type, specKey, key]);
  return out;
}

function Rows({ rows, view, open }: { rows: readonly LiveRowOut[]; view: LiveView; open(r: LiveRowOut): void }): ReactElement {
  if (view === "table") {
    return (
      <View testID="live-table" accessibilityRole="table" style={s.table}>
        {rows.map((r) => (
          <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.title} testID={`live-row-${r.id}`} onPress={() => open(r)} style={({ hovered }: { hovered?: boolean }) => [s.trow, hovered === true && s.over]}>
            <Text numberOfLines={1} style={[s.cell, s.cellTitle]}>{r.title}</Text>
            <Text numberOfLines={1} style={[s.cell, s.cellState]}>{wordOf(r.state)}</Text>
            <Text numberOfLines={1} style={[s.cell, s.cellDetail]}>{r.detail ?? ""}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  if (view === "cards") {
    return (
      <View testID="live-cards" style={s.cards}>
        {rows.map((r) => (
          <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.title} testID={`live-row-${r.id}`} onPress={() => open(r)} style={({ hovered }: { hovered?: boolean }) => [s.card, hovered === true && s.over]}>
            <Text numberOfLines={2} style={s.cardTitle}>{r.title}</Text>
            {r.state || r.detail ? <Text numberOfLines={1} style={s.cardNote}>{[wordOf(r.state), r.detail].filter(Boolean).join(" · ")}</Text> : null}
          </Pressable>
        ))}
      </View>
    );
  }
  return (
    <View testID="live-list">
      {rows.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.title} testID={`live-row-${r.id}`} onPress={() => open(r)} style={({ hovered }: { hovered?: boolean }) => [s.lrow, hovered === true && s.over]}>
          <View style={[s.dot, { backgroundColor: STATE_TONE[r.state ?? ""] ?? "var(--ink-4)" }]} />
          <Text numberOfLines={1} style={s.lrowTitle}>{r.title}</Text>
          {r.state ? <Text style={s.lrowState}>{wordOf(r.state)}</Text> : null}
          {r.detail ? <Text numberOfLines={1} style={s.lrowDetail}>{r.detail}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** What a press on a row opens: its page, a link's address, or nothing the page knows how to open. */
export function useOpenRow(projectId: string, type: string): (r: LiveRowOut) => void {
  const d = useProjectPageData();
  return (r) => {
    if (r.url) { if (/^https?:/i.test(r.url)) (globalThis as { open?: (u: string, t: string) => void }).open?.(r.url, "_blank"); else if (r.url.startsWith("/goals/")) d.nav.openGoal?.(r.url.slice(7)); return; }
    if (type === "tasks" || type === "milestones") d.nav.openRecord("task", r.id);
    else if (type === "records") d.nav.openRecord("record", r.id);
    void projectId;
  };
}

export function LiveBlockView({ projectId, attrs, readOnly, api, fresh = false, reload = 0, onSettings }: { projectId: string; attrs: LiveAttrs; readOnly: boolean; api: LiveApi; fresh?: boolean; reload?: number; onSettings(a: LiveAttrs): void }): ReactElement {
  const menu = useMenu();
  const kind = kindOf(attrs.type);
  const out = useLive(projectId, attrs, reload);
  const open = useOpenRow(projectId, attrs.type);
  const view = (attrs.view || kind?.defaultView || "list") as LiveView;
  const title = liveTitle(attrs.type, attrs.spec);
  const ready = liveReady(attrs.type, attrs.spec);
  let body: ReactElement;
  if (kind === undefined) body = <Text testID="live-unknown" style={s.dim}>This block (&quot;{attrs.type}&quot;) is kept as written. This version of Vyre cannot draw it.</Text>;
  else if (!ready) body = <Text testID="live-setup" style={s.dim}>Choose what this shows{readOnly ? "." : ": press Edit."}</Text>;
  else if (out === null) body = <View testID="live-loading" style={s.skel} />;
  else if (out === "error") body = <Text testID="live-error" style={s.dim}>This could not be read just now.</Text>;
  else if (attrs.type === "metric" || view === "count") {
    const n = attrs.type === "metric" ? out.value ?? 0 : out.total;
    body = <View style={s.metric}><Text testID="live-number" style={s.metricN}>{new Intl.NumberFormat("en-US").format(n)}</Text><Text style={s.metricL}>{attrs.type === "metric" ? out.label ?? title : out.hidden > 0 ? `${out.hidden} you can't open` : ""}</Text></View>;
  } else {
    body = (
      <View>
        {out.rows.length === 0 ? <Text testID="live-empty" style={s.dim}>Nothing here yet.</Text> : <Rows rows={out.rows} view={view} open={open} />}
        {out.hidden > 0 ? <Text testID="live-hidden" style={s.hidden}>{hiddenLine(out.hidden)}</Text> : null}
      </View>
    );
  }
  const live = out !== null && out !== "error" ? countLine(out, "row") : "";
  return (
    <View testID={`live-${attrs.type}`} accessibilityLabel={`${title}, live`} style={[s.box, fresh && s.fresh]} {...({ dataSet: { live: attrs.blockId ?? "" } } as object)}>
      <View style={s.head}>
        <Text style={s.title}>{title}</Text>
        <View style={s.liveDot} /><Text testID="live-tag" style={s.tag}>{live ? `Live · ${live}` : "Live"}</Text>
        <View style={{ flex: 1 }} />
        {!readOnly && kind !== undefined ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${title}`} testID="live-edit" onPress={() => onSettings(attrs)} style={s.btn}><Text style={s.btnText}>Edit</Text></Pressable> : null}
        {!readOnly ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${title} menu`} testID="live-menu" style={s.btn}
            onPress={(e) => {
              const r = (e.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } }).getBoundingClientRect?.();
              menu.show([{ label: "Edit settings", disabled: kind === undefined, onSelect: () => onSettings(attrs) }, { label: "Remove from the page", danger: true, onSelect: () => api.remove() }], r?.left ?? e.nativeEvent.pageX, r?.bottom ?? e.nativeEvent.pageY, "other");
            }}><Text style={s.btnText}>{"⋯"}</Text></Pressable>
        ) : null}
      </View>
      {body}
      {menu.element}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginVertical: 6, backgroundColor: "var(--raised)" as string },
  fresh: { backgroundColor: "var(--accent-wash)" as string, borderColor: "var(--accent-line)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, marginBottom: 4 },
  title: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ok)" as string },
  tag: { fontSize: 12, color: "var(--ink-3)" as string, flexShrink: 1 },
  btn: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  dim: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 4 },
  hidden: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingTop: 6 },
  skel: { height: 44, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  lrow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, paddingHorizontal: 6, borderRadius: 7 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  lrowTitle: { fontSize: 13.5, color: "var(--ink)" as string, flexShrink: 1 },
  lrowState: { fontSize: 12, color: "var(--ink-3)" as string },
  lrowDetail: { fontSize: 12, color: "var(--ink-3)" as string, marginLeft: "auto" as never },
  table: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  trow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, paddingHorizontal: 4 },
  cell: { fontSize: 13, color: "var(--ink-2)" as string },
  cellTitle: { flex: 3, color: "var(--ink)" as string },
  cellState: { flex: 1.2, color: "var(--ink-3)" as string },
  cellDetail: { flex: 1.6, color: "var(--ink-3)" as string },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { minWidth: 160, flexGrow: 1, flexBasis: 160, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, padding: 10, gap: 3 },
  cardTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  cardNote: { fontSize: 12, color: "var(--ink-3)" as string },
  metric: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 4 },
  metricN: { fontSize: 30, fontWeight: "600", color: "var(--ink)" as string },
  metricL: { fontSize: 13.5, color: "var(--ink-2)" as string },
});
