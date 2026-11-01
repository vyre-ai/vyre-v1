// The Bring your sessions card: each row shows name, folder, date and source; Select all and the count work; Import carries the count and is off at zero.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "./test-dom.ts";
import { SessionsCard } from "./SessionsCard.tsx";
import type { CapCall } from "../shell/session/caps.ts";

const HOUR = 3_600_000;
// The clock reads midday today, so "2 hours ago" never crosses midnight into "Yesterday" whenever the suite runs.
const realNow = Date.now;
const MIDDAY = new Date(); MIDDAY.setHours(12, 0, 0, 0);
Date.now = () => MIDDAY.getTime();
test.after(() => { Date.now = realNow; });
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
  assert.equal(find(root, "sessions-all")?.props["aria-checked"], "mixed");
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

test("when the import is done the card says Imported 3, They are in Chats, links there, and Continue (the gate) finishes the step", async () => {
  installDom();
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: async (cmd: string, args?: { sessionKey?: string }) => {
    if (cmd === "discover_session_sources") return found();
    // read_session_source answers { source, text }: the transcript as the provider's own JSON lines
    const source = found().find((s) => s.sessionKey === args?.sessionKey)!;
    const line = source.provider === "codex"
      ? { type: "response_item", timestamp: "2026-01-01T00:00:00Z", payload: { type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "hi" }] } }
      : { type: "user", uuid: "m1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } };
    return { source, text: JSON.stringify(line) };
  } } };
  const calls: string[] = [];
  const call = (async (cap: string) => { calls.push(cap); return {}; }) as unknown as CapCall;
  let done = 0, chats = 0;
  const gates: unknown[] = [];
  const r = createRoot();
  await act(async () => { r.render(<SessionsCard call={call} onDone={() => { done++; }} gate={(save) => { gates.push(save); }} onOpenChats={() => { chats++; }} />); });
  await flush();
  const root = r.container as never;
  await press(find(root, "sessions-all"));
  await press(find(root, "sessions-import"));
  await flush();
  assert.equal(calls.filter((c) => c === "sessions.import").length, 3);
  assert.ok(textOf(find(root, "sessions-imported")).includes("Imported 3. They are in Chats."));
  assert.equal(done, 0, "the step finishes on Continue, so the words stay on screen");
  assert.equal(typeof gates.at(-1), "function");
  await press(find(root, "sessions-open-chats"));
  assert.equal(chats, 1);
});
