// Agent computers run on a capable host. A Personal Space without one never asks for them, draws no computer button and says nothing about them; a stray door does nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveQuery, ScreenHooks } from "../../../../../client/src/index.ts";
import { createSample } from "../../places/chats/conversation/sample.ts";
import { createSampleSidebar } from "../../places/chats/sidebar/sample.ts";
import type { Principal } from "../../places/home/sections-a/data.tsx";
import { COMPUTER_UNREACHED, computerLine, createGo } from "../../places/chats/mounts/data.ts";
import type { LineAction } from "../../places/chats/mounts/data.ts";
import type { Act } from "../../places/chats/mounts/route.ts";
import { Composer } from "../../../../../ui/src/Composer/index.tsx";
import { installComposerForTests } from "../../../../../ui/src/Composer/Deferred.tsx";
import { resetComputersAvailable, setComputersAvailable } from "../computers-available.ts";
import ChatsPlace from "./chats.tsx";
import { ShellRuntimeProvider } from "./runtime.tsx";
import type { ShellRuntime, ShellTarget } from "./runtime.tsx";

installComposerForTests(Composer);

const PEOPLE: Principal[] = [
  { id: "usr_irfad", name: "Irfad Imtiaz", kind: "person" },
  { id: "agt_intake", name: "Intake", kind: "agent" },
];

function runtime(kind: "personal" | "team"): { rt: ShellRuntime; asked: string[]; calls: string[]; opened: ShellTarget[] } {
  const side = createSampleSidebar();
  const conv = createSample("idle");
  const asked: string[] = [];
  const calls: string[] = [];
  const opened: ShellTarget[] = [];
  const screens: ScreenHooks = { query: (id, name, state) => { asked.push(`${id}/${name}`); return (id === "chats.conversation" ? conv.data.screens : side.data.screens).query(id, name, state); } };
  const principals: LiveQuery<Principal[]> = { subscribe: () => () => undefined, getSnapshot: () => ({ status: "ready", data: PEOPLE }) };
  const rt: ShellRuntime = {
    screens, call: async (cap, input) => { calls.push(cap); return conv.data.call(cap, input); }, connection: conv.data.connection, principals,
    recordTitle: () => undefined, me: PEOPLE[0]!, clock: conv.data.clock,
    space: { id: "s1", kind, name: kind === "personal" ? "Irfad" : "Northwind" }, assistant: { id: "agt_assistant", name: "Assistant" }, aiConnected: true, deferredModules: new Set<string>(), isDeferred: () => false, calendarConnected: true,
    open: (t) => void opened.push(t), openUrl: () => undefined,
  };
  return { rt, asked, calls, opened };
}

const html = (rt: ShellRuntime): string => renderToStaticMarkup(<ShellRuntimeProvider value={rt}><ChatsPlace /></ShellRuntimeProvider>).replaceAll("<!-- -->", "");

test("a Personal Space mount never asks for computers.list and draws no computer button", () => {
  const { rt, asked, calls } = runtime("personal");
  const out = html(rt);
  assert.ok(out.includes('data-testid="composer"'), "the chat still draws");
  assert.ok(!out.includes('data-testid="computer-button"'), "no composer computer button");
  assert.ok(!asked.includes("console.agent-computers/computers"), "no live query of the computers screen");
  assert.ok(!calls.includes("computers.list"));
});

test("a Team Space keeps the computer button and reads its computers", () => {
  const { rt, asked } = runtime("team");
  const out = html(rt);
  assert.ok(out.includes('data-testid="computer-button"'));
  assert.ok(asked.includes("console.agent-computers/computers"));
});

function goFor(kind: "personal" | "team", fail?: unknown, computers: { agentId: string; computerId: string }[] = []) {
  const { rt, calls, opened } = runtime(kind);
  const said: { text: string; action?: LineAction }[] = [];
  const acts: Act[] = [];
  rt.call = async (cap) => { calls.push(cap); if (fail !== undefined) throw fail; return { computers }; };
  const go = createGo(rt, (a) => void acts.push(a), (id) => (id === "agt_intake" ? "Intake" : id), (text, action) => void said.push({ text, ...(action ? { action } : {}) }));
  return { go, said, calls, opened, acts };
}

test("a computer door in a Personal Space with no capable host does nothing and asks nothing; with one it opens the agent's computer", async () => {
  resetComputersAvailable();
  const { go, said, calls, opened } = goFor("personal");
  go.computerOfAgent("agt_intake");
  assert.deepEqual([calls, said, opened], [[], [], []]);
  setComputersAvailable("s1", true);
  const found = goFor("personal", undefined, [{ agentId: "agt_intake", computerId: "cmp_1" }]);
  found.go.computerOfAgent("agt_intake");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(found.acts, [{ t: "layer", layer: { kind: "computer", computerId: "cmp_1", chat: false } }]);
  resetComputersAvailable();
});

test("no computer for the agent says so; a network failure says could not reach; a found one opens", async () => {
  const none = goFor("team", undefined, []);
  none.go.computerOfAgent("agt_intake");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(none.said, [{ text: "Intake has no computer yet." }]);
  const down = goFor("team", new Error("fetch failed"));
  down.go.computerOfAgent("agt_intake");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(down.said, [{ text: "Could not reach the computer. Try again." }]);
  const found = goFor("team", undefined, [{ agentId: "agt_intake", computerId: "cmp_1" }]);
  found.go.computerOfAgent("agt_intake");
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(found.acts, [{ t: "layer", layer: { kind: "computer", computerId: "cmp_1", chat: false } }]);
});

test("computerLine maps the failures", () => {
  assert.equal(computerLine(null, "Intake"), "Intake has no computer yet.");
  assert.equal(computerLine(new Error("x"), "Intake"), COMPUTER_UNREACHED);
});
