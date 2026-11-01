// Records > record page (spec 3.4, 2.9, 4.5): a record is a page, not a form. Its title and summary at the top, a completeness ring ("8 of 11" and Ask for these), then the fields in foldable
// sections laid out by the type (two columns on a wide window), every one edited where it stands: click, type, press Enter or leave, and exactly one records.update is written, with Undo inline and no Save
// button. Relations are cards with a peek on hover; a `[[Title]]` in text is a link to that record; the relationships two hops out can be drawn as a map. The right pane has Activity, Comments, Chat,
// Files, Memory and History (the shared History tab). Each person folds sections and keeps fields visible for themselves; the type's layout is the admin's.
import { createElement, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { HistoryTab } from "../../../../../../ui/src/HistoryTab/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { JourneyStepper } from "../journey/JourneyStepper.tsx";
import { isJourneyDef, stageFieldOf } from "../journey/model.ts";
import { useJourneyStages } from "../journey/useStages.ts";
import { stageFieldOf as typeStageField, stagesOf, stagesOn } from "../typeedit/stages.ts";
import { Glyph as Icon } from "../schemamap/icons.tsx";
import { Face, Glyph, pointOf } from "../sidebar/parts.tsx";
import { useOptionalRecordsData } from "../sidebar/data.tsx";
import { useRecordRights } from "../sharing/useRecordAccess.ts";
import { tabsOf, visibleSections, withStages } from "./groups.ts";
import { errorText, savePrefs, saveField, saveValue, sourceOf, undoSave } from "./actions.ts";
import { useLive, useOptionalPageData, usePageData } from "./data.tsx";
import {
  PANE_TABS, RING_R, ago, asksForFields, each, editKind, historyVersions, hueOf, inputText, isEmpty, mapLayout, optionsOf, peekFields, relationIds, relationTarget, resolveLink, ringOf, sectionsOf,
  shownFields, sourceText, splitLinks, toggleFold, valueText,
} from "./model.ts";
import { TabMeasure, useFittedTabs, useTitleWidths } from "../../chats/rightpane/fit.tsx";
import { PANE_CHROME, PANE_TAB_EXTRA } from "../../chats/rightpane/ChatRightPane.tsx";
import { ResizableColumn } from "../../../../../../ui/src/SidePane/resize.tsx";
import { channelFieldToAdd, findContact } from "./askfor.ts";
import { ActivityTab, ChatTab, CommentsTab, EverythingTab, FilesTab } from "../recordpane/index.ts";
import type { FieldDef, PaneKey, RecordRow, RelNode, Section, TypeDef, Undo } from "./model.ts";
import { SealedField } from "./SealedField.tsx";

export interface RecordPageStart {
  /** The relationship map open. */
  map?: boolean;
  /** The right pane open or shut (it opens on a wide window, shuts on a phone), and the tab it starts on. */
  pane?: boolean;
  tab?: PaneKey;
  /** Every empty field shown. */
  all?: boolean;
  /** A field already open for editing, with the text in it. */
  edit?: { key: string; text: string };
}

export interface RecordPageProps { type: string; recordId: string; start?: RecordPageStart }

interface Flash { text: string; undo?: Undo; bad?: boolean }

// ---------------------------------------------------------------- relation cards

/** Fields drawn in the first frame of a record page: none. The header, title and summary paint first; the ring, the sections and the right pane follow in the next frame. The perf traces (runs 40282475958) put 51 ms of a 110 ms navigate in the sections and the floor at 45 ms, so nothing else fits the 50 ms budget. */
const FIRST_FRAME_FIELDS = 0;


export function Peek({ type, recordId }: { type: string; recordId: string }): ReactElement | null {
  const data = usePageData();
  const rq = useLive("records.get", { type, recordId });
  const dq = useLive("schema.describe", { type });
  const def = dq.status === "ready" ? dq.data.types.find((t) => t.key === type) : undefined;
  const row = rq.status === "ready" ? (rq.data.record as RecordRow | undefined) : undefined;
  if (!row || !def) return null;
  const lines: ReactElement[] = [];
  for (const f of peekFields(def, row)) lines.push(<View key={f.key} style={p.peekRow}><Text style={p.peekLabel}>{f.title}</Text><Text numberOfLines={1} style={p.peekValue}>{valueText(f, row.fields[f.key], data.nameOf)}</Text></View>);
  return <View style={p.peek} testID={`peek-${recordId}`} accessibilityRole="summary"><Text numberOfLines={1} style={p.peekTitle}>{String(row.fields[def.titleField] ?? "Untitled")}</Text>{lines}</View>;
}

function RelationCard({ field, id }: { field: FieldDef; id: string }): ReactElement {
  const data = usePageData();
  const target = relationTarget(field) ?? "";
  const rq = useLive("records.get", { type: target, recordId: id });
  const dq = useLive("schema.describe", { type: target });
  const [peek, setPeek] = useState(false);
  const def = dq.status === "ready" ? dq.data.types.find((t) => t.key === target) : undefined;
  const row = rq.status === "ready" ? (rq.data.record as RecordRow | undefined) : undefined;
  const title = row && def ? String(row.fields[def.titleField] ?? "Untitled") : "Loading";
  const hue = hueOf(target);
  return (
    <View style={p.cardWrap}>
      <Pressable
        accessibilityRole="link" accessibilityLabel={`${title}, ${def?.title ?? target}`} testID={`rel-${id}`} onPress={() => data.nav.openRecord(target, id)}
        onHoverIn={() => setPeek(true)} onHoverOut={() => setPeek(false)} onFocus={() => setPeek(true)} onBlur={() => setPeek(false)}
        style={({ hovered }: { hovered?: boolean }) => [p.card, hovered === true && p.cardOver]}
      >
        <View style={[p.tile, { backgroundColor: `hsla(${hue}, 65%, 52%, 0.2)` }]}><Text style={[p.tileText, { color: `hsl(${hue}, 55%, 40%)` }]}>{(def?.title ?? target).slice(0, 1).toUpperCase()}</Text></View>
        <Text numberOfLines={1} style={p.cardText}>{title}</Text>
      </Pressable>
      {peek ? <Peek type={target} recordId={id} /> : null}
    </View>
  );
}

// ---------------------------------------------------------------- one field

function Tag({ field, value }: { field: FieldDef; value: string }): ReactElement {
  const opt = optionsOf(field).find((o) => o.key === value);
  const hue = opt?.color && /^\d+$/.test(opt.color) ? Number(opt.color) : hueOf(value);
  return <View style={[p.tag, { backgroundColor: `hsla(${hue}, 65%, 52%, 0.16)` }]}><Text style={[p.tagText, { color: "var(--ink)" }]}>{opt?.title ?? value}</Text></View>;
}

interface FieldProps {
  field: FieldDef; row: RecordRow; type: string; editing: { key: string; text: string; error?: string } | null; nodes: readonly RelNode[];
  show: (items: readonly MenuEntry[], x: number, y: number) => void; readOnly?: boolean; onEdit: (f: FieldDef) => void; onText: (t: string) => void; onCommit: (f: FieldDef, text: string) => void; onCancel: () => void; onValue: (f: FieldDef, v: unknown) => void; onSource: (f: FieldDef, x: number, y: number) => void;
}

function FieldRow(q: FieldProps): ReactElement {
  const data = usePageData();
  const { field: f, row } = q;
  const v = row.fields[f.key];
  const kind = q.readOnly === true ? "none" : editKind(f);
  const open = q.editing?.key === f.key;
  const trig = menuTrigger((x, y) => q.onSource(f, x, y));
  let body: ReactElement;
  if (open && (kind === "text" || kind === "number" || kind === "money" || kind === "date" || kind === "longtext" || kind === "rating")) {
    body = (
      <View style={p.editWrap}>
        <TextInput
          autoFocus value={q.editing!.text} onChangeText={q.onText} accessibilityLabel={f.title} testID={`edit-${f.key}`} multiline={kind === "longtext"} placeholder={f.title} placeholderTextColor="var(--ink-3)"
          onBlur={() => q.onCommit(f, q.editing!.text)} onSubmitEditing={() => q.onCommit(f, q.editing!.text)}
          onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") q.onCancel(); }}
          style={[p.input, kind === "longtext" && p.inputLong, q.editing!.error ? p.inputBad : null]}
        />
        {q.editing!.error ? <Text style={p.errText} accessibilityRole="alert" testID={`error-${f.key}`}>{q.editing!.error}</Text> : null}
      </View>
    );
  } else if (f.type === "sealed") {
    body = <SealedField field={f} row={row} type={q.type} />;
  } else if (f.type === "relation") {
    const cards: ReactElement[] = [];
    for (const id of relationIds(f, row)) cards.push(<RelationCard key={id} field={f} id={id} />);
    body = <View style={p.cards}>{cards.length > 0 ? cards : <Text style={p.empty}>None</Text>}</View>;
  } else if (f.key === "folder" && typeof v === "string" && v.startsWith("fld_") && open === false) {
    body = <FolderLink folderId={v} type={q.type} recordId={row.id} />;
  } else if (isEmpty(v) && kind !== "checkbox") {
    body = kind === "none" ? <Text style={p.empty}>Empty</Text> : <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${f.title}`} testID={`field-${f.key}`} onPress={(e) => { if (kind === "choice") { const pt = pointOf(e); chooseFrom(f, q, pt.x, pt.y); } else q.onEdit(f); }}><Text style={p.empty}>Empty</Text></Pressable>;
  } else if (kind === "checkbox") {
    body = <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: v === true }} accessibilityLabel={f.title} testID={`field-${f.key}`} onPress={() => q.onValue(f, v !== true)} style={[p.box, v === true && p.boxOn]}>{v === true ? <Glyph name="check" size={11} color="var(--accent-ink)" width={2} /> : null}</Pressable>;
  } else if (kind === "rating") {
    const stars: ReactElement[] = [];
    for (let i = 1; i <= 5; i++) stars.push(<Pressable key={i} accessibilityRole="button" accessibilityLabel={`${i} of 5`} testID={`star-${f.key}-${i}`} onPress={() => q.onValue(f, i === v ? 0 : i)}><Text style={[p.star, typeof v === "number" && i <= v && p.starOn]}>{"★"}</Text></Pressable>);
    body = <View style={p.stars}>{stars}</View>;
  } else if (f.type === "longtext" && typeof v === "string") {
    const pieces = splitLinks(v);
    const kids: ReactElement[] = [];
    pieces.forEach((pc, i) => {
      if ("text" in pc) { kids.push(<Text key={i} style={p.longText}>{pc.text}</Text>); return; }
      const hit = resolveLink(pc.link, q.nodes);
      kids.push(hit
        ? <Text key={i} accessibilityRole="link" testID={`link-${hit.recordId}`} onPress={() => data.nav.openRecord(hit.type, hit.recordId)} style={[p.longText, p.link]}>{pc.link}</Text>
        : <Text key={i} testID="link-unresolved" style={[p.longText, p.linkGone]}>{pc.link}</Text>);
    });
    body = <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${f.title}`} testID={`field-${f.key}`} onPress={() => q.onEdit(f)}><Text>{kids}</Text></Pressable>;
  } else {
    const text = valueText(f, v, data.nameOf);
    const shown = (f.type === "choice" || f.type === "status") && typeof v === "string" ? <Tag field={f} value={v} />
      : f.type === "person" ? <View style={p.person}><Face name={data.nameOf(String(v))} size={18} /><Text numberOfLines={1} style={p.value}>{data.nameOf(String(v))}</Text></View>
      : <Text style={p.value}>{text}</Text>;
    body = <Pressable accessibilityRole={kind === "none" ? "text" : "button"} accessibilityLabel={`${f.title}: ${text}`} testID={`field-${f.key}`} onPress={(e) => { if (kind === "choice") { const pt = pointOf(e); chooseFrom(f, q, pt.x, pt.y); } else if (kind !== "none") q.onEdit(f); }}>{shown}</Pressable>;
  }
  return (
    <View style={p.field} testID={`row-${f.key}`} {...(trig as object)}>
      <Text numberOfLines={1} style={p.label}>{f.title}</Text>
      <View style={p.valueCol}>{body}</View>
    </View>
  );
}

/** The Folder field of a project: the folder's path as a link that opens it in Files. */
function FolderLink({ folderId, type, recordId }: { folderId: string; type: string; recordId: string }): ReactElement {
  const data = usePageData();
  const fq = useLive("files.folder.get", { folderId });
  const label = fq.status === "ready" ? fq.data.folder.path : "Open the folder";
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`Open ${label} in Files`} testID="field-folder-link" onPress={() => data.nav.openFiles(type, recordId)}>
      <Text numberOfLines={1} style={[p.value, p.link]}>{label}</Text>
    </Pressable>
  );
}

/** A choice or status field: its options in one menu under the value. */
function chooseFrom(f: FieldDef, q: FieldProps, x: number, y: number): void {
  const items: MenuEntry[] = each(optionsOf(f), (o): MenuEntry => ({ label: o.title, checked: q.row.fields[f.key] === o.key, onSelect: () => q.onValue(f, o.key) }));
  if (!f.required) items.push({ separator: true }, { label: "Clear", onSelect: () => q.onValue(f, null) });
  q.show(items, x, y);
}

// ---------------------------------------------------------------- the right pane

const PANE_W = 340;
const PINNED_TABS = PANE_TABS.map((t) => ({ ...t, pinned: true }));
const withMore = (w: ReadonlyMap<string, number>): ReadonlyMap<string, number> => new Map(w).set("More", 14).set("More tabs", 14);

function Pane({ type, row, def, tab, onTab, phone = false }: { type: string; row: RecordRow; def: TypeDef; tab: PaneKey; onTab: (k: PaneKey) => void; phone?: boolean }): ReactElement {
  const data = usePageData();
  const menu = useMenu();
  const win = useWindowDimensions();
  const [paneW, setPaneW] = useState(PANE_W);
  const titles = useTitleWidths();
  const paneNow = phone ? win.width : paneW;
  // the tabs that do not fit fold behind one More tab, as in the Chats pane
  const { strip, select } = useFittedTabs(PINNED_TABS, tab, paneNow, {
    extra: PANE_TAB_EXTRA, chrome: PANE_CHROME + 28, ...(titles.widths.size > 0 ? { chevron: true } : {}), menu, left: Math.max(0, win.width - paneNow) + 40, top: 118, measured: withMore(titles.widths),
    pick: (key) => onTab(key as PaneKey),
  });
  const vq = useLive("records.versions", { type, recordId: row.id });
  const mq = useLive("memory.find_by_subject", { subject: row.id });
  const now = data.now();
  const facts: ReactElement[] = [];
  if (mq.status === "ready") for (const f of mq.data.facts) facts.push(<Row key={f.factId} id={`fact:${f.factId}`} title={f.text} note={`${f.layer} · ${ago(f.learnedAt, now)}`} onPress={() => data.nav.openSource(f.sourceLink ?? f.sourceRef)} />);
  const notes: ReactElement[] = [];
  if (mq.status === "ready") for (const n of mq.data.notes) notes.push(<Row key={n.noteId} id={`note:${n.noteId}`} title={n.title} note={n.path} onPress={() => data.nav.openSource(n.path)} />);
  let body: ReactElement;
  // Comments and Chat fill the pane's height (a field at the bottom); the other tabs scroll
  let fill = false;
  if (tab === "everything") body = <EverythingTab type={type} recordId={row.id} def={def} onComments={() => onTab("comments")} />;
  else if (tab === "activity") body = <ActivityTab type={type} recordId={row.id} def={def} />;
  else if (tab === "comments") { fill = true; body = <CommentsTab type={type} recordId={row.id} />; }
  else if (tab === "chat") { fill = true; body = <ChatTab type={type} recordId={row.id} />; }
  else if (tab === "files") { fill = true; body = <FilesTab type={type} recordId={row.id} title={String(row.fields[def.titleField] ?? row.id)} {...(typeof row.fields["folder"] === "string" ? { fieldFolder: row.fields["folder"] as string } : {})} />; }
  else if (tab === "memory") body = facts.length + notes.length > 0 ? <View testID="pane-memory">{facts}{notes}</View> : <Text style={p.paneEmpty}>No agent has remembered anything about this record.</Text>;
  else body = vq.status === "ready" ? (
    <View testID="pane-history"><HistoryTab resourceType="record" resourceId={row.id} recordType={type} versions={historyVersions(vq.data.versions, data.nameOf)} selectedVersionId={null} density="compact" invoke={(cap, input) => data.call(cap, input).then(() => undefined)} /></View>
  ) : <Text style={p.paneEmpty}>Loading</Text>;
  return (
    <ResizableColumn
      paneKey={phone ? "record-pane-phone" : "record-pane"} defaultWidth={phone ? win.width : PANE_W} grow="left" min={phone ? win.width : 280} {...(phone ? { maxFraction: 1 } : {})}
      style={(phone ? [p.pane, p.panePhone] : p.pane) as never} testID="record-pane" label="Record details"
      onLayout={(e) => { const w = Math.round(e.nativeEvent.layout.width); if (w > 0 && w !== paneW) setPaneW(w); }}
    >
      <TabMeasure titles={PANE_TABS.map((x) => x.title)} onWidth={titles.set} />
      <TabStrip tabs={strip as never} active={tab} onSelect={select} />
      {fill ? <View style={p.paneFill}>{body}</View> : <ScrollView style={p.paneScroll}>{body}</ScrollView>}
      {menu.element}
    </ResizableColumn>
  );
}

// ---------------------------------------------------------------- the relationship map

function RelationMap({ nodes, edges, onOpen }: { nodes: readonly RelNode[]; edges: { from: string; to: string; field: string }[]; onOpen: (n: RelNode) => void }): ReactElement | null {
  if (Platform.OS !== "web") return null;
  const placed = mapLayout(nodes);
  const at = new Map(each(placed, (n): [string, typeof n] => [n.recordId, n]));
  const kids: ReactElement[] = [];
  for (const e of edges) {
    const a = at.get(e.from), b = at.get(e.to);
    if (a && b) kids.push(createElement("line", { key: `${e.from}>${e.to}:${e.field}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y, "data-testid": "map-edge", style: { stroke: "var(--ink-4)", strokeWidth: 1.2 } }));
  }
  for (const n of placed) {
    const hue = hueOf(n.type);
    kids.push(createElement("g", { key: n.recordId, "data-testid": `map-${n.recordId}`, "data-hop": n.hop, tabIndex: 0, role: "link", "aria-label": `${n.title}, ${n.type}`, style: { cursor: "pointer", outline: "none" }, onClick: () => onOpen(n), onKeyDown: (e: { key: string }) => { if (e.key === "Enter") onOpen(n); } },
      createElement("circle", { cx: n.x, cy: n.y, r: n.hop === 0 ? 11 : 8, style: { fill: `hsl(${hue}, 60%, 52%)`, stroke: n.hop === 0 ? "var(--accent)" : "var(--win)", strokeWidth: n.hop === 0 ? 3 : 2 } }),
      createElement("text", { x: n.x, y: n.y + (n.hop === 0 ? 24 : 21), textAnchor: "middle", style: { fill: "var(--ink-2)", fontSize: 11 } }, n.title)));
  }
  return createElement("svg", { viewBox: "0 0 360 260", width: "100%", height: 260, role: "img", "aria-label": "Relationships, two hops out", "data-testid": "relation-map", style: { display: "block" } }, ...kids);
}

// ---------------------------------------------------------------- the page

function PageBody({ type, recordId, start = {} }: RecordPageProps): ReactElement {
  const data = usePageData();
  const rq = useLive("records.get", { type, recordId });
  const dq = useLive("schema.describe", { type });
  const lq = useLive("schema.layout.get", { type });
  const pq = useLive("records.page_prefs.get", { type });
  const cq = useLive("records.completeness", { type, recordId });
  // the relationships two hops out feed the map, the relation fields and the [[links]], none of which the first frame draws: asked with the late pass, or at once for the map
  const [late, setLate] = useState(typeof window === "undefined" || start.pane !== undefined || start.tab !== undefined || start.edit !== undefined || start.all === true);
  const [map, setMap] = useState(start.map === true);
  const mq = useLive("records.relations_map", { type, recordId, hops: 2 }, late || map);
  const width = useWindowDimensions().width;
  const wide = width === 0 || width >= 900;
  const phone = width > 0 && width < 640;
  const [editing, setEditing] = useState<{ key: string; text: string; error?: string } | null>(start.edit ?? null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [all, setAll] = useState(start.all === true || start.edit !== undefined);
  const [pane, setPane] = useState<boolean | null>(start.pane ?? null);
  const [tab, setTab] = useState<PaneKey>(start.tab ?? "everything");
  const busy = useRef(false);
  // the right pane (its three reads and its rows) comes after the first paint on a screen (late, above); a server render or a test has no frames, so it is there at once
  useEffect(() => {
    if (late) return;
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setLate(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [late]);
  const menu = useMenu();
  // a person who may only view the record (it was shared with them to view) sees it read only: nothing to click that would be refused
  const rights = useRecordRights(recordId);
  const readOnly = rights.on && rights.can.edit === false;
  const def = dq.status === "ready" ? dq.data.types.find((t) => t.key === type) : undefined;
  const row = rq.status === "ready" ? (rq.data.record as RecordRow | undefined) : undefined;
  const [group, setGroup] = useState("overview");
  const journey = useJourneyStages(data.call, type, def !== undefined && isJourneyDef(def));
  if (!def || !row) {
    return <View style={p.main} testID="record-page-loading" accessibilityLabel="Loading"><View style={p.head}><Text accessibilityRole="header" style={p.h1}>Record</Text></View></View>;
  }
  const prefs = pq.status === "ready" ? pq.data : { folded: [], keepVisible: [] };
  const plain = sectionsOf(def, lq.status === "ready" ? lq.data : undefined, pq.status === "ready" ? pq.data : undefined);
  // a Journey record leads with the group of the stage it is in; the groups of later stages stay locked until their stage opens
  const stageNow = (() => { const sf = stageFieldOf(def); const v = sf ? row.fields[sf.key] : undefined; return typeof v === "string" ? v : ""; })();
  const ownStages = stagesOn(def) ? stagesOf(typeStageField(def)).map((g, i) => ({ key: g.key, title: g.title, order: i, ...(g.fields ? { fields: g.fields } : {}) })) : [];
  const sections = journey ? withStages(def, plain, journey.stages, stageNow, prefs.folded) : ownStages.length ? withStages(def, plain, ownStages, stageNow, prefs.folded) : plain;
  const tabs = tabsOf(sections);
  const shown = visibleSections(sections, tabs, group);
  const ring = cq.status === "ready" && asksForFields(def, cq.data) ? ringOf(cq.data) : null;
  const nodes = mq.status === "ready" ? mq.data.nodes : [];
  const title = String(row.fields[def.titleField] ?? "") || "Untitled";
  const sf = def.summaryField ? def.fields.find((x) => x.key === def.summaryField) : undefined;
  const summary = sf ? valueText(sf, row.fields[sf.key], data.nameOf) : "";
  const paneOpen = pane ?? wide;

  const commit = (f: FieldDef, text: string): void => {
    if (busy.current) return;
    busy.current = true;
    setEditing(null);
    saveField(data, type, row, f, text)
      .then((r) => {
        if (r.kind === "bad") { setEditing({ key: f.key, text, error: r.message }); return; }
        if (r.kind === "saved") setFlash({ text: `Saved ${f.title.toLowerCase()}.`, undo: r.undo });
      })
      .catch((e: unknown) => { setEditing({ key: f.key, text, error: errorText(e, "Could not save") }); })
      .finally(() => { busy.current = false; });
  };
  const setValue = (f: FieldDef, v: unknown): void => {
    saveValue(data, type, row, f, v)
      .then((r) => { if (r.kind === "saved") setFlash({ text: `Saved ${f.title.toLowerCase()}.`, undo: r.undo }); })
      .catch((e: unknown) => setFlash({ text: errorText(e, "Could not save"), bad: true }));
  };
  const undo = (u: Undo): void => {
    setFlash(null);
    undoSave(data, type, row, u).then(() => setFlash({ text: "Put back." })).catch((e: unknown) => setFlash({ text: errorText(e, "Could not undo"), bad: true }));
  };
  const showSource = (f: FieldDef, x: number, y: number): void => {
    sourceOf(data, type, row.id, f.key).then((s) => menu.show([{ head: sourceText(s as Parameters<typeof sourceText>[0]) }], x, y)).catch(() => menu.show([{ head: "No source recorded for this value." }], x, y));
  };
  const fold = (s: Section): void => { void savePrefs(data, type, { folded: toggleFold(each(sections.filter((x) => x.folded && x.stage?.state !== "locked"), (x) => x.key), s.key) }); };

  const fieldProps = { readOnly, row, type, editing, nodes, show: menu.show, onEdit: (f: FieldDef) => setEditing({ key: f.key, text: inputText(f, row.fields[f.key]) }), onText: (t: string) => setEditing((e) => (e ? { ...e, text: t, ...(e.error ? { error: "" } : {}) } : e)), onCommit: commit, onCancel: () => setEditing(null), onValue: setValue, onSource: showSource };

  // Ask for these: the person's conversation in the Inbox with a drafted message. A record with nobody to reach opens its empty Email (or Phone) field instead
  const askForThese = (missing: readonly { field: string; title: string }[]): void => {
    findContact(data.call, def, row).then((contact) => {
      if (contact) { data.nav.askFor({ type, recordId: row.id, title, missing: [...missing], contact }); return; }
      const f = channelFieldToAdd(def, row);
      if (!f) { setFlash({ text: "Add an email or phone to this record first.", bad: true }); return; }
      setAll(true);
      fieldProps.onEdit(f);
      setFlash({ text: `Add ${f.title.toLowerCase()} to ask for these.` });
    }).catch(() => setFlash({ text: "Could not open the conversation. Try again.", bad: true }));
  };

  const body: ReactElement[] = [];
  // the first frame draws what the screen shows (about the first eight fields); the sections below it join after the first paint, with the right pane (navigate budget, 50 ms)
  let drawn = 0;
  for (const s of shown) {
    if (!late && drawn >= FIRST_FRAME_FIELDS) break;
    const sh = shownFields(s, row, prefs.keepVisible, all);
    if (!s.folded) drawn += sh.fields.length;
    const fields: ReactElement[] = [];
    for (const f of sh.fields) fields.push(<View key={f.key} style={wide ? p.half : p.full}><FieldRow field={f} {...fieldProps} /></View>);
    const locked = s.stage?.state === "locked", now = s.stage?.state === "current";
    body.push(
      <View key={s.key} testID={`section-${s.key}`} style={now ? p.nowBox : undefined}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: !s.folded, disabled: locked }} aria-expanded={!s.folded} accessibilityLabel={locked ? `${s.title}, opens at ${s.stage!.opensAt}` : s.title} testID={`fold-${s.key}`} disabled={locked} onPress={() => fold(s)} style={({ hovered }: { hovered?: boolean }) => [p.sh, hovered === true && !locked && p.cardOver]}>
          {locked ? <Icon name="lock" size={12} /> : <View style={s.folded ? p.shut : undefined}><Glyph name="chevd" size={10} /></View>}
          <Text style={[p.st, now && p.stNow]}>{s.title}</Text>
          {locked ? <Text style={p.sn} testID={`opens-${s.key}`}>{`Opens at ${s.stage!.opensAt}`}</Text> : now ? <Text style={p.sn}>This stage</Text> : <Text style={p.sn}>{s.fields.length}</Text>}
        </Pressable>
        {s.folded ? null : <View style={p.fields}>{fields}</View>}
        {!s.folded && sh.hidden > 0 && !all ? <Pressable accessibilityRole="button" testID={`more-${s.key}`} onPress={() => setAll(true)}><Text style={p.more}>{`Show ${sh.hidden} empty ${sh.hidden === 1 ? "field" : "fields"}`}</Text></Pressable> : null}
      </View>,
    );
  }

  const mapEdges = mq.status === "ready" ? mq.data.edges : [];
  return (
    <View style={p.main} testID="record-page" accessibilityLabel={`${title}, ${def.title}`}>
      <View style={p.head}>
        <Glyph name="project" size={16} color="var(--ink-2)" />
        <Text style={p.crumb} numberOfLines={1}>{def.plural}</Text>
        {/* a phone repeats the name in the big title below, so the bar keeps the type only */}
        {wide ? <><Text style={p.slash}>/</Text>
        <Text accessibilityRole="header" aria-level={1} style={p.h1} numberOfLines={1} testID="record-title-crumb">{title}</Text></> : null}
        <View style={p.grow} />
        {readOnly ? <View style={p.ro} testID="record-readonly" accessibilityLabel="You can view this record"><Glyph name="lock" size={12} color="var(--ink-3)" /><Text style={p.hbText}>Read only</Text></View> : null}
        <ShareButton recordId={recordId} title={title} typeName={def.plural} wide={wide} />
        {late ? <><Pressable accessibilityRole="button" accessibilityLabel="Relationships" accessibilityState={{ selected: map }} testID="toggle-map" onPress={() => setMap(!map)} style={({ hovered }: { hovered?: boolean }) => [p.hb, hovered === true && p.cardOver, map && p.hbOn]}><Glyph name="map" size={14} color={map ? "var(--accent)" : "var(--ink-2)"} />{wide ? <Text style={[p.hbText, map && p.lit]}>Relationships</Text> : null}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Details" accessibilityState={{ selected: paneOpen }} testID="toggle-pane" onPress={() => setPane(!paneOpen)} style={({ hovered }: { hovered?: boolean }) => [p.hb, hovered === true && p.cardOver, paneOpen && p.hbOn]}><Glyph name="expand" size={14} color={paneOpen ? "var(--accent)" : "var(--ink-2)"} />{wide ? <Text style={[p.hbText, paneOpen && p.lit]}>Details</Text> : null}</Pressable></> : null}
      </View>
      {flash ? (
        <View style={[p.flash, flash.bad === true && p.flashBad]} accessibilityRole="alert" testID="record-flash">
          <Text style={p.flashText}>{flash.text}</Text>
          {flash.undo ? <Pressable accessibilityRole="button" testID="undo" onPress={() => undo(flash.undo!)}><Text style={p.flashLink}>Undo</Text></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" testID="flash-x" onPress={() => setFlash(null)}><Glyph name="chevd" size={10} /></Pressable>
        </View>
      ) : null}
      <View style={wide ? p.split : p.stack}>
        <ScrollView style={[p.sheet, phone && paneOpen && p.hidden]} contentContainerStyle={p.sheetIn} testID="record-sheet">
          {isJourneyDef(def) || stagesOn(def) ? <JourneyStepper type={type} row={row} def={def} /> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Edit title" testID="title" onPress={() => { if (!readOnly) fieldProps.onEdit(def.fields.find((f) => f.key === def.titleField)!); }}>
            {editing?.key === def.titleField
              ? <TextInput autoFocus value={editing.text} onChangeText={fieldProps.onText} accessibilityLabel="Title" testID={`edit-${def.titleField}`} onBlur={() => commit(def.fields.find((f) => f.key === def.titleField)!, editing.text)} onSubmitEditing={() => commit(def.fields.find((f) => f.key === def.titleField)!, editing.text)} onKeyPress={(e) => { if (e.nativeEvent.key === "Escape") setEditing(null); }} style={p.titleInput} />
              : <Text accessibilityRole="header" aria-level={2} style={p.title}>{title}</Text>}
          </Pressable>
          {summary ? <Text style={p.summary} testID="summary">{summary}</Text> : null}
          {ring && late ? (
            <View style={p.ringRow} testID="completeness">
              {Platform.OS === "web" ? createElement("svg", { viewBox: "0 0 24 24", width: 24, height: 24, role: "img", "aria-label": `Completeness ${ring.label}`, "data-testid": "ring" },
                createElement("circle", { cx: 12, cy: 12, r: RING_R, fill: "none", style: { stroke: "var(--line-2)", strokeWidth: 3 } }),
                createElement("circle", { cx: 12, cy: 12, r: RING_R, fill: "none", strokeDasharray: ring.dash, transform: "rotate(-90 12 12)", strokeLinecap: "round", style: { stroke: ring.complete ? "var(--ok)" : "var(--accent)", strokeWidth: 3 } })) : null}
              <Text style={p.ringText} testID="ring-label">{ring.label}</Text>
              {cq.status === "ready" && cq.data.missing.length > 0 ? <Pressable accessibilityRole="button" testID="ask-missing" onPress={() => askForThese(cq.data.missing)}><Text style={p.ringLink}>Ask for these</Text></Pressable> : null}
            </View>
          ) : null}
          {map ? <View style={p.mapBox} testID="relation-map-box">{nodes.length > 1 ? <RelationMap nodes={nodes} edges={mapEdges} onOpen={(n) => data.nav.openRecord(n.type, n.recordId)} /> : <Text style={p.paneEmpty}>Nothing is linked to this record yet.</Text>}</View> : null}
          {tabs ? <TabStrip tabs={each(tabs, (t) => ({ key: t.key, title: t.title }))} active={tabs.some((t) => t.key === group) ? group : tabs[0]!.key} onSelect={setGroup} /> : null}
          {body}
          {all ? <Pressable accessibilityRole="button" testID="hide-empty" onPress={() => setAll(false)}><Text style={p.more}>Hide empty fields</Text></Pressable> : null}
        </ScrollView>
        {paneOpen ? (late ? <Pane type={type} row={row} def={def} tab={tab} onTab={setTab} phone={phone} /> : <ResizableColumn paneKey="record-pane" defaultWidth={340} grow="left" min={280} style={p.pane as never} testID="record-pane-reserved" />) : null}
      </View>
      {menu.element}
    </View>
  );
}

/** Share, in a Team Space, for someone who may share this record. A Personal Space and a viewer draw nothing. */
function ShareButton({ recordId, title, typeName, wide }: { recordId: string; title: string; typeName: string; wide: boolean }): ReactElement | null {
  const data = useOptionalRecordsData();
  const { on, can } = useRecordRights(recordId);
  if (!on || !(can.manage || can.share)) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Share" testID="record-share-btn" onPress={() => data?.share?.open({ type: "record", id: recordId, name: title, typeName })} style={({ hovered }: { hovered?: boolean }) => [p.hb, hovered === true && p.cardOver]}>
      <Glyph name="share" size={14} color="var(--ink-2)" />{wide ? <Text style={p.hbText}>Share</Text> : null}
    </Pressable>
  );
}

export function RecordPage(props: RecordPageProps): ReactElement {
  const data = useOptionalPageData();
  if (!data) return <View style={p.main} testID="record-page-loading" accessibilityLabel="Loading"><View style={p.head}><Text accessibilityRole="header" style={p.h1}>Record</Text></View></View>;
  return <PageBody {...props} />;
}

const p = StyleSheet.create({
  main: { flex: 1, minWidth: 0, backgroundColor: "var(--win)" as string },
  head: { height: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 18, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string, zIndex: 10 },
  crumb: { fontSize: 13, color: "var(--ink-3)" as string },
  slash: { fontSize: 14, color: "var(--ink-4)" as string },
  h1: { margin: 0, fontSize: 14, fontWeight: "600", color: "var(--ink)" as string, flexShrink: 1 },
  grow: { flex: 1 },
  ro: { height: 28, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", gap: 6 },
  hb: { height: 28, paddingHorizontal: 8, borderRadius: 7, flexDirection: "row", alignItems: "center", gap: 6 },
  hbOn: { backgroundColor: "var(--accent-wash)" as string },
  hbText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  lit: { color: "var(--accent)" as string },
  split: { flex: 1, flexDirection: "row", minHeight: 0 },
  stack: { flex: 1, minHeight: 0 },
  sheet: { flex: 1, minWidth: 0 },
  sheetIn: { paddingHorizontal: 28, paddingTop: 22, paddingBottom: 48, maxWidth: 860, gap: 4 },
  title: { margin: 0, fontSize: 24, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string },
  titleInput: { fontSize: 24, fontWeight: "600", color: "var(--ink)" as string, padding: 0 },
  summary: { fontSize: 14, color: "var(--ink-2)" as string, marginTop: 4 },
  ringRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, marginBottom: 6 },
  ringText: { fontSize: 12.5, color: "var(--ink-2)" as string, fontVariant: ["tabular-nums"] },
  ringLink: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  mapBox: { marginTop: 8, borderRadius: 12, backgroundColor: "var(--sunk)" as string, padding: 8 },
  sh: { height: 32, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16, paddingHorizontal: 4, borderRadius: 6 },
  shut: { transform: [{ rotate: "-90deg" }] },
  st: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  stNow: { color: "var(--accent)" as string },
  nowBox: { borderRadius: 10, backgroundColor: "var(--accent-wash)" as string, paddingHorizontal: 10, paddingBottom: 6, marginTop: 6 },
  sn: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
  fields: { flexDirection: "row", flexWrap: "wrap" },
  half: { width: "50%", paddingRight: 16 },
  full: { width: "100%" },
  field: { minHeight: 40, flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "var(--line)" as string },
  label: { width: 110, fontSize: 12.5, color: "var(--ink-3)" as string, paddingTop: 2 },
  valueCol: { flex: 1, minWidth: 0 },
  value: { fontSize: 13.5, color: "var(--ink)" as string },
  longText: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  link: { color: "var(--accent)" as string, fontWeight: "500" },
  linkGone: { color: "var(--ink-3)" as string, textDecorationLine: "underline" },
  empty: { fontSize: 13.5, color: "var(--ink-4)" as string },
  person: { flexDirection: "row", alignItems: "center", gap: 7 },
  tag: { height: 22, paddingHorizontal: 8, borderRadius: 6, justifyContent: "center", alignSelf: "flex-start" },
  tagText: { fontSize: 12.5, fontWeight: "500" },
  box: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.4, borderColor: "var(--ink-4)" as string, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "var(--accent)" as string, borderColor: "var(--accent)" as string },
  stars: { flexDirection: "row", gap: 2 },
  star: { fontSize: 16, color: "var(--line-2)" as string },
  starOn: { color: "var(--warn)" as string },
  editWrap: { gap: 4 },
  input: { height: 30, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: "var(--field-line)", backgroundColor: "var(--field)" as string, fontSize: 13.5, color: "var(--ink)" as string },
  inputLong: { height: 96, paddingTop: 6 },
  inputBad: { boxShadow: "inset 0 0 0 1.5px var(--danger)" } as object,
  errText: { fontSize: 12, color: "var(--danger)" as string },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cardWrap: { position: "relative" },
  card: { height: 28, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 4, paddingRight: 10, borderRadius: 8, backgroundColor: "var(--sunk)" as string },
  cardOver: { backgroundColor: "var(--hover)" as string },
  cardText: { fontSize: 13, color: "var(--ink)" as string, maxWidth: 220 },
  tile: { width: 20, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  tileText: { fontSize: 11, fontWeight: "600" },
  peek: { position: "absolute", left: 0, top: 32, minWidth: 220, padding: 10, gap: 4, borderRadius: 10, backgroundColor: "var(--raised)" as string, zIndex: 50, boxShadow: "var(--sh-pop)" } as object,
  peekTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  peekRow: { flexDirection: "row", justifyContent: "space-between", gap: 14 },
  peekLabel: { fontSize: 12, color: "var(--ink-3)" as string },
  peekValue: { fontSize: 12, color: "var(--ink-2)" as string, flexShrink: 1 },
  more: { fontSize: 12.5, color: "var(--ink-3)" as string, paddingVertical: 8, paddingHorizontal: 0 },
  flash: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 7, backgroundColor: "var(--accent-wash)" as string },
  flashBad: { backgroundColor: "var(--sunk)" as string },
  flashText: { flex: 1, fontSize: 12.5, color: "var(--ink)" as string },
  flashLink: { fontSize: 12.5, fontWeight: "600", color: "var(--accent)" as string },
  pane: { width: 340, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string },
  paneScroll: { flex: 1 },
  hidden: { display: "none" },
  panePhone: { width: "100%", borderLeftWidth: 0 },
  paneFill: { flex: 1, minHeight: 0 },
  paneBody: { padding: 16, gap: 10 },
  paneText: { fontSize: 13, color: "var(--ink-2)" as string, lineHeight: 19 },
  paneEmpty: { fontSize: 13, color: "var(--ink-3)" as string, padding: 16 },
  open: { alignSelf: "flex-start", height: 28, justifyContent: "center", paddingHorizontal: 10, borderRadius: 7 },
  openText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
});
