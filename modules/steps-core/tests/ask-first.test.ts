// Which outward steps wait for a yes (rc.41). A signature request asks unless its author turned asking off; an email goes out on its author's standing yes unless the step says to ask; and a chat post
// set to ask really asks, though the capability it calls has no Gate of its own. In testing a `sign` step run as the owner made envelopes without anyone being asked: these are the tests that were red.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, MiniRun } from "../fixtures/db.ts";
import { node } from "../fixtures/seed.ts";

const RUN = { id: "run_t1", label: "Agreement", automation: "aut_1", defHash: "h1" };
const held = (taskId: string): never => {
  throw { error: { code: "permission.needs_approval", message: "held", retryable: false, details: { taskId } } };
};
const signNode = (over: Record<string, unknown> = {}) =>
  node("sg", "sign", { fileId: "fil_agreement", signers: [{ name: "Andrea Lindahl", email: "andrea@northwind.example" }] }, over);

test("a signature request asks first when the step does not say: the Gate is told to ask, and never told to hold only on an admin rule", async () => {
  const h = harness({}, { run: RUN });
  h.callee("esign.send", () => ({ envelopeId: "env_1" }));
  await new MiniRun(h, [signNode()]).run();
  const sent = h.only("esign.send")[0]!;
  assert.equal(sent.opts?.step?.ask, true, "the step asks");
  assert.equal(sent.opts?.gate, undefined, "not admin_only: the Gate holds it every time");
});

test("a signature request whose author turned asking off goes out on their standing yes, and one set to ask asks", async () => {
  const off = harness({}, { run: RUN });
  off.callee("esign.send", () => ({ envelopeId: "env_1" }));
  await new MiniRun(off, [signNode({ askBeforeSending: false })]).run();
  assert.equal(off.only("esign.send")[0]!.opts?.step?.ask, undefined);
  assert.equal(off.only("esign.send")[0]!.opts?.gate, "admin_only");
  const on = harness({}, { run: RUN });
  on.callee("esign.send", () => ({ envelopeId: "env_1" }));
  await new MiniRun(on, [signNode({ askBeforeSending: true })]).run();
  assert.equal(on.only("esign.send")[0]!.opts?.step?.ask, true);
});

test("a held signature request parks the Run on the Gate's task and makes no envelope", async () => {
  const h = harness({}, { run: RUN });
  h.callee("esign.send", () => held("tsk_sign"));
  const run = await new MiniRun(h, [signNode(), node("after", "stop", {})]).run();
  assert.equal(run.state, "waiting");
  assert.equal(run.wait?.taskId, "tsk_sign");
  assert.deepEqual(run.trail, []);
});

test("an email keeps its rule: it goes out on the standing yes unless the step says to ask", async () => {
  const mail = (over: Record<string, unknown> = {}) =>
    node("m", "send_email", { to: "andrea@northwind.example", subject: "Hello", body: "Hi", mailboxId: "mbx_1" }, over);
  const plain = harness({}, { run: RUN });
  plain.callee("mail.send", () => ({ messageId: "msg_1" }));
  await new MiniRun(plain, [mail()]).run();
  assert.equal(plain.only("mail.send")[0]!.opts?.gate, "admin_only");
  assert.equal(plain.only("mail.send")[0]!.opts?.step?.ask, undefined);
  const asking = harness({}, { run: RUN });
  asking.callee("mail.send", () => ({ messageId: "msg_1" }));
  await new MiniRun(asking, [mail({ askBeforeSending: true })]).run();
  assert.equal(asking.only("mail.send")[0]!.opts?.gate, undefined);
  assert.equal(asking.only("mail.send")[0]!.opts?.step?.ask, true);
});

test("a chat post set to ask really asks: the Gate is asked first, a hold parks the Run and nothing is posted", async () => {
  const post = (over: Record<string, unknown> = {}) => node("p", "post_message", { channelId: "chn_ops", text: "Signed: Brightpath" }, over);
  const h = harness({}, { run: RUN });
  h.callee("channels.get", () => ({ channel: { mainThreadId: "thr_ops" } }));
  h.callee("automations.step_ask", () => held("tsk_post"));
  h.callee("chat.post", () => ({ messageId: "msg_1" }));
  const run = await new MiniRun(h, [post({ askBeforeSending: true })]).run();
  assert.equal(run.state, "waiting");
  assert.equal(run.wait?.taskId, "tsk_post");
  assert.equal(h.only("chat.post").length, 0, "nothing was posted while it waits");
  const asked = h.only("automations.step_ask")[0]!;
  assert.equal(asked.opts?.step?.ask, true);
  assert.equal(asked.input.text, "Signed: Brightpath");
  assert.equal(asked.input.threadId, "thr_ops", "the person approving sees where it would be posted");
  assert.equal(asked.input.idempotencyKey, "run_t1:p:1:ask", "the same ask on a retry of the same attempt");
});

test("a chat post that was approved, and one that never asked, are posted", async () => {
  const post = (over: Record<string, unknown> = {}) => node("p", "post_message", { channelId: "chn_ops", text: "Signed" }, over);
  const yes = harness({}, { run: RUN });
  yes.callee("channels.get", () => ({ channel: { mainThreadId: "thr_ops" } }));
  yes.callee("automations.step_ask", () => ({ ok: true }));
  yes.callee("chat.post", () => ({ messageId: "msg_1" }));
  const a = await new MiniRun(yes, [post({ askBeforeSending: true })]).run();
  assert.equal(a.state, "succeeded");
  assert.equal(yes.only("chat.post").length, 1);
  const plain = harness({}, { run: RUN });
  plain.callee("channels.get", () => ({ channel: { mainThreadId: "thr_ops" } }));
  plain.callee("chat.post", () => ({ messageId: "msg_1" }));
  const b = await new MiniRun(plain, [post()]).run();
  assert.equal(b.state, "succeeded");
  assert.equal(plain.only("automations.step_ask").length, 0, "a post that does not ask is not asked about");
});
