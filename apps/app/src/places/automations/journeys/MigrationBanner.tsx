// A Journey made the old way moves onto its subject type by itself after the upgrade (modules/journeys/handlers/pipeline.ts). While that runs, and when it stopped on something, the page says so in one line:
// how far it is, or why it stopped, with Retry (journeys.to_pipeline, which resumes from its journal). A Journey that has moved shows nothing.
import { useCallback, useEffect, useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";
import { TextButton } from "../canvas/parts.tsx";
import type { Journey } from "./model.ts";

interface State {
  mode: "subject" | "migrating" | "pipeline";
  total: number;
  done: number;
  failed: { recordId: string; error: string }[];
}

/** The one line: moving (with how far), stopped (with why) or nothing. */
export function migrationLine(s: State | null, note?: string): { text: string; retry: boolean } | null {
  if (!s || s.mode === "pipeline") return null;
  if (note) return { text: `Moving this Journey to its new form stopped: ${note}`, retry: true };
  if (s.mode === "migrating")
    return {
      text: `Moving this Journey to its new form: ${s.done} of ${s.total} records done.${s.failed.length > 0 ? ` ${s.failed.length} will be tried again.` : ""}`,
      retry: false,
    };
  return { text: "This Journey moves to its new form by itself in a moment.", retry: false };
}

export function MigrationBanner({
  journey: j,
  canDesign,
}: {
  journey: Journey;
  canDesign: boolean;
}): ReactElement | null {
  const data = useAutomationsData();
  const [state, setState] = useState<State | null>(null);
  const [note, setNote] = useState<string | undefined>(j.migrateNote);
  const [busy, setBusy] = useState(false);
  const read = useCallback(async (): Promise<void> => {
    try {
      setState((await data.call("journeys.migration_state", { journeyId: j.id })) as State);
    } catch {
      setState(null);
    }
  }, [data, j.id]);
  useEffect(() => {
    if ((j.mode ?? "subject") === "pipeline") return;
    void read();
  }, [j.mode, read]);
  const line = migrationLine(state, note);
  if (!line) return null;
  const retry = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const r = (await data.call("journeys.to_pipeline", { journeyId: j.id })) as {
        journey?: { migrateNote?: string };
      };
      setNote(r.journey?.migrateNote);
    } catch (e) {
      setNote((e as { error?: { message?: string } } | null)?.error?.message ?? "It did not start.");
    }
    await read();
    setBusy(false);
  };
  return (
    <View style={s.bar} testID="migration-banner">
      <Text style={s.text}>{line.text}</Text>
      {line.retry && canDesign ? (
        <TextButton label="Retry" testID="migration-retry" disabled={busy} onPress={() => void retry()} />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 28,
    marginTop: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "var(--sunk)" as string,
  },
  text: { flex: 1, fontSize: 13, color: "var(--ink)" as string },
});
