// Calendar events were not access resources, so calendar.get_event, update_event and delete_event answered "not found" to everyone, the person included. New events are registered when they are made; an event
// that was already in the store (made before) is registered the first time a call names it, inside its calendar and owned by the calendar's owner. A store holding an old event, a restart, and then: the owner can get, change and
// remove it; nobody else can reach it, the Space's owner included (it is Noah's private calendar). The answer to a stranger for a real id is the answer for a made-up id, compared whole (trace id aside).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { boot, seededDir, stop } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";
import type { EngineSession, OpenSession } from "../agent/src/turn-engine/types.ts";

const idle: OpenSession = async () =>
  ({
    warm: true,
    async *send() {
      yield { type: "done" as const };
    },
    sendToolResult() {},
    inject() {},
    async cancel() {},
    async close() {},
  }) as unknown as EngineSession;

test(
  "an event already in the store is registered when first named: the owner gets, changes and removes it, a stranger cannot reach it",
  { timeout: 100_000 },
  async () => {
    const dir = seededDir();
    const people = ["usr_olivia", "usr_noah", "usr_sana"];
    const start = async (): Promise<{
      d: Daemon;
      as: (who: string, cap: string, input: Record<string, unknown>) => Promise<{ status: number; data: any }>;
    }> => {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      const token = { v: "" };
      const d = await boot(dir, idle, {
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
    let first = await start();
    let calendarId = "";
    let teamCalendarId = "";
    let modules = "";
    try {
      const cals = await first.as("usr_noah", "calendar.list_calendars", {});
      assert.equal(cals.status, 200, JSON.stringify(cals.data));
      calendarId = (cals.data.calendars as Array<{ id: string; personal?: boolean }>).find((c) => c.personal)!.id;
      // and a Space calendar, which every member shares
      const team = await first.as("usr_olivia", "calendar.create_calendar", { title: "Team", personal: false });
      assert.equal(team.status, 200, JSON.stringify(team.data));
      teamCalendarId = (team.data.calendar?.id ?? team.data.id) as string;
      modules = first.d.paths.modules;
    } finally {
      await stop(first.d);
    }
    // an event made before events were registered: only a row in the calendar module's table
    const db = new DatabaseSync(modules);
    try {
      db.prepare(
        `INSERT INTO calendar_event (id, "calendarId", title, "startsAt", "endsAt", "allDay", attendees, "recordIds", status, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 0, '[]', '[]', 'confirmed', 1, ?, NULL)`,
      ).run("cev_oldevent0001", calendarId, "Old lunch", Date.now() + 86_400_000, Date.now() + 90_000_000, Date.now());
      db.prepare(
        `INSERT INTO calendar_event (id, "calendarId", title, "startsAt", "endsAt", "allDay", attendees, "recordIds", status, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, 0, '[]', '[]', 'confirmed', 1, ?, NULL)`,
      ).run("cev_oldteam0001", teamCalendarId, "Team sync", Date.now() + 86_400_000, Date.now() + 90_000_000, Date.now());
    } finally {
      db.close();
    }
    const again = await start();
    try {
      // before anything names it: the day view, a search of the calendar and a plain list show the old event (they never depend on registration), and the id from the list opens
      const day = new Date(Date.now() + 86_400_000);
      const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const DAY = 86_400_000;
      for (const [what, input] of [
        ["list (a month)", { calendarIds: [calendarId], from: from - DAY, to: from + 30 * DAY }],
        ["day view", { calendarIds: [calendarId], from, to: from + 2 * DAY }],
        ["search", { calendarIds: [calendarId], from: from - DAY, to: from + 30 * DAY, query: "Old lunch" }],
      ] as const) {
        const listed = await again.as("usr_noah", "calendar.list_events", input);
        assert.equal(listed.status, 200, `${what}: ${JSON.stringify(listed.data)}`);
        const hit = (listed.data.events as Array<{ id: string }>).find((e) => e.id === "cev_oldevent0001");
        assert.ok(hit, `${what} shows the old event`);
      }
      // strangers, before anything registered it: a member and the Space's owner. The event is in Noah's private calendar, so neither reaches it, and each answer is, in every part but its trace id, the answer for an
      // event that does not exist: nothing tells a real id from a made-up one.
      const plain = (r: { status: number; data: unknown }): string =>
        `${r.status} ${JSON.stringify(r.data).replace(/"traceId":"[0-9a-f]+"/g, '"traceId":"-"')}`;
      for (const who of ["usr_sana", "usr_olivia"])
        for (const [cap, extra] of [
          ["calendar.get_event", {}],
          ["calendar.update_event", { title: "mine now" }],
          ["calendar.delete_event", {}],
        ] as const) {
          const real = await again.as(who, cap, { eventId: "cev_oldevent0001", ...extra });
          const madeUp = await again.as(who, cap, { eventId: "cev_neverexisted9", ...extra });
          assert.notEqual(real.status, 200, `${who} ${cap}: refused`);
          assert.equal(plain(real), plain(madeUp), `${who} ${cap}: a real id reads exactly like a made-up one`);
        }
      const stranger = await again.as("usr_sana", "calendar.get_event", { eventId: "cev_oldevent0001" });
      assert.notEqual(stranger.status, 200, "a person with no access to the calendar cannot read it");
      const got = await again.as("usr_noah", "calendar.get_event", { eventId: "cev_oldevent0001" });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      const changed = await again.as("usr_noah", "calendar.update_event", {
        eventId: "cev_oldevent0001",
        title: "Old lunch, moved",
      });
      assert.equal(changed.status, 200, JSON.stringify(changed.data));
      assert.equal(changed.data.event.title, "Old lunch, moved");
      const gone = await again.as("usr_noah", "calendar.delete_event", { eventId: "cev_oldevent0001" });
      assert.equal(gone.status, 200, JSON.stringify(gone.data));
      const strangerEdit = await again.as("usr_sana", "calendar.update_event", {
        eventId: "cev_oldevent0001",
        title: "mine now",
      });
      assert.notEqual(strangerEdit.status, 200, "nor change it");
      // an old event on a Space calendar is the Space's: a member opens it
      const team = await again.as("usr_sana", "calendar.get_event", { eventId: "cev_oldteam0001" });
      assert.equal(team.status, 200, `a member opens an old event on a Space calendar: ${JSON.stringify(team.data)}`);
      // the event log: what announces an event inside Noah's private calendar is Noah's alone to read; a new event of his is the same
      const made = await again.as("usr_noah", "calendar.create_event", {
        calendarId,
        title: "Private dentist",
        startsAt: Date.now() + 120_000_000,
        endsAt: Date.now() + 123_000_000,
      });
      assert.equal(made.status, 200, JSON.stringify(made.data));
      const announced = async (who: string): Promise<string[]> => {
        const l = await again.as(who, "events.list", { types: ["resource.created"], limit: 500 });
        assert.equal(l.status, 200, JSON.stringify(l.data));
        return (l.data.events as Array<{ payload: { id?: string } }>).map((e) => String(e.payload.id));
      };
      const noahSees = await announced("usr_noah");
      const sanaSees = await announced("usr_sana");
      const olivia = await announced("usr_olivia");
      for (const id of [made.data.event.id as string, "cev_oldevent0001"]) {
        assert.ok(noahSees.includes(id), `Noah reads the announcement of ${id}`);
        assert.ok(!sanaSees.includes(id), `a member does not read the announcement of ${id}`);
        assert.ok(!olivia.includes(id), `nor does the Space's owner: ${id}`);
      }
      assert.ok(sanaSees.includes("cev_oldteam0001"), "an event on a Space calendar is announced to the Space");
    } finally {
      await stop(again.d);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
