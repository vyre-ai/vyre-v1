// The faces on every Chats surface come from one rule: the assistant is the Vyre mark, an agent its face from its id, a person their own.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { resetAssistant, setAssistantId } from "../../../../../ui/src/Avatar/index.tsx";
import { Face as NeedsFace } from "./needsyou/parts.tsx";
import { Face as SideFace, FaceStack } from "./sidebar/parts.tsx";
import { FaceButton } from "./conversation/parts.tsx";
import { rowOf } from "./sidebar/model.ts";

const mark = /data-avatar="assistant"/;
const setup = (): void => { resetAssistant(); setAssistantId("agt_me"); };

test("message rows and Needs you rows show the assistant as the Vyre mark, whatever it is called", () => {
  setup();
  assert.match(renderToStaticMarkup(<NeedsFace name="Irfad’s Assistant" seedId="agt_me" kind="agent" size={20} />), mark);
  assert.match(renderToStaticMarkup(<NeedsFace name="Irfad Assistant" seedId="agt_me" size={26} />), mark);
});

test("the chat header and the chat list show the assistant as the Vyre mark", () => {
  setup();
  assert.match(renderToStaticMarkup(<FaceButton name="Irfad Assistant" seedId="agt_me" mode="lead" working={false} onPress={() => undefined} title="t" testID="f" />), mark);
  const row = rowOf({ threadId: "t1", title: "hi", agents: ["agt_me"], unread: 0, working: false, starred: false, lastAt: 1 } as never, () => "Irfad Assistant");
  assert.match(renderToStaticMarkup(<SideFace name={row.who} seedId={row.whoId} kind={row.kind} size={18} />), mark);
});

test("an agent shows its face tile and a person their avatar", () => {
  setup();
  const agent = renderToStaticMarkup(<SideFace name="Scout" seedId="agt_scout" kind="agent" size={18} />);
  assert.match(agent, /data-avatar="agent"/);
  assert.doesNotMatch(agent, mark);
  assert.match(renderToStaticMarkup(<SideFace name="Maya Chen" seedId="usr_maya" kind="person" size={18} />), /data-avatar="person"/);
});

test("a group chat row stacks up to three faces", () => {
  setup();
  const row = rowOf({ threadId: "g", title: "Plan", agents: ["agt_me", "agt_a", "agt_b", "agt_c"], unread: 0, working: false, starred: false, lastAt: 1 } as never, (id) => id);
  assert.equal(row.members?.length, 3);
  const html = renderToStaticMarkup(<FaceStack members={row.members!} size={16} />);
  assert.equal((html.match(/data-avatar=/g) ?? []).length, 3);
  assert.match(html, mark, "the assistant in the stack is still the mark");
});
