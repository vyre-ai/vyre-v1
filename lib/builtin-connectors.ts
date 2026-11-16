// Built-in connectors written as a whole definition (URL actions and all), for services reached through their public API with a key a person pastes. Seeded with the registry's built-ins; a later change by a person is never overwritten.
// Fathom: base address, header and calls from Fathom's own API documentation (developers.fathom.ai: the OpenAPI spec says servers https://api.fathom.ai/external/v1, ApiKeyAuth in header X-Api-Key, GET /meetings,
// GET /recordings/{recording_id}/summary and /transcript). NOT run against the real service: only against a stand-in. Scope is person: each person connects their own account, the key kept in their own Mine.

import { connectCardOn } from "./connect-switch.ts";

const BASE = "https://api.fathom.ai/external/v1";

export const FATHOM = {
  key: "fathom",
  title: "Fathom",
  mode: "api" as const,
  scope: "person" as const,
  version: "1.0.0",
  builtin: true,
  auth: { type: "api_key" as const, secret: "api_key", header: "X-Api-Key", prefix: "" },
  domains: ["api.fathom.ai"],
  secrets: [
    { name: "api_key", description: "Your Fathom API key (Fathom settings, API Access)" },
    { name: "webhook_secret", description: "Optional: the secret Fathom signs its webhooks with" },
  ],
  health: "list_meetings",
  rate: { rps: 1, burst: 5 },
  actions: [
    { name: "list_meetings", method: "GET" as const, url: `${BASE}/meetings`, output: "/items" },
    {
      name: "list_meetings_after",
      method: "GET" as const,
      url: `${BASE}/meetings`,
      query: { cursor: "{input.cursor}" },
      output: "/items",
    },
    {
      name: "get_summary",
      method: "GET" as const,
      url: `${BASE}/recordings/{input.recording_id}/summary`,
      output: "/summary",
    },
    {
      name: "get_transcript",
      method: "GET" as const,
      url: `${BASE}/recordings/{input.recording_id}/transcript`,
      output: "/transcript",
    },
  ],
};

// ---- the services a person connects by pasting a key (r32-connect, 16 Nov 2026) ----
// Each definition follows the service's own public API documents (addresses, how the key is sent, the one harmless read that checks it) and was run against stand-ins only: nobody here holds live keys. Rules every one keeps:
// the hosts are named exactly (no wildcard, https only, no address); a key travels in a header or HTTP Basic, never in an address; the check is one read-only GET (Zoom: its documented token call); and the answer
// to the check leaves the server only as a verdict (modules/connectors/handlers/connections.ts, connectors.check_key). The registry's older actions that have no address stay named beside these (seedBuiltins).
// Sources, all read 16 Nov 2026: Stripe docs.stripe.com/api/authentication and /api/balance/balance_retrieve (Bearer or Basic; GET /v1/balance; 401 a wrong key, 403 a restricted key without the permission);
// Resend resend.com/docs/api-reference/domains/list-domains and /errors (Bearer; GET /domains; 401 restricted_api_key is a send-only key, 400 "API key is invalid" a wrong one);
// HubSpot developers.hubspot.com account information API (Bearer private app token; GET /account-info/v3/details); Mailgun documentation.mailgun.com (GET /v4/domains, Basic api:key, api.mailgun.net or api.eu.mailgun.net);
// Dropbox Sign developers.hellosign.com (GET /v3/account, Basic with the key as the user); Zoom developers.zoom.us server-to-server OAuth (POST https://zoom.us/oauth/token, Basic client id and secret, form grant_type=account_credentials
// and account_id); Twilio twilio.com/docs/usage/api/account (GET /2010-04-01/Accounts.json, Basic account SID and auth token; the SID is not put in the address because the runtime never lets a secret into one).
const space = {
  mode: "api" as const,
  scope: "space" as const,
  version: "1.1.0",
  builtin: true,
};

export const STRIPE = {
  key: "stripe",
  title: "Stripe",
  ...space,
  auth: { type: "api_key" as const, secret: "Stripe_Key", header: "Authorization", prefix: "Bearer " },
  domains: ["api.stripe.com"],
  keysPage: "https://dashboard.stripe.com/apikeys",
  secrets: [
    {
      name: "Stripe_Key",
      label: "Secret key",
      description: "Your Stripe secret or restricted key (Dashboard, Developers, API keys)",
    },
    {
      name: "Stripe_Webhook_Secret",
      label: "Webhook signing secret",
      description: "Optional: the secret Stripe signs its webhooks with",
    },
  ],
  health: "check_balance",
  verdicts: { rejected: [{ status: 401 }], limited: [{ status: 403 }] },
  rate: { rps: 20, burst: 40 },
  actions: [
    { name: "check_balance", method: "GET" as const, url: "https://api.stripe.com/v1/balance", output: "/object" },
    {
      name: "list_customers",
      method: "GET" as const,
      url: "https://api.stripe.com/v1/customers",
      query: { limit: "25" },
      output: "/data",
    },
    { name: "get_customer", method: "GET" as const, url: "https://api.stripe.com/v1/customers/{input.customer_id}" },
    {
      name: "list_invoices",
      method: "GET" as const,
      url: "https://api.stripe.com/v1/invoices",
      query: { limit: "25" },
      output: "/data",
    },
    {
      name: "list_payment_intents",
      method: "GET" as const,
      url: "https://api.stripe.com/v1/payment_intents",
      query: { limit: "25" },
      output: "/data",
    },
    {
      name: "list_products",
      method: "GET" as const,
      url: "https://api.stripe.com/v1/products",
      query: { limit: "25" },
      output: "/data",
    },
  ],
};

export const RESEND = {
  key: "resend",
  title: "Resend",
  ...space,
  auth: { type: "api_key" as const, secret: "Resend_Key", header: "Authorization", prefix: "Bearer " },
  domains: ["api.resend.com"],
  keysPage: "https://resend.com/api-keys",
  secrets: [
    { name: "Resend_Key", label: "API key", description: "Your Resend API key with full access (Resend, API Keys)" },
    {
      name: "Resend_Webhook_Secret",
      label: "Webhook signing secret",
      description: "Optional: the secret Resend signs its webhooks with",
    },
  ],
  health: "check_domains",
  // a send-only key answers the read of domains with 401 restricted_api_key: it works, it just may not read this
  verdicts: {
    limited: [
      { status: 401, has: "restricted_api_key" },
      { status: 403, has: "invalid_permission" },
    ],
    rejected: [{ status: 400, has: "api key is invalid" }, { status: 401 }, { status: 403 }],
  },
  rate: { rps: 2, burst: 5 },
  actions: [
    {
      name: "check_domains",
      method: "GET" as const,
      url: "https://api.resend.com/domains",
      query: { limit: "1" },
      output: "/data",
    },
    { name: "list_domains", method: "GET" as const, url: "https://api.resend.com/domains", output: "/data" },
    { name: "list_api_keys", method: "GET" as const, url: "https://api.resend.com/api-keys", output: "/data" },
  ],
};

export const HUBSPOT = {
  key: "hubspot",
  title: "HubSpot",
  ...space,
  auth: { type: "bearer" as const, secret: "HubSpot_Token" },
  // app.hubspot.com is a page for people (the private app screen), never a place the token is sent
  domains: ["api.hubapi.com"],
  keysPage: "https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview",
  secrets: [
    { name: "HubSpot_Token", label: "Private app token", description: "Your HubSpot private app access token" },
  ],
  health: "check_account",
  verdicts: { rejected: [{ status: 401 }], limited: [{ status: 403 }] },
  rate: { rps: 8, burst: 16 },
  actions: [
    { name: "check_account", method: "GET" as const, url: "https://api.hubapi.com/account-info/v3/details" },
    {
      name: "list_contacts",
      method: "GET" as const,
      url: "https://api.hubapi.com/crm/v3/objects/contacts",
      query: { limit: "20" },
      output: "/results",
    },
    {
      name: "list_companies",
      method: "GET" as const,
      url: "https://api.hubapi.com/crm/v3/objects/companies",
      query: { limit: "20" },
      output: "/results",
    },
    {
      name: "list_deals",
      method: "GET" as const,
      url: "https://api.hubapi.com/crm/v3/objects/deals",
      query: { limit: "20" },
      output: "/results",
    },
  ],
};

const MAILGUN_SECRETS = [
  {
    name: "Mailgun_Key",
    label: "Private API key",
    description: "Your Mailgun private API key (Mailgun, Settings, API security)",
  },
  {
    name: "Mailgun_Signing_Key",
    label: "Webhook signing key",
    description: "Optional: the key Mailgun signs its webhooks with",
  },
];
const mailgunAt = (host: string) => ({
  auth: { type: "api_key" as const, secret: "Mailgun_Key", basic: { user: "api", pass: "{secret.Mailgun_Key}" } },
  domains: [host],
  keysPage: "https://app.mailgun.com/settings/api_security",
  secrets: MAILGUN_SECRETS,
  health: "check_domains",
  verdicts: { rejected: [{ status: 401 }], limited: [{ status: 403 }] },
  rate: { rps: 5, burst: 10 },
  actions: [
    {
      name: "check_domains",
      method: "GET" as const,
      url: `https://${host}/v4/domains`,
      query: { limit: "1" },
      output: "/items",
    },
    { name: "list_domains", method: "GET" as const, url: `https://${host}/v4/domains`, output: "/items" },
    { name: "list_events", method: "GET" as const, url: `https://${host}/v3/{input.domain}/events`, output: "/items" },
  ],
});
/** Mailgun in the US region; the person picks the region on the card, and each region is a connector of its own with one host (never both). */
export const MAILGUN = {
  key: "mailgun",
  title: "Mailgun",
  ...space,
  ...mailgunAt("api.mailgun.net"),
  choice: {
    name: "region",
    label: "Region",
    options: [
      { value: "us", label: "US", connector: "mailgun" },
      { value: "eu", label: "EU", connector: "mailgun-eu" },
    ],
  },
};
export const MAILGUN_EU = { key: "mailgun-eu", title: "Mailgun EU", ...space, ...mailgunAt("api.eu.mailgun.net") };

export const DROPBOX_SIGN = {
  key: "dropbox-sign",
  title: "Dropbox Sign",
  ...space,
  auth: { type: "api_key" as const, secret: "DropboxSign_Key", basic: { user: "{secret.DropboxSign_Key}", pass: "" } },
  domains: ["api.hellosign.com"],
  keysPage: "https://app.hellosign.com/home/myAccount#api",
  secrets: [{ name: "DropboxSign_Key", label: "API key", description: "Your Dropbox Sign API key (Settings, API)" }],
  health: "check_account",
  verdicts: { rejected: [{ status: 401 }], limited: [{ status: 403 }] },
  rate: { rps: 5, burst: 10 },
  actions: [
    { name: "check_account", method: "GET" as const, url: "https://api.hellosign.com/v3/account", output: "/account" },
    {
      name: "list_signature_requests",
      method: "GET" as const,
      url: "https://api.hellosign.com/v3/signature_request/list",
      output: "/signature_requests",
    },
  ],
};

export const ZOOM = {
  key: "zoom",
  title: "Zoom",
  ...space,
  // a server-to-server app: its three values are traded for a short token (the token action), which is held for one call and never kept
  auth: { type: "client_credentials" as const, tokenAction: "token" },
  domains: ["zoom.us", "api.zoom.us"],
  keysPage: "https://marketplace.zoom.us/user/build",
  secrets: [
    {
      name: "Zoom_Account_Id",
      label: "Account ID",
      description: "The account ID of your Zoom server-to-server OAuth app",
    },
    { name: "Zoom_Client_Id", label: "Client ID", description: "The client ID of the same app" },
    { name: "Zoom_Client_Secret", label: "Client secret", description: "The client secret of the same app" },
    {
      name: "Zoom_Webhook_Secret",
      label: "Webhook secret token",
      description: "Optional: the secret token that signs Zoom's webhooks",
    },
  ],
  health: "token",
  // Zoom answers a wrong client id, secret or account id with 400 or 401 on this call
  verdicts: { rejected: [{ status: 400 }, { status: 401 }] },
  rate: { rps: 10, burst: 20 },
  actions: [
    {
      name: "token",
      method: "POST" as const,
      url: "https://zoom.us/oauth/token",
      basic: { user: "{secret.Zoom_Client_Id}", pass: "{secret.Zoom_Client_Secret}" },
      form: { grant_type: "account_credentials", account_id: "{secret.Zoom_Account_Id}" },
      output: "/access_token",
    },
    { name: "get_user", method: "GET" as const, url: "https://api.zoom.us/v2/users/me" },
    {
      name: "list_meetings",
      method: "GET" as const,
      url: "https://api.zoom.us/v2/users/me/meetings",
      output: "/meetings",
    },
    {
      name: "list_recordings",
      method: "GET" as const,
      url: "https://api.zoom.us/v2/users/me/recordings",
      output: "/meetings",
    },
  ],
};

export const TWILIO = {
  key: "twilio",
  title: "Twilio",
  ...space,
  auth: {
    type: "api_key" as const,
    secret: "Twilio_Auth",
    basic: { user: "{secret.Twilio_Account}", pass: "{secret.Twilio_Auth}" },
  },
  // exactly one host: the wildcard the registry listed is gone from what a key may be sent to
  domains: ["api.twilio.com"],
  keysPage: "https://console.twilio.com/",
  secrets: [
    { name: "Twilio_Account", label: "Account SID", description: "Your Twilio account SID (starts with AC)" },
    { name: "Twilio_Auth", label: "Auth token", description: "Your Twilio auth token" },
  ],
  health: "check_account",
  verdicts: { rejected: [{ status: 401 }], limited: [{ status: 403 }] },
  rate: { rps: 10, burst: 20 },
  actions: [
    {
      name: "check_account",
      method: "GET" as const,
      url: "https://api.twilio.com/2010-04-01/Accounts.json",
      query: { PageSize: "1" },
      output: "/accounts",
    },
  ],
};

/** Built in as code: seeded with the registry's connectors (a service that is also in the registry takes the registry's place, keeping its action names), and registered as access resources by the host. */
export const CODE_BUILTINS = [
  FATHOM,
  STRIPE,
  RESEND,
  HUBSPOT,
  MAILGUN,
  MAILGUN_EU,
  DROPBOX_SIGN,
  ZOOM,
  TWILIO,
] as const;

/** The built-ins to seed and to register as resources while the connect card is on (lib/connect-switch.ts). They were run against stand-ins only, and which services are built in is the owner's decision. */
export const activeCodeBuiltins = (): readonly (typeof CODE_BUILTINS)[number][] =>
  connectCardOn() ? CODE_BUILTINS : [];
