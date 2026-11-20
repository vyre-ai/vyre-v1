// An agent computer's Vault channel, end to end over HTTP, for a one-time-code item: agentd posts one #Handle.field to /computers/fill with its token; the host checks the agent may use the item (the real
// vault.use), reads the value through the real Vault port, and answers. For a seed the answer is the current RFC 6238 code and never the seed; every use is logged without a value.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createEngineSessionHost } from "../src/seams/engine-session.ts";
import { createFillService, fillHttp } from "../../modules/computers/handlers/fill.ts";
import * as v from "../../modules/vault/handlers/index.ts";
import * as u from "../../modules/vault/handlers/use.ts";
import { codeAt, parseSeed } from "../../lib/totp.ts";
import { AGENT, harness } from "../../modules/vault/fixtures/harness.ts";

const SEED = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"; // secret-scan: fake
type Json = Record<string, unknown>;

test("an agent computer fills a totp item's code through the Vault channel: the answer is the code, the seed is in no answer, log or error", async () => {
  const h = harness();
  const folderId = String(
    ((await v.foldersCreate(h.ctx, { name: "Keys", scope: "shared", idempotencyKey: "f" })) as Json & { folder: Json })
      .folder["id"],
  );
  const made = (await v.itemPut(h.ctx, {
    folderId,
    name: "Acme TOTP",
    kind: "totp",
    fields: [{ key: "secret", value: SEED }],
    idempotencyKey: "p",
  } as Parameters<typeof v.itemPut>[1])) as Json & { item: Json };
  const itemId = String(made.item["id"]);
  h.ctx.db.run(`UPDATE vault_meta SET "owner" = ? WHERE "id" = ?`, AGENT, itemId); // the agent's own item, as an agent that set it up would have it
  u.configureVault({ sinks: {} });
  const port = u.secretPort(h.ctx.db);
  const logged: string[] = [];
  const session = createEngineSessionHost({
    space: "spc_vault",
    vault: { secret: (handle, _space, asker) => port.secret(handle, "", asker), signRs256: async () => "" },
    // the module's own vault.use, as the agent
    invoke: (async (cap: string, input: Record<string, unknown>) => {
      assert.equal(cap, "vault.use");
      h.actAs("agent", AGENT);
      try {
        return { status: "ok", output: await u.use(h.ctx, input as never) };
      } catch (e) {
        return { status: "error", error: e };
      }
    }) as never,
  });
  const svc = createFillService({
    source: session.source as never,
    log: (use) => void logged.push(JSON.stringify(use)),
    now: () => Date.now(),
  });
  const server = http.createServer(fillHttp(svc));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/fill`;
  try {
    const grant = await svc.issue({ computerId: "cmp_1", agentId: AGENT, asker: "usr_nobody" });
    // agentd's own request: the handle of the field, with the computer's token
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${grant.fillToken}` },
      body: JSON.stringify({ handle: "Acme_TOTP", field: "secret", computerId: "cmp_1" }),
    });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    const body = JSON.parse(text) as { value: string; itemId: string };
    const p = parseSeed(SEED)!;
    const t = Date.now();
    assert.match(body.value, /^\d{6}$/);
    assert.ok(
      [t - 30_000, t, t + 30_000].some((x) => codeAt(p, x).code === body.value),
      "the current RFC 6238 code",
    );
    assert.equal(body.itemId, itemId);
    assert.ok(!text.includes(SEED) && !logged.join("").includes(SEED), "the seed is in no answer or log");
    assert.ok(!h.everything().includes(SEED), "nor in a row, event or log of the Vault");
  } finally {
    await new Promise<void>((ok) => server.close(() => ok()));
  }
});
