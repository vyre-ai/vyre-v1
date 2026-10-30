// What this step was given and what it answered in the run being shown, from runs.step_io. The server hides anything that looks like a key before it answers, and says how many values it hid.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";

type Io = { input?: unknown; output?: unknown; hidden: number; truncated: boolean };

export function ioFrom(out: unknown): Io | null {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;
  return { ...(o["input"] !== undefined ? { input: o["input"] } : {}), ...(o["output"] !== undefined ? { output: o["output"] } : {}), hidden: typeof o["hidden"] === "number" ? o["hidden"] : 0, truncated: o["truncated"] === true };
}

const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function RunStepIo({ runId, stepId, ready }: { runId: string; stepId: string; /** A log already read: shown on first paint. */ ready?: unknown }): ReactElement {
  const data = useAutomationsData();
  const [state, setState] = useState<{ phase: "loading" } | { phase: "ready"; io: Io } | { phase: "none" }>(() => { const io = ready === undefined ? null : ioFrom(ready); return io ? { phase: "ready", io } : { phase: "loading" }; });
  useEffect(() => {
    if (ready !== undefined) return undefined;
    let live = true;
    setState({ phase: "loading" });
    data.call("runs.step_io", { runId, step: stepId }).then((out) => { const io = ioFrom(out); if (live) setState(io ? { phase: "ready", io } : { phase: "none" }); }, () => { if (live) setState({ phase: "none" }); });
    return () => { live = false; };
  }, [data, runId, stepId]);
  return (
    <View testID="run-step-io" style={r.wrap}>
      <Text style={r.head}>In the run shown</Text>
      {state.phase === "loading" ? <Text style={r.hint}>Loading...</Text> : null}
      {state.phase === "none" ? <Text testID="run-step-io-none" style={r.hint}>This step has no log in that run.</Text> : null}
      {state.phase === "ready" ? (
        <>
          <Text style={r.label}>Given</Text>
          <Text testID="run-step-input" selectable style={r.mono}>{state.io.input === undefined ? "Nothing" : text(state.io.input)}</Text>
          <Text style={r.label}>Answered</Text>
          <Text testID="run-step-output" selectable style={r.mono}>{state.io.output === undefined ? "Nothing yet" : text(state.io.output)}</Text>
          {state.io.hidden > 0 ? <Text testID="run-step-hidden" style={r.hint}>{`${state.io.hidden} ${state.io.hidden === 1 ? "value" : "values"} that looked like a key ${state.io.hidden === 1 ? "is" : "are"} hidden.`}</Text> : null}
          {state.io.truncated ? <Text style={r.hint}>The value is long, so only the start is shown.</Text> : null}
        </>
      ) : null}
    </View>
  );
}

const r = StyleSheet.create({
  wrap: { gap: 6 },
  head: { fontSize: 11.5, fontWeight: "600", color: "var(--ink-2)" as string },
  label: { fontSize: 11.5, color: "var(--ink-3)" as string },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  mono: { fontSize: 12, lineHeight: 17, color: "var(--ink)" as string, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", backgroundColor: "var(--sunk)" as string, borderRadius: 7, padding: 8 },
});
