// The Add people and agents host in projects, outside agents and the people popover. Split from addsheet.test.tsx so each file stays under the CI cap.
// @reads /apps/app/src/places/chats/addsheet/addsheet.support.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { ProjectPage, ProjectPageDataProvider } from "../../records/projectpage/index.ts";
import { createSampleProject } from "../../records/projectpage/sample.ts";
import { withDom, rightClick } from "./addsheet.support.tsx";

test("a project: people and agents become members, a new agent is agents.create with the project id", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "tab-teammates"));
    await press(find(root, "teammate-add"));
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
    assert.deepEqual(sets.map((m) => [m.principal, m.role]), [["usr_sara", "member"], ["agt_billing", "member"]]);
    const made = s.calls.find((c) => c.cap === "agents.create")?.input as { name: string; role: string; projectId: string };
    assert.deepEqual([made.name, made.role, made.projectId], ["Checker", "Checks every draft", "pj_0"]);
  });
});

test("a teammate's role is chosen on its row (Lead answers first); adding is only the sheet", async () => {
  await withDom(async () => {
    const s = createSampleProject();
    const root = await mount(createRoot, <ProjectPageDataProvider value={s.data}><ProjectPage projectId="pj_0" /></ProjectPageDataProvider>);
    await flush();
    await press(find(root, "tab-teammates"));
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


