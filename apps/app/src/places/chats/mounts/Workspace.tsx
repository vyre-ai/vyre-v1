// A chat tied to a record, project, task or run opens as a workspace (CHAT-DESIGN ruling 1): the work in the main pane and the conversation beside it. DMs and channels stay conversation-first.
// The work gets the whole main pane: a record page does not draw its own side panel here, because its Chat tab would repeat the conversation. Below WORKSPACE_MIN_W the conversation is a drawer
// over the work, opened and closed with one button, so the workspace is never dropped.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RecordDetail } from "../../../shell/providers/record-detail.tsx";
import { homeData } from "../../../shell/providers/home.tsx";
import type { ShellRuntime } from "../../../shell/providers/runtime.tsx";
import { HomeDataProvider } from "../../home/index.tsx";
import { TaskRoute } from "../../home/task/TaskRoute.tsx";
import { States } from "../../../../../../ui/src/States/index.tsx";
import type { Work } from "./route.ts";

/** The width the conversation keeps beside the work. */
export const CHAT_BESIDE_W = 380;

/** Below this window width the conversation is a drawer over the work instead of a column beside it. */
export const WORKSPACE_MIN_W = 1500;

const LABEL: Record<Work["type"], string> = { record: "The record", project: "The project", task: "The task", run: "The run" };

type RunRead = { run: { id: string; name?: string; status: string; summary?: string; kind: string } };
type StepsRead = { steps: Array<{ step: string; attempt: number; state: string; error?: { message: string } }> };

/** A run in the main pane: what it is, how it stands, and its steps. Opening it in Automations is one press. */
export function RunWork({ rt, runId }: { rt: ShellRuntime; runId: string }): ReactElement {
  const [state, setState] = useState<{ run?: RunRead["run"]; steps: StepsRead["steps"]; error?: string }>({ steps: [] });
  useEffect(() => {
    let alive = true;
    setState({ steps: [] });
    void Promise.all([rt.call("runs.get", { runId }) as Promise<RunRead>, rt.call("runs.steps", { runId, limit: 100 }) as Promise<StepsRead>]).then(
      ([r, s]) => { if (alive) setState({ run: r.run, steps: s.steps }); },
      () => { if (alive) setState({ steps: [], error: "That run is unavailable or you do not have access." }); },
    );
    return () => { alive = false; };
  }, [rt, runId]);
  if (state.error) return <States kind="error" message={state.error} />;
  if (!state.run) return <States kind="empty" title="Opening run…" icon="chat" />;
  return (
    <View testID="chats-work-run" style={st.runBox}>
      <Text accessibilityRole="header" style={st.runTitle}>{state.run.name ?? state.run.kind.replaceAll("_", " ")}</Text>
      <Text testID="chats-work-run-status" style={st.runSub}>{`${state.run.status}${state.run.summary ? ` · ${state.run.summary}` : ""}`}</Text>
      <View style={st.runSteps}>
        {state.steps.map((s) => (
          <View key={`${s.step}-${s.attempt}`} style={st.runStep}>
            <Text style={st.runStepName}>{s.step.replaceAll("_", " ")}</Text>
            <Text style={st.runSub}>{s.error ? `${s.state} · ${s.error.message}` : s.state}</Text>
          </View>
        ))}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open the run in Automations" testID="chats-work-run-open" onPress={() => rt.open({ subject: { type: "run", id: runId } })} style={st.runOpen}>
        <Text style={st.runOpenText}>Open in Automations</Text>
      </Pressable>
    </View>
  );
}

function WorkOf({ rt, work }: { rt: ShellRuntime; work: Work }): ReactElement {
  if (work.type === "task") {
    return (
      <HomeDataProvider value={homeData(rt)}>
        <TaskRoute key={work.id} taskId={work.id} onBack={() => rt.open({ screen: "tasks.my-work" })} onOpen={(type, id) => rt.open(type === "task" ? { screen: "tasks.page", args: { taskId: id } } : { subject: { type, id } })} />
      </HomeDataProvider>
    );
  }
  if (work.type === "run") return <RunWork rt={rt} runId={work.id} />;
  return <RecordDetail key={work.id} rt={rt} recordId={work.id} noPane />;
}

export function Workspace({ rt, work, narrow = false, children }: { rt: ShellRuntime; work: Work; narrow?: boolean; children: ReactNode }): ReactElement {
  const [drawer, setDrawer] = useState(true);
  const beside = !narrow || drawer;
  return (
    <View testID="chats-workspace" style={st.row}>
      <View testID="chats-work" accessibilityLabel={LABEL[work.type]} style={st.work}>
        <WorkOf rt={rt} work={work} />
      </View>
      {narrow ? (
        <Pressable
          accessibilityRole="button" accessibilityState={{ expanded: drawer }} accessibilityLabel={drawer ? "Hide the conversation" : "Show the conversation"} testID="chats-drawer-toggle"
          onPress={() => setDrawer((o) => !o)} style={[st.toggle, drawer && { right: CHAT_BESIDE_W + 12 }]}
        >
          <Text style={st.toggleText}>{drawer ? "Hide conversation" : "Conversation"}</Text>
        </Pressable>
      ) : null}
      {beside ? (
        <View testID="chats-beside" accessibilityLabel="The conversation" style={[st.chat, narrow && st.drawer]}>
          <Text accessibilityRole="header" style={st.label}>Conversation</Text>
          <View style={st.fill}>{children}</View>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: "row", minHeight: 0, position: "relative" },
  work: { flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" },
  chat: { width: CHAT_BESIDE_W, minHeight: 0, borderLeftWidth: 1, borderLeftColor: "var(--line)" as string, backgroundColor: "var(--win)" as string },
  drawer: { position: "absolute", right: 0, top: 0, bottom: 0, boxShadow: "-8px 0 24px rgba(0,0,0,0.08)" } as object,
  label: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2, fontSize: 11.5, fontWeight: "600", color: "var(--ink-3)" as string },
  fill: { flex: 1, minHeight: 0 },
  toggle: { position: "absolute", right: 12, top: 10, zIndex: 20, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: "var(--win)" as string, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  toggleText: { fontSize: 12, color: "var(--ink-2)" as string },
  runBox: { flex: 1, padding: 28, gap: 8 },
  runTitle: { fontSize: 18, fontWeight: "600", color: "var(--ink)" as string },
  runSub: { fontSize: 12.5, color: "var(--ink-3)" as string },
  runSteps: { gap: 6, marginTop: 8 },
  runStep: { gap: 1 },
  runStepName: { fontSize: 13, color: "var(--ink)" as string },
  runOpen: { alignSelf: "flex-start", marginTop: 12, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, boxShadow: "inset 0 0 0 1px var(--line-2)" } as object,
  runOpenText: { fontSize: 13, color: "var(--accent)" as string },
});
