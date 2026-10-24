// Local replica reads for the inbox list and sidebar (spec 3.3).
// Screens read inbox.list_by_contact, inbox.list_by_thread, telephony.call.list,
// inbox.counts, mail.mailbox.list, and calendar.list_calendars. No fetch.

import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import type { FakeReplica } from "../../../../../../client/src/index.ts";
import {
  acceptsCall,
  acceptsContact,
  acceptsThread,
  callModels,
  channelOf,
  contactModels,
  contactNames,
  countCalls,
  countContacts,
  countThreads,
  initialListState,
  showingText,
  sortCalls,
  sortConversations,
  sortThreads,
  threadModels,
  unreadCounts,
  windowOf,
} from "./model.ts";
import type {
  CalendarRow,
  CallRow,
  Conversation,
  FilterCounts,
  ListState,
  MailboxRow,
  NumberRow,
  RowModel,
  ThreadRow,
} from "./model.ts";
import type { VirtualListProps } from "../../../../../../ui/src/VirtualList/props.ts";
import { ROW_HEIGHT, SCROLL_WINDOW } from "./model.ts";

export interface ListLoad {
  phase: "ready" | "loading" | "offline" | "error" | "empty" | "no-match";
  state: ListState;
  showing: string;
  total: number;
  unfiltered: number;
  windowRows: RowModel[];
  counts: FilterCounts;
  virtual: VirtualListProps<RowModel>;
}

const EMPTY_COUNTS: FilterCounts = { email: 0, sms: 0, call: 0, needsMatch: 0, inboxes: [] };

function values(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>, table: string): { id: string }[] {
  return [...(tables.get(table)?.values() ?? [])];
}

function asConversations(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): Conversation[] {
  const out: Conversation[] = [];
  for (const row of values(tables, "conversations")) {
    const record = row as Conversation;
    if (typeof record.displayName !== "string" || typeof record.address !== "string") continue;
    out.push(record);
  }
  return out;
}

function asThreads(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): ThreadRow[] {
  const out: ThreadRow[] = [];
  for (const row of values(tables, "threads")) {
    const record = row as ThreadRow;
    if (typeof record.threadId !== "string") continue;
    out.push(record);
  }
  return out;
}

function asCalls(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): CallRow[] {
  const out: CallRow[] = [];
  for (const row of values(tables, "calls")) {
    const record = row as CallRow;
    if (typeof record.from !== "string" || typeof record.numberId !== "string") continue;
    out.push(record);
  }
  return out;
}

function asMailboxes(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): MailboxRow[] {
  const out: MailboxRow[] = [];
  for (const row of values(tables, "mailboxes")) {
    const record = row as MailboxRow;
    if (typeof record.title !== "string") continue;
    out.push(record);
  }
  return out;
}

function asNumbers(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): NumberRow[] {
  const out: NumberRow[] = [];
  for (const row of values(tables, "numbers")) {
    const record = row as NumberRow;
    if (typeof record.title !== "string") continue;
    out.push(record);
  }
  return out;
}

function asCalendars(tables: ReadonlyMap<string, ReadonlyMap<string, { id: string }>>): CalendarRow[] {
  const out: CalendarRow[] = [];
  for (const row of values(tables, "calendars")) {
    const record = row as CalendarRow;
    if (typeof record.title !== "string" || typeof record.color !== "string") continue;
    out.push(record);
  }
  return out;
}

function field(input: object, key: string): unknown {
  return (input as Record<string, unknown>)[key];
}

function text(input: object, key: string): string | undefined {
  const value = field(input, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stateFrom(input: object, view: ListState["view"]): ListState {
  const state = initialListState();
  state.view = view;
  const channel = channelOf(field(input, "channel"));
  if (channel) state.channel = channel;
  const mailboxId = text(input, "mailboxId");
  if (mailboxId) state.mailboxId = mailboxId;
  const numberId = text(input, "numberId");
  if (numberId) state.numberId = numberId;
  const query = text(input, "query");
  if (query) state.query = query;
  if (field(input, "needsMatch") === true) state.needsMatch = true;
  return state;
}

function publicConversation(row: Conversation): {
  id: string;
  address: string;
  displayName: string;
  lastMessageAt: number;
  lastChannel: Conversation["lastChannel"];
  lastPreview: string;
  unreadCount: number;
  needsMatch: boolean;
  mailboxIds: string[];
  followed: boolean;
  alertOnReplies: boolean;
  contactId?: string;
  ownerId?: string;
  campaignId?: string;
} {
  const out: ReturnType<typeof publicConversation> = {
    id: row.id,
    address: row.address,
    displayName: row.displayName,
    lastMessageAt: row.lastMessageAt,
    lastChannel: row.lastChannel,
    lastPreview: row.lastPreview,
    unreadCount: row.unreadCount,
    needsMatch: row.needsMatch,
    mailboxIds: row.mailboxIds,
    followed: row.followed,
    alertOnReplies: row.alertOnReplies,
  };
  if (row.contactId) out.contactId = row.contactId;
  if (row.ownerId) out.ownerId = row.ownerId;
  if (row.campaignId) out.campaignId = row.campaignId;
  return out;
}

function publicThread(row: ThreadRow): {
  threadId: string;
  channel: ThreadRow["channel"];
  lastAt: number;
  participants: string[];
  unread: number;
  subject?: string;
  mailboxId?: string;
  contactId?: string;
} {
  const out: ReturnType<typeof publicThread> = {
    threadId: row.threadId,
    channel: row.channel,
    lastAt: row.lastAt,
    participants: row.participants,
    unread: row.unread,
  };
  if (row.subject) out.subject = row.subject;
  if (row.mailboxId) out.mailboxId = row.mailboxId;
  if (row.contactId) out.contactId = row.contactId;
  return out;
}

function namesFor(state: ListState, mailboxes: readonly MailboxRow[], numbers: readonly NumberRow[]): { mailbox?: string; number?: string } {
  const names: { mailbox?: string; number?: string } = {};
  if (state.mailboxId) names.mailbox = mailboxes.find((box) => box.id === state.mailboxId)?.title;
  if (state.numberId) names.number = numbers.find((num) => num.id === state.numberId)?.title;
  return names;
}

/** Register the list and sidebar resolvers on one replica. */
export function bindInboxReplica(replica: FakeReplica): void {
  replica.resolve("inbox.list_by_contact", (tables, input) => {
    const state = stateFrom(input, "contact");
    const mailboxes = asMailboxes(tables);
    const numbers = asNumbers(tables);
    const rows = sortConversations(asConversations(tables).filter((row) => acceptsContact(row, state)));
    return {
      rows: rows.map(publicConversation),
      showing: showingText(state, namesFor(state, mailboxes, numbers)),
      total: rows.length,
    };
  });
  replica.resolve("inbox.list_by_thread", (tables, input) => {
    const state = stateFrom(input, "thread");
    const mailboxes = asMailboxes(tables);
    const numbers = asNumbers(tables);
    const threads = sortThreads(asThreads(tables).filter((row) => acceptsThread(row, state)));
    return {
      threads: threads.map(publicThread),
      showing: showingText(state, namesFor(state, mailboxes, numbers)),
      total: threads.length,
    };
  });
  replica.resolve("telephony.call.list", (tables, input) => {
    const state = stateFrom(input, "calls");
    const calls = sortCalls(asCalls(tables).filter((row) => acceptsCall(row, state)));
    return { calls, total: calls.length };
  });
  replica.resolve("inbox.counts", (tables) => {
    const rows = asConversations(tables);
    return unreadCounts(rows, asMailboxes(tables).map((box) => box.id), asNumbers(tables).map((num) => num.id));
  });
  replica.resolve("mail.mailbox.list", (tables) => {
    return { mailboxes: asMailboxes(tables), total: asMailboxes(tables).length };
  });
  replica.resolve("calendar.list_calendars", (tables) => {
    return { calendars: asCalendars(tables) };
  });
}

function inputOf(state: ListState): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (state.channel) input.channel = state.channel;
  if (state.mailboxId) input.mailboxId = state.mailboxId;
  if (state.numberId) input.numberId = state.numberId;
  if (state.query) input.query = state.query;
  if (state.needsMatch) input.needsMatch = true;
  return input;
}

function ready<T>(replica: FakeReplica, cap: "inbox.list_by_contact" | "inbox.list_by_thread" | "telephony.call.list" | "inbox.counts" | "mail.mailbox.list" | "calendar.list_calendars", input: Record<string, unknown>): T | null {
  const snap = liveQuery(replica, cap, input as never).getSnapshot();
  if (snap.status !== "ready") return null;
  return snap.data as T;
}

export function loadList(replica: FakeReplica, state: ListState, override?: "offline" | "error"): ListLoad {
  const blank = blankLoad(state, override === "error" ? "error" : override === "offline" ? "offline" : "loading");
  const input = inputOf(state);
  if (state.view === "calls") {
    const all = ready<{ calls: CallRow[]; total?: number }>(replica, "telephony.call.list", {});
    const filtered = ready<{ calls: CallRow[]; total?: number }>(replica, "telephony.call.list", input);
    const numbers = ready<{ mailboxes: MailboxRow[] }>(replica, "mail.mailbox.list", {});
    const numberRows = readyNumbers(replica);
    if (!all || !filtered || !numbers) return blank;
    const names = contactNames(readyConversations(replica));
    const models = callModels(filtered.calls, names);
    const counts = countCalls(all.calls, numberRows);
    return finish(state, showingForCalls(replica, state), models, all.calls.length, counts, override);
  }
  if (state.view === "thread") {
    const all = ready<{ threads: ThreadRow[]; showing: string; total?: number }>(replica, "inbox.list_by_thread", {});
    const filtered = ready<{ threads: ThreadRow[]; showing: string; total?: number }>(replica, "inbox.list_by_thread", input);
    const mail = ready<{ mailboxes: MailboxRow[] }>(replica, "mail.mailbox.list", {});
    if (!all || !filtered || !mail) return blank;
    const storedAll = mergeThreadFlags(replica, all.threads);
    const storedFiltered = mergeThreadFlags(replica, filtered.threads);
    const models = threadModels(storedFiltered);
    return finish(state, filtered.showing, models, storedAll.length, countThreads(storedAll, mail.mailboxes), override);
  }
  const all = ready<{ rows: Conversation[]; showing: string; total?: number }>(replica, "inbox.list_by_contact", {});
  const filtered = ready<{ rows: Conversation[]; showing: string; total?: number }>(replica, "inbox.list_by_contact", input);
  const mail = ready<{ mailboxes: MailboxRow[] }>(replica, "mail.mailbox.list", {});
  if (!all || !filtered || !mail) return blank;
  const models = contactModels(filtered.rows);
  return finish(state, filtered.showing, models, all.rows.length, countContacts(all.rows, mail.mailboxes), override);
}

function showingForCalls(replica: FakeReplica, state: ListState): string {
  const numbers = readyNumbers(replica);
  const names: { number?: string } = {};
  if (state.numberId) names.number = numbers.find((num) => num.id === state.numberId)?.title;
  return showingText(state, names);
}

function readyNumbers(replica: FakeReplica): NumberRow[] {
  return replica.rows("numbers") as NumberRow[];
}

function readyConversations(replica: FakeReplica): Conversation[] {
  return replica.rows("conversations") as Conversation[];
}

function mergeThreadFlags(replica: FakeReplica, threads: readonly ThreadRow[]): ThreadRow[] {
  const stored = new Map(replica.rows("threads").map((row) => [row.id, row as ThreadRow]));
  return threads.map((row) => {
    const extra = stored.get(row.threadId) ?? stored.get(row.id);
    return { ...row, id: row.threadId, needsMatch: extra?.needsMatch ?? false };
  });
}

function blankLoad(state: ListState, phase: ListLoad["phase"]): ListLoad {
  return {
    phase,
    state,
    showing: showingText(state, {}),
    total: 0,
    unfiltered: 0,
    windowRows: [],
    counts: EMPTY_COUNTS,
    virtual: virtualOf([]),
  };
}

function finish(state: ListState, showing: string, models: RowModel[], unfiltered: number, counts: FilterCounts, override?: "offline" | "error"): ListLoad {
  let phase: ListLoad["phase"] = "ready";
  if (override === "offline") phase = "offline";
  else if (override === "error") phase = "error";
  else if (unfiltered === 0) phase = "empty";
  else if (models.length === 0) phase = "no-match";
  return {
    phase,
    state,
    showing,
    total: models.length,
    unfiltered,
    windowRows: windowOf(models, state.windowStart),
    counts,
    virtual: virtualOf(models, state.windowStart),
  };
}

function virtualOf(rows: readonly RowModel[], start = 0): VirtualListProps<RowModel> {
  const from = Math.max(0, start);
  return {
    data: rows,
    rowHeight: ROW_HEIGHT,
    window: { start: from, end: Math.min(rows.length, from + SCROLL_WINDOW) },
    keyOf: (item) => item.id,
    renderItem: () => "",
  };
}

export function seedConversations(rows: readonly Conversation[], spaceId = "spc_northwind"): FakeReplica {
  const replica = createFakeReplica(spaceId);
  bindInboxReplica(replica);
  replica.put("mailboxes", [mailbox("mbx_work", "Work", "work@example.com", "google", "personal"), mailbox("mbx_support", "Support", "hello@example.com", "imap", "shared")]);
  replica.put("conversations", rows.map((row) => ({ ...row })));
  return replica;
}

export function seedNorthwind(): FakeReplica {
  const replica = createFakeReplica("spc_northwind");
  bindInboxReplica(replica);
  replica.put("mailboxes", [
    mailbox("mbx_work", "Work", "irfad@northwind.example", "google", "personal", "usr_irfad"),
    mailbox("mbx_support", "Support", "hello@northwind.example", "imap", "shared", "usr_irfad"),
  ]);
  replica.put("numbers", [{ id: "num_main", title: "Main", address: "+1 415 555 0100" }]);
  replica.put("calendars", [
    calendar("cld_google", "Work Google", "#4f6bed", "google", false),
    calendar("cld_ms", "Microsoft", "#107C41", "microsoft", false),
    calendar("cld_personal", "Personal", "#C2762B", "local", true),
  ]);
  replica.put("conversations", [
    conversation("cnv_elena", "Elena Rivera", "elena@riveraholdings.example", "email", "The revised terms", 2, false, ["mbx_work"], 1760000004000, "rec_elena"),
    conversation("cnv_priya", "Priya Nair", "priya@nairstudio.example", "sms", "Can we talk tomorrow", 1, false, ["mbx_work"], 1760000003000, "rec_priya"),
    conversation("cnv_webb", "Marcus Webb", "marcus@webbadvisory.example", "email", "Invoice 104", 4, false, ["mbx_support"], 1760000002000, "rec_webb"),
    conversation("cnv_marcus", "Marcus Pruitt", "marcus@pruittco.example", "call", "Missed call", 0, true, ["mbx_support"], 1760000001000),
  ]);
  replica.put("threads", [
    thread("thr_elena", "email", "Revised terms", 1760000004000, ["Elena Rivera"], 2, "mbx_work", "rec_elena", false),
    thread("thr_priya", "sms", "Tomorrow", 1760000003000, ["Priya Nair"], 1, "mbx_work", "rec_priya", false),
    thread("thr_webb", "email", "Invoice 104", 1760000002000, ["Marcus Webb"], 4, "mbx_support", "rec_webb", false),
    thread("thr_marcus", "email", "Unknown sender", 1760000001000, ["marcus@pruittco.example"], 0, "mbx_support", undefined, true),
  ]);
  replica.put("calls", [
    call("cal_elena", "in", "+1 415 555 0161", "+1 415 555 0100", "completed", 1760000004000, "rec_elena"),
    call("cal_marcus", "in", "+1 212 555 0148", "+1 415 555 0100", "missed", 1760000001000),
  ]);
  return replica;
}

export function seedHarbor(): FakeReplica {
  const replica = createFakeReplica("spc_harbor");
  bindInboxReplica(replica);
  replica.put("mailboxes", [mailbox("mbx_studio", "Studio", "ines@harborstudio.example", "google", "personal", "usr_ines")]);
  replica.put("numbers", [{ id: "num_studio", title: "Studio", address: "+1 503 555 0100" }]);
  replica.put("calendars", [
    calendar("cld_h_google", "Work Google", "#3E6FD8", "google", false, "usr_ines"),
    calendar("cld_h_ms", "Microsoft", "#107C41", "microsoft", false, "usr_ines"),
    calendar("cld_h_personal", "Personal", "#B45F3C", "local", true, "usr_ines"),
  ]);
  replica.put("conversations", [
    conversation("cnv_kai", "Kai Moreno", "kai@morenoceramics.example", "email", "Glaze samples", 1, false, ["mbx_studio"], 1760000004000, "rec_kai"),
    conversation("cnv_ruth", "Ruth Abel", "ruth@abeldaughters.example", "sms", "Thursday delivery", 0, false, ["mbx_studio"], 1760000002000, "rec_ruth"),
  ]);
  replica.put("threads", [
    thread("thr_kai", "email", "Glaze samples", 1760000004000, ["Kai Moreno"], 1, "mbx_studio", "rec_kai", false),
  ]);
  replica.put("calls", [
    call("cal_kai", "out", "+1 503 555 0100", "+1 503 555 0172", "completed", 1760000003000, "rec_kai", "num_studio"),
  ]);
  return replica;
}

function mailbox(id: string, title: string, address: string, provider: MailboxRow["provider"], kind: MailboxRow["kind"], ownerId?: string): MailboxRow {
  const row: MailboxRow = { id, kind, address, title, provider, privacy: kind === "shared" ? "space" : "private", state: "syncing" };
  if (ownerId) row.ownerId = ownerId;
  return row;
}

function calendar(id: string, title: string, color: string, provider: CalendarRow["provider"], personal: boolean, ownerId = "usr_irfad"): CalendarRow {
  return { id, title, color, provider, ownerId, personal, state: "syncing" };
}

function conversation(id: string, displayName: string, address: string, lastChannel: Conversation["lastChannel"], lastPreview: string, unreadCount: number, needsMatch: boolean, mailboxIds: string[], lastMessageAt: number, contactId?: string): Conversation {
  const row: Conversation = {
    id,
    address,
    displayName,
    lastMessageAt,
    lastChannel,
    lastPreview,
    unreadCount,
    needsMatch,
    mailboxIds,
    followed: false,
    alertOnReplies: false,
  };
  if (contactId) row.contactId = contactId;
  return row;
}

function thread(id: string, channel: ThreadRow["channel"], subject: string, lastAt: number, participants: string[], unread: number, mailboxId: string, contactId: string | undefined, needsMatch: boolean): ThreadRow {
  const row: ThreadRow = { id, threadId: id, channel, subject, lastAt, participants, unread, mailboxId, needsMatch };
  if (contactId) row.contactId = contactId;
  return row;
}

function call(id: string, direction: CallRow["direction"], from: string, to: string, state: CallRow["state"], startedAt: number, contactId?: string, numberId = "num_main"): CallRow {
  const row: CallRow = { id, numberId, direction, from, to, state, startedAt, hasTranscript: false, consentLogged: false };
  if (contactId) row.contactId = contactId;
  return row;
}
