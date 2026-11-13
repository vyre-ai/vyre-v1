// The command bar shows each thing once and never an id (owner, 13 Nov 2026). He typed "launch" and saw "Book the launch venue" under Chats and again under Tasks, "Spring launch" under Channels and Records,
// and a project whose line under the name was the record's raw fields ("fld_..., usr_..."). Each case is a row set like the one he saw.
import test from "node:test";
import assert from "node:assert/strict";
import type { Hit } from "./model.ts";
import { groupRows, mergeHits } from "./model.ts";
import { linkedTo, replicaHits } from "./gate.ts";
import { rawIdsIn } from "../../../../../lib/id-shapes.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";

const hit = (kind: Hit["kind"], id: string, title: string, o: Partial<Hit> = {}): Hit => ({ kind, id, title, link: `vyre://${kind}/${id}`, score: 1, ...o }) as Hit;
const shown = (hits: readonly Hit[]): Hit[] => groupRows(hits, 50).flatMap((r) => (r.type === "hit" ? [r.hit] : []));
const labels = (hits: readonly Hit[]): string[] => hits.map((h) => `${h.kind}:${h.title}`);

test("a task and a chat or record that only share its name are separate rows: nothing is dropped by title across kinds", () => {
  const rows = shown([hit("chat", "thr_aaaaaaaa01", "Book the launch venue"), hit("task", "tsk_bbbbbbbb01", "Book the launch venue"), hit("record", "rec_cccccccc01", "Book the launch venue", { recordType: "task" })]);
  assert.deepEqual(labels(rows).sort(), ["chat:Book the launch venue", "record:Book the launch venue", "task:Book the launch venue"]);
});

test("a project's own channel (linked by id) is one row with the project; a channel that only shares the name stays", () => {
  const linked = { ...hit("channel", "chn_dddddddd01", "Spring launch"), of: "record:rec_eeeeeeee01" } as Hit;
  const rows = shown([linked, hit("record", "rec_eeeeeeee01", "Spring launch", { recordType: "project" }), hit("channel", "chn_dddddddd02", "Spring launch"), hit("channel", "chn_dddddddd03", "launch-week")]);
  assert.deepEqual(labels(rows).sort(), ["channel:Spring launch", "channel:launch-week", "record:Spring launch"].sort(), "the linked channel went; the same-named unlinked one and the other channel stayed");
  assert.equal(rows.filter((h) => h.id === "chn_dddddddd01").length, 0);
});

test("linkedTo marks a channel with the record it belongs to, from the sidebar's channel list, and only that one", () => {
  const rt2 = { screens: { query: () => ({ getSnapshot: () => ({ status: "ready", data: { channels: [{ channelId: "chn_dddddddd01", mainThreadId: "thr_main01", recordId: "rec_eeeeeeee01" }, { channelId: "chn_dddddddd02", mainThreadId: "thr_main02" }] } }) }) } } as unknown as ShellRuntime;
  const out = linkedTo(rt2, [hit("channel", "chn_dddddddd01", "Spring launch"), hit("channel", "thr_main01", "Spring launch"), hit("channel", "chn_dddddddd02", "Spring launch")]) as (Hit & { of?: string })[];
  assert.deepEqual(out.map((h) => h.of), ["record:rec_eeeeeeee01", "record:rec_eeeeeeee01", undefined]);
});

test("a record's raw fields are never its snippet, and a title that is an id reads Untitled", () => {
  const rows = shown([hit("record", "rec_eeeeeeee02", "Spring launch", { recordType: "project", snippet: "…0d3e09cade33 fld_01a1d27b165742ddb20032cbd182aaf9 [Launch] on usr_5b6f9d9e0e318704d0 usr_8923b33eafc2cebd5c" }), hit("record", "rec_eeeeeeee03", "rec_01a1d27b165742ddb20032cbd182aaf9")]);
  assert.equal(rows[0]!.snippet, "…0d3e09cade33 Launch on");
  assert.equal(rows[1]!.title, "Untitled");
  for (const h of rows) assert.deepEqual(rawIdsIn(`${h.title} ${h.snippet ?? ""}`), [], h.title);
  assert.equal(shown([hit("record", "rec_eeeeeeee04", "Plan", { snippet: "fld_01a1d27b165742ddb20032cbd182aaf9 usr_5b6f9d9e0e318704d0" })])[0]!.snippet, undefined, "a snippet that was only ids is no snippet");
});

test("every id appears once in what a search shows, whatever merged in from the device and the server", () => {
  const device = [hit("chat", "thr_aaaaaaaa03", "Launch plan"), hit("channel", "chn_dddddddd03", "launch-week")];
  const server = [hit("chat", "thr_aaaaaaaa03", "Launch plan", { snippet: "the [launch] plan" }), hit("channel", "chn_dddddddd03", "launch-week"), hit("task", "tsk_bbbbbbbb03", "Launch plan"), hit("task", "tsk_bbbbbbbb03", "Launch plan")];
  const rows = shown(mergeHits(device, server));
  const ids = rows.map((h) => `${h.kind}:${h.id}`);
  assert.deepEqual(ids, [...new Set(ids)], "no id twice");
  assert.deepEqual(labels(rows).sort(), ["channel:launch-week", "chat:Launch plan", "task:Launch plan"], "each id once; a chat and a task that share a name are two things");
});

const rt = (recent: unknown): ShellRuntime => ({
  principals: { getSnapshot: () => ({ status: "ready", data: [] }) },
  screens: { query: () => ({ getSnapshot: () => ({ status: "ready", data: recent }) }) },
}) as unknown as ShellRuntime;

test("the device lists only chats and channels as chats: an Ask pane opened on a task or a project is not one", () => {
  const item = (kind: string, id: string, title: string) => ({ threadId: id, kind, title });
  const hits = replicaHits(rt({ today: [item("chat", "thr_1", "Launch plan"), item("ask", "thr_2", "Book the launch venue"), item("channel", "chn_1", "launch-week"), item("run", "thr_3", "Run 4")] }));
  assert.deepEqual(labels(hits), ["chat:Launch plan", "channel:launch-week"]);
});
