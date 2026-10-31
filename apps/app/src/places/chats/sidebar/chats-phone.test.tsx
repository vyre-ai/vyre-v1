// The Chats list and the conversation on a phone (390 wide): another Space needing you is not a dot floating over the list (it is on the You tab), Needs you shows three rows and a Show all, and a conversation header carries the Back.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find } from "../../../onboarding/test-dom.ts";
import { ChatsSidebar } from "./ChatsSidebar.tsx";
import { createSampleSidebar, northwind } from "./sample.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { MobileBackContext } from "../../../mobile/shell/back.ts";

const widen = (width: number): void => Dimensions.set({ window: { width, height: 844, scale: 1, fontScale: 1 } });

test("another Space needing you: a dot by the header on a desktop, none on a phone (the You tab carries it)", async () => {
  installDom();
  for (const [width, dot] of [[390, false], [1280, true]] as const) {
    widen(width);
    const root = await mount(createRoot, <ChatsSidebar data={createSampleSidebar(northwind).data} window={{ start: 0, end: 500 }} />);
    assert.equal(find(root, "other-space-dot") !== null, dot, `${width} wide`);
  }
});

test("Needs you on a phone is three rows and a Show all row that opens Needs you", async () => {
  installDom();
  widen(390);
  const s = createSampleSidebar(northwind);
  const opened: (string | undefined)[] = [];
  const data = { ...s.data, nav: { ...s.data.nav, openNeedsYou: (id?: string) => void opened.push(id) } };
  const root = await mount(createRoot, <ChatsSidebar data={data} window={{ start: 0, end: 500 }} />);
  const ids: string[] = [];
  const walk = (n: { props: Record<string, unknown>; children?: unknown[] } | string): void => { if (typeof n === "string") return; const t = n.props["data-testid"]; if (typeof t === "string") ids.push(t); (n.children as never[] | undefined)?.forEach(walk as never); };
  walk(root as never);
  assert.equal(ids.filter((i) => /^row-n:[^-]+$/.test(i)).length, 3, "three Needs you rows");
  assert.ok(ids.includes("row-m:needs"), "a Show all row");
  await press(find(root, "row-m:needs"));
  assert.deepEqual(opened, [undefined], "it opens Needs you");
  widen(1280);
});

test("a conversation shows a Back chevron in its own header only when the phone shell hands it Back", async () => {
  installDom();
  widen(390);
  let backs = 0;
  const bare = await mount(createRoot, <Conversation data={createSample("idle").data} />);
  assert.equal(find(bare, "conversation-back"), null, "no Back without the phone shell");
  const root = await mount(createRoot, <MobileBackContext.Provider value={() => { backs++; }}><Conversation data={createSample("idle").data} /></MobileBackContext.Provider>);
  await press(find(root, "conversation-back"));
  assert.equal(backs, 1);
  widen(1280);
});
