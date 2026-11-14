// @heavy docker
// A goal that was paused and resumed must really wake its lead: after Resume the CLI engine is invoked for the wake and the lead's turn runs (the fake CLI keeps one line per prompt it was sent).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { connect, boot, hostLog, ok, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const FAKE_CLI = fileURLToPath(new URL("../host/tests/fixtures/fake-cli-driver/fake-cli.mjs", import.meta.url));
const skip: string | false =
  process.env["VYRE_HEAVY_DOCKER"] === "1" ? false : "needs VYRE_HEAVY_DOCKER=1 (the CLI runs in the real sandbox)";
const DAY = 86_400_000;

test(
  "goals live (CLI engine): Resume after Pause wakes the lead and the CLI really runs for it",
  { skip, timeout: 240_000 },
  async () => {
    const dir = seededDir();
    const d: Daemon = await boot(dir, undefined as never, {
      engineCli: { command: { claude: [process.execPath, FAKE_CLI, "claude"] }, programRead: [path.dirname(FAKE_CLI)] },
    });
    try {
      await connect(d);
      const lead = (await ok(d, "agents.create", { name: "Dex", role: "You lead goals.", idempotencyKey: "r-dex" }))
        .agent.agentId as string;
      const made = await ok(d, "goals.create", {
        idempotencyKey: "r-goal",
        title: "3 registrations",
        finish: {
          kind: "number",
          line: "reach 3",
          target: 3,
          unit: "registrations",
          source: { kind: "records", type: "contact", label: "r" },
        },
        deadline: Date.now() + 4 * DAY,
        leadAgentId: lead,
        rhythm: { every: "hours", hours: 6 },
        quiet: null,
        zone: "UTC",
        budget: { turns: 60 },
      });
      const goalId = made.goal.id as string;
      // every prompt the fake CLI was sent: one line each, kept under its session
      const prompts = (): number => {
        let n = 0;
        const walk = (p: string): void => {
          let es: fs.Dirent[] = [];
          try {
            es = fs.readdirSync(p, { withFileTypes: true });
          } catch {
            return;
          }
          for (const e of es) {
            const q = path.join(p, e.name);
            if (e.isDirectory()) walk(q);
            else if (q.includes(`${path.sep}.fake-claude${path.sep}sessions${path.sep}`))
              n += fs.readFileSync(q, "utf8").split("\n").length - 1;
          }
        };
        walk(dir);
        return n;
      };
      const wakes = (): Array<{ reason: string; state: string }> =>
        new DatabaseSync(d.paths.modules, { readOnly: true })
          .prepare("SELECT reason, state FROM goals_wake ORDER BY created_at")
          .all() as Array<{ reason: string; state: string }>;
      const queue = (): Array<{ kind: string; state: string }> =>
        new DatabaseSync(d.paths.modules, { readOnly: true })
          .prepare("SELECT kind, state FROM engine_thread_queue ORDER BY qseq")
          .all() as Array<{ kind: string; state: string }>;
      // the start wake runs the CLI (the fake may check in or not: let any second offer settle)
      await waitFor(
        async () => {
          await d.hooks?.pump?.();
          return prompts() >= 1 ? true : null;
        },
        120_000,
        () => `${hostLog(d)} ${JSON.stringify([prompts(), wakes(), queue()])}`,
      );
      for (let i = 0; i < 20; i++) {
        await d.hooks?.pump?.();
        await new Promise((r) => setTimeout(r, 300));
      }
      // the owner talks to the lead in the goal's chat first: the CLI session is warm and has served typed turns
      const threadId = made.goal.threadId as string;
      for (const n of [1, 2]) {
        await ok(d, "chat.post", {
          threadId,
          body: `hello ${n}`,
          mentions: [{ kind: "agent", id: lead }],
          idempotencyKey: `r-hello-${n}`,
        });
        await waitFor(
          async () => {
            await d.hooks?.pump?.();
            return prompts() >= 1 + n ? true : null;
          },
          60_000,
          () => JSON.stringify([prompts(), queue()]),
        );
      }
      for (let i = 0; i < 10; i++) {
        await d.hooks?.pump?.();
        await new Promise((r) => setTimeout(r, 300));
      }
      const before = prompts();
      const queueBefore = queue().length;
      await ok(d, "goals.pause", { goalId });
      await ok(d, "goals.resume", { goalId });
      // Resume queues a wake for the lead; the CLI must be invoked for it
      let after = before;
      for (let i = 0; i < 100 && after === before; i++) {
        await d.hooks?.pump?.();
        await new Promise((r) => setTimeout(r, 300));
        after = prompts();
      }
      const state = JSON.stringify({
        promptsBefore: before,
        promptsAfter: after,
        wakes: wakes(),
        queueBefore,
        queue: queue(),
      });
      assert.ok(after > before, `after Resume the CLI was never invoked for the lead's wake: ${state}`);
    } finally {
      await stop(d);
    }
  },
);
