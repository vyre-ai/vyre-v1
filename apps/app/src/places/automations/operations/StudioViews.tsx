// Place views that are not the builder. Each one is a real call or an honest empty screen. No invented rows.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AskVyre } from "../ask/AskVyre.tsx";
import { CONFIG, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { countRuns, dependenciesFrom, eventRows } from "./read.ts";
import type { DependencyNode } from "./read.ts";
import { choiceStartsRuns, readChoiceResult, scheduleRequestFromTask } from "./recovery.ts";
import type { ScheduleChoiceKey } from "./recovery.ts";

type RunsOut = CapMap["runs.list"]["out"];

type Phase<T> = { phase: "loading" } | { phase: "error"; message: string } | { phase: "ready"; value: T };

function useCall<T>(cap: string, input: unknown, parse: (out: unknown) => T | null): Phase<T> {
  const data = useAutomationsData();
  const [state, setState] = useState<Phase<T>>({ phase: "loading" });
  const key = JSON.stringify(input);
  useEffect(() => {
    let live = true;
    setState({ phase: "loading" });
    void data.call(cap, JSON.parse(key) as unknown).then((out) => {
      if (!live) return;
      const value = parse(out);
      if (value === null) setState({ phase: "error", message: "That list did not return rows." });
      else setState({ phase: "ready", value });
    }).catch((e: unknown) => {
      if (!live) return;
      setState({ phase: "error", message: e instanceof Error ? e.message : "That did not load." });
    });
    return () => { live = false; };
  }, [data, cap, key]);
  return state;
}

function Frame({ testID, title, children }: { testID: string; title: string; children: ReactNode }): ReactElement {
  return (
    <View testID={testID} style={v.page}>
      <Text accessibilityRole="header" style={v.title}>{title}</Text>
      {children}
    </View>
  );
}

function Status({ state }: { state: Phase<unknown> }): ReactElement | null {
  if (state.phase === "loading") return <Text style={v.dim}>Loading</Text>;
  if (state.phase === "error") {
    return (
      <View style={v.stack}>
        <Text style={v.err}>{state.message}</Text>
        <AskVyre bundle={{ resource: "automation", message: state.message }} />
      </View>
    );
  }
  return null;
}

interface NeedsRow { id: string; title: string; reason: string; task: unknown }

function ScheduleChoices({ task }: { task: unknown }): ReactElement | null {
  const request = scheduleRequestFromTask(task);
  const data = useAutomationsData();
  const [count, setCount] = useState("1");
  const [cap, setCap] = useState("");
  const [pending, setPending] = useState<ScheduleChoiceKey | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!request) return null;
  async function send(key: ScheduleChoiceKey): Promise<void> {
    if (busy) return;
    const body: { automationId: string; choice: ScheduleChoiceKey; n?: number; limits?: { cap: number } } = { automationId: request!.automationId, choice: key };
    if (choiceStartsRuns(key)) {
      const n = Number.parseInt(count, 10);
      if (!Number.isInteger(n) || n < 1 || n > 500) { setNote("Enter how many, from 1 to 500."); return; }
      body.n = n;
      if (pending !== key) { setPending(key); setNote("This starts live runs for the ticks you chose. Completed work is not repeated."); return; }
    }
    if (key === "change_limits") {
      const next = Number.parseInt(cap, 10);
      if (!Number.isInteger(next) || next < 1 || next > 500) { setNote("Enter a cap from 1 to 500."); return; }
      body.limits = { cap: next };
    }
    setBusy(true);
    setPending(null);
    try {
      const result = readChoiceResult(await data.call("automations.schedule_choose", body));
      if (!result) setNote("The schedule did not answer.");
      else if (!result.ok) setNote(result.error ?? "That choice was not applied.");
      else if (result.started > 0) setNote(`Started ${result.started} runs.`);
      else if (result.paused) setNote("This schedule stays paused.");
      else setNote("The backlog was skipped and the schedule is on.");
    } catch (e: unknown) {
      setNote(e instanceof Error ? e.message : "That choice was not applied.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={v.stack} testID="schedule-recovery">
      {choiceStartsRuns(request.choices[0]?.key ?? "") || request.choices.some((choice) => choiceStartsRuns(choice.key)) ? (
        <TextInput value={count} onChangeText={setCount} keyboardType="number-pad" accessibilityLabel="How many missed runs" testID="schedule-count" style={v.input} />
      ) : null}
      {request.choices.some((choice) => choice.key === "change_limits") ? (
        <TextInput value={cap} onChangeText={setCap} keyboardType="number-pad" placeholder="Cap" accessibilityLabel="Backfill cap" testID="schedule-cap" style={v.input} />
      ) : null}
      <View style={v.choices}>
        {request.choices.map((choice) => (
          <Pressable key={choice.key} accessibilityRole="button" disabled={busy} testID={`schedule-${choice.key}`} onPress={() => void send(choice.key)} style={v.choice}>
            <Text style={v.row}>{pending === choice.key ? "Confirm live runs" : choice.label}</Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={v.dim}>{note}</Text> : null}
    </View>
  );
}

export function NeedsYou(): ReactElement {
  const state = useCall("tasks.needs_you", {}, (out) => {
    if (!out || typeof out !== "object" || !Array.isArray((out as { items?: unknown }).items)) return null;
    const items: NeedsRow[] = [];
    for (const row of (out as { items: unknown[] }).items) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { task?: { id?: unknown; title?: unknown }; reason?: unknown };
      if (!rec.task || typeof rec.task.id !== "string" || typeof rec.task.title !== "string" || typeof rec.reason !== "string") continue;
      items.push({ id: rec.task.id, title: rec.task.title, reason: rec.reason, task: rec.task });
    }
    return items;
  });
  return (
    <Frame testID="needs-you" title="Needs you">
      <Status state={state} />
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>Nothing needs you</Text> : null}
      {state.phase === "ready" ? state.value.map((item) => (
        <View key={item.id} style={v.stack}>
          <Text style={v.row}>{`${item.title} · ${item.reason}`}</Text>
          <ScheduleChoices task={item.task} />
        </View>
      )) : null}
    </Frame>
  );
}

export function AllRuns(): ReactElement {
  const state = useCall("runs.list", { scope: "all", limit: 50 }, (out) => {
    if (!out || typeof out !== "object" || !Array.isArray((out as { runs?: unknown }).runs)) return null;
    const rows: { id: string; title: string; status: string }[] = [];
    for (const row of (out as { runs: unknown[] }).runs) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { id?: unknown; status?: unknown; summary?: unknown; name?: unknown };
      if (typeof rec.id !== "string" || typeof rec.status !== "string") continue;
      rows.push({ id: rec.id, status: rec.status, title: typeof rec.summary === "string" ? rec.summary : typeof rec.name === "string" ? rec.name : rec.id });
    }
    return rows;
  });
  return (
    <Frame testID="all-runs" title="All runs">
      <Status state={state} />
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>No Runs match</Text> : null}
      {state.phase === "ready" ? state.value.map((row) => <Text key={row.id} style={v.row}>{`${row.title} · ${row.status}`}</Text>) : null}
    </Frame>
  );
}

export function AnalyticsPanel({ automationId }: { automationId: string }): ReactElement {
  const q = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, scope: "subject" });
  if (q.status !== "ready") return <Frame testID="analytics" title="Analytics"><Text style={v.dim}>{q.error?.message ?? "Loading"}</Text></Frame>;
  const counted = countRuns(q.data.runs);
  return (
    <Frame testID="analytics" title="Analytics">
      {q.data.runs.length === 0 || !counted ? <Text style={v.dim}>No completed Runs yet</Text> : <Text style={v.dim}>{counted.text}</Text>}
    </Frame>
  );
}

export function HonestEmpty({ testID, title, body }: { testID: string; title: string; body: string }): ReactElement {
  return (
    <Frame testID={testID} title={title}>
      <Text style={v.dim}>{body}</Text>
    </Frame>
  );
}

const EMPTY_EVENTS = "Listening for events. A trigger event will show here when one is published. None have arrived.";
const EMPTY_DEPENDENCIES = "Choose a dependency. This fills when an Automation names another Automation, a mailbox, a number, or a connection. None are recorded yet.";

export function LiveEvents(): ReactElement {
  const state = useCall("events.list", { limit: 50 }, eventRows);
  return (
    <Frame testID="live-events" title="Live Event Explorer">
      <Status state={state} />
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>{EMPTY_EVENTS}</Text> : null}
      {state.phase === "ready" ? state.value.map((row) => <Text key={row.id} style={v.row}>{row.line}</Text>) : null}
    </Frame>
  );
}

function nodesOf(out: unknown): DependencyNode[] | null {
  if (!out || typeof out !== "object") return null;
  const automation = (out as { automation?: { definition?: { nodes?: unknown } } }).automation;
  const nodes = automation?.definition?.nodes;
  if (!Array.isArray(nodes)) return null;
  const parsed: DependencyNode[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const row = node as { key?: unknown; input?: unknown };
    if (typeof row.key !== "string") continue;
    const input = row.input && typeof row.input === "object" && !Array.isArray(row.input) ? row.input as Record<string, unknown> : {};
    parsed.push({ key: row.key, input });
  }
  return parsed;
}

export function Dependencies(): ReactElement {
  const data = useAutomationsData();
  const [state, setState] = useState<Phase<{ id: string; line: string }[]>>({ phase: "loading" });
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setState({ phase: "loading" });
    setNote(null);
    void (async () => {
      try {
        const listed = await data.call("automations.list", { limit: 50 });
        if (!listed || typeof listed !== "object" || !Array.isArray((listed as { automations?: unknown }).automations)) {
          if (live) setState({ phase: "error", message: "That list did not return rows." });
          return;
        }
        const page: { id: string; name: string; nodes: DependencyNode[] }[] = [];
        let failed: string | null = null;
        for (const row of (listed as { automations: unknown[] }).automations) {
          if (!row || typeof row !== "object") continue;
          const rec = row as { id?: unknown; name?: unknown };
          if (typeof rec.id !== "string" || typeof rec.name !== "string") continue;
          try {
            const nodes = nodesOf(await data.call("automations.get", { automationId: rec.id }));
            if (nodes) page.push({ id: rec.id, name: rec.name, nodes });
          } catch (e) {
            failed = e instanceof Error ? e.message : "One automation did not load.";
          }
        }
        if (!live) return;
        setNote(failed);
        setState({ phase: "ready", value: dependenciesFrom(page) });
      } catch (e) {
        if (!live) return;
        setState({ phase: "error", message: e instanceof Error ? e.message : "That did not load." });
      }
    })();
    return () => { live = false; };
  }, [data]);
  return (
    <Frame testID="dependencies" title="Dependencies">
      <Status state={state} />
      {note ? <Text style={v.err}>{note}</Text> : null}
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>{EMPTY_DEPENDENCIES}</Text> : null}
      {state.phase === "ready" ? state.value.map((row) => <Text key={row.id} style={v.row}>{row.line}</Text>) : null}
    </Frame>
  );
}

export function Packages(): ReactElement {
  return <HonestEmpty testID="packages" title="Packages" body="No packages. Installed automation packages will list here when the catalog has any." />;
}

const v = StyleSheet.create({
  page: { flex: 1, padding: 24, gap: 10, backgroundColor: "var(--win)" as string },
  title: { fontSize: 16, fontWeight: "600", color: "var(--ink)" as string },
  dim: { fontSize: 13, lineHeight: 18, color: "var(--ink-3)" as string },
  err: { fontSize: 13, lineHeight: 18, color: "var(--danger)" as string },
  row: { fontSize: 13, lineHeight: 18, color: "var(--ink)" as string },
  stack: { gap: 8 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "var(--surface-2)" as string },
  input: { fontSize: 13, color: "var(--ink)" as string, borderWidth: 1, borderColor: "var(--line)" as string, borderRadius: 8, padding: 8, maxWidth: 160 },
});
