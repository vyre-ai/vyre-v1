// An item an agent makes FOR a person stays that person's through that agent (NEVER LESS), and stays out of reach of another person who asks the same agent. Olivia asks the agent to put a key in a Shared
// folder, then asks for it back; Mia asks the same agent for it. The model is a stand-in that makes the one tool call a message names, through the real tool pipeline on a real kernel.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, listAll, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];
interface Seen {
  asker: string;
  account: string;
  tool: string;
  ok: boolean;
  text: string;
}

test(
  "API engine, two people alternating in one chat: every tool call acts for the person whose turn it is",
  { timeout: 180_000 },
  async () => {
    const seen: Seen[] = [];
    const model: OpenSession = async (spec) => {
      const waiting = new Map<string, (r: { ok: boolean; content: unknown }) => void>();
      let n = 0;
      return {
        warm: true,
        async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
          const body = String(input.trigger?.body ?? "");
          const m = /^(vault_item_put|vault_item_get|vault_items_list) (\{.*\})$/.exec(body);
          if (!m) {
            yield { type: "done" };
            return;
          }
          const run = async function* (
            tool: string,
            args: unknown,
          ): AsyncGenerator<DriverEvent, { ok: boolean; content: unknown }> {
            const id = `c${++n}`;
            const p = new Promise<{ ok: boolean; content: unknown }>((r) => waiting.set(id, r));
            yield { type: "tool_call", id, name: tool, input: args };
            return p;
          };
          yield* run("tool_search", { query: m[1] });
          const r = yield* run(m[1]!, JSON.parse(m[2]!));
          seen.push({
            asker: spec.asker,
            account: spec.account?.ref ?? "",
            tool: m[1]!,
            ok: r.ok,
            text: JSON.stringify(r.content),
          });
          yield { type: "text", text: `${m[1]} done` };
          yield { type: "done" };
        },
        sendToolResult(id: string, r: { ok: boolean; content: unknown }) {
          waiting.get(id)?.(r);
        },
        inject() {},
        async cancel() {},
        async close() {},
      } as EngineSession;
    };
    // providers.add asks the provider whether it accepts the key, with the process's own fetch. Box A has the real internet, which refuses a made-up key (the existing team live tests fail there for this reason);
    // a stand-in answers only that one address.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      String(input).startsWith("https://api.anthropic.com/")
        ? new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5-5" }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        : realFetch(input, init)) as typeof fetch;
    const ownerToken = { v: "" };
    const d: Daemon = await boot(seededDir(), model, {
      vault: undefined,
      session: (headers: Record<string, string | undefined>) => {
        const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
        const id = t === ownerToken.v ? "usr_olivia" : t;
        return WHO.includes(id)
          ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "asker-api" }
          : null;
      },
    });
    ownerToken.v = d.token;
    const api = async (who: string, cap: string, input: unknown): Promise<{ status: number; data: any }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
        body: JSON.stringify(input),
      });
      const b = (await r.json()) as { data?: unknown };
      return { status: r.status, data: b.data ?? b };
    };
    const ok = async (who: string, cap: string, input: Record<string, unknown>): Promise<any> => {
      const r = await api(who, cap, {
        idempotencyKey: `ap-${cap}-${Math.random().toString(36).slice(2, 8)}`,
        ...input,
      });
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
      return r.data;
    }; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      await connect(d); // Olivia's own Claude account, hers alone
      const keys = await ok("usr_olivia", "vault.folders.create", { name: "AI accounts", scope: "shared" });
      const team = await ok("usr_olivia", "providers.add", {
        providerKey: "anthropic",
        connection: "api_key",
        apiKey: `${KEY}T`,
        name: "Team AI",
        scope: "shared",
        folderId: keys.folder.id,
      });
      const teamRef = team.provider.handle as string;
      const agent = (await ok("usr_olivia", "agents.create", { name: "Intake", role: "You check things." })).agent
        .agentId as string;
      const folder = await ok("usr_olivia", "vault.folders.create", { name: "Team keys", scope: "shared" });
      const ch = await ok("usr_olivia", "channels.create", {
        name: "intake",
        visibility: "public",
        memberIds: ["usr_mia"],
        agentIds: [agent],
      });
      const threadId = ch.channel.mainThreadId as string;
      const turn = async (who: string, tool: string, args: unknown): Promise<Seen> => {
        const before = seen.length;
        await ok(who, "chat.post", {
          threadId,
          body: `${tool} ${JSON.stringify(args)}`,
          mentions: [{ kind: "agent", id: agent }],
        });
        return waitFor(
          async () => {
            await d.hooks?.pump?.();
            return seen.length > before ? seen[seen.length - 1]! : null;
          },
          60_000,
          () => hostLog(d),
        );
      };
      const made = await turn("usr_olivia", "vault_item_put", {
        folderId: folder.folder.id,
        name: "Key made for Olivia",
        kind: "api_key",
        fields: [{ key: "api_key", value: "fake-live-value" }],
        idempotencyKey: "live-vault-1",
      });
      assert.equal(made.ok, true, `the agent puts the key for Olivia: ${made.text.slice(0, 300)}`);
      const itemId = /"id":"(vit_[A-Za-z0-9]+)"/.exec(made.text)?.[1];
      assert.ok(itemId, `the item id is in the answer: ${made.text.slice(0, 300)}`);
      const rows: Seen[] = [];
      for (const who of ["usr_olivia", "usr_mia", "usr_olivia", "usr_mia"]) {
        rows.push(await turn(who, "vault_item_get", { itemId }));
      }
      console.log(`VAULT EVIDENCE ${JSON.stringify(rows.map((r) => [r.asker, r.ok, r.text.slice(0, 120)]))}`);
      // side by side: what each person reaches through the agent is what they reach directly (the folder is the Space's, so Mia reaches it either way); Olivia, who asked for it, reaches it through the agent
      for (const r of rows) {
        const direct = (await api(r.asker, "vault.item.get", { itemId })).status === 200;
        assert.equal(r.ok, direct, `${r.asker}: through the agent ${r.ok}, directly ${direct}`);
      }
      assert.ok(rows.filter((r) => r.asker === "usr_olivia").every((r) => r.ok), "Olivia reaches, through the agent, the key it made for her");
    } finally {
      globalThis.fetch = realFetch;
      await stop(d);
    }
  },
);
