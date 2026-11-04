// A task assigned to a person that their Assistant is doing for them (lane l-chrome2a): the row says "Assistant is on it for you", not a bare "Working", and says whose it is to anyone else looking.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { TaskRow } from "./model.ts";
import { TaskLine } from "./parts.tsx";
import type { RowEnv } from "./parts.tsx";

const NOW = Date.UTC(2026, 10, 4, 10);
const NAMES: Record<string, string> = { usr_me: "Irfad", usr_sara: "Sara", agt_ops: "Assistant" };
const env = { now: NOW, offsetMin: 0, me: "usr_me", nameOf: (id: string) => NAMES[id] ?? id, project: () => undefined, keyOf: () => undefined, open: () => undefined, openProfile: () => undefined, status: () => undefined, menu: () => undefined, pick: () => undefined } as unknown as RowEnv;
const row = (over: Record<string, unknown> = {}): TaskRow => ({ id: "tsk_1", key: "VY-1", kind: "work", title: "Send the invoices", state: "doing", blocked: false, assigned: { kind: "person", id: "usr_me" }, labels: [], dependsOn: [], createdBy: "usr_me", createdAt: NOW, updatedAt: NOW, workingNotes: { "baton.on_it": "agt_ops" }, ...over } as unknown as TaskRow);
const html = (r: TaskRow): string => renderToStaticMarkup(<TaskLine row={r} env={env} selected={false} current={false} />);

test("the owner's own task, with the Assistant on it, reads 'Assistant is on it for you'", () => {
  assert.match(html(row()), /Assistant is on it for you/);
});

test("someone else's task says whose it is; a task nobody is on says nothing of the kind; a finished one drops the line", () => {
  assert.match(html(row({ assigned: { kind: "person", id: "usr_sara" } })), /Assistant is on it for Sara/);
  assert.doesNotMatch(html(row({ workingNotes: {} })), /is on it for/);
  assert.doesNotMatch(html(row({ state: "done" })), /is on it for/);
  assert.doesNotMatch(html(row({ state: "todo" })), /is on it for/);
});
