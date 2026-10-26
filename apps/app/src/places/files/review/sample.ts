// The sample Spaces behind the review tests and screenshots: Northwind (Docs changed 3 files in the Rivera matter, a git folder with a protected main, AGENT.md and agent.toml with their history) and
// Harbor Studio (Proofer changed 2 files in a client gallery). A fake replica answers every read the review surfaces make; the writes (approve, request changes, discard, save, restore, name, git) change the
// state and tick the replica, so what a test changes is what the next live read shows. The real replica is SQLite behind the same surface.
import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica, LiveQuery } from "../../../../../../client/src/index.ts";
import type { CapMap } from "../../../../../../generated/types.ts";
import { namesFor } from "../../../fixtures/index.ts";
import type { ReviewCap, ReviewData, ReviewNav } from "./data.tsx";
import { LINE_LIMITS, applySuggestion, tomlKind } from "./model.ts";
import type { Changeset, ChangesetFile, DiffOut, LintOut } from "./model.ts";

export const SAMPLE_NOW = Date.UTC(2025, 9, 24, 10, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;

export type Variant = "northwind" | "harbor";

export const AGENT_MD = [
  "# Intake", "",
  "Inherits VYRE.md.", "",
  "## Role", "",
  "Books consults and gathers the details a lawyer needs before the first call.", "",
  "## Voice", "",
  "- Warm and brief. Two sentences, then a question.",
  "- No exclamation marks.",
  "- Say what happens next, always.", "",
  "## Never", "",
  "- Take payment details. Ever.",
  "- Promise an outcome.", "",
  "Override: may text a client between 8am and 9pm when they asked to be texted.", "",
].join("\n");

export const AGENT_TOML = [
  "# agent.toml for Intake", "",
  "[model]",
  'primary   = "claude-sonnet-5-5"',
  'fallback  = ["claude-haiku-4-5"]',
  "temperature = 0.2", "",
  "[limits]",
  "max_steps = 40",
  "daily_budget = 12",
  "ask_before_send = true", "",
  "[handoff]",
  'to = "Docs"', "",
].join("\n");

export const SUGGESTION_DIFF = [
  "@@ -11,3 +11,3 @@", " - Warm and brief. Two sentences, then a question.", "-- No exclamation marks.", "+- No exclamation marks. Keep replies under five lines.", " - Say what happens next, always.",
  "@@ -16,2 +16,3 @@", " - Take payment details. Ever.", " - Promise an outcome.", "+- Quote a fee before the consult.",
].join("\n");

const SVG = (fill: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="${fill}"/><rect x="40" y="40" width="240" height="24" fill="#fff" opacity=".7"/><rect x="40" y="80" width="180" height="16" fill="#fff" opacity=".5"/></svg>`)}`;

const L = (op: "ctx" | "add" | "del", text: string): { op: "ctx" | "add" | "del"; text: string } => ({ op, text });
const hunk = (hunkId: string, newStart: number, lines: { op: "ctx" | "add" | "del"; text: string }[]): DiffOut["hunks"][number] => ({
  hunkId, oldStart: newStart, oldLines: lines.filter((l) => l.op !== "add").length, newStart, newLines: lines.filter((l) => l.op !== "del").length, lines,
});

interface Seed { by: string; folderId: string; files: ChangesetFile[]; diffs: Record<string, DiffOut>; comments: CapMap["changesets.comments.list"]["out"]["comments"]; added: number; removed: number }

const NORTHWIND: Seed = {
  by: "agt_docs", folderId: "fld_rivera", added: 42, removed: 9,
  files: [
    { path: "rivera-engagement-letter.docx", status: "modified", added: 18, removed: 4, conflict: false },
    { path: "consult-prep.md", status: "modified", added: 24, removed: 5, conflict: false },
    { path: "id-scan.png", status: "added", added: 0, removed: 0, conflict: false },
  ],
  diffs: {
    "rivera-engagement-letter.docx": {
      kind: "paragraph", added: 18, removed: 4, identical: false,
      hunks: [
        hunk("h_fee", 6, [L("ctx", "Scope of work. The firm will represent Elena Rivera in the matter described above."), L("del", "Retainer: $1,500, due on signing."), L("add", "Retainer: $2,400, due on signing, with the balance billed monthly."), L("ctx", "The retainer is held in trust until earned.")]),
        hunk("h_term", 14, [L("del", "Either party may end this agreement with 14 days notice."), L("add", "Either party may end this agreement with 30 days written notice.")]),
      ],
    },
    "consult-prep.md": {
      kind: "text", added: 24, removed: 5, identical: false,
      hunks: [
        hunk("h_prep", 3, [L("ctx", "## Before the consult"), L("add", "- Ask for a photo ID before the consult."), L("add", "- Confirm the best phone number and the time zone."), L("ctx", "- Send the intake form two days ahead.")]),
        hunk("h_len", 12, [L("del", "Consults run 30 minutes."), L("add", "Consults run 45 minutes.")]),
      ],
    },
    "id-scan.png": { kind: "image", added: 0, removed: 0, identical: false, hunks: [], images: { left: SVG("#8aa4c8"), right: SVG("#5b7fb0") } },
  },
  comments: [{ commentId: "cmt_1", changesetId: "cs_rivera", anchor: { kind: "range", path: "consult-prep.md", quote: "Ask for a photo ID" }, text: "Please put this above the intake form line.", by: "usr_maya", at: SAMPLE_NOW - 12 * MIN, resolved: false, mentions: ["agt_docs"] }],
};

const HARBOR: Seed = {
  by: "agt_proofer", folderId: "fld_h_gallery", added: 11, removed: 3,
  files: [
    { path: "gallery-notes.md", status: "modified", added: 7, removed: 2, conflict: false },
    { path: "pricing.md", status: "modified", added: 4, removed: 1, conflict: false },
  ],
  diffs: {
    "gallery-notes.md": { kind: "text", added: 7, removed: 2, identical: false, hunks: [hunk("h_g1", 2, [L("ctx", "## Picks"), L("del", "Clients choose 20 images."), L("add", "Clients choose 25 images."), L("add", "Extra images are $15 each.")])] },
    "pricing.md": { kind: "text", added: 4, removed: 1, identical: false, hunks: [hunk("h_g2", 5, [L("del", "Mini session: $220"), L("add", "Mini session: $240")])] },
  },
  comments: [],
};

export interface SampleOptions {
  variant?: Variant;
  /** The changeset's folder is a git repository. */
  repo?: boolean;
  /** The branch is protected (main): pushes go through the Gate. */
  protectedBranch?: boolean;
  /** Start the changeset in this state. */
  state?: Changeset["state"];
  /** An agent.toml with a secret in it: the lint is red. */
  secret?: boolean;
}

interface Version { versionId: string; n: number; by: string; at: number; reason?: string; name?: string; text: string }

export interface SampleReview {
  data: ReviewData;
  replica: FakeReplica;
  calls: { cap: string; input: unknown }[];
  nav: { cap: string; args: unknown[] }[];
  changesetId: string;
  folderId: string;
  /** The files with history. */
  fileIds: { agent: string; toml: string };
  /** The current text of a file. */
  text(fileId: string): string;
  version(fileId: string): number;
  changeset(): Changeset;
  suggestionState(): string;
  /** Make the next call of a capability fail with this code. */
  failNext(cap: string, code: string): void;
}

const lintOf = (fileId: string, text: string): LintOut => {
  const file: LintOut["file"] = fileId.endsWith("toml") ? "agent_toml" : "agent_md";
  const lines = text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  const overrides: LintOut["overrides"] = [];
  const secrets: LintOut["secrets"] = [];
  const problems: LintOut["problems"] = [];
  text.split("\n").forEach((l, i) => {
    if (/^\s*(?:[-*]\s*)?Override:/i.test(l)) overrides.push({ line: i + 1, text: l.trim().slice(0, 90) });
    if (/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{8,}/.test(l)) secrets.push({ line: i + 1, kind: "API key" });
    if (file === "agent_toml" && l.trim() && !l.trim().startsWith("#") && !l.trim().startsWith("[") && !l.includes("=") && !/^\s*["\]]/.test(l)) problems.push({ severity: "error", line: i + 1, rule: "toml.syntax", message: "This line is not a key and a value." });
    const m = /^(\w+)\s*=\s*(.*)$/.exec(l.trim());
    if (file === "agent_toml" && m && m[1] === "temperature" && tomlKind(m[2] ?? "") !== "number") problems.push({ severity: "error", line: i + 1, rule: "toml.type", message: "temperature must be a number." });
  });
  if (file === "agent_toml" && !/^primary\s*=/m.test(text.replace(/^\s+/gm, ""))) problems.push({ severity: "error", rule: "toml.model", message: "model.primary is missing." });
  const limit = LINE_LIMITS[file];
  const errors = secrets.length > 0 || problems.some((p) => p.severity === "error") || lines > 200;
  const state: LintOut["state"] = errors ? "red" : limit !== null && lines > limit ? "amber" : "ok";
  return { file, lines, state, ...(file === "agent_md" ? { inherits: /Inherits VYRE\.md/i.test(text) } : {}), overrides, secrets, problems };
};

export function createSampleReview(o: SampleOptions = {}): SampleReview {
  const variant = o.variant ?? "northwind";
  const seed = variant === "harbor" ? HARBOR : NORTHWIND;
  const names: Record<string, string> = {
    ...namesFor(variant),
    fld_rivera: "Projects/Rivera matter", fld_h_gallery: "Clients/Gallery",
  };
  const nameOf = (id: string): string => names[id] ?? (id.startsWith("usr_") ? "Someone" : id.startsWith("agt_") ? "An agent" : "Unknown");
  const replica = createFakeReplica(variant === "harbor" ? "spc_harbor" : "spc_northwind");
  const calls: { cap: string; input: unknown }[] = [];
  const navLog: { cap: string; args: unknown[] }[] = [];
  const failing = new Map<string, string>();
  let tick = 0;
  let keys = 0;
  const touch = (): void => replica.put("meta", [{ id: "tick", n: ++tick }]);

  const changesetId = variant === "harbor" ? "cs_gallery" : "cs_rivera";
  const cs: Changeset = {
    changesetId, folderId: seed.folderId, state: o.state ?? "open", by: seed.by, baseVersion: "2", fileCount: seed.files.length, added: seed.added, removed: seed.removed, openedAt: SAMPLE_NOW - 20 * MIN, pushPending: false,
  };
  const comments = [...seed.comments];
  const git = { isRepo: o.repo === true || o.protectedBranch === true, branch: o.protectedBranch ? "main" : "docs-update", prot: o.protectedBranch === true, ahead: 0, behind: 0, changes: 0 };
  const branches = [
    { name: "main", remote: false, sha: "a1f3c2e", protected: true },
    { name: "docs-update", remote: false, sha: "b2e4d3f", protected: false },
    { name: "intake-copy", remote: false, sha: "c3f5e40", protected: false },
  ];

  const suggestion: CapMap["agents.suggestions.list"]["out"]["suggestions"][number] = {
    suggestionId: "sug_1", agentId: "agt_intake", kind: "agent_md", file: "AGENT.md", diff: SUGGESTION_DIFF, reason: "Replies ran long in four of the last ten consults.", widening: false, state: "open", proposedBy: "agt_intake", proposedAt: SAMPLE_NOW - 3_600_000,
  };
  const ids = { agent: "file_agent_md", toml: "file_agent_toml" };
  const t0 = SAMPLE_NOW;
  const versions = new Map<string, Version[]>([
    [ids.agent, [
      { versionId: "ver_a1", n: 1, by: "agt_intake", at: t0 - 6 * DAY, reason: "First draft", text: AGENT_MD.replace("- No exclamation marks.\n", "") },
      { versionId: "ver_a2", n: 2, by: "usr_maya", at: t0 - 4 * DAY, reason: "Add the voice rules", text: AGENT_MD.replace("- Say what happens next, always.\n", "") },
      { versionId: "ver_a3", n: 3, by: "usr_irfad", at: t0 - 2 * DAY, reason: "Say what happens next", name: "Before the Lab", text: AGENT_MD.replace("- Promise an outcome.\n", "") },
      { versionId: "ver_a4", n: 4, by: "usr_irfad", at: t0 - 3 * 3_600_000, reason: "Allow texts in the daytime", text: AGENT_MD },
    ]],
    [ids.toml, [
      { versionId: "ver_t1", n: 1, by: "usr_irfad", at: t0 - 5 * DAY, reason: "Models and limits", text: AGENT_TOML.replace("daily_budget = 12", "daily_budget = 8") },
      { versionId: "ver_t2", n: 2, by: "usr_irfad", at: t0 - 1 * DAY, reason: "Raise the daily budget", text: o.secret ? AGENT_TOML.replace("ask_before_send = true", 'ask_before_send = true\nkey = "sk-live1234567890"') : AGENT_TOML },
    ]],
  ]);
  const current = (fileId: string): Version => {
    const vs = versions.get(fileId) ?? [];
    return vs[vs.length - 1] as Version;
  };
  const fileObj = (fileId: string): CapMap["files.restore_version"]["out"]["file"] => ({
    fileId, folderId: "fld_agents", name: fileId === ids.toml ? "agent.toml" : "AGENT.md", kind: "text", mime: "text/plain", size: current(fileId).text.length, version: current(fileId).n, label: 1,
    ownerId: "usr_irfad", createdAt: t0 - 6 * DAY, updatedAt: current(fileId).at, updatedBy: current(fileId).by, thumb: false, holds: 0,
  });

  const statusOut = (): CapMap["git.status"]["out"] => git.isRepo
    ? { isRepo: true, branch: git.branch, upstream: `origin/${git.branch}`, head: "b2e4d3f", ahead: git.ahead, behind: git.behind, clean: git.changes === 0, changes: Array.from({ length: git.changes }, (_, i) => ({ path: `file-${i + 1}.md`, status: "modified" as const, added: 1, removed: 0, staged: false })), remotes: [{ name: "origin", url: "git@github.com:northwind/matters.git" }], protected: git.prot }
    : { isRepo: false, ahead: 0, behind: 0, clean: true, changes: [], remotes: [], protected: false };

  replica.resolve("changesets.get", () => ({ changeset: { ...cs }, files: seed.files }));
  replica.resolve("changesets.diff", (_t, i) => seed.diffs[i.path] ?? { kind: "text" as const, added: 0, removed: 0, hunks: [], identical: true });
  replica.resolve("changesets.comments.list", () => ({ comments: [...comments] }));
  replica.resolve("git.status", () => statusOut());
  replica.resolve("git.list_branches", () => ({ current: git.branch, branches: branches.map((b) => ({ ...b, protected: b.name === "main" ? true : b.protected })) }));
  replica.resolve("agents.suggestions.list", (_t, i) => ({ suggestions: [suggestion].filter((x) => (!i.agentId || x.agentId === i.agentId) && (!i.state || i.state.includes(x.state))) }));
  replica.resolve("git.log", () => ({ commits: [] }));
  replica.resolve("git.show", (_t, i) => ({
    commit: { sha: i.sha, message: "Raise the retainer to $2,400", author: { name: "Docs", kind: "agent" as const, id: "agt_docs" }, at: t0 - 2 * 3_600_000, files: 1, parents: ["a1f3c2e"] },
    files: [{ path: "rivera-engagement-letter.docx", status: "modified" as const, added: 1, removed: 1, staged: false }],
    hunks: (seed.diffs["rivera-engagement-letter.docx"]?.hunks ?? []).slice(0, 1).map((h) => ({ hunkId: h.hunkId, oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines: h.lines.map((l) => ({ op: l.op, text: l.text })) })),
  }));
  replica.resolve("files.versions", (_t, i) => ({ versions: [...(versions.get(i.fileId) ?? [])].sort((a, b) => b.n - a.n).map(({ versionId, n, by, at, reason, name }) => ({ versionId, n, by, at, ...(reason ? { reason } : {}), ...(name ? { name } : {}) })) }));
  replica.resolve("files.diff", (_t, i) => {
    const vs = versions.get(i.fileId) ?? [];
    const to = vs.find((v) => v.versionId === i.to) ?? vs[vs.length - 1];
    const from = vs.find((v) => v.versionId === i.from) ?? vs[vs.length - 2];
    if (!to || !from || to.text === from.text) return { kind: "text" as const, added: 0, removed: 0, hunks: [], identical: true };
    const a = from.text.split("\n");
    const b = to.text.split("\n");
    const lines = [...a.filter((l) => !b.includes(l)).map((t) => L("del", t)), ...b.filter((l) => !a.includes(l)).map((t) => L("add", t))];
    return { kind: "text" as const, added: lines.filter((l) => l.op === "add").length, removed: lines.filter((l) => l.op === "del").length, hunks: [hunk("h_v", 1, lines)], identical: false };
  });
  replica.resolve("files.lint", (_t, i) => lintOf(i.fileId, i.text ?? current(i.fileId).text));
  touch();

  const err = (code: string): Error => Object.assign(new Error(code), { code });
  const writes: Record<string, (i: never) => unknown> = {
    "changesets.approve": () => {
      if (cs.state !== "open" && cs.state !== "changes_requested") throw err("validation.precondition_failed");
      cs.state = "approved";
      touch();
      return { approved: true, versionIds: seed.files.map((_, n) => `ver_cs${n + 1}`), conflicts: [], ...(git.isRepo ? { commit: "d4a91c7e0b2" } : {}) };
    },
    "changesets.request_changes": () => { cs.state = "changes_requested"; touch(); return { sent: comments.length }; },
    "changesets.discard": () => { cs.state = "discarded"; touch(); return { discarded: true }; },
    "changesets.review_externally": (i: CapMap["changesets.review_externally"]["in"]) => ({ actorId: i.actorId ?? "agt_assistant", reviewUrl: "https://review.example/cs_rivera", expiresAt: SAMPLE_NOW + DAY }),
    "files.restore_version": (i: CapMap["files.restore_version"]["in"]) => {
      const vs = versions.get(i.fileId) ?? [];
      const old = vs.find((v) => v.versionId === i.versionId);
      if (!old) throw err("validation.not_found");
      const next: Version = { versionId: `ver_${i.fileId}_${vs.length + 1}`, n: vs.length + 1, by: "usr_irfad", at: SAMPLE_NOW, reason: `Restored version ${old.n}`, text: old.text };
      vs.push(next);
      touch();
      return { file: fileObj(i.fileId), versionId: next.versionId };
    },
    "files.name_version": (i: CapMap["files.name_version"]["in"]) => {
      const v = (versions.get(i.fileId) ?? []).find((x) => x.versionId === i.versionId);
      if (!v) throw err("validation.not_found");
      if (i.name) v.name = i.name; else delete v.name;
      touch();
      return { ok: true };
    },
    "files.save": (i: CapMap["files.save"]["in"]) => {
      const vs = versions.get(i.fileId) ?? [];
      const top = vs[vs.length - 1] as Version;
      if (i.baseVersion !== undefined && i.baseVersion !== top.n) throw err("validation.conflict");
      const lint = lintOf(i.fileId, i.text);
      if (lint.state === "red") throw err("validation.precondition_failed");
      if (lint.state === "amber" && i.acceptWarnings !== true) throw err("validation.precondition_failed");
      const next: Version = { versionId: `ver_${i.fileId}_${vs.length + 1}`, n: top.n + 1, by: "usr_irfad", at: SAMPLE_NOW, ...(i.reason ? { reason: i.reason } : {}), text: i.text };
      vs.push(next);
      touch();
      return { versionId: next.versionId, n: next.n, lint, added: Math.max(0, i.text.split("\n").length - top.text.split("\n").length), removed: 0 };
    },
    "agents.suggestion.accept": () => {
      suggestion.state = "accepted";
      const vs = versions.get(ids.agent) ?? [];
      const top = vs[vs.length - 1] as Version;
      vs.push({ versionId: `ver_${ids.agent}_${vs.length + 1}`, n: top.n + 1, by: "agt_intake", at: SAMPLE_NOW, reason: "Applied Intake's suggestion", text: applySuggestion(top.text, suggestion.diff) });
      touch(); return { suggestion: { ...suggestion } }; },
    "agents.suggestion.dismiss": () => { suggestion.state = "dismissed"; touch(); return { suggestion: { ...suggestion } }; },
    "git.branch": (i: CapMap["git.branch"]["in"]) => { git.branch = i.name; git.prot = i.name === "main"; touch(); return { branch: i.name }; },
    "git.push": () => { git.ahead = 0; touch(); return { pushed: true, sha: "b2e4d3f" }; },
    "git.pull": () => { git.behind = 0; touch(); return { updated: true, sha: "b2e4d3f", conflicts: [] }; },
    "git.sync": () => { git.ahead = 0; git.behind = 0; touch(); return { pulled: true, pushed: true, conflicts: [] }; },
    "git.init": () => { git.isRepo = true; touch(); return { branch: "main" }; },
    "git.commit": () => { git.changes = 0; touch(); return { sha: "e5b02d8" }; },
  };

  const live = <C extends ReviewCap>(cap: C, input: CapMap[C]["in"]): LiveQuery<CapMap[C]["out"]> => liveQuery(replica, cap, input);
  const nav: ReviewNav = {
    openChangeset: (id) => void navLog.push({ cap: "openChangeset", args: [id] }),
    compare: (fileId, from, to) => void navLog.push({ cap: "compare", args: [fileId, from, to] }),
    openCommit: (folderId, sha) => void navLog.push({ cap: "openCommit", args: [folderId, sha] }),
    settled: (id, state) => void navLog.push({ cap: "settled", args: [id, state] }),
    ask: (agentId, mode, about) => void navLog.push({ cap: "ask", args: [agentId, mode, about] }),
  };
  const data: ReviewData = {
    live,
    async call(cap, input) {
      calls.push({ cap, input });
      const code = failing.get(cap);
      if (code) { failing.delete(cap); throw err(code); }
      const w = writes[cap];
      if (!w) throw new Error(`no answer for ${cap}`);
      return w(input as never);
    },
    nameOf,
    key: () => `key_${++keys}`,
    clock: () => ({ now: SAMPLE_NOW }),
    reviewers: variant === "harbor" ? [{ id: "agt_assistant", name: "Assistant" }] : [{ id: "agt_research", name: "Research" }, { id: "agt_assistant", name: "Assistant" }],
    agents: variant === "harbor"
      ? [{ id: "agt_assistant", name: "Assistant", assistant: true }, { id: "agt_scheduler", name: "Scheduler" }, { id: "agt_proofer", name: "Proofer" }]
      : [{ id: "agt_assistant", name: "Assistant", assistant: true }, { id: "agt_intake", name: "Intake" }, { id: "agt_billing", name: "Billing" }, { id: "agt_research", name: "Research" }, { id: "agt_docs", name: "Docs" }, { id: "agt_scout", name: "Scout" }],
    nav,
  };
  return {
    data, replica, calls, nav: navLog, changesetId, folderId: seed.folderId, fileIds: ids,
    text: (id) => current(id).text, version: (id) => current(id).n, changeset: () => ({ ...cs }), suggestionState: () => suggestion.state,
    failNext: (cap, code) => void failing.set(cap, code),
  };
}
