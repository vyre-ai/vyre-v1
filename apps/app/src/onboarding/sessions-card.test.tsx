// The Bring your sessions card: each row shows name, folder, date and source; Select all and the count work; Import carries the count and is off at zero.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "./test-dom.ts";
import { SessionsCard } from "./SessionsCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

const HOUR = 3_600_000;
const found = () => [
  { provider: "claude", sessionId: "a1", sessionKey: "claude:a1", projectKey: "p", cwd: "/Users/maya/code/site", title: "Fix the login bug", updatedAt: String(Date.now() - 2 * HOUR) },
  { provider: "codex", sessionId: "b2", sessionKey: "codex:b2", projectKey: "q", cwd: "/Users/maya/code/api", title: "Add dark mode", updatedAt: String(Date.now() - 30 * HOUR) },
  { provider: "claude", sessionId: "c3", sessionKey: "claude:c3", projectKey: "p", cwd: "/Users/maya/code/site", title: "Older note", updatedAt: String(Date.now() - 400 * HOUR) },
];

async function open() {
  installDom();
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: async (cmd: string) => (cmd === "discover_session_sources" ? found().reverse() : {}) } };
  const call = (async () => ({})) as unknown as CapCall;
  const r = createRoot();
  await act(async () => { r.render(<SessionsCard call={call} onDone={() => undefined} />); });
  await flush();
  return r.container as never;
}

test("each row shows the session name, its folder, a relative date and the source, newest first", async () => {
  const root = await open();
  const first = textOf(find(root, "session-claude:a1"));
  assert.ok(first.includes("Fix the login bug") && first.includes("site") && first.includes("2 hours ago") && first.includes("Claude Code"), first);
  const second = textOf(find(root, "session-codex:b2"));
  assert.ok(second.includes("Add dark mode") && second.includes("api") && second.includes("Yesterday") && second.includes("Codex"), second);
  assert.ok(!textOf(root).includes("Local session"));
});

test("Select all ticks every row, the count follows, and Import names the count", async () => {
  const root = await open();
  assert.ok(textOf(find(root, "sessions-count")).includes("0 of 3 selected"));
  assert.equal(find(root, "sessions-import")?.props.disabled, true);
  await press(find(root, "sessions-all"));
  assert.ok(textOf(find(root, "sessions-count")).includes("3 of 3 selected"));
  assert.ok(textOf(find(root, "sessions-import")).includes("Import 3"));
  await press(find(root, "session-claude:a1"));
  assert.ok(textOf(find(root, "sessions-count")).includes("2 of 3 selected"));
  assert.deepEqual((find(root, "sessions-all")?.props.accessibilityState as { checked: unknown }).checked, "mixed");
  await press(find(root, "sessions-all"));
  assert.ok(textOf(find(root, "sessions-count")).includes("3 of 3 selected"), "from some, Select all ticks the rest");
});

test("the folder filter narrows the rows and Select all then covers only those", async () => {
  const root = await open();
  await press(find(root, "sessions-folder-api"));
  assert.equal(find(root, "session-claude:a1"), null);
  assert.ok(find(root, "session-codex:b2"));
  await press(find(root, "sessions-all"));
  assert.ok(textOf(find(root, "sessions-count")).includes("1 of 3 selected"));
});
