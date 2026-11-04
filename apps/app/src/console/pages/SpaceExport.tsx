// Export everything: the Space as one zip. spaces.export starts the run; the page asks backup.export_status until the file is ready, then offers the download. Only the Space owner sees the button.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Download, Note, useAction, useFileDownload, useRead } from "./shared.tsx";

type Phase = "idle" | "packing" | "ready";
export const EXPORT_POLL_MS = 3000;

export function SpaceExport(): ReactElement {
  const data = useConsoleData(), space = useRead<CapMap["spaces.get"]["out"]>("spaces.get"), download = useFileDownload();
  const [phase, setPhase] = useState<Phase>("idle"), [run, setRun] = useState("");
  const action = useAction(() => undefined);
  const owner = space.data ? space.data.space.owner === data.me.id : false;
  const check = async (runId: string): Promise<boolean> => {
    try {
      const ready = await data.call("backup.export_status", { runId }) as CapMap["backup.export_status"]["out"];
      await download.read(ready.fileId);
      setPhase("ready");
      return true;
    } catch { return false; }
  };
  useEffect(() => {
    if (phase !== "packing" || !run) return undefined;
    const timer = setInterval(() => { void check(run); }, EXPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, run]);
  const start = (): void => {
    void action.run<CapMap["spaces.export"]["out"]>("spaces.export", {}, async (out) => {
      setRun(out.runId); setPhase("packing");
      return (await check(out.runId)) ? "The export is ready." : "Packing the Space. The download appears here when it is ready.";
    });
  };
  const note = phase === "packing" ? "Packing the Space…" : phase === "ready" ? `Ready: ${download.name || "your export"}` : "One zip, logged in the audit log";
  return (
    <Section title="Export everything" testID="space-export">
      <Group>
        <Row id="export-all" title="Export everything" note={note} leading={<Lead><Glyph name="download" size={16} color="var(--ink-3)" /></Lead>}
          trailing={phase === "ready"
            ? <Actions>{download.url ? <Download url={download.url} name={download.name} label="Download" /> : null}<Button label="Done" testID="export-done" onPress={() => { setPhase("idle"); setRun(""); }} /></Actions>
            : owner ? <Button label="Export everything" testID="export-all-start" disabled={phase === "packing" || action.busy} onPress={start} /> : <Note>Owners only</Note>} />
      </Group>
      {action.note && phase !== "ready" ? <Note>{action.note}</Note> : null}
    </Section>
  );
}
