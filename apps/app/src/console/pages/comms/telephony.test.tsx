import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "test-renderer";
import type { ReactElement } from "react";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../../ui/src/testing/dom.ts";
import { ConsoleDataProvider } from "../../shell/data.tsx";
import type { ConsoleData } from "../../shell/data.tsx";
import { createSampleConsole } from "../../shell/sample.ts";
import { NumbersPage } from "./Numbers.tsx";

installDom();

const SID = "AC" + "0123456789abcdef".repeat(2);

function world(rows: Record<string, unknown>, onCall: (cap: string, input: unknown) => unknown = () => ({})): ConsoleData {
  const sample = createSampleConsole().data;
  const held = new Map<string, unknown>();
  const stateOf = (cap: string): unknown => { if (!held.has(cap)) held.set(cap, cap in rows ? { status: "ready", data: rows[cap] } : { status: "loading" }); return held.get(cap); };
  return {
    ...sample,
    can: () => true,
    call: async (cap, input) => onCall(cap, input),
    screens: { ...sample.screens, capQuery: (cap: string) => ({ subscribe: () => () => undefined, getSnapshot: () => stateOf(cap), refresh: () => undefined }) as never },
  } as ConsoleData;
}
const draw = (el: ReactElement, data: ConsoleData): string => renderToStaticMarkup(<ConsoleDataProvider value={data}>{el}</ConsoleDataProvider>);

const number = (id: string, assignees: { kind: string; id: string }[]) => ({ id, e164: `+1415555${id.slice(-4)}`, title: "Line", capabilities: ["voice", "sms"], assigneeKind: "inbox", assigneeId: null, assignees, ring: [], recording: "off", state: "active" });

test("nothing connected: the guided connect, and no number setup in sight", () => {
  const out = draw(<NumbersPage />, world({ "telephony.number.list": { numbers: [] } }));
  assert.match(out, /Connect Twilio/);
  assert.match(out, /Account SID/);
  assert.match(out, /Auth Token/);
  assert.doesNotMatch(out, /Needs an owner/);
});

test("connected: numbers with nobody on them need an owner, apart from the rest", () => {
  const out = draw(<NumbersPage />, world({
    "telephony.number.list": { numbers: [number("num_0100", []), number("num_0101", [{ kind: "person", id: "usr_maya" }])] },
    "access.principals.list": { principals: [{ id: "usr_maya", name: "Maya Chen" }] },
    "twilio.health": { state: "healthy" },
  }));
  assert.match(out, /Needs an owner/);
  assert.match(out, /Only admins can see these/);
  assert.match(out, /Maya Chen/);
  assert.match(out, /Assign/);
  assert.match(out, /Bring in new numbers/);
});

test("Connect stores both keys in the Vault, tests them, and the plain refusal is what the person reads", async () => {
  const calls: { cap: string; input: Record<string, unknown> }[] = [];
  let made = false;
  const data = world({ "telephony.number.list": { numbers: [] } }, (cap, input) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "vault.folders.list") return { folders: made ? [{ id: "fld_1", name: "Company connections", yourLevel: "manage" }] : [] };
    if (cap === "vault.folders.create") { made = true; return { folder: { id: "fld_1" } }; }
    if (cap === "vault.items.list") return { items: [] };
    if (cap === "vault.item.put") return { item: { id: `itm_${calls.length}` } };
    if (cap === "telephony.connect") return { connected: false, detail: "Twilio did not accept the credentials.", imported: 0, total: 0, numbers: [], notSetUp: 0 };
    return {};
  });
  const root = await mount(createRoot, <ConsoleDataProvider value={data}><NumbersPage /></ConsoleDataProvider>);
  await press(find(root, "telephony-connect-button"));
  await flush();
  assert.equal(calls.length, 0, "a bad SID never leaves the page");
  await typeInto(find(root, "telephony-sid"), SID);
  await typeInto(find(root, "telephony-token"), "a-token-from-the-test");
  await press(find(root, "telephony-connect-button"));
  await flush();
  const puts = calls.filter((c) => c.cap === "vault.item.put");
  assert.deepEqual(puts.map((c) => c.input.name), ["Twilio_Account", "Twilio_Auth"]);
  assert.equal(calls.filter((c) => c.cap === "vault.folders.create").length, 1, "one folder holds both keys");
  const labelled = new Set(calls.filter((c) => c.cap === "access.labels.set").map((c) => (c.input.resource as { type: string }).type + (c.input.label as string)));
  assert.deepEqual([...labelled].sort(), ["vault_folderrestricted", "vault_itemrestricted"], "the folder and both keys are Restricted");
  assert.ok(calls.some((c) => c.cap === "telephony.connect"), "the keys are tested at once");
  assert.ok(JSON.stringify(root.toJSON()).includes("Twilio did not accept the credentials."));
  assert.ok(!JSON.stringify(root.toJSON()).includes("a-token-from-the-test"), "the token is gone from the page once stored");
});
