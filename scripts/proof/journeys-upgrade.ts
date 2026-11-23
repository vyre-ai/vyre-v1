// A Space upgraded from rc.39 to this branch, with Journeys made the old way (rc.41, lane r41-automations). Run twice against one data folder, from two checkouts:
//   (rc.39 tree)  node scripts/proof/journeys-upgrade.ts old <data-dir> <state.json>     makes the Space: two old-style Journeys, an Automation per type that would send an email when a stage changes, a type with its own stage field
//   (this branch) node scripts/proof/journeys-upgrade.ts new <data-dir> <state.json>     boots the same folder on the new code, lets the background move run, and checks what the owner asked to see
// Nothing here is a test of the product's own suite: it is the evidence that an upgrade of a real Space moves every Journey, runs no Automation, sends nothing, keeps old options and leaves the old records and channels open.
import fs from "node:fs";
import path from "node:path";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { fakePlatform } from "../../host/src/platform/index.ts";
import { loadConfig } from "../../host/src/daemon/config.ts";
import { startDaemon } from "../../host/src/daemon/daemon.ts";
import type { Daemon } from "../../host/src/daemon/daemon.ts";

const [mode, dir, stateFile] = process.argv.slice(2) as [string, string, string];
const OWNER = "tok-usr_olivia";
const caddy = () =>
  Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve('{"apps":{"http":{}}}'),
  });

async function boot(): Promise<Daemon> {
  return startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux",
      hostname: "upgrade-proof",
      free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddy as never,
    session: (h) =>
      /^Bearer (.+)$/.exec(String(h["authorization"] ?? ""))?.[1] === OWNER
        ? { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, device: "proof" }
        : null,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 200, tick: 200 },
  });
}
const call = async (d: Daemon, p: string, body: unknown): Promise<Record<string, any>> => {
  const r = await fetch(`${d.url}${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await r.text();
  if (r.status !== 200) throw new Error(`${p} ${r.status}: ${text.slice(0, 300)}`);
  return (JSON.parse(text) as { data?: Record<string, any> }).data ?? {};
};
const stage = (key: string, order: number, extra: Record<string, unknown> = {}) => ({
  key,
  title: key,
  order,
  exit: { requireTasks: false },
  tasks: [],
  automations: [],
  ...extra,
});
const k = (() => {
  let n = 0;
  return (s: string): string => `${s}-${++n}`;
})();
const runsOf = async (d: Daemon, id: string): Promise<number> =>
  (
    (await call(d, "/v1/runs/list", { scope: "subject", subject: { type: "automation", id }, limit: 100 }))[
      "runs"
    ] as unknown[]
  ).length;
const say = (s: string): void => console.log(s);

if (mode === "old") {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const core = bootCore();
  core.store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  fs.copyFileSync(core.file, path.join(dir, "events.db"));
  core.close();
  const d = await boot();
  const state: Record<string, any> = {};
  try {
    // a type of the Space's own with a stage field that already means something: its own options
    await call(d, "/v1/schema/apply", {
      idempotencyKey: k("type"),
      ops: [
        {
          op: "type.create",
          type: "pg_client",
          def: {
            key: "pg_client",
            title: "Client",
            plural: "Clients",
            icon: "users",
            label: "internal",
            titleField: "name",
            fields: [
              { key: "name", type: "text", title: "Name", required: true },
              {
                key: "stage",
                type: "status",
                title: "Stage",
                options: {
                  stages: [
                    { key: "new", title: "New" },
                    { key: "engaged", title: "Engaged (ours)" },
                    { key: "dormant", title: "Dormant" },
                  ],
                },
              },
            ],
          },
        },
      ],
    });
    const rec = async (type: string, fields: Record<string, unknown>): Promise<string> =>
      String((await call(d, "/v1/records/create", { type, fields, idempotencyKey: k("rec") }))["record"].id);
    const jrn = async (
      name: string,
      subjectType: string,
      stages: unknown[],
    ): Promise<{ id: string; recordType: string }> =>
      (await call(d, "/v1/journeys/create", { name, subjectType, stages, idempotencyKey: k("jrn") }))["journey"];
    const j1 = await jrn("Intake", "company", [
      stage("start", 0),
      stage("review", 1),
      stage("done", 2, { final: true }),
    ]);
    const j2 = await jrn("Client care", "pg_client", [stage("lead", 0), stage("won", 1, { final: true })]);
    const subj: Record<string, string> = {};
    for (const n of ["Acme", "Bolt", "Cyan"]) subj[n] = await rec("company", { name: n });
    for (const [n, st] of [
      ["Xavier", "new"],
      ["Yolanda", "engaged"],
    ] as const)
      subj[n] = await rec("pg_client", { name: n, stage: st });
    const start = async (j: string, s: string): Promise<string> =>
      String(
        (await call(d, "/v1/journeys/start", { journeyId: j, subjectRecordId: subj[s], idempotencyKey: k("start") }))[
          "recordId"
        ],
      );
    const legacy: Record<string, string> = {};
    for (const n of ["Acme", "Bolt", "Cyan"]) legacy[n] = await start(j1.id, n);
    for (const n of ["Xavier", "Yolanda"]) legacy[n] = await start(j2.id, n);
    await call(d, "/v1/journeys/move_stage", {
      journeyId: j1.id,
      recordId: legacy["Bolt"],
      toStage: "review",
      reason: "ready",
      idempotencyKey: k("mv"),
    });
    await call(d, "/v1/journeys/move_stage", {
      journeyId: j2.id,
      recordId: legacy["Yolanda"],
      toStage: "won",
      reason: "signed",
      idempotencyKey: k("mv"),
    });
    // Automations that would email on a change of a stage, one per type
    const notify = (name: string, type: string, fields: string[]) => ({
      idempotencyKey: k("auto"),
      name,
      definition: {
        triggers: [{ key: "record_change", filter: { type, fields } }], // a sandbox Space has no mailbox, so a send step cannot be turned on: the stand-in for "would email" is a record a Run makes, which a started Run would leave behind
        nodes: [
          { id: "note", key: "records.create", input: { type: "note_board", fields: { title: "A stage changed" } } },
        ],
      },
    });
    const autos: Record<string, string> = {};
    for (const [n, type, f] of [
      ["Notify on a client's stage", "pg_client", ["stage", "name"]],
      ["Notify on any company change", "company", ["name", "stage"]],
    ] as const) {
      const made = await call(d, "/v1/automations/create", notify(n, type, [...f]));
      const id = String(made["automation"]?.id ?? made["automationId"]);
      await call(d, "/v1/automations/set_enabled", { automationId: id, enabled: true }).catch((e) =>
        say(`(could not turn on ${n}: ${String(e).slice(0, 120)})`),
      );
      autos[n] = id;
    }
    // the control: an ordinary edit starts the Automation, so a silent one cannot pass the check after the upgrade
    await call(d, "/v1/records/update", {
      type: "pg_client",
      recordId: subj["Xavier"],
      patch: { name: "Xavier Z" },
    }).catch(() => undefined);
    await call(d, "/v1/records/update", { type: "company", recordId: subj["Acme"], patch: { name: "Acme Corp" } });
    await new Promise((r) => setTimeout(r, 2500));
    const control: Record<string, number> = {};
    for (const [n, id] of Object.entries(autos)) control[n] = await runsOf(d, id);
    const options = ((await call(d, "/v1/schema/types/get", { type: "pg_client" }))["type"].fields as any[]).find(
      (f) => f.key === "stage",
    ).options.stages;
    // every client's own value before the upgrade
    const valuesBefore: Record<string, unknown> = {};
    for (const n of ["Xavier", "Yolanda"])
      valuesBefore[n] = (await call(d, "/v1/records/get", { type: "pg_client", recordId: subj[n] }))[
        "record"
      ].fields.stage;
    Object.assign(state, { j1, j2, subj, legacy, autos, runsBefore: control, optionsBefore: options, valuesBefore });
    say(`clients' own stage values before: ${JSON.stringify(valuesBefore)}`);
    say(
      `rc.39 Space made: Journeys ${j1.id} (${j1.recordType}), ${j2.id} (${j2.recordType}); runs before the upgrade (control edits): ${JSON.stringify(control)}`,
    );
    say(`stage field options before: ${JSON.stringify(options)}`);
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } finally {
    await d.stop();
  }
} else {
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<string, any>;
  const d = await boot();
  const bad: string[] = [];
  const check = (ok: boolean, what: string): void => {
    say(`${ok ? "PASS" : "FAIL"}  ${what}`);
    if (!ok) bad.push(what);
  };
  try {
    // Client care follows a type that already has a stage field of its own, so its move names that field and says yes to taking it over (the one thing the background move never does by itself)
    const named = await call(d, "/v1/journeys/to_pipeline", {
      journeyId: state["j2"].id,
      stageField: "stage",
      useExisting: true,
    }).catch((e) => ({ error: String(e).slice(0, 240) }));
    say(`Client care moved onto its own stage field: finished ${named["finished"]} ${named["error"] ?? ""}`);
    // and the move of the rest runs by itself, one Journey a minute (here the job is run by hand)
    for (let i = 0; i < 3; i++) await d.hooks!.runPeriodic("journeys.auto_pipeline");
    await new Promise((r) => setTimeout(r, 2500));
    for (const key of ["j1", "j2"]) {
      const j = (await call(d, "/v1/journeys/get", { journeyId: state[key].id }))["journey"];
      check(
        j.mode === "pipeline",
        `${j.name}: moved onto its subject type (mode ${j.mode}, record type ${j.recordType}${j.migrateNote ? `, note: ${j.migrateNote}` : ""})`,
      );
      check(j.legacyType === state[key].recordType, `${j.name}: the old type ${state[key].recordType} is remembered`);
    }
    const counts = async (id: string) =>
      ((await call(d, "/v1/journeys/stage_counts", { journeyId: id }))["stages"] as any[])
        .filter((c) => c.count > 0)
        .map((c) => `${c.stage}:${c.count}`)
        .sort()
        .join(",");
    check(
      (await counts(state["j1"].id)) === "review:1,start:2",
      `Intake: records kept their stages (${await counts(state["j1"].id)})`,
    );
    // nothing a person had is replaced: every client's own value before the upgrade is the value after it, and the Journey took that value as the client's stage
    const stageOfClient = async (n: string): Promise<unknown> =>
      (await call(d, "/v1/records/get", { type: "pg_client", recordId: state["subj"][n] }))["record"].fields.stage;
    for (const n of ["Xavier", "Yolanda"]) {
      const after = await stageOfClient(n);
      check(
        after === state["valuesBefore"][n],
        `${n}'s own stage value is unchanged: before ${state["valuesBefore"][n]}, after ${after}`,
      );
    }
    const j2now = (await call(d, "/v1/journeys/get", { journeyId: state["j2"].id }))["journey"];
    check(
      ["new", "engaged"].every((key) => j2now.stages.some((s: { key: string }) => s.key === key)),
      `Client care learned the stages its clients already had (${j2now.stages.map((s: { key: string }) => s.key).join(", ")})`,
    );
    check(
      // Yolanda's Journey record was finished (won) before the upgrade: it stays finished, so only Xavier is in flight, in the stage he already had
      (await counts(state["j2"].id)) === "new:1",
      `Client care: the client in flight is in the stage it already had, the finished one stays finished (${await counts(state["j2"].id)})`,
    );
    const runsAfter: Record<string, number> = {};
    for (const [n, id] of Object.entries(state["autos"] as Record<string, string>)) {
      runsAfter[n] = await runsOf(d, id);
      check(
        runsAfter[n] === state["runsBefore"][n],
        `${n}: no Run started by the move (${state["runsBefore"][n]} before, ${runsAfter[n]} after)`,
      );
    }
    const opts = ((await call(d, "/v1/schema/types/get", { type: "pg_client" }))["type"].fields as any[]).find(
      (f) => f.key === "stage",
    ).options.stages as { key: string; title: string }[];
    for (const o of state["optionsBefore"] as { key: string; title: string }[])
      check(
        opts.some((x) => x.key === o.key && x.title === o.title),
        `the field's own option ${o.key} "${o.title}" is still there`,
      );
    for (const key of ["lead", "won"])
      check(
        opts.some((x) => x.key === key),
        `the Journey's stage ${key} was added to the field`,
      );
    say(`stage field options after: ${JSON.stringify(opts)}`);
    // the old Journey records, their channels and their folders are still there and open
    for (const n of ["Acme", "Bolt", "Xavier"]) {
      const jk = n === "Xavier" ? "j2" : "j1";
      const r = await call(d, "/v1/records/get", { type: state[jk].recordType, recordId: state["legacy"][n] }).catch(
        () => null,
      );
      check(!!r?.["record"], `old Journey record for ${n} opens (${state[jk].recordType})`);
    }
    const ch = (await call(d, "/v1/channels/list", {}).catch(() => ({ channels: [] })))["items"] ?? [];
    say(`channels visible after: ${Array.isArray(ch) ? ch.length : "?"}`);
    // a stage the person moves now is a normal move: the Automation that listens to it does run
    const before = await runsOf(d, state["autos"]["Notify on any company change"]);
    await call(d, "/v1/records/update", {
      type: "company",
      recordId: state["subj"]["Cyan"],
      patch: { name: "Cyan Co" },
    });
    await new Promise((r) => setTimeout(r, 2500));
    check(
      (await runsOf(d, state["autos"]["Notify on any company change"])) > before,
      "an ordinary edit after the upgrade still starts its Automation",
    );
  } finally {
    await d.stop();
  }
  say(bad.length ? `\n${bad.length} check(s) failed` : "\nall checks passed");
  process.exit(bad.length ? 1 : 0);
}
