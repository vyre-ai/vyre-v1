// A file of a live Drive folder is an empty placeholder until it is fetched. Opening it shows "Getting this from Google Drive", then the rows; when the fetch fails it says so with Try again and
// Open in Google Drive, and never draws the empty placeholder as a spreadsheet with "0 rows" (13 Nov 2026, the owner's My Drive CSV).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { installDom, mount, find, press, textOf, flush } from "../../../../../../ui/src/testing/dom.ts";
import { FileViewer } from "../viewer/FileViewer.tsx";
import { FilesViewerDataProvider } from "../viewer/data.tsx";
import type { FilesViewerData } from "../viewer/data.tsx";
import { createSampleViewer } from "../viewer/sample.ts";

const CSV = "client,fee\nAcme,10\nBeta,20\n";

function rig() {
  const base = createSampleViewer();
  const calls: string[] = [];
  const state = { size: 0, fetch: "wait" as "wait" | "fail" | "ok" };
  let release: (() => void) | undefined;
  const opened: string[] = [];
  const data: FilesViewerData = {
    ...base.data,
    openUrl: (u) => opened.push(u),
    async call(cap, input) {
      calls.push(cap);
      if (cap === "files.get")
        return { file: { fileId: "f_live", size: state.size, source: { mountId: "mnt_d", provider: "Google Drive" } } };
      if (cap === "mounts.file_link")
        return {
          link: {
            mountId: "mnt_d",
            kind: "google_drive",
            type: "google_file",
            openIn: "Google Drive",
            webUrl: "https://drive.test/f",
          },
        };
      if (cap === "files.viewer_data") {
        if (state.fetch === "wait") await new Promise<void>((r) => (release = r));
        if (state.fetch === "fail") {
          state.fetch = "ok";
          throw Object.assign(new Error("Vyre could not get this file"), { code: "provider.unavailable" });
        }
        const sample = (await base.data.call(cap, { fileId: "f_fees" })) as { file: Record<string, unknown> };
        return {
          ...sample,
          file: { ...sample.file, fileId: "f_live", name: "1 - Wallet Recharge.csv", size: CSV.length },
          text: CSV,
        };
      }
      return base.data.call(cap, cap.startsWith("files.") ? { ...(input as object), fileId: "f_fees" } : input);
    },
  };
  return { data, calls, state, opened, release: () => release?.() };
}

test("opening a live placeholder says it is getting the file, then shows the rows", async () => {
  const restore = installDom();
  try {
    const r = rig();
    const root = await mount(
      createRoot,
      <FilesViewerDataProvider value={r.data}>
        <FileViewer fileId="f_live" />
      </FilesViewerDataProvider>,
    );
    assert.ok(find(root, "file-viewer-loading"), "loading");
    assert.match(textOf(find(root, "file-viewer-getting")), /Getting this from Google Drive/);
    assert.equal(find(root, "file-viewer-failed"), null);
    r.state.fetch = "ok";
    await act(async () => r.release());
    await flush();
    assert.equal(find(root, "file-viewer-loading"), null);
    assert.match(textOf(root), /Acme/, "the rows are drawn");
    assert.doesNotMatch(textOf(root), /0 rows/);
  } finally {
    restore();
  }
});

test("a failed fetch says so with Try again and Open in Google Drive, never an empty grid; Try again gets the rows", async () => {
  const restore = installDom();
  try {
    const r = rig();
    r.state.fetch = "fail";
    const root = await mount(
      createRoot,
      <FilesViewerDataProvider value={r.data}>
        <FileViewer fileId="f_live" />
      </FilesViewerDataProvider>,
    );
    await flush();
    const failed = find(root, "file-viewer-failed");
    assert.ok(failed, "the failed state");
    assert.match(textOf(failed), /Could not get this from Google Drive/);
    assert.match(textOf(failed), /Try again/);
    assert.doesNotMatch(textOf(root), /0 rows/);
    await press(find(root, "file-viewer-failed-open"));
    assert.deepEqual(r.opened, ["https://drive.test/f"]);
    const again = find(root, "state-action");
    assert.ok(again, "the Try again button");
    await press(again);
    await flush();
    assert.equal(find(root, "file-viewer-failed"), null);
    assert.match(textOf(root), /Acme/);
  } finally {
    restore();
  }
});

test("a spreadsheet too large to draw says so with Open in; one a little over the preview shows its first rows and says so", async () => {
  const restore = installDom();
  try {
    for (const [size, text, want] of [
      [20 * 1024 * 1024, undefined, "file-viewer-toolarge"],
      [500_000, CSV, "file-viewer-cutshort"],
    ] as const) {
      const base = createSampleViewer();
      const data: FilesViewerData = {
        ...base.data,
        call: async (cap, input) => {
          if (cap === "files.viewer_data") {
            const s = (await base.data.call(cap, { fileId: "f_fees" })) as { file: Record<string, unknown> };
            return { ...s, file: { ...s.file, size, source: undefined }, text };
          }
          return base.data.call(cap, cap.startsWith("files.") ? { ...(input as object), fileId: "f_fees" } : input);
        },
      };
      const root = await mount(
        createRoot,
        <FilesViewerDataProvider value={data}>
          <FileViewer fileId="f_fees" />
        </FilesViewerDataProvider>,
      );
      await flush();
      assert.ok(find(root, want), want);
    }
  } finally {
    restore();
  }
});
