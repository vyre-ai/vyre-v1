// The project Overview tab: a Notion-like page that people and agents both edit. It is the shared Markdown editor (live blocks, a "/" menu to add one), a properties row from the Project record type,
// templates (Client account, Software project, Hiring, and Space-made ones), history with Undo, and a quiet bar when an agent changed the page. The page saves itself a pause after the last edit; a
// page someone else changed meanwhile is not overwritten (the person reloads it). `canEdit` false reads the page, live blocks drawn, with no controls.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { MarkdownEditor, liveBlockNode } from "../../../../../../../ui/src/RichEditor/index.tsx";
import { useAutosavedText } from "../../../../../../../ui/src/RichEditor/useAutosavedText.ts";
import { ProjectPageDataProvider, useProjectPageData } from "../data.tsx";
import { LiveBlockView } from "./LiveBlockView.tsx";
import type { LiveApi, LiveAttrs } from "./LiveBlockView.tsx";
import { PropertiesRow } from "./Properties.tsx";
import type { Facts } from "./Properties.tsx";
import { AddPropertySheet, HistorySheet, LiveSettings, TemplateSheet } from "./Sheets.tsx";
import { LIVE_KINDS, agentNotice, freshIds, kindOf, pageLine, propertyOp, propertyValue, saveFailure } from "./model.ts";
import type { OverviewDoc, PageTemplate } from "./model.ts";

export interface OverviewPageProps { projectId: string; /** The Space's id; the page does not need it, the tab body props carry it. */ space?: string; canEdit: boolean }
type Load = { status: "loading" } | { status: "gone" } | { status: "ready"; doc: OverviewDoc };
const EMPTY: readonly never[] = [];

export function OverviewPage(props: OverviewPageProps): ReactElement {
  const d = useProjectPageData();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [facts, setFacts] = useState<Facts | null>(null);
  const [versions, setVersions] = useState(0);
  const [types, setTypes] = useState<readonly string[]>(EMPTY);
  const read = useCallback(async (): Promise<OverviewDoc | null> => {
    try {
      const doc = (await d.call("projects.overview_doc.get", { projectId: props.projectId })) as OverviewDoc;
      setLoad({ status: "ready", doc });
      return doc;
    } catch { setLoad((cur) => (cur.status === "ready" ? cur : { status: "gone" })); return null; }
  }, [d, props.projectId]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    void Promise.resolve(d.call("projects.overview", { projectId: props.projectId })).then((o) => { const p = (o as { project: Facts }).project; setFacts({ status: p.status, lead: p.lead, start: p.start, due: p.due, health: p.health }); }, () => undefined);
    void Promise.resolve(d.call("projects.overview_doc.history", { projectId: props.projectId, limit: 100 })).then((o) => setVersions((o as { revisions: unknown[] }).revisions.length), () => undefined);
    void Promise.resolve(d.call("schema.types.list", {})).then((o) => setTypes(((o as { types?: { key: string }[] }).types ?? []).map((t) => t.key)), () => undefined);
  }, [d, props.projectId]);
  if (load.status === "loading") return <View testID="overview-loading" style={s.fill}><View style={s.skel} /><View style={[s.skel, { width: "60%" }]} /></View>;
  if (load.status === "gone") return <View testID="overview-gone" style={s.fill}><Text style={s.dim}>The Overview could not be opened. You may not have access to this project.</Text></View>;
  return <Page key={props.projectId} {...props} doc={load.doc} facts={facts} versions={versions} types={types} reload={read} bump={() => setVersions((v) => v + 1)} />;
}

function Page({ projectId, canEdit, doc, facts, versions, types, reload, bump }: OverviewPageProps & { doc: OverviewDoc; facts: Facts | null; versions: number; types: readonly string[]; reload(): Promise<OverviewDoc | null>; bump(): void }): ReactElement {
  const d = useProjectPageData();
  // the revision this page is on: the one it was read at, then each save's own (a re-render must not put it back)
  const rev = useRef(doc.rev);
  const readRev = useRef(doc.rev);
  if (doc.rev !== readRev.current) { readRev.current = doc.rev; rev.current = doc.rev; }
  const [stale, setStale] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { k: "settings"; attrs: LiveAttrs; api: LiveApi } | { k: "history" } | { k: "templates" } | { k: "prop" }>(null);
  const [note, setNote] = useState("");
  const [reloadN, setReloadN] = useState(0);
  const [seen, setSeen] = useState<number | null>(null);
  const [sg, setSg] = useState<string | null>(null);
  const fresh = useMemo(() => freshIds(doc), [doc]);
  const notice = agentNotice(doc.latest, d.me?.id, d.nameOf);

  // the page saves itself; the server's own markdown (with the ids it gave new blocks) comes back and replaces the draft only when nothing was typed meanwhile
  const sent = useRef("");
  const draft = useRef("");
  const ed = useAutosavedText(doc.markdown, async (md) => {
    sent.current = md;
    try {
      const out = (await d.call("projects.overview_doc.save", { projectId, markdown: md, baseRev: rev.current, idempotencyKey: globalThis.crypto.randomUUID() })) as { rev: number };
      rev.current = out.rev;
      bump();
      setStale(null);
      return true;
    } catch (e) { const f = saveFailure(e); if (f.stale) setStale(f.text); return f.text; }
  });
  draft.current = ed.text;

  // the page changed elsewhere (an agent, another person): read it again unless there are unsaved edits here
  useEffect(() => d.changes?.subscribe(() => { if (ed.status === "idle" || ed.status === "saved") void reload().then((n) => { if (n && n.latest && n.latest.rev !== rev.current) setReloadN((x) => x + 1); }); }), [d, ed.status, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const setProperty = async (key: string, text: string): Promise<void> => {
    const def = doc.properties.find((p) => p.key === key);
    try {
      await d.call("projects.overview_edit", { projectId, baseRev: rev.current, ops: [propertyOp(key, propertyValue(def?.type ?? "text", text))], idempotencyKey: globalThis.crypto.randomUUID() });
      await reload(); bump(); setNote(`Set ${def?.title ?? key}`);
    } catch (e) { const f = saveFailure(e); if (f.stale) setStale(f.text); else setNote(f.text); }
  };
  const undo = async (r: number): Promise<void> => {
    try { await d.call("projects.overview_doc.undo", { projectId, rev: r }); await reload(); bump(); setSeen(r); setNote("Undone"); } catch (e) { setNote((e as { message?: string }).message ?? "That could not be undone."); }
  };
  const applyTemplate = async (t: PageTemplate): Promise<void> => {
    try { await d.call("projects.overview_doc.apply_template", { projectId, templateId: t.templateId, baseRev: rev.current, idempotencyKey: globalThis.crypto.randomUUID() }); setSheet(null); await reload(); bump(); setNote(`Started from the ${t.title} template`); } catch (e) { const f = saveFailure(e); setSheet(null); if (f.stale) setStale(f.text); else setNote(f.text); }
  };
  const emptyProps = doc.properties.filter((p) => p.value === null || p.value === undefined || p.value === "");

  const liveView = useCallback((attrs: LiveAttrs, ro: boolean, api: LiveApi): ReactElement => (
    <ProjectPageDataProvider value={d}>
      <LiveBlockView projectId={projectId} attrs={attrs} readOnly={ro || !canEdit} api={api} fresh={attrs.blockId !== null && fresh.has(attrs.blockId)} reload={reloadN} onSettings={(a) => setSheet({ k: "settings", attrs: a, api })} />
    </ProjectPageDataProvider>
  ), [d, projectId, canEdit, fresh, reloadN]);

  const slash = canEdit ? {
    trigger: "/" as const, label: "Insert",
    items: LIVE_KINDS.filter((k) => sg === null || sg === "" || k.label.toLowerCase().includes(sg.toLowerCase()) || "live block".includes(sg.toLowerCase())).map((k) => ({ id: k.type, label: k.label, detail: k.note })),
    onQuery: (q: string | null) => setSg(q),
    insertNode: (it: { id: string }) => { const k = kindOf(it.id); if (!k) return null; const spec = k.spec(); if ((it.id === "records" || it.id === "metric") && types[0]) spec["type"] = types[0]; return liveBlockNode(k.type, spec, k.defaultView); },
  } : undefined;

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.body} testID="project-overview">
      <View style={s.bar}>
        <Text style={s.sub} testID="overview-line">{pageLine(versions)}</Text>
        <View style={{ flex: 1 }} />
        <Text style={s.status} accessibilityLiveRegion="polite" testID="overview-status">{ed.status === "saving" || ed.status === "dirty" ? "Saving…" : ed.status === "saved" ? "Saved" : ""}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="History" testID="overview-history-open" onPress={() => setSheet({ k: "history" })} style={s.tool}><Text style={s.toolText}>History</Text></Pressable>
        {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Template" testID="overview-template-open" onPress={() => setSheet({ k: "templates" })} style={s.tool}><Text style={s.toolText}>Template</Text></Pressable> : null}
      </View>
      <PropertiesRow facts={facts} props={doc.properties} canEdit={canEdit} onSet={(k, t) => void setProperty(k, t)} onAdd={() => setSheet({ k: "prop" })} />
      {notice && seen !== notice.rev ? (
        <View style={s.notice} testID="overview-notice" accessibilityLiveRegion="polite">
          <View style={s.noticeDot} /><Text style={s.noticeText}>{notice.text}</Text>
          {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Undo the agent's edit" testID="overview-notice-undo" onPress={() => void undo(notice.rev)}><Text style={s.undo}>Undo</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="overview-notice-dismiss" onPress={() => setSeen(notice.rev)}><Text style={s.dismiss}>Dismiss</Text></Pressable>
        </View>
      ) : null}
      {stale ? (
        <View style={s.stale} testID="overview-stale" accessibilityRole="alert"><Text style={s.noticeText}>{stale}</Text><Pressable accessibilityRole="button" accessibilityLabel="Reload the page" testID="overview-reload" onPress={() => { setStale(null); void reload(); }}><Text style={s.undo}>Reload</Text></Pressable></View>
      ) : null}
      {note ? <Text style={s.dim} accessibilityLiveRegion="polite" testID="overview-note">{note}</Text> : null}
      <View testID="overview-editor">
        <MarkdownEditor
          key={`${doc.rev}:${reloadN}`} label="Overview" value={ed.text} onChange={ed.edit} mode={canEdit ? "edit" : "read"} bare density="regular" minHeight={260}
          placeholder="Write, or type / to add a live block" liveBlockView={liveView} {...(slash ? { suggest: slash } : {})} onSave={() => void ed.flush()}
        />
      </View>
      {ed.error && !stale ? <Text style={s.err} testID="overview-save-error">{ed.error}</Text> : null}
      {sheet?.k === "settings" ? (
        <LiveSettings attrs={sheet.attrs} onClose={() => setSheet(null)} onSave={(n) => { sheet.api.update({ spec: n.spec, view: n.view }); setSheet(null); setReloadN((x) => x + 1); }} />
      ) : null}
      {sheet?.k === "history" ? <HistorySheet projectId={projectId} now={d.now()} canEdit={canEdit} me={d.me?.id} onUndone={() => { void reload(); bump(); }} onClose={() => setSheet(null)} /> : null}
      {sheet?.k === "templates" ? <TemplateSheet projectId={projectId} canEdit={canEdit} onApply={(t) => void applyTemplate(t)} onSaved={(n) => { setSheet(null); setNote(`Saved the template ${n}`); }} onClose={() => setSheet(null)} /> : null}
      {sheet?.k === "prop" ? <AddPropertySheet options={emptyProps.map((p) => ({ key: p.key, title: p.title }))} onClose={() => setSheet(null)} onPick={(k, v) => { setSheet(null); void setProperty(k, v); }} /> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 60, maxWidth: 820, gap: 8 },
  fill: { padding: 24, gap: 10 },
  skel: { height: 22, borderRadius: 6, backgroundColor: "var(--sunk)" as string, width: "90%" },
  dim: { fontSize: 13, color: "var(--ink-3)" as string },
  bar: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30 },
  sub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  status: { fontSize: 12, color: "var(--ink-3)" as string, marginRight: 4 },
  tool: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  toolText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string },
  noticeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "var(--ok)" as string },
  noticeText: { flex: 1, fontSize: 13, color: "var(--ink-2)" as string },
  undo: { fontSize: 13, fontWeight: "500", color: "var(--accent)" as string },
  dismiss: { fontSize: 13, color: "var(--ink-3)" as string },
  stale: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--warn-wash, var(--sunk))" as string, borderWidth: 1, borderColor: "var(--warn)" as string },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
});
