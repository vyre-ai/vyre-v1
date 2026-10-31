// Dragging a mounted folder or file from Files onto a chat shares it with the chat's agents, and Undo takes it back (rc.8 live folders).
import test from "node:test";
import assert from "node:assert/strict";
import { droppedOf, sharedLine, shareWithAgents, undoShare } from "./dropshare.ts";

test("a Files drag is read, anything else is not", () => {
  assert.deepEqual(droppedOf("file:fil_1,folder:fld_2"), [{ type: "file", id: "fil_1" }, { type: "folder", id: "fld_2" }]);
  assert.deepEqual(droppedOf("just some text"), []);
  assert.deepEqual(droppedOf(""), []);
});

test("each thing is shared with each agent at View, the grants come back for Undo, and the line names them", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  let n = 0;
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "files.get") return { file: { name: "Q4 pricing.docx" } };
    if (cap === "files.folder.get") return { folder: { name: "Sales" } };
    if (cap === "access.share") return { grant: { id: `gnt_${++n}` } };
    return {};
  };
  const done = await shareWithAgents({ call } as never, [{ type: "file", id: "fil_1" }, { type: "folder", id: "fld_2" }], [{ id: "agt_a", name: "Intake" }, { id: "agt_b", name: "Docs" }], "k1");
  const shares = calls.filter((c) => c.cap === "access.share");
  assert.equal(shares.length, 4);
  assert.ok(shares.every((s) => s.input["level"] === "view" && (s.input["subject"] as { kind: string }).kind === "agent"));
  assert.equal(new Set(shares.map((s) => s.input["idempotencyKey"])).size, 4, "a retry shares once");
  assert.equal(sharedLine(done), "Shared Q4 pricing.docx and Sales with Intake and Docs.");
  await undoShare({ call } as never, done.grants);
  assert.deepEqual(calls.filter((c) => c.cap === "access.unshare").map((c) => c.input["grantId"]), ["gnt_1", "gnt_2", "gnt_3", "gnt_4"]);
});
