// "The Assistant may use this key inside this Automation" (AUTOMATIONS-2026-11-13 2.8; lead rulings 13 Nov): given by a person who holds Use, scoped to one Automation's runs and its build thread, for that giver only,
// checked at every use, and only ever NARROWER than the access the kernel gives the agent. No value lives in the grant.
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../handlers/index.ts";
import * as u from "../handlers/use.ts";
import * as g from "../handlers/assistant-grant.ts";
import { ADMIN, AGENT, MAYA, ROB, SECRET, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
let seq = 0;
const key = (): string => `ag-${++seq}`;
const AUTO = "aut_intake0001";
const THREAD = "thr_build00001";
const OTHER_THREAD = "thr_chatelse01";

/** A shared item Maya made (so she owns it), that Rob may use. Returns its id. */
async function setup(
  h: Harness,
  name = "Lawmatics token",
  kind = "api_key",
  folderName = "Team",
): Promise<{ item: string; folder: string }> {
  h.actAs("person", MAYA);
  h.allow(MAYA, "vault.shared_create");
  const folder = String(
    out(out(await v.foldersCreate(h.ctx, { name: folderName, scope: "shared", idempotencyKey: key() })).folder).id,
  );
  const item = String(
    out(
      out(
        await v.itemPut(h.ctx, {
          folderId: folder,
          name,
          kind,
          fields: [{ key: "api_key", value: SECRET }],
          idempotencyKey: key(),
        } as Parameters<typeof v.itemPut>[1]),
      ).item,
    ).id,
  );
  h.grant(ROB, item, "use");
  return { item, folder };
}
const asRob = (h: Harness): void => {
  h.actAs("person", ROB);
  delete h.ctx.actingFor;
  delete h.ctx.thread;
  delete h.ctx.run;
};
/** The Assistant acting for a person, in a thread or a run. */
function asAgent(h: Harness, forWhom: string, where: { thread?: string; run?: string } = {}): void {
  h.actAs("agent", AGENT);
  h.ctx.actingFor = forWhom;
  if (where.thread) h.ctx.thread = where.thread;
  else delete h.ctx.thread;
  if (where.run) h.ctx.run = where.run;
  else delete h.ctx.run;
}
const refused = async (p: Promise<unknown>): Promise<{ code: string; message: string }> => {
  try {
    await p;
  } catch (e) {
    const err = (e as { error?: { code?: string; message?: string } }).error;
    return { code: String(err?.code), message: String(err?.message) };
  }
  assert.fail("expected a refusal");
};
const give = (h: Harness, item: string, o: Json = {}) =>
  g.give(h.ctx, {
    itemId: item,
    automationId: AUTO,
    automationName: "Form to lead",
    agentId: AGENT,
    threadId: THREAD,
    ...o,
  });

test("a person who holds Use gives the grant: the kernel share carries the giver as its source, the row names the scope, History shows it", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    asRob(h);
    const made = out(out(await give(h, item)).grant);
    assert.equal(made.automationId, AUTO);
    assert.equal(made.giver, ROB);
    const share = h.calls("access.share").at(-1)!;
    assert.deepEqual(share.input["subject"], { kind: "agent", id: AGENT });
    assert.deepEqual(share.input["resource"], { type: "vault_item", id: item });
    assert.equal(share.input["level"], "use");
    assert.equal(share.input["source"], `through-agent:${ROB}`);
    const hist = h.rows(`SELECT "actor","action","detail" FROM vault_history WHERE "itemId" = ? ORDER BY "at"`, item);
    const last = hist.at(-1)!;
    assert.equal(JSON.parse(String(last["actor"])).id, ROB, "History names the giver, not the system");
    assert.match(String(last["detail"]), /Form to lead/);
    assert.ok(!h.everything().includes(SECRET));
  } finally {
    h.cleanup();
  }
});

test("a person who does not hold Use cannot give it, a Mine item needs no grant, a company key is never given", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    h.actAs("person", ADMIN);
    assert.equal((await refused(give(h, item))).code, "permission.no_grant");
    assert.equal(h.calls("access.share").length, 0, "no share was made");
    // a company key
    const co = await setup(h, "Google DWD", "api_key", "Company");
    h.ctx.db.run(`UPDATE vault_meta SET "handle" = ? WHERE "id" = ?`, "#Google_DWD", co.item);
    asRob(h);
    const r = await refused(give(h, co.item));
    assert.match(r.message, /server alone/);
  } finally {
    h.cleanup();
  }
});

test("only a person's own hand gives it: not an agent, not an agent acting for a person, not through the MCP door", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    h.grant(AGENT, item, "use");
    h.actAs("agent", AGENT);
    assert.equal((await refused(give(h, item))).code, "permission.no_grant", "an agent");
    asRob(h);
    h.ctx.actingFor = MAYA;
    assert.equal((await refused(give(h, item))).code, "permission.no_grant", "a person acting for another");
    delete h.ctx.actingFor;
    h.ctx.origin = "mcp";
    assert.equal((await refused(give(h, item))).code, "permission.no_grant", "the MCP door");
    h.ctx.origin = "user";
    h.actAs("service", "svc_host");
    assert.equal((await refused(give(h, item))).code, "permission.no_grant", "a service");
    assert.equal(h.calls("access.share").length, 0);
  } finally {
    h.cleanup();
  }
});

test("scope: allowed in the Automation's build thread and in its own runs, refused in any other chat, any other Automation, and for any other asker", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    asRob(h);
    await give(h, item);
    h.grant(AGENT, item, "use"); // what the kernel share gives
    h.setRun("run_a", AUTO);
    h.setRun("run_b", "aut_other00002");
    asAgent(h, ROB, { thread: THREAD });
    assert.equal(out(await u.use(h.ctx, { item: "#Lawmatics_token" })).itemId, item, "the build thread");
    asAgent(h, ROB, { run: "run_a" });
    assert.equal(out(await u.use(h.ctx, { item: "#Lawmatics_token" })).itemId, item, "the Automation's run");
    asAgent(h, ROB, { thread: OTHER_THREAD });
    const chat = await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
    assert.equal(chat.code, "permission.no_grant");
    assert.doesNotMatch(chat.message, /permission\.|trace|grant/i, "one plain sentence, no code");
    asAgent(h, ROB, { run: "run_b" });
    await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
    asAgent(h, ROB);
    await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
  } finally {
    h.cleanup();
  }
});

test("a second person's build turns do not inherit the grant, and the grant never widens what the kernel gives", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    asRob(h);
    await give(h, item);
    // the kernel gives this agent no reach for Maya (the share's source is Rob's); the vault adds nothing
    asAgent(h, MAYA, { thread: THREAD });
    assert.equal((await refused(u.use(h.ctx, { item: "#Lawmatics_token" }))).code, "validation.not_found");
    // an ordinary share from someone else (the kernel lets this agent in for Maya): the grant is Rob's, so it governs Rob's turns only
    h.grant(AGENT, item, "use");
    asAgent(h, MAYA, { thread: OTHER_THREAD });
    assert.equal(
      out(await u.use(h.ctx, { item: "#Lawmatics_token" })).itemId,
      item,
      "Maya's own reach is the kernel's alone",
    );
    asAgent(h, ROB, { thread: OTHER_THREAD });
    await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
  } finally {
    h.cleanup();
  }
});

test("the giver's Use is checked at every use: losing it ends the next use with one plain line", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    asRob(h);
    await give(h, item);
    h.grant(AGENT, item, "use");
    asAgent(h, ROB, { thread: THREAD });
    await u.use(h.ctx, { item: "#Lawmatics_token" });
    h.revokeLevel(ROB, item);
    asAgent(h, ROB, { thread: THREAD });
    const r = await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
    assert.equal(r.code, "permission.no_grant");
    assert.match(r.message, /no longer/i);
  } finally {
    h.cleanup();
  }
});

test("every path that opens a value for an agent goes through the scope: use, fill, inject_env", async () => {
  const h = harness();
  try {
    const { item, folder } = await setup(h);
    asRob(h);
    await give(h, item);
    h.grant(AGENT, item, "use");
    h.grant(AGENT, folder, "use");
    asAgent(h, ROB, { thread: OTHER_THREAD });
    await refused(u.use(h.ctx, { item: "#Lawmatics_token" }));
    await refused(u.fill(h.ctx, { handle: "#Lawmatics_token.api_key", target: { kind: "env", ref: "X" } }));
    const injected = out(await u.injectEnv(h.ctx, { folderId: folder }));
    assert.deepEqual(injected["handles"], [], "an item out of scope is left out of the environment");
    assert.equal(h.rows(`SELECT 1 FROM vault_history WHERE "itemId" = ? AND "action" = ?`, item, "used").length, 0);
  } finally {
    h.cleanup();
  }
});

test("revoking stops the next use, takes back only its own kernel share, and a deleted item revokes its grants", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    asRob(h);
    const id = String(out(out(await give(h, item)).grant).id);
    h.grant(AGENT, item, "use");
    await g.revoke(h.ctx, { grantId: id });
    const un = h.calls("access.unshare").at(-1)!;
    assert.equal(un.input["source"], `through-agent:${ROB}`, "only the grant's own source is taken back");
    assert.equal(
      h.rows(`SELECT "revokedAt" FROM vault_assistant_grant WHERE "id" = ?`, id)[0]!["revokedAt"] !== null,
      true,
    );
    asAgent(h, ROB, { thread: THREAD });
    // revoked: the vault no longer narrows, and the kernel share is gone; the harness keeps the scripted kernel level, so the vault alone must not hand a scoped use out
    assert.equal((await g.list(h.ctx, { itemId: item })).grants.length, 0);
    // a deleted item revokes its grants
    asRob(h);
    const again = String(out(out(await give(h, item)).grant).id);
    h.actAs("person", MAYA);
    delete h.ctx.actingFor;
    await v.itemDelete(h.ctx, { itemId: item });
    assert.notEqual(
      h.rows(`SELECT "revokedAt" FROM vault_assistant_grant WHERE "id" = ?`, again)[0]!["revokedAt"],
      null,
    );
  } finally {
    h.cleanup();
  }
});

test("closing the card midway stores nothing: a refused give leaves no row", async () => {
  const h = harness();
  try {
    const { item } = await setup(h);
    h.actAs("person", ADMIN);
    await refused(give(h, item));
    assert.equal(h.rows(`SELECT 1 FROM vault_assistant_grant`).length, 0);
  } finally {
    h.cleanup();
  }
});
