// An agent's calendar write waits for the person when the calendar is connected to an outside service, also for a calendar connected BEFORE this rule (an old store), and does not wait on the person's own
// Vyre calendar. The hold reads each calendar's provider from the calendar table every time, so no flag has to be backfilled. A store holding a calendar connected to Google, a restart, then an agent adds an event with nobody
// invited to each: the Google one is parked for the person's OK, the local one is made.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { KEY, boot, connect, makeAgent, scriptedModel, seededDir, stop, waitFor } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const people = ["usr_olivia", "usr_sana"];
test(
  "an agent's write to an old Google calendar waits for the person, one to the person's own calendar does not",
  { timeout: 110_000 },
  async () => {
    const dir = seededDir();
    const results: Record<string, boolean> = {};
    const said: Record<string, string> = {};
    const cals = { google: "", local: "" };
    const model = scriptedModel(async function* (input, run) {
      if (!/add the events/.test(input.trigger?.body ?? "")) return;
      yield* run("tool_search", { query: "calendar_create_event" });
      // two Space calendars (an agent works in those through its role; the person's own private Personal one is the made-for-me branch's): the local one first: the Google write parks the turn until the person answers
      for (const [name, id] of [
        ["local", cals.local],
        ["google", cals.google],
      ] as const) {
        const r = yield* run("calendar_create_event", {
          calendarId: id,
          title: `on ${name}`,
          startsAt: Date.now() + 86_400_000,
          endsAt: Date.now() + 90_000_000,
          idempotencyKey: `ow-${name}`,
        });
        results[name] = r.ok;
        said[name] = JSON.stringify(r.content).slice(0, 300);
      }
      yield { type: "text", text: "done" };
    });
    const start = async (
      m = model,
    ): Promise<{
      d: Daemon;
      as: (who: string, cap: string, input: Record<string, unknown>) => Promise<{ status: number; data: any }>;
    }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const token = { v: "" };
      const d = await boot(dir, m, {
        vault: undefined,
        session: (headers: Record<string, string | undefined>) => {
          const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
          const id = t === token.v ? "usr_olivia" : t;
          return people.includes(id)
            ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "cal" }
            : null;
        },
      });
      token.v = d.token;
      const as = async (who: string, cap: string, input: Record<string, unknown>) => {
        const r = await fetch(`${d.url}/v1/${cap.replaceAll(".", "/")}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${who}` },
          body: JSON.stringify({ idempotencyKey: `k-${Math.random().toString(36).slice(2)}`, ...input }),
        });
        const b = (await r.json()) as { data?: unknown };
        return { status: r.status, data: b.data ?? b };
      };
      return { d, as };
    };
    const first = await start();
    let modules = "";
    try {
      const g = await first.as("usr_olivia", "calendar.create_calendar", { title: "Work", personal: false });
      assert.equal(g.status, 200, JSON.stringify(g.data));
      cals.google = (g.data.calendar?.id ?? g.data.id) as string;
      const l = await first.as("usr_olivia", "calendar.create_calendar", { title: "Team", personal: false });
      assert.equal(l.status, 200, JSON.stringify(l.data));
      cals.local = (l.data.calendar?.id ?? l.data.id) as string;
      assert.ok(cals.google && cals.local && cals.google !== cals.local);
      modules = first.d.paths.modules;
    } finally {
      await stop(first.d);
    }
    // the store as it was before: a calendar already connected to Google
    const db = new DatabaseSync(modules);
    try {
      db.prepare(`UPDATE calendar_list SET provider = 'google' WHERE id = ?`).run(cals.google);
    } finally {
      db.close();
    }
    const again = await start();
    try {
      await connect(again.d);
      const agent = await makeAgent(again.d, "Cal");
      const thread = (await again.as("usr_olivia", "chat.start", { kind: "chat", agentIds: [agent] })).data.thread
        .threadId as string;
      await again.as("usr_olivia", "chat.post", {
        threadId: thread,
        body: "add the events",
        mentions: [{ kind: "agent", id: agent }],
      });
      // the local one is made; the Google one is parked as an approval for Olivia
      await waitFor(async () => {
        await again.d.hooks?.pump?.();
        const t = await again.as("usr_olivia", "tasks.list", { scope: "all" });
        return (t.data.tasks as Array<{ title: string; state: string }>).some(
          (x) => /calendar event/.test(x.title) && x.state === "awaiting_approval",
        )
          ? true
          : null;
      }, 60_000);
      const parked = (await again.as("usr_olivia", "tasks.list", { scope: "all" })).data.tasks as Array<{
        blocks?: Array<{ data?: { input?: { title?: string } } }>;
      }>;
      const titles = parked.flatMap((t) => (t.blocks ?? []).map((b) => b.data?.input?.title));
      assert.ok(titles.includes("on google"), `the Google write is parked: ${JSON.stringify(titles)}`);
      assert.ok(!titles.includes("on local"), "the write to her own calendar is not");
      const mine = await again.as("usr_olivia", "calendar.list_events", {
        calendarIds: [cals.local],
        from: Date.now(),
        to: Date.now() + 5 * 86_400_000,
      });
      assert.ok(
        (mine.data.events as Array<{ title: string }>)?.some((e) => e.title === "on local"),
        `and it was made: ${JSON.stringify(mine.data).slice(0, 300)} results=${JSON.stringify(results)} ${JSON.stringify(said)}`,
      );
      assert.equal(results["local"], true);
    } finally {
      await stop(again.d);
      fs.rmSync(dir, { recursive: true, force: true });
      void KEY;
    }
  },
);
