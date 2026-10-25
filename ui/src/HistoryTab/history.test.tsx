// ui/HistoryTab: one History for every versioned resource. Undo test: a version is restored from History for a record, a file and an automation,
// each through its own `<module>.restore_version`; Undo this run reverts the run's undoable writes once and reports the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HISTORY_RESOURCE_TYPES,
  HistoryTab,
  PREVIEW_UNDO_CAPABILITY,
  RETENTION_NOTE,
  UNDO_NOTE,
  UNDO_RUN_CAPABILITY,
  actionsFor,
  capabilitiesFor,
  confirmText,
  currentVersion,
  frozenHistoryTabProps,
  moveSelection,
  newestFirst,
  noteLine,
  performRestore,
  performUndo,
  previousOf,
  restoreInput,
  runGroup,
  shortDate,
  undoLabel,
  undoPlan,
  undoRunInput,
} from "./index.tsx";
import type { HistoryInvoke, HistoryResourceType, HistoryVersion } from "./index.tsx";

const V = (n: number, over: Partial<HistoryVersion> = {}): HistoryVersion => ({
  id: `ver_${n}`, n, who: "Lena Ortiz", why: `change ${n}`, at: `2026-10-${10 + n}T09:00:00Z`, runId: null, undoable: true, ...over,
});

/** The opening tag of the element with this test id. */
function tagOf(html: string, testId: string): string {
  const hit = new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  assert.ok(hit !== null, `${testId} is rendered`);
  return hit[0];
}

const VERSIONS: readonly HistoryVersion[] = [V(5), V(4, { runId: "run_a" }), V(3, { runId: "run_a", undoable: false }), V(2, { runId: "run_a" }), V(1, { why: "" })];

test("every resource type has its own versions and restore_version capability", () => {
  assert.equal(HISTORY_RESOURCE_TYPES.length, 6);
  const seen = new Set<string>();
  for (const type of HISTORY_RESOURCE_TYPES) {
    const caps = capabilitiesFor(type);
    assert.match(caps.list, /\.versions$/);
    assert.match(caps.restore, /\.restore_version$/);
    assert.equal(caps.list.split(".")[0], caps.restore.split(".")[0], `${type}: both calls belong to one module`);
    seen.add(caps.restore);
  }
  assert.equal(seen.size, 6, "no two types share a capability");
  assert.equal(capabilitiesFor("file").restore, "files.restore_version");
  assert.equal(capabilitiesFor("record").restore, "records.restore_version");
  assert.equal(capabilitiesFor("automation").restore, "automations.restore_version");
});

test("undo test: restoring a version from History for a record, a file and an automation calls each module with the right input", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const invoke: HistoryInvoke = (cap, input) => {
    calls.push({ cap, input });
  };
  const target = V(2);
  const lines = [
    await performRestore({ type: "record", resourceId: "rec_1", recordType: "contact", invoke }, target),
    await performRestore({ type: "file", resourceId: "file_agent_md", invoke }, target),
    await performRestore({ type: "automation", resourceId: "aut_weekly", invoke }, target),
  ];
  assert.deepEqual(calls, [
    { cap: "records.restore_version", input: { type: "contact", recordId: "rec_1", versionId: "ver_2" } },
    { cap: "files.restore_version", input: { fileId: "file_agent_md", versionId: "ver_2" } },
    { cap: "automations.restore_version", input: { automationId: "aut_weekly", versionId: "ver_2" } },
  ]);
  assert.deepEqual(lines, ["Restored v2 as a new version.", "Restored v2 as a new version.", "Restored v2 as a new version."]);
});

test("memory, Kit and agent definitions restore through their own modules too", () => {
  const cases: [HistoryResourceType, string, Record<string, unknown>][] = [
    ["memory", "note_1", { noteId: "note_1", versionId: "ver_2" }],
    ["kit", "kit_1", { kitId: "kit_1", versionId: "ver_2" }],
    ["agent", "agt_1", { agentId: "agt_1", versionId: "ver_2" }],
    ["record", "rec_1", { recordId: "rec_1", versionId: "ver_2" }],
  ];
  for (const [type, id, want] of cases) assert.deepEqual(restoreInput(type, id, "ver_2"), want, type);
});

test("Undo this run calls runs.undo once with the run id and reports what stayed", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  const invoke: HistoryInvoke = (cap, input) => {
    calls.push({ cap, input });
  };
  const line = await performUndo({ type: "file", resourceId: "f1", invoke }, VERSIONS, V(4, { runId: "run_a" }));
  assert.deepEqual(calls, [{ cap: UNDO_RUN_CAPABILITY, input: { runId: "run_a" } }]);
  assert.equal(UNDO_RUN_CAPABILITY, "runs.undo");
  assert.equal(PREVIEW_UNDO_CAPABILITY, "runs.preview_undo");
  assert.equal(line, "Undid 2, 1 could not be undone.");
  assert.equal(await performUndo({ type: "file", resourceId: "f1", invoke }, VERSIONS, V(5)), "", "a version no run wrote has nothing to undo and calls nothing");
  assert.equal(calls.length, 1);
  assert.deepEqual(undoRunInput("run_a", "wrong file"), { runId: "run_a", reason: "wrong file" });
  assert.deepEqual(undoRunInput("run_a", ""), { runId: "run_a" });
});

test("the undo plan splits a run into what is reverted and what stays", () => {
  const plan = undoPlan(VERSIONS, "run_a");
  assert.deepEqual(plan.undo.map((v) => v.n), [4, 2]);
  assert.deepEqual(plan.keep.map((v) => v.n), [3]);
  assert.equal(undoLabel(plan), "Undo this run (2 changes)");
  assert.equal(undoLabel({ runId: "r", undo: [V(1)], keep: [] }), "Undo this run (1 change)");
  assert.equal(undoLabel({ runId: "r", undo: [], keep: [V(1)] }), "Undo this run");
  assert.deepEqual(runGroup(VERSIONS, "run_a").map((v) => v.n), [4, 3, 2], "newest first");
  assert.deepEqual(undoPlan(VERSIONS, "none").undo, []);
});

test("versions order newest first; the newest is current; the previous one is the compare target", () => {
  const shuffled = [V(2), V(5), V(1), V(4), V(3)];
  assert.deepEqual(newestFirst(shuffled).map((v) => v.n), [5, 4, 3, 2, 1]);
  assert.equal(currentVersion(shuffled)?.n, 5);
  assert.equal(currentVersion([]), null);
  assert.equal(previousOf(shuffled, "ver_4")?.n, 3);
  assert.equal(previousOf(shuffled, "ver_1"), null, "the first version has nothing before it");
  assert.equal(previousOf(shuffled, "missing"), null);
});

test("which actions a version offers: compare needs an earlier one, restore is not for the current version, undo needs a run with undoable writes", () => {
  assert.deepEqual(actionsFor(VERSIONS, V(5)), { compare: true, restore: false, undo: false });
  assert.deepEqual(actionsFor(VERSIONS, V(4, { runId: "run_a" })), { compare: true, restore: true, undo: true });
  assert.deepEqual(actionsFor(VERSIONS, V(1)), { compare: false, restore: true, undo: false });
  const stuck: HistoryVersion[] = [V(2, { runId: "r", undoable: false }), V(1)];
  assert.equal(actionsFor(stuck, V(2, { runId: "r", undoable: false })).undo, false, "a run with nothing undoable cannot be undone");
});

test("confirm lines state the impact before anything changes", () => {
  assert.equal(confirmText("restore", V(3)), "Restore v3? It is saved as a new version; nothing is lost.");
  assert.equal(confirmText("undo", V(4), undoPlan(VERSIONS, "run_a")), "Undo what this run changed? 2 changes are reverted, 1 stay.");
  assert.equal(confirmText("undo", V(4), { runId: "r", undo: [V(1)], keep: [] }), "Undo what this run changed? 1 change is reverted.");
});

test("arrows move through versions without wrapping; Home and End jump", () => {
  assert.equal(moveSelection(VERSIONS, "ver_5", "ArrowDown"), "ver_4");
  assert.equal(moveSelection(VERSIONS, "ver_5", "ArrowUp"), "ver_5", "stops at the top");
  assert.equal(moveSelection(VERSIONS, "ver_1", "ArrowDown"), "ver_1", "stops at the bottom");
  assert.equal(moveSelection(VERSIONS, null, "ArrowDown"), "ver_5");
  assert.equal(moveSelection(VERSIONS, "ver_3", "Home"), "ver_5");
  assert.equal(moveSelection(VERSIONS, "ver_3", "End"), "ver_1");
  assert.equal(moveSelection([], null, "Home"), null);
});

test("dates read the same everywhere and the quiet line has who and why", () => {
  assert.equal(shortDate("2026-10-24T12:00:00Z"), "Oct 24");
  assert.equal(shortDate("2026-01-03T23:59:00Z"), "Jan 3");
  assert.equal(shortDate("nonsense"), "");
  assert.equal(noteLine(V(2)), "Lena Ortiz · change 2");
  assert.equal(noteLine(V(1, { why: "  " })), "Lena Ortiz");
});

test("the tab shows every version as a shared Row with a dot, the Current mark on the newest, and the retention note", () => {
  const html = renderToStaticMarkup(<HistoryTab {...frozenHistoryTabProps} />);
  assert.match(html, /aria-label="Version history"/);
  assert.match(html, /data-testid="row-history-ver_2"/);
  assert.match(html, /data-testid="row-history-ver_1"/);
  assert.match(html, /data-testid="row-history-ver_2-leading"/, "the dot sits in the Row's leading slot");
  assert.match(html, /data-testid="row-history-ver_2-trailing"/);
  assert.match(html, />Current</);
  assert.equal((html.match(/>Current</g) ?? []).length, 1, "only the newest is current");
  assert.match(html, /Intake · First draft/);
  assert.match(html, /Irfad · Shorten the role line/);
  assert.match(html, />Oct 24</);
  assert.ok(html.includes(RETENTION_NOTE));
  assert.doesNotMatch(html, /background-color:var\(--accent\)/, "the selected row is the quiet wash, never a filled accent box");
  assert.match(html, /background-color:var\(--sel\)/, "the selected version paints the selection token on the whole row");
});

test("the selected version offers Compare and Restore; the current one cannot restore itself", () => {
  const current = renderToStaticMarkup(<HistoryTab {...frozenHistoryTabProps} selectedVersionId="ver_2" />);
  assert.doesNotMatch(tagOf(current, "history-compare"), /aria-disabled="true"/);
  assert.match(tagOf(current, "history-restore"), /aria-disabled="true"/);
  const old = renderToStaticMarkup(<HistoryTab {...frozenHistoryTabProps} selectedVersionId="ver_1" />);
  assert.doesNotMatch(tagOf(old, "history-restore"), /aria-disabled="true"/);
  assert.match(tagOf(old, "history-compare"), /aria-disabled="true"/, "the first version has nothing to compare with");
});

test("a version written by a run shows Undo this run, and says why it cannot when nothing is undoable", () => {
  const props = { ...frozenHistoryTabProps, versions: VERSIONS, selectedVersionId: "ver_4" } as const;
  const live = renderToStaticMarkup(<HistoryTab {...props} />);
  assert.match(live, /Undo this run \(2 changes\)/);
  assert.doesNotMatch(live, /data-testid="history-undo-note"/);
  const stuck = renderToStaticMarkup(<HistoryTab {...frozenHistoryTabProps} selectedVersionId="ver_1" />);
  assert.match(stuck, /data-testid="history-undo"/);
  assert.match(tagOf(stuck, "history-undo"), /aria-disabled="true"/);
  assert.ok(stuck.includes(UNDO_NOTE.replaceAll("'", "&#x27;")), "the note is shown (the markup escapes the apostrophe)");
});

test("no versions says so", () => {
  const html = renderToStaticMarkup(<HistoryTab {...frozenHistoryTabProps} versions={[]} selectedVersionId={null} />);
  assert.match(html, /No earlier versions/);
  assert.doesNotMatch(html, /data-testid="history-actions"/);
});
