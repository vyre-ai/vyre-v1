// The Add people and agents host in projects, outside agents and the people popover. Split from addsheet.test.tsx so each file stays under the CI cap.
// @reads /apps/app/src/places/chats/addsheet/addsheet.support.tsx
import { TeammatesTab } from "../../records/projectpage/TeammatesTab.tsx";
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { Node } from "../../../onboarding/test-dom.ts";
import { createRoot } from "test-renderer";
import { mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { withDom } from "./addsheet.support.tsx";

// a right-click on a row, the way the app gets one (kept in the test file: only tests fire a native context menu)
async function rightClick(root: Node, id: string): Promise<void> {
  const open = find(root, id)?.props["onContextMenu"] as ((e: unknown) => void) | undefined;
  assert.equal(typeof open, "function", id);
  await act(async () => { open?.({ preventDefault() {}, nativeEvent: { pageX: 20, pageY: 20 }, pageX: 20, pageY: 20, clientX: 20, clientY: 20 }); });
  await flush();
}

/** The sample project's viewer as its Lead, so the project's menu offers Add People (it is a manager's). */
const asLead = <T extends { call(cap: string, input: unknown): Promise<unknown> }>(data: T): T & { me: { id: string; name: string } } => ({
  ...data, me: { id: "usr_maya", name: "Maya Chen" },
  async call(cap: string, input: unknown) { if (cap === "stars.list") return { stars: [] }; return cap === "projects.members.list" ? { members: [{ principal: "usr_maya", role: "lead", kind: "person", since: 1 }] } : data.call(cap, input); },
});

test("a project: people and agents become members, a new agent is agents.create with the project id", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={asLead(s.data)}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await flush(); await flush();
    await press(find(root, "project-more"));
    await flush();
    await press(find(root, "menu-item-Add People…"));
    await flush();
    await press(find(root, "as-row-person:usr_sara"));
    await press(find(root, "as-row-agent:agt_billing"));
    await press(find(root, "as-new"));
    await typeInto(find(root, "as-name"), "Checker");
    await typeInto(find(root, "as-brief"), "Checks every draft");
    await press(find(root, "as-create"));
    await press(find(root, "as-add"));
    await flush();
    const sets = s.calls.filter((c) => c.cap === "projects.members.set").map((c) => (c.input as { principal: string; role: string }));
    assert.deepEqual(sets.map((m) => [m.principal, m.role]), [["usr_sara", "member"], ["agt_billing", "member"], ["agt_new", "member"]], "the new agent is made for the project and is one of its people (members.set), so a Lead can give it a role");
    const made = s.calls.find((c) => c.cap === "agents.create")?.input as { name: string; role: string; projectId: string };
    assert.deepEqual([made.name, made.role, made.projectId], ["Checker", "Checks every draft", "pj_0"]);
  });
});

test("a teammate's role is chosen on its row (Lead answers first); adding is only the sheet", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><TeammatesTab projectId="pj_0" refresh={0} onAdd={() => undefined} /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "teammate-role-agt_docs"));
    await press(find(root, "menu-item-Lead: Answers first in a new chat of this project"));
    await flush();
    const call = s.calls.find((c) => c.cap === "projects.members.set")?.input as { projectId: string; principal: string; role: string };
    assert.deepEqual([call.projectId, call.principal, call.role], ["pj_0", "agt_docs", "lead"]);
  });
});

test("an outside agent in the chat never offers Answers everything in its settings popover", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    await s.data.call("threads.outside_agent.add", { threadId: "c1", agentId: "out_cc" });
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await flush();
    await rightClick(root, "people-row-out_cc");
    await press(find(root, "menu-item-How and when it responds"));
    assert.ok(find(root, "as-pop"));
    assert.equal(find(root, "as-how-lead"), null);
    assert.ok(find(root, "as-how-tag") && find(root, "as-how-listen"));
    // a Space agent still offers it
    await press(find(root, "as-pop-x"));
    await press(find(root, "participants-button"));
    await flush();
    await rightClick(root, "people-row-agt_docs");
    await press(find(root, "menu-item-How and when it responds"));
    assert.ok(find(root, "as-how-lead"));
  });
});

test("a project's people popover lists the members with their project roles on the right", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "project-members"));
    await flush();
    assert.match(textOf(find(root, "people-popover")), /People and agents/);
    assert.ok(/Lead|Member|Reviewer|Guest/.test(textOf(find(root, "people-popover"))), "the project roles are on the right");
  });
});

test("pressing a person in the people popover opens their profile through the chat's own door, like an agent; the popover closes", async () => {
  await withDom(async () => {
    const s = createSample("channel");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await press(find(root, "people-row-usr_maya"));
    await flush();
    assert.ok(s.opened.includes("agent:usr_maya"), "the profile door got the person");
    assert.equal(find(root, "people-popover"), null, "the popover closed");
  });
});


