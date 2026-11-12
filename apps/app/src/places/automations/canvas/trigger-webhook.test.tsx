// The web request trigger shows its address where it is set up, with Copy, so the person can paste it into the app that calls it without leaving the card for the Settings tab.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "./data.tsx";
import { Inspector } from "./Inspector.tsx";
import type { Definition } from "./model.ts";
import { createSampleAutomations, northwind } from "../sidebar/sample.ts";

installDom();
const noop = (): void => undefined;
const URL_ = "https://fresh.vyre.run/hooks/aut_lead/abc123";

test("the web request trigger card shows the address and copies it", async () => {
  const sample = createSampleAutomations(northwind);
  const asked: unknown[] = [];
  const base = sample.data.call.bind(sample.data);
  const data = { ...sample.data, call: async (cap: string, input: unknown) => { if (cap === "automations.webhook_url.get") { asked.push(input); return { url: URL_, method: "POST" }; } return base(cap as never, input as never); } } as typeof sample.data;
  const copied: string[] = [];
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (t: string) => { copied.push(t); } } } });
  const trigger = { key: "webhook" };
  const def: Definition = { triggers: [trigger], nodes: [] };
  const root = await mount(createRoot, (
    <AutomationsDataProvider value={data}>
      <Inspector automationId="aut_lead" def={def} node={null} trigger={trigger} triggerIndex={0} issues={[]} keys={[]} onChange={noop} onClose={noop} onDelete={noop} />
    </AutomationsDataProvider>
  ));
  await new Promise((r) => setTimeout(r, 30));
  const row = find(root, "trigger-webhook");
  assert.ok(row, "the address row shows on the card");
  assert.match(textOf(row), /fresh\.vyre\.run\/hooks\/aut_lead\/abc123/);
  assert.deepEqual(asked, [{ automationId: "aut_lead" }]);
  await press(find(root, "trigger-webhook-copy"));
  assert.deepEqual(copied, [URL_]);
  assert.equal(textOf(root).includes("Settings tab"), false, "the card does not send the person elsewhere for it");
});

test("the web request trigger says it once, in one word, and shows the whole address", async () => {
  const sample = createSampleAutomations(northwind);
  const base = sample.data.call.bind(sample.data);
  const long = "https://fresh.vyre.run/hooks/automation/aut_01a1cd4f0acd41cd8722d95cd4dafe11/aa1d3dd9685f8e9de09d7b6a2e7fca4474dc1ffdfd4db4cc";
  const data = { ...sample.data, call: async (cap: string, input: unknown) => (cap === "automations.webhook_url.get" ? { url: long, method: "POST" } : base(cap as never, input as never)) } as typeof sample.data;
  const trigger = { key: "webhook" };
  const root = await mount(createRoot, (
    <AutomationsDataProvider value={data}>
      <Inspector automationId="aut_lead" def={{ triggers: [trigger], nodes: [] }} node={null} trigger={trigger} triggerIndex={0} issues={[]} keys={[]} onChange={noop} onClose={noop} onDelete={noop} />
    </AutomationsDataProvider>
  ));
  await new Promise((r) => setTimeout(r, 30));
  const text = textOf(root);
  assert.equal(/webhook/i.test(text), false, `the plain word is "web request": ${text}`);
  assert.equal(text.includes("This starts a run."), false, "the trigger's own line already says what it does");
  const urlNode = find(root, "trigger-webhook-url");
  assert.ok(urlNode, "the address has its own text");
  assert.equal(urlNode!.props["numberOfLines"], undefined, "the address is never cut");
  assert.ok(textOf(urlNode).includes(long));
});

test("with no public address the card says so, gives an admin the door and a member the words, and offers no Copy of a path", async () => {
  for (const admin of [true, false]) {
    const sample = createSampleAutomations(northwind);
    const base = sample.data.call.bind(sample.data);
    const opened: string[] = [];
    const data = { ...sample.data, nav: { ...sample.data.nav, ...(admin ? { openAddress: () => { opened.push("address"); } } : {}) },
      call: async (cap: string, input: unknown) => (cap === "automations.webhook_url.get" ? { url: "/hooks/automation/aut_lead/abc", method: "POST" } : base(cap as never, input as never)) } as typeof sample.data;
    const trigger = { key: "webhook" };
    const root = await mount(createRoot, (
      <AutomationsDataProvider value={data}>
        <Inspector automationId="aut_lead" def={{ triggers: [trigger], nodes: [] }} node={null} trigger={trigger} triggerIndex={0} issues={[]} keys={[]} onChange={noop} onClose={noop} onDelete={noop} />
      </AutomationsDataProvider>
    ));
    await new Promise((r) => setTimeout(r, 30));
    const row = find(root, "trigger-webhook");
    assert.ok(row);
    assert.match(textOf(row), /No app outside can reach this yet/);
    assert.equal(textOf(row).includes("/hooks/"), false, "a bare path is never shown as an address");
    assert.equal(find(root, "trigger-webhook-copy"), null);
    if (admin) { await press(find(root, "trigger-webhook-set-address")); assert.deepEqual(opened, ["address"]); }
    else { assert.equal(find(root, "trigger-webhook-set-address"), null); assert.match(textOf(row), /Ask an admin to give this Space a public address/); }
  }
});
