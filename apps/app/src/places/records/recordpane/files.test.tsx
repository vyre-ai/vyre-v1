// The page's Attach asks the Space for the record's files folder (the one every path files into) and stores the files there.
import test from "node:test";
import assert from "node:assert/strict";
import { attachToRecord, findRecordFolder } from "./files.ts";

const file = (name: string): { name: string; mime: string; file: { arrayBuffer(): Promise<ArrayBuffer> } } => ({ name, mime: "application/pdf", file: { arrayBuffer: async () => new ArrayBuffer(3) } });

test("looking for the folder never makes one; attaching asks for it to be made and stores in it", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "projects.files_folder") return { folderId: (input as { create?: boolean }).create === false ? null : "fld_rec" };
    if (cap === "files.create") return { file: { fileId: "fil_1" } };
    throw new Error(`unexpected ${cap}`);
  };
  assert.equal(await findRecordFolder(call, "contact", "rec_1"), null);
  assert.deepEqual(calls[0]!.input, { type: "contact", recordId: "rec_1", create: false });
  const folder = await attachToRecord(call, undefined, [file("Retainer.pdf")], { type: "contact", recordId: "rec_1" }, "k");
  assert.equal(folder, "fld_rec");
  const made = calls.find((c) => c.cap === "files.create")!.input;
  assert.equal(made["folderId"], "fld_rec");
  assert.equal(made["name"], "Retainer.pdf");
  assert.equal(calls.filter((c) => c.cap === "files.create").length, 1, "one copy, in the record's folder");
});
