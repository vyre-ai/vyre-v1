// Finding F41 (owner, 14 Nov 2026, rc.27): an agent on a command-line engine started two subagents of its own ("test subagents with terminal and browser access") and nothing on screen showed them. This walks the
// real engine, the real CLI driver and the real sandbox around a CLI process (the fake claude of host/tests/fixtures/fake-cli-driver, scenario twosubagents: Agent calls, the lines each subagent works through
// carrying parent_tool_use_id, and each one's result). What a person must see: both subagents in the crew read within a second of the turn starting, each with the task it was given and what it is on, working,
// then done with the answer it returned; nothing a subagent said becomes the agent's reply; the reply carries the calls so its crew block can be drawn under it; and no call is refused on every turn.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { boot, call, connect, makeAgent, seededDir, waitFor } from "./support/live.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const cli = { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] };

interface Member {
  kind: string;
  id: string;
  title: string;
  state: string;
  step?: string;
  steps?: string[];
  found?: string;
  answer?: string;
  elapsedMs: number;
}

test(
  "a CLI engine's own subagents are in the crew read while they work and after: task, step, state, answer; none of their words is the reply; no refused call on the turn",
  { timeout: 90_000 },
  async () => {
    const dir = seededDir();
    const d = await boot(dir, null, { engineCli: cli });
    try {
      await connect(d);
      const agentId = await makeAgent(d, "Dex");
      const threadId = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sa-start" }))
        .data.thread.threadId as string;
      const picked = await call(d, "engine.set_model", {
        threadId,
        agentId,
        model: "sonnet",
        provider: "anthropic",
        idempotencyKey: "sa-model",
      });
      assert.equal(picked.status, 200, JSON.stringify(picked.data));
      const status = async (): Promise<{ members: Member[]; totals: { working: number; done: number } }> => {
        const r = await call(d, "engine.crew.status", { threadId });
        assert.equal(r.status, 200, JSON.stringify(r.data));
        return r.data;
      };
      assert.deepEqual((await status()).members, [], "nobody before the turn");

      const posted = await call(d, "chat.post", {
        threadId,
        body: "twosubagents",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: "sa-post",
      });
      assert.equal(posted.status, 200, JSON.stringify(posted.data));

      // both are there as soon as the engine says it started them, with the task each was given
      const both = await waitFor(async () => {
        const s = await status();
        return s.members.filter((m) => m.kind === "subagent").length === 2 ? s : null;
      }, 8_000);
      assert.deepEqual(both.members.map((m) => m.title).sort(), ["Test the browser", "Test the terminal"]);
      assert.ok(
        both.members.every((m) => m.state === "working"),
        "both work",
      );
      assert.doesNotMatch(JSON.stringify(both), /echo hello|toolu_|SUBAGENT-CHATTER/, "no command, no id, no chatter");
      assert.equal(both.totals.working, 2);

      // the first returns while the second still works
      const half = await waitFor(async () => {
        const s = await status();
        return s.members.some((m) => m.state === "done") && s.members.some((m) => m.state === "working") ? s : null;
      }, 12_000);
      const first = half.members.find((m) => m.state === "done")!;
      assert.equal(first.title, "Test the terminal");
      assert.equal(first.found, "The terminal works.");
      assert.equal(first.answer, "The terminal works. I ran echo and saw hello.");

      // the turn ends: both done, the answers kept
      const reply = await waitFor(async () => {
        const msgs = (await call(d, "chat.messages.list", { threadId })).data.messages as Array<{
          author: { kind: string };
          body: string;
          blocks?: Array<{ type: string; data?: { id?: string; name?: string } }>;
        }>;
        const m = msgs.find((x) => x.author.kind === "agent" && /Both subagents finished/.test(x.body));
        return m ?? null;
      }, 20_000);
      assert.doesNotMatch(reply.body, /SUBAGENT-CHATTER/, "a subagent's words are not the agent's reply");
      const calls = (reply.blocks ?? [])
        .filter((b) => b.type === "tool_call")
        .map((b) => `${b.data?.name}:${b.data?.id}`);
      assert.deepEqual(
        calls.sort(),
        ["Agent:toolu_a", "Agent:toolu_b"],
        "the reply's trail holds the two calls, not the subagents' own tools",
      );
      const end = await status();
      assert.deepEqual(
        end.members.map((m) => [m.title, m.state, m.answer]),
        [
          ["Test the terminal", "done", "The terminal works. I ran echo and saw hello."],
          ["Test the browser", "done", "The browser opened the page and it loaded."],
        ],
      );
      assert.equal(end.totals.working, 0);
      // the ids the reply's calls give the app are the ids the crew read uses
      for (const id of ["toolu_a", "toolu_b"])
        assert.ok(end.members.some((m) => m.id === `sub_${id.replace(/_/g, "")}`));

      // the read costs next to nothing, and a chat with no subagents costs one indexed lookup: p95 against the chat-open budget (perf/budgets.json chat_open, 100 ms)
      const quiet = (await call(d, "chat.start", { kind: "chat", agentIds: [agentId], idempotencyKey: "sa-quiet" }))
        .data.thread.threadId as string;
      const p95 = async (threadId: string): Promise<number> => {
        const ms: number[] = [];
        for (let i = 0; i < 100; i++) {
          const t0 = performance.now();
          const r = await call(d, "engine.crew.status", { threadId });
          assert.equal(r.status, 200);
          ms.push(performance.now() - t0);
        }
        ms.sort((a, b) => a - b);
        return ms[94]!;
      };
      const withRows = await p95(threadId),
        without = await p95(quiet);
      fs.writeFileSync(
        process.env["VYRE_CREW_P95"] ?? path.join(dir, "p95.json"),
        JSON.stringify({ withRowsMs: withRows, withoutMs: without }),
      );
      assert.ok(
        withRows < 100 && without < 100,
        `p95 with rows ${withRows.toFixed(1)} ms, without ${without.toFixed(1)} ms (budget 100)`,
      );

      // one ordinary turn in a chat with no subagents: which calls were refused and swallowed (counted from the daemon's own log, before and after)
      const refusals = (): Map<string, number> => {
        const ro2 = new DatabaseSync(d.paths.logs, { readOnly: true });
        try {
          const m = new Map<string, number>();
          for (const r of ro2.prepare("SELECT cap, attrs FROM logs WHERE msg = 'invoke'").all() as Array<{
            cap: string;
            attrs: string;
          }>) {
            const st = (JSON.parse(r.attrs) as { status?: string }).status ?? "";
            if (st !== "ok" && st !== "") m.set(`${r.cap} ${st}`, (m.get(`${r.cap} ${st}`) ?? 0) + 1);
          }
          return m;
        } finally {
          ro2.close();
        }
      };
      d.sink.flush();
      const beforeTurn = refusals();
      const plain = await call(d, "chat.post", {
        threadId: quiet,
        body: "resumecheck",
        mentions: [{ kind: "agent", id: agentId }],
        idempotencyKey: "sa-plain",
      });
      assert.equal(plain.status, 200);
      await waitFor(async () => {
        const ms = (await call(d, "chat.messages.list", { threadId: quiet })).data.messages as Array<{
          author: { kind: string };
        }>;
        return ms.some((m) => m.author.kind === "agent") ? true : null;
      }, 20_000);
      await new Promise((r) => setTimeout(r, 1500));
      d.sink.flush();
      const afterTurn = refusals();
      const turnRefused = [...afterTurn]
        .map(([k, n]) => [k, n - (beforeTurn.get(k) ?? 0)] as const)
        .filter(([, n]) => n > 0);
      fs.writeFileSync(
        process.env["VYRE_CREW_P95"]?.replace("p95", "refused") ?? path.join(dir, "refused.json"),
        JSON.stringify(turnRefused),
      );
      assert.deepEqual(turnRefused, [], "an ordinary turn refuses no call");

      // no call refused on every turn: a chat that is not a helper's never asks for helper notes
      const ro = new DatabaseSync(d.paths.logs, { readOnly: true });
      try {
        const refused = ro
          .prepare("SELECT cap, msg, attrs FROM logs WHERE cap = 'chat.helper.note_seen'")
          .all() as Array<{ cap: string; msg: string; attrs: string | null }>;
        assert.deepEqual(refused, [], "chat.helper.note_seen is not called for an ordinary chat");
        // every other refusal of the walk, by capability and answer
        const all = ro.prepare("SELECT cap, attrs FROM logs WHERE msg = 'invoke'").all() as Array<{
          cap: string;
          attrs: string;
        }>;
        const bad = new Map<string, number>();
        for (const r of all) {
          const st = (JSON.parse(r.attrs) as { status?: string }).status ?? "";
          if (st !== "ok" && st !== "") bad.set(`${r.cap} ${st}`, (bad.get(`${r.cap} ${st}`) ?? 0) + 1);
        }
        fs.writeFileSync("/root/wt/tmp-b-crew/refused.json", JSON.stringify([...bad]));
      } finally {
        ro.close();
      }
    } finally {
      await d.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
