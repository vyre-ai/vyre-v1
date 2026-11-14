// An event about a thing is readable only by someone who can view that thing (F61). A "space" event used to reach every member whatever it was about, so a member read the name, content and
// timing of another member's private things. The read port now resolves each event's subject (the registry's subject of the event type, or the stored one) and drops the event unless the reader
// may view it. An event whose subject is not a resource in the access snapshot keeps its declared visibility. Stored history is covered because the rule runs at read time.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AccessSnapshot } from "../../kernel/src/authorize/index.ts";
import { LogStore } from "../../kernel/src/log/store.ts";
import type { NewEvent } from "../../kernel/src/log/types.ts";
import { createEventLogPort } from "../src/seams/events-ports.ts";

const NOW = 1_760_000_000_000;
const TRACE = "a".repeat(32);
const SUBJECTS: Record<string, { type: string; id: string }> = {
  "file.created": { type: "file", id: "/fileId" },
  "record.created": { type: "record", id: "/recordId" },
  "calendar_event.created": { type: "entity", id: "/eventId" },
  "message.received": { type: "thread", id: "/threadId" },
  "access.changed": { type: "entity", id: "/epoch" },
  "notes.created": { type: "entity", id: "/noteId" },
  "channel.created": { type: "channel", id: "/channelId" },
};

function snapshot(): AccessSnapshot {
  const s = new AccessSnapshot();
  s.putRole({ id: "member", clearance: 1, perms: [], name: "Member" });
  s.putRole({ id: "admin", clearance: 3, perms: ["server.logs"], name: "Admin" });
  for (const id of ["usr_aina", "usr_ben", "usr_zed"]) s.putPrincipal({ id, kind: "person", status: "active" });
  s.putPrincipal({ id: "agt_helper", kind: "agent", owner: "usr_ben", status: "active" });
  s.putPrincipal({ id: "svc_host", kind: "svc", owner: "usr_zed", status: "active" });
  s.addPrincipalRole({ holder: "svc_host", role: "admin" });
  s.addPrincipalRole({ holder: "usr_aina", role: "member" });
  s.addPrincipalRole({ holder: "usr_ben", role: "member" });
  s.addPrincipalRole({ holder: "usr_zed", role: "admin" });
  s.addPrincipalRole({ holder: "agt_helper", role: "member" });
  s.putResource({ id: "spc_1", type: "space", parent_id: null, label: 0, owner_id: null, holds: 0 });
  // the Space is open to its members to view; what Aina cut off from it stays hers
  for (const id of ["usr_aina", "usr_ben", "usr_zed", "agt_helper"])
    s.putGrant({
      id: `grt_${id}`,
      subject_kind: "actor",
      subject_id: id,
      resource_type: "space",
      resource_id: "spc_1",
      level: "view",
    });
  // a shared folder and its file, and Aina's own: cut off from the Space, so only she reaches it
  s.putResource({ id: "fil_shared", type: "file", parent_id: "spc_1", label: 0, owner_id: "usr_aina", holds: 0 });
  s.putResource({
    id: "fil_priv",
    type: "file",
    parent_id: null,
    label: 0,
    owner_id: "usr_aina",
    holds: 0,
    home: "spc_1",
  });
  s.putResource({
    id: "rec_priv",
    type: "record",
    parent_id: null,
    label: 0,
    owner_id: "usr_aina",
    holds: 0,
    home: "spc_1",
  });
  s.putResource({
    id: "cal_priv",
    type: "calendar",
    parent_id: null,
    label: 0,
    owner_id: "usr_aina",
    holds: 0,
    home: "spc_1",
  });
  s.putResource({
    id: "thr_priv",
    type: "thread",
    parent_id: null,
    label: 0,
    owner_id: "usr_aina",
    holds: 0,
    home: "spc_1",
  });
  return s;
}

function ev(o: Partial<NewEvent> & { type: string }): NewEvent {
  return { sv: 1, trace_id: TRACE, actor: "usr_aina", vis: "space", payload: {}, ...o };
}

function world(events: NewEvent[]) {
  const store = new LogStore({ db: new DatabaseSync(":memory:"), space: "spc_1", clock: () => NOW });
  store.appendBatch(events);
  const snap = snapshot();
  const port = createEventLogPort({
    source: { read: (q) => store.read(q), head: () => store.head.seq },
    access: () => snap,
    owner: () => "usr_zed",
    now: () => NOW,
    subjects: (t) => SUBJECTS[t],
  });
  return { port, snap };
}

const log = (): NewEvent[] => [
  ev({
    type: "file.created",
    entity: "file",
    entity_id: "fil_shared",
    payload: { fileId: "fil_shared", name: "Shared.md" },
  }),
  ev({
    type: "file.created",
    entity: "file",
    entity_id: "fil_priv",
    payload: { fileId: "fil_priv", name: "T-private.txt" },
  }),
  // a stored subject missing: the registry's pointer finds it in the payload
  ev({ type: "record.created", payload: { recordId: "rec_priv", fields: { name: "C-secret" } } }),
  // an event whose registry subject is an "entity": its calendar is what decides
  ev({ type: "calendar_event.created", payload: { eventId: "cev_1", calendarId: "cal_priv", startsAt: 1 } }),
  ev({ type: "message.received", payload: { threadId: "thr_priv", messageId: "msg_1" } }),
  // a birth record names the thing it registers
  ev({
    type: "resource.created",
    payload: { id: "cal_priv", type: "calendar", owner_id: "usr_aina", parent_id: null, label: 0, holds: 0 },
  }),
  ev({
    type: "resource.created",
    payload: { id: "fil_shared", type: "file", owner_id: "usr_aina", parent_id: "spc_1", label: 0, holds: 0 },
  }),
  // not a resource in the snapshot, or no resource subject: declared visibility stands
  ev({ type: "access.changed", payload: { epoch: 5 } }),
  ev({ type: "notes.created", payload: { noteId: "nte_1" } }),
  ev({
    type: "file.created",
    entity: "file",
    entity_id: "fil_unknown",
    payload: { fileId: "fil_unknown", name: "Not registered" },
  }),
];

const names = (r: { events: { payload: unknown }[] }): string[] => r.events.map((e) => JSON.stringify(e.payload));

test("reach: a member reads events about shared things, not about another member's private ones", async () => {
  const w = world(log());
  for (const read of [(c: { principal: string }) => w.port.list(c), (c: { principal: string }) => w.port.since(c, 0)]) {
    const ben = await read({ principal: "usr_ben" });
    const text = names(ben).join("\n");
    assert.match(text, /Shared\.md/, "an event about a shared file is read");
    assert.doesNotMatch(
      text,
      /T-private|C-secret|cal_priv|thr_priv|cev_1|msg_1/,
      `Ben reads nothing about Aina's private things: ${text}`,
    );
    assert.match(text, /"epoch":5/, "an event about no resource keeps its declared visibility");
    assert.match(text, /nte_1/, "an event about a note (an entity subject) keeps its visibility");
    assert.match(text, /Not registered/, "a subject that is no resource in the snapshot keeps its visibility");
    const aina = await read({ principal: "usr_aina" });
    assert.match(
      names(aina).join("\n"),
      /T-private[\s\S]*C-secret[\s\S]*cev_1[\s\S]*msg_1[\s\S]*cal_priv/,
      "the person who owns them reads all of them",
    );
  }
});

test("reach: an admin keeps no names or content of a private thing through the event log; an agent reads as the person it acts for", async () => {
  const w = world(log());
  const zed = names(await w.port.list({ principal: "usr_zed" })).join("\n");
  assert.doesNotMatch(zed, /T-private|C-secret|cal_priv|thr_priv|cev_1/);
  const asBen = names(await w.port.list({ principal: "agt_helper", actingFor: "usr_ben" })).join("\n");
  assert.doesNotMatch(asBen, /T-private|C-secret|cal_priv|thr_priv|cev_1/);
  assert.match(asBen, /Shared\.md/);
});

test("reach: get and a subject filter obey the same rule, and the page cursor still moves past hidden events", async () => {
  const w = world(log());
  const all = await w.port.list({ principal: "usr_aina" });
  const privId = all.events.find((e) => JSON.stringify(e.payload).includes("T-private"))!.id;
  assert.equal(
    await w.port.get({ principal: "usr_ben" }, privId),
    null,
    "an event the reader may not see looks like no event",
  );
  assert.ok(await w.port.get({ principal: "usr_aina" }, privId));
  const bySubject = await w.port.list({ principal: "usr_ben" }, { subject: { type: "file", id: "fil_priv" } });
  assert.equal(bySubject.events.length, 0);
  const small = await w.port.since({ principal: "usr_ben" }, 0, { limit: 1 });
  assert.equal(small.events.length, 1);
  assert.ok(small.next >= 1);
});

test("reach: a thing whose privacy its module decides (a chat's readers) is asked once per call, after the kernel allows", async () => {
  const store = new LogStore({ db: new DatabaseSync(":memory:"), space: "spc_1", clock: () => NOW });
  const snap = snapshot();
  // the kernel lets every member view a thread; only the chat module knows who reads this one
  snap.putResource({ id: "thr_dm", type: "thread", parent_id: "spc_1", label: 0, owner_id: "usr_aina", holds: 0 });
  store.appendBatch(
    ["a", "b", "c"].map((m) =>
      ev({
        type: "message.received",
        payload: { threadId: "thr_dm", messageId: `msg_${m}`, body: "never in an event" },
      }),
    ),
  );
  const asked: string[] = [];
  const port = createEventLogPort({
    source: { read: (q) => store.read(q), head: () => store.head.seq },
    access: () => snap,
    owner: () => "usr_zed",
    now: () => NOW,
    subjects: (t) => SUBJECTS[t],
    moduleView: async (person, type, id) => {
      asked.push(`${person}:${type}:${id}`);
      return type === "thread" ? person === "usr_aina" : undefined;
    },
  });
  assert.equal((await port.list({ principal: "usr_ben" })).events.length, 0);
  assert.deepEqual(asked, ["usr_ben:thread:thr_dm"], "three events, one question");
  assert.equal(
    (await port.list({ principal: "usr_aina" })).events.length,
    3,
    "her own events are not asked about at all",
  );
});

test("reach: the host itself (a scheduler matching a wait, a hook) reads what it builds state from: the rule is for people and the agents that act for them", async () => {
  const w = world(log());
  const asHost = names(await w.port.list({ principal: "svc_host", system: true })).join("\n");
  assert.match(asHost, /T-private[\s\S]*C-secret[\s\S]*cev_1[\s\S]*msg_1/);
  const notHost = names(await w.port.list({ principal: "svc_host" })).join("\n");
  assert.doesNotMatch(notHost, /T-private|C-secret/, "a service that is not marked the host reads as its owner would");
});

test("reach: an agent acting for Mia does not keep what the same agent made for Olivia (F61, the shared agent); the person it was made for does, and a person keeps what they made", async () => {
  // aina is Olivia, ben is Mia; agt_helper is the one agent both of them ask
  const made = [
    ev({
      type: "file.created",
      actor: "agt_helper",
      on_behalf: "usr_aina",
      entity: "file",
      entity_id: "fil_priv",
      payload: { fileId: "fil_priv", name: "T-by-agent.txt" },
    }),
    ev({
      type: "resource.created",
      actor: "agt_helper",
      on_behalf: "usr_aina",
      payload: { id: "cal_priv", type: "calendar", owner_id: "usr_aina", parent_id: null, label: 0, holds: 0 },
    }),
    ev({
      type: "message.received",
      actor: "agt_helper",
      on_behalf: "usr_aina",
      vis: "private",
      payload: { threadId: "thr_priv", messageId: "msg_agent" },
    }),
    ev({
      type: "file.created",
      actor: "usr_ben",
      entity: "file",
      entity_id: "fil_benmade",
      payload: { fileId: "fil_benmade", name: "Ben-made.txt" },
    }),
  ];
  const w = world(made);
  w.snap.putResource({
    id: "fil_benmade",
    type: "file",
    parent_id: null,
    label: 0,
    owner_id: "usr_ben",
    holds: 0,
    home: "spc_1",
  });
  const text = async (c: { principal: string; actingFor?: string }): Promise<string> =>
    [...names(await w.port.list(c)), ...names(await w.port.since(c, 0))].join("\n");
  const miaViaAgent = await text({ principal: "agt_helper", actingFor: "usr_ben" });
  assert.doesNotMatch(
    miaViaAgent,
    /T-by-agent|cal_priv|fil_priv|thr_priv|msg_agent/,
    `Mia's agent reads nothing the agent made for Olivia: ${miaViaAgent}`,
  );
  assert.match(miaViaAgent, /Ben-made/, "what Mia herself made she keeps, through her agent too");
  const oliviaViaAgent = await text({ principal: "agt_helper", actingFor: "usr_aina" });
  assert.match(
    oliviaViaAgent,
    /T-by-agent[\s\S]*cal_priv[\s\S]*msg_agent/,
    "Olivia's own turn with the agent still gets hers",
  );
  assert.match(await text({ principal: "usr_aina" }), /T-by-agent/, "Olivia herself reads what was made for her");
  assert.match(
    await text({ principal: "usr_ben" }),
    /Ben-made/,
    "a person keeps the events of what they made themselves",
  );
  assert.equal(
    await w.port.get(
      { principal: "agt_helper", actingFor: "usr_ben" },
      (await w.port.list({ principal: "usr_aina" })).events[0]!.id,
    ),
    null,
  );
});

test("reach: a private channel's name (and a private project's, its channel carries the title) is read only by someone the chat module lets read it", async () => {
  const store = new LogStore({ db: new DatabaseSync(":memory:"), space: "spc_1", clock: () => NOW });
  const snap = snapshot();
  // the kernel lets every member view the channel; the chat module decides who reads an invite-only one
  snap.putResource({ id: "chn_priv", type: "channel", parent_id: "spc_1", label: 0, owner_id: "usr_aina", holds: 0 });
  store.appendBatch([
    ev({
      type: "channel.created",
      entity: "channel",
      entity_id: "chn_priv",
      payload: { channelId: "chn_priv", name: "T-privchan", visibility: "invite" },
    }),
    ev({
      type: "resource.created",
      payload: { id: "chn_priv", type: "channel", owner_id: "usr_aina", parent_id: "spc_1", label: 0, holds: 0 },
    }),
  ]);
  const asked: string[] = [];
  const port = createEventLogPort({
    source: { read: (q) => store.read(q), head: () => store.head.seq },
    access: () => snap,
    owner: () => "usr_zed",
    now: () => NOW,
    subjects: (t) => SUBJECTS[t],
    moduleView: async (person, type, id) => {
      asked.push(`${person}:${type}:${id}`);
      return type === "channel" ? person === "usr_aina" || person === "usr_cal" : undefined;
    },
  });
  for (const who of ["usr_ben", "usr_zed"]) {
    const r = names(await port.since({ principal: who }, 0)).join("\n");
    assert.doesNotMatch(
      r,
      /T-privchan|chn_priv/,
      `${who} reads neither the name nor the id of a channel they are not in: ${r}`,
    );
  }
  assert.match(names(await port.since({ principal: "usr_aina" }, 0)).join("\n"), /T-privchan/);
  assert.ok(asked.includes("usr_ben:channel:chn_priv"), "the chat module was asked as the reader");
});
