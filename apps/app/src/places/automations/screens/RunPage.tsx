// A run opened as a page of rows (design 2.9, AUTOMATIONS-BUILD-RC29 round two, item 3): numbered as the builder is, the real values of each step, Values to open, and a failure as one plain sentence with one button
// that opens the step and one that runs it again. Read from the run's step log and the Automation's story; nothing here shows an id or a code.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RunChat } from "../runs/index.ts";
import { useAutomationsData } from "../canvas/data.tsx";
import { loadProductCatalog } from "../catalog/model.ts";
import { runView } from "../run/model.ts";
import type { RunResult } from "../run/model.ts";
import { fromDefinition } from "../story/adapt.ts";
import { look } from "./look.ts";
import { RunView } from "./RunView.tsx";

interface StepLog {
  step: string;
  state: string;
  error?: { message: string };
}

const plain = (m: string): string => m.replace(/\s+/g, " ").replace(/\.?$/, ".");

const valuesOf = (out: unknown): readonly (readonly [string, string])[] =>
  out && typeof out === "object" && !Array.isArray(out)
    ? Object.entries(out as Record<string, unknown>)
        .filter(([k, v]) => (typeof v === "string" || typeof v === "number") && !/(^|_)id$|Id$/.test(k))
        .slice(0, 4)
        .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), String(v)] as const)
    : [];

export function RunPage({ runId }: { runId: string }): ReactElement {
  const data = useAutomationsData();
  const [tick, setTick] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [state, setState] = useState<{
    automationId: string | null;
    definition: Parameters<typeof fromDefinition>[0] | null;
    steps: StepLog[];
    outputs: Record<string, unknown>;
    titles: Record<string, { title: string; app?: { id: string; name: string } }>;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const run = (await data.call("runs.get", { runId })) as { run: { subject?: { type: string; id: string } } };
        const subject = run.run.subject;
        const steps = ((await data.call("runs.steps", { runId })) as { steps: StepLog[] }).steps;
        const outputs: Record<string, unknown> = {};
        for (const st of steps)
          if (st.state === "succeeded") {
            const io = (await data.call("runs.step_io", { runId, step: st.step }).catch(() => null)) as {
              output?: unknown;
            } | null;
            outputs[st.step] = io?.output;
          }
        let definition = null;
        if (subject?.type === "automation")
          definition = (
            (await data.call("automations.get", { automationId: subject.id })) as {
              automation: { definition: Parameters<typeof fromDefinition>[0] };
            }
          ).automation.definition;
        const cat = await loadProductCatalog((cap, input) => data.call(cap, input));
        const titles = cat.ok ? Object.fromEntries(cat.catalog.all.map((s) => [s.key, { title: s.title }])) : {};
        if (live) setState({ automationId: subject?.id ?? null, definition, steps, outputs, titles });
      } catch {
        if (live) setState({ automationId: null, definition: null, steps: [], outputs: {}, titles: {} });
      }
    })();
    return () => {
      live = false;
    };
  }, [data, runId, tick]);
  const view = useMemo(() => {
    if (!state?.definition) return null;
    const story = fromDefinition(state.definition, {
      catalog: state.titles,
      triggerTitles: {},
      nameOfNode: (id) => id,
      canUse: () => true,
      needsOf: () => [],
    });
    const results: Record<string, RunResult> = {};
    for (const st of state.steps) {
      if (st.state === "succeeded")
        results[st.step] = { status: "ok", line: "Done", values: valuesOf(state.outputs[st.step]) };
      else if (st.state === "failed")
        results[st.step] = {
          status: "failed",
          why: plain(st.error?.message ?? "It could not run."),
          fix: "Open the step",
        };
      else if (st.state === "waiting") results[st.step] = { status: "waiting", line: "Waiting" };
    }
    return runView(story.steps, results, story.trigger ?? undefined);
  }, [state]);
  if (!state) return <View testID="run-page-loading" />;
  // a run that is not an Automation's (an agent's work) keeps its own page
  if (!view || !state.automationId) return <RunChat runId={runId} wide />;
  const failedStep = state.steps.find((x) => x.state === "failed")?.step;
  return (
    <View testID="run-page" style={s.page}>
      <RunView view={view} onFix={() => data.nav.openAutomation(state.automationId!)} />
      {view.banner ? (
        <Pressable
          testID="run-again"
          accessibilityRole="button"
          style={[look.btn, s.again]}
          onPress={() => {
            setNote(null);
            void data
              .call("automations.retry", {
                automationId: state.automationId,
                runId,
                ...(failedStep ? { fromStep: failedStep } : {}),
              })
              .then(
                () => {
                  setNote("Started again.");
                  setTick((t) => t + 1);
                },
                (e: unknown) => setNote(e instanceof Error ? e.message : "It did not start again."),
              );
          }}
        >
          <Text style={look.btnText}>Run again</Text>
        </Pressable>
      ) : null}
      {note ? <Text style={look.quiet}>{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1, padding: 16, gap: 10 },
  again: { alignSelf: "flex-start" },
});
