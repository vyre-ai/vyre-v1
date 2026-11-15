// A chip for a file that is not there (owner's rc.28 report, 16 Nov 2026): a file chip is drawn only for a file that exists and that this reader may open. A file that is gone, or not theirs, leaves no chip.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount } from "../../../../../../ui/src/testing/dom.ts";
import { AttachmentChips } from "./attachments.tsx";

installDom();

const row = { id: "fil_ok", name: "Ranked shortlist.md", size: 2048, mime: "text/markdown" };

test("a chip is drawn for a file that is found and none for one that is not", async () => {
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    if (cap === "files.get" && (input as { fileId: string }).fileId === "fil_ok") return { file: row };
    if (cap === "mounts.list") return { mounts: [] };
    throw new Error("not found");
  };
  const data = { call, nav: { openBeside: () => undefined }, copy: () => undefined } as never;
  const root = await mount(
    createRoot,
    <AttachmentChips ids={["fil_ok", "fil_gone"]} data={data} menu={() => undefined} />,
  );
  await flush();
  assert.ok(find(root, "attachment-fil_ok"), "the file that is there has its chip");
  assert.equal(find(root, "attachment-fil_gone"), null, "the file that is not there has none, not even a greyed one");
});
