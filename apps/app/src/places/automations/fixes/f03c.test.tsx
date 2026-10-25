// P-L9f_03c: the Journey designer and Automations finish from the lead's look at P-L9f_03: the Fields tab, task states (Done with the filled check, In review, Blocked), On leaving per stage,
// the Journey types tree in the sidebar, the Failures in a row option of Alerts, and no explaining line under the escalation chain. Screens render with react-dom/server over
// react-native-web (ruling 28); a static render has no clicks, so each control is checked by the write it makes and then the screen is rendered again.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { AutomationConfig } from "../config/AutomationConfig.tsx";
import { ConfigExtrasProvider } from "../config/data.tsx";
import type { ConfigExtras } from "../config/data.tsx";
import { setWhen } from "../config/model.ts";
import type { Alerts } from "../config/model.ts";
import { createConfigSample, northwind } from "../config/sample.ts";
import type { ConfigSample } from "../config/sample.ts";
import { JourneyDesigner } from "../journeys/JourneyDesigner.tsx";
import { TASK_STATES } from "../journeys/model.ts";
import { AutomationsSidebar } from "../sidebar/AutomationsSidebar.tsx";

const page = (s: ConfigSample, el: ReactNode, extras: ConfigExtras = s.extras): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={s.data}><ConfigExtrasProvider value={extras}>{el}</ConfigExtrasProvider></AutomationsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const tag = (out: string, id: string): string => out.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>[^<]*`))?.[0] ?? "";
const nw = (): ConfigSample => createConfigSample(northwind);
const alertsOf = (s: ConfigSample, id: string): Alerts => s.replica.rows("automations").find((r) => r.id === id)!["alerts"] as Alerts;
const alertsTab = (s: ConfigSample, id: string): string => page(s, <AutomationConfig automationId={id} initialTab="alerts" />);

test("Alerts: the escalation chain ends with its Add a step row and no explaining line under it", () => {
  const out = alertsTab(nw(), "aut_lead");
  assert.ok(has(out, 'data-testid="alert-chain"') && has(out, "If it keeps failing") && has(out, 'data-testid="step-add"') && has(out, "Add another step"));
  assert.ok(!has(out, "Each step tells one more person or role"), "the line under the chain is gone");
});

test("Alerts: a rule that tells after failures in a row shows the Failures in a row count, and choosing the option on an every-failure rule adds the row", async () => {
  const s = nw();
  const invoice = alertsTab(s, "aut_invoice");
  assert.ok(has(invoice, "After failures in a row") && has(invoice, "Failures in a row") && has(invoice, 'data-testid="when-n"'), "the 3-in-a-row rule shows its count");
  const lead = alertsTab(s, "aut_lead");
  assert.ok(has(lead, "On every failure") && !has(lead, 'data-testid="when-n"'), "an every-failure rule has no count row");
  await s.data.call("automations.alerts.set", { automationId: "aut_lead", alerts: setWhen(alertsOf(s, "aut_lead"), "after_n") });
  const after = alertsTab(s, "aut_lead");
  assert.ok(has(after, "After failures in a row") && has(after, 'data-testid="when-n"'), "the option is kept and the count row appears");
});

test("task states: Done is the filled check, In review and Blocked are named at the right of the row, and a task still to do has no label", () => {
  const s = nw();
  const extras: ConfigExtras = { ...s.extras, taskStates: () => ({ t_confirm: "Done", t_review: "In review", t_conflict: "Blocked" }) };
  const out = page(s, <JourneyDesigner journeyId="jrn_onboard" />, extras);
  assert.match(tag(out, "check-t_confirm"), /aria-label="Done"/, "the done task's check says Done");
  assert.match(tag(out, "check-t_id"), /aria-label="Required"/, "a task not done keeps the open check");
  assert.match(tag(out, "state-t_review"), />In review$/);
  assert.match(tag(out, "state-t_conflict"), />Blocked$/);
  assert.match(tag(out, "state-t_confirm"), />Done$/);
  assert.ok(!has(out, 'data-testid="state-t_id"'), "a task still to do has no label");
  assert.deepEqual([...TASK_STATES], ["To do", "Doing", "In review", "Awaiting approval", "Done", "Canceled"]);
});

test("task states: a state set through the shell is kept and shows the next time the page opens", () => {
  const s = nw();
  assert.ok(!has(page(s, <JourneyDesigner journeyId="jrn_onboard" />), 'data-testid="state-t_confirm"'));
  s.extras.setTaskState?.("jrn_onboard", "t_confirm", "Doing");
  s.extras.setTaskState?.("jrn_onboard", "t_review", "Awaiting approval");
  const out = page(s, <JourneyDesigner journeyId="jrn_onboard" />);
  assert.match(tag(out, "state-t_confirm"), />Doing$/);
  assert.match(tag(out, "state-t_review"), />Awaiting approval$/);
});

test("On leaving: every stage has the section after On entering with its Add an automation row, and the Automations that run on leaving are rows", () => {
  const s = nw();
  const plain = page(s, <JourneyDesigner journeyId="jrn_onboard" />);
  assert.equal((plain.match(/>On leaving</g) ?? []).length, 5, "one On leaving per stage");
  assert.equal((plain.match(/>On entering</g) ?? []).length, 5);
  for (const k of ["consult", "intake", "letter", "kickoff", "onboarded"]) assert.ok(has(plain, `data-testid="add-leave-${k}"`), k);
  assert.ok(plain.indexOf(">On entering<") < plain.indexOf(">On leaving<"));
  s.extras.setLeaving?.("jrn_onboard", "intake", ["aut_intake3"]);
  const out = page(s, <JourneyDesigner journeyId="jrn_onboard" />);
  assert.ok(has(out, 'data-testid="row-leave-intake-aut_intake3"') && has(out, "Welcome and handover"));
  assert.ok(!has(out, 'data-testid="row-leave-consult-aut_intake3"'), "only the stage it was set on");
});

test("On leaving: a person without the Design Journeys role reads it with None and no add row", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" canDesign={false} />);
  assert.ok(has(out, ">On leaving<") && has(out, ">None<") && !has(out, 'data-testid="add-leave-intake"'));
});

test("the Journey types tree: a Journey types head with its count and a plus, each Journey as a tile, its name and its record count, and the Projects line under it", () => {
  const s = nw();
  const out = page(s, <AutomationsSidebar selectedJourneyId="jrn_onboard" initialTab="journeys" shared={s.shared} reasons={s.space.reasons} />);
  assert.ok(has(out, 'data-testid="section-types"') && has(out, "Journey types") && has(out, 'data-testid="head-types"') && has(out, 'data-testid="add-types"'));
  assert.ok(has(out, ">CO<") && has(out, ">MI<"), "a tile with the initials of each Journey");
  assert.ok(has(out, 'data-testid="journey-count-jrn_onboard"') && has(out, "Client onboarding") && has(out, "Matter intake"));
  assert.ok(has(out, 'data-testid="journeys-note"') && has(out, "cloned from the Projects template"));
  assert.ok(!has(out, "New lead follow-up"), "the Automations are not on this tab");
  assert.match(tag(out, "row-journey-jrn_onboard"), /background-color:var\(--sel\)/, "the open Journey takes the quiet selected highlight");
});

test("the Fields tab: the template's fields with their types, then the Journey's own", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" initialTab="fields" />);
  assert.ok(has(out, 'data-testid="journey-fields"') && has(out, "From the Projects template") && has(out, "Its own"));
  for (const f of ["Lead", "Budget", "Matter type", "ID verified"]) assert.ok(has(out, f), f);
  assert.ok(has(out, 'data-testid="subtab-fields"'));
});
