// A key an agent asked for is only stored where that agent can use it (15 Nov 2026). The owner typed a key into the card and it went into a Restricted shared folder, where the agent is refused above its
// clearance on every use. The refusal now comes first, from the folder's real label against the agent's real clearance, whatever the folder is called, and nothing is stored. A folder that is not
// restricted is accepted even when it carries a server folder's name. Real chats on a booted Team daemon; only the model is scripted.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const SECRET = "fth_reach_FAKEsecretVALUE0123456789abcdef"; // secret-scan: fake
const WHO = ["usr_olivia", "usr_adam", "usr_mia", "usr_noah"];

const as =
  (d: Daemon) =>
  async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {
    // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
      body: JSON.stringify(input),
    });
    const b = (await r.json()) as { data?: unknown };
    return { status: r.status, data: b.data ?? b };
  };

test("a key for an agent is refused in a Restricted folder of any name, before anything is stored, and goes in a folder the agent can use", async () => {
  const model = scriptedModel(async function* (input, run) {
    const ask = input.trigger?.body ?? "";
    if (/set up fathom/.test(ask)) {
      const r = yield* run("vault_request", {
        name: "Fathom",
        fields: ["api_key"],
        reason: "To read your meetings.",
        idempotencyKey: "reach-ask-fathom",
      });
      yield { type: "text", text: r.ok ? "I asked for the Fathom key." : "FAILED" };
    } else if (/Carry on/.test(ask)) yield { type: "text", text: "Thanks, carrying on with Fathom." };
  });
  // the memory pass reads the account's model list once, which asks the vendor with the key: answer that here
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    String(url) === "https://api.anthropic.com/v1/models"
      ? Promise.resolve(
          new Response(JSON.stringify({ data: [{ id: "claude-haiku-4-5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        )
      : realFetch(url, init)) as typeof fetch;
  const ownerToken = { v: "" };
  const d = await boot(seededDir(), model, {
    vault: undefined,
    session: (headers: Record<string, string | undefined>) => {
      const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
      const id = t === ownerToken.v ? "usr_olivia" : t;
      return WHO.includes(id)
        ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "reach-team" }
        : null;
    },
  });
  ownerToken.v = d.token;
  const api = as(d);
  try {
    await connect(d);
    const agentId = (
      await api("usr_olivia", "agents.create", { name: "Ops", role: "You help the team.", idempotencyKey: "kr-agent" })
    ).data.agent.agentId as string;
    const ai = await api("usr_olivia", "vault.folders.create", {
      idempotencyKey: "kr-ai",
      name: "AI accounts",
      scope: "shared",
    });
    const acct = await api("usr_olivia", "providers.add", {
      idempotencyKey: "kr-acct",
      providerKey: "anthropic",
      connection: "api_key",
      apiKey: `${KEY}A`,
      name: "Team AI",
      scope: "shared",
      folderId: ai.data.folder.id,
    });
    await api("usr_olivia", "agents.update", {
      agentId,
      patch: { accountPolicy: "key", accountKey: acct.data.provider.handle },
      idempotencyKey: "kr-upd",
    });
    // a folder with a name no list holds, labelled Restricted; and an ordinary folder that merely carries a server folder's name
    const hidden = (
      await api("usr_olivia", "vault.folders.create", {
        idempotencyKey: "kr-h",
        name: "Renamed vault",
        scope: "shared",
      })
    ).data.folder.id as string;
    assert.equal(
      (
        await api("usr_olivia", "access.labels.set", {
          resource: { type: "vault_folder", id: hidden },
          label: "restricted",
        })
      ).status,
      200,
    );
    const theirs = (
      await api("usr_olivia", "vault.folders.create", { idempotencyKey: "kr-t", name: "Sign-in", scope: "shared" })
    ).data.folder.id as string;
    const clears = async (folderId: string): Promise<boolean> =>
      (
        await api("usr_olivia", "access.clears", {
          principal: { kind: "agent", id: agentId },
          target: { type: "vault_folder", id: folderId },
        })
      ).data.clears as boolean;
    assert.equal(await clears(hidden), false, "labelled above the agent's clearance, whatever it is called");
    assert.equal(await clears(theirs), true, "a name alone says nothing");

    // a person who may not put a key into the folder (Mia, a member) gets the answer a made-up id gets: nothing tells her the folder is there or how it is labelled
    const real = await api("usr_mia", "access.clears", {
      principal: { kind: "agent", id: agentId },
      target: { type: "vault_folder", id: hidden },
    });
    const made = await api("usr_mia", "access.clears", {
      principal: { kind: "agent", id: agentId },
      target: { type: "vault_folder", id: "vfd_00000000000000000000000000000000" },
    });
    assert.equal(real.status, 404, JSON.stringify(real.data));
    assert.deepEqual(real.data.error?.code, made.data.error?.code);
    assert.equal(real.data.clears, undefined);

    const th = await api("usr_mia", "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "kr-chat" });
    const threadId = th.data.thread.threadId as string;
    await api("usr_mia", "chat.post", {
      threadId,
      body: "set up fathom",
      mentions: [{ kind: "agent", id: agentId }],
      idempotencyKey: "kr-post",
    });
    const card = await waitFor(
      async () => {
        await d.hooks?.pump?.();
        const ms = (await api("usr_mia", "chat.messages.list", { threadId })).data.messages as Array<{
          blocks: Array<{ type: string; data: { requestId?: string } }>;
        }>;
        return ms?.flatMap((m) => m.blocks).find((b) => b.type === "vault_request") ?? null;
      },
      60_000,
      () => hostLog(d),
    );
    const requestId = card.data.requestId as string;
    const itemsBefore = ((await api("usr_olivia", "vault.items.list", {})).data.items as unknown[]).length;
    const refused = await api("usr_olivia", "vault.requests.fulfil", {
      requestId,
      folderId: hidden,
      fields: [{ key: "api_key", value: SECRET }],
    });
    assert.ok(refused.status >= 400 && refused.status < 500, JSON.stringify(refused.data));
    assert.match(
      JSON.stringify(refused.data),
      /That folder is restricted, so the agent that asked cannot use a key kept there/,
    );
    assert.equal(
      ((await api("usr_olivia", "vault.items.list", {})).data.items as unknown[]).length,
      itemsBefore,
      "nothing was stored in any folder",
    );
    assert.equal((await api("usr_olivia", "vault.requests.get", { requestId })).data.request.state, "waiting");
    const done = await api("usr_olivia", "vault.requests.fulfil", {
      requestId,
      folderId: theirs,
      fields: [{ key: "api_key", value: SECRET }],
      audience: "anyone",
    });
    assert.equal(done.status, 200, JSON.stringify(done.data));
    const itemId = done.data.request.itemId as string;
    const holders = (await api("usr_olivia", "access.shares_of", { resource: { type: "vault_item", id: itemId } })).data
      .shares as Array<{ grant: { subject: { kind: string; id: string }; level: string } }>;
    assert.ok(
      holders.some(
        (s) => s.grant.subject.kind === "agent" && s.grant.subject.id === agentId && s.grant.level === "use",
      ),
      "the agent holds Use on a key in a folder it is cleared for",
    );
    assert.ok(!JSON.stringify(refused.data).includes(SECRET));
  } catch (e) {
    console.error("FAILED:", e instanceof Error ? e.message.slice(0, 1500) : e);
    throw e;
  } finally {
    globalThis.fetch = realFetch;
    await stop(d);
  }
});
