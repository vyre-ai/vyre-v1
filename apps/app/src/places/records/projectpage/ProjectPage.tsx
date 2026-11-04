// The project page (spec 3.4, 2.12): a project is a record with five tabs (Teammates is the agents made for it). Overview is the brief, the status and its update, the next milestones, what is late or waiting, decisions, people,
// linked records and pinned files. Plan is the shared Plan (Timeline, Board, List, Calendar); an edit writes projects.reschedule or tasks.update, and a slip asks to move the later tasks or keep
// their dates. Files opens the project's folder. Chat is the project's one channel: every thread of it is listed, and the arrow-out mark opens a thread as its own chat. Status, Lead and Due sit
// under the name; the channel and the folder are icon buttons. Each action is one capability call; a refusal shows as a quiet line.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Avatar } from "../../../../../../ui/src/Avatar/index.tsx";
import { DeferredPlan as Plan } from "../../../../../../ui/src/Plan/DeferredPlan.tsx";
import type { PlanTask } from "../../../../../../ui/src/Plan/index.tsx";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { TabStrip } from "../../../../../../ui/src/TabStrip/index.tsx";
import { menuTrigger, useMenu } from "../../../../../../ui/src/Menu/index.tsx";
import type { MenuEntry } from "../../../../../../ui/src/Menu/index.tsx";
import { projectMenu } from "../../chats/menus/kinds-b.ts";
import { copyToClipboard, createMenuApiB, vyreLink } from "../../chats/menus/actions-b.ts";
import { GoalsOf } from "../../chats/goals/GoalsList.tsx";
import { useProjectPageData } from "./data.tsx";
import { HEALTH_LABEL, HEALTH_ORDER, ROLE_WORDS, ago, dateWords, dueWords, editsBetween, isoDay, planStages, planTasks, plural } from "./model.ts";
import type { Overview, PlanOut } from "./model.ts";
import { DEFAULT_PROJECT_TAB, PROJECT_TABS, isProjectTab } from "./tabs.ts";
import type { ProjectSpace, ProjectTabKey } from "./tabs.ts";
import { ProjectOverview } from "./overview/index.tsx";
import { ProjectLinked } from "./linked/index.tsx";
import { KnowsTab } from "./KnowsTab.tsx";
import { IconButton } from "../../chats/conversation/parts.tsx";
import type { FrameStore } from "../../chats/conversation/frame.ts";
import { ImportedHistory } from "./ImportedHistory.tsx";
import { TeammatesTab } from "./TeammatesTab.tsx";
import { useAddSheet } from "../../chats/addsheet/index.ts";
import { PeoplePopover } from "../../../../../../ui/src/PeoplePopover/index.tsx";
import type { MemberAction, MemberRow } from "../../../../../../ui/src/PeoplePopover/index.tsx";
import { itemLink } from "../../../share/rows.ts";

export interface ProjectPageProps {
  projectId: string;
  onTabChange?: (tab: ProjectTabKey) => void;
  /** The tab it opens on. */
  tab?: ProjectTabKey;
  /** The Space it is in. */
  space?: ProjectSpace;
  /** The project's main chat, drawn by the host that owns the conversation (Chats: the real conversation with its composer, crew strip and side pane). Absent: the list of its chats. */
  chatSlot?: ReactElement | null;
  /** The controls the project's chat hands up (conversation/frame.ts): drawn in this header on the Chat tab, and its More entries follow the project's own. */
  chatControls?: FrameStore;
  /** The Plan's view when it opens on the Plan tab. */
  planView?: "timeline" | "board" | "list" | "calendar";
}

type Load = { status: "loading" } | { status: "gone" } | { status: "ready"; overview: Overview; plan: PlanOut };

export function ProjectPage({ projectId, tab: first = DEFAULT_PROJECT_TAB, planView = "timeline", onTabChange, chatSlot, chatControls, space = { id: "", kind: "team", name: "" } }: ProjectPageProps): ReactElement {
  const d = useProjectPageData();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [tab, setTab] = useState<ProjectTabKey>(first);
  useEffect(() => setTab(first), [first]);
  const [note, setNote] = useState<string | null>(null);
  const menu = useMenu();
  const noFrame = useMemo(() => ({ subscribe: () => () => undefined, version: () => 0, get: () => null }), []);
  const frameStore = chatControls ?? noFrame;
  useSyncExternalStore(frameStore.subscribe, frameStore.version, frameStore.version);
  const chat = tab === "chat" ? frameStore.get() : null;
  const [mine, setMine] = useState<{ manage: boolean; edit: boolean; starred: boolean; people: string[] }>({ manage: false, edit: false, starred: false, people: [] });
  const api = useMemo(() => createMenuApiB(d), [d]);
  const say = useCallback((e: unknown): void => setNote(e instanceof Error ? e.message : "That did not work."), []);

  const read = useCallback(async (): Promise<void> => {
    try {
      const overview = (await d.call("projects.overview", { projectId })) as Overview;
      const plan = (await d.call("projects.plan", { projectId })) as PlanOut;
      setLoad({ status: "ready", overview, plan });
      // what the right-click menu offers follows the person's role on the project and whether they starred it
      try {
        const members = (await d.call("projects.members.list", { projectId })) as { members?: { principal: string; role: string }[] };
        // a Space that cannot list stars still tells the person their role: the star is the only thing lost
        const stars = (await Promise.resolve(d.call("stars.list", {})).catch(() => ({ stars: [] }))) as { stars?: { resource: { type: string; id: string } }[] };
        const role = (members.members ?? []).find((m) => m.principal === d.me?.id)?.role?.toLowerCase();
        setMine({ manage: role === "lead", edit: role === "lead" || role === "member", people: (members.members ?? []).map((m) => m.principal), starred: (stars.stars ?? []).some((x) => x.resource.type === "project" && x.resource.id === projectId) });
      } catch { /* the menu then offers only what anyone may do */ }
    } catch { setLoad({ status: "gone" }); }
  }, [d, projectId]);
  useEffect(() => { void read(); }, [read]);
  // the one Add people and agents sheet for this project: the members count and the Teammates tab both open it
  const [added, setAdded] = useState(0);
  const add = useAddSheet({ call: d.call, me: d.me ?? { id: "me", name: "You" }, nameOf: d.nameOf, newKey: () => globalThis.crypto.randomUUID(), toast: (text) => setNote(text) }, { onDone: () => { setAdded((n) => n + 1); void read(); } });
  // the people popover of the head (the same component the chats use)
  const [people, setPeople] = useState<{ x: number; y: number; left?: number } | null>(null);
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

  const setHealth = (health: "on" | "risk" | "off" | "hold" | "done" | null): void => { void d.call("projects.set", { projectId, health }).then(() => { setNote(health === null ? "Status cleared" : `Status: ${HEALTH_LABEL[health]}`); void read(); }, say); };
  const projectEntries = (): MenuEntry[] => projectMenu({ title: p.title, starred: mine.starred, archived: p.archivedAt !== undefined, manage: mine.manage, edit: mine.edit }, {
    star: (on) => { void api.projectStar(projectId, on).then(() => { setMine((m) => ({ ...m, starred: on })); setNote(on ? "Starred" : "Star removed"); }, say); },
    share: () => d.nav.openRecordPage(p.type, p.recordId), addPeople: () => add.open({ projectId }),
    pinFile: () => pick("linked"),
    archive: () => { void api.projectArchive(projectId).then(() => { setNote("Archived. It left the lists and still opens; Unarchive brings it back."); void read(); }, say); },
    unarchive: () => { void api.projectUnarchive(projectId).then(() => { setNote("Back in the lists"); void read(); }, say); }, copyLink: () => { copyToClipboard(vyreLink("project", projectId)); setNote("Link copied"); },
  });
  // More is one menu: the project's items, a divider, then the chat's (only on the Chat tab)
  const moreEntries = (): MenuEntry[] => { const mine = projectEntries(); const theirs = chat ? chat.chatEntries() : []; return theirs.length > 0 ? [...mine, { separator: true } as MenuEntry, ...theirs] : mine; };
  const pick = (k: ProjectTabKey): void => { setTab(k); onTabChange?.(k); };
  const at = (e: unknown): { x: number; y: number } => { const t = (e as { nativeEvent?: { pageX?: number; pageY?: number }; clientX?: number; clientY?: number } | undefined); return { x: t?.clientX ?? t?.nativeEvent?.pageX ?? 24, y: (t?.clientY ?? t?.nativeEvent?.pageY ?? 40) + 12 }; };
  const health = p.health;
  const lead = p.lead;
  const counts: Partial<Record<ProjectTabKey, number>> = { plan: plan.tasks.filter((t) => t.status === "awaiting_approval" || t.status === "in_review").length };
  const tabs = PROJECT_TABS.map((t) => ({ key: t.key, title: counts[t.key] ? `${t.title} ${counts[t.key]}` : t.title }));
  const canEdit = mine.edit;

  return (
    <View style={s.frame} testID="project-page" accessibilityLabel={`Project, ${p.title}`}>
      {menu.element}
      <View style={s.head} testID="project-head" {...menuTrigger((x, y) => menu.show(projectEntries(), x, y, "context", { label: p.title }))}>
        <View style={s.tt}>
          <Pressable accessibilityRole="button" accessibilityLabel="Project menu" testID="project-menu" onPress={(e: unknown) => { const q = at(e); menu.show(projectEntries(), q.x, q.y, "other", { label: p.title }); }} style={({ hovered }: { hovered?: boolean }) => [s.titleBtn, hovered === true && s.hover]}>
            <Text accessibilityRole="header" aria-level={1} numberOfLines={1} style={s.title} testID="project-title">{p.title}</Text>
            <Text style={s.chev}>{"\u2304"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={mine.starred ? "Unstar" : "Star"} accessibilityState={{ selected: mine.starred }} testID="project-star" onPress={() => { const on = !mine.starred; void api.projectStar(projectId, on).then(() => { setMine((m) => ({ ...m, starred: on })); setNote(on ? "Starred" : "Star removed"); }, say); }} style={({ hovered }: { hovered?: boolean }) => [s.iconBtn, hovered === true && s.hover]}>
            <Text style={[s.star, mine.starred && s.starOn]}>{mine.starred ? "\u2605" : "\u2606"}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${health ? HEALTH_LABEL[health] : "Not set"}`} testID="project-health" disabled={!canEdit}
            onPress={(e: unknown) => { const q = at(e); menu.show([...HEALTH_ORDER.map((h) => ({ label: HEALTH_LABEL[h], onSelect: () => setHealth(h) })), ...(health ? [{ separator: true as const }, { label: "Clear", onSelect: () => setHealth(null) }] : [])], q.x, q.y, "other", { label: "Status" }); }}
            style={({ hovered }: { hovered?: boolean }) => [s.pill, hovered === true && canEdit && s.hover]}>
            <View style={[s.dot, { backgroundColor: HEALTH_COLOR[health ?? "none"] }]} />
            <Text style={s.pillText}>{health ? HEALTH_LABEL[health] : "No status"}</Text>
          </Pressable>
          {lead ? (
            <View style={s.pill} testID="project-lead"><Avatar name={d.nameOf(lead)} size={18} /><Text style={s.pillText}>{d.nameOf(lead)}</Text></View>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="People and agents" testID="project-members" aria-haspopup="dialog" onPress={(e: { nativeEvent?: { pageX?: number; pageY?: number }; currentTarget?: { getBoundingClientRect?: () => { left: number; right: number; bottom: number } } }) => { const r = e.currentTarget?.getBoundingClientRect?.(); setPeople(r ? { x: r.right, y: r.bottom, left: r.left } : { x: e.nativeEvent?.pageX ?? 0, y: e.nativeEvent?.pageY ?? 0 }); }} style={({ hovered }: { hovered?: boolean }) => [s.pill, hovered === true && s.hover]}>
          {/* ui-rows-lint: not a list (up to four stacked faces on the members button) */}
          <View style={s.stack}>{mine.people.slice(0, 4).map((id) => <View key={id} style={s.stackFace}><Avatar name={d.nameOf(id)} size={20} /></View>)}</View>
          <Text style={s.pillText}>{String(p.memberCount)}</Text>
        </Pressable>
        {chat ? (
          <>
            {chat.helpers ? <IconButton icon="helper" label={chat.helpers.label} badge={chat.helpers.badge} testID="helpers-button" onPress={chat.helpers.onPress} /> : null}
            {chat.stop ? <IconButton icon="stop" label={chat.stop.label} danger testID="stop-button" onPress={chat.stop.onPress} /> : null}
            <IconButton icon="search" label="Find in chat" active={chat.find.active} testID="find-button" onPress={() => chat.find.toggle()} />
            <IconButton icon="pane" label="Show or hide the pane" testID="pane-button" onPress={() => chat.pane.toggle()} />
          </>
        ) : null}
        <Pressable accessibilityRole="button" accessibilityLabel="More" testID="project-more" onPress={(e: unknown) => { const q = at(e); menu.show(moreEntries(), q.x, q.y, "other", { label: p.title }); }} style={({ hovered }: { hovered?: boolean }) => [s.iconBtn, hovered === true && s.hover]}><Text style={s.iconText}>{"\u2026"}</Text></Pressable>
      </View>
      <TabStrip underline noOptions noClose tabs={tabs} active={tab} onSelect={(k) => pick(k as ProjectTabKey)} />
      {tab === "chat" && chatSlot ? <View style={s.chatSlot} testID="project-chat-main">{chatSlot}</View> : null}
      {tab === "chat" && !chatSlot ? <ChatTab o={o} projectId={projectId} channelName={`#${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`} now={now} /> : null}
      {tab === "plan" ? (
        <View style={s.planBody} testID="project-plan">
          {d.nav.openGoal ? <GoalsOf scope="project" id={projectId} call={d.call} changes={d.changes} now={d.now()} offsetMin={0} nameOf={d.nameOf} openGoal={d.nav.openGoal} testID="project-goals" /> : null}
          <Plan today={isoDay(plan.today)} view={planView} viewKey={`project-${projectId}`} stages={planStages(plan)} tasks={tasks} onChange={save} onOpenTask={(t) => { void d.call("projects.open_task_thread", { projectId, taskId: t.id }).then((out) => { const id = (out as { threadId?: string }).threadId; if (id) d.nav.openThread(id); }, say); }} />
        </View>
      ) : null}
      {tab === "overview" ? <ProjectOverview projectId={projectId} space={{ ...space, id: d.spaceId ?? space.id }} canEdit={canEdit} admin={d.admin === true} /> : null}
      {tab === "linked" ? <ProjectLinked projectId={projectId} space={{ ...space, id: d.spaceId ?? space.id }} canEdit={canEdit} admin={d.admin === true} /> : null}
      {tab === "knows" ? <KnowsTab projectId={projectId} space={{ ...space, id: d.spaceId ?? space.id }} canEdit={canEdit} admin={d.admin === true} /> : null}
      {note ? <Text style={s.note} accessibilityLiveRegion="polite" testID="project-note">{note}</Text> : null}
      {add.element}
      {people ? <ProjectPeople o={o} projectId={projectId} at={people} onClose={() => setPeople(null)} toOverview={() => { setPeople(null); setTab("overview"); onTabChange?.("overview"); }} menu={menu} reload={() => { void read(); }} say={say} /> : null}
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

/** The head's people popover for a project: one row per member with the project role, Manage on the Overview in the footer. Lead (or whoever manages) may change a role or remove. */
function ProjectPeople({ o, projectId, at, onClose, toOverview, menu, reload, say }: { o: Overview; projectId: string; at: { x: number; y: number; left?: number }; onClose(): void; toOverview(): void; menu: ReturnType<typeof useMenu>; reload(): void; say(e: unknown): void }): ReactElement {
  const d = useProjectPageData();
  const rows: MemberRow[] = o.people.map((m) => ({ id: m.principal, name: d.nameOf(m.principal), kind: m.kind === "agent" ? "agent" : "person", role: ROLE_WORDS[m.role] }));
  const meRole = d.me ? o.people.find((m) => m.principal === d.me?.id)?.role : undefined;
  const manages = meRole === "lead";
  const run = (p: Promise<unknown>): void => { p.then(reload, say); };
  const act = (action: MemberAction, r: MemberRow): void => {
    if (action === "link") { const clip = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator?.clipboard; void clip?.writeText(itemLink(r.kind === "person" ? "person" : "agent", r.id)); return; }
    if (action === "remove") { run(Promise.resolve(d.call("projects.members.remove", { projectId, principal: r.id }))); return; }
    if (action === "role") {
      menu.show((["lead", "member", "reviewer", "guest"] as const).map((role) => ({ label: ROLE_WORDS[role], checked: ROLE_WORDS[role] === r.role, onSelect: () => run(Promise.resolve(d.call("projects.members.set", { projectId, principal: r.id, role, idempotencyKey: globalThis.crypto.randomUUID() }))) })), at.x, at.y, "context", { label: `Role for ${r.name}` });
    }
  };
  return (
    <PeoplePopover
      where="project" rows={rows} {...(d.me ? { meId: d.me.id } : {})} perms={{ message: false, changeRole: manages, remove: manages }} anchor={at}
      onOpen={(r) => { onClose(); if (r.kind === "person") d.nav.openPerson?.(r.id); else d.nav.openAgent?.(r.id); }}
      onAction={act} onFooter={toOverview} onClose={onClose}
    />
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
      <Section title="Chats" count={o.recentThreads.length} id="project-threads">{rows.length ? rows : <Text style={s.dim}>No chats yet.</Text>}</Section>
      {projectId ? <ImportedHistory projectId={projectId} /> : null}
    </ScrollView>
  );
}

const HEALTH_COLOR: Record<string, string> = { on: "var(--ok)", risk: "var(--warn)", off: "var(--danger)", hold: "var(--ink-3)", done: "var(--accent)", none: "var(--line-2)" };

const s = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, backgroundColor: "var(--win)" as string },
  head: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 8 },
  tt: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  titleBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, maxWidth: "100%" },
  chev: { fontSize: 13, color: "var(--ink-3)" as string, marginTop: -4 },
  hover: { backgroundColor: "var(--hover)" as string },
  iconBtn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  star: { fontSize: 16, color: "var(--ink-3)" as string },
  starOn: { color: "var(--warn)" as string },
  pill: { height: 28, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderRadius: 8 },
  pillText: { fontSize: 12.5, color: "var(--ink-2)" as string },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stack: { flexDirection: "row", marginRight: 2 },
  stackFace: { marginLeft: -6 },
  title: { fontSize: 20, fontWeight: "600", letterSpacing: -0.3, color: "var(--ink)" as string },
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
  chatSlot: { flex: 1, minHeight: 0 },
  planBody: { flex: 1, minHeight: 0, paddingHorizontal: 12, paddingTop: 8 },
  note: { position: "absolute", left: 16, bottom: 14, fontSize: 12.5, color: "var(--ink-2)" as string, backgroundColor: "var(--raised)" as string, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  skHead: { height: 60, margin: 18, borderRadius: 9, backgroundColor: "var(--sunk)" as string },
  skBody: { flex: 1, margin: 18, borderRadius: 12, backgroundColor: "var(--sunk)" as string },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  goneText: { fontSize: 13, color: "var(--ink-3)" as string },
});
