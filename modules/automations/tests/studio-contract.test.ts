import test from "node:test";
import assert from "node:assert/strict";
import { admit, blocksLivePublish, literal, presenceOf } from "../val.ts";
import type { CapabilityContract } from "../val.ts";
import { askBundle, scrubDiagnostics } from "../ask-vyre.ts";
import { planMigration, previewCohorts } from "../migration.ts";
import type { MigrationNode, MigrationRun } from "../migration.ts";
import { liveRerunWarning, normalizePolicy } from "../failure-policy.ts";
import { promote, visibleInPalette, CONNECT_LIMIT } from "../trust.ts";

const live: CapabilityContract = {
  key: "records.update",
  inputSchema: { type: "object" },
  outputSchema: { type: "object", properties: { recordId: { type: "string" } } },
  effects: "write",
  connection: { required: false },
  errors: [{ code: "validation.bad_input", retryable: false }],
  test: { mode: "stub-write" },
  idempotency: "key",
  availability: "live",
  executorVersion: "1",
};

test("numbers and booleans stay typed, and missing is not null or empty", () => {
  assert.deepEqual(literal(3, "number"), { kind: "literal", value: 3, valueType: "number" });
  assert.equal(presenceOf(undefined), "missing");
  assert.equal(presenceOf(null), "null");
  assert.equal(presenceOf(""), "empty");
  assert.equal(presenceOf([]), "empty");
  assert.equal(presenceOf(false), "value");
});

test("a capability without errors or a live executor cannot publish as stable", () => {
  assert.equal(admit(live).stable, true);
  const preview = admit({ ...live, availability: "preview", errors: [] });
  assert.equal(preview.stable, false);
  assert.ok(preview.issues.some((i) => i.code === "capability.errors"));
  assert.equal(blocksLivePublish("preview"), true);
  assert.equal(blocksLivePublish("live"), false);
});

test("Ask Vyre drops secrets and keeps the connection id and error code", () => {
  const bundle = askBundle({
    resource: "run",
    errorCode: "provider.auth_failed",
    message: "Google rejected Bearer ya29.super-secret-token",
    traceId: "tr_1",
    connectionId: "con_google",
    connectionState: "revoked",
    authorization: "Bearer ya29.nope",
    cookie: "session=abc",
    fields: [{ name: "to", valueType: "email", presence: "value" }],
  });
  assert.equal(bundle.connectionId, "con_google");
  assert.equal(bundle.errorCode, "provider.auth_failed");
  assert.equal(bundle.message?.includes("ya29"), false);
  assert.equal("authorization" in bundle, false);
  const walked = scrubDiagnostics({ headers: { authorization: "Bearer abc" }, note: "sk-live-abcdefghij" }) as { headers: Record<string, unknown>; note: string };
  assert.equal(walked.headers.authorization, undefined);
  assert.equal(walked.note.includes("sk-live"), false);
});

test("cohort preview keeps a safe run pinned to the same step and refuses an ambiguous apply", () => {
  const source: MigrationNode[] = [
    { id: "tag", key: "records.update", effects: "write", next: ["mail"] },
    { id: "mail", key: "send_email", effects: "outward", next: ["wait"] },
    { id: "wait", key: "wait", effects: "read" },
  ];
  const target: MigrationNode[] = [
    { id: "tag", key: "records.update", effects: "write", next: ["mail"] },
    { id: "mail", key: "send_email", effects: "outward", next: ["wait"] },
    { id: "wait", key: "wait", effects: "read" },
  ];
  const waiting: MigrationRun = {
    id: "run_wait", definitionVersion: 12, status: "waiting", currentStepId: "wait", succeededStepIds: ["tag", "mail"],
  };
  const safe = previewCohorts([waiting], source, target);
  assert.equal(safe[0]?.disposition, "safe");
  assert.equal(safe[0]?.proposedStepId, "wait");
  assert.deepEqual(safe[0]?.repeatedEffects, []);

  const moved: MigrationNode[] = [{ id: "tag", key: "records.update", effects: "write" }];
  const ambiguous = previewCohorts([waiting], source, moved);
  assert.equal(ambiguous[0]?.disposition, "ambiguous");
  const applied = planMigration(ambiguous, ["run_wait"], 13);
  assert.equal(applied.ok, false);

  const ok = planMigration(safe, ["run_wait"], 13);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.plans[0]?.atStepId, "wait");
});

test("a changed step key is ambiguous even when the id survives", () => {
  const source: MigrationNode[] = [{ id: "mail", key: "send_email", effects: "outward" }];
  const target: MigrationNode[] = [{ id: "mail", key: "send_sms", effects: "outward" }];
  const run: MigrationRun = { id: "run_m", definitionVersion: 2, status: "running", currentStepId: "mail", succeededStepIds: [] };
  assert.equal(previewCohorts([run], source, target)[0]?.disposition, "ambiguous");
});

test("skip and substitute do not become a live retry, and a live rerun names outward work", () => {
  assert.equal(normalizePolicy({ action: "retry", max: 99 }).engine.max, 10);
  assert.equal(normalizePolicy({ action: "skip" }).skip, true);
  assert.deepEqual(normalizePolicy({ action: "substitute", output: { ok: false } }).substitute, { ok: false });
  assert.equal(normalizePolicy({ action: "stop" }).engine.mode, "fail");
  assert.match(liveRerunWarning(["write", "outward"]) ?? "", /live rerun/i);
  assert.equal(liveRerunWarning(["read"]), null);
});

test("connector promotion is one reviewed step, and built-in is not self-serve", () => {
  const draft = { key: "acme", level: "draft" as const, tested: true, reviewed: false, auth: "oauth" as const };
  assert.equal(promote(draft, "private_verified").ok, true);
  assert.equal(promote(draft, "built_in").ok, false);
  assert.equal(promote({ ...draft, tested: false }, "private_verified").ok, false);
  assert.equal(visibleInPalette("draft", "space"), false);
  assert.equal(visibleInPalette("space_published", "space"), true);
  assert.match(CONNECT_LIMIT, /cannot connect an arbitrary website/);
});
