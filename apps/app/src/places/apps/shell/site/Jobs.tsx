// The jobs and workers of a site, as rows under "Runs with" on its Overview: a scheduled job (a command run in the site's own image on a schedule, with its history) and a worker (a process that stays up).
// A job row opens under itself: what it runs, when next, Run now, Pause, Change, and its runs; a run opens to its output. A worker row says what it is doing in a sentence and has Restart, Stop and Remove.
// Both are read again every few seconds while the page is open, so a run that starts or a worker that crashes shows without a refresh.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Row } from "../../../../../../../ui/src/Row/index.tsx";
import { useSpaceZone, useWhenText } from "../../../../../../../ui/src/Time/index.tsx";
import { deviceZone } from "../../../../../../../lib/zones.ts";
import { useAppsData } from "../data.tsx";
import { actionKey, errorMessage, mutate } from "../mutations.ts";
import { Button, Select, TextBox, useRead } from "../editor-ui.tsx";
import { LogLines, MenuButton, StepMark } from "./parts.tsx";
import {
  RUN_WORD,
  SCHEDULE_PRESETS,
  jobProblem,
  presetOf,
  runMark,
  serviceMark,
  serviceNote,
  took,
} from "./ops-model.ts";
import type { JobOut, JobRun, ServiceOut } from "./ops-model.ts";

const REFRESH_MS = 5000;

function useCalls(siteId: string): {
  error: string | null;
  busy: boolean;
  act(cap: string, input: Record<string, unknown>): Promise<unknown>;
  clear(): void;
} {
  const d = useAppsData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return {
    error,
    busy,
    clear: () => setError(null),
    act: async (cap, input) => {
      setBusy(true);
      setError(null);
      try {
        return await mutate(d, cap, { siteId, ...input }, actionKey());
      } catch (e) {
        setError(errorMessage(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
  };
}

export function JobsAndWorkers({ siteId }: { siteId: string }): ReactElement {
  const jobs = useRead<{ jobs: JobOut[] }>("sites.jobs_list", { siteId }, "sites");
  const services = useRead<{ services: ServiceOut[] }>("sites.services_list", { siteId }, "sites");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<"job" | "worker" | JobOut | null>(null);
  const when = useWhenText();
  const calls = useCalls(siteId);
  useEffect(() => {
    const t = setInterval(() => {
      jobs.refresh();
      services.refresh();
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, [jobs.refresh, services.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = useAppsData();
  const now = d.clock().now;
  const done = (): void => {
    jobs.refresh();
    services.refresh();
  };
  return (
    <View style={s.block} testID="site-jobs">
      {(services.data?.services ?? []).map((v) => (
        <Row
          key={v.serviceId}
          id={v.serviceId}
          title={v.name}
          note={serviceNote(v)}
          leading={<StepMark state={serviceMark(v.state)} />}
          trailing={
            <MenuButton
              title="Actions"
              testID={`site-worker-${v.serviceId}`}
              entries={[
                {
                  label: "Restart",
                  onSelect: () => void calls.act("sites.service_restart", { serviceId: v.serviceId }).then(done),
                },
                ...(v.state === "stopped" || v.state === "failed"
                  ? []
                  : [
                      {
                        label: "Stop",
                        onSelect: () => void calls.act("sites.service_stop", { serviceId: v.serviceId }).then(done),
                      },
                    ]),
                { separator: true as const },
                {
                  label: "Remove",
                  danger: true,
                  onSelect: () => void calls.act("sites.service_remove", { serviceId: v.serviceId }).then(done),
                },
              ]}
            />
          }
        />
      ))}
      {/* ui-rows-lint: not a list (each item is a ui/Row with its detail opened under it) */}
      {(jobs.data?.jobs ?? []).map((j) => (
        <View key={j.jobId}>
          <Row
            id={j.jobId}
            title={j.name}
            note={`${j.when}${j.enabled ? "" : " · Paused"}`}
            selected={open === j.jobId}
            leading={<StepMark state={j.last ? runMark(j.last.state) : "waiting"} />}
            onPress={() => setOpen(open === j.jobId ? null : j.jobId)}
            trailing={
              <Text style={s.word} testID={`site-job-${j.jobId}`}>
                {j.last && j.last.state === "running"
                  ? "Running"
                  : j.enabled && j.nextAt
                    ? `Next: ${when(j.nextAt, now)}`
                    : j.last
                      ? when(j.last.at, now)
                      : "Not run yet"}
              </Text>
            }
          />
          {open === j.jobId ? <JobDetail job={j} siteId={siteId} onChange={done} onEdit={() => setForm(j)} /> : null}
        </View>
      ))}
      {form ? (
        form === "worker" ? (
          <WorkerForm siteId={siteId} onClose={() => setForm(null)} onSaved={() => (setForm(null), done())} />
        ) : (
          <JobForm
            siteId={siteId}
            job={form === "job" ? null : form}
            onClose={() => setForm(null)}
            onSaved={() => (setForm(null), done())}
          />
        )
      ) : (
        <View style={s.add}>
          <MenuButton
            title="Add a job or worker"
            testID="site-job-add"
            entries={[
              { label: "Scheduled job", hint: "Runs a command on a schedule", onSelect: () => setForm("job") },
              { label: "Worker", hint: "Stays up and restarts itself", onSelect: () => setForm("worker") },
            ]}
          />
        </View>
      )}
      {calls.error ? <Text style={s.error}>{calls.error}</Text> : null}
    </View>
  );
}

function JobDetail({
  job,
  siteId,
  onChange,
  onEdit,
}: {
  job: JobOut;
  siteId: string;
  onChange(): void;
  onEdit(): void;
}): ReactElement {
  const runs = useRead<{ runs: JobRun[] }>("sites.job_runs", { siteId, jobId: job.jobId, limit: 20 }, "sites");
  const calls = useCalls(siteId);
  const when = useWhenText();
  const d = useAppsData();
  const now = d.clock().now;
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => runs.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [runs.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const going = (runs.data?.runs ?? []).some((r) => r.state === "running" || r.state === "queued");
  const after = (): void => {
    runs.refresh();
    onChange();
  };
  return (
    <View style={s.detail} testID="site-job-detail">
      <Text selectable style={s.code}>
        {job.command}
      </Text>
      <Text style={s.hint}>{`${job.when} · ${job.zone} · stops after ${job.timeoutSec} s`}</Text>
      <View style={s.actions}>
        <Button
          title={going ? "Running" : "Run now"}
          primary
          disabled={going || calls.busy}
          testID="site-job-run"
          onPress={() => void calls.act("sites.job_run", { jobId: job.jobId }).then(after)}
        />
        {going ? (
          <Button
            title="Stop"
            onPress={() => {
              const r = (runs.data?.runs ?? []).find((x) => x.state === "running" || x.state === "queued");
              if (r) void calls.act("sites.job_cancel", { runId: r.runId }).then(after);
            }}
          />
        ) : null}
        <Button title="Change" onPress={onEdit} />
        <MenuButton
          title="More"
          entries={[
            {
              label: job.enabled ? "Pause" : "Resume",
              onSelect: () =>
                void calls.act("sites.job_update", { jobId: job.jobId, enabled: !job.enabled }).then(after),
            },
            { separator: true as const },
            {
              label: "Delete",
              danger: true,
              onSelect: () => void calls.act("sites.job_delete", { jobId: job.jobId }).then(after),
            },
          ]}
        />
      </View>
      {calls.error ? <Text style={s.error}>{calls.error}</Text> : null}
      <Text style={s.title}>Runs</Text>
      {(runs.data?.runs ?? []).length === 0 ? <Text style={s.hint}>None yet.</Text> : null}
      {/* ui-rows-lint: not a list (each item is a ui/Row with its output opened under it) */}
      {(runs.data?.runs ?? []).map((r) => (
        <View key={r.runId}>
          <Row
            id={r.runId}
            title={r.note ?? RUN_WORD[r.state]}
            note={took(r)}
            selected={shown === r.runId}
            leading={<StepMark state={runMark(r.state)} />}
            onPress={() => setShown(shown === r.runId ? null : r.runId)}
            trailing={
              <Text style={s.runMeta} testID={`site-run-${r.runId}`}>
                {when(r.at, now)}
              </Text>
            }
          />
          {shown === r.runId ? <RunOutput siteId={siteId} runId={r.runId} /> : null}
        </View>
      ))}
    </View>
  );
}

function RunOutput({ siteId, runId }: { siteId: string; runId: string }): ReactElement {
  const out = useRead<{ lines: { text: string }[] }>(
    "sites.logs_read",
    { siteId, scope: runId, source: "jobs", limit: 200 },
    "sites",
  );
  useEffect(() => {
    const t = setInterval(() => out.refresh(), 2000);
    return () => clearInterval(t);
  }, [out.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <LogLines
      lines={(out.data?.lines ?? []).map((l) => l.text)}
      empty="It printed nothing."
      height={160}
      testID="site-run-output"
    />
  );
}

function JobForm({
  siteId,
  job,
  onClose,
  onSaved,
}: {
  siteId: string;
  job: JobOut | null;
  onClose(): void;
  onSaved(): void;
}): ReactElement {
  const zone = useSpaceZone() ?? deviceZone();
  const [name, setName] = useState(job?.name ?? "");
  const [preset, setPreset] = useState(job ? presetOf(job.schedule) : "0 2 * * *");
  const [custom, setCustom] = useState(job && presetOf(job.schedule) === "custom" ? job.schedule : "");
  const [command, setCommand] = useState(job?.command ?? "");
  const calls = useCalls(siteId);
  const schedule = preset === "custom" ? custom : preset;
  const problem = jobProblem({ name, schedule, command });
  const [shown, setShown] = useState(false);
  return (
    <View style={s.form} testID="site-job-form">
      <TextBox label="Name" value={name} onChange={setName} placeholder="Nightly stock sync" />
      <Select label="When" value={preset} options={SCHEDULE_PRESETS} onChange={setPreset} />
      {preset === "custom" ? (
        <TextBox label="Schedule" value={custom} onChange={setCustom} placeholder="30 6 * * 1-5" />
      ) : null}
      <TextBox label="Command" value={command} onChange={setCommand} placeholder="node scripts/sync-stock.js" />
      <Text style={s.hint}>{`It runs in this site's own image, with the site's variables. Times are in ${zone}.`}</Text>
      {shown && problem ? <Text style={s.error}>{problem}</Text> : null}
      {calls.error ? <Text style={s.error}>{calls.error}</Text> : null}
      <View style={s.actions}>
        <Button
          title={job ? "Save" : "Add the job"}
          primary
          disabled={calls.busy}
          testID="site-job-save"
          onPress={() => {
            setShown(true);
            if (problem) return;
            const body = {
              name: name.trim(),
              schedule: schedule.trim(),
              command: command.trim(),
              zone: job?.zone ?? zone,
            };
            void (
              job ? calls.act("sites.job_update", { jobId: job.jobId, ...body }) : calls.act("sites.job_create", body)
            ).then((o) => {
              if (o) onSaved();
            });
          }}
        />
        <Button title="Cancel" onPress={onClose} />
      </View>
    </View>
  );
}

function WorkerForm({ siteId, onClose, onSaved }: { siteId: string; onClose(): void; onSaved(): void }): ReactElement {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [shown, setShown] = useState(false);
  const calls = useCalls(siteId);
  const problem =
    name.trim() === "" ? "Give the worker a name." : command.trim() === "" ? "Give the command to run." : null;
  return (
    <View style={s.form} testID="site-worker-form">
      <TextBox label="Name" value={name} onChange={setName} placeholder="Queue" />
      <TextBox label="Command" value={command} onChange={setCommand} placeholder="node worker.js" />
      <Text style={s.hint}>
        It stays up in this site's own image, with the site's variables and no port. If it crashes it starts again,
        waiting longer each time.
      </Text>
      {shown && problem ? <Text style={s.error}>{problem}</Text> : null}
      {calls.error ? <Text style={s.error}>{calls.error}</Text> : null}
      <View style={s.actions}>
        <Button
          title="Add the worker"
          primary
          disabled={calls.busy}
          testID="site-worker-save"
          onPress={() => {
            setShown(true);
            if (problem) return;
            void calls.act("sites.service_add", { name: name.trim(), command: command.trim() }).then((o) => {
              if (o) onSaved();
            });
          }}
        />
        <Button title="Cancel" onPress={onClose} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  block: { gap: 2 },
  word: { fontSize: 12, color: "var(--ink-3)" as string },
  add: { paddingTop: 6, alignItems: "flex-start" },
  detail: {
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "var(--sunk)" as string,
    marginVertical: 6,
  },
  code: { fontFamily: "var(--mono)" as string, fontSize: 12, color: "var(--ink-2)" as string },
  hint: { fontSize: 12, color: "var(--ink-3)" as string },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  title: { fontSize: 13, fontWeight: "600", color: "var(--ink)" as string, marginTop: 4 },
  run: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 34 },
  runText: { flex: 1, minWidth: 0, fontSize: 13, color: "var(--ink)" as string },
  runMeta: { fontSize: 12, color: "var(--ink-3)" as string },
  form: { gap: 12, paddingVertical: 12 },
  error: { fontSize: 12.5, color: "var(--danger)" as string },
});
