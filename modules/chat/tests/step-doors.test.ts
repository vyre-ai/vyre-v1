// F51, door by door, on a store written by the code before the rule: a turn of Dana's, saved with a file name, a file id and a Vault item name in its steps and its transcript, in a chat Maya also reads.
// Maya's list, message fetch, transcript read and fetch, transcript search, history search and chat search find none of it; Dana's own transcript view does not carry it either.
import test from "node:test";
import assert from "node:assert/strict";
import { handlers } from "../impl.ts";
import { DANA, INTAKE, MAYA, harness as baseHarness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { ensureTranscript } from "../handlers/g24d.ts";
import { insertMessage } from "../projections.ts";

type Fn = (ctx: Harness["ctx"], input: any) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const h = handlers as unknown as Record<string, Fn>;
const SECRETS = ["alice-private-notes.txt", "fil_private_notes_77", "Alice Bank Key"];

test("a store written by the old code is served to a second reader without the file names, ids and Vault item names, through every read door", async () => {
  const hn = baseHarness({
    calls: {
      "agents.get": (i) => ({ agent: { agentId: i["agentId"], name: "Checker", runtime: "vyre" } }),
      "access.principals.get": () => ({ principal: { name: "Someone" } }),
    },
  });
  const threadId = (await h["chat.start"]!(hn.ctx, { kind: "chat", agentIds: [INTAKE], idempotencyKey: "sd1" })).thread
    .threadId as string;
  await h["threads.members.add"]!(hn.ctx, { threadId, personId: MAYA });
  ensureTranscript(hn.ctx.db);
  // the old code's rows: each call kept with the one-line summary of what it touched
  const old = [
    {
      role: "assistant",
      kind: "tool_call",
      content: "files_read fil_private_notes_77 (alice-private-notes.txt)",
      toolName: "files_read",
      toolCallId: "t1",
    },
    {
      role: "assistant",
      kind: "tool_call",
      content: "vault_use Alice Bank Key",
      toolName: "vault_use",
      toolCallId: "t2",
    },
    { role: "assistant", kind: "text", content: "Done." },
  ];
  await h["chat.transcript.append"]!(hn.ctx, { threadId, turnId: "trn_aold", rows: old });
  // the old code's reply: the saved steps carry the file's name as a label
  insertMessage(hn.ctx, threadId, {
    author: INTAKE,
    kind: "agent",
    body: "Done.",
    blocks: [
      {
        type: "tool_call",
        v: 1,
        id: "blk_old1",
        data: { id: "x1", name: "Read", label: "alice-private-notes.txt" },
        state: "done",
        traceId: "t",
      },
    ],
    depth: 0,
    attachments: [],
    paidBy: DANA,
  } as never);
  const maya = hn.person(MAYA);
  const doors: Record<string, unknown> = {
    list: (await h["chat.messages.list"]!(maya, { threadId })).messages,
    transcriptRead: await h["chat.transcript.read"]!(maya, { threadId }),
    transcriptGet: await h["chat.transcript.get"]!(maya, { threadId, turnId: "trn_aold" }),
    historySearch: await h["chat.history.search"]!(maya, { q: "alice private notes bank key files_read" }),
    chatSearch: await h["chat.search"]!(maya, { q: "alice-private-notes" }),
    transcriptSearch: await h["chat.transcript.search"]!(maya, {
      threadId,
      q: "alice-private-notes fil_private_notes_77 Alice Bank Key",
    }).catch(() => ({})),
    danaTranscript: await h["chat.transcript.read"]!(hn.ctx, { threadId }),
  };
  for (const [door, got] of Object.entries(doors)) {
    const text = JSON.stringify(got);
    for (const s of SECRETS) assert.equal(text.includes(s), false, `${door} still carries ${s}`);
  }
  assert.match(JSON.stringify(doors["transcriptRead"]), /Reading files/, "the step is still said, in plain words");
});
