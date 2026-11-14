// Measurement, not a gate: what a plain member, an admin and a guest RECEIVE about a member's private things, through every door they have (events.list, events.since, the live socket,
// sync.pull, home.activity, notifications.list, search.query, audit.list, logs.query). Aina makes a private calendar and event, a note, a file in Personal files, a Vault item in Mine,
// a private chat with her Assistant and a message in it, a site, an agent, and a record in a list set to "only people added". Each thing carries a title token (T-...) and, where it has content, a content token (C-...).
// Every door is scanned for the token and for the id of what Aina made; the new events are printed with their fields (MEASURE lines). Nothing is asserted but that the doors answer.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { bootHour, invite, join } from "./support/member-hour.ts";
import type { Hour, Person } from "./support/member-hour.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let h: Hour;
let aina: Person;
const watchers: Record<string, Person> = {};
const frames: Record<string, Array<{ act: string; t: string; text: string }>> = {};
const sockets: Array<{ close(): void }> = [];
let current = "setup";

interface Act {
  name: string;
  tokenT?: string;
  tokenC?: string;
  ids: string[];
  note: string;
}
const acts: Act[] = [];
const idsOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (typeof v === "string") {
    if (/^[a-z]{2,6}_[0-9a-f]{8,}/.test(v)) out.add(v);
  } else if (Array.isArray(v)) for (const x of v) idsOf(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) idsOf(x, out);
  return out;
};
const seenSeq: Record<string, number> = {};
const measure = (o: Record<string, unknown>): void => console.log(`MEASURE ${JSON.stringify(o)}`);

async function openSocket(p: Person, label: string): Promise<void> {
  frames[label] = [];
  const ws = new WebSocket(`${h.d.url.replace(/^http/, "ws")}/sync/v1/ws`, {
    headers: { authorization: `Bearer ${p.token}` },
  } as never);
  ws.addEventListener("message", (e) => {
    const text = String(e.data);
    let t = "?";
    try {
      t = String((JSON.parse(text) as { t?: string }).t);
    } catch {
      /* raw */
    }
    frames[label]!.push({ act: current, t, text });
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error("socket did not open")));
  });
  ws.send(
    JSON.stringify({
      t: "hello",
      hello: {
        deviceId: `dev_${label}`,
        deviceClass: "web",
        appVersion: "1.2.3",
        registryHash: "unknown",
        cursor: 0,
        epoch: 0,
        replica: { entities: {} },
      },
    }),
  );
  sockets.push({ close: () => ws.close() });
}

before(async () => {
  h = await bootHour("private-births");
  aina = h.person("Aina", "aina", "aina@firm.test", "aina horse battery staple 9");
  await join(h, aina, await invite(h, aina.email), { device: "web" });
  const roles = (await h.owner.call("access.roles.list")).roles as { id: string; name: string }[];
  const roleNamed = (n: string): string => roles.find((r) => r.name === n)!.id;
  const make = async (label: string, user: string, role: string): Promise<void> => {
    const p = h.person(label, user, `${user}@firm.test`, `${user} horse battery staple 9`);
    const inv = await h.owner.call("members.invites.create", { role: roleNamed(role), email: p.email });
    await join(h, p, decodeURIComponent(new URL(inv.link).pathname.split("/").pop()!), { device: "web" });
    watchers[label] = p;
  };
  await make("Ben", "ben", "Member");
  await make("Zed", "zed", "Admin");
  await make("Gus", "gus", "Guest");
  for (const [label, p] of Object.entries(watchers)) await openSocket(p, label);
  await openSocket(aina, "Aina");
});
after(async () => {
  for (const s of sockets) s.close();
  await h.stop();
});

let startedAt = Date.now() - 1000;
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function newEvents(p: Person, label: string): Promise<Any[]> {
  const r = await p.attempt("events.since", { after: seenSeq[label] ?? 0, limit: 1000 });
  if (!r.ok) return [{ refused: String((r.error as Any)?.code ?? r.error) }];
  seenSeq[label] = r.data.next as number;
  return r.data.events as Any[];
}
const brief = (e: Any): Record<string, unknown> => {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const shown: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) shown[k] = typeof v === "string" ? v.slice(0, 80) : typeof v === "object" ? "{...}" : v;
  return { seq: e.seq, type: e.type, actor: e.actor, subject: e.subject, payload: shown, raw: JSON.stringify(e).slice(0, 900) };
};

async function act(name: string, note: string, tokens: { t?: string; c?: string }, run: () => Promise<unknown>): Promise<void> {
  current = name;
  // everything the watchers had before this act, so only new events are printed
  for (const [label, p] of Object.entries(watchers)) await newEvents(p, label);
  await newEvents(aina, "Aina");
  let out: unknown;
  try {
    out = await run();
  } catch (e) {
    measure({ act: name, failed: String((e as Error).message ?? e).slice(0, 300) });
    out = null;
  }
  await pause(1500);
  const ids = [...idsOf(out)];
  acts.push({ name, ...(tokens.t ? { tokenT: tokens.t } : {}), ...(tokens.c ? { tokenC: tokens.c } : {}), ids, note });
  for (const [label, p] of [["Aina", aina] as const, ...Object.entries(watchers)]) {
    const ev = await newEvents(p, label);
    measure({ act: name, who: label, door: "events.since (new rows)", rows: ev.map(brief) });
  }
  current = "between";
}

test("measure what a member, an admin and a guest receive about Aina's private things", { timeout: 600_000 }, async () => {
  const tree = (await aina.call("files.tree", {})).roots as Array<{ key: string; folderId: string }>;
  const personal = tree.find((r) => r.key === "personal")!.folderId;
  startedAt = Date.now();
  let n = 0;
  const key = (): string => `pb-${++n}`;

  await act("calendar", "a private (personal) calendar, then an event in it", { t: "T-cal", c: "C-cal" }, async () => {
    const cal = await aina.call("calendar.create_calendar", { title: "T-cal", personal: true, idempotencyKey: key() });
    const calId = (cal.calendar.id ?? cal.calendar.calendarId) as string;
    const now = Date.now() + 86_400_000;
    const ev = await aina.call("calendar.create_event", {
      calendarId: calId,
      title: "T-cal event",
      startsAt: now,
      endsAt: now + 3_600_000,
      description: "C-cal description",
      idempotencyKey: key(),
    });
    return { cal, ev };
  });
  await act("note", "a note", { t: "T-note", c: "C-note" }, () => aina.call("notes.create", { title: "T-note", body: "C-note body", idempotencyKey: key() }));
  await act("file", "a file in Personal files", { t: "T-file", c: "C-file" }, () =>
    aina.call("files.create", { folderId: personal, name: "T-file.txt", content: { text: "C-file text" }, idempotencyKey: key() }),
  );
  await act("vault", "a Vault item in Mine", { t: "T-vault", c: "C-vault" }, async () => {
    const mine = (await aina.call("vault.folders.create", { name: "T-vault folder", scope: "mine", idempotencyKey: key() })).folder as { id: string };
    return aina.call("vault.item.put", {
      folderId: mine.id,
      name: "T-vault",
      kind: "note",
      fields: [{ key: "VALUE", value: "C-vault secret", secret: true }],
      idempotencyKey: key(),
    });
  });
  await act("chat", "a private chat with her Assistant and a message in it", { t: "T-chat", c: "C-chat" }, async () => {
    const a = await aina.call("agents.assistant_of", { personId: aina.personId });
    const agentId = (a.agentId ?? h.agentId) as string;
    const started = await aina.call("chat.start", { kind: "chat", agentIds: [agentId], title: "T-chat", idempotencyKey: key() });
    const post = await aina.call("chat.post", { threadId: started.thread.threadId, body: "C-chat message", idempotencyKey: key() });
    return { started, post };
  });
  await act("mailbox", "a private mailbox (a member may not make one: expect a refusal)", { t: "T-mailbox", c: "C-mailbox" }, () =>
    aina.call("mail.mailbox.create", { kind: "shared", address: "t-mailbox@firm.test", title: "T-mailbox", privacy: "private", idempotencyKey: key() }),
  );
  await act("site", "a private site", { t: "T-site", c: "C-site" }, () =>
    aina.call("sites.create", { name: "T-site", access: "private", folderId: personal, idempotencyKey: key() }),
  );
  await act("agent", "a private agent", { t: "T-agent", c: "C-agent" }, () =>
    aina.call("agents.create", { name: "T-agent", role: "C-agent role text", idempotencyKey: key() }),
  );
  // the owner makes a list and opens it to Aina alone (a member cannot make a list); what Aina then does in it is the act
  await h.owner.call("schema.apply", {
      ops: [
        {
          op: "type.create",
          type: "rt_pbx",
          def: {
            title: "T-rectype",
            plural: "T-rectypes",
            icon: "invoice",
            titleField: "name",
            fields: [{ key: "name", type: "text", title: "Name", required: true }],
          },
        },
      ],
      idempotencyKey: key(),
    });
  await h.owner.call("access.audience_set", { resource: { type: "record_type", id: "rt_pbx" }, audience: "added" });
  await h.owner.call("access.share", { resource: { type: "record_type", id: "rt_pbx" }, subject: { kind: "person", id: aina.personId }, level: "edit" });
  await act("record", "a record in a list open to people added, then set to Only me", { t: "T-rec", c: "C-record" }, async () => {
    const rec = await aina.call("records.create", { type: "rt_pbx", fields: { name: "T-rec C-record name" }, idempotencyKey: key() });
    const set = await aina.call("access.audience_set", { resource: { type: "record", id: rec.record.id }, audience: "me" });
    return { rec, set };
  });

  // the other doors, swept once at the end for every act
  current = "sweep";
  for (let i = 0; i < 20; i++) {
    await (h.d as Any).hooks?.pump?.();
    await pause(250);
  }
  const who: Array<[string, Person]> = [["Aina", aina], ...Object.entries(watchers)];
  for (const [label, p] of who) {
    const blobs: Record<string, string> = {};
    const grab = async (door: string, cap: string, input: Record<string, unknown>): Promise<void> => {
      const r = await p.attempt(cap, input);
      blobs[door] = r.ok ? JSON.stringify(r.data) : `REFUSED ${String((r.error as Any)?.code ?? r.error)}`;
    };
    await grab("events.list", "events.list", { limit: 500, from: startedAt });
    await grab("events.since", "events.since", { after: 0, limit: 1000 });
    await grab("home.activity", "home.activity", { since: 0 });
    await grab("notifications.list", "notifications.list", {});
    await grab("audit.list", "audit.list", { limit: 200 });
    await grab("logs.query", "logs.query", { limit: 200 });
    for (const a of acts) {
      if (a.tokenT) await grab(`search:${a.tokenT}`, "search.query", { q: a.tokenT });
      if (a.tokenC) await grab(`search:${a.tokenC}`, "search.query", { q: a.tokenC });
    }
    const pull = await fetch(`${h.d.url}/sync/v1/pull`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${p.token}` },
      body: JSON.stringify({ cursor: 0, epoch: 0, limit: 5000 }),
    });
    blobs["sync.pull"] = `${pull.status} ${await pull.text()}`;
    measure({ who: label, door: "sync.pull body", body: blobs["sync.pull"].slice(0, 600) });
    // the local store's first fill: the snapshot of every entity, rows scoped to the person
    {
      const ents = await p.attempt("sync.entities", { deviceClass: "web" });
      const names = ents.ok ? (ents.data.entities as Any[]).map((e) => String(e.entity)) : [];
      const begin = await p.attempt("sync.snapshot.begin", { entities: names, deviceClass: "web" });
      const rowsOf: Record<string, string> = {};
      if (begin.ok) {
        for (const pl of begin.data.plan as Any[]) {
          let after: string | undefined;
          for (let i = 0; i < 40; i++) {
            const pg = await p.attempt("sync.snapshot.page", { entity: pl.entity, asOf: begin.data.asOfSeq, ...(after ? { after } : {}) });
            if (!pg.ok) {
              rowsOf[pl.entity] = (rowsOf[pl.entity] ?? "") + `PAGE-REFUSED ${String((pg.error as Any)?.code ?? pg.error)}`;
              break;
            }
            rowsOf[pl.entity] = (rowsOf[pl.entity] ?? "") + JSON.stringify(pg.data.rows);
            if (pg.data.done || !pg.data.last) break;
            after = pg.data.last as string;
          }
        }
      }
      blobs["sync.snapshot"] = begin.ok ? Object.values(rowsOf).join("\n") : `REFUSED ${String((begin.error as Any)?.code ?? begin.error)}`;
      const hitsBy: Record<string, string[]> = {};
      for (const a of acts)
        for (const [ent, text] of Object.entries(rowsOf))
          for (const tok of [a.tokenT, a.tokenC].filter(Boolean) as string[]) if (text.includes(tok)) (hitsBy[ent] ??= []).push(tok);
      measure({ who: label, door: "sync.snapshot by entity", begin: begin.ok ? { asOf: begin.data.asOfSeq, plan: begin.data.plan } : String(JSON.stringify(begin.error)).slice(0, 200), entitiesAsked: names.length, rows: Object.fromEntries(Object.entries(rowsOf).map(([k, v]) => [k, v.length])), tokenHits: hitsBy });
    }
    blobs["live socket"] = JSON.stringify((frames[label] ?? []).map((f) => f.text));
    for (const a of acts) {
      const row: Record<string, unknown> = { act: a.name, who: label };
      for (const [door, text] of Object.entries(blobs)) {
        if (door.startsWith("search:") && !door.endsWith(a.tokenT ?? "\0") && !door.endsWith(a.tokenC ?? "\0")) continue;
        const hit = {
          title: a.tokenT ? text.includes(a.tokenT) : false,
          content: a.tokenC ? text.includes(a.tokenC) : false,
          id: a.ids.some((i) => text.includes(i)),
          refused: text.startsWith("REFUSED") ? text.slice(0, 60) : undefined,
        };
        if (hit.title || hit.content || hit.id || hit.refused) row[door] = hit;
      }
      measure({ sweep: true, ...row });
    }
    measure({
      who: label,
      sockets: (frames[label] ?? []).reduce<Record<string, number>>((m, f) => ({ ...m, [f.t]: (m[f.t] ?? 0) + 1 }), {}),
      doorsAnswered: Object.fromEntries(Object.entries(blobs).map(([k, v]) => [k, v.startsWith("REFUSED") ? v.slice(0, 40) : v.length])),
    });
  }
  // what the sync lane holds server-side (the pool every pull and snapshot is cut from): rows per entity, and which of Aina's tokens sit in them
  try {
    const db = new DatabaseSync((h.d as Any).paths.modules, { readOnly: true });
    const rows = db.prepare("SELECT entity, id, owner_id, vis, fields FROM sync_rows").all() as Any[];
    const byEntity: Record<string, number> = {};
    for (const r of rows) byEntity[r.entity] = (byEntity[r.entity] ?? 0) + 1;
    measure({ door: "sync_rows (server pool)", count: rows.length, byEntity, ainas: rows.filter((r) => acts.some((a) => [a.tokenT, a.tokenC].some((t) => t && String(r.fields).includes(t)))).map((r) => ({ entity: r.entity, id: r.id, owner: r.owner_id, vis: r.vis, fields: String(r.fields).slice(0, 200) })) });
    const ch = db.prepare("SELECT COUNT(*) AS n FROM sync_changes").get() as Any;
    measure({ door: "sync_changes", n: ch.n });
    db.close();
  } catch (e) {
    measure({ door: "sync_rows (server pool)", failed: String((e as Error).message) });
  }
  // the birth rows themselves, with every field, as the member sees them
  for (const [label, p] of Object.entries(watchers)) {
    const r = await p.attempt("events.list", { types: ["resource.created"], limit: 1000 });
    if (r.ok) measure({ who: label, door: "events.list resource.created, whole", count: (r.data.events as Any[]).length, sample: (r.data.events as Any[]).slice(-12).map(brief) });
  }
  assert.ok(acts.length > 0);
});
