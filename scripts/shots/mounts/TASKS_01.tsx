// Mount for TASKS_01 (lane l-tasks): the real Tasks page and task page over a runtime that answers the tasks capabilities with one Space's rows. Irfad is the reader.
//   ?view=list     Tasks, Mine: While you were away on top, Needs you with a review handed to him, work sent back by Omar's private agent ("Omar Reyes (Agent)"), a team task to Take and a
//                  question, then Now, Next and Waiting on others (a team task Sara took).
//   ?view=review   the task page of the review: the baton path by name, Approve and Send back.
//   ?view=team     the task page of the team task nobody took: Take it, and the rail's Taken by line.
//   ?view=menu     the review's status menu: only the moves his seat allows.
//   ?view=pane     the review in the side pane of a chat (no rail, Open the full page).
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { createThemeController } from "../../../ui/src/theme/index.ts";
import type { ThemeRoot } from "../../../ui/src/theme/index.ts";
import { TasksPage } from "../../../apps/app/src/places/chats/tasks/TasksPage.tsx";
import { TaskDetail } from "../../../apps/app/src/places/chats/tasks/TaskDetail.tsx";

export const title = "Tasks: your turn, teams, moves from your seat";

const NOW = Date.UTC(2026, 10, 3, 9, 30);
const DAY = 86_400_000;
const ME = "usr_irfad";
const PEOPLE = [
  { id: ME, name: "Irfad Imtiaz", kind: "person" }, { id: "usr_maya", name: "Maya Lin", kind: "person" }, { id: "usr_sara", name: "Sara Khan", kind: "person" },
  { id: "usr_omar", name: "Omar Reyes", kind: "person" }, { id: "agt_scout", name: "Scout", kind: "agent" },
  // someone else's private agent: the server already names it as its person
  { id: "agt_omar_cc", name: "Omar Reyes (Agent)", kind: "agent", owner: "usr_omar", private: true },
];
const TEAMS = { groups: [{ id: "grp_intake", name: "Intake team", members: [], managers: [], builtIn: false }], roles: [{ id: "rol_billing", name: "Billing", builtIn: false, clearance: "internal", assignableToAgents: false, permissions: [], holders: 2 }] };
const who = (id: string): { kind: "person" | "agent" | "group" | "role"; id: string } => ({ kind: id.startsWith("agt_") ? "agent" : id.startsWith("grp_") ? "group" : id.startsWith("rol_") ? "role" : "person", id });

type Row = Record<string, unknown>;
const base = (o: Row): Row => ({
  kind: "work", state: "todo", blocked: false, blocks: [], actions: [], labels: [], dependsOn: [], fileIds: [], followers: [], workingNotes: {}, reviewLoops: 0,
  createdAt: NOW - 2 * DAY, updatedAt: NOW - 3_600_000, ...o,
});
const TASKS: Row[] = [
  base({ id: "tsk_review", key: "NW-41", title: "Draft the engagement letter", state: "in_review", assigned: who("usr_maya"), reviewer: who(ME), approver: who("usr_sara"), createdBy: "usr_sara", yourTurn: true, updatedAt: NOW - 20 * 60_000,
    workingNotes: { brief: "Engagement letter for the Rivera estate: scope, fees and the retainer.", summary: "Drafted it with the flat fee and the two filing dates", outputs: JSON.stringify({ letter: "Dear Ms Rivera, thank you for choosing Northwind Law..." }) } }),
  base({ id: "tsk_back", key: "NW-38", title: "Update the intake checklist", state: "doing", assigned: who(ME), reviewer: who("agt_omar_cc"), createdBy: ME, yourTurn: true, updatedAt: NOW - 45 * 60_000,
    workingNotes: { fixes: JSON.stringify(["Add the conflict check before the retainer"]) } }),
  base({ id: "tsk_team", key: "NW-44", title: "Call the new client back", assigned: who("grp_intake"), createdBy: "usr_sara", yourTurn: true, due: NOW + 5 * 3_600_000, updatedAt: NOW - 10 * 60_000,
    workingNotes: { brief: "Ms Patel left a voicemail about a probate matter. Whoever takes it calls her back today." } }),
  base({ id: "tsk_q", key: "NW-45", kind: "answer", title: "Which filing date is right: 14 or 21 November?", assigned: who(ME), createdBy: "agt_scout", yourTurn: true, updatedAt: NOW - 5 * 60_000,
    actions: [{ key: "answer", label: "Answer" }, { key: "dismiss", label: "Dismiss" }] }),
  base({ id: "tsk_now", key: "NW-30", title: "Send the Rivera invoice", state: "doing", assigned: who(ME), createdBy: ME, due: NOW + 6 * 3_600_000, priority: "high" }),
  base({ id: "tsk_next", key: "NW-33", title: "Book the mediation room", assigned: who(ME), createdBy: ME, due: NOW + 3 * DAY, labels: ["rivera"] }),
  base({ id: "tsk_taken", key: "NW-36", title: "Collect the signed retainer", assigned: who("grp_intake"), takenBy: "usr_sara", state: "doing", createdBy: ME, due: NOW + DAY }),
  base({ id: "tsk_wait", key: "NW-31", title: "Review the court filing", state: "in_review", assigned: who(ME), reviewer: who("usr_maya"), createdBy: ME, updatedAt: NOW - DAY }),
];
const byId = new Map(TASKS.map((t) => [t.id as string, t] as const));
const NEEDS = ["tsk_review", "tsk_back", "tsk_team", "tsk_q"].map((id) => ({ task: byId.get(id)!, reason: id === "tsk_team" ? "due_today" : "ready", yourTurn: true }));
const DIGEST = {
  id: "dgs_1", person: ME, periodStart: NOW - 3 * DAY, periodEnd: NOW, builtBy: "agt_assistant",
  headline: ["Maya handed in the engagement letter for your review.", "Scout asks which filing date is right."],
  items: [{ kind: "finished", title: "Rivera retainer signed", line: "Sara collected it Monday" }, { kind: "waiting", title: "Draft the engagement letter", line: "Waiting on your review", subject: { type: "task", id: "tsk_review" } }],
};

function answer(cap: string, input: Row): unknown {
  switch (cap) {
    case "tasks.index": {
      const q = String(input.q ?? "").toLowerCase();
      const rows = TASKS.filter((t) => (q === "" || String(t.title).toLowerCase().includes(q)) && input.done !== true);
      return { rev: "r1", unchanged: false, rows, doneThisWeek: 6, total: rows.length };
    }
    case "tasks.get": { const t = byId.get(String(input.taskId)); if (!t) throw new Error("That task is not available."); return { task: t }; }
    case "access.groups.list": return { groups: TEAMS.groups };
    case "access.roles.list": return { roles: TEAMS.roles };
    case "home.digest": return { digest: DIGEST };
    case "projects.list": return { projects: [] };
    case "views.list": return { views: [] };
    case "schema.types.get": return { type: { fields: [] } };
    default: throw new Error(`${cap} is not in this sample`);
  }
}

function runtime(): unknown {
  // one snapshot object per query, as a live query keeps it: a new object on every read would redraw forever
  const kept = new Map<string, unknown>();
  const live = (data: unknown, key = JSON.stringify(data)) => {
    let snap = kept.get(key);
    if (!snap) { snap = { status: "ready", data }; kept.set(key, snap); }
    return { subscribe: () => () => undefined, getSnapshot: () => snap };
  };
  const screens = {
    query(screen: string, name: string, state: Row) {
      if (screen === "tasks.my-work" && name === "rev") return live({ rev: "r1" });
      if (screen === "tasks.my-work" && name === "needs") return live({ items: NEEDS, total: NEEDS.length });
      if (screen === "tasks.my-work" && name === "count") return live({ count: NEEDS.length });
      if (screen === "tasks.page" && name === "task") { const id = (state?.route as Row | undefined)?.taskId; return live({ task: byId.get(String(id)) }); }
      if (screen === "tasks.page" && name === "activity") return live({ entries: [], total: 0 });
      return live({});
    },
  };
  return {
    screens, call: async (cap: string, input: Row) => answer(cap, input),
    principals: live(PEOPLE), me: { id: ME, name: "Irfad Imtiaz" }, assistant: { id: "agt_assistant", name: "Assistant" },
    clock: () => ({ now: NOW, offsetMin: 300 }), recordTitle: () => undefined, open: () => undefined, openUrl: () => undefined,
    space: { id: "northwind", kind: "team", name: "Northwind" }, aiConnected: true, calendarConnected: true, deferredModules: new Set<string>(), isDeferred: () => false,
  };
}

interface RootLike { setAttribute(name: string, value: string): void; style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }
type Doc = { querySelector(s: string): { click?: () => void } | null; documentElement?: RootLike };

export default function Mount(): ReactNode {
  // the address is read after mount (rule 25), so the static first frame and the page agree
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => { setQ(new URLSearchParams((globalThis as { location?: { search?: string } }).location?.search ?? "")); }, []);
  return q ? <Page view={q.get("view") ?? "list"} skin={q.get("skin") ?? "paper"} /> : <View testID="tasks-mount-wait" style={StyleSheet.absoluteFill} />;
}

function Page({ view, skin }: { view: string; skin: string }): ReactNode {
  useMemo(() => {
    const root = (globalThis as { document?: Doc }).document?.documentElement;
    const themeRoot: ThemeRoot = { setAttribute: (n, v) => { root?.setAttribute(n, v); }, setProperty: (n, v) => { root?.style.setProperty(n, v); }, removeProperty: (n) => { root?.style.removeProperty(n); } };
    return createThemeController({ personId: "irfad", spaceId: "nw", spaceSkin: { nw: skin }, prefersDark: skin === "graphite", root: themeRoot, storage: null });
  }, [skin]);
  const rt = useMemo(() => runtime() as never, []);
  // the status menu opens after the page has drawn, as a press would open it
  useEffect(() => {
    if (view !== "menu") return undefined;
    const t = setTimeout(() => (globalThis as { document?: Doc }).document?.querySelector("[data-testid='task-status']")?.click?.(), 400);
    return () => clearTimeout(t);
  }, [view]);
  const none = (): void => undefined;
  const detail = (taskId: string, pane = false): ReactNode => <TaskDetail rt={rt} taskId={taskId} conversationFor={() => { throw new Error("no thread in this sample"); }} openTask={none} openAgent={none} openChat={none} {...(pane ? { rail: false, openFull: none } : { back: none })} />;
  return (
    <View testID="tasks-mount" style={[StyleSheet.absoluteFill, { backgroundColor: "var(--win)" as string }]}>
      {view === "list" ? <TasksPage rt={rt} openTask={none} openAgent={none} openChat={none} />
        : view === "pane" ? <View style={{ flex: 1, flexDirection: "row" }}><View style={{ flex: 1, backgroundColor: "var(--sunk)" as string }} /><View testID="chats-task-pane" style={{ width: 460, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string }}>{detail("tsk_review", true)}</View></View>
        : detail(view === "team" ? "tsk_team" : "tsk_review")}
    </View>
  );
}
