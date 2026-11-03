// The turn line for files a terminal agent deleted in goal/ (modules/engine/goal-folder.ts): the files are in Vyre's Trash, and Undo brings each one back.
import test from "node:test";
import assert from "node:assert/strict";
import { statusView } from "./status.ts";
import { errorAction } from "./actions.ts";
import type { ConversationData } from "./data.tsx";

test("the trashed line reads as a quiet line with Undo, and Undo restores each file", async () => {
  const view = statusView({ type: "turn_status", v: 1, id: "b1", data: { state: "trashed", text: "Moved 2 files deleted in goal/ to Vyre's Trash: a.md, b.md.", fileIds: ["fil_a", "fil_b"] } } as never);
  assert.deepEqual(view, { kind: "wait", id: "b1", text: "Moved 2 files deleted in goal/ to Vyre's Trash: a.md, b.md.", action: { key: "undo_trash:fil_a,fil_b", label: "Undo" } });
  const calls: Array<{ cap: string; input: unknown }> = [];
  const said: string[] = [];
  const data = { call: async (cap: string, input: unknown) => { calls.push({ cap, input }); if ((input as { fileId: string }).fileId === "fil_b") throw new Error("gone"); return {}; } } as unknown as ConversationData;
  if (view.kind !== "wait") throw new Error("not a wait line");
  await errorAction(data, view.action.key, undefined, (t) => said.push(t));
  assert.deepEqual(calls.map((c) => [c.cap, (c.input as { fileId: string }).fileId]), [["files.restore", "fil_a"], ["files.restore", "fil_b"]]);
  assert.deepEqual(said, ["Brought back the file from Trash."]);
});

test("a line the engine says as the agent has no hover card; a reply a turn made keeps its card", async () => {
  const { isSystemLine } = await import("./status.ts");
  const line = (state: string) => ({ body: "", blocks: [{ type: "turn_status", v: 1, id: "b", data: { state, text: "Ran on Deepseek V4.1 Flash; Claude isn't on the team key." } }] }) as never;
  assert.equal(isSystemLine(line("note")), true, "the model swap line (the owner's rc.20 'Not recorded for this reply')");
  assert.equal(isSystemLine(line("trashed")), true);
  assert.equal(isSystemLine(line("failed")), false, "a failed turn has its turn");
  assert.equal(isSystemLine({ body: "Hello.", blocks: [] } as never), false);
  assert.equal(isSystemLine({ body: "Hello.", blocks: line("note").blocks } as never), false, "words of its own: a reply");
});
