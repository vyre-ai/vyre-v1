// The server behind the Linked tab's tests and screenshots: the Rivera project, answered in memory the way the Projects capabilities answer. The viewer is a member: the Fee schedule (Finance) is something they cannot
// open, so the list comes back with no name for it (the Space reads each source as the person asking), and access.request records the ask. Values are made up.
import type { ProjectPageData } from "../data.tsx";
import type { Link, Rule, Run } from "./model.ts";

export const NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const min = 60_000;
const NAMES: Record<string, string> = { usr_irfad: "Irfad Imtiaz", usr_maya: "Maya Chen", usr_lena: "Lena Ortiz", agt_assistant: "Assistant" };

const link = (linkId: string, kind: Link["kind"], ref: string, o: Partial<Link> = {}): Link => ({ linkId, projectId: "prj_rivera", kind, ref, source: "manual", addedBy: "usr_maya", addedAt: NOW - 3_600_000, ...o });

export const LINKS = (): Link[] => [
  link("lnk_1", "task", "tsk_1", { label: "Draft the engagement letter", state: "Doing" }),
  link("lnk_2", "record", "invoice/rec_1042", { label: "Invoice 1042", state: "Overdue", source: "rule", addedBy: "agt_assistant", ruleId: "rul_1" }),
  link("lnk_3", "record", "invoice/rec_1038", { label: "Invoice 1038", state: "Paid", source: "rule", addedBy: "agt_assistant", ruleId: "rul_1" }),
  link("lnk_4", "file", "fil_1", { label: "Service agreement", state: "Edited 2025-10-24", addedBy: "usr_irfad" }),
  link("lnk_5", "file", "fil_fee", { addedBy: "usr_lena" }),
  link("lnk_6", "chat", "thr_intake", { label: "#intake", state: "Open" }),
  link("lnk_7", "github.pr", "northwind/website#214", { label: "Fix upload retries", state: "Open", url: "https://github.com/northwind/website/pull/214", source: "rule", addedBy: "agt_assistant", ruleId: "rul_2" }),
  link("lnk_8", "github.pr", "northwind/website#209", { label: "Rename the settings page", state: "Merged", url: "https://github.com/northwind/website/pull/209", source: "rule", addedBy: "agt_assistant", ruleId: "rul_2" }),
  link("lnk_9", "artifact", "sit_pricing", { label: "Pricing comparison", state: "Edited 2025-10-24", addedBy: "usr_irfad" }),
];
export const RULES = (): Rule[] => [
  { ruleId: "rul_1", kind: "record_filter", recordType: "invoice", field: "client", equals: "Rivera", by: "usr_maya", at: NOW },
  { ruleId: "rul_2", kind: "repo", repo: "northwind/website", by: "usr_maya", at: NOW },
];
const run = (runId: string, o: Partial<Run> = {}): Run => ({ runId, jobId: 11, workflowRunId: 99, repo: "northwind/website", jobName: "Checks · tests", projectId: "prj_rivera", state: "finished", dropletId: null, size: null, queuedAt: NOW - 14 * min, startedAt: NOW - 13 * min, endedAt: NOW - 9 * min, conclusion: "failure", costUsd: 0.01, note: "3 tests failed: /pricing-old, /about-us and /contact-old return 404, expected 301", ...o });
export const RUNS = (): Run[] => [
  run("cir_1"),
  run("cir_2", { jobName: "Checks · lint", conclusion: "success", note: null, endedAt: NOW - 12 * min }),
  run("cir_3", { jobName: "Build · preview site", state: "running", conclusion: null, endedAt: null, startedAt: NOW - 2 * min, note: null }),
];

export interface Sample {
  data: ProjectPageData;
  calls: { cap: string; input: Record<string, unknown> }[];
  opened: string[];
  fail(cap: string, message?: string): void;
  state: { links: Link[]; rules: Rule[]; asked: string[] };
}

export function createSampleLinked(o: { ci?: boolean; empty?: boolean; me?: string; accept?: "personal" | "org"; admin?: boolean; ruleOnly?: boolean } = {}): Sample {
  // ruleOnly: the project's only link to its repository is a repo rule (no Files remote, no linked pull request): CI still shows
  const state = { links: o.empty ? [] : o.ruleOnly ? LINKS().filter((l) => !l.kind.startsWith("github")) : LINKS(), rules: o.empty ? [] : o.ruleOnly ? RULES().filter((r) => r.kind === "repo") : RULES(), asked: [] as string[] };
  const calls: Sample["calls"] = [];
  const opened: string[] = [];
  const failing = new Map<string, string>();
  const withCi = o.ci !== false;
  let n = 100;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    const why = failing.get(cap);
    if (why !== undefined) { failing.delete(cap); throw Object.assign(new Error(why), { code: "internal.failed" }); }
    switch (cap) {
      case "projects.links.list": return { links: state.links.map((l) => ({ ...l })), rules: state.rules.map((r) => ({ ...r })) };
      case "projects.links.link": {
        const l = link(`lnk_${++n}`, i["kind"] as Link["kind"], String(i["ref"]), { addedBy: o.me ?? "usr_irfad", ...(i["label"] ? { label: String(i["label"]) } : {}), ...(i["state"] ? { state: String(i["state"]) } : {}), ...(i["url"] ? { url: String(i["url"]) } : {}) });
        state.links.push(l);
        return { link: l };
      }
      case "projects.links.unlink": { const k = state.links.length; state.links = state.links.filter((l) => !(l.kind === i["kind"] && l.ref === i["ref"])); return { removed: state.links.length < k }; }
      case "projects.links.rules.set": {
        const next = (i["rules"] as Record<string, unknown>[]).map((r) => ({ ruleId: String(r["ruleId"] ?? `rul_${++n}`), kind: r["kind"] as Rule["kind"], ...(r["repo"] ? { repo: String(r["repo"]) } : {}), ...(r["recordType"] ? { recordType: String(r["recordType"]) } : {}), ...(r["field"] ? { field: String(r["field"]) } : {}), ...(r["equals"] ? { equals: String(r["equals"]) } : {}), ...(r["domain"] ? { domain: String(r["domain"]) } : {}), by: "usr_irfad", at: NOW }));
        state.rules = next;
        return { rules: next };
      }
      case "ci.project.get": return { linked: withCi, repo: withCi ? "northwind/website" : null, enabled: withCi, labels: ["vyre"], live: 1, queued: 0, appNeedsAccept: o.accept !== undefined, acceptUrl: o.accept === "personal" ? "https://github.com/settings/installations/1" : null, orgAcceptUrl: o.accept === "org" ? "https://github.com/organizations/northwind/settings/installations/1" : null };
      case "ci.runs.list": return { runs: withCi ? RUNS() : [] };
      case "search.recent.list": case "search.query": {
        const q = String(i["q"] ?? "").toLowerCase();
        const pool = [{ kind: "file", id: "fil_terms", title: "Service terms.pdf" }, { kind: "record", id: "rec_sam", title: "Sam Ortega", recordType: "contact" }, { kind: "chat", id: "thr_billing", title: "#billing" }, { kind: "person", id: "usr_maya", title: "Maya Chen" }, { kind: "task", id: "tsk_2", title: "Collect documents" }];
        return { hits: pool.filter((h) => q === "" || h.title.toLowerCase().includes(q)).map((h) => ({ ...h, link: "", score: 1 })) };
      }
      case "access.request": if ((i["resource"] as { type?: string })?.type === "space") { state.asked.push("space"); return { request: { requestId: "arq_2" } }; } state.asked.push(JSON.stringify((i["resource"]))); return { request: { requestId: "arq_1" } };
      default: throw new Error(`unscripted ${cap}`);
    }
  };
  const data: ProjectPageData = {
    admin: o.admin === true, spaceId: "spc_nw", call, nameOf: (id) => NAMES[id] ?? id, me: { id: o.me ?? "usr_irfad", name: "Irfad Imtiaz" }, now: () => NOW,
    nav: {
      openChannel: (id) => void opened.push(`channel:${id}`), openThread: (id) => void opened.push(`thread:${id}`), openFolder: (id) => void opened.push(`folder:${id}`), openFile: (id) => void opened.push(`file:${id}`),
      openRecord: (t, id) => void opened.push(`record:${t}/${id}`), openRecordPage: (t, id) => void opened.push(`recordpage:${t}/${id}`),
    },
  };
  return { data, calls, opened, fail: (cap, message = "That did not work.") => void failing.set(cap, message), state };
}
