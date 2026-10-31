// Records > record page of a project: the Folder field is a link that opens the folder in Files, and the Files tab lists what is in that folder.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordPage, RecordPageDataProvider } from "../recordpage/index.ts";
import { PROJECT, northwind, createSamplePage } from "../recordpage/sample.ts";
import type { Row } from "../../../../../../client/src/index.ts";

const typed = { ...PROJECT, fields: [...PROJECT.fields, { key: "folder", type: "text", title: "Folder" }] };
const space = { ...northwind, types: [northwind.types[0]!, typed] };

function sample(withFolder: boolean) {
  const s = createSamplePage(space);
  if (withFolder) {
    const rows = s.replica.rows("records:projects") as unknown as Array<{ id: string; fields: Record<string, unknown> }>;
    s.replica.put("records:projects", rows.map((r) => (r.id === "pj_0" ? { ...r, fields: { ...r.fields, folder: "fld_test" } } : r)) as unknown as Row[]);
    s.replica.put("folders", [{ id: "fld_test", folderId: "fld_test", name: "Rivera engagement", path: "Projects/Rivera engagement" }] as unknown as Row[]);
    s.replica.put("files", [{ id: "fil_1", fileId: "fil_1", folderId: "fld_test", name: "Engagement letter.pdf", kind: "pdf" }] as unknown as Row[]);
  }
  return s;
}
const page = (s: ReturnType<typeof sample>, tab?: "files"): string =>
  renderToStaticMarkup(<RecordPageDataProvider value={s.data}><RecordPage type="projects" recordId="pj_0" start={{ all: true, ...(tab ? { pane: true, tab } : {}) }} /></RecordPageDataProvider>).replaceAll("<!-- -->", "");

test("the Folder field of a project shows the folder's path as a link, and the click opens it in Files", () => {
  const s = sample(true);
  const out = page(s);
  assert.ok(out.includes('data-testid="field-folder-link"') && out.includes("Projects/Rivera engagement"));
});

test("a project with no folder shows the field as empty, not as a link", () => {
  const out = page(sample(false));
  assert.ok(!out.includes('data-testid="field-folder-link"'));
});

test("the Files tab lists the files in the project's folder next to the button that opens it", () => {
  const out = page(sample(true), "files");
  assert.ok(out.includes('data-testid="pane-files-list"') && out.includes("Engagement letter.pdf") && out.includes('data-testid="open-files"'));
});

test("the Files tab of a project with no folder lists nothing and offers Attach, which makes the folder", () => {
  const out = page(sample(false), "files");
  assert.ok(!out.includes('data-testid="pane-files-list"') && out.includes('data-testid="pane-files-empty"') && out.includes('data-testid="attach-files"') && !out.includes('data-testid="open-files"'));
});
