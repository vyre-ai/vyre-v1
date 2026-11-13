// The command bar shows each thing once and never an id (owner, 13 Nov 2026). He typed "launch" and saw "Book the launch venue" under Chats and again under Tasks, "Spring launch" under Channels and Records,
// and a project whose line under the name was the record's raw fields ("fld_..., usr_..."). Each case is a row set like the one he saw.
import test from "node:test";
import assert from "node:assert/strict";
import type { Hit } from "./model.ts";
import { groupRows, mergeHits } from "./model.ts";
import { replicaHits } from "./gate.ts";
import { rawIdsIn } from "../../../../../lib/id-shapes.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";

const hit = (kind: Hit["kind"], id: string, title: string, o: Partial<Hit> = {}): Hit => ({ kind, id, title, link: `vyre://${kind}/${id}`, score: 1, ...o }) as Hit;
const shown = (hits: readonly Hit[]): Hit[] => groupRows(hits, 50).flatMap((r) => (r.type === "hit" ? [r.hit] : []));
const labels = (hits: readonly Hit[]): string[] => hits.map((h) => `${h.kind}:${h.title}`);

test("a task found as a chat and as a task is one row, the task", () => {
  const rows = shown([hit("chat", "thr_aaaaaaaa01", "Book the launch venue"), hit("task", "tsk_bbbbbbbb01", "Book the launch venue"), hit("chat", "thr_aaaaaaaa02", "Launch retro")]);
  assert.deepEqual(labels(rows), ["chat:Launch retro", "task:Book the launch venue"]);
});

test("a task found as a task and as its record is one row, the task", () => {
  const rows = shown([hit("record", "rec_cccccccc01", "Write the launch announcement", { recordType: "task" }), hit("task", "tsk_bbbbbbbb02", "Write the launch announcement", { snippet: "Draft by Friday" })]);
  assert.deepEqual(labels(rows), ["task:Write the launch announcement"]);
  assert.equal(rows[0]!.snippet, "Draft by Friday");
});

test("a project and its own channel are one row, the project; a channel of another name stays", () => {
  const rows = shown([hit("channel", "chn_dddddddd01", "Spring launch"), hit("record", "rec_eeeeeeee01", "Spring launch", { recordType: "project" }), hit("channel", "chn_dddddddd02", "launch-week")]);
  assert.deepEqual(labels(rows), ["channel:launch-week", "record:Spring launch"]);
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
  assert.deepEqual(labels(rows), ["channel:launch-week", "task:Launch plan"]);
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
