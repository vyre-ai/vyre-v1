// A conversation inside a project's Chat tab (lane l-chrome2a): the project header is the only title, so the conversation's own title is left out and its controls stay.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush } from "../../../onboarding/test-dom.ts";
import { Conversation } from "./Conversation.tsx";
import { InProjectFrame, createFrameStore } from "./frame.ts";
import { createSample } from "./sample.ts";

test("in a project frame the conversation draws no header and hands its controls up: find, pane, helpers, stop and its More entries; alone it keeps its header", async () => {
  installDom();
  Dimensions.set({ window: { width: 1280, height: 844, scale: 1, fontScale: 1 } });
  const store = createFrameStore();
  const framed = await mount(createRoot, <InProjectFrame value={store}><Conversation data={createSample("idle").data} /></InProjectFrame>);
  await flush();
  assert.equal(find(framed, "conversation-head"), null, "one header: the project's");
  const c = store.get()!;
  assert.ok(c, "the controls are handed up");
  assert.equal(c.find.active, false);
  c.find.toggle(); await flush();
  assert.equal(store.get()!.find.active, true, "find toggles the conversation's own find bar");
  const labels = c.chatEntries().flatMap((e) => ("label" in e ? [e.label] : []));
  for (const l of ["Plan Mode", "Fork This Chat", "Export as Markdown"]) assert.ok(labels.includes(l), l);
  const alone = await mount(createRoot, <Conversation data={createSample("idle").data} />);
  await flush();
  assert.ok(find(alone, "conversation-head") && find(alone, "conversation-title"));
});
