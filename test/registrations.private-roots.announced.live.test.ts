// The log announces each registration (`resource.created`). Births of a private root (a Personal calendar, a Personal files root, a Mine Vault folder) and of anything under one (an event, a folder in Personal files, a
// Vault item in Mine) are announced to the owner alone: any other person, the Space's owner included, reads no id, type, owner or parent of them through events.list or events.since (the catch-up behind the live subscription).
// What the system builds from the log still receives every one: after a restart the access projection, rebuilt from the log, still lets Noah reach all of it, and what is the Space's is announced to the Space as before.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CORE_SPACE } from "../fixtures/seed/core/index.ts";
import { boot, connect, scriptedModel, seededDir, stop } from "./support/eco-live.ts";
import type { Daemon } from "../host/src/daemon/daemon.ts";

const people = ["usr_olivia", "usr_noah", "usr_sana"];
type As = (who: string, cap: string, input: Record<string, unknown>) => Promise<{ status: number; data: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any

test("private roots and what is under them are announced to their owner alone; the system's own readers still get every one", { timeout: 110_000 }, async () => {
  const dir = seededDir();
  const start = async (): Promise<{ d: Daemon; as: As }> => {
    const token = { v: "" };
    const d = await boot(
      dir,
      scriptedModel(async function* () {}),
      {
        vault: undefined,
        session: (headers: Record<string, string | undefined>) => {
          const t = String(headers["authorization"] ?? "").replace(/^Bearer /, "");
          const id = t === token.v ? "usr_olivia" : t;
          return people.includes(id)
            ? { space: CORE_SPACE, principal: { kind: "person" as const, id }, device: "roots" }
            : null;
        },
      },
    );
    token.v = d.token;
    const as: As = async (who, cap, input) => {
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
  const ok = (r: { status: number; data: unknown }, what: string): any => { // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.status, 200, `${what}: ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const first = await start();
  const mine = { calendar: "", event: "", personalRoot: "", personalFolder: "" };
  // Olivia holds the daemon's own Vault key, so her Mine is the one this test can fill
  const hers = { vaultFolder: "", vaultItem: "" };
  const space = { folder: "", calendar: "" };
  try {
    await connect(first.d);
    const cals = ok(await first.as("usr_noah", "calendar.list_calendars", {}), "calendars");
    mine.calendar = cals.calendars.find((c: { personal?: boolean }) => c.personal).id;
    mine.event = ok(
      await first.as("usr_noah", "calendar.create_event", {
        calendarId: mine.calendar,
        title: "Private dentist",
        startsAt: Date.now() + 86_400_000,
        endsAt: Date.now() + 90_000_000,
      }),
      "event",
    ).event.id;
    const tree = ok(await first.as("usr_noah", "files.tree", {}), "tree");
    mine.personalRoot = tree.roots.find((r: { key: string }) => r.key === "personal").folderId;
    mine.personalFolder = ok(
      await first.as("usr_noah", "files.folder.create", { parentId: mine.personalRoot, name: "Noah private" }),
      "personal folder",
    ).folder.folderId;
    hers.vaultFolder = ok(
      await first.as("usr_olivia", "vault.folders.create", { name: "Olivia mine", scope: "mine" }),
      "mine folder",
    ).folder.id;
    hers.vaultItem = ok(
      await first.as("usr_olivia", "vault.item.put", {
        folderId: hers.vaultFolder,
        name: "olivia key",
        kind: "api_key",
        fields: [{ key: "api_key", value: "v-1" }],
      }),
      "mine item",
    ).item.id;
    // the Space's own: a Space calendar and a folder under People, made by Olivia
    space.calendar = ok(
      await first.as("usr_olivia", "calendar.create_calendar", { title: "Team", personal: false }),
      "team calendar",
    ).calendar.id;
    const people = ok(await first.as("usr_olivia", "files.list", { section: "space" }), "space files").folders.find(
      (f: { name: string }) => f.name === "People",
    ).folderId;
    space.folder = ok(
      await first.as("usr_olivia", "files.folder.create", { parentId: people, name: "Everyone" }),
      "space folder",
    ).folder.folderId;
    const announced = async (who: string): Promise<Set<string>> => {
      const ids = new Set<string>();
      const read = (e: unknown): void => {
        for (const x of e as Array<{ payload: { id?: string } }>) ids.add(String(x.payload.id));
      };
      let cursor: string | undefined;
      for (let pages = 0; pages < 40; pages++) {
        const l = ok(
          await first.as(who, "events.list", { types: ["resource.created"], limit: 500, ...(cursor ? { cursor } : {}) }),
          `events.list as ${who}`,
        );
        read(l.events);
        if (l.next === undefined || l.next === null) break;
        cursor = String(l.next);
      }
      // the catch-up read behind the live subscription
      let after = 0;
      for (let pages = 0; pages < 40; pages++) {
        const s = ok(
          await first.as(who, "events.since", { after, types: ["resource.created"], limit: 1000 }),
          `events.since as ${who}`,
        );
        read(s.events);
        if (typeof s.next !== "number" || s.next <= after) break;
        if (s.head !== undefined && s.next >= s.head) break;
        after = s.next;
      }
      return ids;
    };
    const noah = await announced("usr_noah");
    const olivia = await announced("usr_olivia");
    for (const [what, id] of Object.entries(mine))
      assert.ok(noah.has(id), `Noah reads the announcement of his ${what} (${id})`);
    for (const [what, id] of Object.entries(hers))
      assert.ok(olivia.has(id), `Olivia reads the announcement of her ${what} (${id})`);
    // a stranger to each: the Space's owner and a member for Noah's; two members for Olivia's
    for (const who of ["usr_sana", "usr_olivia", "usr_noah"]) {
      const seen = who === "usr_olivia" ? olivia : who === "usr_noah" ? noah : await announced(who);
      if (who !== "usr_noah")
        for (const [what, id] of Object.entries(mine))
          assert.ok(!seen.has(id), `${who} does not read the announcement of Noah's ${what} (${id})`);
      if (who !== "usr_olivia")
        for (const [what, id] of Object.entries(hers))
          assert.ok(!seen.has(id), `${who} does not read the announcement of Olivia's ${what} (${id})`);
      for (const [what, id] of Object.entries(space))
        assert.ok(seen.has(id), `${who} reads the announcement of the Space's ${what}`);
    }
  } finally {
    await stop(first.d);
  }
  // the system's readers: a restart rebuilds the access projection from the log, and Noah still reaches all of it
  const again = await start();
  try {
    await connect(again.d);
    ok(await again.as("usr_noah", "calendar.get_event", { eventId: mine.event }), "event after a restart");
    const files = ok(await again.as("usr_noah", "files.list", { section: "personal" }), "personal files");
    assert.ok(files.folders.some((f: { folderId: string }) => f.folderId === mine.personalFolder), "his folder in Personal files");
    ok(await again.as("usr_noah", "files.folder.get", { folderId: mine.personalFolder }), "folder get");
    const vault = ok(await again.as("usr_olivia", "vault.items.list", { folderId: hers.vaultFolder }), "Mine items");
    assert.ok(JSON.stringify(vault).includes(hers.vaultItem), "her Vault item in Mine");
    const noahsView = await again.as("usr_noah", "vault.items.list", { folderId: hers.vaultFolder });
    assert.ok(!JSON.stringify(noahsView.data).includes(hers.vaultItem), "and not Noah");
    assert.notEqual((await again.as("usr_sana", "calendar.get_event", { eventId: mine.event })).status, 200);
    assert.notEqual((await again.as("usr_sana", "files.folder.get", { folderId: mine.personalFolder })).status, 200);
  } finally {
    await stop(again.d);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
