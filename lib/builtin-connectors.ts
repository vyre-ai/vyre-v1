// Built-in connectors written as a whole definition (URL actions and all), for services reached through their public API with a key a person pastes. Seeded with the registry's built-ins; a later change by a person is never overwritten.
// Fathom: base address, header and calls from Fathom's own API documentation (developers.fathom.ai: the OpenAPI spec says servers https://api.fathom.ai/external/v1, ApiKeyAuth in header X-Api-Key, GET /meetings,
// GET /recordings/{recording_id}/summary and /transcript). NOT run against the real service: only against a stand-in. Scope is person: each person connects their own account, the key kept in their own Mine.

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

/** Built in as code: seeded with the registry's connectors, and registered as access resources by the host. */
export const CODE_BUILTINS = [FATHOM] as const;
