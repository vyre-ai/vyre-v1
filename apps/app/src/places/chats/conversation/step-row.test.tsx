// The work line under a finished reply (owner, 16 Nov): how long and how many steps, it opens to the steps, each step opens to what it did, and nothing in it is an id.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { rawIdsIn } from "../../../../../../lib/id-shapes.ts";
import { forgetReplyDetails } from "../details/read.ts";
import { StepRow } from "./step-row.tsx";
import { stepDid, workOf } from "./model.ts";
import type { Message } from "./model.ts";

installDom();

const ID = "fil_0123456789abcdef0123456789abcdef";
const block = (type: string, id: string, data: Record<string, unknown>) => ({
  type,
  v: 1,
  id,
  data,
  state: "done",
  traceId: "t",
});
const reply = (): Message =>
  ({
    messageId: "m1",
    threadId: "t1",
    threadSeq: 2,
    author: { kind: "agent", id: "agt_1" },
    kind: "agent",
    body: "Done.",
    blocks: [
      block("tool_call", "b1", { id: "c1", name: "Read", detail: `${ID} intake.docx` }),
      block("tool_result", "b2", { id: "c1", ok: true, secs: 2 }),
      block("tool_call", "b3", { id: "c2", name: "Bash", detail: "npm test" }),
      block("tool_result", "b4", { id: "c2", ok: false, secs: 70, turnSecs: 95 }),
    ],
    depth: 0,
    attachments: [],
    reactions: [],
    pinned: false,
    createdAt: 1,
  }) as unknown as Message;

test("the work line says how long and how many steps; no step title is an id", () => {
  const w = workOf(reply())!;
  assert.equal(w.summary, "Worked 1m · 2 steps");
  for (const l of w.steps) assert.deepEqual(rawIdsIn(`${l.title} ${l.sub}`), [], l.title);
  assert.deepEqual(
    w.steps.map((l) => [l.tool, l.ok, l.secs]),
    [
      [0, true, 2],
      [1, false, 70],
    ],
  );
});

test("what a step did: what it touched without ids, how it ended, how long", () => {
  const [a, b] = workOf(reply())!.steps;
  assert.equal(stepDid(a!), "Done in 2s.");
  assert.equal(stepDid(a!, { args: `${ID} intake.docx`, ok: true, durationMs: 2400 }), "intake.docx. Done in 2s.");
  assert.equal(stepDid(b!, { args: "npm test", ok: false }), "npm test. It did not work.");
  assert.equal(stepDid({ ...a!, state: "live", ok: undefined as unknown as boolean }), "Still running.");
});

test("a step opens to what it did, read from the host's note of the call, and no id shows", async () => {
  forgetReplyDetails();
  const asked: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    asked.push(cap);
    if (cap === "chat.reply_details")
      return {
        details: {
          messageId: "m1",
          threadId: "t1",
          agentId: "agt_1",
          at: 1,
          steps: [],
          turn: {
            timing: { startedAt: 1, endedAt: 3 },
            tools: [{ name: "Read", args: `${ID} intake.docx`, ok: true, durationMs: 2400 }],
          },
        },
      };
    return { accounts: [] };
  };
  const line = workOf(reply())!.steps[0]!;
  const root = await mount(createRoot, <StepRow line={line} threadId="t1" messageId="m1" call={call as never} />);
  await flush();
  assert.equal(find(root, `step-did-${line.id}`), null, "closed: only the step's words");
  await press(find(root, `step-${line.id}`)!.children?.[0] ?? find(root, `step-${line.id}`));
  // wait for the state, then assert it
  for (let i = 0; i < 50 && !textOf(find(root, `step-did-${line.id}`)).startsWith("intake"); i++) await flush();
  const said = textOf(find(root, `step-did-${line.id}`));
  assert.equal(said, "intake.docx. Done in 2s.");
  assert.deepEqual(rawIdsIn(textOf(root)), []);
  assert.ok(asked.includes("chat.reply_details"));
});

test("a failed reply's row can be dismissed from its menu: it leaves the screen", async () => {
  const { ErrorRowView } = await import("./MessageView.tsx");
  const { statusView } = await import("./status.ts");
  const v = statusView(
    {
      id: "b1",
      type: "turn_status",
      v: 1,
      traceId: "trc_9f3a21",
      data: { state: "failed", turnId: "trn_1", code: "engine_error" },
    } as never,
    { admin: true },
  );
  assert.equal(v.kind, "error");
  const stub = {
    showMenu: () => undefined,
    copy: () => undefined,
    retryTurn: () => undefined,
    errorNext: () => undefined,
  };
  const root = await mount(
    createRoot,
    <ErrorRowView block={(v.kind === "error" ? v.block : null) as never} actions={stub as never} />,
  );
  await flush();
  assert.ok(find(root, "err-more"), "the row is there");
  await press(find(root, "err-more"));
  await flush();
  await press(find(root, "menu-item-Dismiss"));
  await flush();
  assert.equal(find(root, "err-more"), null, "dismissed: the row is gone");
  assert.ok(find(root, "err-dismissed"));
});

test("a thread that reached a decision says so under its parent message (G55)", async () => {
  const { decisionOf } = await import("./model.ts");
  const { ThreadParent } = await import("./ThreadParent.tsx");
  const note = (id: string, lead: string, title: string): Message =>
    ({
      ...reply(),
      messageId: id,
      blocks: [
        { type: "link_card", v: 1, id: `b-${id}`, data: { lead, title, style: "noted" }, state: "done", traceId: "t" },
      ],
    }) as unknown as Message;
  assert.equal(decisionOf([reply()]), null, "no decision yet");
  assert.equal(
    decisionOf([note("a", "Noted: decision", "Go with Harbor"), note("b", "Noted: fact", "Rent is due Friday")]),
    "Go with Harbor",
    "only a decision, never another kind of note",
  );
  assert.equal(
    decisionOf([note("a", "Noted: decision", "Go with Harbor"), note("b", "Noted: decision", `Go with Fenwick ${ID}`)]),
    "Go with Fenwick",
    "the newest, with no id in it",
  );
  const call = async (): Promise<unknown> => ({
    message: { author: { id: "usr_a" }, body: "Which vendor?", createdAt: 1 },
  });
  const root = await mount(
    createRoot,
    <ThreadParent threadId="thr_1" messageId="m1" call={call} nameOf={() => "Sara"} decided="Go with Harbor" />,
  );
  for (let i = 0; i < 50 && find(root, "thread-parent") === null; i++) await flush();
  assert.equal(textOf(find(root, "thread-decided")), "Decided · Go with Harbor");
});
