// A live block on the Overview: the project's real data, read when the page is shown and through the reader's own access (what they may not open is counted, never listed). It sits on the page with
// no card around it: its title, then its rows. A strip with what it shows, Edit and a menu appears on hover or focus (always on a phone, which has no hover, where what it shows is in the Edit sheet).
// The block stores only its settings; this draws them as a list, a table, cards or a count.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Avatar } from "../../../../../../../ui/src/Avatar/index.tsx";
import { MenuIcon, useMenu } from "../../../../../../../ui/src/Menu/index.tsx";
import { StatusMark } from "../../../../../../../ui/src/Plan/parts.tsx";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { injectCss } from "../../../../../../../ui/src/theme/css.ts";
import { useProjectPageData } from "../data.tsx";
import { dueWords, hiddenLine, kindOf, liveDescription, liveReady, liveTitle, metricLine, planStatus, stateTone } from "./model.ts";
import type { LiveOut, LiveRowOut, TypeName, View as LiveView } from "./model.ts";

export interface LiveAttrs { blockId: string | null; type: string; spec: unknown; view: string }
export interface LiveApi { update(patch: { type?: string; spec?: unknown; view?: string }): void; remove(): void }

const TONE: Readonly<Record<"bad" | "good" | "plain", string>> = { bad: "var(--warn)", good: "var(--ok)", plain: "var(--ink-3)" };
const wordOf = (s: string | undefined): string => { const w = (s ?? "").replace(/_/g, " "); return w === "" ? "" : w.charAt(0).toUpperCase() + w.slice(1); };

// the strip shows on hover or focus; a phone has neither, so it is always on there
const CSS = "[data-lb] [data-lb-tools]{opacity:0;transition:opacity 120ms}[data-lb]:hover [data-lb-tools],[data-lb]:focus-within [data-lb-tools]{opacity:1}";
let cssDone = false;
function ensureCss(): void {
  if (cssDone) return;
  const d = (globalThis as { document?: Parameters<typeof injectCss>[0] }).document;
  if (!d || !d.head) return;
  injectCss(d, "vyre-live-block", CSS);
  cssDone = true;
}

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

/** The currency of a field of a record type, when it is a currency field ("USD"); undefined for any other field. */
function useCurrency(type: unknown, field: unknown, on: boolean): string | undefined {
  const d = useProjectPageData();
  const [code, setCode] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!on || typeof type !== "string" || typeof field !== "string" || type === "" || field === "") return;
    let live = true;
    void Promise.resolve(d.call("schema.types.get", { type })).then((o) => {
      const f = ((o as { type?: { fields?: { key: string; type: string; options?: Record<string, unknown> }[] } }).type?.fields ?? []).find((x) => x.key === field);
      if (live && f && f.type === "currency") setCode(typeof f.options?.["currency"] === "string" ? String(f.options["currency"]) : "USD");
    }, () => undefined);
    return () => { live = false; };
  }, [d, type, field, on]);
  return code;
}

/** What a press on a row opens: its page, a link's address, or nothing the page knows how to open. */
export function useOpenRow(): (r: LiveRowOut) => void {
  const d = useProjectPageData();
  return (r) => {
    const u = r.url ?? "";
    if (/^https?:/i.test(u)) { (globalThis as { open?: (u: string, t: string) => void }).open?.(u, "_blank"); return; }
    if (u.startsWith("/goals/")) { d.nav.openGoal?.(u.slice(7)); return; }
    if (u.startsWith("/tasks/")) { d.nav.openRecord("task", u.slice(7)); return; }
    if (u === "") d.nav.openRecord("record", r.id);
  };
}

function TaskRows({ rows, now, open }: { rows: readonly LiveRowOut[]; now: number; open(r: LiveRowOut): void }): ReactElement {
  const d = useProjectPageData();
  return (
    <View testID="live-list">
      {rows.map((r) => {
        const due = dueWords(r.due, r.state, now);
        return (
          <Row key={r.id} id={`live-${r.id}`} title={r.title} leading={<StatusMark status={planStatus(r.state)} size={15} />} onPress={() => open(r)}
            trailing={<View style={s.trail}>{due ? <Text style={[s.due, due.late && s.late]}>{due.text}</Text> : null}{r.who ? <Avatar name={d.nameOf(r.who)} kind={r.who.startsWith("agt_") ? "agent" : "person"} size={18} /> : null}</View>} />
        );
      })}
    </View>
  );
}

function ItemRows({ rows, open }: { rows: readonly LiveRowOut[]; open(r: LiveRowOut): void }): ReactElement {
  return (
    <View testID="live-list">
      {rows.map((r) => (
        <Row key={r.id} id={`live-${r.id}`} title={r.title} {...(r.detail ? { note: r.detail } : {})} leading={<MenuIcon icon="link" size={14} color="var(--ink-3)" />} onPress={() => open(r)}
          trailing={r.state ? <Text style={[s.stateText, { color: TONE[stateTone(r.state)] }]}>{wordOf(r.state)}</Text> : undefined} />
      ))}
    </View>
  );
}

function Rows({ type, rows, view, now, open }: { type: string; rows: readonly LiveRowOut[]; view: LiveView; now: number; open(r: LiveRowOut): void }): ReactElement {
  if (view === "table") {
    return (
      <View testID="live-table" accessibilityRole="table" style={s.table}>
        {/* ui-rows-lint: not a list (the rows of a table, with columns) */}
        {rows.map((r) => (
          <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.title} testID={`live-row-${r.id}`} onPress={() => open(r)} style={({ hovered }: { hovered?: boolean }) => [s.trow, hovered === true && s.over]}>
            <Text numberOfLines={1} style={[s.cell, s.cellTitle]}>{r.title}</Text>
            <Text numberOfLines={1} style={[s.cell, s.cellDetail]}>{r.detail ?? ""}</Text>
            <Text numberOfLines={1} style={[s.cell, s.cellState, { color: TONE[stateTone(r.state)] }]}>{wordOf(r.state)}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  if (view === "cards") {
    return (
      <View testID="live-cards" style={s.cards}>
        {/* ui-rows-lint: not a list (cards in a grid) */}
        {rows.map((r) => (
          <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={r.title} testID={`live-row-${r.id}`} onPress={() => open(r)} style={({ hovered }: { hovered?: boolean }) => [s.card, hovered === true && s.over]}>
            <Text numberOfLines={2} style={s.cardTitle}>{r.title}</Text>
            {r.state || r.detail ? <Text numberOfLines={1} style={[s.cardNote, { color: TONE[stateTone(r.state)] }]}>{[wordOf(r.state), r.detail].filter(Boolean).join(" · ")}</Text> : null}
          </Pressable>
        ))}
      </View>
    );
  }
  return type === "tasks" || type === "milestones" ? <TaskRows rows={rows} now={now} open={open} /> : <ItemRows rows={rows} open={open} />;
}

export function LiveBlockView({ projectId, attrs, readOnly, api, fresh = false, reload = 0, types = [], onSettings }: { projectId: string; attrs: LiveAttrs; readOnly: boolean; api: LiveApi; fresh?: boolean; reload?: number; types?: readonly TypeName[]; onSettings(a: LiveAttrs): void }): ReactElement {
  ensureCss();
  const d = useProjectPageData();
  const menu = useMenu();
  // the quiet highlight after an agent's edit fades by itself
  const [lit, setLit] = useState(fresh);
  useEffect(() => { if (!fresh) return undefined; setLit(true); const id = setTimeout(() => setLit(false), 6000); return () => clearTimeout(id); }, [fresh]);
  const w = useWindowDimensions().width;
  const phone = w > 0 && w < 700;
  const kind = kindOf(attrs.type);
  const out = useLive(projectId, attrs, reload);
  const open = useOpenRow();
  const view = (attrs.view || kind?.defaultView || "list") as LiveView;
  const title = liveTitle(attrs.type, attrs.spec);
  const ready = liveReady(attrs.type, attrs.spec);
  const spec = (attrs.spec ?? {}) as Record<string, unknown>;
  const unit = useCurrency(spec["type"], spec["field"], attrs.type === "metric" && spec["op"] === "sum");
  const noun = types.find((x) => x.key === spec["type"])?.plural ?? "rows";
  let body: ReactElement;
  if (kind === undefined) body = <Text testID="live-unknown" style={s.dim}>This block (&quot;{attrs.type}&quot;) is kept as written. This version of Vyre cannot draw it.</Text>;
  else if (!ready) body = <Text testID="live-setup" style={s.dim}>Choose what this shows{readOnly ? "." : ": press Edit."}</Text>;
  else if (out === null) body = <View testID="live-loading" style={s.skel} />;
  else if (out === "error") body = <Text testID="live-error" style={s.dim}>This could not be read just now.</Text>;
  else if (attrs.type === "metric") {
    const m = metricLine({ value: out.value ?? 0, title: out.label ?? title, total: out.total, noun, unit, sum: spec["op"] === "sum" });
    body = <View style={s.metric}><Text testID="live-number" style={s.metricN}>{m.big}</Text><Text testID="live-metric-line" style={s.metricL}>{m.rest}</Text></View>;
  } else if (view === "count") {
    body = <View style={s.metric}><Text testID="live-number" style={s.metricN}>{new Intl.NumberFormat("en-US").format(out.total)}</Text><Text style={s.metricL}>{out.hidden > 0 ? hiddenLine(out.hidden) : ""}</Text></View>;
  } else {
    body = (
      <View>
        {out.rows.length === 0 ? <Text testID="live-empty" style={s.dim}>Nothing here yet.</Text> : <Rows type={attrs.type} rows={out.rows} view={view} now={d.now()} open={open} />}
        {out.hidden > 0 ? <View style={s.hiddenRow} testID="live-hidden"><MenuIcon icon="lock" size={12} color="var(--ink-3)" /><Text style={s.hidden}>{hiddenLine(out.hidden)}</Text></View> : null}
      </View>
    );
  }
  const tools = !readOnly && kind !== undefined;
  return (
    <View testID={`live-${attrs.type}`} accessibilityLabel={`${title}, live`} style={[s.box, lit && s.fresh]} {...(Platform.OS === "web" ? ({ dataSet: { lb: attrs.blockId ?? "1", live: attrs.blockId ?? "" } } as object) : {})}>
      <View style={s.head}>
        <Text style={s.title}>{title}</Text>
        <View style={{ flex: 1 }} />
        <View style={[s.strip, phone && s.stripOn]} {...(Platform.OS === "web" ? ({ dataSet: { lbTools: "1" } } as object) : {})}>
          {!phone ? <Text testID="live-tag" numberOfLines={1} style={s.tag}>{`Live · ${liveDescription(attrs.type, attrs.spec, types)}`}</Text> : null}
          {tools ? <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${title}`} testID="live-edit" onPress={() => onSettings(attrs)} style={s.btn}><Text style={s.btnText}>Edit</Text></Pressable> : null}
          {!readOnly ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`${title} menu`} testID="live-menu" style={s.btn}
              onPress={(e) => {
                const r = (e.currentTarget as unknown as { getBoundingClientRect?(): { left: number; bottom: number } }).getBoundingClientRect?.();
                menu.show([{ label: "Edit settings", disabled: kind === undefined, onSelect: () => onSettings(attrs) }, { label: "Remove from the page", danger: true, onSelect: () => api.remove() }], r?.left ?? e.nativeEvent.pageX, r?.bottom ?? e.nativeEvent.pageY, "other");
              }}><Text style={s.btnText}>{"⋯"}</Text></Pressable>
          ) : null}
        </View>
      </View>
      {body}
      {menu.element}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginVertical: 6, borderRadius: 8 },
  fresh: { backgroundColor: "var(--accent-wash)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28, marginBottom: 2 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  strip: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 },
  stripOn: { opacity: 1 },
  tag: { fontSize: 12, color: "var(--ink-3)", paddingHorizontal: 6, flexShrink: 1 } as object,
  btn: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  btnText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-3)" as string },
  dim: { fontSize: 13, color: "var(--ink-3)" as string, paddingVertical: 4 },
  hiddenRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, paddingHorizontal: 8 },
  hidden: { fontSize: 12.5, color: "var(--ink-3)" as string },
  skel: { height: 44, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  over: { backgroundColor: "var(--hover)" as string },
  trail: { flexDirection: "row", alignItems: "center", gap: 8 },
  due: { fontSize: 12, color: "var(--ink-3)" as string },
  late: { color: "var(--warn)" as string },
  stateText: { fontSize: 12.5 },
  table: { borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  trow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, paddingHorizontal: 4 },
  cell: { fontSize: 13, color: "var(--ink-2)" as string },
  cellTitle: { flex: 3, color: "var(--ink)" as string },
  cellDetail: { flex: 1.6, color: "var(--ink-3)" as string },
  cellState: { flex: 1.2, textAlign: "right" },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { minWidth: 160, flexGrow: 1, flexBasis: 160, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 10, padding: 10, gap: 3 },
  cardTitle: { fontSize: 13.5, color: "var(--ink)" as string },
  cardNote: { fontSize: 12 },
  metric: { flexDirection: "row", alignItems: "baseline", gap: 10, paddingVertical: 4, paddingHorizontal: 8 },
  metricN: { fontSize: 30, fontWeight: "600", color: "var(--ink)" as string },
  metricL: { fontSize: 13.5, color: "var(--ink-2)" as string },
});
