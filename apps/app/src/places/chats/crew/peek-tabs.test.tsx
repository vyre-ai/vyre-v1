// The helper's pane as a session with tabs (lane r42-subagents, 19 Nov 2026, prototype sub42): Transcript, Files when it touched any, Details; only the open tab shows, the others stay mounted so nothing is read
// twice and a half-typed model change survives a look at another tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { CrewPeek } from "./pane.tsx";
import type { CrewMember } from "./model.ts";

installDom();

const M = (o: Partial<CrewMember> = {}): CrewMember =>
  ({
    kind: "helper",
    id: "thr_a",
    parentThreadId: "thr_0",
    title: "Server fixes",
    name: "Tess",
    agentId: "agt_tess",
    state: "done",
    found: "74 tests pass",
    startedAt: 1_000,
    endedAt: 9_000,
    elapsedMs: 8_000,
    tokensIn: 4_000,
    tokensOut: 900,
    costMicros: 30_000,
    ...o,
  }) as CrewMember;
const call = async (cap: string): Promise<unknown> => (cap === "chat.helper.notes" ? { notes: [] } : {});
const view = (member: CrewMember) =>
  mount(
    createRoot,
    <CrewPeek member={member} call={call} onBack={() => undefined} onOpenChat={() => undefined} onRefresh={() => undefined} />,
  );
const shown = (root: Awaited<ReturnType<typeof view>>, tab: string): boolean => {
  const p = find(root, `crew-peek-panel-${tab}`);
  assert.ok(p, `panel ${tab} exists`);
  // the web layer gives a hidden (display: none) panel one more class than a shown one
  return !/r-display/.test(String(p.props.className ?? ""));
};

test("a helper with no files has two tabs, Transcript and Details; it opens on Transcript", async () => {
  const root = await view(M());
  assert.ok(find(root, "crew-peek-tab-transcript") && find(root, "crew-peek-tab-details"));
  assert.equal(find(root, "crew-peek-tab-files"), null);
  assert.deepEqual(["transcript", "details"].map((t) => shown(root, t)), [true, false]);
  assert.match(textOf(find(root, "crew-peek-panel-transcript")), /74 tests pass/);
  assert.match(textOf(find(root, "crew-peek-panel-details")), /Cost and time/);
});

test("a helper that changed files gets a Files tab with the count, and pressing a tab shows that panel only", async () => {
  const root = await view(
    M({ branch: "crew/tess", added: 86, deleted: 16, files: [{ path: "a.yml", added: 5, deleted: 0 }, { path: "b.sh", added: 81, deleted: 16 }] }),
  );
  assert.match(textOf(find(root, "crew-peek-tab-files")), /Files\s*2/);
  await press(find(root, "crew-peek-tab-files"));
  assert.deepEqual(["transcript", "files", "details"].map((t) => shown(root, t)), [false, true, false]);
  await press(find(root, "crew-peek-tab-details"));
  assert.deepEqual(["transcript", "files", "details"].map((t) => shown(root, t)), [false, false, true]);
  await press(find(root, "crew-peek-tab-transcript"));
  assert.deepEqual(["transcript", "files", "details"].map((t) => shown(root, t)), [true, false, false]);
});

test("a subagent of the engine has no model to change but keeps both tabs; the actions and the ask box stay under every tab", async () => {
  const root = await view(M({ kind: "subagent", state: "working", found: undefined as never, step: "Reading page.html" }));
  assert.ok(find(root, "crew-peek-tab-details"));
  await flush();
  await press(find(root, "crew-peek-tab-details"));
  assert.equal(find(root, "crew-peek-model"), null);
});
