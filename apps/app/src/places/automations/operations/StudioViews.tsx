// Place views that are not the builder. Each one is a real call or an honest empty screen. No invented rows.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { AskVyre } from "../ask/AskVyre.tsx";
import { CONFIG, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CONNECT_LIMIT, connectorLine, shownConnectors } from "../connect/trust-view.ts";
import type { ConnectorSource, ShownConnector } from "../connect/trust-view.ts";
import {
  ALL_RUNS_LINE, ALL_RUNS_SEARCH, ANALYTICS_LINE, DEPS_LINE, EMPTY_COMPLETED, EMPTY_DEPENDENCIES, EMPTY_EVENTS, EMPTY_PACKAGES, EVENTS_LINE, LISTENING, NEEDS_LINE, PACKAGES_LINE, SPACE_ANALYTICS_LINE, SPACE_ANALYTICS_TITLE,
} from "../chrome.ts";
import { countRuns, dependenciesFrom, eventRows, exportChoices, packageRows } from "./read.ts";
import type { NamedRow } from "./read.ts";
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

function Frame({ testID, title, line, children }: { testID: string; title: string; line?: string; children: ReactNode }): ReactElement {
  return (
    <View testID={testID} style={v.page}>
      <Text accessibilityRole="header" style={v.title}>{title}</Text>
      {line ? <Text style={v.dim}>{line}</Text> : null}
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
    <Frame testID="needs-you" title="Needs you" line={NEEDS_LINE}>
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
  const [query, setQuery] = useState("");
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
  const needle = query.trim().toLowerCase();
  const shown = state.phase === "ready" ? state.value.filter((row) => needle === "" || `${row.title} ${row.status} ${row.id}`.toLowerCase().includes(needle)) : [];
  return (
    <Frame testID="all-runs" title="All runs" line={ALL_RUNS_LINE}>
      <TextInput value={query} onChangeText={setQuery} placeholder={ALL_RUNS_SEARCH} accessibilityLabel={ALL_RUNS_SEARCH} testID="runs-search" style={v.input} />
      <Status state={state} />
      {state.phase === "ready" && shown.length === 0 ? <Text style={v.dim}>No Runs match</Text> : null}
      {shown.map((row) => <Text key={row.id} style={v.row}>{`${row.title} · ${row.status}`}</Text>)}
    </Frame>
  );
}

export function AnalyticsPanel({ automationId }: { automationId: string }): ReactElement {
  const q = useScreenQuery<RunsOut>(CONFIG, "runs", { subject: { type: "automation", id: automationId }, scope: "subject" });
  if (q.status !== "ready") return <Frame testID="analytics" title="Analytics" line={ANALYTICS_LINE}><Text style={v.dim}>{q.error?.message ?? "Loading"}</Text></Frame>;
  const counted = countRuns(q.data.runs);
  return (
    <Frame testID="analytics" title="Analytics" line={ANALYTICS_LINE}>
      {q.data.runs.length === 0 || !counted ? <Text style={v.dim}>{EMPTY_COMPLETED}</Text> : <Text style={v.dim}>{counted.text}</Text>}
    </Frame>
  );
}

/** Space home. The shell view "analytics" renders this. That switch lives outside this folder. */
export function SpaceAnalytics(): ReactElement {
  const state = useCall("runs.list", { scope: "all", limit: 50 }, (out) => {
    if (!out || typeof out !== "object" || !Array.isArray((out as { runs?: unknown }).runs)) return null;
    return (out as { runs: { status?: unknown; costMicros?: unknown }[] }).runs;
  });
  const counted = state.phase === "ready" ? countRuns(state.value) : null;
  const empty = state.phase === "ready" && (state.value.length === 0 || !counted);
  return (
    <Frame testID="space-analytics" title={SPACE_ANALYTICS_TITLE} line={SPACE_ANALYTICS_LINE}>
      <Status state={state} />
      {empty ? <Text style={v.dim}>{EMPTY_COMPLETED}</Text> : null}
      {state.phase === "ready" && counted && state.value.length > 0 ? <Text style={v.dim}>{counted.text}</Text> : null}
    </Frame>
  );
}

export function LiveEvents(): ReactElement {
  const state = useCall("events.list", { limit: 50 }, eventRows);
  return (
    <Frame testID="live-events" title="Live Event Explorer" line={EVENTS_LINE}>
      {state.phase === "ready" ? <Text testID="events-listening" style={v.dim}>{LISTENING}</Text> : null}
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
    <Frame testID="dependencies" title="Dependencies" line={DEPS_LINE}>
      <Status state={state} />
      {note ? <Text style={v.err}>{note}</Text> : null}
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>{EMPTY_DEPENDENCIES}</Text> : null}
      {state.phase === "ready" ? state.value.map((row) => <Text key={row.id} style={v.row}>{row.line}</Text>) : null}
      <ConnectorTrust />
    </Frame>
  );
}

function ConnectorTrust(): ReactElement {
  const data = useAutomationsData();
  const [rows, setRows] = useState<ShownConnector[] | "loading" | "unavailable">("loading");
  useEffect(() => {
    let live = true;
    void data.call("connectors.list", { limit: 50 }).then((out) => {
      if (!live) return;
      const list = out && typeof out === "object" && Array.isArray((out as { connectors?: unknown }).connectors)
        ? (out as { connectors: ConnectorSource[] }).connectors
        : [];
      setRows(shownConnectors(list, "author"));
    }).catch(() => { if (live) setRows("unavailable"); });
    return () => { live = false; };
  }, [data]);
  if (rows === "loading") return null;
  if (rows === "unavailable") return <Text style={v.dim}>Connector list is not available from this sign-in.</Text>;
  return (
    <View>
      <Text style={v.dim}>{CONNECT_LIMIT}</Text>
      {rows.map((row) => <Text key={row.key} style={v.row}>{connectorLine(row)}</Text>)}
    </View>
  );
}

export function Packages(): ReactElement {
  const data = useAutomationsData();
  const [reload, setReload] = useState(0);
  const [packages, setPackages] = useState<Phase<NamedRow[]>>({ phase: "loading" });
  const [sources, setSources] = useState<NamedRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const listed = packageRows(await data.call("automations.packages.list", {}));
        if (!listed) throw new Error("The package list did not return rows.");
        const choices = exportChoices(await data.call("automations.list", { limit: 20 })) ?? [];
        if (!live) return;
        setPackages({ phase: "ready", value: listed });
        setSources(choices);
      } catch (e) {
        if (!live) return;
        setPackages({ phase: "error", message: e instanceof Error ? e.message : "Packages did not load." });
      }
    })();
    return () => { live = false; };
  }, [data, reload]);
  async function exp(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await data.call("automations.packages.export", { automationId: id });
      setReload((n) => n + 1);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That automation was not exported.");
    } finally {
      setBusy(false);
    }
  }
  async function imp(id: string, name: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await data.call("automations.packages.import", { packageId: id });
      setNote(`Draft ${name} is in your automations.`);
      setReload((n) => n + 1);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "That package was not imported.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame testID="packages" title="Packages" line={PACKAGES_LINE}>
      <Status state={packages} />
      {packages.phase === "ready" && packages.value.length === 0 ? <Text style={v.dim}>{EMPTY_PACKAGES}</Text> : null}
      {packages.phase === "ready" ? packages.value.map((row) => (
        <Pressable key={row.id} accessibilityRole="button" disabled={busy} testID={`import-${row.id}`} onPress={() => { void imp(row.id, row.name); }} style={v.choice}>
          <Text style={v.row}>{`Import ${row.name} as a draft`}</Text>
        </Pressable>
      )) : null}
      {packages.phase === "ready" && sources.length > 0 ? <Text style={v.dim}>Export an Automation</Text> : null}
      {packages.phase === "ready" ? sources.map((row) => (
        <Pressable key={row.id} accessibilityRole="button" disabled={busy} testID={`export-${row.id}`} onPress={() => { void exp(row.id); }} style={v.choice}>
          <Text style={v.row}>{`Export ${row.name}`}</Text>
        </Pressable>
      )) : null}
      {note ? <Text style={v.dim}>{note}</Text> : null}
    </Frame>
  );
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
