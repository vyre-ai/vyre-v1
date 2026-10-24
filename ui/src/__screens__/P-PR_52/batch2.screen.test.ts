import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

// Node runs .ts files by stripping types but has no loader for .tsx. The placeholders hold no JSX, so load them as TypeScript.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".tsx")) return { format: "module-typescript", source: readFileSync(fileURLToPath(url)), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { FolderTreePlaceholder } = await import("../../FolderTree/Placeholder.tsx");
const { frozenFolderTreeProps } = await import("../../FolderTree/props.ts");
const { ShareSheetPlaceholder } = await import("../../ShareSheet/Placeholder.tsx");
const { frozenShareSheetProps } = await import("../../ShareSheet/props.ts");
const { LockedStatePlaceholder } = await import("../../LockedState/Placeholder.tsx");
const { frozenLockedStateProps } = await import("../../LockedState/props.ts");
const { NeedsTeamSpacePlaceholder } = await import("../../NeedsTeamSpace/Placeholder.tsx");
const { frozenNeedsTeamSpaceProps, NEEDS_TEAM_SPACE_LABEL } = await import("../../NeedsTeamSpace/props.ts");
const { ObjectPagePlaceholder } = await import("../../ObjectPage/Placeholder.tsx");
const { frozenObjectPageProps } = await import("../../ObjectPage/props.ts");
const { RichEditorPlaceholder } = await import("../../RichEditor/Placeholder.tsx");
const { frozenRichEditorProps } = await import("../../RichEditor/props.ts");
const { HistoryTabPlaceholder } = await import("../../HistoryTab/Placeholder.tsx");
const { frozenHistoryTabProps } = await import("../../HistoryTab/props.ts");
const { DiffTabPlaceholder } = await import("../../DiffTab/Placeholder.tsx");
const { frozenDiffTabProps } = await import("../../DiffTab/props.ts");
const { CommentReplyPlaceholder } = await import("../../CommentReply/Placeholder.tsx");
const { frozenCommentReplyProps } = await import("../../CommentReply/props.ts");

type Shape = { label: string; text: string; density: string };
function check(out: Shape, label: string, density: "regular" | "compact", contains: string): void {
  assert.equal(out.label, label);
  assert.equal(out.density, density);
  assert.ok(out.text.startsWith(`${label} ${density}`), out.text);
  assert.ok(out.text.includes(contains), `${out.text} should include ${contains}`);
}

test("FolderTree renders its labelled placeholder from frozen props, both densities", () => {
  check(FolderTreePlaceholder(frozenFolderTreeProps), "FolderTree", "compact", "site, 2 folders");
  check(FolderTreePlaceholder({ ...frozenFolderTreeProps, density: "regular" }), "FolderTree", "regular", "2 folders");
});

test("ShareSheet renders its labelled placeholder from frozen props, both densities", () => {
  check(ShareSheetPlaceholder(frozenShareSheetProps), "ShareSheet", "compact", "Clients, 1 shares");
  check(ShareSheetPlaceholder({ ...frozenShareSheetProps, density: "regular" }), "ShareSheet", "regular", "Clients");
});

test("LockedState renders its labelled placeholder and the request status", () => {
  check(LockedStatePlaceholder(frozenLockedStateProps), "LockedState", "compact", "Clients, Ask for access");
  check(LockedStatePlaceholder({ ...frozenLockedStateProps, status: "waiting", density: "regular" }), "LockedState", "regular", "Waiting");
  check(LockedStatePlaceholder({ ...frozenLockedStateProps, status: "declined" }), "LockedState", "compact", "Declined");
});

test("NeedsTeamSpace renders its labelled placeholder with the fixed sentence", () => {
  check(NeedsTeamSpacePlaceholder(frozenNeedsTeamSpaceProps), "NeedsTeamSpace", "compact", NEEDS_TEAM_SPACE_LABEL);
  const bare = NeedsTeamSpacePlaceholder({ what: "", density: "regular" });
  check(bare, "NeedsTeamSpace", "regular", NEEDS_TEAM_SPACE_LABEL);
  assert.ok(!bare.text.includes(","), bare.text);
});

test("ObjectPage renders its labelled placeholder with the active tab", () => {
  check(ObjectPagePlaceholder(frozenObjectPageProps), "ObjectPage", "compact", "Omar, Overview");
  check(ObjectPagePlaceholder({ ...frozenObjectPageProps, activeTabId: "access", density: "regular" }), "ObjectPage", "regular", "Omar, Access");
});

test("RichEditor renders its labelled placeholder for every mode", () => {
  check(RichEditorPlaceholder(frozenRichEditorProps), "RichEditor", "compact", "doc_agent_md, edit");
  check(RichEditorPlaceholder({ ...frozenRichEditorProps, mode: "suggest", density: "regular" }), "RichEditor", "regular", "suggest");
  check(RichEditorPlaceholder({ ...frozenRichEditorProps, mode: "read" }), "RichEditor", "compact", "read");
});

test("HistoryTab renders its labelled placeholder with the version count", () => {
  check(HistoryTabPlaceholder(frozenHistoryTabProps), "HistoryTab", "compact", "file, 2 versions");
  check(HistoryTabPlaceholder({ ...frozenHistoryTabProps, versions: [], density: "regular" }), "HistoryTab", "regular", "0 versions");
});

test("DiffTab renders its labelled placeholder with files and layout", () => {
  check(DiffTabPlaceholder(frozenDiffTabProps), "DiffTab", "compact", "AGENT.md, 1 files, unified");
  check(DiffTabPlaceholder({ ...frozenDiffTabProps, layout: "split", density: "regular" }), "DiffTab", "regular", "split");
});

test("CommentReply renders full width with the up arrow send control", () => {
  check(CommentReplyPlaceholder(frozenCommentReplyProps), "CommentReply", "compact", "full, up");
  check(CommentReplyPlaceholder({ ...frozenCommentReplyProps, density: "regular" }), "CommentReply", "regular", "full, up");
});

test("every component takes a density flag of regular or compact", () => {
  const all = [frozenFolderTreeProps, frozenShareSheetProps, frozenLockedStateProps, frozenNeedsTeamSpaceProps, frozenObjectPageProps, frozenRichEditorProps, frozenHistoryTabProps, frozenDiffTabProps, frozenCommentReplyProps];
  assert.equal(all.length, 9);
  for (const props of all) assert.ok(props.density === "compact" || props.density === "regular");
});
