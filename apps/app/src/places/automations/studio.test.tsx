// Studio wiring: the sidebar slot, Promote, finished runs, sandbox replay versus a live re-run, Preview, and a scrubbed Ask Vyre bundle.
import test from "node:test";
import assert from "node:assert/strict";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskVyre } from "./ask/AskVyre.tsx";
import { scrubAskContext } from "./ask/bundle.ts";
import { AutomationCanvas } from "./canvas/AutomationCanvas.tsx";
import { AutomationsDataProvider } from "./canvas/data.tsx";
import { availabilityFor, menuGroups, stepsFromRuntime } from "./catalog/model.ts";
import { SAMPLE_CATALOG } from "./catalog/sample.ts";
import { connectionRoute, setupFromIssue } from "./connect/route.ts";
import { RunsDataProvider } from "./runs/data.tsx";
import { canStopRun, LIVE_RERUN_LABEL, SANDBOX_REPLAY_LABEL } from "./runs/ledger.ts";
import { RunChat } from "./runs/RunChat.tsx";
import { createSampleRuns, northwind as runsNorthwind } from "./runs/sample.ts";
import { AutomationsSidebarSlot } from "./sidebar/AutomationsSidebarSlot.tsx";
import { createSampleAutomations, northwind } from "./sidebar/sample.ts";
import { SidebarContent } from "../../shell/sidebar/index.ts";

const has = (s: string, needle: string): boolean => s.includes(needle);

test("the sidebar registers through SidebarContent", () => {
  const el = AutomationsSidebarSlot({ selectedId: null, view: "automations", onView: () => undefined }) as ReactElement<{ title: string; searchPlaceholder?: string }>;
  assert.equal(el.type, SidebarContent);
  assert.deepEqual([el.props.title, el.props.searchPlaceholder], ["Automations", "Search automations"]);
});

test("Promote opens the sheet", () => {
  const s = createSampleAutomations(northwind);
  const out = renderToStaticMarkup(
    <AutomationsDataProvider value={s.data}><AutomationCanvas automationId="aut_digest" initialPromote /></AutomationsDataProvider>,
  );
  assert.ok(has(out, 'data-testid="promote-sheet"'));
  assert.ok(!has(out, "Promote opens its own sheet"));
});

test("a failed run has no Stop, and replay and live re-run are different labels", () => {
  const s = createSampleRuns(runsNorthwind);
  const out = renderToStaticMarkup(<RunsDataProvider value={s.data}><RunChat runId="rl1" /></RunsDataProvider>);
  assert.ok(!has(out, 'data-testid="stop-failed"') && !has(out, 'data-testid="stop-run"'));
  assert.ok(has(out, SANDBOX_REPLAY_LABEL) && has(out, LIVE_RERUN_LABEL));
  assert.notEqual(SANDBOX_REPLAY_LABEL, LIVE_RERUN_LABEL);
  assert.equal(canStopRun("failed"), false);
  assert.equal(canStopRun("succeeded"), false);
  assert.equal(canStopRun("running"), true);
});

test("AI and Code are live steps: every step and trigger is available, and the catalog lists what the server sends", () => {
  for (const key of ["ai", "code", "http_request", "parallel", "loop", "wait"]) assert.equal(availabilityFor(key, "step"), "available", key);
  assert.equal(availabilityFor("schedule", "trigger"), "available");
  const kept = stepsFromRuntime({ steps: [
    { key: "ai", title: "AI step", category: "ai" }, { key: "code", title: "Run code", category: "code" }, { key: "http_request", title: "HTTP request", category: "data" }, { key: "records.find", title: "Find records", category: "data" },
  ] })!;
  assert.deepEqual(kept.map((s) => [s.key, s.group, s.availability]), [["ai", "AI and code", "available"], ["code", "AI and code", "available"], ["http_request", "Connected apps", "available"], ["records.find", "Data & transforms", "available"]]);
  assert.deepEqual(menuGroups(kept).map((g) => g.head), ["Connected apps", "AI and code", "Data & transforms"]);
  assert.ok(kept.every((s) => s.note === undefined), "no step carries a preview note");
});

test("Ask Vyre context omits a field named secret, authorization, or cookie", () => {
  const bundle = scrubAskContext({
    errorCode: "step_failed",
    message: "The step failed",
    traceId: "tr_1",
    definitionVersion: 5,
    nodeId: "text",
    stepKey: "send_sms",
    attempt: 1,
    connectionId: "conn_1",
    connectionState: "missing",
    secret: "should-not-leave",
    authorization: "Bearer hidden",
    cookie: "session=hidden",
    body: { raw: "request" },
    fields: [
      { name: "secret", type: "string" },
      { name: "authorization", type: "string" },
      { name: "cookie", type: "string" },
      { name: "to", type: "string" },
    ],
  });
  const text = JSON.stringify(bundle);
  assert.equal(bundle.fields?.map((field) => field.name).join(","), "to");
  assert.ok(!text.includes("should-not-leave") && !text.includes("Bearer") && !text.includes("session=hidden"));
  assert.ok(!("secret" in bundle) && !("authorization" in bundle) && !("cookie" in bundle) && !("body" in bundle));
  const shown = renderToStaticMarkup(<AskVyre bundle={bundle} showShare />);
  assert.ok(has(shown, "to") && !has(shown, "should-not-leave") && !has(shown, "Bearer"));
});

test("SAMPLE_CATALOG is sample data for tests with no runtime, not the product catalog", () => {
  assert.equal(SAMPLE_CATALOG, true);
});

test("Connect uses a structured service and does not read the error sentence", () => {
  const parsed = setupFromIssue({ nodeId: "text", message: "Needs the Twilio key" });
  assert.equal(parsed.connect, undefined);
  assert.match(parsed.blocked ?? "", /Step text is blocked/);
  const routed = connectionRoute({ service: "twilio" });
  assert.equal(routed.screen, "console.integrations");
  assert.notEqual(routed.screen, "mail.connections");
  assert.equal(connectionRoute({ service: "mail" }).screen, "mail.connections");
  assert.equal(connectionRoute({ service: "twilio", kind: "key" }).screen, "vault.providers");
});
