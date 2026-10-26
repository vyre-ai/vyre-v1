// P-CC_40 (with P-L8_18): a form and a campaign become access resources when they are created, so the calls that name them answer 200 and not 404. The registrar (host/src/gateway/resources.ts) registers
// an object from the first event about it, so forms.create, bookings.page_create and campaigns.create each emit a created event (form.created, campaign.created). Booted on the flow's Space with forms and
// campaigns live in a temporary code root, as the owner, through the gateway. forms.create also takes no recordType that does not exist as a type id: the contact type is the seed's.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace } from "../golden/steps/02-space.ts";

test("a created form is an access resource: forms.get and forms.fields_set answer 200 for the owner", async () => {
  const s = await bootFlowSpace(["forms", "campaigns"]);
  try {
    const admin = s.d.token;
    const made = await s.call("forms.create", admin, { idempotencyKey: "res-form", name: "Intake", recordType: "contact", kind: "public" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const formId = made.body.data.form.formId;
    assert.match(formId, /^frm_[a-z0-9]+$/);
    const got = await s.call("forms.get", admin, { formId });
    assert.equal(got.status, 200, `forms.get: ${JSON.stringify(got.body)}`);
    const set = await s.call("forms.fields_set", admin, { idempotencyKey: "res-form-fields", formId, fields: [{ field: "email", mode: "ask" }] });
    assert.equal(set.status, 200, `forms.fields_set: ${JSON.stringify(set.body)}`);

    const booking = await s.call("bookings.page_create", admin, { idempotencyKey: "res-booking", name: "Call", hostIds: ["usr_olivia"], lengthMinutes: 30, recordType: "contact" });
    assert.equal(booking.status, 200, JSON.stringify(booking.body));
    const got2 = await s.call("forms.get", admin, { formId: booking.body.data.form.formId });
    assert.equal(got2.status, 200, `a booking page is a form resource too: ${JSON.stringify(got2.body)}`);
  } finally { await s.stop(); }
});

test("a created campaign is an access resource: campaigns.get answers 200 for the owner", async () => {
  const s = await bootFlowSpace(["forms", "campaigns"]);
  try {
    const admin = s.d.token;
    const made = await s.call("campaigns.create", admin, { idempotencyKey: "res-campaign", name: "Welcome", kind: "sequence" });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const campaignId = made.body.data.campaign.campaignId;
    assert.match(campaignId, /^cmp_[a-z0-9]+$/);
    const got = await s.call("campaigns.get", admin, { campaignId });
    assert.equal(got.status, 200, `campaigns.get: ${JSON.stringify(got.body)}`);
  } finally { await s.stop(); }
});
