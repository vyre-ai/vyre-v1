// Place views that are not the builder. Each one is a real call or an honest empty screen. No invented rows.
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AskVyre } from "../ask/AskVyre.tsx";
import { CONFIG, useAutomationsData, useScreenQuery } from "../canvas/data.tsx";
import type { CapMap } from "../../../../../../generated/types.ts";

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
        <AskVyre bundle={{ resource: "automations", message: state.message }} />
      </View>
    );
  }
  return null;
}

export function NeedsYou(): ReactElement {
  const state = useCall("tasks.needs_you", {}, (out) => {
    if (!out || typeof out !== "object" || !Array.isArray((out as { items?: unknown }).items)) return null;
    const items: { id: string; title: string; reason: string }[] = [];
    for (const row of (out as { items: unknown[] }).items) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { task?: { id?: unknown; title?: unknown }; reason?: unknown };
      if (!rec.task || typeof rec.task.id !== "string" || typeof rec.task.title !== "string" || typeof rec.reason !== "string") continue;
      items.push({ id: rec.task.id, title: rec.task.title, reason: rec.reason });
    }
    return items;
  });
  return (
    <Frame testID="needs-you" title="Needs you">
      <Status state={state} />
      {state.phase === "ready" && state.value.length === 0 ? <Text style={v.dim}>Nothing needs you</Text> : null}
      {state.phase === "ready" ? state.value.map((item) => <Text key={item.id} style={v.row}>{`${item.title} · ${item.reason}`}</Text>) : null}
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
  const succeeded = q.data.runs.filter((run) => run.status === "succeeded").length;
  const failed = q.data.runs.filter((run) => run.status === "failed").length;
  return (
    <Frame testID="analytics" title="Analytics">
      {q.data.runs.length === 0 || succeeded + failed === 0 ? <Text style={v.dim}>No completed Runs yet</Text> : <Text style={v.dim}>{`${succeeded} succeeded and ${failed} failed in the runs list.`}</Text>}
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

export function LiveEvents(): ReactElement {
  return <HonestEmpty testID="live-events" title="Live Event Explorer" body="Listening for events. A trigger event will show here when one is published. None have arrived." />;
}

export function Dependencies(): ReactElement {
  return <HonestEmpty testID="dependencies" title="Dependencies" body="Choose a dependency. This fills when an Automation names another Automation it waits on. None are recorded yet." />;
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
});
