// A conversation inside a project's Chat tab (lane l-chrome2a): the project header is the only title, so the conversation's own title is left out and its controls stay.
import test from "node:test";
import assert from "node:assert/strict";
import { Dimensions } from "react-native";
import { createRoot } from "test-renderer";
import { installDom, mount, find, flush } from "../../../onboarding/test-dom.ts";
import { Conversation } from "./Conversation.tsx";
import { InProjectFrame } from "./frame.ts";
import { createSample } from "./sample.ts";

test("in a project frame there is no second title, and people, find, pane and More are still there; alone it keeps its title", async () => {
  installDom();
  Dimensions.set({ window: { width: 1280, height: 844, scale: 1, fontScale: 1 } });
  const framed = await mount(createRoot, <InProjectFrame value><Conversation data={createSample("idle").data} /></InProjectFrame>);
  await flush();
  assert.equal(find(framed, "conversation-title"), null, "one header: the project's");
  for (const id of ["participants-button", "find-button", "pane-button", "more-button"]) assert.ok(find(framed, id), id);
  const alone = await mount(createRoot, <Conversation data={createSample("idle").data} />);
  await flush();
  assert.ok(find(alone, "conversation-title"));
});
