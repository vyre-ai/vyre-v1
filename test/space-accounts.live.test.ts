// Space AI accounts on a booted Team Space server (owner ruling 9). The owner keeps "Team credits" (a shared key) for automations with a monthly cap, and narrows the Space AI key to team chats.
// Rubab signs in with Claude (a fake sign-in, the Space switch left off): her chat runs on her own sign-in, while an automation step of hers runs on Team credits. A cap the month has reached
// skips Team credits, and with nothing else kept for automations the step stops and says so. An agent pinned to Team credits runs Sara's chat there although it is not kept for team chats.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { wipe } from "../client/src/crypto/keys.ts";
import { boot, seededDir } from "./memory-live-kit.ts";
import { SPACE_KEY, api, ask, connectClaude, door, join, ok, standIn } from "./member-key-kit.ts";

const CREDITS = "sk-team-credits-FAKEkey-0123456789abcdef"; // secret-scan: fake

/** One OpenAI-compatible model list for both keys: the Space AI key serves GLM, Team credits serves Claude. */
async function vendor(): Promise<{ base: string; close(): Promise<void> }> {
  const server = http.createServer((req, res) => {
    const auth = String(req.headers["authorization"]);
    const models = auth === `Bearer ${SPACE_KEY}` ? ["glm-test"] : auth === `Bearer ${CREDITS}` ? ["claude-sonnet-5-5"] : null;
    if (!models) { res.writeHead(401); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

test("Team server: an automation runs on the Space account kept for automations while her chat runs on her own; a capped account is skipped; an agent's pin is honoured", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    // the Space AI key: every use on at first (as before Space accounts); the owner narrows it to team chats
    const go = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: go.endpoint.key, apiKey: SPACE_KEY });
    const spaceRow = ((await ok(d, d.token, "providers.list")).providers as Array<{ id: string; spaceKey?: boolean; uses?: unknown }>).find((p) => p.spaceKey === true)!;
    assert.deepEqual(spaceRow.uses, { teamChats: { who: "everyone" }, automations: true, goals: true, agentWork: { which: "all" } }, "the Space AI key keeps every use");
    await ok(d, d.token, "providers.uses.set", { providerId: spaceRow.id, uses: { teamChats: { who: "everyone" } } });
    // Team credits: shared with the Space, kept for automations, capped at 10.00 a month
    const credits = (await ok(d, d.token, "providers.custom_add", { name: "Team credits", baseUrl: stub.base, apiKey: CREDITS, scope: "shared" })).provider as { id: string; handle: string };
    const kept = (await ok(d, d.token, "providers.uses.set", { providerId: credits.id, uses: { automations: true }, capCents: 1000 })).provider as { uses: unknown; capCents: number; capped: boolean; models: string[] };
    assert.deepEqual([kept.uses, kept.capCents, kept.capped, kept.models], [{ automations: true }, 1000, false, ["claude-sonnet-5-5"]]);
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    const rubab = await join(d, "rubab");
    const sara = await join(d, "sara");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);
    const own = await connectClaude(d, rubab.token, "Rubab_Claude", { spaceUse: false });

    // her chat: her own sign-in
    assert.equal((await ask(d, agentId, rubab, "hello")).reply, `ran for ${rubab.personId} on subscription ${own}`);
    // her automation step: Team credits, not her sign-in and not the team-chats key
    const step = (n: number) => api(d, rubab.token, "engine.step_turn", { prompt: "Sum up the week.", runId: `run_vaultfix${n}`, stepId: `step${n}`, idempotencyKey: `step-${n}` });
    const ran = await step(1);
    assert.equal(ran.status, 200, JSON.stringify(ran.data));
    assert.equal(ran.data.keyUsed, credits.handle);
    // Rubab sees Team credits as a Space account, never its key
    const seen = ((await ok(d, rubab.token, "providers.list")).providers as Array<{ id: string; uses?: unknown }>).find((p) => p.id === credits.id);
    assert.deepEqual(seen?.uses, { automations: true });
    assert.ok(!JSON.stringify(seen).includes(CREDITS));

    // the month's cap reached (a cap of 0): Team credits is skipped; nothing else is kept for automations and her sign-in is not for them, so the step stops and says what is needed
    await ok(d, d.token, "providers.uses.set", { providerId: credits.id, uses: { automations: true }, capCents: 0 });
    const stopped = await step(2);
    assert.notEqual(stopped.status, 200, "the capped account did not run it");
    assert.match(JSON.stringify(stopped.data), /AI account/);

    // "Runs on: Team credits" on the agent: Sara's chat runs there (the pin wins over uses), once the cap is lifted
    await ok(d, d.token, "providers.uses.set", { providerId: credits.id, uses: { automations: true }, capCents: null });
    await ok(d, d.token, "agents.update", { agentId, patch: { accountPolicy: "key", accountKey: credits.handle } });
    assert.equal((await ask(d, agentId, sara, "hello from sara")).reply, `ran for ${sara.personId} on api_key ${credits.handle}`);
    wipe(rubab.personKey); wipe(sara.personKey);
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
