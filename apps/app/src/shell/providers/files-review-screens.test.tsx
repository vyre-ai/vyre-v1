// The Files review screens in the shell (spec 2.16, 3.5): a change set an agent staged opens with its header, git row and diff when its screen id is in the tab hash; two versions of a file, a commit and a
// history open the same way; an agent's AGENT.md and agent.toml open as the agent file page; and choosing anything else in the tree gives the body back to the list.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { createSampleReview } from "../../places/files/review/sample.ts";
import { createSampleFiles } from "../../places/files/list/sample.ts";
import { parseHash } from "../hash/hash.ts";
import { PlaceHashProvider } from "../hash/context.tsx";
import FilesPlace from "./files.tsx";
import { reviewData } from "./files-review.ts";
import { loadAgentFile, reviewKind } from "./files-review-screens.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime } from "./runtime.tsx";

const html = (el: ReactElement): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

function rig() {
  const review = createSampleReview({ repo: true });
  const files = createSampleFiles();
  const opened: string[] = [];
  const calls: Array<{ cap: string; input: unknown }> = [];
  const screens = { ...files.data.screens, capQuery: (cap: string, input: Record<string, unknown>) => review.data.live(cap as never, input as never) } as unknown as ShellRuntime["screens"];
  const call: ShellRuntime["call"] = async (cap, input) => { calls.push({ cap, input }); return review.data.call(cap, input); };
  const rt = sampleRuntime({ screens, call, opened });
  return { review, rt, opened, calls };
}
const place = (rt: ShellRuntime, hash: string): string => html(<ShellRuntimeProvider value={rt}><PlaceHashProvider hash={hash} opened={() => undefined}><FilesPlace place="files" /></PlaceHashProvider></ShellRuntimeProvider>);

test("the hash names the review screen: a change set, a compare, a commit or a history", () => {
  assert.equal(reviewKind(parseHash("screen=files.diff&changesetId=cs_1")), "changeset");
  assert.equal(reviewKind(parseHash("screen=files.diff&fileId=fil_1&from=v1&to=v2")), "compare");
  assert.equal(reviewKind(parseHash("screen=files.commit-diff&folder=fld_1&sha=abc")), "commit");
  assert.equal(reviewKind(parseHash("screen=files.history&fileId=fil_1")), "history");
  assert.equal(reviewKind(parseHash("screen=files.diff")), null, "a diff with nothing to diff is not a screen");
  assert.equal(reviewKind(parseHash("screen=files.viewer&fileId=fil_1")), null);
});

test("Review changes opens the change set with its header, git row and diff in the Files body, not the list", () => {
  const { review, rt } = rig();
  const out = place(rt, `screen=files.diff&changesetId=${review.changesetId}`);
  assert.ok(out.includes('data-testid="files-review-changeset"'), "the review screen is the body");
  assert.ok(!out.includes('data-testid="files-list"'), "not the list");
});

test("a history and a commit open their screens", () => {
  const { review, rt } = rig();
  assert.ok(place(rt, `screen=files.history&fileId=${review.fileIds.agent}`).includes('data-testid="files-review-history"'));
  assert.ok(place(rt, `screen=files.commit-diff&folder=${review.folderId}&sha=abc1234`).includes('data-testid="files-review-commit"'));
});

test("the review components' clicks go through the shell: Review changes, Compare, a commit and History write their screen ids", () => {
  const { rt, opened } = rig();
  const nav = reviewData(rt).nav;
  nav.openChangeset("cs_1");
  nav.compare("fil_1", "v1", "v2");
  nav.openCommit("fld_1", "abc");
  nav.openHistory?.("fil_1");
  assert.deepEqual(opened, ["files.diff", "files.diff", "files.commit-diff", "files.history"]);
});

test("Ask about this file opens the one Ask door: the agent and the file, which the Chats place turns into the person's Ask thread", () => {
  const opens: Array<{ screen?: string; args?: Record<string, unknown> }> = [];
  const base = sampleRuntime({ screens: createSampleFiles().data.screens, call: async () => ({}) });
  const rt: ShellRuntime = { ...base, open: (t) => void opens.push(t as { screen?: string; args?: Record<string, unknown> }) };
  reviewData(rt).nav.ask?.("agt_assistant", "chat", { kind: "file", id: "fil_1", title: "AGENT.md" });
  assert.deepEqual(opens, [{ screen: "chats.conversation", args: { with: "agt_assistant", about: "file:fil_1" } }]);
});

test("an agent's agent.toml is found as the agent file; any other file is not", async () => {
  const answer = (name: string, text: string | undefined) => async (cap: string): Promise<unknown> => {
    if (cap === "files.get") return { file: { fileId: "fil_1", folderId: "fld_intake", name, version: 3 } };
    if (cap === "agents.list") return { agents: [{ agentId: "agt_intake", name: "Intake", folderId: "fld_intake" }, { agentId: "agt_docs", name: "Docs", folderId: "fld_docs" }] };
    if (cap === "files.read") return { ...(text !== undefined ? { text } : {}), version: 4 };
    throw new Error(cap);
  };
  assert.deepEqual(await loadAgentFile(answer("agent.toml", "name = 'Intake'"), "fil_1"), { name: "agent.toml", version: 4, text: "name = 'Intake'", agentId: "agt_intake", agentName: "Intake" });
  assert.equal((await loadAgentFile(answer("AGENT.md", "# Intake"), "fil_1"))?.name, "AGENT.md");
  assert.equal(await loadAgentFile(answer("notes.md", "x"), "fil_1"), null, "an ordinary file opens in the viewer");
  assert.equal(await loadAgentFile(answer("agent.toml", undefined), "fil_1"), null, "a file that cannot be read as text opens in the viewer");
  const stray = async (cap: string): Promise<unknown> => (cap === "files.get" ? { file: { fileId: "fil_1", folderId: "fld_other", name: "agent.toml", version: 1 } } : { agents: [{ agentId: "agt_intake", name: "Intake", folderId: "fld_intake" }] });
  assert.equal(await loadAgentFile(stray, "fil_1"), null, "an agent.toml outside any agent's folder is just a file");
});
