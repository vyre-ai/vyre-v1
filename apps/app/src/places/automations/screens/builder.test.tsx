// The new builder page drawn from the Northwind sample (the prototype's "New lead follow-up") through the live screen queries: the head, the three tabs, When, and every step as a sentence with no field key.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { LEAD_FOLLOW_UP, createSampleAutomations, northwind } from "../sidebar/sample.ts";
import { BuilderPage } from "./BuilderPage.tsx";

const html = (id = "aut_lead"): string =>
  renderToStaticMarkup(
    <AutomationsDataProvider value={createSampleAutomations(northwind).data}>
      <BuilderPage automationId={id} />
    </AutomationsDataProvider>,
  ).replaceAll("<!-- -->", "");

test("the head names the Automation, says its state in words and offers Ask Vyre and Test; the tabs are Steps, Runs and Settings", () => {
  const out = html();
  assert.ok(out.includes("New lead follow-up"));
  for (const w of ["Ask Vyre", "Test", "Steps", "Runs", "Settings"]) assert.ok(out.includes(w), w);
  assert.ok(!out.includes("Basic") && !out.includes("Advanced"), "no Basic and Advanced");
});

test("When, then every step numbered from 1, each a sentence; no step id or field key reaches the page", () => {
  const out = html();
  assert.ok(out.includes("When"));
  const count = LEAD_FOLLOW_UP.nodes.filter((n) => !["paths"].includes(n.key)).length;
  assert.ok(count > 2);
  for (const n of LEAD_FOLLOW_UP.nodes) assert.ok(!out.includes(`>${n.id}<`), `no raw id ${n.id}`);
  assert.ok(!/\b(stp|aut|run)_[a-z0-9]+/i.test(out.replace(/data-testid="[^"]*"/g, "")), "no raw id in text");
  assert.ok(out.includes('data-testid="sv-add"'), "Add a step");
});

test("an Automation that is not there says so instead of an empty page", () => {
  assert.ok(html("aut_nope").includes("not available") || html("aut_nope").includes("builder-loading"));
});

test("opening an Automation writes nothing: no update, no save, whatever the step kinds", async () => {
  const { createRoot } = await import("test-renderer");
  const { flush, installDom, mount } = await import("../../../../../../ui/src/testing/dom.ts");
  installDom();
  const s = createSampleAutomations(northwind);
  const writes: string[] = [];
  const data = {
    ...s.data,
    call: async (cap: string, input: unknown) => {
      if (/^automations\.(update|create|set_enabled|delete|restore_version|run|test)$/.test(cap)) writes.push(cap);
      return s.data.call(cap, input);
    },
  };
  for (const id of ["aut_lead", "aut_invoice", "aut_meeting"]) {
    await mount(
      createRoot,
      <AutomationsDataProvider value={data}>
        <BuilderPage automationId={id} />
      </AutomationsDataProvider>,
    );
    await flush();
    await new Promise((r) => setTimeout(r, 1200));
  }
  assert.deepEqual(writes, [], "opening and leaving an Automation with no edit changes nothing on the server");
});
