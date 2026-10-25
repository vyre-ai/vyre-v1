// Test harness for the calendar handlers: an in-memory database, a recording ctx, and scripted stand-ins for the capabilities this module calls (mail.mailbox.list for
// member addresses, meetings.ingest for the merge, settings.get for working hours, google.calendar.list_events and ms.calendar.delta for the pull). Every call is checked
// against the frozen input schema of its capability, as the invoke pipeline would. Access is open unless a test denies a resource.
import { registry } from "../../../generated/registry.ts";
import { fail } from "../../../host/src/routes/errors.ts";
import { validate } from "../../../packages/contracts/src/jsonschema.ts";
import { ensure } from "../projections.ts";
import type { CalCtx, Row } from "../projections.ts";
import { memoryDb } from "./memory-db.ts";

export const NOW = 1_760_000_000_000;               // Thursday 9 Oct 2025, 08:53:20 UTC
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Midnight UTC of the day NOW falls on. */
export const DAY0 = Math.floor(NOW / DAY) * DAY;
/** `hh:mm` on day `n` after DAY0, in UTC. */
export const at = (day: number, hh = 0, mm = 0): number => DAY0 + day * DAY + hh * HOUR + mm * MIN;

export interface Emitted { name: string; subject: string; payload: Record<string, unknown>; vis?: string }
export interface Called { cap: string; input: Record<string, unknown> }
export interface Meeting { id: string; startsAt: number; endsAt: number; emails: string[]; joinUrl?: string; sources: string[] }

export interface HarnessOptions {
  principal?: CalCtx["principal"];
  /** member id -> personal mailbox address (what mail.mailbox.list answers for kind personal) */
  members?: Record<string, string>;
  /** Meetings that already exist (a Zoom call a provider announced first) */
  meetings?: Meeting[];
  workingHours?: { days: number[]; from: string; to: string };
  timezone?: string;
}

export function harness(opts: HarnessOptions = {}) {
  const emitted: Emitted[] = [];
  const called: Called[] = [];
  const denied = new Set<string>();
  const members = new Map<string, string>(Object.entries(opts.members ?? { usr_maya01: "maya@vyre.test", usr_omar01: "omar@vyre.test" }));
  const meetings: Meeting[] = (opts.meetings ?? []).map((m) => ({ ...m, emails: [...m.emails], sources: [...m.sources] }));
  const failing = new Set<string>();
  const google: { pages: Record<string, unknown>[]; refuseToken?: boolean } = { pages: [] };
  const graph: { answers: Record<string, unknown>[]; refuseLink?: boolean } = { answers: [] };
  let clock = NOW;
  let serial = 0;

  const ctx: CalCtx = {
    space: "spc_caltest",
    principal: opts.principal ?? { kind: "person", id: "usr_maya01" },
    trace: { traceId: "0123456789abcdef0123456789abcdef" },
    now: () => clock,
    db: memoryDb(),
    emit(name, subject, payload, o) {
      emitted.push({ name, subject, payload: payload as Record<string, unknown>, ...(o?.vis ? { vis: o.vis } : {}) });
      return null;
    },
    authorize(_action, resource) {
      const effect = resource.id && denied.has(`${resource.type}:${resource.id}`) ? "deny" : "allow";
      return { effect, reason: effect === "allow" ? "ok" : "no_grant", decisionId: "dec_caltest01" };
    },
    async call(cap, input) {
      const body = input as Record<string, unknown>;
      called.push({ cap, input: body });
      const misfit = contractErrors(cap, "in", body);
      if (misfit.length) throw new Error(`${cap} was called with input its contract refuses: ${misfit.join("; ")}`);
      const trace = ctx.trace.traceId;
      if (failing.has(cap)) throw fail("internal.unavailable", trace);
      switch (cap) {
        case "mail.mailbox.list":
          return {
            mailboxes: [...members].map(([owner, address]) => ({
              id: `mbx_${owner.slice(4)}`, kind: "personal", address, title: address, ownerId: owner, provider: "google", privacy: "private", state: "syncing",
            })),
          };
        case "settings.get": {
          if (body.key === "profile.working_hours") return { row: { key: body.key, value: opts.workingHours ?? { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } } };
          if (body.key === "profile.timezone") return { row: { key: body.key, value: opts.timezone ?? "UTC" } };
          throw fail("validation.not_found", trace);
        }
        case "meetings.ingest": {
          const emails = ((body.attendees ?? []) as { email: string }[]).map((a) => a.email.toLowerCase());
          const startsAt = Number(body.startsAt);
          const link = typeof body.joinUrl === "string" ? body.joinUrl : undefined;
          const source = String(body.source);
          const same = meetings.find((m) => (link && m.joinUrl === link) || (Math.abs(m.startsAt - startsAt) <= 5 * MIN && m.emails.some((e) => emails.includes(e))));
          if (same) {
            const merged = !same.sources.includes(source);
            if (merged) same.sources.push(source);
            for (const e of emails) if (!same.emails.includes(e)) same.emails.push(e);
            return { meetingId: same.id, created: false, merged };
          }
          const m: Meeting = { id: `rec_meet${++serial}`, startsAt, endsAt: Number(body.endsAt ?? startsAt), emails, sources: [source], ...(link ? { joinUrl: link } : {}) };
          meetings.push(m);
          return { meetingId: m.id, created: true, merged: false };
        }
        case "google.calendar.list_events": {
          if (google.refuseToken && body.syncToken) {
            google.refuseToken = false;
            throw fail("provider.auth_failed", trace);
          }
          const page = google.pages.shift();
          return page ?? { events: [] };
        }
        case "ms.calendar.delta": {
          if (graph.refuseLink && body.deltaLink) {
            graph.refuseLink = false;
            throw fail("provider.auth_failed", trace);
          }
          return graph.answers.shift() ?? { changed: [], removed: [], deltaLink: "delta_empty" };
        }
        default: throw new Error(`unexpected capability ${cap}`);
      }
    },
    log: { info() {}, warn() {} },
  };
  ensure(ctx);

  return {
    ctx, emitted, called, denied, members, meetings, google, graph,
    advance(ms: number) { clock += ms; },
    fail(cap: string, on = true) { if (on) failing.add(cap); else failing.delete(cap); },
    /** The same data seen by another person. */
    as(principal: CalCtx["principal"]): CalCtx { return Object.assign(Object.create(ctx) as CalCtx, { principal }); },
    rows(sql: string, ...args: unknown[]): Row[] { return ctx.db.all(sql, ...args) as Row[]; },
    named(name: string): Emitted[] { return emitted.filter((e) => e.name === name); },
    calls(cap: string): Called[] { return called.filter((c) => c.cap === cap); },
  };
}

export type Harness = ReturnType<typeof harness>;

/** A calendar row without going through calendar.create_calendar: provider calendars come from connections, which this module does not own. */
export function seedCalendar(
  h: Harness, id: string, o: { owner?: string; provider?: "google" | "microsoft" | "local"; personal?: boolean; title?: string; state?: string; connectionId?: string; remoteId?: string } = {},
): string {
  h.ctx.db.run(
    `INSERT INTO calendar_list (id, title, color, provider, "connectionId", "remoteId", "ownerId", personal, state, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, o.title ?? "Work", "#4f6bed", o.provider ?? "local", o.connectionId ?? null, o.remoteId ?? null, o.owner ?? "usr_maya01", o.personal ? 1 : 0, o.state ?? "syncing", 1, NOW, null,
  );
  return id;
}

/** An event row written straight into the table, for tests of reads and availability. */
export function seedEvent(
  h: Harness, id: string, calendarId: string, startsAt: number, endsAt: number,
  o: { title?: string; attendees?: { email: string; response?: string }[]; allDay?: boolean; status?: string; deleted?: boolean } = {},
): string {
  h.ctx.db.run(
    `INSERT INTO calendar_event (id, "calendarId", title, "startsAt", "endsAt", "allDay", location, "joinUrl", "joinProvider", description, agenda, attendees, organizer, "recordIds", "meetingId", "providerId", status, "bookedByAgentId", "fromBookingPage", "deletedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, calendarId, o.title ?? "Busy", startsAt, endsAt, o.allDay ? 1 : 0, null, null, "none", null, null, JSON.stringify(o.attendees ?? []), null, "[]", null, null, o.status ?? "confirmed",
    null, null, null, 1, NOW, o.deleted ? NOW : null,
  );
  return id;
}

/** Errors of a value against the frozen contract of a capability (its input or output schema); empty means it conforms. */
export function contractErrors(cap: string, side: "in" | "out", value: unknown): string[] {
  const def = registry.capabilities.filter((c) => c.name === cap).sort((a, b) => b.v - a.v)[0];
  if (!def) return [`${cap} is not in the registry`];
  return validate(side === "in" ? def.input : def.output, value, "", registry.$defs);
}

/** The error code of a thrown HostError, or "" for anything else. */
export function codeOf(err: unknown): string {
  const shaped = err as { error?: { code?: string } } | null;
  return shaped?.error?.code ?? "";
}
