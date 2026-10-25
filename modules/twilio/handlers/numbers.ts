// The Twilio account side (spec 2.18; ARCH 8): the numbers of the Space (list, search, buy, release, point at the webhooks), the TwiML app the softphone dials through,
// the US texting registration helper (A2P: brand, campaign, status, attach a number) and the health probe. The semantics (routes, hours, consent, conversations) live in
// the telephony module; this connector only talks to Twilio and keeps three small tables.
// DECISION: a number bought or configured with no webhook addresses is pointed at the Space's own /hooks/twilio/voice, /sms and /status.
// DECISION: the registration helper walks Twilio's Trust Hub for a US business (end user, customer profile, A2P trust product) and then registers the brand; the street
// address and the authorized representative's documents are not sent from here: Twilio asks for them in its console when it reviews the profile.
import { HostError, fail } from "../../../host/src/routes/errors.ts";
import { API, acct, api, bad, ensure, first, getState, list, needHost, obj, phone, raw, refusal, setState, sid, strOrUndef, text } from "../projections.ts";
import type { Json, TwilioCtx } from "../projections.ts";

export interface OwnedNumber {
  sid: string;
  e164: string;
  friendlyName?: string;
  capabilities: string[];
  voiceUrl?: string;
  smsUrl?: string;
  statusUrl?: string;
}

const pathPart = (v: string): string => encodeURIComponent(v);

function capabilitiesOf(v: unknown): string[] {
  const c = obj(v);
  return ["voice", "sms", "mms"].filter((k) => c[k] === true);
}

export function numberRow(j: Json): OwnedNumber {
  const out: OwnedNumber = { sid: text(j.sid), e164: text(j.phone_number), capabilities: capabilitiesOf(j.capabilities) };
  const friendly = strOrUndef(j.friendly_name);
  if (friendly) out.friendlyName = friendly;
  const voiceUrl = strOrUndef(j.voice_url);
  if (voiceUrl) out.voiceUrl = voiceUrl;
  const smsUrl = strOrUndef(j.sms_url);
  if (smsUrl) out.smsUrl = smsUrl;
  const statusUrl = strOrUndef(j.status_callback);
  if (statusUrl) out.statusUrl = statusUrl;
  return out;
}

/** The addresses of the Space's own webhooks. */
export async function hookUrls(ctx: TwilioCtx): Promise<{ voice: string; sms: string; status: string; recording: string }> {
  const base = (await needHost(ctx).publicUrl(ctx)).replace(/\/+$/, "");
  return { voice: `${base}/hooks/twilio/voice`, sms: `${base}/hooks/twilio/sms`, status: `${base}/hooks/twilio/status`, recording: `${base}/hooks/twilio/recording` };
}

// ---- numbers

export async function numberListOwned(ctx: TwilioCtx): Promise<{ numbers: OwnedNumber[] }> {
  const url = await acct(ctx, "/IncomingPhoneNumbers.json");
  const out: unknown[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < 20; page++) {
    const j: Json = await api(ctx, page === 0 ? { url: next, query: { PageSize: "1000" } } : { url: next });
    out.push(...list(j.incoming_phone_numbers));
    const n = strOrUndef(j.next_page_uri);
    next = n ? `https://api.twilio.com${n}` : undefined;
  }
  return { numbers: out.map((n) => numberRow(obj(n))).filter((n) => n.sid !== "") };
}

export async function numberSearch(
  ctx: TwilioCtx, input: { country: string; areaCode?: string; contains?: string; capabilities?: ("voice" | "sms" | "mms")[]; limit?: number },
): Promise<{ available: { e164: string; locality?: string; region?: string; capabilities: string[] }[] }> {
  if (typeof input.country !== "string" || !/^[A-Za-z]{2}$/.test(input.country)) bad(ctx, "The country is a two-letter code, like US.");
  if (input.areaCode !== undefined && !/^[0-9]{2,6}$/.test(input.areaCode)) bad(ctx, "The area code is digits only.");
  if (input.contains !== undefined && !/^[0-9A-Za-z*]{1,20}$/.test(input.contains)) bad(ctx, "The pattern is letters, digits and * only.");
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) bad(ctx, "The limit is 1 to 30.");
  const query: Record<string, string> = { PageSize: String(limit) };
  if (input.areaCode) query.AreaCode = input.areaCode;
  if (input.contains) query.Contains = input.contains;
  for (const c of input.capabilities ?? []) query[c === "voice" ? "VoiceEnabled" : c === "sms" ? "SmsEnabled" : "MmsEnabled"] = "true";
  const j = await api(ctx, { url: await acct(ctx, `/AvailablePhoneNumbers/${pathPart(input.country.toUpperCase())}/Local.json`), query });
  const available = list(j.available_phone_numbers).map((n) => {
    const o = obj(n);
    const row: { e164: string; locality?: string; region?: string; capabilities: string[] } = { e164: text(o.phone_number), capabilities: capabilitiesOf(o.capabilities) };
    const locality = strOrUndef(o.locality);
    if (locality) row.locality = locality;
    const region = strOrUndef(o.region);
    if (region) row.region = region;
    return row;
  });
  return { available: available.filter((n) => n.e164 !== "").slice(0, limit) };
}

export async function numberBuy(ctx: TwilioCtx, input: { e164: string; friendlyName?: string }): Promise<{ number: OwnedNumber }> {
  const e164 = phone(ctx, input.e164, "The number");
  if (input.friendlyName !== undefined && (typeof input.friendlyName !== "string" || input.friendlyName.length > 64)) bad(ctx, "The name is text up to 64 characters.");
  const hooks = await hookUrls(ctx);
  const form: [string, string][] = [
    ["PhoneNumber", e164], ["VoiceUrl", hooks.voice], ["VoiceMethod", "POST"], ["SmsUrl", hooks.sms], ["SmsMethod", "POST"], ["StatusCallback", hooks.status], ["StatusCallbackMethod", "POST"],
  ];
  if (input.friendlyName) form.push(["FriendlyName", input.friendlyName]);
  const j = await api(ctx, { method: "POST", url: await acct(ctx, "/IncomingPhoneNumbers.json"), form }, { taken: true });
  return { number: numberRow(j) };
}

export async function numberRelease(ctx: TwilioCtx, input: { sid: string }): Promise<{ released: boolean }> {
  const s = sid(ctx, input.sid, "The number");
  await api(ctx, { method: "DELETE", url: await acct(ctx, `/IncomingPhoneNumbers/${pathPart(s)}.json`) });
  return { released: true };
}

export async function numberConfigure(
  ctx: TwilioCtx, input: { sid: string; voiceUrl?: string; smsUrl?: string; statusUrl?: string; twimlAppSid?: string },
): Promise<{ number: OwnedNumber }> {
  const s = sid(ctx, input.sid, "The number");
  for (const [k, v] of [["voiceUrl", input.voiceUrl], ["smsUrl", input.smsUrl], ["statusUrl", input.statusUrl]] as const) {
    if (v !== undefined && (typeof v !== "string" || !/^https:\/\/\S+$/.test(v))) bad(ctx, `${k} must be an https address.`);
  }
  if (input.twimlAppSid !== undefined) sid(ctx, input.twimlAppSid, "The TwiML app");
  const none = input.voiceUrl === undefined && input.smsUrl === undefined && input.statusUrl === undefined && input.twimlAppSid === undefined;
  const hooks = none ? await hookUrls(ctx) : null;
  const form: [string, string][] = [];
  const voice = input.voiceUrl ?? hooks?.voice;
  const sms = input.smsUrl ?? hooks?.sms;
  const status = input.statusUrl ?? hooks?.status;
  if (voice) form.push(["VoiceUrl", voice], ["VoiceMethod", "POST"]);
  if (sms) form.push(["SmsUrl", sms], ["SmsMethod", "POST"]);
  if (status) form.push(["StatusCallback", status], ["StatusCallbackMethod", "POST"]);
  if (input.twimlAppSid) form.push(["VoiceApplicationSid", input.twimlAppSid]);
  const j = await api(ctx, { method: "POST", url: await acct(ctx, `/IncomingPhoneNumbers/${pathPart(s)}.json`), form });
  return { number: numberRow(j) };
}

// ---- the TwiML app of the Space (one per Space; the Voice SDK dials through it)

const APP_KEY = "twiml_app";

export async function twimlAppEnsure(ctx: TwilioCtx, input: { voiceUrl: string }): Promise<{ appSid: string }> {
  ensure(ctx);
  if (typeof input.voiceUrl !== "string" || !/^https:\/\/\S+$/.test(input.voiceUrl)) bad(ctx, "The voice address must be an https address.");
  const name = `Vyre ${ctx.space}`;
  const found = obj(list((await api(ctx, { url: await acct(ctx, "/Applications.json"), query: { FriendlyName: name } })).applications)[0]);
  let appSid = strOrUndef(found.sid);
  if (appSid) {
    if (found.voice_url !== input.voiceUrl) {
      await api(ctx, { method: "POST", url: await acct(ctx, `/Applications/${pathPart(appSid)}.json`), form: [["VoiceUrl", input.voiceUrl], ["VoiceMethod", "POST"]] });
    }
  } else {
    const made = await api(ctx, { method: "POST", url: await acct(ctx, "/Applications.json"), form: [["FriendlyName", name], ["VoiceUrl", input.voiceUrl], ["VoiceMethod", "POST"]] });
    appSid = strOrUndef(made.sid);
    if (!appSid) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the new app." });
  }
  setState(ctx, APP_KEY, appSid);
  return { appSid };
}

/** The Space's TwiML app: the one remembered, else found or made at Twilio. */
export async function twimlAppOf(ctx: TwilioCtx): Promise<string> {
  ensure(ctx);
  const known = getState(ctx, APP_KEY);
  if (known) return known;
  return (await twimlAppEnsure(ctx, { voiceUrl: (await hookUrls(ctx)).voice })).appSid;
}

// ---- the texting registration helper (A2P 10DLC)

// Trust Hub policies for a direct customer: the secondary customer profile and the A2P messaging profile.
const POLICY_CUSTOMER_PROFILE = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const POLICY_A2P_PROFILE = "RNb0d4771c2c98518d916a3d4cd70a8f8b";

export interface BrandIn {
  legalName: string;
  ein?: string;
  website?: string;
  vertical?: string;
  address?: { line1: string; city: string; region: string; postal: string; country: string };
  contactName?: string;
  contactEmail?: string;
}

export async function a2pCreateBrand(ctx: TwilioCtx, input: BrandIn): Promise<{ brandSid: string; status: string }> {
  if (typeof input.legalName !== "string" || input.legalName.trim() === "" || input.legalName.length > 200) bad(ctx, "The legal name is 1 to 200 characters.");
  if (typeof input.contactEmail !== "string" || !/^[^\s@]+@[^\s@]+$/.test(input.contactEmail)) bad(ctx, "Twilio needs a contact email for the registration.");
  if (input.ein !== undefined && !/^[0-9]{2}-?[0-9]{7}$/.test(input.ein)) bad(ctx, "The EIN is nine digits, like 12-3456789.");
  if (input.website !== undefined && !/^https?:\/\/\S+$/.test(input.website)) bad(ctx, "The website must be a web address.");
  const name = input.legalName.trim();
  const attributes: Json = { business_name: name, business_identity: "direct_customer", business_regions_of_operation: "USA_AND_CANADA", business_type: "Corporation" };
  if (input.website) attributes.website_url = input.website;
  if (input.vertical) attributes.business_industry = input.vertical;
  if (input.ein) {
    attributes.business_registration_identifier = "EIN";
    attributes.business_registration_number = input.ein;
  }
  const post = (path: string, form: [string, string][]): Promise<Json> => api(ctx, { method: "POST", url: `${API.trusthub}${path}`, form });
  const need = (j: Json, what: string): string => strOrUndef(j.sid) ?? ((): never => { throw fail("provider.bad_response", ctx.trace.traceId, { message: `Twilio did not return the ${what}.` }); })();

  const endUser = need(await post("/EndUsers", [["FriendlyName", `${name} business information`], ["Type", "customer_profile_business_information"], ["Attributes", JSON.stringify(attributes)]]), "business information");
  const profile = need(await post("/CustomerProfiles", [["FriendlyName", name], ["Email", input.contactEmail], ["PolicySid", POLICY_CUSTOMER_PROFILE]]), "customer profile");
  await post(`/CustomerProfiles/${pathPart(profile)}/EntityAssignments`, [["ObjectSid", endUser]]);
  await post(`/CustomerProfiles/${pathPart(profile)}`, [["Status", "pending-review"]]);
  const product = need(await post("/TrustProducts", [["FriendlyName", `${name} messaging`], ["Email", input.contactEmail], ["PolicySid", POLICY_A2P_PROFILE]]), "messaging profile");
  await post(`/TrustProducts/${pathPart(product)}/EntityAssignments`, [["ObjectSid", profile]]);
  await post(`/TrustProducts/${pathPart(product)}`, [["Status", "pending-review"]]);
  const brand = await api(ctx, {
    method: "POST", url: `${API.messaging}/a2p/BrandRegistrations`,
    form: [["CustomerProfileBundleSid", profile], ["A2PProfileBundleSid", product], ["BrandType", "STANDARD"]],
  });
  return { brandSid: need(brand, "brand"), status: text(brand.status).toLowerCase() || "pending" };
}

export async function a2pCreateCampaign(
  ctx: TwilioCtx, input: { brandSid: string; useCase: string; description: string; sampleMessages: string[]; optInDescription?: string; messagingServiceSid?: string },
): Promise<{ campaignSid: string; status: string }> {
  ensure(ctx);
  const brandSid = sid(ctx, input.brandSid, "The brand");
  if (typeof input.useCase !== "string" || input.useCase.trim() === "") bad(ctx, "The use case is required, like MARKETING or MIXED.");
  if (typeof input.description !== "string" || input.description.length < 1 || input.description.length > 4096) bad(ctx, "The description is 1 to 4096 characters.");
  const samples = list(input.sampleMessages).filter((m): m is string => typeof m === "string" && m.trim() !== "");
  if (samples.length < 1 || samples.length > 5) bad(ctx, "Give one to five sample messages.");
  let service = input.messagingServiceSid;
  if (service !== undefined) sid(ctx, service, "The messaging service");
  else {
    const made = await api(ctx, { method: "POST", url: `${API.messaging}/Services`, form: [["FriendlyName", `Vyre ${ctx.space}`], ["UseInboundWebhookOnNumber", "true"]] });
    service = strOrUndef(made.sid);
    if (!service) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the messaging service." });
  }
  const form: [string, string][] = [
    ["BrandRegistrationSid", brandSid], ["Description", input.description], ["MessageFlow", input.optInDescription ?? "People opt in by giving their number to the firm and agreeing to texts."],
    ["UsAppToPersonUsecase", input.useCase.trim().toUpperCase()], ["HasEmbeddedLinks", "true"], ["HasEmbeddedPhone", "false"],
  ];
  for (const m of samples) form.push(["MessageSamples", m]);
  const j = await api(ctx, { method: "POST", url: `${API.messaging}/Services/${pathPart(service)}/UsAppToPerson`, form });
  const campaignSid = strOrUndef(j.sid);
  if (!campaignSid) throw fail("provider.bad_response", ctx.trace.traceId, { message: "Twilio did not return the campaign." });
  ctx.db.run(`INSERT OR IGNORE INTO twilio_a2p ("campaignSid", "brandSid", "serviceSid", "at") VALUES (?, ?, ?, ?)`, campaignSid, brandSid, service, ctx.now());
  return { campaignSid, status: text(j.campaign_status).toLowerCase() || "pending" };
}

export async function a2pStatus(
  ctx: TwilioCtx, input: { brandSid?: string; campaignSid?: string },
): Promise<{ brand?: string; campaign?: string; rejectedReason?: string }> {
  ensure(ctx);
  if (input.brandSid === undefined && input.campaignSid === undefined) bad(ctx, "Name the brand, the campaign or both.");
  const out: { brand?: string; campaign?: string; rejectedReason?: string } = {};
  if (input.brandSid !== undefined) {
    const j = await api(ctx, { url: `${API.messaging}/a2p/BrandRegistrations/${pathPart(sid(ctx, input.brandSid, "The brand"))}` });
    out.brand = text(j.status).toLowerCase() || "pending";
    const why = strOrUndef(j.failure_reason);
    if (why && out.brand === "failed") out.rejectedReason = why;
  }
  if (input.campaignSid !== undefined) {
    const campaignSid = sid(ctx, input.campaignSid, "The campaign");
    const row = first(ctx.db.all(`SELECT "serviceSid" FROM twilio_a2p WHERE "campaignSid" = ?`, campaignSid));
    if (!row || typeof row.serviceSid !== "string") throw fail("validation.not_found", ctx.trace.traceId, { message: "This Space did not register that campaign." });
    const j = await api(ctx, { url: `${API.messaging}/Services/${pathPart(row.serviceSid)}/UsAppToPerson` });
    const c = obj(list(j.compliance)[0]);
    out.campaign = text(c.campaign_status).toLowerCase() || "pending";
    const errors = list(c.errors).map((e) => text(obj(e).description) || text(e)).filter(Boolean);
    if (out.campaign === "failed" && errors.length && out.rejectedReason === undefined) out.rejectedReason = errors.join("; ");
  }
  return out;
}

export async function a2pAttachNumber(ctx: TwilioCtx, input: { messagingServiceSid: string; numberSid: string }): Promise<{ attached: boolean }> {
  const service = sid(ctx, input.messagingServiceSid, "The messaging service");
  const number = sid(ctx, input.numberSid, "The number");
  const a = await raw(ctx, { method: "POST", url: `${API.messaging}/Services/${pathPart(service)}/PhoneNumbers`, form: [["PhoneNumberSid", number]] });
  if (a.status < 300) return { attached: true };
  if (a.status === 409 || obj(a.json).code === 21710) return { attached: true };   // already on the service
  throw refusal(ctx, a);
}

// ---- twilio.health

export async function health(ctx: TwilioCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string; latencyMs?: number }> {
  const t0 = ctx.now();
  try {
    const a = await raw(ctx, { url: await acct(ctx, ".json") });
    const latencyMs = Math.max(0, ctx.now() - t0);
    if (a.status === 401 || a.status === 403) return { state: "down", detail: "Twilio did not accept the credentials. Check Twilio_Account and Twilio_Auth in the Vault." };
    if (a.status === 404) return { state: "down", detail: "Twilio has no such account. Check Twilio_Account in the Vault." };
    if (a.status === 429) return { state: "degraded", detail: "Twilio is asking us to slow down.", latencyMs };
    if (a.status >= 300) return { state: "degraded", detail: "Twilio is not answering well right now.", latencyMs };
    const status = text(a.json.status);
    if (status === "suspended" || status === "closed") return { state: "down", detail: `The Twilio account is ${status}.`, latencyMs };
    return { state: "healthy", latencyMs };
  } catch (e) {
    if (e instanceof HostError && e.error.code === "internal.unavailable") return { state: "down", detail: "Twilio is not set up on this server." };
    if (e instanceof HostError && e.error.code === "provider.auth_failed") return { state: "down", detail: "Twilio credentials are missing. Add Twilio_Account and Twilio_Auth to the Vault." };
    if (e instanceof HostError && e.error.code === "provider.network") return { state: "down", detail: "Twilio could not be reached." };
    throw e;
  }
}
