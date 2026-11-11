// A server-side search on a Console page: the search box must not vanish while the next answer is read (it took the person's focus with it on every keystroke), and the last rows stay until it arrives.
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { find, installDom, mount, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../shell/data.tsx";
import type { ConsoleData } from "../shell/data.tsx";
import { createSampleConsole } from "../shell/sample.ts";
import { PrincipalPicker } from "./Groups.tsx";
import { useRead } from "./shared.tsx";

const ALL = { principals: [{ id: "usr_maya", name: "Maya Lin", kind: "person" }, { id: "usr_priya", name: "Priya Rao", kind: "person" }] };

/** capQuery that answers each search from `answers` (a missing one is still loading). */
function provider(answers: Record<string, unknown>): ConsoleData {
  const sample = createSampleConsole().data;
  const capQuery = (_cap: string, input: Record<string, unknown>) => {
    const q = String(input["q"] ?? "");
    const state = q in answers ? { status: "ready", data: answers[q] } : { status: "loading" };
    return { subscribe: () => () => undefined, getSnapshot: () => state };
  };
  return { ...sample, screens: { ...sample.screens, capQuery } as never };
}

test("the people picker keeps its search field while a search is still being read", async () => {
  const restore = installDom();
  try {
    const root = await mount(createRoot, <ConsoleDataProvider value={provider({})}><PrincipalPicker mode="member" selected={new Set()} onPick={() => undefined} /></ConsoleDataProvider>);
    assert.ok(find(root, "group-principal-search"), "the field is there before any answer arrives");
  } finally { restore(); }
});

test("a list read with keepPrevious shows the last rows while the next search is read, and the next ones when they arrive", async () => {
  const restore = installDom();
  const answers: Record<string, unknown> = { "": ALL };
  const seen: Array<unknown> = [];
  function Probe({ q }: { q: string }) { seen.push(useRead<typeof ALL>("access.principals.list", { q }, { keepPrevious: true }).data?.principals.length); return null; }
  const root = createRoot();
  try {
    const data = () => provider(answers);
    await act(async () => { root.render(<ConsoleDataProvider value={data()}><Probe q="" /></ConsoleDataProvider>); });
    await act(async () => { root.render(<ConsoleDataProvider value={data()}><Probe q="Maya" /></ConsoleDataProvider>); });
    assert.equal(seen.at(-1), 2, "the earlier rows stay while Maya is read");
    answers["Maya"] = { principals: [ALL.principals[0]] };
    await act(async () => { root.render(<ConsoleDataProvider value={data()}><Probe q="Maya" /></ConsoleDataProvider>); });
    assert.equal(seen.at(-1), 1, "and the new ones replace them");
  } finally { restore(); }
  void textOf;
});
