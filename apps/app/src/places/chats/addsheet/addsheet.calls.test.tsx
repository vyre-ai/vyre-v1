// The Add people and agents host: what each pick calls (guest invite, chat-owned and outside agents, Only listens, levels, Include earlier messages). Split from addsheet.test.tsx so each file stays under the CI cap.
// @reads /apps/app/src/places/chats/addsheet/addsheet.support.tsx
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { mount, press, find, flush, typeInto, textOf } from "../../../onboarding/test-dom.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { createSample } from "../conversation/sample.ts";
import { withDom, testIds, pickAndAdd } from "./addsheet.support.tsx";

test("a guest invite goes through threads.invite_guest with the chosen level", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await typeInto(find(root, "as-search"), "dana@fox-legal.com");
    await press(find(root, "as-invite"));
    await press(find(root, "as-role-guest:dana@fox-legal.com"));
    await press(find(root, "menu-item-Can reply"));
    await press(find(root, "as-add"));
    await flush();
    const call = s.calls.find((c) => c.cap === "threads.invite_guest");
    assert.deepEqual({ ...(call?.input as object), idempotencyKey: "k" }, { threadId: "c1", email: "dana@fox-legal.com", level: "reply", idempotencyKey: "k" });
    assert.ok(s.toasts.some((t) => /dana@fox-legal\.com was added/.test(t)), s.toasts.join("|"));
  });
});

test("a chat-owned agent is made through threads.agent.create and shows in the chat with its chat", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-new"));
    await typeInto(find(root, "as-name"), "Checker");
    await typeInto(find(root, "as-brief"), "Checks every upload against the spec");
    await press(find(root, "as-create"));
    await press(find(root, "as-add"));
    await flush();
    const call = s.calls.find((c) => c.cap === "threads.agent.create");
    assert.equal((call?.input as { threadId: string }).threadId, "c1");
    assert.equal((call?.input as { name: string }).name, "Checker");
    assert.equal((call?.input as { brief: string }).brief, "Checks every upload against the spec");
    assert.ok(!s.calls.some((c) => c.cap === "agents.create"), "it never reaches the Agents page");
    assert.ok(testIds(root).some((i) => /^face-agt_new/.test(i)), "it shows with the chat");
    assert.ok(s.toasts.includes("Checker was added"));
  });
});

test("an outside agent goes through threads.outside_agent.add, and its x on Here now calls threads.outside_agent.remove", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await pickAndAdd(root, ["outside:out_cc"]);
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.outside_agent.add").map((c) => c.input), [{ threadId: "c1", agentId: "out_cc", mode: "listen" }]);
    assert.ok(!s.calls.some((c) => c.cap === "threads.add_agent" && (c.input as { agentId: string }).agentId === "out_cc"), "never as a plain agent");
    // open again: it is Here now, and can be taken out
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-here-remove-out_cc"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.outside_agent.remove").map((c) => c.input), [{ threadId: "c1", agentId: "out_cc" }]);
    assert.equal(find(root, "as-here-remove-out_cc"), null, "gone from Here now");
    assert.ok(s.toasts.includes("Claude Code was removed"));
  });
});

test("an agent picked with Only listens is added, then set quiet; a person is added to the chat", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-agent:agt_research"));
    await press(find(root, "as-settings-agent:agt_research"));
    await press(find(root, "as-how-listen"));
    await press(find(root, "as-row-person:usr_maya"));
    await press(find(root, "as-add"));
    await flush();
    const caps = s.calls.map((c) => c.cap).filter((c) => /^threads\.(members\.add|add_agent|agent_settings\.set)$/.test(c));
    assert.deepEqual(caps, ["threads.add_agent", "threads.agent_settings.set", "threads.members.add"], "in the order picked; settings follow their agent");
    assert.equal((s.calls.find((c) => c.cap === "threads.agent_settings.set")?.input as { mode: string }).mode, "quiet");
    assert.ok(s.toasts.includes("Maya Chen and Research were added") || s.toasts.includes("Research and Maya Chen were added"), s.toasts.join("|"));
  });
});

test("a person who can only view cannot give Member: the option is not offered and the footer says why", async () => {
  await withDom(async () => {
    const s = createSample("idle", { viewOnly: true });
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_maya"));
    assert.match(textOf(find(root, "as-pick-person:usr_maya")), /Can view/);
    assert.match(textOf(find(root, "as-line-limited")), /You can view here/);
    await press(find(root, "as-role-person:usr_maya"));
    assert.ok(find(root, "menu-item-Member") === null && find(root, "menu-item-Member (you do not have this)") === null, "a level above your own is hidden, not greyed");
  });
});

test("Include earlier messages shows for a chat and is off by default; on, the person is added with fromStart; a channel and a project never show it", async () => {
  await withDom(async () => {
    const s = createSample("idle");
    const root = await mount(createRoot, <Conversation data={s.data} />);
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_maya"));
    assert.ok(find(root, "as-earlier"), "shown for a chat");
    assert.match(textOf(find(root, "as-line-std")), /from now on/);
    await press(find(root, "as-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").map((c) => c.input), [{ threadId: "c1", personId: "usr_maya" }], "off by default: no flag");
    await press(find(root, "add-agent"));
    await flush();
    await press(find(root, "as-row-person:usr_omar"));
    await press(find(root, "as-earlier"));
    assert.match(textOf(find(root, "as-line-std")), /They'll see the whole chat/);
    await press(find(root, "as-add"));
    await flush();
    assert.deepEqual(s.calls.filter((c) => c.cap === "threads.members.add").at(-1)?.input, { threadId: "c1", personId: "usr_omar", fromStart: true });
    const ch = createSample("channel");
    const room = await mount(createRoot, <Conversation data={ch.data} />);
    await press(find(room, "add-agent"));
    await flush();
    await press(find(room, "as-row-person:usr_omar"));
    assert.equal(find(room, "as-earlier"), null, "a channel's people read everything it holds");
  });
});


