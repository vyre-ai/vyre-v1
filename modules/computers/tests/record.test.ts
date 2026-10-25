// Recording while you take over, what to do with a recording, screenshots, the live view, and the session timeline (spec 2.7). Events and the network log are masked before they are saved:
// a password typed, an Authorization header, a token in a body and every Vault value the computer filled never reach disk.
import test from "node:test";
import assert from "node:assert/strict";
import { giveBack, takeOver, wake } from "../handlers/lifecycle.ts";
import { provision } from "../handlers/lifecycle.ts";
import {
  maskEvents, maskHar, MASK, recordingDelete, recordingGet, recordingProcess, recordingsList, recordStart, recordStop, screenshot, skillFromStep, stream, timeline, timelineStep,
} from "../handlers/record.ts";
import { addStep, bindKit, redeemTicket, rememberSecrets } from "../projections.ts";
import { assertEventsConform, asPerson, codeOf, contractErrors, DANA, harness, INTAKE, MIN, NOW, OMAR } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const VAULT_VALUE = "sk-live-4f9a7c2e1b8d";
const EVENTS = [
  { t: 1, type: "click", element: { tag: "button", text: "Sign in" }, url: "https://app.example.com/login" },
  { t: 2, type: "key", key: "h", element: { tag: "input", type: "text", name: "username" } },
  { t: 3, type: "key", key: "x", element: { tag: "input", type: "password", name: "pw" } },
  { t: 4, type: "type", text: "123456", element: { tag: "input", type: "text", name: "otp_code" } },
  { t: 5, type: "type", text: `paste ${VAULT_VALUE} here`, element: { tag: "textarea", name: "notes" } },
].map((e) => JSON.stringify(e)).join("\n");
const HAR = JSON.stringify({
  log: {
    version: "1.2",
    entries: [
      {
        startedDateTime: "2026-10-25T00:00:00Z", time: 120,
        request: {
          method: "POST", url: "https://api.example.com/login?next=/home&api_key=abc123",
          headers: [{ name: "Authorization", value: "Bearer abc.def.ghi" }, { name: "Content-Type", value: "application/json" }, { name: "Cookie", value: "sid=1" }],
          queryString: [{ name: "next", value: "/home" }, { name: "api_key", value: "abc123" }],
          postData: { mimeType: "application/json", text: JSON.stringify({ user: "intake", password: "hunter2", nested: { token: "t-1", keep: "yes" } }) },
        },
        response: {
          status: 200, headers: [{ name: "Set-Cookie", value: "sid=2; HttpOnly" }, { name: "Content-Type", value: "application/json" }],
          content: { mimeType: "application/json", text: JSON.stringify({ accessToken: "zzz", name: "Intake", note: `echo ${VAULT_VALUE}` }) },
        },
      },
      {
        startedDateTime: "2026-10-25T00:00:01Z", time: 40,
        request: { method: "POST", url: "https://api.example.com/form", headers: [], postData: { mimeType: "application/x-www-form-urlencoded", text: "name=Intake&password=hunter2&city=Lisbon" } },
        response: { status: 204, headers: [], content: { mimeType: "text/html", text: "ok" } },
      },
    ],
  },
});

async function takenOver(h: Harness): Promise<string> {
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  await takeOver(h.ctx, { computerId: id });
  return id;
}

test("masking: passwords, secret-named fields, credentials in headers and bodies, and known Vault values", () => {
  bindKit({ createScrubber: (secrets) => ({ scrub: (t) => secrets.reduce((a, s) => a.split(s.value).join("[vault]"), t) }) });
  rememberSecrets("cmt_mask", [{ handle: "#Intake_Api.key", itemId: "vit_a", value: VAULT_VALUE }]);
  try {
    const events = maskEvents("cmt_mask", EVENTS).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(events.length, 5);
    assert.equal(events[1]?.["key"], "h", "a username key is kept");
    assert.equal(events[2]?.["key"], MASK, "a password field's key is not");
    assert.equal(events[3]?.["text"], MASK, "a field named like a secret is not");
    assert.equal(events[4]?.["text"], "paste [vault] here", "a Vault value is scrubbed wherever it shows");
    const har = maskHar("cmt_mask", HAR);
    assert.equal(har.readable, true);
    assert.ok(!har.text.includes(VAULT_VALUE));
    for (const secret of ["hunter2", "abc.def.ghi", "abc123", "sid=1", "sid=2", "zzz", "t-1"]) assert.ok(!har.text.includes(secret), `${secret} is still in the log`);
    const parsed = JSON.parse(har.text) as { log: { entries: Array<{ request: { headers: Array<{ name: string; value: string }>; postData: { text: string }; url: string }; response: { content: { text: string } } }> } };
    const [first, second] = parsed.log.entries;
    assert.deepEqual(first?.request.headers.map((x) => x.value), [MASK, "application/json", MASK]);
    assert.equal(JSON.parse(first!.request.postData.text).nested.keep, "yes", "what is not secret stays");
    assert.equal(JSON.parse(first!.request.postData.text).user, "intake");
    assert.match(first!.request.url, /api_key=\[masked\]|api_key=%5Bmasked%5D/);
    assert.ok(second?.request.postData.text.includes("city=Lisbon") && second.request.postData.text.includes("name=Intake"));
    assert.ok(!second?.request.postData.text.includes("hunter2"));
    assert.equal(first?.response.content.text.includes("[vault]"), true);
    // a log that cannot be read is dropped, not kept raw
    const bad = maskHar("cmt_mask", "{ not json password=hunter2");
    assert.equal(bad.readable, false);
    assert.ok(!bad.text.includes("hunter2"));
  } finally {
    bindKit(null);
  }
});

test("record needs the controls: a taken-over computer, held by the person recording, not already recording", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  await assert.rejects(() => recordStart(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  await takeOver(h.ctx, { computerId: id });
  const omar = asPerson(h, { kind: "person", id: OMAR });
  await assert.rejects(() => recordStart(omar.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  const out = await recordStart(h.ctx, { computerId: id });
  assert.match(out.recordingId, /^rcd_[a-z0-9]+$/);
  assert.deepEqual(contractErrors("computers.record_start", "out", out), []);
  assert.equal(h.rows("SELECT state, folder_path, by_person FROM computers_recordings")[0]?.["folder_path"], `work/recordings/${out.recordingId}`);
  assert.deepEqual(h.named("computer.recording_started").map((e) => e.payload), [{ computerId: id, personId: DANA, recordingId: out.recordingId }]);
  await assert.rejects(() => recordStart(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.precondition_failed");
  assert.equal(h.rows("SELECT recording_id FROM computers_computers")[0]?.["recording_id"], out.recordingId);
  h.fake.failing.add("record");
  const other = await provision(h.ctx, { agentId: "agt_two", idempotencyKey: "k2" });
  await takeOver(h.ctx, { computerId: other.computer.computerId });
  await assert.rejects(() => recordStart(h.ctx, { computerId: other.computer.computerId }), (e) => codeOf(e) === "internal.unexpected");
  assert.equal(h.rows("SELECT recording_id FROM computers_recordings").length, 1, "a recording the computer did not start leaves no row");
});

test("stopping saves the masked events and network log, adds one step, and says so", async () => {
  bindKit({ createScrubber: (secrets) => ({ scrub: (t) => secrets.reduce((a, s) => a.split(s.value).join("[vault]"), t) }) });
  try {
    const h = harness({ fakeOptions: { recording: { events: EVENTS, har: HAR, durationMs: 4 * MIN } } });
    const id = await takenOver(h);
    rememberSecrets(id, [{ handle: "#Intake_Api.key", itemId: "vit_a", value: VAULT_VALUE }]);
    const started = await recordStart(h.ctx, { computerId: id });
    h.advance(4 * MIN);
    const out = await recordStop(h.ctx, { computerId: id });
    assert.equal(out.recording.recordingId, started.recordingId);
    assert.equal(out.recording.state, "saved");
    assert.equal(out.recording.durationMs, 4 * MIN);
    assert.equal(out.recording.endedAt, NOW + 4 * MIN);
    assert.equal(out.recording.folderPath, `work/recordings/${started.recordingId}`);
    assert.deepEqual(contractErrors("computers.record_stop", "out", out), []);
    const saved = h.fake.computers.get(id)!.saved[0]!;
    assert.equal(saved.folderPath, out.recording.folderPath);
    for (const text of [saved.events, saved.har]) {
      assert.ok(!text.includes("hunter2") && !text.includes(VAULT_VALUE) && !text.includes("abc.def.ghi"), "nothing secret reaches disk");
    }
    assert.ok(saved.events.endsWith("\n"));
    assert.deepEqual(h.rows("SELECT caption, by_who, tool FROM computers_timeline ORDER BY idx").at(-1), { caption: "You recorded 4 minutes", by_who: "person", tool: "record" });
    assert.deepEqual(h.named("computer.recording_saved").map((e) => e.payload), [{ computerId: id, recordingId: started.recordingId, durationMs: 4 * MIN }]);
    assert.equal(h.rows("SELECT recording_id FROM computers_computers")[0]?.["recording_id"], null);
    await assert.rejects(() => recordStop(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
    assert.deepEqual(assertEventsConform(h), []);
  } finally {
    bindKit(null);
  }
});

test("only the person at the controls, or a manager, stops the recording", async () => {
  const h = harness();
  const id = await takenOver(h);
  await recordStart(h.ctx, { computerId: id });
  const omar = asPerson(h, { kind: "person", id: OMAR }, { manager: false });
  await assert.rejects(() => recordStop(omar.ctx, { computerId: id }), (e) => codeOf(e) === "permission.no_grant");
  const boss = asPerson(h, { kind: "person", id: "usr_boss" });
  assert.equal((await recordStop(boss.ctx, { computerId: id })).recording.state, "saved");
});

test("giving the controls back stops a recording that is still running and keeps it", async () => {
  const h = harness();
  const id = await takenOver(h);
  const rec = await recordStart(h.ctx, { computerId: id });
  h.advance(2 * MIN);
  await giveBack(h.ctx, { computerId: id });
  assert.equal(h.rows("SELECT state FROM computers_recordings WHERE recording_id = ?", rec.recordingId)[0]?.["state"], "saved");
  assert.equal(h.fake.computers.get(id)!.saved.length, 1);
  assert.equal(h.rows("SELECT recording_id FROM computers_computers")[0]?.["recording_id"], null);
  assert.equal(h.named("computer.recording_saved").length, 1);
});

test("what to do with a recording becomes one task for the agent, naming the folder and each wish", async () => {
  const h = harness();
  const id = await takenOver(h);
  const rec = await recordStart(h.ctx, { computerId: id });
  await assert.rejects(() => recordingProcess(h.ctx, { recordingId: rec.recordingId, intents: ["make_skill"], idempotencyKey: "p0" }), (e) => codeOf(e) === "validation.bad_input");
  await recordStop(h.ctx, { computerId: id });
  const out = await recordingProcess(h.ctx, { recordingId: rec.recordingId, intents: ["make_skill", "work_out_backend_calls", "make_skill"], idempotencyKey: "p1" });
  assert.equal(out.taskId, "tsk_cmp1");
  assert.deepEqual(contractErrors("computers.recording.process", "out", out), []);
  const task = h.calls("tasks.create")[0]!.input;
  assert.deepEqual(task["assigned"], { id: INTAKE, kind: "agent" });
  assert.equal(task["idempotencyKey"], "p1");
  assert.equal(task["title"], "Learn from a recording");
  assert.match(String(task["summary"]), new RegExp(`work/recordings/${rec.recordingId}/events.jsonl`));
  assert.match(String(task["summary"]), /Make a skill from it\./);
  assert.match(String(task["summary"]), /site recipe note/);
  const row = h.rows("SELECT state, intents, task_id FROM computers_recordings")[0]!;
  assert.deepEqual([row["state"], row["intents"], row["task_id"]], ["processed", JSON.stringify(["make_skill", "work_out_backend_calls"]), "tsk_cmp1"]);
  assert.deepEqual(h.named("computer.recording_processed")[0]?.payload, { recordingId: rec.recordingId, intents: ["make_skill", "work_out_backend_calls"], taskId: "tsk_cmp1" });
  const single = await recordingProcess(h.ctx, { recordingId: rec.recordingId, intents: ["learn_routine"], idempotencyKey: "p2" });
  assert.equal(h.calls("tasks.create")[1]!.input["title"], "Learn a routine from a recording");
  assert.equal(single.taskId, "tsk_cmp2");
  assert.deepEqual(assertEventsConform(h), []);
});

test("a task module that is down changes nothing", async () => {
  const h = harness({ respond: { "tasks.create": () => { throw new Error("tasks is down"); } } });
  const id = await takenOver(h);
  const rec = await recordStart(h.ctx, { computerId: id });
  await recordStop(h.ctx, { computerId: id });
  await assert.rejects(() => recordingProcess(h.ctx, { recordingId: rec.recordingId, intents: ["make_skill"], idempotencyKey: "p" }), (e) => codeOf(e) === "internal.unexpected");
  assert.equal(h.rows("SELECT state FROM computers_recordings")[0]?.["state"], "saved");
  assert.equal(h.named("computer.recording_processed").length, 0);
});

test("recordings are listed, opened with their paths, deleted, and follow the agent folder's access", async () => {
  const h = harness();
  const id = await takenOver(h);
  const a = await recordStart(h.ctx, { computerId: id });
  await recordStop(h.ctx, { computerId: id });
  h.advance(MIN);
  const b = await recordStart(h.ctx, { computerId: id });
  const list = await recordingsList(h.ctx, { computerId: id });
  assert.deepEqual(list.recordings.map((r) => [r.recordingId, r.state]), [[b.recordingId, "recording"], [a.recordingId, "saved"]]);
  assert.deepEqual(contractErrors("computers.recordings.list", "out", list), []);
  const got = await recordingGet(h.ctx, { recordingId: a.recordingId });
  assert.deepEqual([got.eventsPath, got.harPath, got.videoPath], [`work/recordings/${a.recordingId}/events.jsonl`, `work/recordings/${a.recordingId}/network.har`, `work/recordings/${a.recordingId}/video.mp4`]);
  assert.deepEqual(contractErrors("computers.recording.get", "out", got), []);
  await assert.rejects(() => recordingGet(h.ctx, { recordingId: "rcd_none" }), (e) => codeOf(e) === "validation.bad_input");
  h.deny("folder:fld_intake");
  await assert.rejects(() => recordingsList(h.ctx, { computerId: id }), (e) => codeOf(e) === "permission.no_grant");
  await assert.rejects(() => recordingGet(h.ctx, { recordingId: a.recordingId }), (e) => codeOf(e) === "permission.no_grant");
  const open = harness({ raw: h.raw, clock: h.clock, fake: h.fake });
  await assert.rejects(() => recordingDelete(open.ctx, { recordingId: b.recordingId }), (e) => codeOf(e) === "validation.bad_input");
  assert.deepEqual(await recordingDelete(open.ctx, { recordingId: a.recordingId }), { deleted: true });
  assert.equal(h.fake.named("removeRecording").length, 1);
  assert.deepEqual(await recordingDelete(open.ctx, { recordingId: a.recordingId }), { deleted: false });
});

test("a screenshot is stored in the agent's folder and remembered as the last frame; a sleeping computer gives none", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  await assert.rejects(() => screenshot(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
  await wake(h.ctx, { computerId: id });
  const out = await screenshot(h.ctx, { computerId: id });
  assert.deepEqual([out.fileId, out.width, out.height, out.at], ["fil_shot1", 1280, 800, NOW]);
  assert.deepEqual(contractErrors("computers.screenshot", "out", out), []);
  const call = h.calls("files.create")[0]!.input as { folderId: string; mime: string; kind: string; name: string; content: { base64: string } };
  assert.equal(call.folderId, "fld_intake");
  assert.equal(call.mime, "image/png");
  assert.equal(call.kind, "image");
  assert.match(call.name, /^screenshot-.*\.png$/);
  assert.equal(call.content.base64, btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4)));
  assert.equal(h.rows("SELECT last_frame_file FROM computers_computers")[0]?.["last_frame_file"], "fil_shot1");
  const nofolder = harness({ raw: h.raw, clock: h.clock, fake: h.fake, respond: { "agents.get": () => { throw new Error("gone"); } } });
  await assert.rejects(() => screenshot(nofolder.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
});

test("the live view source comes with a one-use ticket, and only for a computer that is awake", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  await assert.rejects(() => stream(h.ctx, { computerId: id }), (e) => codeOf(e) === "validation.bad_input");
  await wake(h.ctx, { computerId: id });
  const out = await stream(h.ctx, { computerId: id });
  assert.equal(out.transport, "mjpeg");
  assert.equal(out.url, `/computers/${id}/stream?ticket=${out.ticket}`);
  assert.equal(out.expiresAt, NOW + 60_000);
  assert.deepEqual(contractErrors("computers.stream", "out", out), []);
  assert.deepEqual(await redeemTicket(h.db, out.ticket, NOW), { kind: "stream", computerId: id, personId: DANA });
  assert.equal(await redeemTicket(h.db, out.ticket, NOW), null);
  assert.equal(h.rows("SELECT ticket_hash FROM computers_tickets").every((r) => !String(r["ticket_hash"]).startsWith("cpt_")), true, "only a hash is kept");
});

test("the timeline lists a frame per step in order, filters by run and thread, pages, and opens one step", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  const s0 = addStep(h.db, id, NOW, { by: "agent", caption: "Opened the portal", tool: "chrome_open", runId: "run_a", threadId: "thr_a", frameFileId: "fil_f0" });
  const s1 = addStep(h.db, id, NOW + 1000, { by: "agent", caption: "Filled the form", tool: "chrome_fill", runId: "run_a", threadId: "thr_a" });
  addStep(h.db, id, NOW + 2000, { by: "agent", caption: "Sent the report", tool: "chrome_send", runId: "run_b", threadId: "thr_b" });
  const all = await timeline(h.ctx, { computerId: id });
  assert.deepEqual(all.steps.map((s) => s.idx), [0, 1, 2]);
  assert.equal(all.steps[0]?.frameFileId, "fil_f0");
  assert.equal(all.steps[1]?.frameFileId, undefined);
  assert.deepEqual(contractErrors("computers.timeline", "out", all), []);
  assert.deepEqual((await timeline(h.ctx, { computerId: id, runId: "run_a" })).steps.map((s) => s.caption), ["Opened the portal", "Filled the form"]);
  assert.deepEqual((await timeline(h.ctx, { computerId: id, threadId: "thr_b" })).steps.map((s) => s.caption), ["Sent the report"]);
  const page = await timeline(h.ctx, { computerId: id, limit: 2 });
  assert.equal(page.steps.length, 2);
  assert.equal((await timeline(h.ctx, { computerId: id, limit: 2, cursor: page.next as string })).steps.length, 1);
  const one = await timelineStep(h.ctx, { computerId: id, stepId: s1.stepId });
  assert.equal(one.step.caption, "Filled the form");
  assert.deepEqual(contractErrors("computers.timeline_step", "out", one), []);
  await assert.rejects(() => timelineStep(h.ctx, { computerId: id, stepId: "stp_none" }), (e) => codeOf(e) === "validation.not_found");
  assert.equal(s0.idx, 0);
});

test("a skill from a step starts one task for the agent with what happened up to there, and says so", async () => {
  const h = harness();
  const id = (await provision(h.ctx, { agentId: INTAKE, idempotencyKey: "k" })).computer.computerId;
  addStep(h.db, id, NOW, { by: "agent", caption: "Opened the portal", tool: "chrome_open" });
  const s1 = addStep(h.db, id, NOW + 1000, { by: "agent", caption: "Filled the form", tool: "chrome_fill", frameFileId: "fil_f1" });
  addStep(h.db, id, NOW + 2000, { by: "agent", caption: "Sent the report", tool: "chrome_send" });
  const out = await skillFromStep(h.ctx, { computerId: id, stepId: s1.stepId, name: "File the portal form", idempotencyKey: "s1" });
  assert.equal(out.taskId, "tsk_cmp1");
  assert.deepEqual(contractErrors("computers.skill_from_step", "out", out), []);
  const task = h.calls("tasks.create")[0]!.input;
  assert.equal(task["title"], "Make a skill: File the portal form");
  assert.deepEqual(task["fileIds"], ["fil_f1"]);
  assert.match(String(task["summary"]), /1\. Opened the portal\n2\. Filled the form/);
  assert.ok(!String(task["summary"]).includes("Sent the report"), "only up to the chosen step");
  assert.deepEqual(h.named("computer.skill_requested")[0]?.payload, { computerId: id, stepId: s1.stepId, taskId: "tsk_cmp1" });
  await assert.rejects(() => skillFromStep(h.ctx, { computerId: id, stepId: "stp_none", idempotencyKey: "s2" }), (e) => codeOf(e) === "validation.not_found");
});
