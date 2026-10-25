// Pull requests and issues on GitHub (spec 2.10 synced types, 2.16; ARCH 8.5): the live reads and writes behind the pull request page, issues, the work handed to agents
// (the fix loop stops at three rounds) and the connector replay of GitHub's own deliveries. GitHub is a scripted stand-in answering recorded bodies.
import test from "node:test";
import assert from "node:assert/strict";
import {
  checksState, issueAssignAgent, issueClose, issueComment, issueCreate, issueGet, issueUpdate, parseDelivery, prAskAuthorFix, prChecks, prClose, prComment, prCreate, prDiff, prGet,
  prListFiles, prMerge, prRequestReview, prRerunChecks, prUpdate, receiveWebhook,
} from "../handlers/index.ts";
import { codeOf, contractErrors, harness, INSTALL, NOW, payloadErrors, RECORDED, SHA } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const REPO = "vyre-ai/website";
const P = `/repos/${REPO}`;

function world(): Harness {
  const h = harness();
  h.reach();
  return h;
}

// ---- reading a pull request

test("a pull request is read live with its labels, assignees, counts and the state of its checks", async () => {
  const h = world();
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsPassing });
  const out = await prGet(h.ctx, { repo: REPO, number: 7 });
  assert.deepEqual(contractErrors("github.pull_request.get", "out", out), []);
  assert.deepEqual(out.pullRequest, {
    repo: REPO, number: 7, title: "Fix the intake form", state: "open", draft: false, author: "agent-scout", branch: "fix/intake", base: "main", url: "https://github.com/vyre-ai/website/pull/7",
    checks: "passing", labels: ["bug", "needs-review"], assignees: ["omar"], body: "Fixes the spacing.", additions: 12, deletions: 3, changedFiles: 2,
  });
  assert.equal(h.requests.at(-1)!.headers.authorization, "Bearer ghs_token_1");
});

test("checks are none without runs, failing when any run failed, pending while any is not finished, else passing", async () => {
  const states: [unknown, string][] = [[RECORDED.runsNone, "none"], [RECORDED.runsPending, "pending"], [RECORDED.runsPassing, "passing"], [RECORDED.runsFailing, "failing"]];
  for (const [runs, want] of states) {
    const h = world();
    h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
    h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: runs });
    assert.equal((await prGet(h.ctx, { repo: REPO, number: 7 })).pullRequest.checks, want);
    const checks = await prChecks(h.ctx, { repo: REPO, number: 7 });
    assert.deepEqual(contractErrors("github.pull_request.checks", "out", checks), []);
    assert.equal(checks.state, want);
  }
  assert.equal(checksState([{ status: "completed", conclusion: "timed_out" }, { status: "queued" }]), "failing", "a failure beats a run still waiting");
  assert.equal(checksState([{ status: "completed", conclusion: "skipped" }]), "passing");
});

test("a merged pull request says merged and when; a closed one says closed", async () => {
  const h = world();
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsNone });
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.prMerged });
  const merged = (await prGet(h.ctx, { repo: REPO, number: 7 })).pullRequest;
  assert.deepEqual([merged.state, merged.mergedAt], ["merged", Date.parse("2025-10-09T08:00:00Z")]);
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.prClosed });
  const closed = (await prGet(h.ctx, { repo: REPO, number: 7 })).pullRequest;
  assert.deepEqual([closed.state, closed.mergedAt], ["closed", undefined]);
  await refused(prGet(h.ctx, { repo: REPO, number: 0 }), "validation.bad_input");
  await refused(prGet(h.ctx, { repo: REPO, number: 1.5 }), "validation.bad_input");
  h.on(`GET ${P}/pulls/8`, { status: 404, body: { message: "Not Found" } });
  await refused(prGet(h.ctx, { repo: REPO, number: 8 }), "validation.not_found");
});

test("the changed files come a page at a time, the diff as text, and a binary file has no patch", async () => {
  const h = world();
  h.on(`GET ${P}/pulls/7/files`, { status: 200, body: RECORDED.files });
  const files = await prListFiles(h.ctx, { repo: REPO, number: 7, limit: 2 });
  assert.deepEqual(contractErrors("github.pull_request.list_files", "out", files), []);
  assert.deepEqual(files.files, [{ path: "src/form.ts", status: "modified", additions: 10, deletions: 3, patch: "@@ -1 +1 @@\n-a\n+b" }, { path: "logo.png", status: "added", additions: 0, deletions: 0 }]);
  assert.equal(files.next, "2");
  assert.deepEqual(h.requests.at(-1)!.query, { per_page: "2", page: "1" });
  assert.equal((await prListFiles(h.ctx, { repo: REPO, number: 7, limit: 3 })).next, undefined);
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.diff });
  const diff = await prDiff(h.ctx, { repo: REPO, number: 7 });
  assert.deepEqual(contractErrors("github.pull_request.diff", "out", diff), []);
  assert.equal(diff.diff, RECORDED.diff);
  assert.equal(h.requests.at(-1)!.headers.accept, "application/vnd.github.v3.diff");
  h.on(`GET ${P}/pulls/9`, { status: 404, body: { message: "Not Found" } });
  await refused(prDiff(h.ctx, { repo: REPO, number: 9 }), "validation.not_found");
});

test("the check runs are listed with their conclusion and link", async () => {
  const h = world();
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsFailing });
  const out = await prChecks(h.ctx, { repo: REPO, number: 7 });
  assert.deepEqual(out.runs, [{ name: "build", status: "completed", conclusion: "failure", url: "https://github.com/x/runs/1" }, { name: "lint", status: "completed", conclusion: "success" }]);
  h.on(`GET ${P}/pulls/7`, { status: 200, body: { ...RECORDED.pr, head: { ref: "x", sha: "not-a-sha" } } });
  await refused(prChecks(h.ctx, { repo: REPO, number: 7 }), "provider.bad_response");
});

// ---- writing to a pull request

test("a pull request is opened, changed, commented on, sent for review, closed and merged through GitHub", async () => {
  const h = world();
  h.on(`POST ${P}/pulls`, { status: 201, body: RECORDED.pr });
  const made = await prCreate(h.ctx, { repo: REPO, head: "fix/intake", base: "main", title: "Fix the intake form", body: "Fixes the spacing.", draft: true });
  assert.deepEqual(contractErrors("github.pull_request.create", "out", made), []);
  assert.deepEqual(h.requests.at(-1)!.body, { head: "fix/intake", base: "main", title: "Fix the intake form", body: "Fixes the spacing.", draft: true });
  assert.equal(made.pullRequest.checks, "none", "a new pull request has no runs yet");
  h.on(`POST ${P}/issues/7/comments`, { status: 201, body: RECORDED.comment });
  assert.deepEqual(await prComment(h.ctx, { repo: REPO, number: 7, body: "Looks good" }), { commentId: 98765 });
  assert.deepEqual(h.requests.at(-1)!.body, { body: "Looks good" });
  h.on(`POST ${P}/pulls/7/requested_reviewers`, { status: 201, body: {} });
  assert.deepEqual(await prRequestReview(h.ctx, { repo: REPO, number: 7, reviewers: ["omar", "dana"] }), { requested: true });
  assert.deepEqual(h.requests.at(-1)!.body, { reviewers: ["omar", "dana"] });
  h.on(`PATCH ${P}/pulls/7`, { status: 200, body: RECORDED.prClosed });
  assert.deepEqual(await prClose(h.ctx, { repo: REPO, number: 7 }), { closed: true });
  assert.deepEqual(h.requests.at(-1)!.body, { state: "closed" });
  h.on(`PUT ${P}/pulls/7/merge`, { status: 200, body: RECORDED.merged });
  const merge = await prMerge(h.ctx, { repo: REPO, number: 7, method: "squash" });
  assert.deepEqual(contractErrors("github.pull_request.merge", "out", merge), []);
  assert.deepEqual(merge, { merged: true, sha: "9999999999999999999999999999999999999999" });
  assert.deepEqual(h.requests.at(-1)!.body, { merge_method: "squash" });
});

test("a refused write is refused before GitHub is asked: blank titles, no reviewers, a bad merge method, nothing to change", async () => {
  const h = world();
  await refused(prCreate(h.ctx, { repo: REPO, head: "x", base: "main", title: " " }), "validation.bad_input");
  await refused(prCreate(h.ctx, { repo: REPO, head: "", base: "main", title: "t" }), "validation.bad_input");
  await refused(prCreate(h.ctx, { repo: REPO, head: "x", base: "main", title: "t", draft: "yes" as never }), "validation.bad_input");
  await refused(prComment(h.ctx, { repo: REPO, number: 7, body: "" }), "validation.bad_input");
  await refused(prRequestReview(h.ctx, { repo: REPO, number: 7, reviewers: [] }), "validation.bad_input");
  await refused(prMerge(h.ctx, { repo: REPO, number: 7, method: "fast-forward" as never }), "validation.bad_input");
  await refused(prUpdate(h.ctx, { repo: REPO, number: 7 }), "validation.bad_input");
  await refused(prUpdate(h.ctx, { repo: REPO, number: 7, labels: [1] as never }), "validation.bad_input");
  assert.equal(h.requests.length, 0);
});

test("a pull request that cannot be merged yet is a state error, not a crash", async () => {
  const h = world();
  h.on(`PUT ${P}/pulls/7/merge`, { status: 405, body: RECORDED.notMergeable });
  await refused(prMerge(h.ctx, { repo: REPO, number: 7, method: "merge" }), "validation.precondition_failed");
  h.on(`PUT ${P}/pulls/7/merge`, { status: 409, body: { message: "Head branch was modified" } });
  await refused(prMerge(h.ctx, { repo: REPO, number: 7, method: "merge" }), "validation.precondition_failed");
});

test("labels and assignees go to the issues endpoint, title, body and base to the pull request, and the answer is the pull request as it is now", async () => {
  const h = world();
  h.on(`PATCH ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`PATCH ${P}/issues/7`, { status: 200, body: {} });
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsPassing });
  const out = await prUpdate(h.ctx, { repo: REPO, number: 7, title: "New title", base: "develop", labels: ["bug"], assignees: ["omar"] });
  assert.deepEqual(contractErrors("github.pull_request.update", "out", out), []);
  assert.deepEqual(h.withPath("PATCH", `${P}/pulls/7`)[0]!.body, { title: "New title", base: "develop" });
  assert.deepEqual(h.withPath("PATCH", `${P}/issues/7`)[0]!.body, { labels: ["bug"], assignees: ["omar"] });
  await prUpdate(h.ctx, { repo: REPO, number: 7, labels: ["bug"] });
  assert.equal(h.withPath("PATCH", `${P}/pulls/7`).length, 1, "only labels: the pull request itself is not patched");
});

test("only failed check suites are asked to run again, once each", async () => {
  const h = world();
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsFailing });
  h.on(`POST ${P}/check-suites/55/rerequest`, { status: 201, body: {} });
  assert.deepEqual(await prRerunChecks(h.ctx, { repo: REPO, number: 7 }), { requested: true });
  assert.deepEqual(h.requests.filter((r) => r.method === "POST" && r.path.includes("rerequest")).map((r) => r.path), [`${P}/check-suites/55/rerequest`]);
  h.on(`GET ${P}/commits/${SHA}/check-runs`, { status: 200, body: RECORDED.runsPassing });
  assert.deepEqual(await prRerunChecks(h.ctx, { repo: REPO, number: 7 }), { requested: false });
  assert.equal(h.requests.filter((r) => r.path.includes("rerequest")).length, 1, "nothing failed, nothing re-run");
});

// ---- issues

test("an issue is read, opened, changed, commented on and closed; a pull request number is not an issue", async () => {
  const h = world();
  h.on(`GET ${P}/issues/12`, { status: 200, body: RECORDED.issue });
  const got = await issueGet(h.ctx, { repo: REPO, number: 12 });
  assert.deepEqual(contractErrors("github.issue.get", "out", got), []);
  assert.deepEqual(got.issue, { repo: REPO, number: 12, title: "The intake form loses the phone number", state: "open", author: "pat", url: "https://github.com/vyre-ai/website/issues/12", labels: ["bug"], assignees: [], body: "Steps: ..." });
  h.on(`GET ${P}/issues/7`, { status: 200, body: RECORDED.issueIsPr });
  await refused(issueGet(h.ctx, { repo: REPO, number: 7 }), "validation.not_found");
  h.on(`POST ${P}/issues`, { status: 201, body: RECORDED.issue });
  const made = await issueCreate(h.ctx, { repo: REPO, title: "The intake form loses the phone number", body: "Steps: ...", labels: ["bug"], assignees: ["omar"] });
  assert.deepEqual(contractErrors("github.issue.create", "out", made), []);
  assert.deepEqual(h.requests.at(-1)!.body, { title: "The intake form loses the phone number", body: "Steps: ...", labels: ["bug"], assignees: ["omar"] });
  h.on(`PATCH ${P}/issues/12`, { status: 200, body: { ...RECORDED.issue, state: "closed" } });
  const upd = await issueUpdate(h.ctx, { repo: REPO, number: 12, title: "Renamed" });
  assert.deepEqual(h.requests.at(-1)!.body, { title: "Renamed" });
  assert.equal(upd.issue.state, "closed");
  assert.deepEqual(await issueClose(h.ctx, { repo: REPO, number: 12 }), { closed: true });
  assert.deepEqual(h.requests.at(-1)!.body, { state: "closed" });
  h.on(`POST ${P}/issues/12/comments`, { status: 201, body: RECORDED.comment });
  assert.deepEqual(await issueComment(h.ctx, { repo: REPO, number: 12, body: "On it" }), { commentId: 98765 });
  await refused(issueUpdate(h.ctx, { repo: REPO, number: 12 }), "validation.bad_input");
  await refused(issueCreate(h.ctx, { repo: REPO, title: "" }), "validation.bad_input");
});

// ---- the work handed to agents

const PR_RECORD = { type: "pull_request", id: "rec_pr00001", fields: { repo: REPO, number: 7, state: "open", title: "Fix the intake form", author_agent: "agt_scout01", checks: "failing" } };

test("Ask author agent to fix creates a task for the author agent each round and stops after three", async () => {
  const h = harness();
  h.addRecord({ ...PR_RECORD, fields: { ...PR_RECORD.fields } });
  h.addRecord({ type: "pull_request", id: "rec_pr00002", fields: { ...PR_RECORD.fields, number: 8, title: "Another" } });
  const first = await prAskAuthorFix(h.ctx, { recordId: "rec_pr00001", checkName: "build", idempotencyKey: "idem_fix_1" });
  assert.deepEqual(contractErrors("github.pull_request.ask_author_fix", "out", first), []);
  assert.deepEqual(first, { taskId: "tsk_gh1", attempt: 1 });
  const asked = h.calls("tasks.create")[0]!.input;
  assert.deepEqual(
    [asked.kind, asked.title, asked.assigned, asked.recordId, asked.idempotencyKey, asked.summary],
    ["work", "Fix build on vyre-ai/website#7", { kind: "agent", id: "agt_scout01" }, "rec_pr00001", "ghfix-vyre-ai/website-7-1", "Fix the intake form"],
  );
  assert.deepEqual(h.named("github.fix_requested").map((e) => [e.payload, e.subject]), [[{ recordId: "rec_pr00001", taskId: "tsk_gh1", attempt: 1 }, "record/rec_pr00001"]]);
  assert.deepEqual(payloadErrors("github.fix_requested", h.emitted[0]!.payload), []);
  assert.equal((await prAskAuthorFix(h.ctx, { recordId: "rec_pr00001" })).attempt, 2);
  assert.equal(h.calls("tasks.create")[1]!.input.title, "Fix the failing checks on vyre-ai/website#7");
  assert.equal((await prAskAuthorFix(h.ctx, { recordId: "rec_pr00001" })).attempt, 3);
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_pr00001" }), "validation.precondition_failed");
  assert.equal(h.calls("tasks.create").length, 3, "the fourth ask makes no task");
  assert.equal(h.rows(`SELECT attempts FROM github_fix WHERE "fixKey" = ?`, `${REPO}#7`)[0]!.attempts, 3);
  assert.equal((await prAskAuthorFix(h.ctx, { recordId: "rec_pr00002" })).attempt, 1, "each pull request has its own three rounds");
});

test("a round counts only once its task exists, and only an open pull request with an author agent can be sent back", async () => {
  const h = harness();
  h.addRecord({ type: "pull_request", id: "rec_pr00009", fields: { ...PR_RECORD.fields, number: 9 } });
  h.failCap("tasks.create");
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_pr00009" }), "internal.unavailable");
  assert.equal(h.rows(`SELECT * FROM github_fix`).length, 0);
  assert.equal(h.named("github.fix_requested").length, 0);
  h.failCap("tasks.create", false);
  assert.equal((await prAskAuthorFix(h.ctx, { recordId: "rec_pr00009" })).attempt, 1);
  h.addRecord({ type: "pull_request", id: "rec_prmerged", fields: { ...PR_RECORD.fields, number: 10, state: "merged" } });
  h.addRecord({ type: "pull_request", id: "rec_prnoagent", fields: { repo: REPO, number: 11, state: "open", title: "By a person" } });
  h.addRecord({ type: "pull_request", id: "rec_prnonum", fields: { title: "Not synced" } });
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_prmerged" }), "validation.precondition_failed");
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_prnoagent" }), "validation.precondition_failed");
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_prnonum" }), "validation.precondition_failed");
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_nothing1" }), "validation.not_found");
  await refused(prAskAuthorFix(h.ctx, { recordId: "nope" }), "validation.bad_input");
  await refused(prAskAuthorFix(h.ctx, { recordId: "rec_pr00009", checkName: "" }), "validation.bad_input");
});

const ISSUE_RECORD = { type: "issue", id: "rec_iss0001", fields: { repo: REPO, number: 12, state: "open", title: "The intake form loses the phone number", body: "Steps: ..." } };

test("Assign to agent creates a task for the agent linked to the issue and notes it on the record", async () => {
  const h = harness();
  h.addRecord({ ...ISSUE_RECORD, fields: { ...ISSUE_RECORD.fields } });
  const out = await issueAssignAgent(h.ctx, { recordId: "rec_iss0001", agentId: "agt_scout01", idempotencyKey: "idem_assign_1" });
  assert.deepEqual(out, { taskId: "tsk_gh1" });
  assert.deepEqual(contractErrors("github.issue.assign_agent", "out", out), []);
  const asked = h.calls("tasks.create")[0]!.input;
  assert.deepEqual(
    [asked.title, asked.assigned, asked.recordId, asked.idempotencyKey, asked.summary],
    ["Resolve vyre-ai/website#12: The intake form loses the phone number", { kind: "agent", id: "agt_scout01" }, "rec_iss0001", "ghassign-rec_iss0001-agt_scout01", "Steps: ..."],
  );
  assert.equal(h.records.get("rec_iss0001")!.fields.assigned_task, "tsk_gh1");
  assert.deepEqual(h.named("github.issue_assigned").map((e) => [e.payload, e.subject]), [[{ recordId: "rec_iss0001", taskId: "tsk_gh1", agentId: "agt_scout01" }, "record/rec_iss0001"]]);
  assert.deepEqual(payloadErrors("github.issue_assigned", h.emitted[0]!.payload), []);
});

test("Assign to agent refuses a closed issue, a record that is not an issue and a bad agent; a record that cannot be updated does not lose the task", async () => {
  const h = harness();
  h.addRecord({ ...ISSUE_RECORD, fields: { ...ISSUE_RECORD.fields } });
  h.addRecord({ type: "issue", id: "rec_isclosed", fields: { ...ISSUE_RECORD.fields, state: "closed" } });
  h.addRecord({ type: "issue", id: "rec_isnonum1", fields: { title: "Not synced" } });
  await refused(issueAssignAgent(h.ctx, { recordId: "rec_isclosed", agentId: "agt_scout01" }), "validation.precondition_failed");
  await refused(issueAssignAgent(h.ctx, { recordId: "rec_isnonum1", agentId: "agt_scout01" }), "validation.precondition_failed");
  await refused(issueAssignAgent(h.ctx, { recordId: "rec_iss0001", agentId: "usr_maya01" }), "validation.bad_input");
  await refused(issueAssignAgent(h.ctx, { recordId: "bad", agentId: "agt_scout01" }), "validation.bad_input");
  await refused(issueAssignAgent(h.ctx, { recordId: "rec_nothing1", agentId: "agt_scout01" }), "validation.not_found");
  assert.equal(h.calls("tasks.create").length, 0);
  h.failCap("records.update");
  const out = await issueAssignAgent(h.ctx, { recordId: "rec_iss0001", agentId: "agt_scout01" });
  assert.equal(out.taskId, "tsk_gh1");
  assert.equal(h.named("github.issue_assigned").length, 1);
});

// ---- connector replay: GitHub's deliveries

const SOURCE = { repository: { full_name: REPO }, installation: { id: INSTALL } };
const opened = (extra: Record<string, unknown> = {}) => ({ action: "opened", number: 7, pull_request: { number: 7, merged: false, head: { ref: "fix/intake", sha: SHA }, user: { login: "agent-scout" } }, ...SOURCE, ...extra });

test("deliveries become the input of the webhook capability, with a merge told apart from a plain close", () => {
  const base = { deliveryId: "dlv-1", repo: REPO, installationId: INSTALL };
  assert.deepEqual(parseDelivery("pull_request", "dlv-1", opened()), { ...base, event: "pull_request", action: "opened", number: 7, sha: SHA, branch: "fix/intake" });
  const merged = { ...opened({ action: "closed" }), pull_request: { ...opened().pull_request, merged: true } };
  assert.equal(parseDelivery("pull_request", "dlv-1", merged)!.action, "merged");
  assert.equal(parseDelivery("pull_request", "dlv-1", opened({ action: "closed" }))!.action, "closed");
  assert.deepEqual(parseDelivery("issues", "dlv-2", { action: "opened", issue: { number: 12 }, ...SOURCE }), { deliveryId: "dlv-2", event: "issues", action: "opened", repo: REPO, installationId: INSTALL, number: 12 });
  assert.deepEqual(parseDelivery("push", "dlv-3", { ref: "refs/heads/main", after: SHA, ...SOURCE }), { deliveryId: "dlv-3", event: "push", repo: REPO, installationId: INSTALL, branch: "main", sha: SHA });
  assert.deepEqual(parseDelivery("push", "dlv-4", { ref: "refs/tags/v1", after: SHA, ...SOURCE }), { deliveryId: "dlv-4", event: "push", repo: REPO, installationId: INSTALL, sha: SHA }, "a tag has no branch");
  assert.deepEqual(parseDelivery("push", "dlv-5", { ref: "refs/heads/old", after: "0".repeat(40), ...SOURCE }), { deliveryId: "dlv-5", event: "push", repo: REPO, installationId: INSTALL, branch: "old" }, "a deleted branch has no commit");
  assert.deepEqual(
    parseDelivery("check_run", "dlv-6", { action: "completed", check_run: { name: "build", conclusion: "failure", head_sha: SHA, pull_requests: [{ number: 7 }] }, ...SOURCE }),
    { deliveryId: "dlv-6", event: "check_run", action: "completed", repo: REPO, installationId: INSTALL, name: "build", conclusion: "failure", sha: SHA, number: 7 },
  );
  assert.deepEqual(
    parseDelivery("workflow_run", "dlv-7", { action: "completed", workflow_run: { name: "CI", conclusion: "success", head_sha: SHA }, ...SOURCE }),
    { deliveryId: "dlv-7", event: "workflow_run", action: "completed", repo: REPO, installationId: INSTALL, name: "CI", conclusion: "success", sha: SHA },
  );
  assert.equal(parseDelivery("star", "dlv-8", {}), null);
  assert.equal(parseDelivery("push", "", {}), null);
});

function replayWorld(): Harness {
  const h = harness();
  h.tokenEndpoint();
  h.addRecord({ type: "pull_request", id: "rec_pr00001", fields: { repo: REPO, number: 7 } });
  h.addRecord({ type: "issue", id: "rec_iss0001", fields: { repo: REPO, number: 12 } });
  h.on(`GET ${P}/pulls/7`, { status: 200, body: RECORDED.pr });
  h.on(`GET ${P}/issues/12`, { status: 200, body: RECORDED.issue });
  return h;
}
const deliver = (h: Harness, event: string, id: string, body: unknown) => receiveWebhook(h.ctx, parseDelivery(event, id, body)!);

test("replay: a pull request opens, then merges, and each lands once with the record and the author", async () => {
  const h = replayWorld();
  assert.deepEqual(await deliver(h, "pull_request", "dlv-1", opened()), { accepted: true });
  assert.deepEqual(h.emitted.map((e) => e.name), ["github.event_received", "pull_request.opened"]);
  assert.deepEqual(h.emitted[0]!.payload, { deliveryId: "dlv-1", event: "pull_request", action: "opened", repo: REPO });
  assert.deepEqual(h.emitted[1]!.payload, { repo: REPO, number: 7, recordId: "rec_pr00001", author: "agent-scout" });
  assert.equal(h.emitted[1]!.subject, `entity/${REPO}`);
  assert.equal(h.requests.at(-1)!.headers.authorization, "Bearer ghs_token_1", "no installation lookup: the delivery names the installation");
  const merged = { ...opened({ action: "closed" }), pull_request: { ...opened().pull_request, merged: true } };
  await deliver(h, "pull_request", "dlv-2", merged);
  await deliver(h, "pull_request", "dlv-3", opened({ action: "closed", number: 7 }));
  await deliver(h, "pull_request", "dlv-4", opened({ action: "synchronize" }));
  assert.deepEqual(h.named("pull_request.merged").map((e) => e.payload), [{ repo: REPO, number: 7, recordId: "rec_pr00001" }]);
  assert.deepEqual(h.named("pull_request.closed").map((e) => e.payload), [{ repo: REPO, number: 7, recordId: "rec_pr00001" }]);
  assert.equal(h.emitted.filter((e) => e.name === "github.event_received").length, 4, "every delivery is recorded");
  for (const e of h.emitted) assert.deepEqual(payloadErrors(e.name, e.payload), [], e.name);
  const before = h.emitted.length;
  await deliver(h, "pull_request", "dlv-1", opened());
  assert.equal(h.emitted.length, before, "GitHub redelivers; the second time changes nothing");
  assert.equal(h.rows(`SELECT "deliveryId" FROM github_delivery`).length, 4);
});

test("replay: an issue opens and lands with its author; with no record yet and GitHub unreadable it still lands", async () => {
  const h = replayWorld();
  await deliver(h, "issues", "dlv-1", { action: "opened", issue: { number: 12 }, ...SOURCE });
  assert.deepEqual(h.named("issue.opened").map((e) => e.payload), [{ repo: REPO, number: 12, recordId: "rec_iss0001", author: "pat" }]);
  const bare = harness();
  bare.tokenEndpoint();
  bare.on(`GET ${P}/issues/13`, { status: 404, body: {} });
  await deliver(bare, "issues", "dlv-2", { action: "opened", issue: { number: 13 }, ...SOURCE });
  assert.deepEqual(bare.named("issue.opened").map((e) => e.payload), [{ repo: REPO, number: 13, author: "unknown" }], "no record, no author: the event still matters");
  const down = replayWorld();
  down.failCap("records.query");
  await deliver(down, "pull_request", "dlv-3", opened());
  assert.deepEqual(down.named("pull_request.opened").map((e) => e.payload), [{ repo: REPO, number: 7, author: "agent-scout" }]);
  assert.deepEqual(payloadErrors("issue.opened", h.named("issue.opened")[0]!.payload), []);
});

test("replay: pushes, checks and workflow runs land as the events a site or automation listens for", async () => {
  const h = replayWorld();
  await deliver(h, "push", "dlv-1", { ref: "refs/heads/main", after: SHA, ...SOURCE });
  await deliver(h, "push", "dlv-2", { ref: "refs/tags/v1", after: SHA, ...SOURCE });
  await deliver(h, "push", "dlv-3", { ref: "refs/heads/old", after: "0".repeat(40), ...SOURCE });
  assert.deepEqual(h.named("repo.pushed").map((e) => e.payload), [{ repo: REPO, number: 0, branch: "main", sha: SHA }]);
  await deliver(h, "check_run", "dlv-4", { action: "completed", check_run: { name: "build", conclusion: "failure", head_sha: SHA, pull_requests: [{ number: 7 }] }, ...SOURCE });
  await deliver(h, "check_run", "dlv-5", { action: "completed", check_run: { name: "lint", conclusion: "success", head_sha: SHA, pull_requests: [] }, ...SOURCE });
  await deliver(h, "check_run", "dlv-6", { action: "completed", check_run: { name: "slow", conclusion: "skipped", head_sha: SHA, pull_requests: [] }, ...SOURCE });
  await deliver(h, "check_run", "dlv-7", { action: "created", check_run: { name: "build", conclusion: null, head_sha: SHA, pull_requests: [] }, ...SOURCE });
  assert.deepEqual(h.named("github.check_completed").map((e) => e.payload), [
    { repo: REPO, sha: SHA, name: "build", conclusion: "failure", number: 7 }, { repo: REPO, sha: SHA, name: "lint", conclusion: "success" },
  ]);
  await deliver(h, "workflow_run", "dlv-8", { action: "completed", workflow_run: { name: "CI", conclusion: "success", head_sha: SHA }, ...SOURCE });
  assert.deepEqual(h.named("workflow.completed").map((e) => e.payload), [{ repo: REPO, name: "CI", conclusion: "success", sha: SHA }]);
  await deliver(h, "ping", "dlv-9", { zen: "Keep it logically awesome." });
  assert.equal(h.named("github.event_received").length, 9);
  for (const e of h.emitted) assert.deepEqual(payloadErrors(e.name, e.payload), [], e.name);
  await refused(receiveWebhook(h.ctx, { deliveryId: "", event: "ping" }), "validation.bad_input");
  await refused(receiveWebhook(h.ctx, { deliveryId: "x", event: "star" as never }), "validation.bad_input");
});

test("the webhook input is the frozen shape", () => {
  const input = parseDelivery("pull_request", "dlv-1", opened());
  assert.deepEqual(contractErrors("github.receive_webhook", "in", input), []);
  assert.ok(NOW > 0);
});
