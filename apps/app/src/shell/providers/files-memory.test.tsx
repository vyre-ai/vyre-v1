// Files > Knowledge in the shell (spec 2.15): the Knowledge screens are mounted over the Space's runtime, the sidebar rows open them, and any other row gives the body back to the list.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery, ScreenHooks } from "../../../../../client/src/index.ts";
import { createSampleMemory } from "../../places/files/memory/sample.ts";
import { filesData } from "./files-data.ts";
import type { MemoryView } from "./files-data.ts";
import { MemoryMount, memoryData } from "./files-memory.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";

function rig() {
  const sample = createSampleMemory();
  const urls: string[] = [];
  const opened: string[] = [];
  const agents: LiveQuery<unknown> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: { agents: [{ agentId: "agt_intake", name: "Intake" }, { agentId: "agt_docs", name: "Docs" }] } }) };
  const screens = { capQuery: (cap: string, input: Record<string, unknown>) => (cap === "agents.list" ? agents : sample.data.live(cap as never, input as never)) } as unknown as ScreenHooks;
  const rt = { ...sampleRuntime({ screens, call: sample.data.call, opened }), openUrl: (u: string) => void urls.push(u) };
  return { sample, rt, urls, opened };
}
const html = (el: React.ReactElement): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");

const noGo = (): void => undefined;

test("Learned mounts over the runtime and holds the facts waiting for review", () => {
  const { rt } = rig();
  const out = html(<ShellRuntimeProvider value={rt}><MemoryMount rt={rt} route={{ v: "learned" }} go={noGo} /></ShellRuntimeProvider>);
  assert.ok(out.includes('data-testid="know-learned"'), "the Learned screen");
  assert.ok(!out.includes("know-loading"));
});

test("Graph mounts over the runtime on the first agent the person can see", () => {
  const { rt } = rig();
  const out = html(<MemoryMount rt={rt} route={{ v: "graph" }} go={noGo} />);
  assert.ok(out.includes('data-testid="memory-graph"'), "the Graph screen");
  assert.ok(!out.includes("memory-graph-loading"));
});

test("a fact's source and a linked note open through the shell; a note without a link stays in the graph's side pane", () => {
  const { rt, urls } = rig();
  const d = memoryData(rt, []);
  d.nav.openSource("/chats/thr_one");
  d.nav.openNote("note_1", "/records/rec_1");
  d.nav.openNote("note_2");
  assert.deepEqual(urls, ["/chats/thr_one", "/records/rec_1"]);
});

test("the sidebar rows ask for Learned, Graph and any Knowledge screen, and the notes row or a folder gives the list back", () => {
  const { rt } = rig();
  const seen: Array<MemoryView["view"]> = [];
  const data = filesData(rt, { view: { v: "graph" }, open: (v) => void seen.push(v) });
  assert.deepEqual(data.memoryView, { v: "graph" });
  data.nav.openMemory();
  data.nav.openGraph();
  data.nav.openKnow({ v: "list", kind: "client" });
  data.nav.leaveMemory?.();
  assert.deepEqual(seen, [{ v: "learned" }, { v: "graph" }, { v: "list", kind: "client" }, null]);
  const bare = filesData(rt);
  assert.equal(bare.memoryView, undefined);
  assert.equal(bare.nav.leaveMemory, undefined, "without a place to hold the view, the rows fall back to the shell's screen ids");
  bare.nav.openMemory();
  bare.nav.openGraph();
  bare.nav.openKnow({ v: "page", pageId: "pg_ian" });
});
