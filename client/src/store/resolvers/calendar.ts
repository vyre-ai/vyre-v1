// Calendar reads from the replica: calendar.list_calendars and calendar.list_events over calendar_list and calendar_event.
import type { SqlRow } from "../space.ts";
import { resolver } from "./types.ts";
import { flag, json, num, optStr, page, put, rows, str } from "./util.ts";

const CAL = ["calendar", "calendar_event"] as const;

function calendarOut(r: SqlRow): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: str(r["id"]), title: str(r["title"]), color: optStr(r["color"]) ?? "#4f6bed", provider: optStr(r["provider"]) ?? "local",
    ownerId: str(r["ownerId"]), personal: flag(r["personal"]), state: optStr(r["state"]) ?? "syncing",
  };
  put(o, "connectionId", optStr(r["connectionId"]));
  return o;
}

export const listCalendars = resolver<{ scope?: "mine" | "shared" | "all" }, { calendars: Array<Record<string, unknown>> }>({
  cap: "calendar.list_calendars", entities: ["calendar"],
  run(db, input, ctx) {
    const scope = input.scope ?? "all";
    const cond = scope === "mine" ? `AND "ownerId" = ?` : scope === "shared" ? `AND "ownerId" <> ?` : "";
    const rs = rows(db, `SELECT * FROM "calendar_list" WHERE deleted_at IS NULL ${cond} ORDER BY "personal" DESC, "title", "id"`, scope === "all" ? [] : [ctx.person]);
    return { calendars: rs.map(calendarOut) };
  },
});

function eventOut(r: SqlRow): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: str(r["id"]), calendarId: str(r["calendarId"]), title: str(r["title"]), startsAt: num(r["startsAt"]), endsAt: num(r["endsAt"]), allDay: flag(r["allDay"]),
    joinProvider: optStr(r["joinProvider"]) ?? "none", attendees: json(r["attendees"], []), recordIds: json(r["recordIds"], []), status: optStr(r["status"]) ?? "confirmed",
  };
  put(o, "location", optStr(r["location"])); put(o, "joinUrl", optStr(r["joinUrl"])); put(o, "description", optStr(r["description"])); put(o, "agenda", optStr(r["agenda"]));
  put(o, "organizer", optStr(r["organizer"])); put(o, "meetingId", optStr(r["meetingId"])); put(o, "bookedByAgentId", optStr(r["bookedByAgentId"])); put(o, "fromBookingPage", optStr(r["fromBookingPage"]));
  return o;
}

interface EventsIn { from: number; to: number; calendarIds?: string[]; query?: string; cursor?: string; limit?: number }

export const listEvents = resolver<EventsIn, { events: Array<Record<string, unknown>>; next?: string; total?: number }>({
  cap: "calendar.list_events", entities: CAL,
  run(db, input) {
    // an event is in the range when it overlaps it
    const where = [`deleted_at IS NULL`, `"startsAt" < ?`, `"endsAt" > ?`];
    const args: Array<string | number> = [input.to, input.from];
    if (input.calendarIds?.length) { where.push(`"calendarId" IN (${input.calendarIds.map(() => "?").join(",")})`); args.push(...input.calendarIds); }
    if (input.query) { where.push(`("title" LIKE ? OR "location" LIKE ? OR "description" LIKE ?)`); const q = `%${input.query}%`; args.push(q, q, q); }
    const clause = where.join(" AND ");
    const total = num(rows(db, `SELECT COUNT(*) AS n FROM "calendar_event" WHERE ${clause}`, args)[0]?.["n"]);
    const { offset, limit } = page(input.cursor, input.limit, 200);
    const rs = rows(db, `SELECT * FROM "calendar_event" WHERE ${clause} ORDER BY "startsAt", "id" LIMIT ? OFFSET ?`, [...args, limit, offset]);
    const out: { events: Array<Record<string, unknown>>; next?: string; total?: number } = { events: rs.map(eventOut), total };
    if (offset + rs.length < total) out.next = String(offset + rs.length);
    return out;
  },
});
