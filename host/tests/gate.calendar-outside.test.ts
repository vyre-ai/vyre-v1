// An agent's calendar write waits for the person when it invites someone, and when the calendar is connected to an outside service (Google, Outlook), whoever is on it. Vyre's own Personal calendar is the person's own:
// nothing leaves, so nothing waits. A calendar this cannot read holds. A person's own write never waits.
import test from "node:test";
import assert from "node:assert/strict";
import { moduleWhens } from "../src/daemon/gate-hook.ts";

const calendars = [
  { id: "cld_local", provider: "local" },
  { id: "cld_google", provider: "google" },
  { id: "cld_outlook", provider: "microsoft" },
];
const when = (readable = true) => {
  const callAs = async (cap: string, input: unknown): Promise<unknown> => {
    if (!readable) throw new Error("not readable");
    if (cap === "calendar.list_calendars") return { calendars };
    if (cap === "calendar.get_event") {
      const id = (input as { eventId: string }).eventId;
      return { event: { calendarId: id === "cev_g" ? "cld_google" : "cld_local" } };
    }
    return null;
  };
  const out = moduleWhens(
    new Map(),
    () => null,
    async () => null,
    callAs,
  );
  return out["calendar.writes_outside"]!;
};
const agent = { principal: { kind: "agent", id: "agt_a" }, actingFor: "usr_dana" } as never;
const person = { principal: { kind: "person", id: "usr_dana" } } as never;

test("calendar.writes_outside: a person never waits; an agent waits for guests and for an outside calendar, not for the person's own local one", async () => {
  const w = when();
  assert.equal(await w({ calendarId: "cld_google", attendees: [{ email: "a@b.c" }] }, person), false, "a person's own");
  assert.equal(await w({ calendarId: "cld_local", title: "t" }, agent), false, "own calendar, nobody invited");
  assert.equal(await w({ calendarId: "cld_local", attendees: [] }, agent), false, "an empty guest list is nobody");
  assert.equal(await w({ calendarId: "cld_local", attendees: [{ email: "a@b.c" }] }, agent), true, "guests");
  assert.equal(await w({ calendarId: "cld_google", title: "t" }, agent), true, "Google, nobody invited");
  assert.equal(await w({ calendarId: "cld_outlook", title: "t" }, agent), true, "Outlook, nobody invited");
  assert.equal(await w({ eventId: "cev_l", title: "t" }, agent), false, "an event on the local calendar, by its id");
  assert.equal(await w({ eventId: "cev_g", title: "t" }, agent), true, "an event on Google, by its id");
  assert.equal(await w({ calendarId: "cld_unknown" }, agent), true, "a calendar it cannot find holds");
  assert.equal(await when(false)({ calendarId: "cld_local" }, agent), true, "a calendar it cannot read holds");
  assert.equal(
    await w({ calendarId: "cld_local" }, { principal: { kind: "agent", id: "agt_a" } } as never),
    true,
    "no asker holds",
  );
});
