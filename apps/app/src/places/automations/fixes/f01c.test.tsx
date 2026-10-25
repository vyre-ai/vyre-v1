// P-L9f_01c: the Journey detail page as the prototype draws it (header with the record count, Stages, Fields and Settings tabs, the records-per-stage bar, numbered stages with tasks and
// automations), and the Journeys tab of the sidebar selecting the open Journey. Screens render with react-dom/server over react-native-web (ruling 28), from the Northwind sample.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { ConfigExtrasProvider } from "../config/data.tsx";
import type { ConfigExtras } from "../config/data.tsx";
import { createConfigSample, northwind } from "../config/sample.ts";
import type { ConfigSample } from "../config/sample.ts";
import { FieldsTab } from "../journeys/FieldsTab.tsx";
import { JourneyDesigner } from "../journeys/JourneyDesigner.tsx";
import { AutomationsSidebar } from "../sidebar/AutomationsSidebar.tsx";

const page = (s: ConfigSample, el: ReactNode, extras: ConfigExtras = s.extras): string =>
  renderToStaticMarkup(<AutomationsDataProvider value={s.data}><ConfigExtrasProvider value={extras}>{el}</ConfigExtrasProvider></AutomationsDataProvider>).replaceAll("<!-- -->", "");
const has = (s: string, needle: string): boolean => s.includes(needle);
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };
const nw = (): ConfigSample => createConfigSample(northwind);

test("detail header: the Journey name, its record count and late count, Open records in Records, and the Stages, Fields and Settings tabs with their counts", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" />);
  assert.ok(has(out, 'data-testid="journey-designer"') && has(out, "Client onboarding") && has(out, "14 records") && has(out, "1 late"));
  assert.ok(has(out, 'data-testid="open-records"') && has(out, "Open records in Records"));
  const tabs = ["stages", "fields", "settings"].map((k) => at(out, `data-testid="subtab-${k}"`));
  assert.deepEqual([...tabs].sort((a, b) => a - b), tabs, "Stages, Fields, Settings in that order");
  assert.ok(has(out, ">5<") && has(out, ">11<"), "five stages and eleven fields (seven from the template, four of its own)");
});

test("Stages tab: the records-per-stage bar, then the numbered stages with their record counts, tasks and the automations that run on entering", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" />);
  assert.ok(has(out, "Where the records are now") && has(out, "Records per stage") && has(out, 'data-testid="funnel-intake"'));
  const keys = ["consult", "intake", "letter", "kickoff", "onboarded"].map((k) => at(out, `data-testid="stage-${k}"`));
  assert.deepEqual([...keys].sort((a, b) => a - b), keys, "stages in order");
  for (const [i, label] of ["Stage 1, Consult booked", "Stage 2, Intake", "Stage 3, Engagement letter", "Stage 4, Kickoff", "Stage 5, Onboarded"].entries()) assert.ok(has(out, label), `${i + 1}`);
  assert.ok(has(out, "Confirm the consult time") && has(out, "Send the intake form") && has(out, "On entering") && has(out, "Send intake form") && has(out, "Welcome and handover"));
  assert.ok(!has(out, 'data-testid="journey-fields"'), "the Fields page is not on the Stages tab");
});

test("Fields tab: the template's seven fields with the template mark, then its own four, each with its type, and the console line", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" initialTab="fields" />);
  assert.ok(has(out, 'data-testid="journey-fields"') && has(out, "From the Projects template") && has(out, "Its own"));
  const inherited = ["Lead", "Client", "Start date", "Due date", "Health", "Budget", "Stage"].map((n) => at(out, `field-${n}`));
  assert.deepEqual([...inherited].sort((a, b) => a - b), inherited, "inherited fields in the template's order");
  assert.equal((out.match(/Inherited from the Projects template/g) ?? []).length, 7, "every inherited field carries the template mark");
  const own = ["Matter type", "Referral source", "Engagement signed", "ID verified"].map((n) => at(out, `own-${n}`));
  assert.deepEqual([...own].sort((a, b) => a - b), own);
  for (const ty of ["Person", "Link to records", "Date", "Choice", "Number", "Checkbox"]) assert.ok(has(out, `>${ty}<`), ty);
  assert.ok(at(out, "From the Projects template") < at(out, "Its own") && has(out, "Fields are managed in the console."));
  assert.ok(!has(out, 'data-testid="stage-intake"'), "the stages are not on the Fields tab");
});

test("Fields tab: a type with no fields of its own says so, and a shell that supplies no fields shows none rather than failing", () => {
  const s = nw();
  const bare: ConfigExtras = { ...s.extras, recordFields: () => ({ template: "Projects", inherited: [], own: [] }) };
  const out = page(s, <FieldsTab recordType="Client onboarding" />, bare);
  assert.ok(has(out, "No fields of its own yet.") && has(out, "From the Projects template"));
  const without: ConfigExtras = { directory: s.extras.directory };
  const none = page(s, <FieldsTab recordType="Client onboarding" />, without);
  assert.ok(has(none, "No fields of its own yet."));
});

test("a person without the Design Journeys role still reads the Fields tab; the Settings tab is not offered", () => {
  const out = page(nw(), <JourneyDesigner journeyId="jrn_onboard" canDesign={false} initialTab="fields" />);
  assert.ok(has(out, 'data-testid="journey-fields"') && has(out, 'data-testid="subtab-fields"') && has(out, 'data-testid="view-only"'));
  assert.ok(!has(out, 'data-testid="subtab-settings"'));
});

test("sidebar: on the Journeys tab the open Journey is the selected row and the other is not", () => {
  const s = nw();
  const out = page(s, <AutomationsSidebar selectedJourneyId="jrn_onboard" initialTab="journeys" shared={s.shared} reasons={s.space.reasons} />);
  const row = (id: string): string => out.match(new RegExp(`<[^>]*data-testid="row-journey-${id}"[^>]*>`))?.[0] ?? "";
  assert.match(row("jrn_onboard"), /background-color:var\(--sel\)/, "the open Journey takes the quiet selected highlight");
  assert.doesNotMatch(row("jrn_matter"), /background-color:var\(--sel\)/);
});
