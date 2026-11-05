// Export everything: the Space as one zip. spaces.export starts the run; the page asks backup.export_status until the file is ready, then offers the download. Only the Space owner sees the button.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Group, Lead, Section } from "../shell/ui.tsx";
import { Glyph } from "../shell/glyphs.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Download, Note, useAction, useFileDownload, useRead } from "./shared.tsx";

type Phase = "idle" | "waiting" | "packing" | "ready";
export const EXPORT_POLL_MS = 3000;
/** The server's answer when a save is still going after its own wait (about twenty seconds): the page does not stop on it, it says so and starts the export when the save is done. */
export const saveInProgress = (message: string): boolean => /still in progress|changed during collection/i.test(message);

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
  // a save still going after the server's wait: say so plainly, and try again every few seconds until the export starts (Cancel stops it)
  useEffect(() => { if (phase === "idle" && saveInProgress(action.note)) setPhase("waiting"); }, [action.note, phase]);
  useEffect(() => {
    if (phase !== "waiting") return undefined;
    const timer = setInterval(() => { start(); }, EXPORT_POLL_MS);
    return () => clearInterval(timer);
  }, [phase]);
  const start = (): void => {
    void action.run<CapMap["spaces.export"]["out"]>("spaces.export", {}, async (out) => {
      setRun(out.runId); setPhase("packing");
      return (await check(out.runId)) ? "The export is ready." : "Packing the Space. The download appears here when it is ready.";
    });
  };
  const note = phase === "waiting" ? "A save is taking longer than usual. Export will start when it finishes." : phase === "packing" ? "Packing the Space…" : phase === "ready" ? `Ready: ${download.name || "your export"}` : "One zip, logged in the audit log";
  return (
    <Section title="Export everything" testID="space-export">
      <Group>
        <Row id="export-all" title="Export everything" note={note} leading={<Lead><Glyph name="download" size={16} color="var(--ink-3)" /></Lead>}
          trailing={phase === "ready"
            ? <Actions>{download.url ? <Download url={download.url} name={download.name} label="Download" /> : null}<Button label="Done" testID="export-done" onPress={() => { setPhase("idle"); setRun(""); }} /></Actions>
            : phase === "waiting" ? <Actions><Button label="Still waiting for a save to finish…" testID="export-all-start" disabled onPress={() => undefined} /><Button label="Cancel" testID="export-cancel" onPress={() => setPhase("idle")} /></Actions>
            : owner ? <Button label={action.busy ? "Waiting for a save to finish…" : "Export everything"} testID="export-all-start" disabled={phase === "packing" || action.busy} onPress={start} /> : <Note>Owners only</Note>} />
      </Group>
      {action.note && phase !== "ready" && phase !== "waiting" ? <Note>{action.note}</Note> : null}
    </Section>
  );
}
