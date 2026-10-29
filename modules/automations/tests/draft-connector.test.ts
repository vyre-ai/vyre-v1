// A tiny OpenAPI document already in memory. The handler does not fetch, write a row, or promote.
import test from "node:test";
import assert from "node:assert/strict";
import { generate, rejectForeignHost } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
import { clearDirectoryCache, DIRECTORY_URL } from "../docs.ts";
import { harness, codeOf } from "../fixtures/db.ts";
import { alice } from "../fixtures/seed.ts";

const SECRET = "sk-live-do-not-copy";
const DOCS = "https://docs.notes.test/api";

function notes(): OpenApiDocument {
  return {
    openapi: "3.0.3",
    info: { title: "Notes", version: "1.0.0" },
    servers: [{ url: "https://api.notes.test/v1" }],
    paths: {
      "/notes": {
        post: {
          operationId: "createNote",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string", example: "Hello" },
                    note: { type: "string", example: SECRET },
                    api_key: { type: "string", example: "key_from-doc" },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "created",
              content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } },
            },
          },
        },
      },
      "https://evil.test/v1/notes": {
        get: { operationId: "steal", responses: { "200": { description: "no" } } },
      },
    },
  };
}

test("draft_connector returns a draft, drops a secret example, and leaves a foreign host to generate", async () => {
  const h = harness();
  const out = await h.call("automations.draft_connector", { document: notes(), docsUrl: DOCS }, alice) as {
    draft: { level: string; docsUrl?: string; tested: boolean; reviewed: boolean };
    actions: { level: string; path: string; domains: string[] }[];
    request: { allowedDomains: string[]; servers: string[] } | null;
    refused: { path: string; reason: string }[];
  };
  assert.equal(out.draft.level, "draft");
  assert.equal(out.draft.tested, false);
  assert.equal(out.draft.reviewed, false);
  assert.equal(out.draft.docsUrl, DOCS);
  assert.ok(out.actions.length >= 1);
  assert.equal(out.actions.every((action) => action.level === "draft"), true);
  assert.equal(out.actions.some((action) => action.path.includes("evil.test")), false);
  const blob = JSON.stringify(out);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes("key_from-doc"), false);
  assert.equal(blob.includes("api_key"), false);
  assert.equal(blob.includes("Hello"), true);
  assert.equal(out.request?.allowedDomains.includes("docs.notes.test"), false);
  assert.equal(out.request?.servers.some((server) => server.includes("docs.notes.test")), false);
  const drafted = generate(notes(), { docsUrl: DOCS });
  assert.equal(drafted.ok, true);
  if (!drafted.ok) return;
  assert.deepEqual(out.refused, drafted.refused);
  assert.equal(out.refused.some((row) => row.path === "https://evil.test/v1/notes"), true);
  assert.equal(rejectForeignHost("https://evil.test/v1/notes", drafted.request?.allowedDomains ?? []).ok, false);
  assert.equal((h.db.all("SELECT id FROM automations_defs") as { id: string }[]).length, 0);
});

test("a document generate cannot draft raises that reason", async () => {
  const h = harness();
  const direct = generate({ openapi: "3.0.3", info: { title: "Empty" } });
  assert.equal(direct.ok, false);
  if (direct.ok) return;
  await assert.rejects(
    () => h.call("automations.draft_connector", { document: { openapi: "3.0.3", info: { title: "Empty" } } }, alice),
    (e: unknown) => codeOf(e) === "validation.bad_input" && (e as { error?: { message?: string } }).error?.message === direct.reason,
  );
  assert.equal((h.db.all("SELECT id FROM automations_defs") as { id: string }[]).length, 0);
});

test("a pasted document is not fetched when an app and a url are also sent", async () => {
  const h = harness();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; throw new Error("fetched"); }) as typeof fetch;
  try {
    const out = await h.call("automations.draft_connector", { document: notes(), app: "stripe", intent: "notes", docsUrl: "https://evil.example/spec.json" }, alice) as { draft: { docsUrl?: string } };
    assert.equal(calls, 0);
    assert.equal(out.draft.docsUrl, "https://evil.example/spec.json");
  } finally {
    globalThis.fetch = original;
  }
});

test("an unknown app is refused after the directory and no other address is opened", async () => {
  const h = harness();
  const original = globalThis.fetch;
  const seen: string[] = [];
  clearDirectoryCache();
  globalThis.fetch = (async (url: unknown) => {
    const target = String(url);
    seen.push(target);
    assert.equal(target, DIRECTORY_URL);
    return new Response(JSON.stringify({
      "slack.com": { preferred: "1", versions: { "1": { swaggerUrl: "https://api.apis.guru/v2/specs/slack.com/1/openapi.json" } } },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      () => h.call("automations.draft_connector", { app: "nope" }, alice),
      (e: unknown) => codeOf(e) === "validation.bad_input" && String((e as { error?: { message?: string } }).error?.message).includes("not opened"),
    );
    assert.deepEqual(seen, [DIRECTORY_URL]);
  } finally {
    globalThis.fetch = original;
    clearDirectoryCache();
  }
});

test("a named app drafts the matching read from the directory and stores that address", async () => {
  const h = harness();
  const original = globalThis.fetch;
  const official = "https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.json";
  clearDirectoryCache();
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    assert.equal(init?.redirect, "manual");
    const target = String(url);
    if (target === DIRECTORY_URL) {
      return new Response(JSON.stringify({
        "stripe.com": { preferred: "2022-11-15", versions: { "2022-11-15": { swaggerUrl: official } } },
        "evil.com": { preferred: "1", versions: { "1": { swaggerUrl: "https://evil.example/spec.json" } } },
      }), { status: 200 });
    }
    assert.equal(target, official);
    return new Response(JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Stripe" },
      servers: [{ url: "https://api.stripe.com" }],
      paths: {
        "/v1/customers": { get: { operationId: "listCustomers", responses: { "200": { description: "ok" } } } },
        "/v1/charges": { post: { operationId: "createCharge", responses: { "201": { description: "ok" } } } },
        "https://evil.test/steal": { get: { operationId: "steal", responses: { "200": { description: "no" } } } },
      },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const out = await h.call("automations.draft_connector", { app: "stripe", intent: "list customers" }, alice) as {
      draft: { level: string; docsUrl?: string; tested: boolean };
      actions: { path: string; effect: string }[];
    };
    assert.equal(out.draft.level, "draft");
    assert.equal(out.draft.tested, false);
    assert.equal(out.draft.docsUrl, official);
    assert.equal(out.actions.some((action) => action.path === "/v1/customers" && action.effect === "read"), true);
    assert.equal(out.actions.some((action) => action.path === "/v1/charges"), false);
    assert.equal(out.actions.some((action) => action.path.includes("evil.test")), false);
    assert.equal(JSON.stringify(out).includes("evil.example"), false);
    assert.equal((h.db.all("SELECT id FROM automations_defs") as { id: string }[]).length, 0);
  } finally {
    globalThis.fetch = original;
    clearDirectoryCache();
  }
});
