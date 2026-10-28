// The project page (spec 3.4, 2.12): a project is a record with four tabs. Overview is the brief, the status and its update, the next milestones, what is late or waiting, decisions, people,
// linked records and pinned files. Plan is the shared Plan (Timeline, Board, List, Calendar); an edit writes projects.reschedule or tasks.update, and a slip asks to move the later tasks or keep
// their dates. Files opens the project's folder. Chat is the project's one channel: every thread of it is listed, and the arrow-out mark opens a thread as its own chat. Status, Lead and Due sit
// under the name; the channel and the folder are icon buttons. Each action is one capability call; a refusal shows as a quiet line.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { Plan } from "../../../../../../ui/src/Plan/index.tsx";
import type { PlanTask } from "../../../../../../ui/src/Plan/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { useProjectPageData } from "./data.tsx";
import { ROLE_WORDS, TAB_SPECS, ago, dateWords, dueWords, editsBetween, isoDay, planStages, planTasks, plural } from "./model.ts";
import type { Overview, PlanOut, TabKey } from "./model.ts";
import { ImportedHistory } from "./ImportedHistory.tsx";

export interface ProjectPageProps {
  projectId: string;
  onTabChange?: (tab: TabKey) => void;
  /** The tab it opens on. */
  tab?: TabKey;
  /** The Plan's view when it opens on the Plan tab. */
  planView?: "timeline" | "board" | "list" | "calendar";
}

type Load = { status: "loading" } | { status: "gone" } | { status: "ready"; overview: Overview; plan: PlanOut };

export function ProjectPage({ projectId, tab: first = "overview", planView = "timeline", onTabChange }: ProjectPageProps): ReactElement {
  const d = useProjectPageData();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<TabKey>(first);
  useEffect(() => setTab(first), [first]);
  const [note, setNote] = useState<string | null>(null);
  const say = useCallback((e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work."), []);

  const read = useCallback(async (): Promise<void> => {
    try {
      const overview = (await d.call("projects.overview", { projectId })) as Overview;
      const plan = (await d.call("projects.plan", { projectId })) as PlanOut;
      setLoad({ status: "ready", overview, plan });
    } catch { setLoad({ status: "gone" }); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read]);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 4500);
    return () => clearTimeout(t);
  }, [note]);

  const tasks = useMemo(() => (load.status === "ready" ? planTasks(load.plan, d.nameOf) : []), [load, d]);
  if (load.status === "loading") return <View testID="project-loading" style={s.frame} accessibilityLabel="Loading the project"><View style={s.skHead} /><View style={s.skBody} /></View>;
  if (load.status === "gone") return <View testID="project-gone" style={s.frame}><View style={s.gone}><Text style={s.goneText}>That project is not here, or you may not open it.</Text></View></View>;

  const { overview: o, plan } = load;
  const p = o.project;
  const now = d.now();
  const save = (next: PlanTask[], reason: string): void => {
    const edits = editsBetween(tasks, next);
    if (edits.length === 0) return;
    void (async () => {
      try {
        for (const e of edits) await d.call("projects.reschedule", { projectId, taskId: e.taskId, ...(e.start !== undefined ? { start: e.start } : {}), ...(e.due !== undefined ? { due: e.due } : {}), ...(e.stage !== undefined ? { stage: e.stage } : {}) });
        for (const e of edits) if (e.status) await d.call("tasks.transition", { taskId: e.taskId, to: e.status });
        setNote(reason);
        await read();
      } catch (x) { say(x); await read(); }
    })();
  };

  const facts: ReactElement[] = [];
  const fact = (label: string, value: string, id: string): void => { facts.push(<View key={id} style={s.fact} testID={id}><Text style={s.k}>{label}</Text><Text style={s.v}>{value}</Text></View>); };
  fact("Status", p.status, "project-status");
  if (p.lead) fact("Lead", d.nameOf(p.lead), "project-lead");
  fact("Due", p.due !== undefined ? `${dateWords(p.due)} · ${dueWords(p.due, now)}` : "No due date", "project-due");

  return (
    <View style={s.frame} testID="project-page" accessibilityLabel={`Project, ${p.title}`}>
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" aria-level={1} numberOfLines={1} style={s.title} testID="project-title">{p.title}</Text>
          <View style={s.facts}>{facts}</View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open the channel in Chats" testID="project-channel" onPress={() => d.nav.openChannel(p.channelId)} style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.iconOver]}><Text style={s.iconText}>#</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open the folder in Files" testID="project-folder" onPress={() => d.nav.openFolder(p.folderId)} style={({ hovered }: { hovered?: boolean }) => [s.icon, hovered === true && s.iconOver]}><Text style={s.iconText}>{"▤"}</Text></Pressable>
      </View>
      <View style={s.strip} testID="project-strip" accessibilityLabel="Project at a glance">
        <Text style={s.stripText}>{plural(p.openTasks, "open task")}</Text>
        <Text style={[s.stripText, p.lateTasks > 0 && s.late]} testID="project-late">{p.lateTasks > 0 ? `${p.lateTasks} late` : "None late"}</Text>
        <Text style={s.stripText}>{plural(p.memberCount, "person", "people")}</Text>
      </View>
      <TabStrip tabs={TAB_SPECS} active={tab} onSelect={(k) => { setTab(k as TabKey); onTabChange?.(k as TabKey); }} />
      {tab === "overview" ? <OverviewTab o={o} now={now} /> : null}
      {tab === "plan" ? (
        <View style={s.planBody} testID="project-plan">
          <Plan today={isoDay(plan.today)} view={planView} viewKey={`project-${projectId}`} stages={planStages(plan)} tasks={tasks} onChange={save} onOpenTask={(t) => { void d.call("projects.open_task_thread", { projectId, taskId: t.id }).then((r) => d.nav.openThread((r as { threadId: string }).threadId)).catch(say); }} height={420} testID="project-plan-chart" />
        </View>
      ) : null}
      {tab === "files" ? <FilesTab o={o} /> : null}
      {tab === "chat" ? <ChatTab o={o} projectId={projectId} channelName={`#${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} now={now} /> : null}
      {note ? <Text style={s.note} accessibilityLiveRegion="polite" testID="project-note">{note}</Text> : null}
    </View>
  );
}

function Section({ title, count, children, id }: { title: string; count?: number; children: ReactElement[] | ReactElement | null; id: string }): ReactElement {
  return (
    <View style={s.section} testID={id}>
      <View style={s.sh}><Text accessibilityRole="header" style={s.h2}>{title}</Text>{count !== undefined ? <Text style={s.count}>{count}</Text> : null}</View>
      {children}
    </View>
  );
}

export function OverviewTab({ o, now }: { o: Overview; now: number }): ReactElement {
  const d = useProjectPageData();
  const rows = (list: Overview["milestones"], prefix: string): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const t of list) out.push(<Row key={t.taskId} id={`${prefix}:${t.taskId}`} title={t.title} note={[t.stage, t.due !== undefined ? `${dateWords(t.due)} · ${dueWords(t.due, now)}` : undefined, t.assigned ? d.nameOf(t.assigned) : undefined].filter(Boolean).join(" · ")} />);
    return out;
  };
  const people: ReactElement[] = [];
  for (const m of o.people) people.push(<Row key={m.principal} id={`person:${m.principal}`} title={d.nameOf(m.principal)} note={ROLE_WORDS[m.role]} leading={<View style={s.face}><Avatar name={d.nameOf(m.principal)} kind={m.kind === "agent" ? "agent" : m.kind === "group" ? "group" : "person"} size={24} /></View>} />);
  const linked: ReactElement[] = [];
  for (const r of o.linked) linked.push(<Row key={r.recordId} id={`linked:${r.recordId}`} title={r.title} note={r.type} onPress={() => d.nav.openRecord(r.type, r.recordId)} />);
  const decisions: ReactElement[] = [];
  for (const x of o.decisions) decisions.push(<Row key={x.decisionId} id={`decision:${x.decisionId}`} title={x.summary} note={ago(x.at, now)} />);
  const next = o.milestones.slice(0, 3);
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} testID="project-overview">
      {o.goal ? <Text style={s.goal} testID="project-goal">{o.goal}</Text> : null}
      {o.statusUpdate ? (
        <View style={s.update} testID="project-update">
          <Text style={s.updateText}>{o.statusUpdate.text}</Text>
          <Text style={s.dim}>{`${o.statusUpdate.drafted ? "Drafted by" : "From"} ${d.nameOf(o.statusUpdate.by)} · ${ago(o.statusUpdate.at, now)}`}</Text>
        </View>
      ) : null}
      <Section title="Next milestones" count={next.length} id="project-next">{next.length ? rows(next, "next") : <Text style={s.dim}>No milestones yet.</Text>}</Section>
      {o.late.length ? <Section title="Late" count={o.late.length} id="project-late-list">{rows(o.late, "late")}</Section> : null}
      {o.waiting.length ? <Section title="Waiting" count={o.waiting.length} id="project-waiting">{rows(o.waiting, "wait")}</Section> : null}
      {o.decisions.length ? <Section title="Recent decisions" id="project-decisions">{decisions}</Section> : null}
      <Section title="People" count={o.people.length} id="project-people">{people}</Section>
      {o.linked.length ? <Section title="Linked records" count={o.linked.length} id="project-linked">{linked}</Section> : null}
      {o.pinnedFiles.length ? <PinnedFiles ids={o.pinnedFiles} /> : null}
    </ScrollView>
  );
}

function PinnedFiles({ ids }: { ids: readonly string[] }): ReactElement {
  const d = useProjectPageData();
  const rows: ReactElement[] = [];
  for (const id of ids) rows.push(<Row key={id} id={`file:${id}`} title={d.fileName?.(id) ?? id} onPress={() => d.nav.openFile(id)} />);
  return <Section title="Pinned files" count={ids.length} id="project-pinned">{rows}</Section>;
}

export function FilesTab({ o }: { o: Overview }): ReactElement {
  const d = useProjectPageData();
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} testID="project-files">
      <Text style={s.lead}>The project's files are in its folder, made with it.</Text>
      <Pressable accessibilityRole="button" testID="project-open-folder" onPress={() => d.nav.openFolder(o.project.folderId)} style={s.open}><Text style={s.openText}>Open the folder in Files</Text></Pressable>
      {o.pinnedFiles.length ? <PinnedFiles ids={o.pinnedFiles} /> : <Text style={s.dim} testID="project-no-pins">Nothing is pinned yet.</Text>}
    </ScrollView>
  );
}

export function ChatTab({ o, channelName, now, projectId }: { o: Overview; channelName: string; now: number; projectId?: string }): ReactElement {
  const d = useProjectPageData();
  const rows: ReactElement[] = [];
  for (const t of o.recentThreads) {
    rows.push(
      <Row key={t.threadId} id={`thread:${t.threadId}`} title={t.title} note={ago(t.at, now)} onPress={() => d.nav.openThread(t.threadId)}
        trailing={<Pressable accessibilityRole="button" accessibilityLabel={`Open ${t.title} as its own chat`} testID={`arrow-out-${t.threadId}`} onPress={() => d.nav.openThread(t.threadId)} style={({ hovered }: { hovered?: boolean }) => [s.arrow, hovered === true && s.iconOver]}><Text style={s.iconText}>{"↗"}</Text></Pressable>} />,
    );
  }
  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.scrollIn} testID="project-chat">
      <Text style={s.lead} testID="project-chat-is-channel">{`This project has one chat. It is the channel ${channelName}, so everything said here is said there.`}</Text>
      <Pressable accessibilityRole="button" testID="project-open-channel" onPress={() => d.nav.openChannel(o.project.channelId)} style={s.open}><Text style={s.openText}>{`Open ${channelName} in Chats`}</Text></Pressable>
      <Section title="Threads" count={o.recentThreads.length} id="project-threads">{rows.length ? rows : <Text style={s.dim}>No threads yet.</Text>}</Section>
      {projectId ? <ImportedHistory projectId={projectId} /> : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8 },
  title: { fontSize: 24, fontWeight: "600", letterSpacing: -0.4, color: "var(--ink)" as string },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: 24, rowGap: 6, marginTop: 8 },
  fact: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  k: { fontSize: 12, color: "var(--ink-3)" as string },
  v: { fontSize: 13, color: "var(--ink)" as string },
  icon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  iconOver: { backgroundColor: "var(--hover)" as string },
  iconText: { fontSize: 15, color: "var(--ink-2)" as string },
  arrow: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  strip: { flexDirection: "row", gap: 18, paddingHorizontal: 24, paddingBottom: 10 },
  stripText: { fontSize: 12.5, color: "var(--ink-3)" as string },
  late: { color: "var(--danger)" as string, fontWeight: "500" },
  scroll: { flex: 1, minHeight: 0 },
  scrollIn: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40, maxWidth: 860, gap: 10 },
  goal: { fontSize: 15, lineHeight: 22, color: "var(--ink)" as string },
  update: { padding: 12, borderRadius: 10, backgroundColor: "var(--sunk)" as string, gap: 4 },
  updateText: { fontSize: 13.5, lineHeight: 20, color: "var(--ink)" as string },
  dim: { fontSize: 12.5, color: "var(--ink-3)" as string },
  lead: { fontSize: 13.5, lineHeight: 20, color: "var(--ink-2)" as string },
  section: { marginTop: 10 },
  sh: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 4 },
  h2: { fontSize: 12.5, fontWeight: "600", color: "var(--ink-2)" as string },
  count: { fontSize: 12, color: "var(--ink-3)" as string },
  face: { marginRight: 10 },
  open: { alignSelf: "flex-start", height: 28, justifyContent: "center", paddingHorizontal: 10, borderRadius: 7, backgroundColor: "var(--accent-wash)" as string },
  openText: { fontSize: 12.5, fontWeight: "500", color: "var(--accent)" as string },
  planBody: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 8 },
  note: { position: "absolute", left: 16, bottom: 14, fontSize: 12.5, color: "var(--ink-2)" as string, backgroundColor: "var(--raised)" as string, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  skHead: { height: 60, margin: 18, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skBody: { flex: 1, margin: 18, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  goneText: { fontSize: 13, color: "var(--ink-3)" as string },
});
