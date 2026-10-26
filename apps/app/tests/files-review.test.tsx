// Files review surfaces (P-L9e_03): the changeset header, the git row and the Gate row, the history and diff tabs, the lint bar with the agent file editor. Screens render through react-dom/server over
// react-native-web; presses are the functions the surfaces call (approve, request changes, discard, restore, name, save) against the sample's in-memory kernel, so what the tests change is what the next render shows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import {
  AgentFileEditor, AgentFilePage, SuggestionCard, ChangesetDiff, ChangesetHeader, CommitDiff, FileDiff, GateRow, GitRow, HistoryPanel, LintBar, ReviewDataProvider, TomlForm,
  approveBlocked, approveChangeset, approveInput, blockedReason, branchChoices, changedLine, commitFiles, diffFileOf, discardChangeset, draftDiff, errorWords, gateWords, hunkOf, historyVersions, initRepo, lineHunks,
  lintItems, needsGate, nameVersion, parseToml, pushBranch, rawFromForm, requestChanges, requestLabel, applySuggestion, choiceOf, choiceRaw, humanKey, suggestionHunks, acceptSuggestion, dismissSuggestion, restoreVersion, reviewExternally, saveFile, saveBlocked, setTomlValue, switchBranch, tomlGroups, tomlKind,
} from "../src/places/files/review/index.ts";
import { lineRange } from "../src/places/files/review/index.ts";
import { attemptKey } from "../src/shell/providers/files-review.ts";
import { extOf } from "../src/places/files/review/index.ts";
import { AGENT_MD, AGENT_TOML, createSampleReview } from "../src/places/files/review/sample.ts";
import type { SampleOptions, SampleReview } from "../src/places/files/review/sample.ts";
import { screensById } from "../../../generated/screens.ts";

const html = (s: SampleReview, el: ReactElement): string => renderToStaticMarkup(<ReviewDataProvider value={s.data}>{el}</ReviewDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const text = (s: string): string => s.replace(/<[^>]+>/g, "");
/** The opening tag of the element with this test id. */
const tag = (s: string, id: string): string => {
  const m = new RegExp(`<[^>]*data-testid="${id}"[^>]*>`).exec(s);
  assert.ok(m, `expected an element with test id ${id}`);
  return m[0];
};
const sample = (o: SampleOptions = {}): SampleReview => createSampleReview(o);
const header = (s: SampleReview, panel?: "request" | "discard"): string => html(s, <ChangesetHeader changesetId={s.changesetId} {...(panel ? { panel } : {})} />);
const lastCall = (s: SampleReview): { cap: string; input: Record<string, unknown> } => s.calls[s.calls.length - 1] as { cap: string; input: Record<string, unknown> };

test("screen: the header reads Docs changed 3 files, Review, with the totals and the three actions", () => {
  const s = sample();
  const out = header(s);
  assert.ok(has(text(out), "Docs changed 3 files"), "who and how many");
  assert.ok(has(out, "Review"), "the Review word after the dot");
  assert.ok(has(out, 'data-testid="changeset-totals"') && has(text(out), "3 files") && has(text(out), "+42") && has(text(out), "−9"), "the totals");
  for (const label of ["Discard", "Request changes", "Approve and commit", "More"]) assert.ok(has(out, `aria-label="${label}"`), label);
  assert.ok(has(text(out), "Based on version 2 of each file"), "the base version line");
  assert.ok(has(text(out), "Projects/Rivera matter"), "where the changes are");
  assert.ok(!has(out, 'data-testid="changeset-commit"'), "a plain folder has no commit message or push");
  assert.ok(!has(out, 'data-testid="gate-row"'), "no gate without a protected branch");
  assert.ok(!has(tag(out, "changeset-approve"), 'aria-disabled="true"'), "approve is on");
  assert.equal(header(sample(), "request").includes('data-testid="changeset-request-panel"'), true, "the note panel can open at start");
});

test("screen: the header is the shared look: the avatar of the agent, a header role, and a group named for the screen reader", () => {
  const out = header(sample());
  assert.ok(has(out, 'role="group"') && has(out, 'aria-label="Docs changed 3 files"'));
  assert.ok(has(out, 'role="heading"') || has(out, "<h2"), "the title is a heading");
});

test("screen: a git folder shows the commit message box and Push; approve and commit sends the message and push to changesets.approve", async () => {
  const s = sample({ repo: true });
  const out = header(s);
  assert.ok(has(out, 'data-testid="changeset-commit"') && has(out, 'aria-label="Commit message"'));
  assert.ok(has(tag(out, "changeset-push"), 'aria-checked="true"') && has(tag(out, "changeset-push"), 'role="switch"'), "push is on when there is a remote");
  assert.ok(!has(out, 'data-testid="gate-row"'), "docs-update is not protected");
  const r = await approveChangeset(s.data.call, { changesetId: s.changesetId, message: "  Raise the retainer  ", push: true, key: "k1" });
  assert.ok(r.ok);
  const c = lastCall(s);
  assert.equal(c.cap, "changesets.approve");
  assert.deepEqual(c.input, { changesetId: "cs_rivera", message: "Raise the retainer", push: true, idempotencyKey: "k1" });
  assert.equal(s.changeset().state, "approved");
  const after = header(s);
  assert.ok(has(text(after), "Committed. These changes are in the folder now."), "the header says so");
  assert.ok(!has(after, 'aria-label="Approve and commit"'), "a settled changeset has no approve");
  const again = await approveChangeset(s.data.call, { changesetId: s.changesetId, message: "", push: false, key: "k2" });
  assert.ok(!again.ok && has(again.error, "approve"), "approving twice is refused in words");
});

test("approve input: the message is left out when empty, push is always said, the key rides along", () => {
  assert.deepEqual(approveInput({ changesetId: "c", message: "  ", push: false, key: "k" }), { changesetId: "c", push: false, idempotencyKey: "k" });
  assert.deepEqual(approveInput({ changesetId: "c", message: "Fix", push: true, key: "k" }), { changesetId: "c", message: "Fix", push: true, idempotencyKey: "k" });
  const screen = screensById.get("files.changeset-header");
  assert.ok(screen, "the screen is in the registry");
  assert.equal(screen.actions["approve"]?.cap, "changesets.approve");
  assert.deepEqual(Object.keys(screen.actions["approve"]?.input ?? {}).sort(), ["changesetId", "message", "push"]);
});

test("a protected branch shows the GateRow and blocks approve until the Gate says yes", () => {
  const s = sample({ protectedBranch: true });
  const out = header(s);
  assert.ok(has(out, 'data-testid="gate-row"') && has(out, 'data-testid="row-gate"'), "the gate is a ui/Row line");
  assert.ok(has(text(out), "Push to main waits for approval in Needs you"));
  assert.ok(has(tag(out, "changeset-approve"), 'aria-disabled="true"'), "approve is off while the gate waits");
  assert.ok(has(out, 'data-testid="gate-approve"') && has(out, 'data-testid="gate-cancel"'), "Approve and Cancel on the gate");
  const waiting = { branch: "main", state: "waiting" as const };
  assert.equal(approveBlocked(waiting), true);
  assert.equal(approveBlocked({ ...waiting, state: "cancelled" }), true);
  assert.equal(approveBlocked({ ...waiting, state: "cleared" }), false);
  assert.equal(approveBlocked(null), false, "no gate, no block");
  assert.ok(has(blockedReason(waiting), "Gate") && has(blockedReason({ ...waiting, state: "cancelled" }), "first"));
  assert.equal(blockedReason({ ...waiting, state: "cleared" }), "");
  assert.equal(gateWords({ branch: "main", state: "cleared" }), "Push to main is approved");
  assert.equal(gateWords({ branch: "main", state: "cancelled" }), "Push to main was cancelled");
  assert.equal(needsGate({ isRepo: true, protected: true }), true);
  assert.equal(needsGate({ isRepo: true, protected: false }), false);
  assert.equal(needsGate({ isRepo: false, protected: true }), false);
  assert.equal(needsGate(undefined), false);
});

test("GateRow: waiting offers Approve and Cancel, cleared shows a check and no buttons, cancelled can ask again", () => {
  const s = sample();
  const wait = html(s, <GateRow gate={{ branch: "main", state: "waiting" }} onApprove={() => undefined} onCancel={() => undefined} />);
  assert.ok(has(wait, 'role="status"') && has(wait, 'data-testid="row-gate-trailing"') && has(wait, 'data-testid="row-gate-leading"'));
  const done = html(s, <GateRow gate={{ branch: "main", state: "cleared" }} onApprove={() => undefined} onCancel={() => undefined} />);
  assert.ok(!has(done, 'data-testid="gate-approve"') && has(text(done), "Push to main is approved"));
  const off = html(s, <GateRow gate={{ branch: "main", state: "cancelled" }} onApprove={() => undefined} onCancel={() => undefined} onAsk={() => undefined} />);
  assert.ok(has(off, 'data-testid="gate-ask"') && !has(off, 'data-testid="gate-approve"'));
});

test("request changes sends the note; discard asks first and then discards", async () => {
  const s = sample();
  const req = header(s, "request");
  assert.ok(has(req, 'aria-label="Note to the agent"') && has(req, 'data-testid="changeset-request-go"') && has(req, 'data-testid="changeset-request-cancel"'));
  const r = await requestChanges(s.data.call, s.changesetId, "  Put the fee in a table.  ");
  assert.ok(r.ok && r.value.sent === 1);
  assert.deepEqual(lastCall(s), { cap: "changesets.request_changes", input: { changesetId: "cs_rivera", note: "Put the fee in a table." } });
  assert.equal(s.changeset().state, "changes_requested");
  assert.ok(has(text(header(s)), "Sent back. The agent is working on your notes."));
  assert.ok(has(header(s), 'aria-label="Approve and commit"'), "a sent back changeset can still be approved when it comes back");

  const t = sample();
  const dis = header(t, "discard");
  assert.ok(has(dis, 'role="alertdialog"') && has(text(dis), "Discard these changes?"), "the confirm line");
  assert.equal(screensById.get("files.changeset-header")?.actions["discard"]?.confirm, "Discard these changes?", "the words are the screen's own");
  assert.ok(has(dis, 'data-testid="changeset-discard-go"') && has(dis, 'data-testid="changeset-discard-cancel"'));
  assert.equal(t.calls.length, 0, "showing the confirm calls nothing");
  const d = await discardChangeset(t.data.call, t.changesetId);
  assert.ok(d.ok && d.value.discarded);
  assert.equal(lastCall(t).cap, "changesets.discard");
  const gone = header(t);
  assert.ok(has(text(gone), "Discarded. Nothing was changed.") && !has(gone, 'aria-label="Discard"'));
  assert.equal(requestLabel(0), "Request changes");
  assert.equal(requestLabel(2), "Request changes (2)");
});

test("review externally asks another agent and says who; a failed press comes back as words, never a code", async () => {
  const s = sample();
  const r = await reviewExternally(s.data.call, s.changesetId, "agt_research");
  assert.ok(r.ok);
  assert.deepEqual(lastCall(s), { cap: "changesets.review_externally", input: { changesetId: "cs_rivera", actorId: "agt_research" } });
  s.failNext("changesets.discard", "validation.conflict");
  const bad = await discardChangeset(s.data.call, s.changesetId);
  assert.ok(!bad.ok);
  assert.ok(!has(bad.error, "validation.") && has(bad.error, "Someone changed this first"));
  assert.ok(has(errorWords({ code: "auth.forbidden" }, "approve"), "cannot approve"));
  assert.ok(has(errorWords(new Error("x"), "push"), "Could not push"));
});

test("a changeset with conflicts comes back as the file to open, not as an approval", async () => {
  const s = sample();
  const bad = await approveChangeset((cap, input) => (cap === "changesets.approve" ? Promise.resolve({ approved: false, versionIds: [], conflicts: ["consult-prep.md"] }) : s.data.call(cap, input)), { changesetId: "cs_rivera", message: "", push: false, key: "k" });
  assert.ok(!bad.ok && has(bad.error, "1 file changed since") && has(bad.error, "consult-prep.md"));
});

test("Harbor Studio: Proofer changed 2 files, in the same header", () => {
  const s = sample({ variant: "harbor" });
  const out = header(s);
  assert.ok(has(text(out), "Proofer changed 2 files") && has(text(out), "+11") && has(text(out), "−3"));
  assert.equal(changedLine("Proofer", 1), "Proofer changed 1 file");
});

test("git row: the branch with its state, Pull, Push and Sync, a branch menu; not a repository offers to start one", async () => {
  const s = sample({ repo: true });
  const out = html(s, <GitRow folderId={s.folderId} />);
  assert.ok(has(out, 'data-testid="git-row"') && has(out, 'data-testid="row-git"') && has(text(out), "docs-update"), "the branch on one Row line");
  for (const label of ["Pull", "Push", "Sync", "Switch branch"]) assert.ok(has(out, `aria-label="${label}"`), label);
  assert.ok(has(text(out), "No changes"));
  assert.ok(has(tag(out, "git-branches"), 'aria-haspopup="menu"'), "the branch control opens a menu");
  const plain = html(sample(), <GitRow folderId="fld_rivera" />);
  assert.ok(has(text(plain), "Not a git folder") && has(plain, 'data-testid="git-init"'));
  assert.ok((await initRepo(s.data.call, s.folderId)).ok);
  assert.equal(lastCall(s).cap, "git.init");
  const prot = html(sample({ protectedBranch: true }), <GitRow folderId="fld_rivera" />);
  assert.ok(has(text(prot), "main") && has(text(prot), "Protected"), "a protected branch says so");
  const q = sample({ repo: true });
  const b = await switchBranch(q.data.call, q.folderId, "main");
  assert.ok(b.ok);
  assert.deepEqual(lastCall(q), { cap: "git.branch", input: { folderId: "fld_rivera", action: "switch", name: "main" } });
  assert.ok(has(text(html(q, <GitRow folderId={q.folderId} />)), "Protected"), "after the switch the row reads the new branch");
  assert.ok((await pushBranch(q.data.call, q.folderId, "k9", "main")).ok);
  assert.deepEqual(lastCall(q).input, { folderId: "fld_rivera", branch: "main", idempotencyKey: "k9" });
});

test("branch choices: local branches first, the current one marked, protected ones named", () => {
  const out = branchChoices({ current: "docs-update", branches: [{ name: "origin/x", remote: true, sha: "1", protected: false }, { name: "main", remote: false, sha: "2", protected: true }, { name: "docs-update", remote: false, sha: "3", protected: false }] });
  assert.deepEqual(out.map((b) => [b.name, b.current, b.protected]), [["main", false, true], ["docs-update", true, false], ["origin/x", false, false]]);
});

test("history: the shared tab lists versions newest first with who and why; restore adds a version; naming sticks", async () => {
  const s = sample();
  const out = html(s, <HistoryPanel fileId={s.fileIds.agent} />);
  assert.ok(has(out, 'data-testid="history-tab"') && has(out, 'data-testid="history-panel"'));
  const at = (t: string): number => { const i = text(out).indexOf(t); assert.ok(i >= 0, t); return i; };
  assert.ok(at("Allow texts in the daytime") < at("Before the Lab") && at("Before the Lab") < at("First draft"), "newest first, the named version shows its name");
  assert.ok(has(text(out), "Irfad Imtiaz") && has(text(out), "Maya Chen"), "who");
  assert.ok(has(out, 'data-testid="history-name-open"') && has(out, 'data-testid="history-restore"'));
  const versions = historyVersions([{ versionId: "a", n: 1, by: "usr_maya", at: 0, reason: "r" }, { versionId: "b", n: 2, by: "usr_irfad", at: 1, name: "Named" }], s.data.nameOf);
  assert.deepEqual(versions.map((v) => [v.id, v.why, v.undoable]), [["a", "r", false], ["b", "Named", true]]);
  const r = await restoreVersion(s.data.call, s.fileIds.agent, "ver_a2");
  assert.ok(r.ok);
  assert.deepEqual(lastCall(s), { cap: "files.restore_version", input: { fileId: "file_agent_md", versionId: "ver_a2" } });
  assert.equal(s.version(s.fileIds.agent), 5, "restoring adds a version, it never rewrites history");
  assert.ok(has(text(html(s, <HistoryPanel fileId={s.fileIds.agent} />)), "Restored version 2"));
  const n = await nameVersion(s.data.call, s.fileIds.agent, "ver_a1", "  Day one  ");
  assert.ok(n.ok);
  assert.deepEqual(lastCall(s).input, { fileId: "file_agent_md", versionId: "ver_a1", name: "Day one" });
  assert.ok(has(text(html(s, <HistoryPanel fileId={s.fileIds.agent} />)), "Day one"));
  assert.equal(screensById.get("files.history")?.actions["restore"]?.confirm, "Restore this version?", "the screen asks first; the tab does");
  const bad = sample();
  bad.failNext("files.restore_version", "auth.forbidden");
  const denied = await restoreVersion(bad.data.call, bad.fileIds.agent, "ver_a2");
  assert.ok(!denied.ok && has(denied.error, "cannot restore"));
});

test("diff tabs: a changeset's files with their changes and the comment; a version compare; a commit", () => {
  const s = sample();
  const out = html(s, <ChangesetDiff changesetId={s.changesetId} path="consult-prep.md" />);
  assert.ok(has(out, 'data-testid="changeset-diff"') && has(out, 'data-testid="diff-files"'), "the shared tab with its file list");
  for (const p of ["rivera-engagement-letter.docx", "consult-prep.md", "id-scan.png"]) assert.ok(has(out, `data-testid="row-diff-file-${p}"`), `a line for ${p}`);
  assert.ok(has(tag(out, "row-diff-file-consult-prep.md"), 'aria-selected="true"'), "one file is open");
  assert.ok(has(text(out), "+24 \u22125") && has(text(out), "image"), "each line says its counts, a picture says image");
  assert.ok(has(out, 'data-testid="diff-paragraphs"'), "a markdown note reads as prose with word marks, not code lines");
  assert.ok(has(out, 'data-testid="diff-revert-h_prep"') && has(out, 'data-testid="diff-comment-h_prep"'), "revert and comment on each change");
  assert.ok(has(out, 'data-testid="diff-note-reply-cmt_1"') && has(text(out), "Reply"), "the comment thread has its Reply link");
  assert.ok(has(text(out), "Ask for a photo ID before the consult."), "an added line");
  assert.ok(has(text(out), "Please put this above the intake form line.") && has(text(out), "Maya Chen"), "the comment sits on its change");
  assert.ok(!has(text(out), "Docs changed 3 files"), "no duplicate of the header inside the diff");
  const pic = html(s, <ChangesetDiff changesetId={s.changesetId} path="id-scan.png" />);
  assert.ok(has(pic, 'data-testid="diff-image"'), "a picture opens as before and after");
  const letter = html(s, <ChangesetDiff changesetId={s.changesetId} />);
  assert.ok(has(letter, 'data-testid="diff-para-removed"') && has(letter, 'data-testid="diff-para-added"') && has(text(letter), "Retainer:"), "a letter reads as prose, removed and added paragraphs");
  const one = html(s, <FileDiff fileId={s.fileIds.agent} name="AGENT.md" />);
  assert.ok(has(one, 'data-testid="file-diff"') && has(text(one), "- Promise an outcome."), "a version compare is bare: the changed line in the page");
  assert.ok(!has(one, 'data-testid="diff-revert-'), "no per-change buttons in a version compare");
  const commit = html(s, <CommitDiff folderId={s.folderId} sha="d4a91c7" />);
  assert.ok(has(commit, 'data-testid="commit-diff"') && has(text(commit), "Raise the retainer to $2,400"));
  const same = sample();
  assert.ok(has(html(same, <FileDiff fileId={same.fileIds.toml} name="agent.toml" from="ver_t2" to="ver_t2" />), "These two versions are the same."));
});

test("diff model: hunks keep their context, an image rides in one hunk, a commit's hunks go to its first file", () => {
  const h = hunkOf({ hunkId: "h", oldStart: 3, oldLines: 3, newStart: 3, newLines: 4, lines: [{ op: "ctx", text: "a" }, { op: "del", text: "b" }, { op: "add", text: "c" }, { op: "add", text: "d" }, { op: "ctx", text: "e" }] });
  assert.deepEqual(h, { id: "h", context: "Line 3", removed: "b", added: "c\nd", before: "a", after: "e" });
  const img = diffFileOf("x.png", { kind: "image", added: 0, removed: 0, hunks: [], images: { left: "L", right: "R" } });
  assert.equal(img.body, "image");
  assert.deepEqual(img.hunks.map((x) => [x.removed, x.added]), [["L", "R"]]);
  assert.equal(diffFileOf("a.bin", { kind: "binary", added: 0, removed: 0, hunks: [] }).body, "text");
  const s = sample();
  const show = s.replica.run("git.show", { folderId: "f", sha: "abc" });
  assert.ok(show);
  const files = commitFiles(show.data);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.hunks.length, 1);
});

test("lint bar: lines against the limit, Inherits VYRE.md, overrides, secrets; each is a button with a dot", () => {
  const s = sample();
  const out = html(s, <LintBar fileId={s.fileIds.agent} name="AGENT.md" text={AGENT_MD} onJump={() => undefined} />);
  assert.ok(has(out, 'data-testid="lint-bar"') && has(out, 'aria-label="Checks for AGENT.md"') && has(out, 'role="status"'));
  const lines = AGENT_MD.split("\n").length - 1;
  assert.ok(has(text(out), `${lines} / 150 lines`), "lines against the limit");
  for (const t of ["Inherits VYRE.md", "1 override", "Nothing repeated from agent.toml", "No secrets"]) assert.ok(has(text(out), t), t);
  for (const k of ["len", "inherits", "overrides", "secrets"]) assert.ok(has(out, `data-testid="lint-${k}"`), k);
  assert.ok(!has(out, 'data-testid="lint-view"'), "the Text and Form switch is for agent.toml only");
  const long = html(s, <LintBar fileId={s.fileIds.agent} name="AGENT.md" text={`${AGENT_MD}${"more\n".repeat(160)}`} onJump={() => undefined} />);
  assert.ok(has(text(long), "/ 150 lines"));
  const bad = html(s, <LintBar fileId={s.fileIds.agent} name="AGENT.md" text={`${AGENT_MD}key = sk-abcdefghijkl\n`} onJump={() => undefined} />);
  assert.ok(has(text(bad), "1 possible secret"));
});

test("lint bar on agent.toml: schema, the Text and Form switch with a real checked state", () => {
  const s = sample();
  const form = html(s, <LintBar fileId={s.fileIds.toml} name="agent.toml" text={AGENT_TOML} view="form" onView={() => undefined} onJump={() => undefined} />);
  assert.ok(has(text(form), "Schema valid") && has(form, 'data-testid="lint-schema"'));
  assert.ok(has(form, 'role="radiogroup"') && has(tag(form, "lint-view-form"), 'aria-checked="true"') && has(tag(form, "lint-view-text"), 'aria-checked="false"'));
  const broken = html(s, <LintBar fileId={s.fileIds.toml} name="agent.toml" text={AGENT_TOML.replace("temperature = 0.2", "temperature = hot")} view="text" onView={() => undefined} onJump={() => undefined} />);
  assert.ok(has(text(broken), "1 schema error"));
});

test("lint items: severity, the lines a press jumps to, and what blocks a save", () => {
  const ok = lintItems({ file: "agent_md", lines: 40, state: "ok", inherits: true, overrides: [], secrets: [], problems: [] });
  assert.deepEqual(ok.map((i) => [i.k, i.sev]), [["len", "ok"], ["inherits", "ok"], ["overrides", "ok"], ["dups", "ok"], ["secrets", "ok"]]);
  const noisy = lintItems({ file: "agent_md", lines: 210, state: "red", overrides: [{ line: 4, text: "Override: a" }, { line: 9, text: "Override: b" }], secrets: [{ line: 12, kind: "API key" }], problems: [{ severity: "warn", line: 2, rule: "r", message: "m" }] });
  const by = Object.fromEntries(noisy.map((i) => [i.k, i]));
  assert.equal(by["len"]?.sev, "err");
  assert.equal(by["inherits"]?.sev, "warn", "no Inherits VYRE.md line");
  assert.equal(by["overrides"]?.sev, "info");
  assert.deepEqual(by["overrides"]?.list.map((p) => p.line), [4, 9], "several lines open a menu");
  assert.equal(by["secrets"]?.line, 12, "one place jumps to it");
  assert.equal(by["problems"]?.label, "1 problem");
  assert.equal(saveBlocked({ file: "agent_md", lines: 1, state: "red", overrides: [], secrets: [], problems: [] }), true);
  assert.equal(saveBlocked({ file: "agent_md", lines: 1, state: "amber", overrides: [], secrets: [], problems: [] }), false);
  assert.equal(saveBlocked(undefined), false);
  assert.deepEqual(lineRange("ab\ncde\nf", 2), { start: 3, end: 6 });
});

test("agent.toml reader: sections, keys, multi-line lists, and an edit rewrites only its own line", () => {
  const entries = parseToml(AGENT_TOML);
  assert.deepEqual(entries.map((e) => `${e.section}.${e.key}`), ["model.primary", "model.fallback", "model.temperature", "limits.max_steps", "limits.daily_budget", "limits.ask_before_send", "handoff.to"]);
  assert.deepEqual(tomlGroups(entries).map((g) => [g.section, g.entries.length]), [["model", 3], ["limits", 3], ["handoff", 1]]);
  const multi = parseToml('[a]\nlist = [\n  "x",\n  "y",\n]\nafter = 1\n');
  assert.deepEqual(multi.map((e) => [e.key, e.line, e.end]), [["list", 2, 5], ["after", 6, 6]]);
  const limit = entries.find((e) => e.key === "daily_budget");
  assert.ok(limit);
  const next = setTomlValue(AGENT_TOML, limit, "20");
  assert.equal(next.split("\n").length, AGENT_TOML.split("\n").length);
  assert.deepEqual(next.split("\n").filter((l, i) => l !== AGENT_TOML.split("\n")[i]), ["daily_budget = 20"]);
  assert.equal(tomlKind('"x"'), "string");
  assert.equal(tomlKind("true"), "bool");
  assert.equal(tomlKind("0.2"), "number");
  assert.equal(tomlKind('["a"]'), "list");
  assert.equal(rawFromForm("string", 'say "hi"'), '"say \\"hi\\""');
  assert.equal(rawFromForm("number", " 3 "), "3");
});

test("Form view: the keys of each table as Row lines, a switch for true and false, a text box for the rest", () => {
  const s = sample();
  const out = html(s, <TomlForm text={AGENT_TOML} onChange={() => undefined} />);
  assert.ok(has(out, 'data-testid="toml-form"') && has(text(out), "Model") && has(text(out), "Limits") && has(text(out), "Handoff"));
  assert.ok(has(out, 'data-testid="row-toml:4"') && has(tag(out, "toml-select:4"), 'aria-haspopup="menu"'), "primary is a dropdown");
  assert.ok(has(text(out), "Claude Sonnet 5.5") && has(text(out), "Claude Haiku 4.5"), "model ids read as names");
  assert.ok(has(out, 'data-testid="toml-field:6"'), "a number stays a text box");
  assert.ok(has(text(out), "Daily budget") && has(text(out), "Ask before send"), "keys read as words");
  const sw = out.match(/<[^>]*role="switch"[^>]*>/);
  assert.ok(sw && has(sw[0], 'aria-checked="true"'), "ask_before_send is on");
  assert.ok(has(text(html(s, <TomlForm text="" onChange={() => undefined} />)), "Nothing in agent.toml yet"));
});

test("diff before save: the draft against the saved text, as hunks with two lines of context", () => {
  const draft = AGENT_MD.replace("No exclamation marks.", "No exclamation marks. Keep replies under five lines.");
  const hunks = lineHunks(AGENT_MD, draft);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0]?.removed, "- No exclamation marks.");
  assert.equal(hunks[0]?.added, "- No exclamation marks. Keep replies under five lines.");
  assert.ok(hunks[0]?.before && hunks[0]?.after, "context above and below");
  assert.deepEqual(lineHunks("a", "a"), []);
  const f = draftDiff("AGENT.md", AGENT_MD, draft);
  assert.deepEqual([f.added, f.removed], [1, 1]);
  assert.equal(lineHunks("", "x").length, 1);
  const spread = lineHunks("1\n2\n3\n4\n5\n6\n7\n8\n9\n10", "1\nTWO\n3\n4\n5\n6\n7\n8\nNINE\n10");
  assert.equal(spread.length, 2, "two separate changes are two hunks");
});

test("editor: Save is off with nothing changed, shows the lint bar and the file, and saves with the version it started from", async () => {
  const s = sample();
  const out = html(s, <AgentFileEditor fileId={s.fileIds.agent} name="AGENT.md" saved={AGENT_MD} version={4} />);
  assert.ok(has(out, 'data-testid="agent-file-editor"') && has(out, 'data-testid="lint-bar"') && has(out, 'aria-label="Text of AGENT.md"'));
  assert.ok(has(tag(out, "agent-file-save"), 'aria-disabled="true"') && has(text(out), "Version 4"), "nothing to save");
  const toml = html(s, <AgentFileEditor fileId={s.fileIds.toml} name="agent.toml" saved={AGENT_TOML} version={2} />);
  assert.ok(has(toml, 'data-testid="lint-view"'), "agent.toml has the Form switch");
  const edited = AGENT_MD.replace("No exclamation marks.", "No exclamation marks. Keep replies short.");
  const r = await saveFile(s.data.call, { fileId: s.fileIds.agent, text: edited, baseVersion: 4, reason: " Shorter ", acceptWarnings: false });
  assert.ok(r.ok && r.value.n === 5);
  assert.deepEqual(lastCall(s).input, { fileId: "file_agent_md", text: edited, baseVersion: 4, reason: "Shorter" });
  assert.equal(s.text(s.fileIds.agent), edited);
  const stale = await saveFile(s.data.call, { fileId: s.fileIds.agent, text: edited + "x", baseVersion: 4, reason: "", acceptWarnings: false });
  assert.ok(!stale.ok && has(stale.error, "Someone changed this first"), "a save over a newer version is refused, not lost");
  assert.equal(s.version(s.fileIds.agent), 5);
});

test("a red check blocks the save, an amber one saves only with the warnings accepted", async () => {
  const s = sample();
  const red = await saveFile(s.data.call, { fileId: s.fileIds.agent, text: `${AGENT_MD}\nkey = sk-abcdefghijkl\n`, baseVersion: 4, reason: "", acceptWarnings: true });
  assert.ok(!red.ok, "a secret in the file is refused");
  assert.equal(s.version(s.fileIds.agent), 4);
  const long = `${AGENT_MD}${"- another rule\n".repeat(140)}`;
  const amber = await saveFile(s.data.call, { fileId: s.fileIds.agent, text: long, baseVersion: 4, reason: "", acceptWarnings: false });
  assert.ok(!amber.ok, "over the limit asks for acceptance");
  const accepted = await saveFile(s.data.call, { fileId: s.fileIds.agent, text: long, baseVersion: 4, reason: "", acceptWarnings: true });
  assert.ok(accepted.ok && accepted.value.lint.state === "amber");
  assert.deepEqual(lastCall(s).input, { fileId: "file_agent_md", text: long, baseVersion: 4, acceptWarnings: true });
  const t = sample({ secret: true });
  const red2 = html(t, <AgentFileEditor fileId={t.fileIds.toml} name="agent.toml" saved={t.text(t.fileIds.toml)} version={2} />);
  assert.ok(has(text(red2), "1 possible secret"), "the saved file already holds a secret and the bar says so");
});

test("every screen the surfaces implement is in the registry with the capabilities they call", () => {
  const want: Record<string, string[]> = {
    "files.changeset-header": ["changesets.approve", "changesets.request_changes", "changesets.discard", "changesets.review_externally"],
    "files.git-row": ["git.commit", "git.branch", "git.pull", "git.push", "git.sync", "git.init"],
    "files.history": ["files.restore_version", "files.name_version"],
    "files.lint-bar": ["files.save"],
    "files.diff": ["changesets.revert_change", "changesets.comments.add"],
  };
  for (const [id, caps] of Object.entries(want)) {
    const screen = screensById.get(id);
    assert.ok(screen, id);
    const have = Object.values(screen.actions).map((a) => a.cap);
    for (const c of caps) assert.ok(have.includes(c), `${id} has ${c}`);
  }
});

test("agent file page: header with where it lives and who saved it, View and Edit, the shared Ask, the chips, the suggestion card, the rendered body", () => {
  const s = sample();
  const out = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} />);
  assert.ok(has(text(out), "AGENT.md") && has(text(out), "Agents/Intake") && has(text(out), "Irfad Imtiaz") && has(text(out), "Oct 24"), "name, path, author, date");
  assert.ok(has(tag(out, "agent-file-mode-view"), 'aria-checked="true"') && has(tag(out, "agent-file-mode-edit"), 'aria-checked="false"'), "opens on View");
  for (const id of ["agent-file-find", "agent-file-info", "agent-file-history", "agent-file-ask"]) assert.ok(has(out, `data-testid="${id}"`), id);
  assert.ok(has(text(out), "Nothing repeated from agent.toml") && has(text(out), "No secrets"), "the chips");
  assert.ok(has(out, 'data-testid="suggestion-card"') && has(text(out), "Intake suggests 2 changes to AGENT.md"), "the suggestion");
  assert.ok(has(out, 'data-testid="suggestion-dismiss"') && has(text(out), "Apply to AGENT.md"));
  assert.ok(has(out, 'data-testid="agent-file-view"') && has(text(out), "Books consults") && !has(out, 'aria-label="Text of AGENT.md"'), "View is the rendered note");
  const edit = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} edit />);
  assert.ok(has(edit, 'aria-label="Text of AGENT.md"'), "Edit is the text box");
});

test("suggestions: the diff reads as hunks; Apply and Dismiss call the agent suggestion capabilities", async () => {
  const s = sample();
  const hunks = suggestionHunks((await import("../src/places/files/review/sample.ts")).SUGGESTION_DIFF);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0]?.removed, "- No exclamation marks.");
  assert.equal(hunks[1]?.added, "- Quote a fee before the consult.");
  assert.ok(has(html(s, <SuggestionCard agentId="agt_intake" file="AGENT.md" />), 'data-testid="suggestion-card"'));
  const r = await acceptSuggestion(s.data.call, "sug_1");
  assert.ok(r.ok);
  assert.deepEqual(lastCall(s), { cap: "agents.suggestion.accept", input: { suggestionId: "sug_1" } });
  assert.equal(s.suggestionState(), "accepted");
  assert.equal(html(s, <SuggestionCard agentId="agt_intake" file="AGENT.md" />), "", "an applied suggestion leaves the card");
  const t = sample();
  assert.ok((await dismissSuggestion(t.data.call, "sug_1")).ok);
  assert.equal(t.suggestionState(), "dismissed");
});

test("apply: the suggestion's diff goes into the text, so the editor shows the new file", async () => {
  const s = sample();
  const diff = (await import("../src/places/files/review/sample.ts")).SUGGESTION_DIFF;
  const next = applySuggestion(AGENT_MD, diff);
  assert.ok(has(next, "- No exclamation marks. Keep replies under five lines."), "the changed line");
  assert.ok(!has(next, "\n- No exclamation marks.\n"), "the old line is gone");
  assert.ok(has(next, "- Promise an outcome.\n- Quote a fee before the consult."), "an added line lands after its context");
  assert.equal(next.split("\n").length, AGENT_MD.split("\n").length + 1);
  assert.equal(applySuggestion("nothing alike\n", diff), "nothing alike\n", "a hunk that no longer matches is left out");
  const r = await acceptSuggestion(s.data.call, "sug_1");
  assert.ok(r.ok);
  assert.equal(s.version(s.fileIds.agent), 5, "the kernel adds a version");
  assert.equal(s.text(s.fileIds.agent), next, "and the file holds what the editor shows");
  const page = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} edit />);
  assert.ok(has(text(page), "v5"), "the page reads the new version");
});

test("agent file page: v5 check, History in the shared side pane with the version banner, find and info", () => {
  const s = sample();
  const closed = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} />);
  assert.ok(has(closed, 'data-testid="agent-file-version"') && has(text(closed), "v4"), "the version check");
  assert.ok(!has(closed, 'data-testid="side-pane"'), "History is closed until asked");
  const open = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} startHistory startViewing="ver_a3" />);
  assert.ok(has(open, 'data-testid="side-pane"') && has(open, 'data-testid="history-tab"'), "the shared side pane holds the history tab");
  assert.ok(has(open, 'data-testid="version-banner"') && has(open, 'data-testid="version-restore"') && has(open, 'data-testid="version-back"') && has(open, 'data-testid="version-changes"'), "the banner over the page");
  assert.ok(has(text(open), "Viewing v3"), "which version");
  assert.ok(has(open, 'data-testid="file-diff"'), "showing what changed since");
  assert.ok(!has(open, 'data-testid="agent-file-editor"'), "the editor steps aside while an old version shows");
});

test("lint chips: each carries its dot, in the color of its severity", () => {
  const s = sample();
  const out = html(s, <LintBar fileId={s.fileIds.agent} name="AGENT.md" text={AGENT_MD} onJump={() => undefined} />);
  assert.ok(/data-testid="lint-len"[\s\S]*?var\(--ok\)/.test(out), "a green dot on a passing chip");
  const bad = html(s, <LintBar fileId={s.fileIds.agent} name="AGENT.md" text={`${AGENT_MD}key = sk-abcdefghijkl\n`} onJump={() => undefined} />);
  assert.ok(/data-testid="lint-secrets"[\s\S]*?var\(--danger\)/.test(bad), "a red dot on a secret");
});

test("agent.toml picks: a model or an effort is a choice from a list, a list key holds one pick", () => {
  assert.deepEqual(choiceOf("primary", '"claude-sonnet-5-5"'), { id: "claude-sonnet-5-5", list: false });
  assert.deepEqual(choiceOf("fallback", '["claude-haiku-4-5"]'), { id: "claude-haiku-4-5", list: true });
  assert.equal(choiceOf("temperature", "0.2"), null);
  assert.equal(choiceOf("primary", "something odd"), null);
  assert.equal(choiceRaw("x", true), '["x"]');
  assert.equal(choiceRaw("x", false), '"x"');
  assert.equal(humanKey("max_output_tokens"), "Max output tokens");
});

test("agent file header: the file-type tile and the more menu; the suggestion card is light with the agent's face and its footer", () => {
  const s = sample();
  const out = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} />);
  assert.ok(has(out, 'data-testid="agent-file-tile"') && has(text(out), "MD"), "the file-type tile");
  assert.ok(has(tag(out, "agent-file-more"), 'aria-haspopup="menu"'), "the ... menu");
  assert.equal(extOf("agent.toml"), "TOML");
  assert.equal(extOf("Makefile"), "FILE");
  assert.ok(has(text(out), "Nothing changes until you apply it. The old version stays in history."), "the card's footer");
  assert.ok(has(out, 'data-testid="suggestion-face"'), "the agent's face leads the card");
});

test("phone: History opens under the page, not over it", () => {
  const s = sample();
  const out = html(s, <AgentFilePage fileId={s.fileIds.agent} name="AGENT.md" path="Agents/Intake" agentId="agt_intake" saved={AGENT_MD} version={4} density="compact" startHistory />);
  assert.ok(has(out, 'data-testid="agent-file-history-pane"') && has(out, 'data-testid="history-tab"'), "the history sits in its own section");
  assert.ok(!has(out, 'data-testid="side-pane"'), "no side pane that would cover the page");
  assert.ok(has(out, 'data-testid="agent-file-history-hide"'));
});

test("the shell's review provider: every attempt gets its own idempotency key", () => {
  assert.notEqual(attemptKey(), attemptKey());
  assert.ok(attemptKey().length >= 8);
});
