// Golden flow 1: lead to client to project (spec 2.11, 2.12, 2.18; ARCH 10.3). A public form takes a lead, the lead becomes a record, a Journey starts on it and the Journey makes a project
// with its channel and folder. Through the gateway: the owner builds the form and the Journey, the lead submits with no token.
import assert from "node:assert/strict";
import { bootTolerant, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_LEAD = ["forms", "contacts-link", "journeys", "records", "schema", "projects", "chat", "files", "devices", "access", "spaces"];
/** None left: a public form takes a lead through POST /f/submit with no session (the host route runs it as the host and names the visitor from the socket). */
export const GAPS: Gap[] = [];

const LEAD = { op: "type.create", type: "lead", def: { title: "Lead", plural: "Leads", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "text", title: "Email" }] } };

export async function runLead(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const trail = new Trail();
  const { s } = await bootTolerant(trail, live);
  if (!s) return { events: [], trail };
  try {
    const admin = s.d.token;
    await trail.step("the lead record type exists", async () => {
      const r = await s.call("schema.apply", admin, { idempotencyKey: "golden-1-type", ops: [LEAD] });
      if (r.status !== 422 || r.body?.error?.code !== "validation.duplicate") expectStatus(r, 200, "schema.apply");
    });
    const form = await trail.step("the owner makes and publishes a public form on it", async () => {
      const made = expectStatus(await s.call("forms.create", admin, { idempotencyKey: "golden-1-form", name: "Contact us", recordType: "lead", kind: "public" }), 200, "forms.create").form;
      expectStatus(await s.call("forms.fields_set", admin, { formId: made.formId, fields: [{ field: "name", mode: "ask" }, { field: "email", mode: "ask" }] }), 200, "forms.fields_set");
      const pub = expectStatus(await s.call("forms.publish", admin, { formId: made.formId }), 200, "forms.publish");
      return { id: made.formId as string, slug: (pub.form?.slug ?? made.slug) as string };
    }, ["the lead record type exists"]);
    // the client stage is the one that makes the project: a designer's choice per stage, not something every Journey does
    const STAGES = [
      { key: "client", title: "Client", order: 0, exit: { requireTasks: false }, tasks: [], automations: [], makesProject: true },
      { key: "done", title: "Done", order: 1, exit: { requireTasks: false }, tasks: [], automations: [], final: true },
    ];
    const journey = await trail.step("a Journey on leads is designed", async () =>
      expectStatus(await s.call("journeys.create", admin, { idempotencyKey: "golden-1-journey", name: "Client onboarding", subjectType: "lead", stages: STAGES }), 200, "journeys.create").journey.id as string,
    ["the lead record type exists"]);
    const lead = await trail.step("a visitor submits the form with no token", async () => {
      const out = expectStatus(await s.call("forms.submit", null, { slug: form!.slug, answers: { name: "Ann Example", email: "ann@example.com" } }), 200, "forms.submit");
      assert.match(out.recordId, /^rec_/);
      return out.recordId as string;
    }, ["the owner makes and publishes a public form on it"]);
    await trail.step("the Journey starts on the new lead", async () => {
      expectStatus(await s.call("journeys.start", admin, { idempotencyKey: "golden-1-start", journeyId: journey!, subjectRecordId: lead! }), 200, "journeys.start");
    }, ["a Journey on leads is designed", "a visitor submits the form with no token"]);
    await trail.step("the project exists with its channel and folder", async () => {
      const list = expectStatus(await s.call("projects.list", admin, {}), 200, "projects.list").projects as { channel?: unknown; folder?: unknown }[];
      assert.ok(list.some((p) => p.channel && p.folder), `projects ${short(list)}`);
    }, ["the Journey starts on the new lead"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runLead([]);
  if (trail.failures.length) throw new Error(`flow 1 failed:\n${trail.report()}`);
  return events;
}
