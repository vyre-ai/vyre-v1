// The sample behind the project page tests and screenshots: the prototype's Rivera engagement (four stages, a dozen tasks and milestones, dependencies, members) answered by an in-memory stand-in
// for the Projects capabilities. projects.reschedule moves a task, projects.cascade proposes what follows, projects.apply_cascade applies or keeps it. The values are made up.
import type { CapMap } from "../../../../../../generated/types.ts";
import type { ProjectPageData } from "./data.tsx";
import type { Overview, PlanOut } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const DAY = 86_400_000;
const at = (d: number): number => Date.UTC(2025, 9, 24 + d);
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_omar: "Omar Haddad", agt_intake: "Intake", agt_docs: "Docs", agt_billing: "Billing" };

type Row = PlanOut["tasks"][number];
const task = (taskId: string, title: string, stage: string, start: number, due: number, o: Partial<Row> = {}): Row => ({ taskId, title, stage, start: at(start), due: at(due), milestone: false, status: "todo", ...o });

const STAGES: PlanOut["stages"] = [{ key: "intake", title: "Intake", order: 1 }, { key: "draft", title: "Draft", order: 2 }, { key: "review", title: "Review", order: 3 }, { key: "deliver", title: "Deliver", order: 4 }];

export interface SampleProject {
  data: ProjectPageData;
  calls: { cap: string; input: unknown }[];
  opened: string[];
  rows: Row[];
  links: PlanOut["links"];
  failNext(cap: string, message?: string): void;
}

export function createSampleProject(): SampleProject {
  let rows: Row[] = [
    task("t1", "Collect the intake form", "intake", -9, -6, { status: "done", assigned: "agt_intake" }),
    task("t2", "Run the conflict check", "intake", -6, -3, { status: "done", assigned: "usr_omar" }),
    task("t3", "Draft the engagement letter", "draft", -3, 1, { status: "doing", assigned: "agt_docs", reviewer: "usr_maya", ring: "review" }),
    task("t4", "Send the letter for signature", "draft", 2, 3, { assigned: "usr_maya" }),
    task("t5", "Consult on Tuesday", "review", 3, 3, { milestone: true, assigned: "usr_maya" }),
    task("t6", "Review the signed letter", "review", 4, 6, { assigned: "usr_omar", reviewer: "usr_maya" }),
    task("t7", "Set up billing", "deliver", 7, 9, { assigned: "agt_billing" }),
    task("t8", "Kickoff", "deliver", 10, 10, { milestone: true, assigned: "usr_maya" }),
  ];
  const links: PlanOut["links"] = [{ from: "t1", to: "t2" }, { from: "t2", to: "t3" }, { from: "t3", to: "t4" }, { from: "t4", to: "t5" }, { from: "t5", to: "t6" }, { from: "t6", to: "t7" }, { from: "t7", to: "t8" }];
  const calls: SampleProject["calls"] = [];
  const opened: string[] = [];
  const failing = new Map<string, string>();
  let proposal: { id: string; moves: { taskId: string; toStart?: number; toDue?: number }[] } | null = null;
  const project = (): Overview["project"] => ({
    projectId: "pj_0", recordId: "pj_0", type: "projects", title: "Rivera engagement", status: "Active", lead: "usr_maya", start: at(-9), due: at(10), channelId: "chn_rivera", folderId: "fld_rivera", memberCount: 4,
    openTasks: rows.filter((r) => r.status !== "done").length, lateTasks: rows.filter((r) => r.status !== "done" && (r.due ?? Infinity) < SAMPLE_NOW).length,
  });
  const data: ProjectPageData = {
    async call(cap, input) {
      calls.push({ cap, input });
      const why = failing.get(cap);
      if (why !== undefined) { failing.delete(cap); throw new Error(why); }
      const i = input as Record<string, unknown>;
      switch (cap) {
        case "projects.overview": return {
          project: project(), goal: "Sign the engagement letter, bill the retainer and hold the kickoff by November 3.",
          statusUpdate: { text: "The letter is drafted and waiting on Maya. The ID and date of birth are still outstanding.", at: SAMPLE_NOW - 5 * 3_600_000, by: "agt_intake", drafted: true },
          milestones: rows.filter((r) => r.milestone && r.status !== "done"), late: rows.filter((r) => r.status !== "done" && (r.due ?? Infinity) < SAMPLE_NOW), waiting: rows.filter((r) => r.ring !== undefined),
          decisions: [{ decisionId: "d1", summary: "Quote $250 for the first consult", at: SAMPLE_NOW - 3 * DAY }],
          people: [{ principal: "usr_maya", role: "lead", kind: "person", since: at(-9) }, { principal: "usr_omar", role: "member", kind: "person", since: at(-9) }, { principal: "agt_docs", role: "member", kind: "agent", since: at(-8) }, { principal: "agt_intake", role: "reviewer", kind: "agent", since: at(-8) }],
          linked: [{ type: "clients", recordId: "cl_0", title: "Elena Rivera" }], pinnedFiles: ["f_note", "f_offer"],
          recentThreads: [{ threadId: "thr_letter", title: "Engagement letter wording", at: SAMPLE_NOW - 2 * 3_600_000 }, { threadId: "thr_billing", title: "Retainer amount", at: SAMPLE_NOW - DAY }],
        } satisfies Overview;
        case "projects.plan": return { stages: STAGES, tasks: rows, links, today: SAMPLE_NOW } satisfies PlanOut;
        case "projects.reschedule": {
          const t = rows.find((r) => r.taskId === i["taskId"]);
          if (!t) throw new Error("No such task");
          rows = rows.map((r) => (r.taskId === t.taskId ? { ...r, ...(i["start"] !== undefined ? { start: i["start"] as number } : {}), ...(i["due"] !== undefined ? { due: i["due"] as number } : {}), ...(i["stage"] !== undefined ? { stage: i["stage"] as string } : {}) } : r));
          return { ok: true };
        }
        case "tasks.transition": rows = rows.map((r) => (r.taskId === i["taskId"] ? { ...r, status: i["to"] as Row["status"] } : r)); return { ok: true };
        case "projects.cascade": {
          const t = rows.find((r) => r.taskId === i["taskId"])!;
          const slip = ((i["due"] as number | undefined) ?? t.due ?? 0) - (t.due ?? 0);
          const later = rows.filter((r) => r.milestone === false && (r.start ?? 0) > (t.due ?? 0) && r.taskId !== t.taskId);
          proposal = { id: `prop${calls.length}`, moves: later.map((r) => ({ taskId: r.taskId, toStart: (r.start ?? 0) + slip, toDue: (r.due ?? 0) + slip })) };
          return { proposalId: proposal.id, moves: proposal.moves.map((m) => ({ ...m })), holds: [{ taskId: "t5", reason: "The Tuesday consult is pinned" }], summary: `${proposal.moves.length} later tasks move, the Tuesday consult still holds` } satisfies CapMap["projects.cascade"]["out"];
        }
        case "projects.apply_cascade": {
          if (!proposal || proposal.id !== i["proposalId"]) throw new Error("That proposal is gone");
          if (i["decision"] === "apply") for (const m of proposal.moves) rows = rows.map((r) => (r.taskId === m.taskId ? { ...r, start: m.toStart, due: m.toDue } : r));
          const moved = i["decision"] === "apply" ? proposal.moves.length : 0;
          proposal = null;
          return { moved };
        }
        case "projects.open_task_thread": return { threadId: `thr_${String(i["taskId"])}` };
        default: throw new Error(`no handler for ${cap}`);
      }
    },
    nameOf: (id) => NAMES[id] ?? id,
    now: () => SAMPLE_NOW,
    fileName: (id) => ({ f_note: "Consult fee.md", f_offer: "Offer.png" } as Record<string, string>)[id] ?? id,
    nav: {
      openChannel: (id) => void opened.push(`channel:${id}`), openThread: (id) => void opened.push(`thread:${id}`), openFolder: (id) => void opened.push(`folder:${id}`),
      openFile: (id) => void opened.push(`file:${id}`), openRecord: (t, id) => void opened.push(`record:${t}:${id}`), openRecordPage: (t, id) => void opened.push(`page:${t}:${id}`),
    },
  };
  return { data, calls, opened, get rows() { return rows; }, links, failNext: (cap, message = `${cap} failed`) => void failing.set(cap, message) };
}
