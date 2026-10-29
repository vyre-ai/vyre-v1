// Ask Vyre sees the paste shape. The value stays in Vault. Outward calls are not tried.
import test from "node:test";
import assert from "node:assert/strict";
import { actionChecks, pasteFields, setupFrom } from "../setup.ts";

const SECRET = "sk-live-do-not-copy";

function notes(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    components: {
      securitySchemes: {
        key: { type: "apiKey", in: "header", name: "X-Api-Key", example: SECRET },
        oauth: {
          type: "oauth2",
          flows: { clientCredentials: { scopes: { "notes.read": "Read notes", "notes.write": "Write notes" } } },
        },
      },
    },
    webhooks: {
      noteCreated: { post: { operationId: "noteCreated", responses: { "200": { description: "ok" } } } },
    },
  };
}

test("paste fields name the secret and leave the value out", () => {
  const { fields, scopes } = pasteFields(notes());
  assert.deepEqual(fields.map((field) => field.name), ["X-Api-Key", "Client id", "Client secret"]);
  assert.equal(fields[0]?.secret, true);
  assert.equal(fields[0]?.in, "header");
  assert.equal(fields[0]?.headerName, "X-Api-Key");
  assert.equal(fields[1]?.secret, false);
  assert.equal(fields[2]?.secret, true);
  assert.deepEqual(scopes, ["notes.read", "notes.write"]);
  const blob = JSON.stringify(fields);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(blob.includes("example"), false);
});

test("a read can be tried and an outward call waits", () => {
  const checks = actionChecks([
    { key: "list", effect: "read" },
    { key: "create", effect: "outward" },
  ]);
  assert.equal(checks[0]?.check, "dry_run");
  assert.equal(checks[1]?.check, "hold");
  assert.match(checks[1]?.reason ?? "", /waits until you run it/);
});

test("Ask Vyre gets the field shape and a webhook stays a draft", () => {
  const setup = setupFrom(notes(), [{ key: "listNotes", effect: "read" }], "https://docs.notes.test/api");
  assert.equal(setup.triggers.length, 1);
  assert.equal(setup.triggers[0]?.level, "draft");
  assert.equal(setup.triggers[0]?.method, "POST");
  assert.equal(setup.triggers[0]?.check, "hold");
  assert.equal(setup.ask.resource, "connection");
  assert.equal(setup.ask.fields?.[0]?.valueType, "secret");
  assert.equal(setup.ask.fields?.[0]?.presence, "missing");
  assert.equal(setup.ask.docs?.[0], "https://docs.notes.test/api");
  const blob = JSON.stringify(setup.ask);
  assert.equal(blob.includes(SECRET), false);
  assert.equal(JSON.stringify(setup.ask.fields?.[0]).includes("\"value\""), false);
});

test("a document with no sign-in scheme asks for nothing", () => {
  const setup = setupFrom({ openapi: "3.0.3" }, []);
  assert.deepEqual(setup.fields, []);
  assert.deepEqual(setup.triggers, []);
  assert.match(setup.ask.message ?? "", /does not say how to sign in/);
});
