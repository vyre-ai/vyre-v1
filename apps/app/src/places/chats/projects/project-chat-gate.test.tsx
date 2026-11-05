// A project's Chat tab for someone who is not in its chat: calm words, no Retry, no error; a Space admin may join, anyone else is told who adds them.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { installDom, mount, press, find, flush, textOf } from "../../../onboarding/test-dom.ts";
import { ProjectChatGate } from "./ProjectChatGate.tsx";

const draw = async (admin: boolean, call: (cap: string, input: unknown) => Promise<unknown>, onJoined = (): void => undefined) => {
  const off = installDom();
  try { const root = await mount(createRoot, <ProjectChatGate projectId="prj_1" me="usr_ada" admin={admin} call={call} onJoined={onJoined} />); await flush(); return { root, off }; } catch (e) { off(); throw e; }
};

test("someone who may not join is told who can add them: one plain line, no Retry, no error", async () => {
  const { root, off } = await draw(false, async () => { throw new Error("no"); });
  const t = textOf(find(root, "project-chat-gate"));
  assert.match(t, /You're not in this project's chat/);
  assert.match(t, /The project's Lead can add you\./);
  assert.equal(find(root, "project-chat-join"), null);
  assert.ok(!/Retry|Couldn't load/.test(t));
  off();
});

test("a Space admin outside the chat has Join chat, which makes them a Member of the project and reopens the chat", async () => {
  const calls: { cap: string; input: unknown }[] = []; let joined = 0;
  const { root, off } = await draw(true, async (cap, input) => { calls.push({ cap, input }); return {}; }, () => { joined++; });
  assert.ok(!/Retry|Couldn't load/.test(textOf(find(root, "project-chat-gate"))));
  await press(find(root, "project-chat-join")); await flush();
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cap, "projects.members.set");
  assert.deepEqual({ ...(calls[0]!.input as object), idempotencyKey: "k" }, { projectId: "prj_1", principal: "usr_ada", role: "member", idempotencyKey: "k" });
  assert.equal(joined, 1);
  off();
});

test("a join that fails says why and stays calm", async () => {
  const { root, off } = await draw(true, async () => { throw new Error("You need to manage this project to change roles."); });
  await press(find(root, "project-chat-join")); await flush();
  assert.match(textOf(find(root, "project-chat-note")), /manage this project/);
  off();
});
