// A tiny OpenAPI document already in memory. The handler does not fetch, write a row, or promote.
import test from "node:test";
import assert from "node:assert/strict";
import { generate, rejectForeignHost } from "../generate.ts";
import type { OpenApiDocument } from "../generate.ts";
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
