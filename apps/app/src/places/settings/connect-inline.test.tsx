// Settings > Memory: the account picker for upkeep ends in Connect, opens the real flow over Settings, and saves the account that comes back.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { Pressable, Text } from "react-native";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press } from "../../../../../ui/src/testing/dom.ts";
import { ConnectInlineHost } from "../../shell/connect/ConnectInline.tsx";
import type { Connected, ConnectNeed } from "../../shell/connect/model.ts";
import { Choice } from "./ui.tsx";

installDom(); // stays up for the whole file: mounted rows clean up their listeners after a test ends

const added: Connected = { id: "prv_new", title: "Team Anthropic", app: "ai", ref: "#Team_Anthropic_Key" };
const render = (asked: ConnectNeed[]) => ({ need, onDone }: { need: ConnectNeed; onDone(a: Connected): void }): ReactElement => {
  asked.push(need);
  return <Pressable testID="flow-finish" onPress={() => onDone(added)}><Text>Finish</Text></Pressable>;
};

test("an empty memory account picker offers Add an AI account, and the account that comes back is saved by its Vault handle", async () => {
  const asked: ConnectNeed[] = [];
  const saved: string[] = [];
  const root = await mount(createRoot, (
    <ConnectInlineHost rt={null} render={render(asked)}>
      <Choice
        value="" options={[{ value: "", label: "None (rules only)" }]} label="Your memory account" testID="ctl" onChange={() => undefined}
        connect={{ need: { kind: "ai" }, empty: true, onConnected: (made) => saved.push(made.ref ?? made.id) }}
      />
    </ConnectInlineHost>
  ));
  await press(find(root, "ctl"));
  assert.ok(find(root, "menu-item-None (rules only)"), "None stays a choice");
  await press(find(root, "menu-item-Add an AI account"));
  await flush();
  assert.deepEqual(asked, [{ kind: "ai" }]);
  await press(find(root, "flow-finish"));
  await flush();
  assert.deepEqual(saved, ["#Team_Anthropic_Key"]);
});

test("a picker that already has accounts ends in + Connect another", async () => {
  const asked: ConnectNeed[] = [];
  const root = await mount(createRoot, (
    <ConnectInlineHost rt={null} render={render(asked)}>
      <Choice
        value="" options={[{ value: "", label: "None (rules only)" }, { value: "#a", label: "Team (shared)" }]} label="Space memory account" testID="ctl" onChange={() => undefined}
        connect={{ need: { kind: "ai" }, empty: false, onConnected: () => undefined }}
      />
    </ConnectInlineHost>
  ));
  await press(find(root, "ctl"));
  assert.ok(find(root, "menu-item-Team (shared)"));
  await press(find(root, "menu-item-+ Connect another"));
  await flush();
  assert.deepEqual(asked, [{ kind: "ai" }]);
});
