// A live re-run calls automations.replay after a confirmation that names outward effects. It is not a sandbox replay.
import { useState } from "react";
import type { ReactElement } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LIVE_RERUN_LABEL, liveRerunWarning, outwardEffects } from "./ledger.ts";
import { QuietButton } from "./parts.tsx";
import { useRunsData } from "./data.tsx";
import type { Run } from "./model.ts";

export function LiveRerun({ run, stepKeys }: { run: Run; stepKeys: readonly string[] }): ReactElement {
  const data = useRunsData();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const automationId = run.subject?.type === "automation" ? run.subject.id : null;
  const warning = liveRerunWarning(outwardEffects(stepKeys));
  const go = (): void => {
    if (!automationId) return;
    void data.call("automations.replay", { automationId, runId: run.id, version: "current" }).then((out) => {
      const id = out && typeof out === "object" && typeof (out as { runId?: unknown }).runId === "string" ? (out as { runId: string }).runId : null;
      setOpen(false);
      setNote("Live re-run started");
      if (id) data.nav.openRunSide(id);
    }).catch((e: unknown) => setNote(e instanceof Error ? e.message : "The live re-run did not start."));
  };
  return (
    <View style={s.wrap}>
      <QuietButton label={LIVE_RERUN_LABEL} testID="live-rerun" onPress={() => setOpen(true)} />
      {open ? (
        <View testID="live-rerun-confirm" style={s.box}>
          {automationId ? <Text style={s.text}>{warning}</Text> : <Text style={s.text}>This run is not tied to an Automation, so it cannot be re-run live.</Text>}
          {automationId ? <QuietButton label="Confirm re-run live" testID="live-rerun-go" onPress={go} /> : null}
          <QuietButton label="Cancel" testID="live-rerun-cancel" onPress={() => setOpen(false)} />
        </View>
      ) : null}
      {note ? <Text style={s.text}>{note}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  box: { gap: 6, maxWidth: 360, padding: 8, borderRadius: 8, backgroundColor: "var(--hover)" as string },
  text: { fontSize: 12, lineHeight: 17, color: "var(--ink-2)" as string },
});
