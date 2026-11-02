// The Bring your sessions card: each row (a ui/Row) shows name, folder, date and source, newest first; Select all and the count work; the folder filter is a "Folder: All" button that opens
// the app menu (no pill strip); Import carries the count and is off at zero; in the onboarding bar the main button reads Import N, imports, then Continue moves on.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, flush, installDom, press, textOf } from "./test-dom.ts";
import { SessionsCard } from "./SessionsCard.tsx";
import { OnboardingScreen } from "./OnboardingScreen.tsx";
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

const order = (root: never): string[] => {
  const out: string[] = [];
  const walk = (n: { props?: Record<string, unknown>; children?: unknown[] }): void => {
    const id = n.props?.["data-testid"];
    if (typeof id === "string" && /^row-session-[a-z]+:[a-z0-9]+$/.test(id)) out.push(id.slice("row-session-".length));
    for (const c of n.children ?? []) if (c && typeof c === "object") walk(c as never);
  };
  walk(root as never);
  return out;
};

test("each row shows the session name, its folder, a relative date and the source, newest first", async () => {
  const root = await open();
  assert.deepEqual(order(root), ["claude:a1", "codex:b2", "claude:c3"], "newest first, though discovery gave them oldest first");
  const first = textOf(find(root, "row-session-claude:a1"));
  assert.ok(first.includes("Fix the login bug") && first.includes("site") && first.includes("2 hours ago") && first.includes("Claude Code"), first);
  const second = textOf(find(root, "row-session-codex:b2"));
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
  await press(find(root, "row-session-claude:a1"));
  assert.ok(textOf(find(root, "sessions-count")).includes("2 of 3 selected"));
  assert.equal(find(root, "sessions-all")?.props["aria-checked"], "mixed");
  await press(find(root, "sessions-all"));
  assert.ok(textOf(find(root, "sessions-count")).includes("3 of 3 selected"), "from some, Select all ticks the rest");
});

test("the folder filter is a Folder: All button opening the app menu, with counts; picking one narrows the rows and Select all then covers only those", async () => {
  const root = await open();
  assert.equal(find(root, "sessions-folders"), null, "no strip of pill chips");
  assert.ok(textOf(find(root, "sessions-folder")).includes("Folder: All"));
  assert.equal(find(root, "menu"), null);
  await press(find(root, "sessions-folder"));
  await flush();
  assert.ok(find(root, "menu"), "the button opens ui/Menu");
  assert.ok(find(root, "menu-item-All folders") && find(root, "menu-item-site") && find(root, "menu-item-api"));
  assert.ok(textOf(find(root, "menu-count-site")).includes("2") && textOf(find(root, "menu-count-All folders")).includes("3"));
  await press(find(root, "menu-item-api"));
  await flush();
  assert.equal(find(root, "menu"), null, "a pick closes the menu");
  assert.ok(textOf(find(root, "sessions-folder")).includes("Folder: api"));
  assert.equal(find(root, "row-session-claude:a1"), null);
  assert.ok(find(root, "row-session-codex:b2"));
  await press(find(root, "sessions-all"));
  assert.ok(textOf(find(root, "sessions-count")).includes("1 of 3 selected"));
  await press(find(root, "sessions-folder"));
  await flush();
  await press(find(root, "menu-item-All folders"));
  await flush();
  assert.ok(find(root, "row-session-claude:a1") && textOf(find(root, "sessions-folder")).includes("Folder: All"));
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
  const gates: { save: (() => Promise<boolean>) | null; label: string | undefined }[] = [];
  const r = createRoot();
  await act(async () => { r.render(<SessionsCard call={call} onDone={() => { done++; }} gate={(save, label) => { gates.push({ save, label }); }} onOpenChats={() => { chats++; }} />); });
  await flush();
  const root = r.container as never;
  assert.equal(find(root, "sessions-import"), null, "in the onboarding bar the main button imports, so the card has no second Import");
  assert.equal(gates.at(-1)?.save, null, "nothing ticked: nothing to do yet");
  await press(find(root, "sessions-all"));
  assert.equal(gates.at(-1)?.label, "Import 3");
  let stayed: boolean | undefined;
  await act(async () => { stayed = await gates.at(-1)!.save!(); });
  await flush();
  assert.equal(stayed, false, "the import stays on the step so the card can say where they went");
  assert.equal(calls.filter((c) => c === "sessions.import").length, 3);
  assert.ok(textOf(find(root, "sessions-imported")).includes("Imported 3. They are in Chats."));
  assert.equal(done, 0, "the step finishes on Continue, so the words stay on screen");
  assert.equal(typeof gates.at(-1)?.save, "function");
  assert.equal(gates.at(-1)?.label, undefined, "then the button reads Continue");
  await press(find(root, "sessions-open-chats"));
  assert.equal(chats, 1);
});

function tauriImporter(): void {
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: async (cmd: string, args?: { sessionKey?: string }) => {
    if (cmd === "discover_session_sources") return found();
    const source = found().find((x) => x.sessionKey === args?.sessionKey)!;
    const line = source.provider === "codex"
      ? { type: "response_item", timestamp: "2026-01-01T00:00:00Z", payload: { type: "message", id: "m1", role: "user", content: [{ type: "input_text", text: "hi" }] } }
      : { type: "user", uuid: "m1", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } };
    return { source, text: JSON.stringify(line) };
  } } };
}

test("in the onboarding screen the bar's main button reads Import 2, imports, then reads Continue and finishes the step", async () => {
  installDom();
  tauriImporter();
  const calls: string[] = [];
  const call = (async (cap: string) => { calls.push(cap); return {}; }) as unknown as CapCall;
  const steps: string[] = [], opened: string[] = [];
  const r = createRoot();
  await act(async () => {
    r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{ ai: "done", interview: "done" }} stepKey="sessions" device="mac" onStep={(k, st) => steps.push(`${k}:${st}`)} onOpenStep={(k) => opened.push(k)} onClose={() => undefined}
      renderCard={(card, ctx) => (card === "import_sessions" ? <SessionsCard call={call} onDone={ctx.done} gate={ctx.gate} /> : null)} />);
  });
  await flush();
  const root = r.container as never;
  assert.ok(textOf(find(root, "step-next")).includes("Continue") && find(root, "step-next")?.props["aria-disabled"] === true, "nothing ticked: Continue waits, Skip for now is there");
  assert.ok(find(root, "step-later"));
  await press(find(root, "row-session-claude:a1"));
  await press(find(root, "row-session-codex:b2"));
  assert.ok(textOf(find(root, "step-next")).includes("Import 2"));
  await press(find(root, "step-next"));
  await flush();
  assert.equal(calls.filter((c) => c === "sessions.import").length, 2);
  assert.ok(textOf(find(root, "sessions-imported")).includes("Imported 2"));
  assert.deepEqual(steps, [], "still on the step, so the words can be read");
  assert.ok(textOf(find(root, "step-next")).includes("Continue"));
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(steps, ["sessions:done"]);
  assert.deepEqual(opened, ["folders"]);
});

test("with no sessions on this computer the card says so and Continue moves on", async () => {
  installDom();
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = { core: { invoke: async () => [] } };
  const steps: string[] = [];
  const r = createRoot();
  await act(async () => {
    r.render(<OnboardingScreen flow="personal" spaceName="Maya" progress={{}} stepKey="sessions" device="mac" onStep={(k, st) => steps.push(`${k}:${st}`)} onClose={() => undefined}
      renderCard={(card, ctx) => (card === "import_sessions" ? <SessionsCard call={(async () => ({})) as never} onDone={ctx.done} gate={ctx.gate} /> : null)} />);
  });
  await flush();
  const root = r.container as never;
  assert.ok(find(root, "sessions-none"));
  await press(find(root, "step-next"));
  await flush();
  assert.deepEqual(steps, ["sessions:done"]);
});
