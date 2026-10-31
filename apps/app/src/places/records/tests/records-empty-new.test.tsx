// An empty type's one action, New <record>: pressing it opens the new-record row and the empty message gives way to it. Rendered with the test renderer so the press goes through the real handler.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, press } from "../../../../../../ui/src/testing/dom.ts";
import { RecordsDataProvider, RecordsStateProvider } from "../sidebar/index.ts";
import { TableView } from "../table/index.ts";
import { createSampleRecords, harbor } from "../table/sample.ts";

test("pressing the empty state's New client shows the new-record row and takes the empty message away", async () => {
  const restore = installDom();
  try {
    const s = createSampleRecords({ ...harbor, counts: { clients: 0, projects: 0 } });
    const r = createRoot();
    await act(async () => { r.render(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={{}}><TableView /></RecordsStateProvider></RecordsDataProvider>); });
    await flush();
    const root = r.container as unknown as Parameters<typeof find>[0];
    assert.ok(find(root, "state-empty"), "an empty type shows the empty state");
    assert.equal(find(root, "records-adding"), null, "no new-record row yet");
    await press(find(root, "state-action"));
    await flush();
    assert.ok(find(root, "records-adding"), "the new-record row is open");
    assert.equal(find(root, "state-empty"), null, "the empty message gives way to it");
    // the table's idle timers die with it: nothing is left to fire into a torn-down document
    await act(async () => { (r as unknown as { unmount?: () => void }).unmount?.(); });
    await new Promise((done) => setTimeout(done, 250));   // past the idle timer: it must not fire into the stand-in document
  } finally { restore(); }
});
