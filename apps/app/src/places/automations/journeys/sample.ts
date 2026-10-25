// The sample Journeys behind the designer's tests and screenshots: Client onboarding as the prototype draws it (five stages, their tasks with Assigned, Reviewer and Approver, the key and backup
// for the agent tasks, the Automations on Send intake form and Onboarded), and Matter intake; Harbor Studio gets Client project. They are attached to a fake replica that already holds the
// Automations sample: each capability the designer reads is registered with a resolver over those rows, and the writes it makes change the rows, so every control in a mount really works.
import type { FakeReplica, Row } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import type { Journey, Preview, Ref, Stage, Task } from "./model.ts";

const DAY = 86_400_000;
export const JOURNEY_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);

const person = (id: string): Ref => ({ kind: "person", id });
const agent = (id: string): Ref => ({ kind: "agent", id });
interface T { title: string; kind?: Task["kind"]; who: Ref; reviewer?: Ref; approver?: Ref; hours?: number; required?: boolean; key?: string; backup?: string; brief?: string }
const task = (key: string, o: T): Task => ({
  key, title: o.title, assigned: o.who, required: o.required ?? true,
  ...(o.kind ? { kind: o.kind } : {}),
  ...(o.reviewer ? { reviewer: o.reviewer } : {}), ...(o.approver ? { approver: o.approver } : {}),
  ...(o.hours ? { dueAfterHours: o.hours } : {}), ...(o.key ? { keyId: o.key } : {}), ...(o.backup ? { backupKeyId: o.backup } : {}), ...(o.brief ? { description: o.brief } : {}),
});
const stage = (key: string, title: string, order: number, tasks: Task[], extra: Partial<Stage> = {}): Stage => ({ key, title, order, exit: { requireTasks: true }, tasks, automations: [], ...extra });

const lena = person("usr_lena"), maya = person("usr_maya"), omar = person("usr_omar");

export const ONBOARDING: Stage[] = [
  stage("consult", "Consult booked", 0, [task("t_confirm", { title: "Confirm the consult time", who: lena, hours: 24 }), task("t_intake", { title: "Send the intake form", who: agent("agt_automation"), hours: 0 })], { automations: ["aut_intake1"] }),
  stage("intake", "Intake", 1, [
    task("t_review", { title: "Review the intake answers", who: agent("agt_intake"), reviewer: lena, hours: 24, key: "key_claude", backup: "key_nw_openai" }),
    task("t_conflict", { title: "Run the conflict check", who: agent("agt_research"), approver: maya, hours: 48, key: "key_nw_openai", backup: "key_claude" }),
    task("t_id", { title: "Collect the client's ID", who: lena, hours: 72 }),
  ], { timeLimit: { hours: 72, escalateTo: { kind: "person", id: "usr_lena" } } }),
  stage("letter", "Engagement letter", 2, [
    task("t_draft", { title: "Draft the engagement letter", who: agent("agt_docs"), reviewer: omar, approver: maya, hours: 48, key: "key_nw_openai", backup: "key_claude" }),
    task("t_sign", { title: "Sign engagement letter", kind: "signature", who: lena, hours: 72 }),
    task("t_terms", { title: "Note any special terms", who: omar, hours: 72, required: false }),
  ]),
  stage("kickoff", "Kickoff", 3, [task("t_book", { title: "Book the kickoff call", who: lena, hours: 48 }), task("t_notes", { title: "Prepare the kickoff notes", who: agent("agt_assistant"), reviewer: omar, hours: 24, key: "key_claude", backup: "key_nw_openai" })]),
  stage("onboarded", "Onboarded", 4, [task("t_hand", { title: "Hand over to the client's team", who: omar, hours: 24 })], { automations: ["aut_intake3"], final: true }),
];

const MATTER: Stage[] = [
  stage("new", "New", 0, [task("m_open", { title: "Open the matter", who: lena, hours: 24 })]),
  stage("conflicts", "Conflict check", 1, [task("m_check", { title: "Run the conflict check", who: agent("agt_research"), approver: maya, hours: 48, key: "key_nw_openai" })]),
  stage("engaged", "Engaged", 2, [task("m_letter", { title: "Send the engagement letter", who: lena, hours: 48 })]),
  stage("closed", "Closed", 3, [], { final: true }),
];
const CLIENT_PROJECT: Stage[] = [
  stage("brief", "Brief", 0, [task("h_brief", { title: "Read the brief", who: person("usr_ines"), hours: 24 })]),
  stage("shoot", "Shoot", 1, [task("h_plan", { title: "Plan the shoot", who: agent("agt_scheduler"), reviewer: person("usr_june"), hours: 48, key: "key_claude" })]),
  stage("edit", "Edit", 2, [task("h_cut", { title: "Cut the first pass", who: person("usr_june"), hours: 72 })]),
  stage("deliver", "Deliver", 3, [], { final: true }),
];

export interface JourneyFixture { journey: Journey; counts: Record<string, { count: number; over: number }> }

export function fixtures(space: "northwind" | "harbor"): JourneyFixture[] {
  if (space === "harbor") {
    return [{ journey: { id: "jrn_h", name: "Client project", subjectType: "client", recordType: "rt_project", version: 1, stages: CLIENT_PROJECT, startRule: { event: "form.submitted", enabled: true }, inFlight: 2, createdAt: JOURNEY_NOW - 20 * DAY, updatedAt: JOURNEY_NOW - 5 * DAY },
      counts: { brief: { count: 1, over: 0 }, shoot: { count: 1, over: 0 }, edit: { count: 0, over: 0 }, deliver: { count: 0, over: 0 } } }];
  }
  return [
    { journey: { id: "jrn_onboard", name: "Client onboarding", subjectType: "lead", recordType: "Client onboarding", version: 3, stages: ONBOARDING, startRule: { event: "lead.created", enabled: true }, inFlight: 14, createdAt: JOURNEY_NOW - 30 * DAY, updatedAt: JOURNEY_NOW - 3 * DAY },
      counts: { consult: { count: 3, over: 0 }, intake: { count: 4, over: 1 }, letter: { count: 3, over: 0 }, kickoff: { count: 2, over: 0 }, onboarded: { count: 2, over: 0 } } },
    { journey: { id: "jrn_matter", name: "Matter intake", subjectType: "person", recordType: "Matter intake", version: 2, stages: MATTER, inFlight: 7, createdAt: JOURNEY_NOW - 40 * DAY, updatedAt: JOURNEY_NOW - 9 * DAY },
      counts: { new: { count: 3, over: 0 }, conflicts: { count: 2, over: 0 }, engaged: { count: 2, over: 0 }, closed: { count: 0, over: 0 } } },
  ];
}

/** The records an old version holds, by stage, for the migration preview: Client onboarding v2 had a stage that v3 split in two. */
const OLD_STAGES: Record<string, { from: string; records: number; to: string | null }[]> = {
  jrn_onboard: [{ from: "consult", records: 3, to: "consult" }, { from: "paperwork", records: 4, to: null }, { from: "letter", records: 3, to: "letter" }, { from: "kickoff", records: 2, to: "kickoff" }, { from: "onboarded", records: 2, to: "onboarded" }],
};

export interface JourneyWrites { writes: Record<string, (input: never) => unknown> }

/** Registers the Journey capabilities on a replica that holds the Automations sample. `names` is added to the name lookup by the caller. */
export function attachJourneys(replica: FakeReplica, space: "northwind" | "harbor", me: string): JourneyWrites {
  const fx = fixtures(space);
  replica.put("journeys_full", fx.map((f) => ({ ...f.journey, id: f.journey.id }) as unknown as Row));
  replica.put("journey_counts", fx.flatMap((f) => Object.entries(f.counts).map(([stage, c]) => ({ id: `${f.journey.id}:${stage}`, journeyId: f.journey.id, stage, count: c.count, overLimit: c.over }) as Row)));
  replica.put("journey_versions", fx.flatMap((f) => Array.from({ length: f.journey.version }, (_, i) => ({ id: `${f.journey.id}:v${i + 1}`, journeyId: f.journey.id, versionId: `jv_${f.journey.id}_${i + 1}`, n: f.journey.version - i, by: me, at: JOURNEY_NOW - (i + 1) * 6 * DAY, reason: i === 0 ? "Added a time limit to Intake" : "An earlier design" }) as Row)));

  const getJ = (id: string): Journey => {
    const r = replica.rows("journeys_full").find((x) => x.id === id);
    if (!r) throw new Error("no such journey");
    return r as unknown as Journey;
  };
  const putJ = (j: Journey): Journey => { replica.put("journeys_full", [j as unknown as Row]); syncList(j); return j; };
  const syncList = (j: Journey): void => {
    const row = replica.rows("journeys").find((x) => x.id === j.id);
    if (row) replica.put("journeys", [{ ...row, name: j.name, stages: j.stages.length, version: j.version, inFlight: j.inFlight } as Row]);
  };

  replica.resolve("journeys.get", (_t, input) => ({ journey: replica.rows("journeys_full").find((x) => x.id === input.journeyId) as unknown as Journey }) as CapMap["journeys.get"]["out"]);
  replica.resolve("journeys.stage_counts", (_t, input) => ({ stages: replica.rows("journey_counts").filter((c) => c["journeyId"] === input.journeyId).map((c) => ({ stage: c["stage"] as string, count: c["count"] as number, overLimit: c["overLimit"] as number })) }) as CapMap["journeys.stage_counts"]["out"]);
  replica.resolve("journeys.versions", (_t, input) => ({ versions: replica.rows("journey_versions").filter((v) => v["journeyId"] === input.journeyId).map(({ id: _id, journeyId: _j, ...v }) => v) }) as unknown as CapMap["journeys.versions"]["out"]);

  let created = 0;
  const writes: Record<string, (input: never) => unknown> = {
    "journeys.design": (i: { journeyId: string; stages: Stage[]; startRule?: Journey["startRule"] | null; expectedVersion?: number }) => {
      const cur = getJ(i.journeyId);
      if (i.expectedVersion !== undefined && i.expectedVersion !== cur.version) throw new Error("Someone else changed this Journey. Reload it.");
      const stages = i.stages.map((s, n) => ({ ...s, order: n }));
      const seen = new Set<string>();
      for (const s of stages) { if (!s.title.trim()) throw new Error("A stage needs a name"); if (seen.has(s.key)) throw new Error("Two stages share a key"); seen.add(s.key); }
      for (const old of cur.stages) {
        const c = replica.rows("journey_counts").find((x) => x["journeyId"] === cur.id && x["stage"] === old.key);
        if (!seen.has(old.key) && c && (c["count"] as number) > 0) throw new Error(`${old.title} has records in it. Move them on first.`);
      }
      const next: Journey = { ...cur, stages, version: cur.version + 1, updatedAt: JOURNEY_NOW };
      if (i.startRule === null) delete (next as Partial<Journey>).startRule; else if (i.startRule) next.startRule = i.startRule;
      // counts for a new stage start at zero
      replica.put("journey_counts", stages.filter((s) => !replica.rows("journey_counts").some((x) => x["journeyId"] === cur.id && x["stage"] === s.key)).map((s) => ({ id: `${cur.id}:${s.key}`, journeyId: cur.id, stage: s.key, count: 0, overLimit: 0 }) as Row));
      return { journey: putJ(next) };
    },
    "journeys.rules.set": (i: { journeyId: string; stageKey: string; exit?: Stage["exit"]; timeLimit?: Stage["timeLimit"] | null }) => {
      const cur = getJ(i.journeyId);
      const stages = cur.stages.map((s) => {
        if (s.key !== i.stageKey) return s;
        const n: Stage = { ...s, ...(i.exit ? { exit: i.exit } : {}) };
        if (i.timeLimit === null) delete (n as Partial<Stage>).timeLimit; else if (i.timeLimit) n.timeLimit = i.timeLimit;
        return n;
      });
      return { journey: putJ({ ...cur, stages, version: cur.version + 1, updatedAt: JOURNEY_NOW }) };
    },
    "journeys.rename": (i: { journeyId: string; name: string }) => ({ journey: putJ({ ...getJ(i.journeyId), name: i.name }) }),
    "journeys.delete": (i: { journeyId: string }) => { replica.remove("journeys_full", [i.journeyId]); replica.remove("journeys", [i.journeyId]); return { deleted: true }; },
    "journeys.preview_migrate": (i: { journeyId: string; toVersion: number; stageMap?: Record<string, string> }): Preview => {
      const cur = getJ(i.journeyId);
      const old = OLD_STAGES[i.journeyId] ?? [];
      const moves = old.map((m) => ({ from: m.from, to: i.stageMap?.[m.from] ?? (cur.stages.some((s) => s.key === m.to) ? m.to : null), records: m.records }));
      const unmapped = moves.filter((m) => m.to === null).map((m) => m.from);
      return { fromVersion: cur.version - 1, toVersion: i.toVersion, recordsAffected: moves.reduce((n, m) => n + m.records, 0), moves, unmapped, blockers: [] };
    },
    "journeys.migrate": (i: { journeyId: string; stageMap: Record<string, string> }) => {
      const old = OLD_STAGES[i.journeyId] ?? [];
      if (old.some((m) => i.stageMap[m.from] === undefined)) throw new Error("Every stage needs a place to go");
      return { runId: "run_migrate" };
    },
    "journeys.create": (i: { name: string; subjectType: string; stages?: Stage[] }) => {
      created += 1;
      const j: Journey = { id: `jrn_new${created}`, name: i.name, subjectType: i.subjectType, recordType: i.name, version: 1, stages: (i.stages ?? []).map((s, n) => ({ ...s, order: n })), inFlight: 0, createdAt: JOURNEY_NOW, updatedAt: JOURNEY_NOW };
      replica.put("journeys", [{ id: j.id, name: j.name, subjectType: j.subjectType, recordType: j.recordType, version: 1, stages: j.stages.length, inFlight: 0, updatedAt: JOURNEY_NOW } as Row]);
      replica.put("journey_counts", j.stages.map((s) => ({ id: `${j.id}:${s.key}`, journeyId: j.id, stage: s.key, count: 0, overLimit: 0 }) as Row));
      return { journey: putJ(j) };
    },
  };
  return { writes };
}
