// The first page wired to the place: what each press does, the connector offer (Set up, Not now, a setup that cannot start), and Ask Vyre in a pane of the tab.
// Ported from the old start page's tests (the three ways in and the template tiles are gone with that page; the offers and Ask behaviours are the same).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import type { AutomationsData } from "../canvas/data.tsx";
import { createSampleAutomations, harbor, northwind } from "../sidebar/sample.ts";
import { FirstPage } from "./FirstPage.tsx";
import { ShellRuntimeProvider } from "../../../shell/providers/runtime.tsx";
import { sampleRuntime } from "../../../shell/providers/misc-test-runtime.tsx";
import AutomationsPlace from "../../../shell/providers/automations.tsx";
import { AskPaneHost } from "../../../shell/ask/host.tsx";
import { askPaneOf, resetAskPanes } from "../../../shell/ask/pane.ts";

installDom();

function wired(space = { ...harbor, specs: [], groups: [] }) {
  const s = createSampleAutomations(space);
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const data: AutomationsData = {
    ...s.data,
    call: async (cap, input) => {
      calls.push({ cap, input });
      if (cap === "automations.create") return { automation: { id: "aut_new" } };
      return s.data.call(cap, input);
    },
    nav: { ...s.data.nav, openAutomation: (id) => void opened.push(id) },
  };
  return { data, calls, opened };
}
const page = (data: AutomationsData, hits: string[] = []) =>
  mount(
    createRoot,
    <AutomationsDataProvider value={data}>
      <FirstPage
        onExamples={() => hits.push("examples")}
        onAllRuns={() => hits.push("runs")}
        onAsk={() => hits.push("ask")}
      />
    </AutomationsDataProvider>,
  );

test("each way in does its own thing: New automation makes a blank one and opens it, the others only ask the place", async () => {
  const { data, calls, opened } = wired();
  const hits: string[] = [];
  const root = await page(data, hits);
  await flush();
  await press(find(root, "fp-examples"));
  await press(find(root, "fp-allruns"));
  await press(find(root, "fp-ask"));
  assert.deepEqual(hits, ["examples", "runs", "ask"]);
  assert.equal(calls.filter((c) => c.cap === "automations.create").length, 0);
  await press(find(root, "fp-new"));
  await flush();
  assert.deepEqual(
    calls.filter((c) => c.cap === "automations.create").map((c) => c.input),
    [{ name: "New automation" }],
  );
  assert.deepEqual(opened, ["aut_new"]);
});

const offerWorld = (
  extra: Partial<AutomationsData["nav"]>,
  offers = [{ itemId: "vit_acme", appName: "Acme", text: "Set up Acme for Automations?" }],
) => {
  const { data, calls } = wired();
  return {
    calls,
    data: {
      ...data,
      call: async (cap: string, input: unknown) => {
        if (cap === "automations.connector_offers") return { offers };
        if (cap.startsWith("automations.connector_offer.")) {
          calls.push({ cap, input });
          return { decision: cap.endsWith("accept") ? "accepted" : "declined" };
        }
        return data.call(cap, input);
      },
      nav: { ...data.nav, ...extra },
    } as AutomationsData,
  };
};

test("a saved Vault item offers a connector: Set up accepts it and starts the session, Not now declines it, and both clear the card", async () => {
  const set: string[] = [];
  const { data, calls } = offerWorld({ setUpConnector: (o) => void set.push(o.itemId) }, [
    { itemId: "vit_acme", appName: "Acme", text: "Set up Acme for Automations?" },
  ]);
  const root = await page(data);
  await flush();
  assert.match(textOf(root), /Connect Acme/);
  await press(find(root, "fp-setup-vit_acme"));
  await flush();
  assert.deepEqual(set, ["vit_acme"]);
  assert.ok(
    calls.some(
      (c) => c.cap === "automations.connector_offer.accept" && (c.input as { itemId: string }).itemId === "vit_acme",
    ),
  );
  assert.equal(find(root, "fp-setup-vit_acme"), null, "the accepted offer is gone");
  const second = offerWorld({ setUpConnector: () => undefined }, [{ itemId: "vit_beta", appName: "Beta", text: "x" }]);
  const root2 = await page(second.data);
  await flush();
  await press(find(root2, "fp-notnow-vit_beta"));
  await flush();
  assert.ok(second.calls.some((c) => c.cap === "automations.connector_offer.decline"));
  assert.equal(find(root2, "fp-notnow-vit_beta"), null);
});

test("without a connector_offers answer the page is the page", async () => {
  const { data } = wired();
  const none = {
    ...data,
    call: async (cap: string, input: unknown) => {
      if (cap === "automations.connector_offers") throw new Error("no module");
      return data.call(cap, input);
    },
  };
  const root = await page(none);
  await flush();
  assert.equal(find(root, "fp-setup-vit_acme"), null);
  assert.ok(find(root, "first-page"));
});

test("a setup that cannot start says why and keeps the offer: it is not accepted, so it is not lost", async () => {
  const { data, calls } = offerWorld({
    setUpConnector: () => {
      throw new Error("Your assistant cannot open that Vault item, so it cannot set it up.");
    },
  });
  const root = await page(data);
  await flush();
  await press(find(root, "fp-setup-vit_acme"));
  await flush();
  assert.match(textOf(root), /cannot open that Vault item/);
  assert.ok(find(root, "fp-setup-vit_acme"), "the offer is still there");
  assert.equal(
    calls.some((c) => c.cap === "automations.connector_offer.accept"),
    false,
  );
});

test("Ask Vyre opens the assistant in a pane of the tab and does not open Chats", async () => {
  const { data, opened } = wired();
  const rt = sampleRuntime({ screens: data.screens, call: data.call, opened: [] });
  const people = {
    status: "ready",
    data:
      rt.principals.getSnapshot().status === "ready" ? (rt.principals.getSnapshot() as { data: unknown[] }).data : [],
  };
  (rt as { principals: unknown }).principals = { subscribe: () => () => undefined, getSnapshot: () => people };
  const asked: unknown[] = [];
  const real = rt.open;
  (rt as { open: typeof rt.open }).open = ((t: unknown) => {
    asked.push(t);
    return real(t as never);
  }) as typeof rt.open;
  resetAskPanes();
  const root = await mount(
    createRoot,
    <ShellRuntimeProvider value={rt}>
      <AskPaneHost place="automations" rt={rt}>
        <AutomationsPlace place="automations" />
      </AskPaneHost>
    </ShellRuntimeProvider>,
  );
  await flush();
  assert.equal(find(root, "ask-pane"), null, "closed to begin with");
  await press(find(root, "fp-ask"));
  for (let i = 0; i < 4; i++) await flush();
  assert.ok(find(root, "ask-pane"), "the shared pane opens beside the body");
  assert.ok(find(root, "automations-place"), "the place stays");
  assert.equal(askPaneOf("automations")!.thing, null, "about Automations itself");
  assert.equal(askPaneOf("automations")!.context?.focus, "focus-automations");
  assert.deepEqual(asked, [], "nothing navigated to Chats");
  assert.deepEqual(opened, []);
  void northwind;
});

test("a paused Automation's card says the reason its builder head says, and offers no run to read", async () => {
  const { data } = wired(northwind as never);
  const root = await page(data);
  for (let i = 0; i < 4; i++) await flush();
  const card = textOf(find(root, "fp-fix-aut_lead")?.parent ?? root);
  assert.ok(card.includes("Needs the Twilio key"), card);
  assert.equal(find(root, "fp-run-aut_lead"), null, "no See the run for a pause with its own reason");
});
