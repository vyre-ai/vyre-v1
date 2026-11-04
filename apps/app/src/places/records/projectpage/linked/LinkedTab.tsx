// The project's Linked tab (owner, 4 Nov 2026): everything attached to a project as a live reference, grouped, with a "Show" menu (no pills), Link something, Link automatically rules with an auto mark on what a rule linked,
// and, for a project whose repository is linked, the CI rows with the failure line and a fix card. Every link follows the access rule: reach() gives a live link when the viewer can open it, else a safe peek
// ("A task you don't have access to · Ask for access"), never a link to a place they cannot open.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { ReachRow } from "../../../../../../../ui/src/Row/ReachRow.tsx";
import { menuTrigger, useMenu } from "../../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../../ui/src/Menu/index.tsx";
import { act, hint } from "../../../../shell/reach/reach.ts";
import type { Target, Viewer } from "../../../../shell/reach/reach.ts";
import { useProjectPageData } from "../data.tsx";
import { LinkSheet } from "./LinkSheet.tsx";
import { RuleSheet } from "./RuleSheet.tsx";
import { CiGroup } from "./CiRows.tsx";
import { GROUPS, SHOWS, askResource, byLine, countFor, filterLinks, groupOf, isOutside, itemTypeOf, levelOf, reachOf, ruleInput, ruleText, titleOf, toneOf } from "./model.ts";
import type { Link, Out, Run, Show } from "./model.ts";

export interface LinkedTabProps {
  projectId: string;
  projectTitle?: string;
  /** The person may change the project: link, unlink, make rules. */
  canEdit: boolean;
  /** One quiet line at the foot of the page. */
  say?(text: string): void;
  /** Where a reach target opens (the shell's door). Without it only files, records and chats open, through the page's own navigation. */
  open?(target: Target): void;
  openUrl?(url: string): void;
  /** Starts a chat with the Assistant (the fix card's button). Without it the card has no button. */
  askAssistant?(text: string): void;
  show?: Show;
}

type Notice = { text: string; undo?: () => Promise<void> };
const idem = (what: string): string => `${what}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const msg = (e: unknown): string => (e instanceof Error && e.message ? e.message : "That did not work. Try again.");

/** The menu anchors under the control that has the focus. */
function anchor(): { x: number; y: number } {
  const doc = (globalThis as { document?: { activeElement?: { getBoundingClientRect?: () => { left: number; right: number; bottom: number } } | null } }).document;
  const b = doc?.activeElement?.getBoundingClientRect?.();
  return b ? { x: Math.max(8, b.right - 200), y: b.bottom + 4 } : { x: 8, y: 48 };
}

export function LinkedTab({ projectId, projectTitle = "this project", canEdit, say: sayProp, open, openUrl: urlProp, askAssistant: askProp, show: first = "All" }: LinkedTabProps): ReactElement {
  const d = useProjectPageData();
  const openUrl = urlProp ?? d.nav.openUrl;
  const askAssistant = askProp ?? d.nav.askAssistant;
  const [data, setData] = useState<Out | null>(null);
  const [runs, setRuns] = useState<readonly Run[]>([]);
  const [repo, setRepo] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [show, setShow] = useState<Show>(first);
  const [sheet, setSheet] = useState<"link" | "rule" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const menu = useMenu();
  const say = (text: string): void => { if (sayProp) sayProp(text); else setNotice({ text }); };
  const meId = d.me?.id ?? "me";
  const viewer: Viewer = useMemo(() => ({ id: meId }), [meId]);

  const read = useCallback(async (): Promise<void> => {
    try {
      setData((await d.call("projects.links.list", { projectId })) as Out);
      setFailed(false);
    } catch { setFailed(true); }
    // CI shows only for a project whose repository is linked and runners are on; a refusal here just means no CI rows
    try {
      const ci = (await d.call("ci.project.get", { projectId })) as { linked: boolean; repo: string | null; enabled: boolean };
      if (ci.linked && ci.enabled) {
        setRepo(ci.repo);
        setRuns(((await d.call("ci.runs.list", { projectId, limit: 10 })) as { runs: Run[] }).runs);
      } else { setRepo(null); setRuns([]); }
    } catch { setRepo(null); setRuns([]); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    if (notice === null) return undefined;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => d.changes?.subscribe(() => { void read(); }), [d.changes, read]);

  const links = data?.links ?? [];
  const rules = data?.rules ?? [];
  const total = links.length + runs.length;

  const openLink = (l: Link): void => {
    const r = reachOf(l, viewer);
    if (isOutside(l)) { if (l.url) (openUrl ?? ((u: string) => { (globalThis as { open?: (u: string, t: string, f: string) => void }).open?.(u, "_blank", "noopener"); }))(l.url); return; }
    act(r, {
      open: (target) => {
        // the page's own navigation for what it knows, the shell's door for the rest
        if (l.kind === "file") { d.nav.openFile(l.ref); return; }
        if (l.kind === "chat") { d.nav.openThread(l.ref); return; }
        if (l.kind === "record") { const i = l.ref.indexOf("/"); if (i > 0) { d.nav.openRecord(l.ref.slice(0, i), l.ref.slice(i + 1)); return; } }
        if (d.nav.openItem) d.nav.openItem(itemTypeOf(l), l.ref); else if (open) open(target); else say(`Opens ${titleOf(l)}`);
      },
      peek: () => setPeek((cur) => (cur === l.linkId ? null : l.linkId)),
    });
  };

  const unlink = async (l: Link): Promise<void> => {
    try {
      await d.call("projects.links.unlink", { projectId, kind: l.kind, ref: l.ref });
      setNotice({
        text: l.source === "rule" ? `Unlinked ${titleOf(l)}. It will not come back` : `Unlinked ${titleOf(l)}`,
        undo: async () => {
          await d.call("projects.links.link", { projectId, kind: l.kind, ref: l.ref, ...(l.state ? { state: l.state } : {}), ...(l.label ? { label: l.label } : {}), ...(l.url ? { url: l.url } : {}) });
          setNotice(null);
          await read();
        },
      });
      await read();
    } catch (e) { say(msg(e)); }
  };

  const ask = async (l: Link): Promise<void> => {
    const res = askResource(l);
    if (res === null) return;
    try {
      await d.call("access.request", { resource: res, level: "view", note: `Linked to ${projectTitle}`, idempotencyKey: idem(`ask-${l.linkId}`) });
      setAsked((s) => new Set(s).add(l.linkId));
    } catch (e) { setProblem(msg(e)); }
  };

  const rowMenu = (l: Link, x: number, y: number): void => {
    const items: MenuEntry[] = [];
    if (levelOf(l) !== "none") items.push({ label: "Open", onSelect: () => openLink(l) });
    if (levelOf(l) !== "none") items.push({ label: "Copy link", onSelect: () => { void (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard?.writeText?.(l.url ?? `vyre://${itemTypeOf(l)}/${l.ref}`); say("Link copied"); } });
    if (canEdit) { if (items.length > 0) items.push({ separator: true }); items.push({ label: "Unlink", danger: true, onSelect: () => void unlink(l) }); }
    if (items.length > 0) menu.show(items, x, y, "other", { label: "Linked item" });
  };

  const showMenu = (): void => {
    const at = anchor();
    menu.show(SHOWS.map((s) => ({ label: s, checked: show === s, count: countFor(links, runs, s), onSelect: () => setShow(s) })), at.x - 80, at.y, "other", { label: "Show" });
  };

  const removeRule = async (id: string): Promise<void> => {
    const was = rules;
    const gone = was.find((r) => r.ruleId === id);
    if (!gone) return;
    try {
      await d.call("projects.links.rules.set", { projectId, rules: was.filter((r) => r.ruleId !== id).map(ruleInput) });
      setNotice({ text: `Removed the rule: ${ruleText(gone)}. Linked items stay`, undo: async () => { await d.call("projects.links.rules.set", { projectId, rules: was.map(ruleInput) }); setNotice(null); await read(); } });
      await read();
    } catch (e) { say(msg(e)); }
  };

  const groups = GROUPS.filter((g) => show === "All" || show === g).map((g) => {
    const rows = filterLinks(links, show).filter((l) => groupOf(l) === g);
    const ci = g === "Code" && repo !== null && runs.length > 0;
    if (rows.length === 0 && !ci) return null;
    return (
      <View key={g} style={st.group} testID={`linked-group-${g}`}>
        <View style={st.gh}><Text accessibilityRole="header" style={st.gt}>{g}</Text><Text style={st.num}>{rows.length + (ci ? runs.length : 0)}</Text></View>
        {ci ? <CiGroup repo={repo!} runs={runs} now={d.now()} projectTitle={projectTitle} {...(askAssistant ? { askAssistant } : {})} /> : null}
        {rows.map((l) => renderRow(l))}
      </View>
    );
  });

  function renderRow(l: Link): ReactElement {
    const r = reachOf(l, viewer);
    const locked = levelOf(l) === "none";
    const by = byLine(l, meId, d.nameOf);
    const tone = toneOf(l.state);
    const id = l.linkId;
    const subject = isOutside(l) ? undefined : { type: itemTypeOf(l), id: l.kind === "record" && l.ref.includes("/") ? l.ref.slice(l.ref.indexOf("/") + 1) : l.ref };
    const rowProps = {
      id: `lk-${id}`, title: titleOf(l), tall: true,
      note: locked ? `You can't open this \u00B7 ${by.by}` : by.by,
      ...(hint(r) ? { hint: hint(r)! } : {}),
      leading: <View style={st.kind}><Text style={st.kindText}>{locked ? "\u{1F512}\uFE0E" : KIND_MARK[l.kind]}</Text></View>,
      ...(by.auto ? { titleMarks: <Text testID={`link-auto-${id}`} accessibilityLabel="Linked by a rule" style={st.auto}>AUTO</Text> } : {}),
      trailing: (
        <View style={st.trail}>
          {!locked && l.state ? <Text style={[st.state, tone === "ok" && st.ok, tone === "bad" && st.bad, tone === "warn" && st.warn]} testID={`link-state-${id}`}>{l.state}</Text> : null}
          {(!locked || canEdit) ? <Pressable accessibilityRole="button" accessibilityLabel={`More for ${titleOf(l)}`} testID={`link-more-${id}`} onPress={() => { const a = anchor(); rowMenu(l, a.x, a.y); }} style={({ hovered }: { hovered?: boolean }) => [st.more, hovered === true && st.hover]}><Text style={st.moreText}>{"\u2026"}</Text></Pressable> : null}
        </View>
      ),
      domProps: menuTrigger((x, y) => rowMenu(l, x, y)),
    };
    // a row that opens something asks the Space's link policy how to draw (ui/reach), so a link and its hover never disagree; what the viewer cannot open is a peek row of our own (Ask for access)
    return (
      <View key={id} testID={`link-${id}`}>
        {locked ? <Row {...rowProps} locked onPress={() => openLink(l)} /> : <ReachRow {...rowProps} {...(subject ? { subject } : {})} onPress={() => openLink(l)} />}
        {peek === id ? (
          <View testID={`link-peek-${id}`} accessibilityRole="summary" style={st.peek}>
            <Text style={st.peekTitle}>{titleOf(l)}</Text>
            <Text style={st.sub}>{`Linked by ${l.addedBy === meId ? "you" : d.nameOf(l.addedBy)}. You can see that it is linked, not what is in it.`}</Text>
            {asked.has(id) ? <Text testID={`link-asked-${id}`} style={st.sub}>Asked for access. You will hear when someone answers.</Text>
              : <Pressable accessibilityRole="button" testID={`link-ask-${id}`} onPress={() => void ask(l)} style={st.askBtn}><Text style={st.askText}>Ask for access</Text></Pressable>}
            {problem !== null ? <Text accessibilityRole="alert" testID={`link-problem-${id}`} style={st.bad}>{problem}</Text> : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView style={st.scroll} contentContainerStyle={st.in} testID="project-linked">
      {menu.element}
      <View style={st.head}>
        <Text accessibilityRole="header" aria-level={2} style={st.h2}>Linked</Text>
        <Text style={st.num} testID="linked-total">{total}</Text>
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Show: ${show}`} testID="linked-show" onPress={showMenu} style={({ hovered }: { hovered?: boolean }) => [st.show, hovered === true && st.hover]}><Text style={st.showText}>{"Show: "}<Text style={st.showOn}>{show}</Text>{" ▾"}</Text></Pressable>
        {canEdit ? <Pressable accessibilityRole="button" testID="linked-add" onPress={() => setSheet("link")} style={st.primary}><Text style={st.primaryText}>Link something</Text></Pressable> : null}
      </View>
      {failed ? <Text accessibilityRole="alert" testID="linked-failed" style={st.bad}>Linked items could not be read. Try again.</Text> : null}
      {notice !== null ? (
        <View testID="linked-notice" accessibilityLiveRegion="polite" style={st.notice}>
          <Text style={st.noticeText}>{notice.text}</Text>
          {notice.undo ? <Pressable accessibilityRole="button" testID="linked-undo" onPress={() => void notice.undo!().catch((e) => say(msg(e)))}><Text style={st.askText}>Undo</Text></Pressable> : null}
        </View>
      ) : null}
      {data !== null && total === 0 && show === "All" ? <Text testID="linked-empty" style={st.empty}>Nothing is linked yet. Link an invoice, a file, a chat or a pull request. Agents and rules link things here too.</Text> : null}
      {data !== null && total > 0 && groups.every((g) => g === null) ? <Text testID="linked-none" style={st.empty}>{`Nothing ${show.toLowerCase()} is linked.`}</Text> : null}
      {groups}
      <View style={st.group} testID="linked-rules">
        <View style={st.gh}>
          <Text accessibilityRole="header" style={st.gt}>Link automatically</Text>
          <View style={{ flex: 1 }} />
          {canEdit ? <Pressable accessibilityRole="button" testID="rule-new" onPress={() => setSheet("rule")} style={({ hovered }: { hovered?: boolean }) => [st.quiet, hovered === true && st.hover]}><Text style={st.askText}>Add a rule</Text></Pressable> : null}
        </View>
        {rules.length === 0 ? <Text testID="rules-empty" style={st.empty}>No rules. A rule links matching things from now on, for example everything from a repository or every invoice for a client.</Text> : null}
        {rules.map((r) => {
          const n = links.filter((l) => l.ruleId === r.ruleId).length;
          return (
            <View key={r.ruleId} style={st.rule} testID={`rule-${r.ruleId}`}>
              <Text numberOfLines={1} style={st.ruleText}>{ruleText(r)}</Text>
              <Text style={st.sub}>{`${n} ${n === 1 ? "item" : "items"} linked`}</Text>
              <View style={{ flex: 1 }} />
              {canEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove the rule: ${ruleText(r)}`} testID={`rule-remove-${r.ruleId}`} onPress={() => void removeRule(r.ruleId)} style={({ hovered }: { hovered?: boolean }) => [st.quiet, hovered === true && st.hover]}><Text style={st.sub}>Remove</Text></Pressable> : null}
            </View>
          );
        })}
      </View>
      {sheet === "link" ? <LinkSheet projectId={projectId} projectTitle={projectTitle} have={links} onClose={() => setSheet(null)} onLinked={(text, undo) => { setNotice({ text, undo }); void read(); }} /> : null}
      {sheet === "rule" ? <RuleSheet projectId={projectId} rules={rules} onClose={() => setSheet(null)} onAdded={() => { setSheet(null); setNotice({ text: "Rule added. Matching items link from now on" }); void read(); }} /> : null}
    </ScrollView>
  );
}

/** A mark for each kind, plain text so a list costs nothing. */
const KIND_MARK: Readonly<Record<Link["kind"], string>> = { task: "✓", record: "▤", calendar_event: "◴", file: "▫", chat: "◯", mail_thread: "✉︎", "github.pr": "⑂", "github.commit": "●", "ci.run": "▶", artifact: "◇", url: "↗" };

const st = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  in: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  h2: { fontSize: 20, fontWeight: "600", letterSpacing: -0.2, color: "var(--ink)" as string },
  num: { fontSize: 13, color: "var(--ink-3)" as string },
  show: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  showText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  showOn: { fontWeight: "500", color: "var(--ink)" as string },
  hover: { backgroundColor: "var(--hover)" },
  primary: { height: 30, paddingHorizontal: 13, borderRadius: 9, justifyContent: "center", backgroundColor: "var(--accent)" as string },
  primaryText: { fontSize: 13, fontWeight: "500", color: "var(--accent-ink)" as string },
  group: { marginBottom: 18 },
  gh: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 30, marginBottom: 2 },
  gt: { fontSize: 13, fontWeight: "600", color: "var(--ink-2)" as string },
  row: { flexDirection: "row", alignItems: "center" },
  trail: { flexDirection: "row", alignItems: "center", gap: 6 },
  main: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 50, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8 },
  kind: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "var(--sunk)" as string },
  kindText: { fontSize: 13, color: "var(--ink-2)" as string },
  names: { flex: 1, minWidth: 0 },
  title: { fontSize: 13.5, fontWeight: "500", color: "var(--ink)" as string },
  titleLocked: { fontWeight: "400", color: "var(--ink-2)" as string },
  sub: { fontSize: 12, color: "var(--ink-3)" as string },
  auto: { fontSize: 10.5, letterSpacing: 0.3, color: "var(--ink-3)" as string },
  state: { fontSize: 12.5, color: "var(--ink-3)" as string },
  ok: { color: "var(--ok)" as string }, bad: { color: "var(--danger)" as string, fontSize: 12.5 }, warn: { color: "var(--warn)" as string },
  more: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  moreText: { fontSize: 16, color: "var(--ink-3)" as string },
  peek: { marginLeft: 48, marginBottom: 8, padding: 10, gap: 4, borderRadius: 10, borderWidth: 1, borderColor: "var(--line-2)" as string, backgroundColor: "var(--raised)" as string },
  peekTitle: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string },
  askBtn: { alignSelf: "flex-start", marginTop: 4, height: 28, paddingHorizontal: 11, borderRadius: 8, justifyContent: "center", backgroundColor: "var(--sel)" as string },
  askText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  quiet: { height: 28, paddingHorizontal: 9, borderRadius: 8, justifyContent: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, marginBottom: 6 },
  noticeText: { flex: 1, fontSize: 13, color: "var(--ink-2)" as string },
  empty: { fontSize: 13.5, color: "var(--ink-3)" as string, paddingVertical: 6 },
  rule: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 38 },
  ruleText: { fontSize: 13.5, color: "var(--ink)" as string, flexShrink: 1 },
});
