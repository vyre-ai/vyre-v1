// The error panel's three actions do something you can see: Retry shows it is trying and then the screen or the error again, Copy says Copied for about two seconds, and
// Report a problem raises the window event the shell's report sheet opens on, carrying the trace id.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { ErrorState, REPORT_PROBLEM_EVENT } from "./index.tsx";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const props = (o: Record<string, unknown> = {}) => ({ kind: "error" as const, message: "Could not load Files", code: "files.list", traceId: "tr_8f2a91", retryable: true, ...o });

test("Retry reads Trying again while the call runs, then goes back to Retry and the call ran once", async () => {
  const restore = installDom();
  try {
    let release: () => void = () => undefined;
    let calls = 0;
    const root = await mount(createRoot, <ErrorState props={props({ onRetry: () => { calls++; return new Promise<void>((r) => { release = r; }); } })} />);
    assert.match(textOf(find(root, "state-retry")), /Retry/);
    await press(find(root, "state-retry"));
    assert.match(textOf(find(root, "state-retry")), /Trying again/);
    await press(find(root, "state-retry"));
    assert.equal(calls, 1, "a second press while trying does not run it again");
    release();
    await wait(900); await flush();
    assert.match(textOf(find(root, "state-retry")), /Retry/);
    assert.doesNotMatch(textOf(find(root, "state-retry")), /Trying/);
  } finally { restore(); }
});

test("Copy trace id says Copied for about two seconds and has put the trace id on the clipboard", async () => {
  const restore = installDom();
  const g = globalThis as { navigator?: unknown };
  const had = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => { copied.push(t); } } }, configurable: true });
  try {
    const root = await mount(createRoot, <ErrorState props={props()} startOpen />);
    assert.match(textOf(find(root, "state-copy")), /Copy trace id/);
    await press(find(root, "state-copy"));
    await flush();
    assert.deepEqual(copied, ["tr_8f2a91"]);
    assert.match(textOf(find(root, "state-copy")), /Copied/);
    await wait(2200); await flush();
    assert.match(textOf(find(root, "state-copy")), /Copy trace id/);
  } finally { if (had) Object.defineProperty(globalThis, "navigator", had); else delete g.navigator; restore(); }
});

test("Report a problem raises the report event with the trace id, the code and the message", async () => {
  const restore = installDom();
  const g = globalThis as { dispatchEvent?: unknown; CustomEvent?: unknown };
  const seen: { type: string; detail: unknown }[] = [];
  g.CustomEvent = class { constructor(public type: string, init: { detail: unknown }) { this.detail = init.detail; } detail: unknown };
  g.dispatchEvent = (e: { type: string; detail: unknown }) => { seen.push({ type: e.type, detail: e.detail }); return true; };
  try {
    const root = await mount(createRoot, <ErrorState props={props()} startOpen />);
    await press(find(root, "state-report"));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.type, REPORT_PROBLEM_EVENT);
    assert.deepEqual(seen[0]!.detail, { traceId: "tr_8f2a91", code: "files.list", message: "Could not load Files" });
  } finally { delete g.dispatchEvent; delete g.CustomEvent; restore(); }
});
