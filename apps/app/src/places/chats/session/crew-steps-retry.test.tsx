// A finished helper's row reads its steps once when it opens (CrewBlock useLastSteps). Under load that one read can fail; it must be tried again, or the row is left without its
// test counts for good (the crew walk's "1 passing, 1 failing", lead, 12 Nov 2026).
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRoot } from "test-renderer";
import { mount } from "../../../onboarding/test-dom.ts";
import { useLastSteps } from "./CrewBlock.tsx";

function Probe({ call }: { call: (cap: string, input: unknown) => Promise<unknown> }) {
  useLastSteps(call as never, { id: "thr_helper", state: "done" }, true);
  return null;
}

test("a finished helper's steps read that fails is tried again", async () => {
  let calls = 0;
  const call = (): Promise<unknown> => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("busy")) : Promise.resolve({ messages: [] });
  };
  const root = await mount(createRoot, createElement(Probe, { call }));
  await new Promise((r) => setTimeout(r, 1900));
  assert.equal(calls, 2, "one failed read, then one more");
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(calls, 2, "a read that worked is not repeated for a finished helper");
  void root;
});
