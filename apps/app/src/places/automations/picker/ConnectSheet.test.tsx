// The Connect an app sheet (design 2.4 and 4F): what is in his Vault, what the Space has, another app, and Add an app inside the same sheet. Every element has a defined press.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { Text } from "react-native";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { ConnectSheet } from "./ConnectSheet.tsx";
import type { PickApp } from "./model.ts";

installDom();

const APPS: PickApp[] = [
  {
    id: "notion",
    name: "Notion",
    connected: false,
    mayUse: false,
    vault: { item: "Notion key", use: "use", assistant: "cleared" },
  },
  { id: "microsoft", name: "Microsoft 365", connected: true, mayUse: false, admin: "Dana Whitfield" },
  {
    id: "co",
    name: "Payroll",
    connected: false,
    mayUse: false,
    company: true,
    vault: { item: "Payroll key", use: "use", assistant: "cleared" },
  },
  {
    id: "hid",
    name: "Hidden app",
    connected: false,
    mayUse: false,
    vault: { item: "Hidden", use: "none", assistant: "cleared" },
  },
];
const KNOWN = [
  { id: "hubspot", name: "HubSpot" },
  { id: "slack", name: "Slack" },
];

function setup(extra: Partial<Parameters<typeof ConnectSheet>[0]> = {}) {
  const calls: string[] = [];
  const el = (
    <ConnectSheet
      apps={APPS}
      known={KNOWN}
      onSetup={(id) => calls.push(`setup:${id}`)}
      onAsk={(id) => calls.push(`ask:${id}`)}
      onDescribe={() => calls.push("describe")}
      onClose={() => calls.push("close")}
      {...extra}
    />
  );
  return { calls, el };
}

test("it lists In your Vault, Your Space has it and Another app, and never a company key or an item he may not use", async () => {
  const { el } = setup();
  const root = await mount(createRoot, el);
  const t = textOf(root);
  for (const want of [
    "Connect an app",
    "In your Vault",
    "Notion",
    "Set up",
    "Your Space has it",
    "Microsoft 365",
    "Ask Dana Whitfield",
    "Another app",
    "Describe it",
  ])
    assert.ok(t.includes(want), want);
  assert.ok(!t.includes("Payroll") && !t.includes("Hidden app"));
});

test("each action does one defined thing", async () => {
  const { el, calls } = setup();
  const root = await mount(createRoot, el);
  await press(find(root, "cs-act-notion"));
  await press(find(root, "cs-act-microsoft"));
  await press(find(root, "cs-act-another"));
  assert.deepEqual(calls, ["setup:notion", "ask:microsoft", "describe"]);
});

test("Add an app: known apps by name, any other name as Add 'Name'; choosing one hands over to the credential card inside the sheet", async () => {
  const { el } = setup({
    renderAdd: (choice, back) => (
      <>
        <Text>{`card for ${choice.label}`}</Text>
        <Text testID="cs-card-back" onPress={back}>
          back
        </Text>
      </>
    ),
  });
  const root = await mount(createRoot, el);
  await typeInto(find(root, "cs-add-search"), "hub");
  const t = textOf(root);
  assert.ok(t.includes("HubSpot") && t.includes("Add “hub”"));
  await press(find(root, "row-cs-add-hubspot"));
  await flush();
  assert.ok(textOf(root).includes("card for HubSpot"));
  assert.ok(!textOf(root).includes("In your Vault"), "the sheet shows the card in place of the list");
  await press(find(root, "cs-card-back"));
  await flush();
  assert.ok(textOf(root).includes("In your Vault"));
});

test("an app just added shows at the top, ready, with an optional link to the Vault", async () => {
  const { el, calls } = setup({
    apps: [{ id: "hubspot", name: "HubSpot", connected: true, mayUse: true }, ...APPS],
    justAdded: "hubspot",
    onOpenVault: () => calls.push("vault"),
  });
  const root = await mount(createRoot, el);
  const t = textOf(root);
  assert.ok(t.indexOf("Ready to use in steps") < t.indexOf("In your Vault"));
  assert.ok(t.includes("Added to your Vault. HubSpot is ready."));
  await press(find(root, "cs-open-vault"));
  assert.deepEqual(calls, ["vault"]);
});
