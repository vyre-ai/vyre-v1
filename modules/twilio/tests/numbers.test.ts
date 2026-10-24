// The Twilio account side against recorded responses (spec 2.18; ARCH 8): the Space's numbers and where each is routed (the webhook addresses and the TwiML app), the
// texting registration helper, and the health probe.
import test from "node:test";
import assert from "node:assert/strict";
import {
  a2pAttachNumber, a2pCreateBrand, a2pCreateCampaign, a2pStatus, health, numberBuy, numberConfigure, numberListOwned, numberRelease, numberSearch, twimlAppEnsure,
} from "../handlers/index.ts";
import { setTwilioHost } from "../impl.ts";
import {
  APP_SID, BASIC_ACCOUNT, BRAND_SID, CAMPAIGN_SID, codeOf, contractErrors, harness, NUMBER_SID, PUBLIC_URL, RECORDED, REST, SERVICE_SID,
} from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const API = "api.twilio.com";
const MSG = "messaging.twilio.com/v1";
const TRUST = "trusthub.twilio.com/v1";
const HOOKS = { voice: `${PUBLIC_URL}/hooks/twilio/voice`, sms: `${PUBLIC_URL}/hooks/twilio/sms`, status: `${PUBLIC_URL}/hooks/twilio/status` };

// ---- numbers

test("the numbers of the account are listed across pages with their capabilities and the addresses they are routed to", async () => {
  const h = harness();
  h.on(`GET ${API}${REST}/IncomingPhoneNumbers.json?PageSize=1000`, { status: 200, body: RECORDED.numbersPage1 });
  h.on(`GET ${API}${REST}/IncomingPhoneNumbers.json?PageSize=1000&Page=1&PageToken=x`, { status: 200, body: RECORDED.numbersPage2 });
  const out = await numberListOwned(h.ctx);
  assert.deepEqual(contractErrors("twilio.number.list_owned", "out", out), []);
  assert.deepEqual(out.numbers.map((n) => [n.sid, n.e164, n.capabilities]), [
    [NUMBER_SID, "+14155550123", ["voice", "sms"]], ["PN00000000000000000000000000000010", "+14155550124", ["voice", "sms"]], ["PN00000000000000000000000000000011", "+14155550125", ["voice", "sms", "mms"]],
  ]);
  assert.deepEqual(out.numbers[0], {
    sid: NUMBER_SID, e164: "+14155550123", friendlyName: "Main line", capabilities: ["voice", "sms"], voiceUrl: HOOKS.voice, smsUrl: HOOKS.sms, statusUrl: HOOKS.status,
  });
  assert.equal("voiceUrl" in out.numbers[1]!, false, "an address Twilio has empty is left out");
  assert.equal("friendlyName" in out.numbers[1]!, false);
  assert.equal(h.requests[0]!.headers.authorization, BASIC_ACCOUNT);
});

test("numbers for sale are searched by area code, pattern and capability, within the limit", async () => {
  const h = harness();
  h.on(`GET ${API}${REST}/AvailablePhoneNumbers/US/Local.json?PageSize=1&AreaCode=415&Contains=555&VoiceEnabled=true&SmsEnabled=true`, { status: 200, body: RECORDED.available });
  const input = { country: "us", areaCode: "415", contains: "555", capabilities: ["voice" as const, "sms" as const], limit: 1 };
  assert.deepEqual(contractErrors("twilio.number.search", "in", input), []);
  const out = await numberSearch(h.ctx, input);
  assert.deepEqual(out, { available: [{ e164: "+14155550199", locality: "San Francisco", region: "CA", capabilities: ["voice", "sms", "mms"] }] });
  assert.deepEqual(contractErrors("twilio.number.search", "out", out), []);
  h.on(`GET ${API}${REST}/AvailablePhoneNumbers/US/Local.json?PageSize=20`, { status: 200, body: RECORDED.available });
  const all = await numberSearch(h.ctx, { country: "US" });
  assert.equal(all.available.length, 2);
  assert.equal("locality" in all.available[1]!, false);
  await refused(numberSearch(h.ctx, { country: "USA" }), "validation.bad_input");
  await refused(numberSearch(h.ctx, { country: "US", areaCode: "41x" }), "validation.bad_input");
  await refused(numberSearch(h.ctx, { country: "US", limit: 31 }), "validation.bad_input");
  await refused(numberSearch(h.ctx, { country: "US", contains: "a b" }), "validation.bad_input");
});

test("a number is bought already pointed at the Space's own webhooks, and one that is taken is a duplicate", async () => {
  const h = harness();
  h.on(`POST ${API}${REST}/IncomingPhoneNumbers.json`, { status: 201, body: RECORDED.incoming() });
  const out = await numberBuy(h.ctx, { e164: "+14155550123", friendlyName: "Main line" });
  assert.equal(out.number.sid, NUMBER_SID);
  assert.deepEqual(contractErrors("twilio.number.buy", "out", out), []);
  assert.deepEqual(h.requests[0]!.form, [
    ["PhoneNumber", "+14155550123"], ["VoiceUrl", HOOKS.voice], ["VoiceMethod", "POST"], ["SmsUrl", HOOKS.sms], ["SmsMethod", "POST"], ["StatusCallback", HOOKS.status],
    ["StatusCallbackMethod", "POST"], ["FriendlyName", "Main line"],
  ]);
  h.on(`POST ${API}${REST}/IncomingPhoneNumbers.json`, { status: 400, body: { code: 21422, message: "not available" } });
  await refused(numberBuy(h.ctx, { e164: "+14155550123" }), "validation.duplicate");
  h.on(`POST ${API}${REST}/IncomingPhoneNumbers.json`, { status: 401, body: { code: 20003 } });
  await refused(numberBuy(h.ctx, { e164: "+14155550123" }), "provider.auth_failed");
  await refused(numberBuy(h.ctx, { e164: "415" }), "validation.bad_input");
  await refused(numberBuy(h.ctx, { e164: "+14155550123", friendlyName: "x".repeat(65) }), "validation.bad_input");
});

test("a number is released by its Sid", async () => {
  const h = harness();
  h.on(`DELETE ${API}${REST}/IncomingPhoneNumbers/${NUMBER_SID}.json`, { status: 204 });
  assert.deepEqual(await numberRelease(h.ctx, { sid: NUMBER_SID }), { released: true });
  await refused(numberRelease(h.ctx, { sid: "PN123" }), "validation.bad_input");
  h.on(`DELETE ${API}${REST}/IncomingPhoneNumbers/${NUMBER_SID}.json`, { status: 404, body: { code: 20404 } });
  await refused(numberRelease(h.ctx, { sid: NUMBER_SID }), "validation.not_found");
});

test("routes: configuring a number with nothing named points it at the Space's webhooks; named addresses and the TwiML app are sent as given", async () => {
  const h = harness();
  h.on(`POST ${API}${REST}/IncomingPhoneNumbers/${NUMBER_SID}.json`, { status: 200, body: RECORDED.incoming() });
  const out = await numberConfigure(h.ctx, { sid: NUMBER_SID });
  assert.equal(out.number.voiceUrl, HOOKS.voice);
  assert.deepEqual(contractErrors("twilio.number.configure", "out", out), []);
  assert.deepEqual(h.requests[0]!.form, [["VoiceUrl", HOOKS.voice], ["VoiceMethod", "POST"], ["SmsUrl", HOOKS.sms], ["SmsMethod", "POST"], ["StatusCallback", HOOKS.status], ["StatusCallbackMethod", "POST"]]);
  await numberConfigure(h.ctx, { sid: NUMBER_SID, smsUrl: "https://hooks.example.test/sms", twimlAppSid: APP_SID });
  assert.deepEqual(h.requests[1]!.form, [["SmsUrl", "https://hooks.example.test/sms"], ["SmsMethod", "POST"], ["VoiceApplicationSid", APP_SID]], "only what was named changes");
  await refused(numberConfigure(h.ctx, { sid: NUMBER_SID, voiceUrl: "http://insecure.example.test" }), "validation.bad_input");
  await refused(numberConfigure(h.ctx, { sid: NUMBER_SID, twimlAppSid: "nope" }), "validation.bad_input");
});

// ---- the TwiML app

test("the Space's TwiML app is made once, found again, and brought back to the voice address when it differs", async () => {
  const h = harness();
  const q = `GET ${API}${REST}/Applications.json?FriendlyName=Vyre+spc_twilio`;
  h.on(q, { status: 200, body: RECORDED.noApp });
  h.on(`POST ${API}${REST}/Applications.json`, { status: 201, body: RECORDED.appCreated });
  assert.deepEqual(await twimlAppEnsure(h.ctx, { voiceUrl: HOOKS.voice }), { appSid: APP_SID });
  assert.deepEqual(h.requests[1]!.form, [["FriendlyName", "Vyre spc_twilio"], ["VoiceUrl", HOOKS.voice], ["VoiceMethod", "POST"]]);

  h.on(q, { status: 200, body: { applications: [{ sid: APP_SID, voice_url: HOOKS.voice }] } });
  assert.deepEqual(await twimlAppEnsure(h.ctx, { voiceUrl: HOOKS.voice }), { appSid: APP_SID });
  assert.equal(h.requests.length, 3, "an app that is right is left alone");

  h.on(q, { status: 200, body: RECORDED.app });
  h.on(`POST ${API}${REST}/Applications/${APP_SID}.json`, { status: 200, body: RECORDED.appCreated });
  await twimlAppEnsure(h.ctx, { voiceUrl: HOOKS.voice });
  assert.deepEqual(h.requests[4]!.form, [["VoiceUrl", HOOKS.voice], ["VoiceMethod", "POST"]]);
  await refused(twimlAppEnsure(h.ctx, { voiceUrl: "http://insecure.example.test" }), "validation.bad_input");
});

// ---- texting registration

test("the brand is registered through Trust Hub: business information, customer profile, messaging profile, then the brand", async () => {
  const h = harness();
  h.on(`POST ${TRUST}/EndUsers`, { status: 201, body: RECORDED.endUser });
  h.on(`POST ${TRUST}/CustomerProfiles`, { status: 201, body: RECORDED.profile });
  h.on(`POST ${TRUST}/CustomerProfiles/${RECORDED.profile.sid}/EntityAssignments`, { status: 201, body: RECORDED.assignment });
  h.on(`POST ${TRUST}/CustomerProfiles/${RECORDED.profile.sid}`, { status: 200, body: { ...RECORDED.profile, status: "pending-review" } });
  h.on(`POST ${TRUST}/TrustProducts`, { status: 201, body: RECORDED.product });
  h.on(`POST ${TRUST}/TrustProducts/${RECORDED.product.sid}/EntityAssignments`, { status: 201, body: RECORDED.assignment });
  h.on(`POST ${TRUST}/TrustProducts/${RECORDED.product.sid}`, { status: 200, body: { ...RECORDED.product, status: "pending-review" } });
  h.on(`POST ${MSG}/a2p/BrandRegistrations`, { status: 201, body: RECORDED.brand });
  const input = {
    legalName: "Lee & Partners PLLC", ein: "12-3456789", website: "https://leepartners.example.test", vertical: "PROFESSIONAL_SERVICES",
    address: { line1: "1 Main St", city: "Austin", region: "TX", postal: "78701", country: "US" }, contactName: "Maya Lee", contactEmail: "maya@leepartners.example.test",
  };
  assert.deepEqual(contractErrors("twilio.a2p.create_brand", "in", { ...input, idempotencyKey: "twl_brand1" }), []);
  const out = await a2pCreateBrand(h.ctx, input);
  assert.deepEqual(out, { brandSid: BRAND_SID, status: "pending" });
  assert.deepEqual(contractErrors("twilio.a2p.create_brand", "out", out), []);
  assert.deepEqual(h.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`), [
    "POST /v1/EndUsers", "POST /v1/CustomerProfiles", `POST /v1/CustomerProfiles/${RECORDED.profile.sid}/EntityAssignments`, `POST /v1/CustomerProfiles/${RECORDED.profile.sid}`,
    "POST /v1/TrustProducts", `POST /v1/TrustProducts/${RECORDED.product.sid}/EntityAssignments`, `POST /v1/TrustProducts/${RECORDED.product.sid}`, "POST /v1/a2p/BrandRegistrations",
  ]);
  const attrs = JSON.parse(h.requests[0]!.form!.find(([k]) => k === "Attributes")![1]) as Record<string, string>;
  assert.deepEqual(attrs, {
    business_name: "Lee & Partners PLLC", business_identity: "direct_customer", business_regions_of_operation: "USA_AND_CANADA", business_type: "Corporation",
    website_url: "https://leepartners.example.test", business_industry: "PROFESSIONAL_SERVICES", business_registration_identifier: "EIN", business_registration_number: "12-3456789",
  });
  assert.deepEqual(h.requests[1]!.form!.map(([k]) => k), ["FriendlyName", "Email", "PolicySid"]);
  assert.deepEqual(h.requests[2]!.form, [["ObjectSid", RECORDED.endUser.sid]]);
  assert.deepEqual(h.requests[3]!.form, [["Status", "pending-review"]]);
  assert.deepEqual(h.requests[5]!.form, [["ObjectSid", RECORDED.profile.sid]]);
  assert.deepEqual(h.requests[7]!.form, [["CustomerProfileBundleSid", RECORDED.profile.sid], ["A2PProfileBundleSid", RECORDED.product.sid], ["BrandType", "STANDARD"]]);
});

test("the brand needs a legal name, a contact email and well-formed EIN and website; a refusal part-way stops the walk", async () => {
  const h = harness();
  await refused(a2pCreateBrand(h.ctx, { legalName: "" }), "validation.bad_input");
  await refused(a2pCreateBrand(h.ctx, { legalName: "X" }), "validation.bad_input");
  await refused(a2pCreateBrand(h.ctx, { legalName: "X", contactEmail: "a@b.test", ein: "123" }), "validation.bad_input");
  await refused(a2pCreateBrand(h.ctx, { legalName: "X", contactEmail: "a@b.test", website: "ftp://x" }), "validation.bad_input");
  assert.equal(h.requests.length, 0);
  h.on(`POST ${TRUST}/EndUsers`, { status: 201, body: RECORDED.endUser });
  h.on(`POST ${TRUST}/CustomerProfiles`, { status: 400, body: { code: 90001 } });
  await refused(a2pCreateBrand(h.ctx, { legalName: "X", contactEmail: "a@b.test" }), "validation.bad_input");
  assert.equal(h.requests.length, 2);
  h.on(`POST ${TRUST}/CustomerProfiles`, { status: 201, body: {} });
  await refused(a2pCreateBrand(h.ctx, { legalName: "X", contactEmail: "a@b.test" }), "provider.bad_response");
});

test("the campaign is registered under the brand on a new messaging service, and its status is read back through that service", async () => {
  const h = harness();
  h.on(`POST ${MSG}/Services`, { status: 201, body: RECORDED.service });
  h.on(`POST ${MSG}/Services/${SERVICE_SID}/UsAppToPerson`, { status: 201, body: RECORDED.campaign });
  const input = { brandSid: BRAND_SID, useCase: "mixed", description: "Case updates and appointment reminders", sampleMessages: ["Hi Pat, your consult is at 3pm. Reply STOP to opt out."] };
  assert.deepEqual(contractErrors("twilio.a2p.create_campaign", "in", { ...input, idempotencyKey: "twl_camp1" }), []);
  const out = await a2pCreateCampaign(h.ctx, input);
  assert.deepEqual(out, { campaignSid: CAMPAIGN_SID, status: "in_progress" });
  assert.deepEqual(contractErrors("twilio.a2p.create_campaign", "out", out), []);
  const form = h.requests[1]!.form!;
  assert.deepEqual(form.filter(([k]) => k === "UsAppToPersonUsecase" || k === "BrandRegistrationSid" || k === "MessageSamples"), [
    ["BrandRegistrationSid", BRAND_SID], ["UsAppToPersonUsecase", "MIXED"], ["MessageSamples", "Hi Pat, your consult is at 3pm. Reply STOP to opt out."],
  ]);

  h.on(`GET ${MSG}/a2p/BrandRegistrations/${BRAND_SID}`, { status: 200, body: RECORDED.brand });
  h.on(`GET ${MSG}/Services/${SERVICE_SID}/UsAppToPerson`, { status: 200, body: RECORDED.campaignList });
  const status = await a2pStatus(h.ctx, { brandSid: BRAND_SID, campaignSid: CAMPAIGN_SID });
  assert.deepEqual(status, { brand: "pending", campaign: "verified" });
  assert.deepEqual(contractErrors("twilio.a2p.status", "out", status), []);

  h.on(`GET ${MSG}/a2p/BrandRegistrations/${BRAND_SID}`, { status: 200, body: RECORDED.brandFailed });
  h.on(`GET ${MSG}/Services/${SERVICE_SID}/UsAppToPerson`, { status: 200, body: RECORDED.campaignFailed });
  assert.deepEqual(await a2pStatus(h.ctx, { brandSid: BRAND_SID }), { brand: "failed", rejectedReason: "Business name does not match the EIN" });
  assert.deepEqual(await a2pStatus(h.ctx, { campaignSid: CAMPAIGN_SID }), { campaign: "failed", rejectedReason: "Sample messages missing opt-out language" });
});

test("the campaign takes an existing messaging service, and refuses missing samples; the status refuses a campaign this Space did not register", async () => {
  const h = harness();
  h.on(`POST ${MSG}/Services/${SERVICE_SID}/UsAppToPerson`, { status: 201, body: RECORDED.campaign });
  await a2pCreateCampaign(h.ctx, { brandSid: BRAND_SID, useCase: "MARKETING", description: "d", sampleMessages: ["a"], messagingServiceSid: SERVICE_SID, optInDescription: "Web form" });
  assert.equal(h.requests.length, 1, "no new service");
  assert.deepEqual(h.requests[0]!.form!.find(([k]) => k === "MessageFlow"), ["MessageFlow", "Web form"]);
  await refused(a2pCreateCampaign(h.ctx, { brandSid: BRAND_SID, useCase: "MARKETING", description: "d", sampleMessages: [] }), "validation.bad_input");
  await refused(a2pCreateCampaign(h.ctx, { brandSid: BRAND_SID, useCase: "MARKETING", description: "d", sampleMessages: ["1", "2", "3", "4", "5", "6"] }), "validation.bad_input");
  await refused(a2pCreateCampaign(h.ctx, { brandSid: "x", useCase: "MARKETING", description: "d", sampleMessages: ["a"] }), "validation.bad_input");
  await refused(a2pStatus(h.ctx, { campaignSid: "QE00000000000000000000000000000077" }), "validation.not_found");
  await refused(a2pStatus(h.ctx, {}), "validation.bad_input");
});

test("a number is attached to the messaging service, and one already on it counts as attached", async () => {
  const h = harness();
  h.on(`POST ${MSG}/Services/${SERVICE_SID}/PhoneNumbers`, { status: 201, body: { sid: NUMBER_SID } });
  assert.deepEqual(await a2pAttachNumber(h.ctx, { messagingServiceSid: SERVICE_SID, numberSid: NUMBER_SID }), { attached: true });
  assert.deepEqual(h.requests[0]!.form, [["PhoneNumberSid", NUMBER_SID]]);
  h.on(`POST ${MSG}/Services/${SERVICE_SID}/PhoneNumbers`, { status: 409, body: { code: 21710 } });
  assert.deepEqual(await a2pAttachNumber(h.ctx, { messagingServiceSid: SERVICE_SID, numberSid: NUMBER_SID }), { attached: true });
  h.on(`POST ${MSG}/Services/${SERVICE_SID}/PhoneNumbers`, { status: 403, body: { code: 20003 } });
  await refused(a2pAttachNumber(h.ctx, { messagingServiceSid: SERVICE_SID, numberSid: NUMBER_SID }), "provider.auth_failed");
});

// ---- twilio.health

test("health reads the account: healthy, suspended, bad credentials, throttled, not answering, unreachable, and not set up", async () => {
  const h = harness();
  const get = `GET ${API}${REST}.json`;
  h.on(get, { status: 200, body: RECORDED.account });
  const ok = await health(h.ctx);
  assert.deepEqual(ok, { state: "healthy", latencyMs: 0 });
  assert.deepEqual(contractErrors("twilio.health", "out", ok), []);
  h.on(get, { status: 200, body: { ...RECORDED.account, status: "suspended" } });
  assert.equal((await health(h.ctx)).state, "down");
  h.on(get, { status: 401, body: { code: 20003 } });
  assert.match((await health(h.ctx)).detail ?? "", /Twilio_Account and Twilio_Auth/);
  h.on(get, { status: 429, body: {} });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on(get, { status: 502, body: "" });
  assert.equal((await health(h.ctx)).state, "degraded");
  h.on(get, { status: 0, throws: true });
  assert.equal((await health(h.ctx)).state, "down");
  setTwilioHost(null);
  assert.deepEqual(await health(h.ctx), { state: "down", detail: "Twilio is not set up on this server." });
});
