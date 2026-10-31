// Agent computers on a computer that joined the Space (a node): placement, jobs that run once, and a token that reaches one computer's home and nothing else. The node here is a loop that does what
// vyred --role compute does: claim jobs, run each on its own host (a second fake machine), post the answer.
import test from "node:test";
import assert from "node:assert/strict";
import { configure, provision, remove, sleep, wake } from "../handlers/lifecycle.ts";
import { screenshot } from "../handlers/record.ts";
import { nodeHomeCheck, nodeJobs, nodeResult, nodeStreamInput, nodeStreamOpen } from "../handlers/node.ts";
import { mintTicket } from "../projections.ts";
import { claimJobs, enqueueJob, LEASE_MS, submitJob } from "../jobs.ts";
import { nodeRun } from "../remote.ts";
import { codeOf, harness, INTAKE, NOW, OMAR } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { fakeHost } from "../fixtures/fake-host.ts";

const NODE = "srv_node1";
const servers = (extra: Record<string, unknown> = {}) => ({ servers: [{ serverId: NODE, role: "compute", enrollment: "approved", ...extra }] });
const withNode = (extra: Record<string, unknown> = {}) => harness({ respond: { "network.servers": () => servers(extra) } });

function startNode(h: Harness, nodeHost = fakeHost(), opts: { dropReplies?: { n: number } } = {}) {
  let stop = false;
  const ran: Array<{ jobId: string; kind: string }> = [];
  const loop = (async () => {
    while (!stop) {
      const { jobs } = await nodeJobs(h.ctx, { nodeId: NODE });
      for (const j of jobs) {
        ran.push({ jobId: j.jobId, kind: j.kind });
        let outcome: { ok: true; result: unknown } | { ok: false; error: string };
        try { outcome = { ok: true, result: await nodeRun(nodeHost.host, j.kind, j.input) }; } catch (e) { outcome = { ok: false, error: e instanceof Error ? e.message : "failed" }; }
        if (opts.dropReplies && opts.dropReplies.n > 0) { opts.dropReplies.n--; continue; }
        await nodeResult(h.ctx, { nodeId: NODE, jobId: j.jobId, ...outcome });
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  })();
  return { ran, host: nodeHost, async stop() { stop = true; await loop; } };
}

test("a computer placed on a node is created, woken, slept and removed by jobs the node runs, not by the Space's own machine", async () => {
  const h = withNode();
  const node = startNode(h);
  try {
    const out = await provision(h.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k1" });
    assert.equal(out.computer.nodeId, NODE);
    assert.equal(out.computer.state, "asleep");
    assert.equal(h.fake.named("create").length, 0, "the Space's own machine was not asked");
    assert.equal(node.host.named("create").length, 1);
    const id = out.computer.computerId;
    assert.equal((await wake(h.ctx, { computerId: id })).computer.state, "working");
    assert.equal(node.host.named("start").length, 1);
    assert.equal((await screenshot(h.ctx, { computerId: id })).width, 1280);
    assert.equal((await sleep(h.ctx, { computerId: id })).computer.state, "asleep");
    assert.equal(node.host.named("stop").length, 1);
    await remove(h.ctx, { computerId: id });
    assert.equal(node.host.named("remove").length, 1);
    assert.deepEqual(h.fake.calls.map((c) => c.method), [], "nothing ran on the Space's machine");
  } finally { await node.stop(); }
});

test("placement is refused for a computer that has not joined, was not approved, or is someone else's own", async () => {
  const unknown = harness({ respond: { "network.servers": () => ({ servers: [] }) } });
  await assert.rejects(() => provision(unknown.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" }), (e) => codeOf(e) === "validation.bad_input");
  const waiting = withNode({ enrollment: "waiting" });
  await assert.rejects(() => provision(waiting.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" }), (e) => codeOf(e) === "validation.bad_input");
  const personal = harness({ respond: { "network.servers": () => servers({ owner: OMAR }), "agents.get": () => ({ agent: { agentId: INTAKE, folderId: "fld_x", ownerId: "usr_dana" } }) } });
  await assert.rejects(() => provision(personal.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" }), (e) => codeOf(e) === "permission.no_grant");
  assert.equal(personal.rows("SELECT * FROM computers_computers").length, 0, "nothing was left behind");
  const mine = harness({ respond: { "network.servers": () => servers({ owner: OMAR }), "agents.get": () => ({ agent: { agentId: INTAKE, folderId: "fld_x", ownerId: OMAR } }) } });
  const node = startNode(mine);
  try { assert.equal((await provision(mine.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" })).computer.nodeId, NODE); } finally { await node.stop(); }
});

test("a job the node ran but could not report is handed out again, and the first answer is the only one kept", async () => {
  const h = withNode();
  const node = startNode(h, fakeHost(), { dropReplies: { n: 1 } });
  try {
    const made = provision(h.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" });
    await new Promise((r) => setTimeout(r, 120));
    h.advance(LEASE_MS + 1000);   // the lease of the first delivery ran out with no answer
    const out = await made;
    assert.equal(out.computer.state, "asleep");
    const rows = h.rows("SELECT attempts, state FROM computers_job");
    assert.deepEqual(rows.map((r) => [r["attempts"], r["state"]]), [[2, "done"]], "two deliveries, one stored answer");
    // a late second answer for the same job changes nothing
    const id = String(h.rows("SELECT job_id FROM computers_job")[0]?.["job_id"]);
    assert.equal((await nodeResult(h.ctx, { nodeId: NODE, jobId: id, ok: false, error: "late" })).status, "already");
    assert.equal(h.rows("SELECT state FROM computers_job")[0]?.["state"], "done");
  } finally { await node.stop(); }
});

test("a job whose lease runs out twice fails; it is not handed to another node", async () => {
  const h = withNode();
  const id = enqueueJob(h.db, { nodeId: NODE, computerId: "cmt_x", agentId: INTAKE, kind: "probe", input: {}, timeoutMs: 10 * LEASE_MS, now: NOW });
  assert.equal((await claimJobs(h.db, NODE, NOW)).length, 1);
  assert.equal((await claimJobs(h.db, NODE, NOW + LEASE_MS + 1)).length, 1, "handed out once more");
  assert.equal((await claimJobs(h.db, NODE, NOW + 2 * LEASE_MS + 2)).length, 0);
  assert.equal(h.rows("SELECT state FROM computers_job WHERE job_id = ?", id)[0]?.["state"], "failed");
  assert.equal((await claimJobs(h.db, "srv_other", NOW + 2 * LEASE_MS + 3)).length, 0, "another node never gets it");
  assert.equal(submitJob(h.db, "srv_other", id, { ok: true, result: {} }, NOW), "unknown");
});

test("a job token reaches the home of its own computer, for the length of its job, as that agent, and for nothing else", async () => {
  const h = withNode();
  const mk = (computerId: string, agentId: string, kind: "start" | "probe") => {
    h.db.run("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, node_id, created_at) VALUES (?, ?, 'asleep', 0, 8, 10, 'server', ?, ?)", computerId, agentId, NODE, NOW);
    return enqueueJob(h.db, { nodeId: NODE, computerId, agentId, kind, input: {}, timeoutMs: 600_000, now: NOW });
  };
  const a = mk("cmt_a", "agt_a", "start");
  mk("cmt_b", "agt_b", "start");
  mk("cmt_p", "agt_p", "probe");
  const got = Object.fromEntries((await claimJobs(h.db, NODE, NOW)).map((j) => [j.computerId, j]));
  const ask = (token: string, computerId: string, cap = "files.list", nodeId = NODE) => nodeHomeCheck(h.ctx, { nodeId, token, computerId, cap });
  assert.deepEqual(await ask(got["cmt_a"]!.token, "cmt_a"), { agentId: "agt_a" });
  assert.equal(await ask(got["cmt_a"]!.token, "cmt_b"), null, "a token reused for another computer is refused");
  assert.equal(await ask(got["cmt_b"]!.token, "cmt_a"), null);
  assert.equal(await ask(got["cmt_a"]!.token, "cmt_a", "secrets.reveal"), null, "only the home calls");
  assert.equal(await ask(got["cmt_a"]!.token, "cmt_a", "files.list", "srv_other"), null, "another node cannot use it");
  assert.equal(await ask(got["cmt_p"]!.token, "cmt_p"), null, "a probe job has no business in the home");
  assert.equal(await ask("vcj_guess", "cmt_a"), null);
  assert.equal(await ask("", "cmt_a"), null);
  await nodeResult(h.ctx, { nodeId: NODE, jobId: a, ok: true, result: {} });
  assert.equal(await ask(got["cmt_a"]!.token, "cmt_a"), null, "dead when its job ends");
  const stored = h.rows("SELECT token_hash FROM computers_job").map((r) => String(r["token_hash"]));
  assert.ok(!stored.includes(got["cmt_b"]!.token), "only a hash is kept");
});

test("a computer on a node is not asked of the Space's machine on configure, and its live view is served by the Space, not the node is not asked of the Space's machine on configure", async () => {
  const h = withNode();
  const node = startNode(h);
  try {
    const id = (await provision(h.ctx, { agentId: INTAKE, nodeId: NODE, idempotencyKey: "k" })).computer.computerId;
    await wake(h.ctx, { computerId: id });
    await configure(h.ctx, { computerId: id, tabLimit: 3 });
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(node.host.named("configure").length >= 1, true);
    assert.equal(h.fake.named("configure").length, 0);
    const { hostOf } = await import("../projections.ts");
    const target = await hostOf(h.ctx, id).stream({ computerId: id, ticket: "t" });
    assert.deepEqual(target, { transport: "mjpeg", url: `/computers/${id}/stream` }, "the viewer's address is the Space's own route, not the node's");
    assert.equal(node.host.named("stream").length, 0, "asking for the address runs nothing on the node");
  } finally { await node.stop(); }
});

test("removing a computer whose node left the Space removes the row; while the node is still there a failed removal is an error", async () => {
  const gone = harness({ respond: { "network.servers": () => ({ servers: [] }) } });
  gone.db.run("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, node_id, created_at) VALUES ('cmt_g', 'agt_g', 'asleep', 0, 8, 10, 'server', ?, ?)", NODE, NOW);
  // no node answers: moving the clock past the job's deadline fails it
  const p = remove(gone.ctx, { computerId: "cmt_g" });
  await new Promise((r) => setTimeout(r, 60));
  gone.advance(10 * 60_000);
  assert.deepEqual(await p, { removed: true });
  assert.equal(gone.rows("SELECT * FROM computers_computers").length, 0);
  const here = withNode();
  here.db.run("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, node_id, created_at) VALUES ('cmt_h', 'agt_h', 'asleep', 0, 8, 10, 'server', ?, ?)", NODE, NOW);
  const q = remove(here.ctx, { computerId: "cmt_h" });
  const caught = q.catch((e) => e);
  await new Promise((r) => setTimeout(r, 60));
  here.advance(10 * 60_000);
  assert.ok((await caught) instanceof Error);
  assert.equal(here.rows("SELECT * FROM computers_computers").length, 1, "the row stays while its node is there");
});

test("a viewer's ticket opens the view of its own computer once, and input only for the person at the controls", async () => {
  const h = withNode();
  for (const [cid, state, by] of [["cmt_w", "working", null], ["cmt_t", "takeover", "usr_dana"], ["cmt_z", "asleep", null], ["cmt_l", "working", null]] as const) {
    h.db.run("INSERT INTO computers_computers (computer_id, agent_id, state, tabs, tab_limit, idle_sleep_minutes, host, node_id, takeover_by, created_at) VALUES (?, ?, ?, 0, 8, 10, 'server', ?, ?, ?)", cid, `agt_${cid}`, state, cid === "cmt_l" ? null : NODE, by, NOW);
  }
  const watch = await mintTicket(h.db, "stream", "cmt_w", "usr_dana", NOW);
  assert.deepEqual(await nodeStreamOpen(h.ctx, { ticket: watch.ticket, computerId: "cmt_w" }), { nodeId: NODE, personId: "usr_dana", input: false });
  assert.equal(await nodeStreamOpen(h.ctx, { ticket: watch.ticket, computerId: "cmt_w" }), null, "one use");
  const other = await mintTicket(h.db, "stream", "cmt_w", "usr_dana", NOW);
  assert.equal(await nodeStreamOpen(h.ctx, { ticket: other.ticket, computerId: "cmt_t" }), null, "a ticket is for its own computer");
  const take = await mintTicket(h.db, "takeover", "cmt_t", "usr_dana", NOW);
  assert.deepEqual(await nodeStreamOpen(h.ctx, { ticket: take.ticket, computerId: "cmt_t" }), { nodeId: NODE, personId: "usr_dana", input: true });
  const stranger = await mintTicket(h.db, "takeover", "cmt_t", "usr_omar", NOW);
  assert.equal((await nodeStreamOpen(h.ctx, { ticket: stranger.ticket, computerId: "cmt_t" }))?.input, false, "someone else's take-over ticket gives no input");
  const asleep = await mintTicket(h.db, "stream", "cmt_z", "usr_dana", NOW);
  assert.equal(await nodeStreamOpen(h.ctx, { ticket: asleep.ticket, computerId: "cmt_z" }), null, "an asleep computer has no view");
  const home = await mintTicket(h.db, "stream", "cmt_l", "usr_dana", NOW);
  assert.equal(await nodeStreamOpen(h.ctx, { ticket: home.ticket, computerId: "cmt_l" }), null, "the Space's own computers are not served by a node socket");
  assert.equal(await nodeStreamInput(h.ctx, { computerId: "cmt_t", personId: "usr_dana" }), true);
  assert.equal(await nodeStreamInput(h.ctx, { computerId: "cmt_t", personId: "usr_omar" }), false);
  assert.equal(await nodeStreamInput(h.ctx, { computerId: "cmt_w", personId: "usr_dana" }), false, "not at the controls once given back");
});

test("a job's Vault channel token goes to the node in the delivery and is gone from the stored row: before, during and after, and when the job fails undelivered", async () => {
  const h = withNode();
  const TOKEN = "f".repeat(48);
  const stored = (id: string): string => String((h.rows("SELECT input_json FROM computers_job WHERE job_id = ?", id)[0] as { input_json: string }).input_json);
  const queue = (): string => enqueueJob(h.ctx.db, { nodeId: NODE, computerId: "cmt_x", agentId: INTAKE, kind: "configure", input: { computerId: "cmt_x", tabLimit: 4, fillUrl: "http://host.docker.internal:8420/computers/fill", fillToken: TOKEN }, timeoutMs: 60_000, now: NOW });
  const id = queue();
  assert.ok(stored(id).includes(TOKEN), "queued: the token waits for the node (the row is the only way to hand it over)");
  const [job] = await claimJobs(h.ctx.db, NODE, NOW + 1);
  assert.equal((job!.input as { fillToken?: string }).fillToken, TOKEN, "the delivery carries it, once");
  assert.ok(!stored(id).includes(TOKEN), "delivered: the row holds no token");
  assert.deepEqual(JSON.parse(stored(id)), { computerId: "cmt_x", tabLimit: 4, fillUrl: "http://host.docker.internal:8420/computers/fill" }, "the rest of the input is kept");
  submitJob(h.ctx.db, NODE, id, { ok: true, result: {} }, NOW + 2);
  assert.ok(!JSON.stringify(h.rows("SELECT * FROM computers_job")).includes(TOKEN), "answered: still none anywhere in the table");

  // a job nobody collected before its deadline is failed, and its token goes with it
  const late = queue();
  assert.ok(stored(late).includes(TOKEN));
  await claimJobs(h.ctx.db, "srv_other", NOW + 120_000);   // any poll sweeps
  assert.ok(!stored(late).includes(TOKEN), "failed undelivered: the token is cleared");
  assert.equal(String((h.rows("SELECT state FROM computers_job WHERE job_id = ?", late)[0] as { state: string }).state), "failed");

  // a delivery repeated after a lost lease has no token: that computer has no Vault channel until it wakes again
  const again = queue();
  await claimJobs(h.ctx.db, NODE, NOW + 3);
  await claimJobs(h.ctx.db, NODE, NOW + 3 + LEASE_MS + 1);
  assert.ok(!stored(again).includes(TOKEN));
  assert.ok(!JSON.stringify(h.rows("SELECT * FROM computers_job")).includes(TOKEN), "nothing in the table opens a channel");
});
