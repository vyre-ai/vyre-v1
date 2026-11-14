// What a model reads of a failed tool (owner, 4 Nov): a code and a plain sentence, no trace and no internal id; the code's own reason word stays, because a caller tells refusals apart by it.
import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeCode } from "../../lib/words/errors.ts";
import { REPLY_RULE, modelError, safeContent } from "../src/tools/model-error.ts";

const err = (details: Record<string, unknown>) =>
  ({ code: "permission.no_grant", message: "No.", traceId: "t", details }) as never;

test("a reason word stays, even one as long as agent_settings, and a reason that is an id does not", () => {
  assert.equal(modelError(err({ reason: "agent_settings" })).details?.reason, "agent_settings");
  assert.equal(modelError(err({ reason: "placeholder" })).details?.reason, "placeholder");
  assert.equal(modelError(err({ reason: "tsk_a1b2c3d4e5f6" })).details?.reason, undefined);
  assert.equal(modelError(err({ reason: "vault_locked", tool: "files_save" })).details?.tool, "files_save");
});

test("it reads the same every time: no state carries from one error to the next", () => {
  for (let i = 0; i < 4; i++)
    assert.equal(modelError(err({ reason: "agent_settings" })).details?.reason, "agent_settings");
});

test("ids and traces are taken out of the words", () => {
  const e = modelError({
    code: "validation.not_found",
    message: "No file fil_a1b2c3d4e5f6 (trace 14d3abcd14d3abcd).",
    traceId: "14d3abcd14d3abcd",
  } as never);
  assert.ok(!/fil_a1b2|14d3abcd/.test(e.message), e.message);
});

// 13 Nov 2026 (owner): agents printed permission.above_clearance, validation.precondition_failed, internal.unexpected and validation.too_large to him. An agent repeats what a failed call hands it, so what it is
// handed leads with the plain sentence and what to do, then the rule for reporting it; the code stays in the data as a reference for support.
const FAMILIES = [
  ["permission", "permission.above_clearance", "That is restricted."],
  ["permission", "permission.role_lacks_permission", "Not allowed."],
  ["validation", "validation.bad_input", "Bad."],
  ["validation (not found)", "validation.not_found", "No such file."],
  ["validation (precondition)", "validation.precondition_failed", "Not now."],
  ["internal", "internal.unexpected", "Boom."],
  ["too large", "validation.too_large", "Too big."],
] as const;

for (const [family, code] of FAMILIES) {
  test(`a refused call of the ${family} family (${code}) reads in plain words first, then the rule, and keeps the code only for support`, () => {
    // the server's own message carries a code, as several do, so the table's words must stand in
    const e = modelError({ code, message: `${code} (trace 14d3abcd14d3abcd)`, traceId: "14d3abcd14d3abcd" } as never);
    assert.equal(Object.keys(e)[0], "say", "the plain sentence comes first");
    assert.equal(Object.keys(e)[1], "reply", "then the rule for reporting it");
    assert.equal(e.reply, REPLY_RULE);
    assert.match(e.reply, /Do not show codes/);
    assert.equal(looksLikeCode(e.say), false, `the sentence a person may hear has a code in it: ${e.say}`);
    assert.ok(e.say.length > 20 && /[.]/.test(e.say), e.say);
    assert.equal(e.supportCode, code, "the code is kept");
    assert.equal(Object.keys(e).at(-1), "supportCode", "last, marked as a reference for support");
    assert.equal("code" in e, false, "no bare `code` for a model to repeat");
    assert.equal(JSON.stringify({ say: e.say, reply: e.reply }).includes(code), false);
  });
}

test("what the agent is told when its own clearance is short names the agent, not the person, and says to stop", () => {
  const e = modelError({ code: "permission.above_clearance", message: "", traceId: "t" } as never);
  assert.match(e.say, /labelled above what I am cleared to open/);
  assert.match(e.say, /An admin decides who may open it/);
  assert.doesNotMatch(
    e.say,
    /only people|cannot be given|open it themselves/i,
    "not true when the person is below the label too, or an admin gave the agent a higher role",
  );
  assert.match(e.say, /do not ask for access for me/, "never suggests a request that cannot work");
  // 14 Nov 2026: the owner shared a restricted key with his Assistant because it asked him to, and the share could never work
  assert.match(e.say, /do not ask the person to share it/, "never suggests a share that cannot work");
  assert.match(
    e.say,
    /move it to their own keys in the Vault, or to a folder that is not restricted/,
    "says what does work",
  );
  const r = modelError({ code: "permission.role_lacks_permission", message: "", traceId: "t" } as never);
  assert.match(r.say, /not allowed for me here, or for the person I work for/);
  assert.doesNotMatch(r.say, /Neither/, "true when only the agent lacks it");
  assert.match(r.say, /allow it for me when only I am short of it/);
  assert.match(r.say, /ask an admin by name/);
});

test("a plain message the server wrote for this very failure leads, and the table's next step follows it", () => {
  const e = modelError({
    code: "permission.role_lacks_permission",
    message: "This pane only has view access to what you are looking at.",
    traceId: "t",
  } as never);
  assert.match(e.say, /^This pane only has view access to what you are looking at\. /);
});

test("the error envelope an agent receives, as one snapshot", () => {
  const e = modelError({
    code: "permission.above_clearance",
    message: "That item is above your clearance.",
    traceId: "14d3abcd14d3abcd",
    retryable: false,
    details: { tool: "vault_use", reason: "above_clearance", internal: "vit_1234567890abcdef" },
    next: [{ kind: "ask_access", label: "Ask for access", action: { cap: "access.request", input: {} } }],
  } as never);
  assert.equal(
    JSON.stringify(e, null, 1),
    JSON.stringify(
      {
        say: "That item is above your clearance. An admin decides who may open it. Sharing it with me does not change that, so do not ask the person to share it and do not ask for access for me. If it is a key the person meant me to use, it is kept in a restricted folder: they can move it to their own keys in the Vault, or to a folder that is not restricted, and then I can use it. Tell the person that and stop.",
        reply: REPLY_RULE,
        message: "That item is above your clearance.",
        details: { reason: "above_clearance", tool: "vault_use" },
        next: [{ label: "Ask for access" }],
        supportCode: "permission.above_clearance",
      },
      null,
      1,
    ),
  );
});

test("the same shape reaches a CLI engine through the server's tool result", () => {
  const out = safeContent({ error: { code: "validation.too_large", message: "", traceId: "t" } }) as {
    error: ReturnType<typeof modelError>;
  };
  assert.equal(Object.keys(out.error)[0], "say");
  assert.equal(out.error.supportCode, "validation.too_large");
});

test("a thing the caller named that is not there is said by kind and by the name they gave, never by an id", () => {
  const named = modelError({
    code: "permission.not_found",
    message: "There is no connector called google ads that you can see.",
    traceId: "t",
    details: { cap: "connections.create", reason: "not_found", thing: "connector", name: "google_ads" },
  } as never);
  assert.match(named.say, /^There is no connector called google_ads that I can open\./);
  assert.deepEqual(named.details, { reason: "not_found", thing: "connector", name: "google_ads" });
  // a name that is an id is not said back, only the kind
  const byId = modelError({
    code: "permission.not_found",
    message: "x",
    traceId: "t",
    details: { thing: "connection", name: "con_a1b2c3d4e5f6a7b8" },
  } as never);
  assert.match(byId.say, /^There is no connection by that name that I can open\./);
  assert.equal(byId.details?.name, undefined);
  assert.ok(!/con_a1b2/.test(JSON.stringify(byId)));
  // a code that is not a not-found never takes the sentence
  const other = modelError({
    code: "permission.no_grant",
    message: "No.",
    traceId: "t",
    details: { thing: "connector", name: "fathom" },
  } as never);
  assert.ok(!/There is no connector/.test(other.say), other.say);
});
