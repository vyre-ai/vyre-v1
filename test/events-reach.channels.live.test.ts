// F61, required fix 2: a private channel's name through the event log. `channel.created` carries the channel's name, and a private project's channel is created with the project's title. A plain member and
// an admin who are not in an invite-only channel (and not on a private project) read neither the name nor the id of the channel, nor the project's title, through events.since or events.list; the people inside still do. (The ids of a private project's own record, folder and channel still show in project.created and grant.created, with no name: the advisory the reviewer listed as item 3.)
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let h: Hour;
const people: Record<string, Person> = {};

before(async () => {
  h = await bootHour("private-channel-names");
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const roleNamed = (n: string): string => roles.find((r) => r.name === n)!.id;
  for (const [label, user, role] of [["Aina", "aina", "Member"], ["Cal", "cal", "Member"], ["Ben", "ben", "Member"], ["Zed", "zed", "Admin"]] as const) {
    const p = h.person(label, user, `${user}@firm.test`, `${user} horse battery staple 9`);
    const inv = await h.owner.call("members.invites.create", { role: roleNamed(role), email: p.email });
    await join(h, p, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
    people[label] = p;
  }
});
after(async () => {
  await h.stop();
});

test("a private channel's and a private project's name reach only the people inside", { timeout: 300_000 }, async () => {
  const aina = people["Aina"]!, cal = people["Cal"]!;
  const ch = await aina.call("channels.create", { name: "T-privchan", visibility: "invite", memberIds: [cal.personId], idempotencyKey: "pc-1" });
  const chanId = ch.channel.id as string;
  const pr = await aina.call("projects.create", { type: "project", title: "T-privproject", idempotencyKey: "pc-2" });
  await aina.call("access.audience_set", { resource: { type: "record", id: pr.recordId }, audience: "me" });
  await aina.call("access.audience_set", { resource: { type: "folder", id: pr.folderId }, audience: "me" }).catch(() => undefined);
  for (let i = 0; i < 20; i++) {
    await (h.d as Any).hooks?.pump?.();
    await new Promise((r) => setTimeout(r, 250));
  }
  const read = async (p: Person): Promise<string> => {
    const a = await p.call("events.since", { after: 0, limit: 1000 });
    const b = await p.call("events.list", { limit: 500 });
    return JSON.stringify([a.events, b.events]);
  };
  const outside: string[] = [];
  for (const who of ["Ben", "Zed"]) {
    const text = await read(people[who]!);
    for (const tok of ["T-privchan", "T-privproject", chanId]) if (text.includes(tok)) outside.push(`${who} reads "${tok}"`);
  }
  assert.deepEqual(outside, [], `a member and an admin outside read: ${outside.join("; ")}`);
  const inside = await read(aina);
  assert.ok(inside.includes("T-privchan"), "Aina reads the name of the channel she made");
  assert.ok(inside.includes("T-privproject"), "Aina reads the title of the project she made");
  assert.ok((await read(cal)).includes("T-privchan"), "Cal, a member of the invite-only channel, reads its name");
  // the direct read agrees: the oracle is channels.list
  for (const who of ["Ben", "Zed"]) {
    const l = await people[who]!.call("channels.list", {});
    assert.ok(!JSON.stringify(l).includes("T-privchan"), `${who}: channels.list hides it too`);
  }
});
