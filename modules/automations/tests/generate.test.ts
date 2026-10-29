// Drafts from an OpenAPI document already in hand. Promotion stays in trust.ts. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedRequest, generate, rejectForeignHost } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
import { promote } from "../trust.ts";

const SECRET_SK = "sk-live-do-not-copy";
const SECRET_BEARER = "Bearer super-secret-token";
const SECRET_KEY = "key_supersecret";
const SECRET_MAP = "key_from-examples";

function acme(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Acme", version: "1.0.0" },
    servers: [{ url: "https://api.acme.test/v1" }],
    components: {
      securitySchemes: {
        oauth: { type: "oauth2", flows: { authorizationCode: { scopes: { "contacts.read": "Read contacts", "contacts.write": "Write contacts" } } } },
      },
    },
    security: [{ oauth: ["contacts.read"] }],
    paths: {
      "/contacts/{id}": {
        get: {
          operationId: "getContact",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "expand", in: "query", schema: { type: "string", example: "notes" } },
            { name: "note", in: "query", schema: { type: "string", example: SECRET_SK } },
            { name: "api_key", in: "header", schema: { type: "string", example: SECRET_KEY } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] } } },
            },
            "401": { description: "unauthorized" },
            "404": { description: "missing" },
          },
        },
      },
      "/contacts": {
        post: {
          operationId: "createContact",
          security: [{ oauth: ["contacts.write"] }],
          parameters: [
            { name: "dry_run", in: "query", schema: { type: "boolean" } },
            { name: "X-Request-Id", in: "header", schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", example: "Ada" },
                    note: { type: "string", example: SECRET_BEARER },
                    hint: { type: "string", examples: { leaked: { value: SECRET_MAP } } },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "created",
              content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } } },
            },
            "400": { description: "bad" },
            "429": { description: "slow down" },
          },
        },
      },
    },
  };
}

test("one GET and one POST become two draft actions", () => {
  const out = generate(acme(), { docsUrl: "https://docs.acme.test/api" });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.actions.length, 2);
  assert.deepEqual(out.actions.map((action) => action.level), ["draft", "draft"]);
  assert.deepEqual(out.actions.map((action) => action.tested), [false, false]);
  assert.equal(JSON.stringify(out).includes("private_verified"), false);

  const get = out.actions.find((action) => action.method === "GET");
  const post = out.actions.find((action) => action.method === "POST");
  assert.ok(get && post);
  assert.equal(get.key, "get_contact");
  assert.equal(get.path, "/contacts/{id}");
  assert.equal(get.effect, "read");
  assert.deepEqual(get.scopes, ["contacts.read"]);
  assert.deepEqual(get.servers, ["https://api.acme.test/v1"]);
  assert.deepEqual(get.domains, ["api.acme.test"]);
  assert.deepEqual(get.fields.map((field) => field.name), ["id", "expand", "note"]);
  assert.equal(get.fields.find((field) => field.name === "id")?.in, "path");
  assert.equal(get.fields.find((field) => field.name === "expand")?.schema.example, "notes");
  assert.deepEqual(get.outputSchema, { type: "object", properties: { id: { type: "string" }, name: { type: "string" } }, required: ["id"] });
  assert.deepEqual(get.errors, [
    { status: "401", code: "provider.auth_failed" },
    { status: "404", code: "validation.not_found" },
  ]);
  assert.equal(get.missing.includes("output"), false);
  assert.equal(get.missing.includes("test"), true);

  assert.equal(post.key, "create_contact");
  assert.equal(post.path, "/contacts");
  assert.equal(post.effect, "outward");
  assert.deepEqual(post.scopes, ["contacts.write"]);
  assert.deepEqual(post.errors, [
    { status: "400", code: "validation.bad_input" },
    { status: "429", code: "provider.rate_limited" },
  ]);
  assert.equal(post.fields.some((field) => field.name === "name" && field.in === "body" && field.required), true);
  assert.deepEqual(post.body?.properties?.name, { type: "string", example: "Ada" });

  assert.equal(out.draft.level, "draft");
  assert.equal(out.draft.tested, false);
  assert.equal(out.draft.reviewed, false);
  assert.equal(out.draft.auth, "oauth");
  assert.equal(out.draft.docsUrl, "https://docs.acme.test/api");
  assert.equal(out.request?.method, "POST");
  assert.equal(out.request?.path, "/contacts");
  assert.equal(out.request?.effect, "outward");
  assert.deepEqual(out.request?.query.dry_run, { type: "boolean" });
  assert.deepEqual(out.request?.headers["X-Request-Id"], { type: "string" });
  assert.equal(out.request?.body?.properties?.name?.type, "string");
  assert.deepEqual(out.request?.outputSchema, { type: "object", properties: { id: { type: "string" } }, required: ["id"] });
  assert.deepEqual(out.request?.allowedDomains, ["api.acme.test"]);
  assert.deepEqual(authenticatedRequest(acme()), out.request);
});

test("a missing response schema stays draft and promote still needs a recorded test", () => {
  const bare = generate({
    openapi: "3.0.3",
    info: { title: "Acme", version: "1.0.0" },
    servers: [{ url: "https://api.acme.test/v1" }],
    components: { securitySchemes: { oauth: { type: "oauth2" } } },
    security: [{ oauth: ["contacts.read"] }],
    paths: { "/status": { get: { operationId: "getStatus", responses: { "200": { description: "No schema" } } } } },
  });
  assert.equal(bare.ok, true);
  if (!bare.ok) return;
  const action = bare.actions[0];
  assert.ok(action);
  assert.equal(bare.actions.length, 1);
  assert.equal(action.level, "draft");
  assert.equal(action.outputSchema, undefined);
  assert.equal(action.missing.includes("output"), true);
  assert.equal(JSON.stringify(bare).includes("private_verified"), false);
  assert.equal(bare.draft.tested, false);

  const denied = promote(bare.draft, "private_verified");
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.reason, /recorded test/);

  const ready = generate(acme());
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  const held = promote(ready.draft, "private_verified");
  assert.equal(held.ok, false);
  if (!held.ok) assert.match(held.reason, /recorded test/);
  assert.equal(promote({ ...ready.draft, tested: true }, "private_verified").ok, true);
  assert.equal(promote(ready.draft, "built_in").ok, false);
});

test("a host outside the servers list is rejected", () => {
  const out = generate(acme(), { docsUrl: "https://docs.acme.test/api" });
  assert.equal(out.ok, true);
  if (!out.ok || !out.request) return;
  const domains = out.request.allowedDomains;
  assert.deepEqual(domains, ["api.acme.test"]);
  assert.equal(domains.includes("docs.acme.test"), false);
  assert.equal(rejectForeignHost("https://evil.test/v1/contacts", domains).ok, false);
  assert.equal(rejectForeignHost("https://api.acme.test.evil.test/v1/contacts", domains).ok, false);
  assert.equal(rejectForeignHost("//evil.test/v1/contacts", domains).ok, false);
  assert.equal(rejectForeignHost("https://user:pw@api.acme.test/v1/contacts", domains).ok, false);
  assert.deepEqual(rejectForeignHost("https://api.acme.test/v1/contacts/1", domains), { ok: true, host: "api.acme.test" });
  assert.deepEqual(rejectForeignHost("/contacts/1", domains), { ok: true, host: null });
  assert.equal(rejectForeignHost("https://api.acme.test/v1/contacts", []).ok, false);
});

test("a secret example is not copied into the draft", () => {
  const out = generate(acme());
  assert.equal(out.ok, true);
  if (!out.ok) return;
  const blob = JSON.stringify(out);
  assert.equal(blob.includes(SECRET_SK), false);
  assert.equal(blob.includes(SECRET_BEARER), false);
  assert.equal(blob.includes(SECRET_KEY), false);
  assert.equal(blob.includes(SECRET_MAP), false);
  assert.equal(blob.includes("api_key"), false);
  const post = out.actions.find((action) => action.method === "POST");
  assert.equal(post?.fields.some((field) => field.name === "note"), true);
  assert.equal(post?.fields.some((field) => field.name === "hint"), true);
  assert.equal(post?.fields.some((field) => field.name === "api_key"), false);
  assert.equal(blob.includes("Ada"), true);
  assert.equal(blob.includes("notes"), true);
});

test("a document with no servers and no paths is refused", () => {
  for (const doc of [{}, { openapi: "3.0.3", info: { title: "Nope" } }, { servers: [], paths: {} }]) {
    const refused = generate(doc);
    assert.equal(refused.ok, false);
    if (!refused.ok) {
      assert.match(refused.reason, /no servers/i);
      assert.match(refused.reason, /no paths/i);
    }
  }
});

test("an operation with no method is refused", () => {
  const out = generate({
    openapi: "3.0.3",
    info: { title: "Acme" },
    servers: [{ url: "https://api.acme.test" }],
    paths: { "/orphan": { operationId: "orphan", responses: { "200": { description: "missing method" } } } },
  });
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.deepEqual(out.actions, []);
  assert.equal(out.request, null);
  assert.equal(out.refused.length, 1);
  assert.match(out.refused[0]?.reason ?? "", /no HTTP method/);
  assert.equal(out.draft.level, "draft");
  assert.equal(promote(out.draft, "private_verified").ok, false);
});
