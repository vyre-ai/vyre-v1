import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import type { CapMap } from "../../../../../generated/types.ts";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { Section, Group } from "../shell/ui.tsx";
import { Actions, Button, Field, Note, ReadState, useAction, useRead } from "./shared.tsx";
import { useConsoleData } from "../shell/data.tsx";

type Config = CapMap["backup.config_get"]["out"];
type List = CapMap["backup.list"]["out"];
type Preview = CapMap["backup.restore_preview"]["out"];
export function Backups(): ReactElement {
  const data = useConsoleData();
  const config = useRead<Config>("backup.config_get");
  const list = useRead<List>("backup.list");
  const [path, setPath] = useState("");
  const [schedule, setSchedule] = useState("0 3 * * *");
  const [preview, setPreview] = useState<{ backupId: string; value: Preview } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const action = useAction(() => { list.refresh(); config.refresh(); });
  useEffect(() => { if (config.data) { setPath(config.data.target?.kind === "local" ? config.data.target.path ?? "" : ""); setSchedule(config.data.schedule); } }, [config.data]);
  const restorePreview = async (backupId: string): Promise<void> => {
    setPreviewError("");
    try { setPreview({ backupId, value: await data.call("backup.restore_preview", { backupId }) as Preview }); }
    catch { setPreviewError("Couldn’t preview this restore. Check the backup and try again."); }
  };
  if (!config.data || !list.data) return <ReadState error={config.error ?? list.error} retry={() => { config.refresh(); list.refresh(); }} />;
  const rows: ReactElement[] = [];
  for (const backup of list.data.backups) rows.push(<View key={backup.backupId}><Row id={`backup-${backup.backupId}`} title={new Date(backup.at).toLocaleString()} note={`${backup.sizeBytes.toLocaleString()} bytes · Sequence ${backup.seq} · ${backup.verified ? "Verified" : "Not verified"}`} onPress={() => void restorePreview(backup.backupId)} trailing={<Actions><Button label="Verify" testID={`verify-${backup.backupId}`} disabled={action.busy} onPress={() => void action.run<CapMap["backup.verify"]["out"]>("backup.verify", { backupId: backup.backupId }, (out) => out.ok ? "Backup verified" : "This backup did not verify")} /><Button label="Restore…" testID={`restore-${backup.backupId}`} disabled={action.busy} onPress={() => void restorePreview(backup.backupId)} /></Actions>} /></View>);
  return <View testID="console-backups"><Section title="Backup target"><Group><Text>{config.data.encrypted ? "Backups are encrypted" : "Backups are not encrypted"}</Text>{config.data.target && config.data.target.kind !== "local" ? <Note>Current target: {config.data.target.kind}. Saving below switches to a local target.</Note> : null}<Field label="Local backup directory on this server" testID="backup-path" value={path} onChange={setPath} /><Field label="Schedule (cron)" testID="backup-schedule" value={schedule} onChange={setSchedule} /><Actions><Button label="Save local target" testID="backup-config-save" disabled={action.busy || !path.trim() || !schedule.trim()} onPress={() => void action.run("backup.config_set", { target: { kind: "local", path: path.trim() }, schedule: schedule.trim(), enabled: true }, "Backup target saved")} /><Button label="Back up now" testID="backup-run" disabled={action.busy || !config.data?.target} onPress={() => void action.run("backup.run", {}, "Backup requested. A completed backup appears below.")} /></Actions></Group></Section><Section title="Backups" count={list.data.backups.length}><Group>{rows.length ? rows : <Note>No backups yet. Choose a target and run a backup.</Note>}</Group></Section>{previewError ? <Note>{previewError}</Note> : null}{preview ? <Section title="Confirm restore"><Group><Note>Restore sequence {preview.value.fromSeq} to {preview.value.toSeq}. Replay {preview.value.tombstones} deletion markers. Expected downtime: {preview.value.downtimeSeconds} seconds. Vyre takes a safety backup first.</Note><Actions><Button label="Cancel" onPress={() => setPreview(null)} /><Button label="Confirm restore" testID="backup-restore-confirm" danger disabled={action.busy} onPress={() => void action.run("backup.restore", { backupId: preview.backupId, confirm: true }, "Restore requested. A staged restore takes effect when the server restarts.").then((out) => { if (out) setPreview(null); })} /></Actions></Group></Section> : null}{action.note ? <Note>{action.note}</Note> : null}</View>;
}
