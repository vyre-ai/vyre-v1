// The Ask pane drawn, part 2 of 2 (split from askpane.test.tsx to keep each file inside the 30 s watchdog): the remembered width, a record page's Ask, and Ask history in Chats.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { find, flush, installDom, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { act } from "react";
import type { Node } from "../../../../../ui/src/testing/dom.ts";
import { paneWidths } from "../../../../../ui/src/SidePane/index.tsx";
import { AskPaneHost } from "./host.tsx";
import { askPaneOf, askPaneKey, closeAskPane, openAskPane, resetAskPanes } from "./pane.ts";
import { screenFromHash, setScreenContext } from "./screen.ts";
import { openAsk } from "../providers/ask.ts";
import { sampleRuntime } from "../providers/misc-test-runtime.tsx";
import { ShellRuntimeProvider } from "../providers/runtime.tsx";
import type { ShellRuntime } from "../providers/runtime.tsx";
import { askAboutRecord } from "../providers/record-detail.tsx";
import { RecordPage, RecordPageDataProvider } from "../../places/records/recordpage/index.ts";
import { createSamplePage } from "../../places/records/recordpage/sample.ts";

const LOADING = { status: "loading" } as const;
const quiet = { query: () => ({ subscribe: () => () => undefined, getSnapshot: () => LOADING }) };

/** A runtime whose chat capabilities answer an Ask, and which records every place it is asked to open. */
function runtime(extra: (cap: string, input: Record<string, unknown>) => unknown = (cap) => { throw new Error(`${cap} is not part of this test`); }): { rt: ShellRuntime; opened: string[]; calls: { cap: string; input: Record<string, unknown> }[] } {
  const opened: string[] = [];
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let n = 0;
  const rt = sampleRuntime({
    screens: quiet as never,
    opened,
    call: async (cap, raw) => {
      const input = raw as Record<string, unknown>;
      calls.push({ cap, input });
      if (cap === "chat.asks_of") return { threads: [], total: 0 };
      if (cap === "chat.start") return { thread: { threadId: `thr_${++n}` } };
      if (cap === "chat.open_as_chat") return { thread: { threadId: input["threadId"] } };
      if (cap === "agents.list") return { agents: [{ agentId: "agt_assistant", name: "Assistant", kind: "assistant", ownerId: "usr_irfad" }, { agentId: "agt_billing", name: "Billing", kind: "agent" }] };
      return extra(cap, input);
    },
  });
  // a principals snapshot that is the same object every read, as the shell's is
  const people = rt.principals.getSnapshot();
  (rt as { principals: unknown }).principals = { subscribe: () => () => undefined, getSnapshot: () => people };
  return { rt, opened, calls };
}

let mounts = 0;
/** A place with a door: it counts its mounts, so opening the pane beside it is seen not to remount it. */
function Place({ rt, thing }: { rt: ShellRuntime; thing: { kind: string; id: string; title: string } }): ReactElement {
  const once = useRef(false);
  useEffect(() => { if (!once.current) { once.current = true; mounts++; } }, []);
  return <View testID="the-place"><Pressable testID="door" onPress={() => openAsk(rt, "assistant", thing)}><Text>Ask</Text></Pressable></View>;
}

const host = (rt: ShellRuntime, place: string, body: ReactElement): ReactElement => <ShellRuntimeProvider value={rt}><AskPaneHost place={place} rt={rt}>{body}</AskPaneHost></ShellRuntimeProvider>;
const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await flush(); };

/** Mounted roots are unmounted before the DOM stubs go, so nothing they started keeps the test process alive. */
const roots: { unmount(): void }[] = [];
async function mount(make: typeof createRoot, el: ReactElement): Promise<Node> {
  const r = make();
  roots.push(r);
  await act(async () => { r.render(el); });
  await flush();
  return r.container as unknown as Node;
}
async function unmountAll(): Promise<void> {
  while (roots.length > 0) { const r = roots.pop()!; await act(async () => { r.unmount(); }); }
}

test("the pane's width is remembered per place", async () => {
  const restore = installDom();
  try {
    Dimensions.set({ window: { width: 1400, height: 900, scale: 1, fontScale: 1 } });
    resetAskPanes();
    paneWidths.reset(askPaneKey("records"));
    paneWidths.reset(askPaneKey("files"));
    const { rt } = runtime();
    const root = await mount(createRoot, host(rt, "records", <View />));
    openAskPane({ thing: null }, "records");
    await settle();
    const edge = (): Node => find(root, "side-pane-resize")!;
    assert.equal(edge().props["aria-valuenow"], 380, "the first width");
    (edge().props["onKeyDown"] as (e: unknown) => void)({ key: "ArrowLeft", preventDefault: () => undefined });
    await settle();
    assert.equal(paneWidths.get(askPaneKey("records")), 404, "remembered for Records");
    assert.equal(paneWidths.get(askPaneKey("files")), null, "not for Files");
    closeAskPane("records");
    await settle();
    openAskPane({ thing: null }, "records");
    await settle();
    assert.equal(edge().props["aria-valuenow"], 404, "opened again at the width the person left");
  } finally { await unmountAll(); restore(); }
});

test("a record page's Ask opens the pane beside the record, about it, and the page stays", async () => {
  const restore = installDom();
  try {
    resetAskPanes();
    const { rt, opened } = runtime();
    const page = createSamplePage();
    setScreenContext(screenFromHash("records", "subject=record:cl_0"));
    const data = { ...page.data, nav: { ...page.data.nav, ask: askAboutRecord } };
    const root = await mount(createRoot, host(rt, "records", <RecordPageDataProvider value={data}><RecordPage type="clients" recordId="cl_0" start={{ all: true, pane: false }} /></RecordPageDataProvider>));
    await settle();
    await press(find(root, "record-ask"));
    await settle();
    assert.ok(find(root, "ask-pane"));
    assert.ok(find(root, "record-page"), "the record page is still there");
    const s = askPaneOf("records")!;
    assert.equal(s.thing?.kind, "record");
    assert.equal(s.thing?.id, "cl_0");
    assert.equal(textOf(find(root, "ask-pane-chip")).trim(), s.thing?.title);
    assert.deepEqual(opened, []);
    assert.deepEqual(page.opened, []);
  } finally { await unmountAll(); restore(); }
});

