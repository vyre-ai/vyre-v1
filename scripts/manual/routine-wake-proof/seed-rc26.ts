// Seeds a data folder with the rc.26 build through the product's own calls. Usage: node test/b-clock-seed.ts <zone> <outdir>
import fs from "node:fs";
import { boot, connect, makeAgent, ok, scriptedModel, seededDir, startChat, stop } from "./support/eco-live.ts";

const [zone, out] = [process.argv[2] ?? "UTC", process.argv[3] ?? "/root/rc26-data"];
let signedIn = false;
const model = scriptedModel(async function* (input) {
  // a goal's turn never ends: its wake stays claimed
  if (input.context?.sections.some((x) => x.id === "goal")) await new Promise<void>(() => {});
  if (!signedIn && /Will pause/.test(String((input as { notice?: string }).notice ?? ""))) {
    yield {
      type: "error",
      code: "engine.signin_missing",
      message: "That account's Vault item has no credentials field. Sign in to it again. [account Claude_Code]",
    };
    return;
  }
  yield { type: "text", text: "ok" };
});
const dir = seededDir();
const d = await boot(dir, model);
try {
  await connect(d);
  await ok(d, "spaces.timezone.set", { timezone: zone, idempotencyKey: "seed-tz" });
  const agent = await makeAgent(d, "Assistant");
  const chat = await startChat(d, agent, "seed");
  await ok(d, "threads.set_mode", { threadId: chat, mode: "auto", idempotencyKey: "seed-mode" });
  const chan = (
    await ok(d, "channels.create", {
      name: "intake",
      visibility: "invite",
      agentIds: [agent],
      idempotencyKey: "seed-chan",
    })
  ).channel as { channelId: string };
  const save = (title: string, cron: string, extra: Record<string, unknown> = {}) =>
    ok(d, "agents.routine.save", {
      agentId: agent,
      title,
      cron,
      prompt: `Do ${title}.`,
      idempotencyKey: `seed-${title}`,
      ...extra,
    });
  await save("Fixed hour", "0 4 * * *");
  await save("Across the change", "30 13 * * *");
  await save("Weekdays", "0 9 * * 1-5", { channelId: chan.channelId });
  await save("Every six hours", "0 */6 * * *");
  await save("Day crossing", "0 22 * * 1");
  await ok(d, "agents.routine.save", {
    agentId: agent,
    title: "Watcher",
    kind: "watch",
    watch: { on: "message", channelId: chan.channelId },
    prompt: "Greet.",
    idempotencyKey: "seed-watch",
  });
  const pausing = (await save("Will pause", "0 5 * * *", { channelId: chan.channelId })).routine as {
    routineId: string;
  };
  const row = async (): Promise<{
    enabled: boolean;
    pausedReason?: string;
    lastRun?: { runId: string; status: string };
  }> =>
    ((await ok(d, "agents.routines.list", { agentId: agent })).routines as Array<any>).find(
      (x) => x.routineId === pausing.routineId,
    );
  for (let i = 1; i <= 3; i++) {
    const run = (
      await ok(d, "agents.routine.run_now", {
        agentId: agent,
        routineId: pausing.routineId,
        idempotencyKey: `seed-now-${i}`,
      })
    ).runId as string;
    for (let k = 0; k < 120; k++) {
      await d.hooks?.pump?.();
      const r = await row();
      if (r.lastRun?.runId === run && r.lastRun.status === "failed") break;
      await new Promise((x) => setTimeout(x, 250));
    }
  }
  await ok(d, "tasks.create", {
    title: "Weekly report",
    assigned: { kind: "agent", id: agent },
    due: Date.now() + 86_400_000,
    recur: { every: "week" },
    idempotencyKey: "seed-task",
  });
  // an automation schedule (it has its own tick, which this build does not move)
  const made = await ok(d, "automations.create", {
    idempotencyKey: "seed-aut",
    name: "Weekday note",
    definition: {
      triggers: [{ key: "schedule", config: { cron: "0 9 * * 1-5", timezone: zone, missed: "skip" } }],
      nodes: [{ id: "note", key: "records.create", input: { type: "note_board", fields: { title: "n" } } }],
    },
  });
  await ok(d, "automations.set_enabled", { automationId: (made.automation as { id: string }).id, enabled: true });
  for (let k = 0; k < 240; k++) {
    await d.hooks?.pump?.();
    if (!(await row()).enabled) break;
    await new Promise((x) => setTimeout(x, 250));
  }
  // goals: the first is woken and its turn never ends (wake claimed); the second is killed with the daemon the moment it is created, between the send and the claim (wake sent)
  const lead = await makeAgent(d, "Lead");
  fs.writeFileSync(`${out}.dir`, dir);
  const goal = (title: string, rhythm: unknown, quiet: unknown) =>
    ok(d, "goals.create", {
      title,
      finish: {
        kind: "number",
        line: "Reach 3",
        target: 3,
        unit: "things",
        source: { kind: "records", type: "contact", label: "things" },
      },
      deadline: Date.now() + 4 * 86_400_000,
      leadAgentId: lead,
      rhythm,
      quiet,
      zone,
      stuckAfter: 2,
      budget: { turns: 60 },
      permissions: [],
      idempotencyKey: `seed-${title}`,
    });
  await goal("Goal six-hourly", { every: "hours", hours: 6 }, { from: "22:00", to: "08:00" });
  const { DatabaseSync } = await import("node:sqlite");
  for (let k = 0; k < 120; k++) {
    await d.hooks?.pump?.();
    const rows = new DatabaseSync(`${dir}/modules.db`, { readOnly: true })
      .prepare("SELECT state FROM goals_wake")
      .all() as { state: string }[];
    if (rows.some((r) => r.state === "claimed")) break;
    await new Promise((x) => setTimeout(x, 250));
  }
  await goal("Goal daily", { every: "day", at: "09:00" }, null);
  process.kill(process.pid, "SIGKILL");
  await new Promise((x) => setTimeout(x, 1500));
  await d.hooks?.pump?.();
} finally {
  await stop(d);
}
fs.cpSync(dir, out, { recursive: true });
console.log("seeded", zone, out);
