// A single step test. Reads may run. Writes and sends stay stubbed by the capability. The output can become the sample for later mapping.
import { useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AskVyre } from "../ask/AskVyre.tsx";
import type { AskBundle } from "../ask/bundle.ts";
import { fixtureNote } from "./fields.ts";
import { fixtureValues, renderMessage } from "./compose.ts";
import { useAutomationsData } from "../canvas/data.tsx";

export function StepTest({ stepKey, nodeId, input, version, samples = {}, onUseOutput }: {
  stepKey: string;
  nodeId: string;
  input: Record<string, unknown>;
  version: number;
  samples?: Readonly<Record<string, unknown>>;
  onUseOutput(output: unknown): void;
}): ReactElement {
  const data = useAutomationsData();
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error" | "unavailable">("idle");
  const [output, setOutput] = useState<unknown>(undefined);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  const run = (): void => {
    setPhase("running");
    setError(null);
    void data.call("steps.test", { key: stepKey, input }).then((out) => {
      const rec = out && typeof out === "object" ? out as { output?: unknown; error?: { code?: string; message?: string } } : null;
      if (rec?.error && typeof rec.error.message === "string") {
        setError({ ...(typeof rec.error.code === "string" ? { code: rec.error.code } : {}), message: rec.error.message });
        setPhase("error");
        return;
      }
      setOutput(rec?.output);
      setPhase("done");
    }).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : "The step test did not run.";
      const unavailable = /no write|not available|unknown capability/i.test(message);
      setError({ message });
      setPhase(unavailable ? "unavailable" : "error");
    });
  };

  const rendered = renderMessage(stepKey, input, fixtureValues(samples));
  const bundle: AskBundle = {
    resource: "step-test",
    stepKey,
    nodeId,
    definitionVersion: version,
    ...(error?.code ? { errorCode: error.code } : {}),
    ...(error?.message ? { message: error.message } : {}),
  };

  return (
    <View testID="step-test" style={t.wrap}>
      <Text style={t.hint}>{fixtureNote(version, stepKey)}</Text>
      {rendered ? <Text testID="rendered-message" style={t.hint}>{rendered}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Test this step" testID="run-step-test" onPress={run} style={t.btn}>
        <Text style={t.btnText}>{phase === "running" ? "Testing" : "Test this step"}</Text>
      </Pressable>
      {phase === "unavailable" ? <Text style={t.err}>Step test is not available from this runtime.</Text> : null}
      {phase === "error" || phase === "unavailable" ? <Text style={t.err}>{error?.message ?? ""}</Text> : null}
      {phase === "done" ? (
        <View style={t.out}>
          <Text style={t.hint}>{`Output: ${JSON.stringify(output)}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Use output from test" testID="use-test-output" onPress={() => onUseOutput(output)} style={t.btn}>
            <Text style={t.btnText}>Use output from test</Text>
          </Pressable>
        </View>
      ) : null}
      {phase === "error" || phase === "unavailable" ? <AskVyre bundle={bundle} onOpen={(safe) => data.nav.ask(nodeId, safe)} /> : null}
    </View>
  );
}

const t = StyleSheet.create({
  wrap: { gap: 8 },
  hint: { fontSize: 12, lineHeight: 17, color: "var(--ink-3)" as string },
  err: { fontSize: 12.5, lineHeight: 17, color: "var(--danger)" as string },
  out: { gap: 6 },
  btn: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: "var(--hover)" as string },
  btnText: { fontSize: 12.5, color: "var(--ink)" as string },
});
