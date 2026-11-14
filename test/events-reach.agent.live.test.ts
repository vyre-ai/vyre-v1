// Whose turn is it, on the API engine, on a real daemon? Olivia and Mia (one Space, one public channel, one agent, a shared Team AI account) type to the agent in turn. The model is a stand-in that, when
// asked, calls events_since through the real tool pipeline; the test reads who the turn ran for and what the tool call could see. Olivia has a goal;
// Mia has neither and must never see Olivia's, even right after Olivia's turn, and Olivia must still see hers right after Mia's.
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
          const m = /^([a-z_]+) (\{.*\})$/.exec(body);
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
      const ch = await ok("usr_olivia", "channels.create", {
        name: "intake",
        visibility: "public",
        memberIds: ["usr_mia"],
        agentIds: [agent],
      });
      const threadId = ch.channel.mainThreadId as string;
      // Olivia's private things: a file in her Personal files
      const tree = await ok("usr_olivia", "files.tree", {});
      const personal = tree.roots.find((r: { key: string }) => r.key === "personal").folderId as string;
      await ok("usr_olivia", "files.create", {
        folderId: personal,
        name: "T-private-file.txt",
        content: { text: "C-body" },
      });
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
      void listAll;
      void keys;
      void teamRef;
      // F61, the shared agent: Olivia has the agent make her a private chat and a personal calendar,; then Mia asks the same agent for the log. The agent is the maker of the first two, so
      // a rule keyed on the agent would hand Mia their ids; keyed on the person, only Olivia reads them.
      const madeIds = new Set<string>();
      for (const [tool, args] of [
        ["chat_start", { kind: "chat", agentIds: [agent], title: "T-agent-made-chat", idempotencyKey: "ap-made-1" }],
        ["calendar_create_calendar", { title: "T-agent-made-cal", personal: true, idempotencyKey: "ap-made-2" }],
      ] as Array<[string, unknown]>) {
        const made = await turn("usr_olivia", tool, args);
        for (const m of made.text.matchAll(/(thr|cld)_[0-9a-f]{20,}/g)) madeIds.add(m[0]);
      }
      assert.ok(
        madeIds.size >= 2,
        `the agent made a chat and a calendar for Olivia (ids seen: ${[...madeIds].join(",")})`,
      );
      const rows: Seen[] = [];
      for (const who of ["usr_olivia", "usr_mia"]) {
        rows.push(await turn(who, "events_since", { after: 0, limit: 1000 }));
        rows.push(await turn(who, "events_list", { limit: 500 }));
      }
      console.log(
        `AGENT-DOOR ${JSON.stringify(rows.map((r) => [r.asker, r.tool, r.ok, /T-private-file/.test(r.text), r.text.length, r.text.slice(0, 120)]))}`,
      );
      assert.equal(rows.length, 4);
      for (const r of rows) {
        const seenMade = [...madeIds].filter((i) => r.text.includes(i));
        const named = /T-agent-made/.test(r.text);
        if (r.asker === "usr_olivia")
          assert.equal(
            seenMade.length,
            madeIds.size,
            `Olivia's turn with the agent still gets the ids of what it made for her (${r.tool})`,
          );
        else
          assert.deepEqual(
            [seenMade, named],
            [[], false],
            `Mia's ${r.tool} reads nothing of what the same agent made for Olivia`,
          );
      }
      for (const r of rows)
        assert.equal(
          /T-private-file/.test(r.text),
          r.asker === "usr_olivia",
          `${r.asker}'s ${r.tool} ${/T-private-file/.test(r.text) ? "reads" : "does not read"} Olivia's private file name`,
        );
    } finally {
      globalThis.fetch = realFetch;
      await stop(d);
    }
  },
);
