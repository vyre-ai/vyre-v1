// A member's own Claude sign-in answers their own turns on a Team Space server with nothing else to turn on (owner ruling 3 Nov: members' Mine sign-ins live on the server, sealed, and pay for
// their own turns). A booted server-role daemon, two members with real key bundles, a channel the owner made with both of them and an agent. Rubab signs in with Claude (a fake sign-in, saved as
// the app saves it: "Let the Space run work on my subscription" off) and her message in the channel runs on it. Sara has no account and runs on the Space AI key; she never reaches Rubab's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wipe } from "../client/src/crypto/keys.ts";
import { boot, hostLog, seededDir, waitFor } from "./memory-live-kit.ts";
import { SPACE_KEY, api, connectClaude, door, join, ok, standIn, vendor } from "./member-key-kit.ts";

test("Team server channel: a member's own Claude sign-in answers her message with the Space switch off; the other member runs on the Space AI key", async () => {
  const stub = await vendor();
  const dir = seededDir();
  const d = await boot(dir, standIn, undefined, { vault: undefined } as unknown as NonNullable<Parameters<typeof boot>[3]>);
  try {
    assert.equal((await fetch(`${d.url}/local/vault/key/unlock`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${d.token}` }, body: JSON.stringify({ key: Buffer.alloc(32, 3).toString("base64") }) })).status, 204);
    const ep = await ok(d, d.token, "providers.custom_add", { name: "Stub Go", baseUrl: stub.base, apiKey: SPACE_KEY, scope: "mine" });
    await ok(d, d.token, "providers.space_key.set", { providerKey: ep.endpoint.key, apiKey: SPACE_KEY });
    const agentId = (await ok(d, d.token, "agents.create", { name: "Spark", role: "You help the team." })).agent.agentId as string;

    const rubab = await join(d, "rubab");
    const sara = await join(d, "sara");
    assert.equal((await door(d, rubab.token, "unlock", rubab.personKey)).status, 204);

    // her sign-in, exactly as the app saves it: the switch is left off
    const ref = await connectClaude(d, rubab.token, "Rubab_Claude", { spaceUse: false });
    const listed = ((await ok(d, rubab.token, "providers.list")).providers as Array<{ handle?: string; spaceMayUse: boolean }>).find((p) => p.handle === ref);
    assert.equal(listed?.spaceMayUse, false, "nothing turned the switch on");

    const ch = (await ok(d, d.token, "channels.create", { name: "team", visibility: "invite", memberIds: [rubab.personId, sara.personId], agentIds: [agentId] })).channel as { mainThreadId: string };
    const threadId = ch.mainThreadId;
    const replyTo = async (who: { token: string }, body: string): Promise<string> => {
      const before = ((await ok(d, who.token, "chat.messages.list", { threadId })).messages as Array<{ messageId: string }>).map((m) => m.messageId);
      await ok(d, who.token, "chat.post", { threadId, body, mentions: [{ kind: "agent", id: agentId }] });
      let seen: unknown = null;
      return waitFor(async () => {
        await d.hooks?.pump?.();
        const ms = (await api(d, who.token, "chat.messages.list", { threadId })).data.messages as Array<{ messageId: string; author?: { kind?: string; id?: string }; body?: string }> | undefined;
        seen = ms;
        return ms?.find((m) => !before.includes(m.messageId) && (m.author?.kind === "agent" || m.author?.id === agentId) && (m.body ?? "") !== "")?.body ?? null;
      }, 40_000, () => `${JSON.stringify(seen).slice(0, 3000)}\n${hostLog(d)}`);
    };

    assert.equal(await replyTo(rubab, "hello from rubab"), `ran for ${rubab.personId} on subscription ${ref}`, "her own sign-in answered, with no extra switch");
    assert.equal(await replyTo(sara, "hello from sara"), `ran for ${sara.personId} on the space key`, "Sara never runs on Rubab's sign-in");
    wipe(rubab.personKey); wipe(sara.personKey);
  } finally {
    await d.stop();
    await stub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
