// One source for who asked (F51): for the same new turn the engine's recorded asker (engine_turns.asker, read through engine.turn.get) and the person the reply's saved steps are served whole to (chat_message.askedBy)
// are the same person, whether a personal key paid (Olivia, who connected her own Claude account) or a key of the Space did (Mia, who has none). The reply's paidBy field tells the two cases apart.
import test from "node:test";
import assert from "node:assert/strict";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, hostLog, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { DriverEvent, EngineSession, OpenSession, TurnInput } from "../agent/src/turn-engine/types.ts";

const WHO = ["usr_olivia", "usr_mia"];

test(
  "the engine's recorded asker and the reply's asker agree on a personal key and on the Space's key",
  { timeout: 180_000 },
  async () => {
    const model: OpenSession = async () =>
      ({
        warm: true,
        async *send(input: TurnInput): AsyncGenerator<DriverEvent> {
          if (!String(input.trigger?.body ?? "").startsWith("probe")) {
            yield { type: "done" };
            return;
          }
          yield { type: "block", kind: "tool_call", payload: { id: "g1", name: "Grep" } } as DriverEvent;
          yield { type: "block", kind: "tool_result", payload: { id: "g1", ok: true } } as DriverEvent;
          yield { type: "text", text: "Done." };
          yield { type: "done" };
        },
        sendToolResult() {},
        inject() {},
        async cancel() {},
        async close() {},
      }) as unknown as EngineSession;
    // providers.add asks the provider whether it accepts the key; a stand-in answers that one address
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
          ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "asker-recorded" }
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
    let k = 0;
    const ok = async (who: string, cap: string, input: Record<string, unknown>): Promise<any> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await api(who, cap, { idempotencyKey: `ar-${cap}-${++k}`, ...input });
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
      return r.data;
    };
    const frames: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    let ws: WebSocket | undefined;
    try {
      await connect(d); // Olivia's own Claude account, hers alone
      const keys = await ok("usr_olivia", "vault.folders.create", { name: "AI accounts", scope: "shared" });
      await ok("usr_olivia", "providers.add", {
        providerKey: "anthropic",
        connection: "api_key",
        apiKey: `${KEY}T`,
        name: "Team AI",
        scope: "shared",
        folderId: keys.folder.id,
      });
      const agent = (await ok("usr_olivia", "agents.create", { name: "Recorder", role: "You check things." })).agent
        .agentId as string;
      const ch = await ok("usr_olivia", "channels.create", {
        name: "recorded",
        visibility: "public",
        memberIds: ["usr_mia"],
        agentIds: [agent],
      });
      const threadId = ch.channel.mainThreadId as string;
      ws = new WebSocket(`${d.url.replace(/^http/, "ws")}/sync/v1/ws`, {
        headers: { authorization: `Bearer ${d.token}` },
      } as never);
      ws.addEventListener("message", (m) => {
        try {
          frames.push(JSON.parse(String(m.data)));
        } catch {
          /* not json */
        }
      });
      await new Promise<void>((res, rej) => {
        ws!.addEventListener("open", () => res());
        ws!.addEventListener("error", () => rej(new Error("socket")));
      });
      ws.send(
        JSON.stringify({
          t: "hello",
          hello: {
            deviceId: "dev_ar",
            deviceClass: "desktop",
            appVersion: "1.2.3",
            registryHash: "unknown",
            cursor: 0,
            epoch: 0,
            replica: { entities: {} },
          },
        }),
      );
      const rows: Array<{ asker: string; paidBy: unknown; servedWholeTo: string[] }> = [];
      for (const who of WHO) {
        const before = frames.filter((f) => f["t"] === "turn" && f["delta"].kind === "final").length;
        await ok(who, "chat.post", { threadId, body: "probe", mentions: [{ kind: "agent", id: agent }] });
        const fin = await waitFor(
          async () => {
            await d.hooks?.pump?.();
            const f = frames.filter((x) => x["t"] === "turn" && x["delta"].kind === "final");
            return f.length > before ? f[f.length - 1]! : null;
          },
          60_000,
          () => hostLog(d),
        );
        const asker = (await ok(who, "engine.turn.get", { turnId: String(fin["turn"]) })).what.turn.asker as string;
        const th = String(fin["delta"].threadId);
        const served = async (person: string): Promise<{ whole: boolean; paidBy: unknown }> => {
          const got = (await api(person, "chat.messages.list", { threadId: th })).data as {
            messages: Array<{ author: { kind: string }; blocks: unknown[]; paidBy?: unknown }>;
          };
          const reply = got.messages.find((m) => m.author.kind === "agent")!;
          return { whole: JSON.stringify(reply.blocks).includes("Grep"), paidBy: reply.paidBy };
        };
        const wholeTo: string[] = [];
        let paidBy: unknown;
        for (const person of WHO) {
          const s = await served(person);
          if (s.whole) wholeTo.push(person);
          paidBy = s.paidBy;
        }
        rows.push({ asker, paidBy, servedWholeTo: wholeTo });
      }
      // Olivia asked on her own key: the reply says whose account paid; Mia asked on the Space's key: it does not. In both the reply is served whole to the engine's recorded asker and to nobody else.
      assert.equal(rows[0]!.asker, "usr_olivia");
      assert.equal(rows[1]!.asker, "usr_mia");
      assert.ok(rows[0]!.paidBy !== undefined, "a personal key paid for Olivia's turn");
      assert.equal(rows[1]!.paidBy, undefined, "a key of the Space paid for Mia's turn");
      for (const r of rows)
        assert.deepEqual(r.servedWholeTo, [r.asker], `served whole to the recorded asker only: ${JSON.stringify(r)}`);
    } finally {
      ws?.close();
      globalThis.fetch = realFetch;
      await stop(d);
    }
  },
);
