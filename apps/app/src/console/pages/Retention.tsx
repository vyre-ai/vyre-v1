import { useState } from "react";
import type { ReactElement } from "react";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import type { CapMap } from "../../../../../generated/types.ts";
import { Group, Section } from "../shell/ui.tsx";
import { useConsoleData } from "../shell/data.tsx";
import { Actions, Button, Field, Note, ReadState, attempt, useAction, useRead } from "./shared.tsx";
import { Choice } from "./ai-controls.tsx";
import { retentionValue } from "./ai-data-values.ts";

type RetentionOut = CapMap["governance.retention.get"]["out"];
type RetentionRow = RetentionOut["kinds"][number];

export function Retention(): ReactElement {
  const data = useConsoleData();
  const retention = useRead<RetentionOut>("governance.retention.get");
  const jobs = useRead<CapMap["governance.jobs.list"]["out"]>("governance.jobs.list");
  const schema = useRead<CapMap["schema.describe"]["out"]>("schema.describe");
  const [selectedKey, setSelectedKey] = useState<RetentionRow["key"] | null>(null);
  const [recordType, setRecordType] = useState("");
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "run" | null>(null);
  const [error, setError] = useState("");
  const refresh = (): void => { retention.refresh(); jobs.refresh(); schema.refresh(); };
  const action = useAction(refresh);
  if (!retention.data || !jobs.data || !schema.data) return <ReadState error={retention.error ?? jobs.error ?? schema.error} retry={refresh} />;
  const selected = retention.data.kinds.find((row) => row.key === selectedKey) ?? null;
  const currentValue = selected ? recordType ? selected.perRecordType?.[recordType] ?? selected.value : selected.value : "";
  const choose = (row: RetentionRow): void => { setSelectedKey(row.key); setRecordType(""); setDraft(row.value); setReviewed(null); setConfirm(null); setError(""); };
  const review = (): void => { try { setReviewed(retentionValue(draft)); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Check this retention rule."); } };
  const readback = async (expected: string): Promise<string> => {
    const out = await data.call("governance.retention.get", {}) as RetentionOut;
    const row = out.kinds.find((item) => item.key === selected!.key);
    const saved = recordType ? row?.perRecordType?.[recordType] : row?.value;
    if (saved !== expected) throw new Error("The saved retention rule did not match the reviewed rule.");
    return "Retention rule updated";
  };
  const job = selected ? jobs.data.jobs.find((item) => item.kind === selected.key) : null;
  return <>
    <Section title="Retention policies" count={retention.data.kinds.length}><Group>{retention.data.kinds.map((row) => <Row key={row.key} title={row.title} note={`${row.value}${row.overridden ? " · Overridden" : " · Default"}${row.holdable ? " · Holds apply" : ""}`} selected={selectedKey === row.key} onPress={() => choose(row)} />)}</Group></Section>
    {selected ? <Section title={selected.title}><Group>
      {selected.key === "records" ? <Choice label="Rule applies to" value={recordType} options={[{ key: "", title: "All record types" }, ...schema.data.types.map((type) => ({ key: type.key, title: type.title }))]} onChange={(value) => { setRecordType(value); setDraft(value ? selected.perRecordType?.[value] ?? selected.value : selected.value); setReviewed(null); setConfirm(null); }} /> : null}
      <Row title="Default" note={selected.default} /><Row title="In force" note={currentValue} /><Row title="Tombstones" note={selected.tombstone ? "Reapplied after restore" : "Not used"} />
      <Field label="Retention duration" value={draft} onChange={(value) => { setDraft(value); setReviewed(null); setConfirm(null); setError(""); }} />
      {error ? <Note>{error}</Note> : null}
      {reviewed ? <><Note>{selected.title} will change from {currentValue} to {reviewed}{recordType ? ` for ${schema.data.types.find((type) => type.key === recordType)?.title ?? recordType}` : ""}.</Note><Actions><Button label="Back" onPress={() => setReviewed(null)} /><Button label="Apply rule" danger disabled={action.busy} onPress={() => void action.run("governance.retention.set", { kind: selected.key, value: reviewed, ...(recordType ? { recordType } : {}) }, () => readback(reviewed)).then((out) => { if (out) setReviewed(null); })} /></Actions></> : <Actions><Button label="Review change" onPress={review} /><Button label="Reset to default…" onPress={() => setConfirm("reset")} /><Button label="Run job now…" onPress={() => setConfirm("run")} /></Actions>}
      {confirm === "reset" ? <><Note>This removes the {recordType ? "record-type" : "Space"} override and restores the declared default.</Note><Actions><Button label="Cancel" onPress={() => setConfirm(null)} /><Button label="Confirm reset" danger disabled={action.busy} onPress={() => void action.run("governance.retention.reset", { kind: selected.key, ...(recordType ? { recordType } : {}) }, "Retention reset").then((out) => { if (out) setConfirm(null); })} /></Actions></> : null}
      {confirm === "run" ? <><Note>The retention job will remove expired data and skip anything covered by a hold.</Note><Actions><Button label="Cancel" onPress={() => setConfirm(null)} /><Button label="Start job" danger disabled={action.busy} onPress={() => void action.run<CapMap["governance.jobs.run_now"]["out"]>("governance.jobs.run_now", { kind: selected.key, idempotencyKey: attempt() }, (out) => `Retention run ${out.runId} started`).then((out) => { if (out) setConfirm(null); })} /></Actions></> : null}
      {job ? <><Row title="Job state" note={job.state} /><Row title="Last run" note={job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Not run yet"} /><Row title="Next run" note={job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "Not scheduled"} /><Row title="Last result" note={`${job.lastRemoved ?? 0} removed · ${job.lastSkippedOnHold ?? 0} skipped on hold`} /></> : null}
    </Group></Section> : <Note>Select a policy to inspect or change it.</Note>}
    {action.note ? <Note>{action.note}</Note> : null}
  </>;
}
