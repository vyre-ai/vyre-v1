// A Markdown file in the viewer is edited in the one Markdown editor: the viewer gives it the page while Edit is on, it saves a new version after a pause with the version it started from,
// the row above says Saved with the version number and offers Undo, and Undo restores the version before as a new version.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { Viewer } from "../../../../../../ui/src/Viewer/index.tsx";
import { FileMarkdownEditor } from "../viewer/FileMarkdownEditor.tsx";

const wait = (ms: number): Promise<void> => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

function rig(text: string, version: number) {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let at = text;
  let n = version;
  const versions = [{ n: version, versionId: `v${version}`, text }];
  const call = async (cap: string, input: unknown): Promise<unknown> => {
    const i = input as Record<string, unknown>;
    calls.push({ cap, input: i });
    if (cap === "files.save") { at = String(i["text"]); n += 1; versions.push({ n, versionId: `v${n}`, text: at }); return { n, versionId: `v${n}` }; }
    if (cap === "files.versions") return { versions: versions.map(({ n: k, versionId }) => ({ n: k, versionId })) };
    if (cap === "files.read") return { text: versions.find((v) => v.versionId === i["versionId"])?.text ?? "" };
    if (cap === "files.restore_version") { const v = versions.find((x) => x.versionId === i["versionId"])!; at = v.text; n += 1; versions.push({ n, versionId: `v${n}`, text: at }); return { file: { version: n }, versionId: `v${n}` }; }   // the real shape of files.restore_version
    return {};
  };
  return { call, calls, now: () => at };
}

test("the viewer gives the page to the Markdown editor while Edit is on, and not in View", () => {
  const ed = <FileMarkdownEditor call={async () => ({})} fileId="f1" name="notes.md" text={"# Hi\n"} version={3} />;
  const base = { fileId: "f1", title: "notes.md", kind: "document" as const, blocks: [{ id: "b0", tag: "h1" as const, text: "Hi" }], docEditor: ed };
  const editing = renderToStaticMarkup(<Viewer {...base} edit />).replaceAll("<!-- -->", "");
  assert.ok(editing.includes('data-testid="vw-doc-editor"') && editing.includes('data-testid="file-md-editor"'), "Edit shows the Markdown editor");
  assert.ok(!editing.includes('data-testid="vw-doc"'), "not the block editor");
  const viewing = renderToStaticMarkup(<Viewer {...base} />).replaceAll("<!-- -->", "");
  assert.ok(viewing.includes('data-testid="vw-doc"') && !viewing.includes('data-testid="file-md-editor"'), "View reads the page");
});

test("typing saves a new version after a pause; the row says Saved with its number and Undo goes back", async () => {
  const restore = installDom();
  try {
    const r = rig("# Hi\n\nOne line.\n", 5);
    const root = await mount(createRoot, <FileMarkdownEditor call={r.call} fileId="f1" name="notes.md" text={"# Hi\n\nOne line.\n"} version={5} startView="raw" />);
    const ta = find(root, "markdown-editor-raw-text");
    assert.ok(ta, "the raw field");
    await act(async () => { (ta.props.onChange as (e: unknown) => void)({ target: { value: "# Hi\n\nOne line.\nTwo lines.\n" } }); });
    assert.equal(r.calls.filter((c) => c.cap === "files.save").length, 0, "nothing while typing");
    await wait(1100);
    const saves = r.calls.filter((c) => c.cap === "files.save");
    assert.equal(saves.length, 1);
    assert.equal(saves[0]!.input["baseVersion"], 5);
    assert.equal(saves[0]!.input["text"], "# Hi\n\nOne line.\nTwo lines.\n");
    assert.match(textOf(find(root, "file-md-status")), /Saved .* v6/);
    await press(find(root, "file-md-undo"));
    await wait(100);
    assert.equal(r.now(), "# Hi\n\nOne line.\n", "the text of the version before is the file again");
    assert.ok(r.calls.some((c) => c.cap === "files.restore_version" && c.input["versionId"] === "v5"), "restored as a new version");
    assert.equal(find(root, "file-md-undo"), null, "nothing left to undo");
    assert.match(textOf(find(root, "file-md-status")), /v7/, "the new version number comes from the file the restore answers with");
  } finally { restore(); }
});
