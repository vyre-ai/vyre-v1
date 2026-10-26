// P-L9_07c: the version screen and the object page match the prototype. The Viewing banner (Hide changes, Restore this version, Back to current),
// the unchanged line around a change, author faces in the history, chevrons on rows that open something, and the Owns list.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Text } from "react-native";
import { DiffTab, contextLines } from "../../../../ui/src/DiffTab/index.tsx";
import type { DiffFile } from "../../../../ui/src/DiffTab/index.tsx";
import { HistoryTab, VersionBanner, bannerLine, longStamp } from "../../../../ui/src/HistoryTab/index.tsx";
import type { HistoryVersion } from "../../../../ui/src/HistoryTab/index.tsx";
import { ObjectChevron, ObjectSection } from "../../../../ui/src/ObjectPage/index.tsx";
import { Row } from "../../../../ui/src/Row/index.tsx";

const V4: HistoryVersion = { id: "v4", n: 4, who: "Lena Ortiz", why: "Added the brief and checklist", at: "2026-10-20T11:00:00Z", runId: null, undoable: true };
const V5: HistoryVersion = { id: "v5", n: 5, who: "Maya Chen", why: "Follow up after two business days", at: "2026-10-22T11:00:00Z", runId: null, undoable: true };
const FILES: DiffFile[] = [
  {
    path: "AGENT.md",
    added: 1,
    removed: 1,
    body: "text",
    hunks: [{ id: "h1", context: "Follow-up", before: "8. Write the brief for the host.", removed: "9. three business days", added: "9. two business days" }],
  },
];
const clean = (s: string): string => s.replaceAll("<!-- -->", "");

test("the banner says which version, when and by whom, and what the page shows", () => {
  assert.equal(longStamp("2026-10-20T11:00:00Z"), "Oct 20 at 11:00 am");
  assert.equal(longStamp("2026-10-20T00:05:00Z"), "Oct 20 at 12:05 am");
  assert.equal(longStamp("2026-10-20T15:30:00Z"), "Oct 20 at 3:30 pm");
  assert.equal(bannerLine(V4, true), "Viewing v4 from Oct 20 at 11:00 am by Lena Ortiz. Showing what changed since.");
  assert.equal(bannerLine(V4, false), "Viewing v4 from Oct 20 at 11:00 am by Lena Ortiz.");
});

test("the banner has Hide changes, Restore this version and Back to current; Show changes once hidden", () => {
  const on = clean(renderToStaticMarkup(<VersionBanner version={V4} showingChanges canRestore />));
  for (const label of ["Hide changes", "Restore this version", "Back to current"]) assert.ok(on.includes(label), label);
  assert.ok(on.includes("Showing what changed since."));
  const off = clean(renderToStaticMarkup(<VersionBanner version={V4} showingChanges={false} canRestore />));
  assert.ok(off.includes("Show changes") && !off.includes("Hide changes"));
  const none = clean(renderToStaticMarkup(<VersionBanner version={V4} showingChanges={null} canRestore={false} />));
  assert.ok(!none.includes("changes") && !none.includes("Restore this version") && none.includes("Back to current"), "no text to compare and nothing to restore");
});

test("a version diff shows its unchanged line above the change, between ellipsis marks, with no toolbar or per-change buttons", () => {
  assert.deepEqual(contextLines("a\nb").map((l) => l.sign), [" ", " "]);
  assert.deepEqual(contextLines(undefined), []);
  const out = clean(renderToStaticMarkup(<DiffTab title="AGENT.md" layout="unified" wordMarks={false} bare files={FILES} comments={[]} selectedPath="AGENT.md" density="regular" />));
  assert.ok(out.includes('data-testid="diff-line-ctx"'));
  assert.ok(out.includes("8. Write the brief for the host."));
  assert.ok(out.indexOf("8. Write the brief") < out.indexOf("9. three business days"), "context comes first");
  assert.ok(out.includes("diff-line-del") && out.includes("diff-line-add"));
  assert.ok(!out.includes('data-testid="diff-wordmarks"') && !out.includes("diff-comment-h1") && !out.includes("diff-revert-h1"));
  const full = clean(renderToStaticMarkup(<DiffTab title="AGENT.md" layout="unified" wordMarks={false} files={FILES} comments={[]} selectedPath="AGENT.md" density="regular" />));
  assert.ok(full.includes("diff-comment-h1") && full.includes('data-testid="diff-wordmarks"'), "a changeset diff keeps its toolbar and buttons");
});

test("every version row carries the face of its author", () => {
  const out = clean(renderToStaticMarkup(<HistoryTab resourceType="file" resourceId="f" versions={[V5, V4]} selectedVersionId="v4" density="regular" />));
  assert.ok(out.includes('data-testid="history-avatar-v5"') && out.includes('data-testid="history-avatar-v4"'));
});

test("a section lists its rows under a title and a count, and a row that opens something ends in a chevron", () => {
  const out = clean(renderToStaticMarkup(
    <ObjectSection title="Owns" count={3}>
      <Row id="owns-scout" title="Scout" note="Agent" trailing={<ObjectChevron />} onPress={() => undefined} />
      <Text>x</Text>
    </ObjectSection>,
  ));
  assert.ok(out.includes('data-testid="object-section-owns"'));
  assert.match(out, />Owns</);
  assert.match(out, />3</);
  assert.ok(out.includes('data-testid="row-owns-scout-trailing"') && out.includes("<svg"), "the chevron sits in the row's trailing slot");
});
