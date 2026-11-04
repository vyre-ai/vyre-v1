// More of the Add people and agents host: the mention strip, Poke and settings, the project paths and the people popover. Split from addsheet.test.tsx so each file stays under the CI cap.
// @reads /apps/app/src/places/chats/addsheet/addsheet.support.tsx
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
import { addedLine, directoryOf, failedLine, hereSub, maxLevelOf, projectExtras, settingsOf } from "./model.ts";
import { widen, withDom } from "./addsheet.support.tsx";

// a right-click on a row, the way the app gets one (kept in the test file: only tests fire a native context menu)
async function rightClick(root: Node, id: string): Promise<void> {
  const open = find(root, id)?.props["onContextMenu"] as ((e: unknown) => void) | undefined;
  assert.equal(typeof open, "function", id);
  await act(async () => { open?.({ preventDefault() {}, nativeEvent: { pageX: 20, pageY: 20 }, pageX: 20, pageY: 20, clientX: 20, clientY: 20 }); });
  await flush();
}


test("@mentioning someone who is not in the chat shows one strip on the composer: the line, a primary Add, and a caret menu with the other ways", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await typeInto(find(root, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    const strip = find(root, "channel-offer");
    assert.ok(strip, "the strip shows");
    assert.match(textOf(find(root, "channel-offer-text")), /^Maya isn't in this chat$/);
    assert.equal(textOf(find(root, "channel-add")).trim(), "Add Maya");
    // the loose lines and the switch are gone
    const text = textOf(strip);
    assert.ok(!/They will read|Earlier messages stay hidden|Include earlier messages|never gains people/i.test(text), text);
    assert.equal(find(root, "channel-earlier"), null);
    assert.equal(find(root, "channel-start"), null, "the channel is in the caret menu now");
    // the caret holds the three ways, the default first
    await press(find(root, "channel-add-menu"));
    for (const label of ["Add, from now on", "Add, with earlier messages", "Start a channel instead"]) assert.ok(find(root, `menu-item-${label}`), label);
    await press(find(root, "menu-item-Add, with earlier messages"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya", fromStart: true }]);
  });
});

test("the strip's Add is from now on (no flag); Start a channel instead makes a channel", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await typeInto(find(root, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    await press(find(root, "channel-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya" }]);
    const again = createSample("idle");
    const root2 = await mount(createRoot, <Conversation data={again.data} />);
    await typeInto(find(root2, "composer-field"), "@Maya Chen can you look at this");
    await flush();
    await press(find(root2, "channel-add-menu"));
    await press(find(root2, "menu-item-Start a channel instead"));
    await flush();
    assert.ok(again.calls.some((c) => c.cap === "threads.make_channel"));
  });
});

test("on a phone the main button reads Add 3", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    widen(390);
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "composer-attach"));
    await press(find(root, "row-plus-people"));
    await flush();
    for (const id of ["person:usr_maya", "person:usr_omar", "agent:agt_research"]) await press(find(root, `as-row-${id}`));
    assert.equal(textOf(find(root, "as-add")).trim(), "Add 3");
  });
});

/* ---------- poke and the settings popover ---------- */

test("Poke calls threads.poke, the reply says Poked by, and the quiet line says who poked whom", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await rightClick(root, "people-row-agt_docs");
    await press(find(root, "menu-item-Poke"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.poke").map((c) => c.input), [{ threadId: "c1", agentId: "agt_docs" }]);
    assert.ok(s.toasts.includes("Poked Docs"));
    await flush();
    assert.match(textOf(find(root, "poked-pokeR_1")), /Poked by You/);
    assert.match(textOf(find(root, "event-poke_1")), /You poked Docs/);
  });
});

test("the gear opens How, When and Style; Listening is mode quiet; making another agent lead asks first and keeps the swap", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "participants-button"));
    await rightClick(root, "people-row-agt_docs");
    await press(find(root, "menu-item-How and when it responds"));
    assert.ok(find(root, "as-pop"));
    for (const id of ["as-how-lead", "as-how-tag", "as-how-listen", "as-when-always", "as-when-topics", "as-when-hours", "as-style-short", "as-style-full"]) assert.ok(find(root, id), id);
    await press(find(root, "as-how-listen"));
    await press(find(root, "as-style-full"));
    const sets = s.calls.filter((c) => c.cap === "threads.agent_settings.set").map((c) => c.input);
    assert.deepEqual(sets[0], { threadId: "c1", agentId: "agt_docs", mode: "quiet", when: "always", topics: null, hoursFrom: null, hoursTo: null, style: "short" });
    assert.equal((sets[1] as { style: string }).style, "full");
    // Intake leads: making Docs lead asks first
    await press(find(root, "as-how-lead"));
    assert.match(textOf(find(root, "menu-item-Swap") ?? root), /Swap/);
    assert.equal(s.calls.filter((c) => c.cap === "threads.agent_settings.set").length, 2, "nothing is sent before the swap is confirmed");
    await press(find(root, "menu-item-Swap"));
    await flush();
    assert.equal((s.calls.filter((c) => c.cap === "threads.agent_settings.set").at(-1)?.input as { mode: string }).mode, "lead");
    assert.ok(s.toasts.some((t) => /Docs now answers everything\. Intake answers only when mentioned\./.test(t)));
  });
});

test("a face in the header opens How and When It Answers instead of the old two mode items", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "face-agt_docs"));
    assert.equal(find(root, "menu-item-Replies to everything"), null);
    assert.equal(find(root, "menu-item-Only when @mentioned"), null);
    await press(find(root, "menu-item-How and When It Answers…"));
    assert.ok(find(root, "as-pop"));
  });
});

/* ---------- the pure parts ---------- */

test("settingsOf maps the chat's row to the sheet's words, and Listening is quiet", () => {
  assert.equal(settingsOf({ mode: "lead" }).how, "lead");
  assert.equal(settingsOf({ mode: "listen" }).how, "tag");
  assert.equal(settingsOf({ mode: "listen", quiet: true }).how, "listen");
  assert.deepEqual(settingsOf({ mode: "listen", when: "hours", hoursFrom: "08:00", hoursTo: "12:00", style: "full" }), { how: "tag", when: "hours", topics: "", hoursFrom: "08:00", hoursTo: "12:00", style: "full" });
  assert.equal(hereSub({ mode: "listen", quiet: true, owned: true }, false), "Only listens · made for this chat");
});

test("directoryOf offers the Space's people and agents, the person's Assistant first, and never someone else's Assistant or a chat's own agent", () => {
  const row = (agentId: string, name: string, extra: object = {}) => ({ agentId, name, kind: "agent", ownerId: "usr_me", ...extra } as never);
  const dir = directoryOf({
    me: "usr_me",
    principals: [{ id: "usr_me", kind: "person", name: "Me", status: "active" }, { id: "usr_sara", kind: "person", name: "Sara", status: "active", title: "Associate" }, { id: "usr_gone", kind: "person", name: "Gone", status: "removed" }] as never,
    agents: [row("agt_docs", "Docs"), row("agt_mine", "Mine", { kind: "assistant" }), row("agt_theirs", "Theirs", { kind: "assistant", ownerId: "usr_sara" }), row("agt_own", "Chat only", { chatOf: "c9" }), row("agt_cc", "Claude Code", { runtime: "outside" }), row("agt_mate", "Mate", { teammateOf: "pj_9" })],
    connected: [{ agentId: "out_cc", clientName: "Claude Code", connectedAt: 1, calls: 0, redirectHost: "On this Mac" }, { agentId: "out_setup", clientName: "Setup", connectedAt: 1, calls: 0, setup: true }] as never,
  });
  assert.deepEqual(dir.people?.map((p) => p.id), ["usr_sara"]);
  assert.deepEqual(dir.agents?.map((a) => [a.id, a.name]), [["agt_mine", "Assistant"], ["agt_docs", "Docs"]]);
  assert.deepEqual(dir.outside?.map((o) => o.id), ["out_cc"]);
  assert.equal(maxLevelOf({ manage: false, edit: false, use: false }), "view");
  assert.equal(maxLevelOf({ manage: false, edit: true, use: true }), "edit");
});

test("the line after adding names who went in and who did not", () => {
  assert.equal(addedLine(["Docs"]), "Docs was added");
  assert.equal(addedLine(["Docs", "Sara"]), "Docs and Sara were added");
  assert.equal(failedLine(["Docs", "Sara", "Mira"]), "Could not add Docs, Sara and Mira. Try again.");
  const x = projectExtras([{ key: "new:1", kind: "new", id: "1", name: "Checker", role: "", brief: "Checks", model: "Opus 5.5" }, { key: "outside:o", kind: "outside", id: "o", name: "CC", role: "" }, { key: "guest:a@b.c", kind: "guest", id: "a@b.c", name: "a@b.c", role: "gview", email: "a@b.c" }], () => "k1");
  assert.deepEqual(x.creates, [{ name: "Checker", role: "Checks", model: "Opus 5.5", key: "k1" }]);
  assert.deepEqual(x.viaChat.map((p) => p.kind), ["outside", "guest"]);
});

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

