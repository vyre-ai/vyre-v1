// Files > Knowledge > Page (spec 3.5, the living page): what Vyre knows about one person, client, project, topic or agent, written so a person can read it and edit it.
// Header: breadcrumb Knowledge > People|Clients|Projects|Topics|Agents > name, and a "..." menu (Open in Graph, History of the Notes, Trash, Copy link, Export as Markdown, Move page to Trash with Undo).
// Under it the tile, the name, "Client at Brooks Logistics", the layer badge and "Visible to <who>" (a menu of the layers; memory.page.set_visibility), and one blurb line.
// Facts: one line each (KnowFactLine: press to edit, hover the age for history, right-click for more). An open upkeep question about two of this page's facts is one card with the two choices; until a
// choice is made those two facts are held back from the list. Notes: read view with [[Page]] links, Edit opens a multiline field with a [[ autocomplete; Done saves with the version that was read and a
// stale write says so with Reload. Mentioned in: chats, runs and records that name this page. Related: a small radial map one hop out, each node a button. Footer: History, Trash and the counts.
// A page that is in Trash, or gone, says "This page is gone" and offers Restore when it can. `hl` is a fact that flashes when the page opens from a search hit.
import { createElement, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import type { LiveQuery, QueryState } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { errorText, putNotes, resolveQuestion, restoreFact, restoreNotesVersion, restorePage, trashPage } from "./actions.ts";
import { useLive, useMemoryData } from "./data.tsx";
import type { LiveCap } from "./data.tsx";
import { Empty, Flash, KnowColumn, KnowHeader, SectionHead, frame } from "./KnowFrame.tsx";
import type { Crumb, FlashState } from "./KnowFrame.tsx";
import { KnowFactLine } from "./KnowFactLine.tsx";
import { KIND_MANY, KIND_ONE, LAYER_NAME, LIST_KINDS, ageText, dateText, openLinkAt, plural, stampText } from "./know.ts";
import type { Backlink, KFact, ListKind, PageKind, PageLink, PageRow, Question } from "./know.ts";
import { SubjectTile, TextButton } from "./KnowParts.tsx";
import { Icon, pointOf } from "./parts.tsx";
import type { IconName } from "./parts.tsx";
import { each } from "./model.ts";

/** What a page adds for this screen beyond the generated row: a subtitle ("Client at Brooks Logistics"), one blurb line, and who can see it in words. All optional. */
export interface PageExtra { subtitle?: string; blurb?: string; visibleTo?: string }
export type KPageRow = PageRow & PageExtra;

// ---------------------------------------------------------------- the pure part

/** Who can see a page, in words, when the page does not say. */
export const VISIBLE_DEFAULT: Record<PageRow["layer"], string> = { space: "Everyone in this Space", project: "People on this project", person: "Only you", agent: "This agent and admins" };
export const VISIBLE_ORDER: readonly PageRow["layer"][] = ["space", "project", "person", "agent"];
const LAYER_ICON: Record<PageRow["layer"], IconName> = { space: "users", project: "folder", person: "person", agent: "bolt" };

/** The words of the Visible to menu: the page's own words for its current layer, the defaults for the others. */
export function visibleChoices(page: KPageRow): Array<{ layer: PageRow["layer"]; text: string; checked: boolean }> {
  return each(VISIBLE_ORDER, (layer) => ({ layer, text: layer === page.layer && page.visibleTo ? page.visibleTo : VISIBLE_DEFAULT[layer], checked: layer === page.layer }));
}

/** "Client at Brooks Logistics": the subtitle the page has, otherwise the kind in words. */
export const subtitleOf = (page: KPageRow): string => page.subtitle ?? KIND_ONE[page.kind];

/** The breadcrumb of a page: Knowledge, the list of its kind (a link when that kind has a list), the name. */
export function pageCrumbs(kind: PageKind, title: string): Crumb[] {
  const list: Crumb = (LIST_KINDS as readonly string[]).includes(kind) ? { t: KIND_MANY[kind], route: { v: "list", kind: kind as ListKind } } : { t: KIND_MANY[kind] };
  return [{ t: "Knowledge", route: { v: "learned" } }, list, { t: title }];
}

/** The open question that is about this page: one whose facts are on it. */
export function questionFor(questions: readonly Question[], factIds: ReadonlySet<string>): Question | undefined {
  return questions.find((q) => q.status === "open" && q.facts.some((f) => factIds.has(f.factId)));
}

/** The facts that show in the list: the two in question are held back until one is picked. */
export function shownFacts(facts: readonly KFact[], q: Question | undefined): KFact[] {
  if (!q) return facts.slice();
  const held = new Set(each(q.facts, (f) => f.factId));
  return facts.filter((f) => !held.has(f.factId));
}

/** The words two facts share at their start, cut at a word, so a choice can show only what differs ("Send updates to " + the address). */
export function sharedStart(a: string, b: string): string {
  const x = a.split(" "), y = b.split(" ");
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i === 0 || i >= x.length || i >= y.length ? "" : `${x.slice(0, i).join(" ")} `;
}

/** What a choice of the question shows: the part of the fact that differs. */
export function choiceText(text: string, other: string): string {
  const cut = text.slice(sharedStart(text, other).length).replace(/\.$/, "");
  return cut === "" ? text : cut;
}

export type Piece = { text: string; link?: false } | { text: string; link: true; pageId?: string };

/** The Notes cut into plain text and [[links]]; a link is dead when no page has that title. */
export function notePieces(text: string, links: readonly PageLink[]): Piece[] {
  const out: Piece[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let at = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const title = m[1]!;
    const hit = links.find((l) => l.title.toLowerCase() === title.toLowerCase() && l.pageId);
    out.push({ text: title, link: true, ...(hit?.pageId ? { pageId: hit.pageId } : {}) });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** Picking a title in the [[ menu: the text with `[[Title]]` in place of what was typed after `[[`, and where the caret goes (after the closing brackets). */
export function completeLink(text: string, caret: number, title: string): { text: string; caret: number } | null {
  const open = openLinkAt(text, caret);
  if (!open) return null;
  const tail = text.slice(caret).startsWith("]]") ? text.slice(caret + 2) : text.slice(caret);
  const head = `${text.slice(0, open.start)}[[${title}]]`;
  return { text: head + tail, caret: head.length };
}

/** An arrow key in a menu of `n` rows from row `i`: wraps at both ends. */
export function stepIndex(i: number, n: number, key: "ArrowDown" | "ArrowUp"): number {
  if (n <= 0) return 0;
  return key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n;
}

/** Where the [[ menu sits under the caret: the line and column of the caret, as px inside the field (a rough guess, soft wraps ignored). */
export function caretSpot(text: string, caret: number): { top: number; left: number } {
  const before = text.slice(0, caret), lines = before.split("\n");
  return { top: 12 + lines.length * 20 + 4, left: Math.min(12 + (lines[lines.length - 1] ?? "").length * 7.2, 380) };
}

/** True when a save failed because the Notes changed since they were read. */
export const isStale = (e: unknown): boolean => e instanceof Error && /precondition/i.test(e.message);

/** Positions of `n` neighbours on an ellipse round the centre of a W x H map, the first at the top. */
export function radial(n: number, w = 700, h = 230): Array<{ x: number; y: number }> {
  const cx = w / 2, cy = h / 2;
  return Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2; return { x: cx + Math.cos(a) * 250, y: cy + Math.sin(a) * 78 }; });
}

export interface Neighbour { id: string; title: string; kind: string; pageId?: string; link?: string }

const PAGE_KINDS = new Set(["person", "client", "project", "agent", "topic", "decision", "site"]);
/** The pages and chats one hop from this page: from the graph read when it has them, otherwise from the page's own links and mentions. */
export function neighbours(pageId: string, graph: CapMap["memory.graph"]["out"] | null, links: readonly PageLink[], backlinks: readonly Backlink[]): Neighbour[] {
  if (graph && graph.nodes.length > 1) {
    return each(graph.nodes.filter((n) => n.nodeId !== pageId), (n) => {
      const x = n as typeof n & { pageId?: string; link?: string };
      const pid = x.pageId ?? (PAGE_KINDS.has(n.kind) ? n.nodeId : undefined);
      return { id: n.nodeId, title: n.title, kind: n.kind, ...(pid ? { pageId: pid } : {}), ...(x.link ? { link: x.link } : {}) };
    });
  }
  const out: Neighbour[] = [];
  for (const l of links) if (l.pageId && !out.some((o) => o.id === l.pageId)) out.push({ id: l.pageId, title: l.title, kind: "note", pageId: l.pageId });
  for (const b of backlinks) if (!out.some((o) => o.id === b.ref)) out.push({ id: b.ref, title: b.title, kind: b.kind, ...(b.kind === "page" ? { pageId: b.ref } : {}), ...(b.link ? { link: b.link } : {}) });
  return out;
}

const HUE: Record<string, number> = { person: 330, client: 150, project: 265, agent: 170, topic: 280, decision: 35, record: 100, run: 100, chat: 0, site: 190, note: 215, page: 215 };
const hue = (kind: string): string => `hsl(${HUE[kind] ?? 215}, 62%, 58%)`;
const KIND_ICON: Record<string, IconName> = { chat: "chat", record: "sheet", run: "run", page: "note" };

// ---------------------------------------------------------------- reads that never throw into the screen

/** A live read whose failure is a state ("loading" with an error), so a page that is gone draws "This page is gone" instead of breaking the screen. */
function useSafeLive<C extends LiveCap>(cap: C, input: CapMap[C]["in"]): QueryState<CapMap[C]["out"]> {
  const { live } = useMemoryData();
  const key = JSON.stringify(input);
  const q = useMemo((): LiveQuery<CapMap[C]["out"]> => {
    const inner = live(cap, JSON.parse(key) as CapMap[C]["in"]);
    let failed: QueryState<CapMap[C]["out"]> | null = null;
    return {
      subscribe: inner.subscribe,
      getSnapshot() {
        try { return inner.getSnapshot(); } catch (e) {
          const message = e instanceof Error ? e.message : "Could not read";
          if (!failed || failed.status !== "loading" || failed.error?.message !== message) failed = { status: "loading", error: { message } };
          return failed;
        }
      },
    };
  }, [live, cap, key]);
  return useSyncSnapshot(q);
}
const useSyncSnapshot = <T,>(q: LiveQuery<T>): QueryState<T> => useSyncExternalStore(q.subscribe, q.getSnapshot, q.getSnapshot);

const copy = (text: string): boolean => {
  try { const c = (globalThis as { navigator?: { clipboard?: { writeText(t: string): unknown } } }).navigator?.clipboard; if (!c) return false; void c.writeText(text); return true; } catch { return false; }
};

// ---------------------------------------------------------------- the screen

export function KnowPage({ pageId, hl }: { pageId: string; hl?: string }): ReactElement {
  const q = useSafeLive("memory.page.get", { pageId });
  const [flash, setFlash] = useState<FlashState | null>(null);
  if (q.status === "loading" && !q.error) {
    return <View style={frame.main} testID="know-page" accessibilityLabel="Loading"><KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: "Page" }]} /><KnowColumn testID="know-page-body" label="Loading the page">{null}</KnowColumn></View>;
  }
  if (q.status === "loading" || q.data.page.trashedAt !== undefined) {
    return <Gone pageId={pageId} title={q.status === "ready" ? q.data.page.title : undefined} flash={flash} setFlash={setFlash} />;
  }
  return <PageBody key={pageId} pageId={pageId} out={q.data} {...(hl ? { hl } : {})} flash={flash} setFlash={setFlash} />;
}

/** A page in Trash or removed: one plain line, and Restore when Trash still has it. */
function Gone({ pageId, title, flash, setFlash }: { pageId: string; title: string | undefined; flash: FlashState | null; setFlash: (f: FlashState | null) => void }): ReactElement {
  const data = useMemoryData();
  const trash = useSafeLive("memory.trash.search", { area: "trash" });
  const mine = trash.status === "ready" ? trash.data.pages.find((p) => p.pageId === pageId) : undefined;
  const [err, setErr] = useState<string | null>(null);
  const restore = (): void => { setErr(null); restorePage(data, pageId).then(() => setFlash({ text: "Restored. The page is back." })).catch((e: unknown) => setErr(errorText(e, "Could not restore the page"))); };
  return (
    <View style={frame.main} testID="know-page">
      <KnowHeader crumbs={[{ t: "Knowledge", route: { v: "learned" } }, { t: title ?? "Page" }]} />
      <KnowColumn testID="know-page-body" label="This page is gone">
        <Flash flash={flash} onClose={() => setFlash(null)} />
        <Empty title="This page is gone" text={mine ? "It is in Trash. Restore it to read and edit it again." : "It was removed, or you cannot see it."} />
        {mine ? <View style={p.center}><TextButton label="Restore" accent testID="page-restore" onPress={restore} /></View> : null}
        {err ? <Text style={p.err} accessibilityRole="alert" testID="page-error">{err}</Text> : null}
      </KnowColumn>
    </View>
  );
}

type PageOut = CapMap["memory.page.get"]["out"];

function PageBody({ pageId, out, hl, flash, setFlash }: { pageId: string; out: PageOut; hl?: string; flash: FlashState | null; setFlash: (f: FlashState | null) => void }): ReactElement {
  const data = useMemoryData();
  const { nav } = data;
  const menu = useMenu();
  const page = out.page as KPageRow;
  const now = data.now();
  const facts = out.facts as KFact[];
  const [err, setErr] = useState<string | null>(null);
  const [histOpen, setHistOpen] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);

  const qs = useSafeLive("memory.questions.list", { status: "open" });
  const versions = useSafeLive("memory.page.versions", { pageId });
  const trash = useSafeLive("memory.trash.search", { area: "trash" });
  const graph = useSafeLive("memory.graph", { scope: "space", focus: pageId, hops: 1 });

  const question = questionFor(qs.status === "ready" ? qs.data.questions : [], new Set(each(facts, (f) => f.factId)));
  const list = shownFacts(facts, question);
  const trashed = trash.status === "ready" ? trash.data.facts.filter((f) => (f as KFact).subject?.pageId === pageId).length : 0;
  const mentions = out.backlinks;
  const verList = versions.status === "ready" ? versions.data.versions.slice().sort((a, b) => b.version - a.version) : [];
  const latest = verList[0];
  const near = neighbours(pageId, graph.status === "ready" ? graph.data : null, out.links, out.backlinks);

  const visible = page.visibleTo ?? VISIBLE_DEFAULT[page.layer];
  const setVisible = (layer: PageRow["layer"]): void => {
    if (layer === page.layer) return;
    setErr(null);
    const prev = page.layer;
    data.call("memory.page.set_visibility", { pageId, layer })
      .then(() => setFlash({ text: `${page.title} is now visible to ${VISIBLE_DEFAULT[layer].toLowerCase()}. Facts keep their own access.`, undo: () => { void data.call("memory.page.set_visibility", { pageId, layer: prev }).catch((e: unknown) => setErr(errorText(e, "Could not change who can see this page"))); } }))
      .catch((e: unknown) => setErr(errorText(e, "Could not change who can see this page")));
  };
  const trashThisPage = (): void => {
    setErr(null);
    trashPage(data, pageId)
      .then(() => setFlash({ text: `Moved ${page.title} to Trash.`, undo: () => { void restorePage(data, pageId).catch((e: unknown) => setErr(errorText(e, "Could not restore the page"))); } }))
      .catch((e: unknown) => setErr(errorText(e, "Could not move the page to Trash")));
  };
  const exportMd = (): void => {
    setErr(null);
    data.call("memory.export_markdown", {})
      .then((o) => {
        const r = o as CapMap["memory.export_markdown"]["out"];
        if (copy(r.markdown)) { setExportText(null); setFlash({ text: `Copied the Markdown export: ${plural(r.pages, "page")}, ${plural(r.facts, "fact")}.` }); } else { setExportText(r.markdown); setFlash({ text: `Exported ${plural(r.pages, "page")} and ${plural(r.facts, "fact")}. The clipboard is not available here, so the text is below.` }); }
      })
      .catch((e: unknown) => setErr(errorText(e, "Could not export")));
  };
  const copyLink = (): void => { if (copy(`vyre://knowledge/${pageId}`)) setFlash({ text: "Link copied." }); else setErr("Could not copy: the clipboard is not available here."); };
  const pageMenu = (): MenuEntry[] => [
    { label: "Open in Graph", onSelect: () => nav.go({ v: "graph", focus: pageId, scope: "around" }) },
    { label: "History", onSelect: () => setHistOpen(true) },
    { label: "Trash", onSelect: () => nav.go({ v: "trash", pageId }) },
    { label: "Copy link", onSelect: copyLink },
    { separator: true },
    { label: "Export as Markdown", onSelect: exportMd },
    { label: "Move page to Trash", danger: true, onSelect: trashThisPage },
  ];
  const trig = menuTrigger((x, y) => menu.show(pageMenu(), x, y));

  const right = (
    <Pressable accessibilityRole="button" accessibilityLabel="More" {...({ "aria-haspopup": "menu" } as object)} testID="page-more" onPress={(e) => { const pt = pointOf(e); menu.show(pageMenu(), pt.x, pt.y); }} style={({ hovered }: { hovered?: boolean }) => [p.more, hovered === true && p.over]}>
      <Icon name="more" size={16} color="var(--ink-2)" />
    </Pressable>
  );
  const visTrig = (x: number, y: number): void => menu.show([{ head: "Visible to" }, ...each(visibleChoices(page), (c): MenuEntry => ({ label: c.text, checked: c.checked, onSelect: () => setVisible(c.layer) }))], x, y);

  return (
    <View style={frame.main} testID="know-page">
      <KnowHeader crumbs={pageCrumbs(page.kind, page.title)} right={right} />
      <KnowColumn testID="know-page-body" label={page.title}>
        <View style={p.head} {...(trig as object)}>
          <SubjectTile name={page.title} kind={page.kind} size={44} />
          <View style={p.headText}>
            <Text accessibilityRole="header" aria-level={2} style={p.name}>{page.title}</Text>
            <View style={p.sub}>
              <Text style={p.subText} testID="page-subtitle">{subtitleOf(page)}</Text>
              <View style={p.badge} testID="page-layer"><Icon name={LAYER_ICON[page.layer]} size={11} color="var(--ink-2)" /><Text style={p.badgeText}>{LAYER_NAME[page.layer]}</Text></View>
              <Pressable accessibilityRole="button" {...({ "aria-haspopup": "menu" } as object)} accessibilityLabel={`Visible to ${visible}`} testID="page-visible" onPress={(e) => { const pt = pointOf(e); visTrig(pt.x, pt.y); }} style={({ hovered }: { hovered?: boolean }) => [p.vis, hovered === true && p.over]}>
                <Text style={p.subText}>Visible to </Text><Text style={p.visWho}>{visible}</Text><Icon name="chevd" size={11} color="var(--ink-3)" />
              </Pressable>
            </View>
          </View>
        </View>
        {page.blurb ? <Text style={p.blurb} testID="page-blurb">{page.blurb}</Text> : null}
        <Flash flash={flash} onClose={() => setFlash(null)} />
        {err ? <Text style={p.err} accessibilityRole="alert" testID="page-error">{err}</Text> : null}

        <SectionHead title="Facts" sub={`${facts.length} current`} testID="page-facts-head" />
        {question ? <Conflict question={question} now={now} setFlash={setFlash} setErr={setErr} /> : null}
        {list.length > 0 ? each(list, (f) => <KnowFactLine key={f.factId} fact={f} page={{ layer: page.layer, ...(page.agentId ? { agentId: page.agentId } : {}), ...(page.projectId ? { projectId: page.projectId } : {}), ownerRef: page.ownerRef }} now={now} lit={hl === f.factId} onFlash={setFlash} />) : question ? null : <Text style={p.none}>Nothing recorded yet. Facts appear here as Vyre learns them.</Text>}
        {question ? <Text style={p.none} testID="page-held-back">The two facts in question are held back until you pick one.</Text> : null}

        <Notes pageId={pageId} notes={out.notes} links={out.links} version={out.versions} latest={latest ? { by: data.me && latest.by === data.me.id ? "you" : data.nameOf(latest.by), at: latest.at } : null} now={now} setFlash={setFlash} onHistory={() => setHistOpen((v) => !v)} />
        {histOpen ? <NotesHistory pageId={pageId} versions={verList} current={out.versions} now={now} setFlash={setFlash} setErr={setErr} onClose={() => setHistOpen(false)} /> : null}

        <SectionHead title="Mentioned in" sub="chats, runs and records" testID="page-mentions-head" />
        <View testID="page-mentions">
          {mentions.length > 0 ? each(mentions.slice(0, 6), (b) => <Mention key={`${b.kind}:${b.ref}:${b.at}`} b={b} now={now} />) : <Text style={p.none}>Not mentioned anywhere yet.</Text>}
        </View>

        <SectionHead title="Related" sub="one hop out" testID="page-related-head" right={(
          <Pressable accessibilityRole="button" testID="page-open-graph" onPress={() => nav.go({ v: "graph", focus: pageId, scope: "around" })} style={({ hovered }: { hovered?: boolean }) => [p.quiet, hovered === true && p.over]}><Icon name="graph" size={13} color="var(--ink-2)" /><Text style={p.quietText}>Open in Graph</Text></Pressable>
        )} />
        <Mini title={page.title} kind={page.kind} near={near} />

        {exportText !== null ? (
          <View style={p.exp} testID="page-export">
            <View style={p.expHead}><Text style={p.secSub}>Markdown export</Text><TextButton label="Close" onPress={() => setExportText(null)} /></View>
            <TextInput value={exportText} multiline editable={false} accessibilityLabel="Markdown export" style={p.expText as never} />
          </View>
        ) : null}

        <View style={p.foot}>
          <Pressable accessibilityRole="button" testID="page-history" onPress={() => nav.go({ v: "history", pageId })} style={({ hovered }: { hovered?: boolean }) => [p.quiet, hovered === true && p.over]}><Icon name="history" size={13} color="var(--ink-2)" /><Text style={p.quietText}>History</Text></Pressable>
          <Pressable accessibilityRole="button" testID="page-trash" onPress={() => nav.go({ v: "trash", pageId })} style={({ hovered }: { hovered?: boolean }) => [p.quiet, hovered === true && p.over]}><Icon name="trash" size={13} color="var(--ink-2)" /><Text style={p.quietText}>{trashed > 0 ? `Trash · ${trashed}` : "Trash"}</Text></Pressable>
          <View style={p.grow} />
          <Text style={p.secSub} testID="page-counts">{plural(facts.length, "fact")} · {plural(mentions.length, "mention")}</Text>
        </View>
      </KnowColumn>
      {menu.element}
    </View>
  );
}

// ---------------------------------------------------------------- the question card

function Conflict({ question, now, setFlash, setErr }: { question: Question; now: number; setFlash: (f: FlashState | null) => void; setErr: (t: string | null) => void }): ReactElement {
  const data = useMemoryData();
  const menu = useMenu();
  const [a, b] = question.facts as KFact[];
  const [busy, setBusy] = useState(false);
  const who = (f: KFact): string => (f.byKind === "upkeep" ? "Upkeep" : f.by ? (data.me && f.by === data.me.id ? "you" : data.nameOf(f.by)) : "");
  const sub = (f: KFact): string => `${who(f) ? `${who(f)} in ` : ""}${f.sourceTitle ?? "a source"} · ${ageText(f.learnedAt, now)}`;
  if (!a || !b) return <View />;
  const prefix = sharedStart(a.text, b.text).trim();
  const answer = (res: "keep_a" | "keep_b" | "keep_both" | "drop"): void => {
    if (busy) return;
    setBusy(true); setErr(null);
    resolveQuestion(data, question.questionId, res)
      .then(() => {
        setBusy(false);
        const win = res === "keep_a" ? a : res === "keep_b" ? b : null, lose = res === "keep_a" ? b : res === "keep_b" ? a : null;
        const undo = (ids: string[]): (() => void) => () => { for (const id of ids) void restoreFact(data, id).catch((e: unknown) => setErr(errorText(e, "Could not restore the fact"))); };
        if (win && lose) setFlash({ text: `Kept “${choiceText(win.text, lose.text)}”. The other went to Trash.`, undo: undo([lose.factId]) });
        else if (res === "keep_both") setFlash({ text: "Kept both. The question is closed." });
        else setFlash({ text: "Kept neither. Both went to Trash.", undo: undo([a.factId, b.factId]) });
      })
      .catch((e: unknown) => { setBusy(false); setErr(errorText(e, "Could not answer the question")); });
  };
  const entries = (): MenuEntry[] => [
    { label: "Keep the first", onSelect: () => answer("keep_a") }, { label: "Keep the second", onSelect: () => answer("keep_b") }, { label: "Keep both", onSelect: () => answer("keep_both") },
    { separator: true }, { label: "Neither", danger: true, onSelect: () => answer("drop") },
  ];
  const trig = menuTrigger((x, y) => menu.show(entries(), x, y));
  return (
    <View style={c.card} testID="page-question" accessibilityLabel="A question about two facts" {...(trig as object)}>
      <View style={c.top}>
        <Icon name="info" size={14} color="var(--accent)" />
        <Text style={c.q}>{prefix ? `Which is right for “${prefix}”?` : "Which of these is right?"}</Text>
        <View style={p.grow} />
        <Pressable accessibilityRole="button" accessibilityLabel="More" testID="question-more" onPress={(e) => { const pt = pointOf(e); menu.show(entries(), pt.x, pt.y); }} style={({ hovered }: { hovered?: boolean }) => [p.more, hovered === true && p.over]}><Icon name="more" size={14} color="var(--ink-3)" /></Pressable>
      </View>
      <Text style={c.sub}>Two facts cannot both be true. The other one goes to Trash.</Text>
      <View style={c.opts}>
        {each([a, b], (f, i) => (
          <Pressable key={f.factId} accessibilityRole="button" accessibilityLabel={`Keep this one: ${f.text}`} testID={`question-keep-${i === 0 ? "a" : "b"}`} onPress={() => answer(i === 0 ? "keep_a" : "keep_b")} style={({ hovered }: { hovered?: boolean }) => [c.opt, hovered === true && p.over]}>
            <Text style={c.optText}>{choiceText(f.text, i === 0 ? b.text : a.text)}</Text>
            <View style={c.optSrc}><Text style={p.secSub}>{sub(f)}</Text></View>
          </Pressable>
        ))}
      </View>
      <View style={c.more}>
        <TextButton label="Keep both" testID="question-keep-both" onPress={() => answer("keep_both")} />
        <TextButton label="Neither" testID="question-drop" onPress={() => answer("drop")} />
      </View>
      {menu.element}
    </View>
  );
}

// ---------------------------------------------------------------- Notes

interface NotesProps { pageId: string; notes: string; links: readonly PageLink[]; version: number; latest: { by: string; at: number } | null; now: number; setFlash: (f: FlashState | null) => void; onHistory: () => void }

function Notes({ pageId, notes, links, version, latest, now, setFlash, onHistory }: NotesProps): ReactElement {
  const data = useMemoryData();
  const menu = useMenu();
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(version);
  const [err, setErr] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const draft = useRef(notes);
  const start = (): void => { draft.current = notes; setBase(version); setErr(null); setStale(false); setRound((r) => r + 1); setEditing(true); };
  const done = (): void => {
    if (busy) return;
    if (draft.current === notes) { setEditing(false); return; }
    setBusy(true); setErr(null);
    putNotes(data, pageId, draft.current, base)
      .then(() => { setBusy(false); setEditing(false); setStale(false); })
      .catch((e: unknown) => { setBusy(false); if (isStale(e)) setStale(true); else setErr(errorText(e, "Could not save the Notes")); });
  };
  const reload = (): void => {
    const mine = draft.current;
    const kept = copy(mine);
    draft.current = notes; setBase(version); setStale(false); setErr(null); setRound((r) => r + 1);
    setFlash({ text: kept ? "Reloaded the latest Notes. Your text was copied so you can merge it." : "Reloaded the latest Notes." });
  };
  const by = latest ? `Last edited by ${latest.by}, ${dateText(latest.at, now)}` : "People and agents can both write here";
  const trig = menuTrigger((x, y) => menu.show([{ label: editing ? "Done" : "Edit Notes", onSelect: editing ? done : start }, { label: "History", onSelect: onHistory }], x, y));
  return (
    <View>
      <SectionHead title="Notes" sub={by} testID="page-notes-head" right={editing ? (
        <Pressable accessibilityRole="button" testID="notes-done" disabled={busy} onPress={done} style={({ hovered }: { hovered?: boolean }) => [p.quiet, hovered === true && p.over]}><Icon name="check" size={13} color="var(--ink-2)" /><Text style={p.quietText}>Done</Text></Pressable>
      ) : (
        <Pressable accessibilityRole="button" testID="notes-edit" onPress={start} style={({ hovered }: { hovered?: boolean }) => [p.quiet, hovered === true && p.over]}><Icon name="edit" size={13} color="var(--ink-2)" /><Text style={p.quietText}>Edit</Text></Pressable>
      )} />
      {editing ? (
        <View>
          <NotesEditor key={round} initial={draft.current} onDraft={(t) => { draft.current = t; }} onDone={done} />
          <Text style={p.hint}>Type [[ to link a person, client, project, topic or agent. Links feed the graph.</Text>
          {stale ? <View style={p.stale} accessibilityRole="alert" testID="notes-stale"><Text style={p.staleText}>Someone else changed these Notes. Reload to merge.</Text><TextButton label="Reload" accent testID="notes-reload" onPress={reload} /></View> : null}
          {err ? <Text style={p.err} accessibilityRole="alert" testID="notes-error">{err}</Text> : null}
        </View>
      ) : notes !== "" ? (
        <View testID="page-notes" {...(trig as object)}><NotesRead notes={notes} links={links} /></View>
      ) : (
        <Text style={p.none} {...(trig as object)}>No notes yet. Press Edit to write some.</Text>
      )}
      {menu.element}
    </View>
  );
}

function NotesRead({ notes, links }: { notes: string; links: readonly PageLink[] }): ReactElement {
  const { nav } = useMemoryData();
  return (
    <Text style={p.notes}>
      {each(notePieces(notes, links), (piece, i) => {
        if (!piece.link) return <Text key={i}>{piece.text}</Text>;
        if (!piece.pageId) return <Text key={i} style={p.dead} accessibilityLabel={`${piece.text}. No page yet. It is created when you press Done.`} {...({ title: "No page yet. It is created when you press Done." } as object)}>{piece.text}</Text>;
        const go = (): void => nav.go({ v: "page", pageId: piece.pageId! });
        return (
          <Text key={i} style={p.link} accessibilityRole="link" accessibilityLabel={`Open the page ${piece.text}`} onPress={go} {...({ tabIndex: 0, onKeyDown: (e: { key: string; preventDefault(): void }) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } } } as object)}>{piece.text}</Text>
        );
      })}
    </Text>
  );
}

/** The multiline Notes field with the [[ menu. Typing [[ lists matching page titles under the caret; the arrows, Enter or Tab pick, Escape closes, a press picks. */
function NotesEditor({ initial, onDraft, onDone }: { initial: string; onDraft: (t: string) => void; onDone: () => void }): ReactElement {
  const [text, setText] = useState(initial);
  const [sel, setSel] = useState(initial.length);
  const [hi, setHi] = useState(0);
  const [shut, setShut] = useState<number | null>(null);
  const box = useRef<unknown>(null);
  const open = openLinkAt(text, sel);
  const q = useSafeLive("memory.page.list", { q: open?.query ?? "", limit: 6 });
  const items = open && shut !== open.start && q.status === "ready" ? q.data.pages.slice(0, 6) : [];
  const set = (t: string, caret: number): void => { setText(t); setSel(caret); setHi(0); onDraft(t); };
  const pick = (title: string): void => {
    const r = completeLink(text, sel, title);
    if (!r) return;
    set(r.text, r.caret);
    setTimeout(() => { const el = box.current as { setSelectionRange?: (a: number, b: number) => void; focus?: () => void } | null; el?.focus?.(); el?.setSelectionRange?.(r.caret, r.caret); }, 0);
  };
  const spot = caretSpot(text, sel);
  const onKey = (e: { nativeEvent: { key: string }; preventDefault?: () => void }): void => {
    if (items.length === 0) return;
    const k = e.nativeEvent.key;
    if (k === "ArrowDown" || k === "ArrowUp") { e.preventDefault?.(); setHi((i) => stepIndex(i, items.length, k)); }
    else if (k === "Enter" || k === "Tab") { e.preventDefault?.(); pick(items[Math.min(hi, items.length - 1)]!.title); }
    else if (k === "Escape") { e.preventDefault?.(); if (open) setShut(open.start); }
  };
  return (
    <View style={n.wrap}>
      <TextInput
        ref={(r) => { box.current = r; }} value={text} multiline numberOfLines={5} autoFocus accessibilityLabel="Notes" testID="notes-input" placeholder="Write anything. Type [[ to link a page."
        onChange={(e) => { const t = e.nativeEvent.text, el = (e as unknown as { target?: { selectionStart?: number } }).target; set(t, typeof el?.selectionStart === "number" ? el.selectionStart : t.length); }}
        onSelectionChange={(e) => setSel(e.nativeEvent.selection.start)} onKeyPress={onKey as never}
        {...({ onKeyDown: (e: { key: string; metaKey?: boolean; ctrlKey?: boolean }) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && items.length === 0) onDone(); } } as object)}
        style={n.input as never}
      />
      {items.length > 0 ? (
        <View style={[n.menu, { top: spot.top, left: spot.left }]} accessibilityRole="menu" accessibilityLabel="Link to a page" testID="notes-link-menu">
          {each(items, (pg, i) => (
            <Pressable key={pg.pageId} accessibilityRole="menuitem" accessibilityLabel={pg.title} accessibilityState={{ selected: i === hi }} testID={`notes-link-${pg.pageId}`} onPress={() => pick(pg.title)} style={[n.item, i === hi && n.itemOn]}>
              <Text style={n.itemText}>{pg.title}</Text><Text style={n.itemKind}>{KIND_ONE[pg.kind]}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function NotesHistory({ pageId, versions, current, now, setFlash, setErr, onClose }: { pageId: string; versions: Array<{ version: number; by: string; at: number; reason?: string; notes: string }>; current: number; now: number; setFlash: (f: FlashState | null) => void; setErr: (t: string | null) => void; onClose: () => void }): ReactElement {
  const data = useMemoryData();
  const restore = (v: number): void => {
    setErr(null);
    restoreNotesVersion(data, pageId, v)
      .then(() => setFlash({ text: `Restored version ${v} of the Notes. The newer one is kept in history.`, undo: () => { void restoreNotesVersion(data, pageId, current).catch((e: unknown) => setErr(errorText(e, "Could not undo the restore"))); } }))
      .catch((e: unknown) => setErr(errorText(e, "Could not restore that version")));
  };
  return (
    <View style={h.box} testID="notes-history" accessibilityLabel="History of the Notes">
      <View style={h.top}><Text style={p.secSub}>History of the Notes</Text><View style={p.grow} /><TextButton label="Close" testID="notes-history-close" onPress={onClose} /></View>
      {versions.length === 0 ? <Text style={p.none}>No earlier versions. Edits are kept here, never overwritten.</Text> : null}
      {each(versions, (v) => (
        <View key={v.version} style={h.row} testID={`notes-version-${v.version}`}>
          <View style={h.main}>
            <Text style={h.who}>{v.version === current ? "Now" : `Version ${v.version}`} · {data.me && v.by === data.me.id ? "You" : data.nameOf(v.by)} · {stampText(v.at, now)}</Text>
            <Text style={h.text} numberOfLines={2}>{v.notes === "" ? "Empty" : v.notes}</Text>
          </View>
          {v.version !== current ? <TextButton label="Restore this version" accent testID={`notes-restore-${v.version}`} a11y={`Restore version ${v.version} of the Notes`} onPress={() => restore(v.version)} /> : null}
        </View>
      ))}
      <View style={h.foot}><TextButton label="Show all history" onPress={() => data.nav.go({ v: "history", pageId })} /></View>
    </View>
  );
}

// ---------------------------------------------------------------- Mentioned in, Related

function Mention({ b, now }: { b: Backlink; now: number }): ReactElement {
  const data = useMemoryData();
  const menu = useMenu();
  const open = (): void => { if (b.link) data.nav.openChat(b.link); else if (b.kind === "page") data.nav.go({ v: "page", pageId: b.ref }); else data.nav.openSource(b.ref); };
  const trig = menuTrigger((x, y) => menu.show([{ label: "Open", onSelect: open }, { label: "Copy link", onSelect: () => { void copy(b.link ?? `vyre://knowledge/${b.ref}`); } }], x, y));
  return (
    <View {...(trig as object)}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${b.title}`} testID={`mention-${b.ref}`} onPress={open} style={({ hovered }: { hovered?: boolean }) => [m.row, hovered === true && p.over]}>
        <View style={m.ic}><Icon name={KIND_ICON[b.kind] ?? "note"} size={14} color="var(--ink-3)" /></View>
        <View style={m.body}><Text style={m.title} numberOfLines={1}>{b.title}</Text><Text style={m.quote} numberOfLines={1}>{b.quote}</Text></View>
        <Text style={m.date}>{dateText(b.at, now)}</Text>
      </Pressable>
      {menu.element}
    </View>
  );
}

function Mini({ title, kind, near }: { title: string; kind: string; near: Neighbour[] }): ReactElement {
  const { nav } = useMemoryData();
  const W = 700, H = 230;
  const pos = radial(near.length, W, H);
  return (
    <View style={r.box} testID="page-map" accessibilityLabel={`Pages one hop from ${title}`}>
      {Platform.OS === "web" ? createElement("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", "aria-hidden": true, style: { position: "absolute", left: 0, top: 0, width: "100%", height: "100%" } }, ...each(pos, (pt, i) => createElement("line", { key: i, x1: W / 2, y1: H / 2, x2: pt.x, y2: pt.y, stroke: "var(--line)", strokeWidth: 1, vectorEffect: "non-scaling-stroke" }))) : null}
      {each(near, (nb, i) => <Node key={nb.id} nb={nb} x={pos[i]!.x / W} y={pos[i]!.y} go={() => { if (nb.link) nav.openChat(nb.link); else if (nb.pageId) nav.go({ v: "page", pageId: nb.pageId }); else nav.openNote(nb.id); }} focus={() => nav.go({ v: "graph", focus: nb.id, scope: "around" })} />)}
      <View style={[r.node, { left: "50%", top: H / 2 - 9 }]} pointerEvents="none"><View style={[r.dot, r.big, { backgroundColor: hue(kind) }]} /><Text style={[r.label, r.ctr]} numberOfLines={1}>{title}</Text></View>
    </View>
  );
}

function Node({ nb, x, y, go, focus }: { nb: Neighbour; x: number; y: number; go: () => void; focus: () => void }): ReactElement {
  const menu = useMenu();
  const trig = menuTrigger((px, py) => menu.show([{ label: nb.link ? "Open the chat" : "Open", onSelect: go }, { label: "Open in Graph", onSelect: focus }], px, py));
  return (
    <View style={[r.node, { left: `${x * 100}%`, top: y - 9 }]} {...(trig as object)}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${nb.title}`} testID={`map-${nb.id}`} onPress={go} style={({ hovered }: { hovered?: boolean }) => [r.hit, hovered === true && p.over]}>
        <View style={[r.dot, nb.kind === "chat" && r.sq, { backgroundColor: hue(nb.kind) }]} />
        <Text style={r.label} numberOfLines={1}>{nb.title}</Text>
      </Pressable>
      {menu.element}
    </View>
  );
}

const p = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 14 },
  headText: { flex: 1, minWidth: 0 },
  name: { margin: 0, fontSize: 20, fontWeight: "600", color: "var(--ink)" as string },
  sub: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginTop: 3 },
  subText: { fontSize: 13, color: "var(--ink-2)" as string },
  badge: { height: 20, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 7, borderRadius: 6, backgroundColor: "var(--sunk)" as string },
  badgeText: { fontSize: 12, color: "var(--ink-2)" as string },
  vis: { height: 24, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 5, borderRadius: 6 },
  visWho: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, marginRight: 3 },
  blurb: { marginTop: 12, fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  more: { width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  over: { backgroundColor: "var(--hover)" as string },
  err: { marginTop: 10, fontSize: 12.5, color: "var(--danger)" as string },
  none: { paddingVertical: 8, paddingHorizontal: 0, fontSize: 13, color: "var(--ink-3)" as string },
  notes: { fontSize: 14.5, lineHeight: 23, color: "var(--ink)" as string, maxWidth: 640 },
  link: { color: "var(--accent)" as string, textDecorationLine: "underline", cursor: "pointer" } as never,
  dead: { color: "var(--ink-4)" as string, textDecorationLine: "underline", textDecorationStyle: "dotted" } as never,
  hint: { marginTop: 6, fontSize: 12, color: "var(--ink-3)" as string },
  stale: { marginTop: 8, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, height: 36, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  staleText: { flex: 1, fontSize: 13, color: "var(--danger)" as string },
  quiet: { height: 26, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 6 },
  quietText: { fontSize: 12.5, fontWeight: "500", color: "var(--ink-2)" as string },
  secSub: { fontSize: 12, color: "var(--ink-3)" as string },
  foot: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 28, paddingTop: 12, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  grow: { flex: 1 },
  center: { alignItems: "center" },
  exp: { marginTop: 16, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  expHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: 12, paddingRight: 4, height: 32 },
  expText: { minHeight: 120, maxHeight: 240, padding: 12, color: "var(--ink)", fontSize: 12.5, fontFamily: "monospace", outlineStyle: "none" },
});

const c = StyleSheet.create({
  card: { marginTop: 4, marginBottom: 6, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  q: { fontSize: 14, fontWeight: "600", color: "var(--ink)" as string },
  sub: { marginTop: 4, marginLeft: 22, fontSize: 12.5, lineHeight: 18, color: "var(--ink-2)" as string },
  opts: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  opt: { flexGrow: 1, flexBasis: 260, padding: 11, borderRadius: 9, borderWidth: 1, borderColor: "var(--line)" as string, backgroundColor: "var(--sunk)" as string },
  optText: { fontSize: 13.5, fontWeight: "600", color: "var(--ink)" as string },
  optSrc: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7, marginTop: 5 },
  more: { flexDirection: "row", gap: 4, marginTop: 8 },
});

const n = StyleSheet.create({
  wrap: { position: "relative" },
  input: { minHeight: 110, padding: 12, borderRadius: 9, borderWidth: 1, borderColor: "var(--accent)", backgroundColor: "var(--field)", color: "var(--ink)", fontSize: 14.5, lineHeight: 20, outlineStyle: "none" },
  menu: { position: "absolute", zIndex: 40, minWidth: 220, maxWidth: 320, padding: 5, borderRadius: 10, backgroundColor: "var(--raised)" as string, boxShadow: "var(--sh-pop)" as string, borderWidth: 1, borderColor: "var(--line)" as string } as never,
  item: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, height: 28, paddingHorizontal: 9, borderRadius: 6 },
  itemOn: { backgroundColor: "var(--hover)" as string },
  itemText: { fontSize: 13, color: "var(--ink)" as string },
  itemKind: { fontSize: 11.5, color: "var(--ink-3)" as string },
});

const h = StyleSheet.create({
  box: { marginTop: 10, borderRadius: 10, borderWidth: 1, borderColor: "var(--line)" as string },
  top: { flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 4, height: 32 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
  main: { flex: 1, minWidth: 0 },
  who: { fontSize: 12, fontWeight: "600", color: "var(--ink-2)" as string },
  text: { marginTop: 2, fontSize: 12.5, lineHeight: 18, color: "var(--ink-3)" as string },
  foot: { flexDirection: "row", paddingHorizontal: 4, paddingVertical: 4, borderTopWidth: 1, borderTopColor: "var(--line)" as string },
});

const m = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 8 },
  ic: { width: 20, alignItems: "center", paddingTop: 2 },
  body: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  quote: { marginTop: 1, fontSize: 12.5, color: "var(--ink-3)" as string },
  date: { fontSize: 12, color: "var(--ink-3)" as string, fontVariant: ["tabular-nums"] },
});

const r = StyleSheet.create({
  box: { position: "relative", height: 230, borderRadius: 12, borderWidth: 1, borderColor: "var(--line)" as string, overflow: "hidden" },
  node: { position: "absolute", width: 150, marginLeft: -75, alignItems: "center" },
  hit: { alignItems: "center", paddingHorizontal: 6, paddingBottom: 2, borderRadius: 6, maxWidth: 150 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  sq: { borderRadius: 4 },
  big: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: "var(--accent)" },
  label: { marginTop: 4, fontSize: 11.5, color: "var(--ink-2)" as string, textAlign: "center" },
  ctr: { fontWeight: "600", color: "var(--ink)" as string },
});
