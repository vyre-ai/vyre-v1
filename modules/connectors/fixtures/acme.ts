// A connector the tests run: Acme CRM, api-key auth, three actions, a health call and recorded-response cases.
import type { ConnectorDef } from "../projections.ts";

export const ACME: ConnectorDef = {
  key: "acme", title: "Acme CRM", mode: "api", scope: "space", version: "1.0.0",
  auth: { type: "api_key", secret: "Acme_Key", header: "X-Api-Key" },
  domains: ["api.acme.test", "*.cdn.acme.test"],
  secrets: [{ name: "Acme_Key", description: "API key for Acme CRM" }, { name: "Acme_Hook", description: "Signing secret for Acme webhooks" }],
  health: "ping",
  rate: { rps: 1, burst: 2 },
  actions: [
    { name: "ping", url: "https://api.acme.test/v1/ping", output: "/ok" },
    { name: "get_contact", url: "https://api.acme.test/v1/contacts/{input.id}", query: { expand: "{input.expand}" }, output: "/data" },
    { name: "add_note", method: "POST", url: "https://api.acme.test/v1/contacts/{input.id}/notes", headers: { "X-Hook": "{secret.Acme_Hook}" }, body: { text: "{input.text}", pinned: "{input.pinned}" }, output: "/data", write: true },
    { name: "raw", url: "https://api.acme.test/v1/raw" },
  ],
  tests: [
    { name: "ping answers ok", action: "ping", responses: [{ url: "https://api.acme.test/v1/ping", body: { ok: true } }], expect: { output: true, requests: 1 } },
    { name: "get_contact reads the data", action: "get_contact", input: { id: "c 1", expand: "notes" }, responses: [{ url: "https://api.acme.test/v1/contacts/c%201", body: { data: { name: "Ann" } } }], expect: { output: { name: "Ann" } } },
    { name: "add_note posts the note", action: "add_note", input: { id: "c1", text: "hello", pinned: true }, responses: [{ method: "POST", url: "https://api.acme.test/v1/contacts/c1/notes", status: 201, body: { data: { id: "n1" } } }], expect: { output: { id: "n1" } } },
    { name: "a rejected key is an auth error", action: "ping", responses: [{ url: "https://api.acme.test/v1/ping", status: 401, body: { error: "bad key" } }], expect: { error: "provider.auth_failed" } },
    { name: "an echoed secret is scrubbed", action: "raw", responses: [{ url: "https://api.acme.test/v1/raw", body: { echo: "{secret.Acme_Key}" } }], expect: { output: { echo: "***" } } },
  ],
};

export const OAUTHAPP = {
  key: "oauthapp", title: "OAuth App", mode: "oauth_app" as const, scope: "person" as const, version: "1.0.0",
  auth: { type: "oauth2" as const, secret: "App_Token", authUrl: "https://login.oauthapp.test/authorize", tokenUrl: "https://login.oauthapp.test/token", clientId: "client-123", clientSecret: "App_ClientSecret", scopes: ["read", "write"] },
  domains: ["login.oauthapp.test", "api.oauthapp.test"],
  secrets: [{ name: "App_Token", description: "access token" }, { name: "App_Token_refresh", description: "refresh token" }, { name: "App_ClientSecret", description: "client secret" }],
  health: "me",
  actions: [{ name: "me", url: "https://api.oauthapp.test/me", output: "/user" }],
  tests: [],
} satisfies ConnectorDef;
