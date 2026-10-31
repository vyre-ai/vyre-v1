// Connect in place on the Automations place: the Send step's Account picker, the AI key picker, and the "things to fix" banner each offer to connect what is missing,
// open the real flow over the page, and take the new account when the flow finishes.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../ui/src/testing/dom.ts";
import { ConnectInlineHost } from "../../shell/connect/ConnectInline.tsx";
import type { Connected, ConnectNeed } from "../../shell/connect/model.ts";
import { AutomationsDataProvider } from "./canvas/data.tsx";
import { AutomationCanvas } from "./canvas/AutomationCanvas.tsx";
import { Inspector } from "./canvas/Inspector.tsx";
import type { Definition } from "./canvas/model.ts";
import { createSampleAutomations, northwind } from "./sidebar/sample.ts";

installDom(); // stays up for the whole file: mounted rows clean up their listeners after a test ends
const SAMPLE = createSampleAutomations(northwind);
const mailbox: Connected = { id: "mbx_new", title: "firm@example.com", app: "mail" };
const key: Connected = { id: "prv_new", title: "Team Anthropic", app: "ai" };

function flowFor(account: Connected, asked: ConnectNeed[]) {
  return function render({ need, onDone, onCancel }: { need: ConnectNeed; onDone(a: Connected): void; onCancel(): void }): ReactElement {
    asked.push(need);
    return (
      <>
        <Pressable testID="flow-finish" onPress={() => onDone(account)}><Text>Finish</Text></Pressable>
        <Pressable testID="flow-close" onPress={onCancel}><Text>Close</Text></Pressable>
      </>
    );
  };
}

const SEND: Definition = {
  triggers: [{ key: "schedule", config: { cron: "Every Monday 9:00" } }],
  start: ["send"],
  nodes: [{ id: "send", key: "send_email", title: "Send the digest", input: { to: "{{lead.email}}" }, next: [] }],
};

function inspector(def: Definition, onChange: (d: Definition) => void): ReactElement {
  return (
    <AutomationsDataProvider value={SAMPLE.data}><Inspector
      def={def} node={def.nodes[0]!} trigger={null} triggerIndex={null} issues={[]} keys={[]} accounts={[]}
      inputSchema={{ properties: { mailboxId: {}, to: {} } }} onChange={onChange} onClose={() => undefined} onDelete={() => undefined}
    /></AutomationsDataProvider>
  );
}

test("the Send step's empty Account picker offers Connect a mailbox, opens the flow, and takes the new mailbox", async () => {
  try {
    const asked: ConnectNeed[] = [];
    const changes: Definition[] = [];
    const root = await mount(createRoot, <ConnectInlineHost rt={null} render={flowFor(mailbox, asked)}>{inspector(SEND, (d) => changes.push(d))}</ConnectInlineHost>);
    assert.ok(textOf(find(root, "choose-account")).includes("No accounts yet"));
    await press(find(root, "choose-account"));
    const item = find(root, "menu-item-Connect a mailbox");
    assert.ok(item, "the only choice in an empty picker is to connect");
    assert.equal(find(root, "menu-item-No accounts yet"), null, "no disabled placeholder row");
    await press(item);
    await flush();
    assert.deepEqual(asked, [{ kind: "mailbox" }], "the mailbox flow opened over the page");
    assert.ok(find(root, "flow-finish"));
    await press(find(root, "flow-finish"));
    await flush();
    const last = changes[changes.length - 1];
    assert.equal(last?.nodes[0]?.input?.["mailboxId"], "mbx_new", "the new mailbox is on the step");
    assert.equal(last?.nodes[0]?.input?.["to"], "{{lead.email}}", "the rest of the step is kept");
  } finally { /* the DOM stays up until the file ends: mounted rows clean up their listeners later */ }
});

test("a picker that has a mailbox still ends in + Connect another", async () => {
  try {
    const asked: ConnectNeed[] = [];
    const def: Definition = { ...SEND, nodes: [{ ...SEND.nodes[0]!, input: { to: "x", mailboxId: "mbx_a" } }] };
    const root = await mount(createRoot, (
      <ConnectInlineHost rt={null} render={flowFor(mailbox, asked)}>
        <AutomationsDataProvider value={SAMPLE.data}><Inspector
          def={def} node={def.nodes[0]!} trigger={null} triggerIndex={null} issues={[]} keys={[]} accounts={[{ app: "mail", id: "mbx_a", title: "ana@example.com", state: "active" }]}
          inputSchema={{ properties: { mailboxId: {} } }} onChange={() => undefined} onClose={() => undefined} onDelete={() => undefined}
        /></AutomationsDataProvider>
      </ConnectInlineHost>
    ));
    await press(find(root, "choose-account"));
    assert.ok(find(root, "menu-item-ana@example.com (active)"));
    await press(find(root, "menu-item-+ Connect another"));
    await flush();
    assert.deepEqual(asked, [{ kind: "mailbox" }]);
  } finally { /* the DOM stays up until the file ends: mounted rows clean up their listeners later */ }
});

test("with no host the Account picker shows no Connect item", async () => {
  try {
    const root = await mount(createRoot, inspector(SEND, () => undefined));
    await press(find(root, "choose-account"));
    assert.equal(find(root, "menu-item-Connect a mailbox"), null);
  } finally { /* the DOM stays up until the file ends: mounted rows clean up their listeners later */ }
});

test("the AI step's Runs on picker offers Add an AI account and takes the one that was added", async () => {
  try {
    const asked: ConnectNeed[] = [];
    const changes: Definition[] = [];
    const def: Definition = { triggers: [{ key: "manual" }], start: ["ask"], nodes: [{ id: "ask", key: "ai", title: "Ask Vyre", input: { prompt: "Hi" }, next: [] }] };
    const root = await mount(createRoot, (
      <ConnectInlineHost rt={null} render={flowFor(key, asked)}>
        <AutomationsDataProvider value={SAMPLE.data}>
          <Inspector def={def} node={def.nodes[0]!} trigger={null} triggerIndex={null} issues={[]} keys={[]} kind="space" onChange={(d) => changes.push(d)} onClose={() => undefined} onDelete={() => undefined} />
        </AutomationsDataProvider>
      </ConnectInlineHost>
    ));
    await press(find(root, "choose-key"));
    assert.ok(find(root, "menu-item-No key"), "No key stays a choice");
    await press(find(root, "menu-item-Add an AI account"));
    await flush();
    assert.deepEqual(asked, [{ kind: "ai" }]);
    await press(find(root, "flow-finish"));
    await flush();
    assert.equal(changes[changes.length - 1]?.nodes[0]?.ai?.keyId, "prv_new", "the new account is the one the step runs on");
  } finally { /* the DOM stays up until the file ends: mounted rows clean up their listeners later */ }
});

test("the banner's missing mailbox opens the same flow and puts the mailbox on the step", async () => {
  try {
    const s = createSampleAutomations(northwind);
    const asked: ConnectNeed[] = [];
    const root = await mount(createRoot, (
      <ConnectInlineHost rt={null} render={flowFor(mailbox, asked)}>
        <AutomationsDataProvider value={s.data}><AutomationCanvas automationId="aut_invoice" /></AutomationsDataProvider>
      </ConnectInlineHost>
    ));
    await flush();
    const link = find(root, "problem-connect");
    assert.ok(link, "the banner offers to connect");
    assert.ok(textOf(link).includes("Connect a mailbox"));
    await press(link);
    await flush();
    assert.deepEqual(asked, [{ kind: "mailbox" }]);
    await press(find(root, "flow-finish"));
    await flush();
    assert.equal(find(root, "problem-connect"), null, "the step has its mailbox, so the banner has nothing left to connect");
  } finally { /* the DOM stays up until the file ends: mounted rows clean up their listeners later */ }
});
