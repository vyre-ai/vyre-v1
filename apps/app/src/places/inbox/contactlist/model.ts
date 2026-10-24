// Inbox list model (spec 3.3). Views, filters, counts, and the virtual window.
// Header menus carry checkmarks and counts. The list does not render pill chips.

export const ROW_HEIGHT = 44;
export const SCROLL_WINDOW = 24;
/** ARCH 9 scroll row: p95 frame under 16.7 ms. perf/budgets.json is not in this tree. */
export const SCROLL_FRAME_BUDGET_MS = 16.7;
export const SKELETON_ROWS = 8;

export type InboxView = "contact" | "thread" | "calls";
export type Channel = "email" | "sms" | "call";
export type LastChannel = Channel | "meeting";

export interface ListState {
  view: InboxView;
  needsMatch: boolean;
  windowStart: number;
  channel?: Channel;
  mailboxId?: string;
  numberId?: string;
  query?: string;
  selectedId?: string;
}

export interface Conversation {
  id: string;
  address: string;
  displayName: string;
  lastMessageAt: number;
  lastChannel: LastChannel;
  lastPreview: string;
  unreadCount: number;
  needsMatch: boolean;
  mailboxIds: string[];
  followed: boolean;
  alertOnReplies: boolean;
  contactId?: string;
  ownerId?: string;
  campaignId?: string;
  numberIds?: string[];
}

export interface ThreadRow {
  id: string;
  threadId: string;
  channel: Channel;
  lastAt: number;
  participants: string[];
  unread: number;
  needsMatch: boolean;
  subject?: string;
  mailboxId?: string;
  contactId?: string;
}

export interface CallRow {
  id: string;
  numberId: string;
  direction: "in" | "out";
  from: string;
  to: string;
  state: "ringing" | "answered" | "voicemail" | "completed" | "missed" | "failed";
  startedAt: number;
  hasTranscript: boolean;
  consentLogged: boolean;
  contactId?: string;
  durationSec?: number;
}

export interface MailboxRow {
  id: string;
  kind: "personal" | "shared" | "agent" | "service";
  address: string;
  title: string;
  provider: "google" | "microsoft" | "imap" | "inbound_only";
  privacy: "private" | "space" | "people";
  state: "pending" | "syncing" | "paused" | "error" | "disconnected";
  ownerId?: string;
}

export interface NumberRow {
  id: string;
  title: string;
  address: string;
}

export interface CalendarRow {
  id: string;
  title: string;
  color: string;
  provider: "google" | "microsoft" | "local";
  ownerId: string;
  personal: boolean;
  state: "syncing" | "paused" | "error";
}

export interface InboxCount {
  kind: "mailbox" | "number";
  id: string;
  unread: number;
}

export interface FilterChoice {
  id: string;
  title: string;
  count: number;
}

export interface FilterCounts {
  email: number;
  sms: number;
  call: number;
  needsMatch: number;
  inboxes: FilterChoice[];
}

export interface RowModel {
  id: string;
  title: string;
  note: string;
  conversationId?: string;
  contactId?: string;
}

export interface Prefetch {
  screenId: "inbox.contact-tab";
  conversationId?: string;
  contactId?: string;
}

export function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function initialListState(): ListState {
  return { view: "contact", needsMatch: false, windowStart: 0 };
}

export function channelOf(value: unknown): Channel | undefined {
  if (value === "email" || value === "sms" || value === "call") return value;
  return undefined;
}

function copy(state: ListState): ListState {
  const next: ListState = { view: state.view, needsMatch: state.needsMatch, windowStart: state.windowStart };
  if (state.channel) next.channel = state.channel;
  if (state.mailboxId) next.mailboxId = state.mailboxId;
  if (state.numberId) next.numberId = state.numberId;
  if (state.query) next.query = state.query;
  if (state.selectedId) next.selectedId = state.selectedId;
  return next;
}

export function setView(state: ListState, view: InboxView): ListState {
  const next = copy(state);
  next.view = view;
  next.windowStart = 0;
  delete next.selectedId;
  return next;
}

export function toggleChannel(state: ListState, channel: Channel): ListState {
  const next = copy(state);
  next.windowStart = 0;
  delete next.selectedId;
  if (state.channel === channel) delete next.channel;
  else next.channel = channel;
  return next;
}

export function toggleMailbox(state: ListState, mailboxId: string): ListState {
  const next = copy(state);
  next.windowStart = 0;
  delete next.selectedId;
  delete next.numberId;
  if (state.mailboxId === mailboxId) delete next.mailboxId;
  else next.mailboxId = mailboxId;
  return next;
}

export function toggleNumber(state: ListState, numberId: string): ListState {
  const next = copy(state);
  next.windowStart = 0;
  delete next.selectedId;
  delete next.mailboxId;
  if (state.numberId === numberId) delete next.numberId;
  else next.numberId = numberId;
  return next;
}

export function toggleNeedsMatch(state: ListState): ListState {
  const next = copy(state);
  next.needsMatch = !state.needsMatch;
  next.windowStart = 0;
  delete next.selectedId;
  return next;
}

/** Clears channel, inbox, number, and Needs a match. The open view stays. */
export function showAll(state: ListState): ListState {
  const next: ListState = { view: state.view, needsMatch: false, windowStart: 0 };
  return next;
}

export function selectRow(state: ListState, id: string): ListState {
  const next = copy(state);
  next.selectedId = id;
  return next;
}

export function scrollTo(state: ListState, start: number, total: number): ListState {
  const next = copy(state);
  const max = Math.max(0, total - SCROLL_WINDOW);
  next.windowStart = Math.min(Math.max(0, Math.floor(start)), max);
  return next;
}

export function viewLabel(view: InboxView): string {
  if (view === "thread") return "By thread";
  if (view === "calls") return "Calls only";
  return "By contact";
}

export function channelLabel(channel: Channel): string {
  if (channel === "email") return "Email";
  if (channel === "sms") return "Text";
  return "Calls";
}

export function showingText(state: ListState, names: { mailbox?: string; number?: string }): string {
  const parts: string[] = [];
  if (state.needsMatch) parts.push("Needs a match");
  if (state.channel) parts.push(channelLabel(state.channel));
  if (state.view === "calls") {
    if (names.number) parts.push(names.number);
  } else if (names.mailbox) parts.push(names.mailbox);
  if (state.query) parts.push(state.query);
  if (parts.length > 0) return parts.join(", ");
  if (state.view === "thread") return "By thread";
  if (state.view === "calls") return "Calls only";
  return "All conversations";
}

function queryHit(state: ListState, haystack: string): boolean {
  if (!state.query) return true;
  return haystack.toLowerCase().includes(state.query.toLowerCase());
}

export function acceptsContact(row: Conversation, state: ListState): boolean {
  if (state.channel && row.lastChannel !== state.channel) return false;
  if (state.needsMatch && !row.needsMatch) return false;
  if (state.mailboxId && !row.mailboxIds.includes(state.mailboxId)) return false;
  if (state.numberId && !(row.numberIds ?? []).includes(state.numberId)) return false;
  return queryHit(state, `${row.displayName} ${row.address} ${row.lastPreview}`);
}

export function acceptsThread(row: ThreadRow, state: ListState): boolean {
  if (state.channel && row.channel !== state.channel) return false;
  if (state.needsMatch && !row.needsMatch) return false;
  if (state.mailboxId && row.mailboxId !== state.mailboxId) return false;
  const subject = row.subject ?? "";
  return queryHit(state, `${subject} ${row.participants.join(" ")}`);
}

export function acceptsCall(row: CallRow, state: ListState): boolean {
  if (state.channel && state.channel !== "call") return false;
  if (state.numberId && row.numberId !== state.numberId) return false;
  if (state.needsMatch && row.contactId) return false;
  return queryHit(state, `${row.from} ${row.to}`);
}

function byNewest(a: number, b: number, idA: string, idB: string): number {
  if (a !== b) return b - a;
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
}

export function sortConversations(rows: readonly Conversation[]): Conversation[] {
  return [...rows].sort((a, b) => byNewest(a.lastMessageAt, b.lastMessageAt, a.id, b.id));
}

export function sortThreads(rows: readonly ThreadRow[]): ThreadRow[] {
  return [...rows].sort((a, b) => byNewest(a.lastAt, b.lastAt, a.threadId, b.threadId));
}

export function sortCalls(rows: readonly CallRow[]): CallRow[] {
  return [...rows].sort((a, b) => byNewest(a.startedAt, b.startedAt, a.id, b.id));
}

export function countContacts(rows: readonly Conversation[], mailboxes: readonly MailboxRow[]): FilterCounts {
  let email = 0;
  let sms = 0;
  let call = 0;
  let needsMatch = 0;
  const byId = new Map<string, number>();
  for (const box of mailboxes) byId.set(box.id, 0);
  for (const row of rows) {
    if (row.lastChannel === "email") email += 1;
    else if (row.lastChannel === "sms") sms += 1;
    else if (row.lastChannel === "call") call += 1;
    if (row.needsMatch) needsMatch += 1;
    for (const id of row.mailboxIds) byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  return {
    email,
    sms,
    call,
    needsMatch,
    inboxes: mailboxes.map((box) => ({ id: box.id, title: box.title, count: byId.get(box.id) ?? 0 })),
  };
}

export function countThreads(rows: readonly ThreadRow[], mailboxes: readonly MailboxRow[]): FilterCounts {
  let email = 0;
  let sms = 0;
  let call = 0;
  let needsMatch = 0;
  const byId = new Map<string, number>();
  for (const box of mailboxes) byId.set(box.id, 0);
  for (const row of rows) {
    if (row.channel === "email") email += 1;
    else if (row.channel === "sms") sms += 1;
    else call += 1;
    if (row.needsMatch) needsMatch += 1;
    if (row.mailboxId) byId.set(row.mailboxId, (byId.get(row.mailboxId) ?? 0) + 1);
  }
  return {
    email,
    sms,
    call,
    needsMatch,
    inboxes: mailboxes.map((box) => ({ id: box.id, title: box.title, count: byId.get(box.id) ?? 0 })),
  };
}

export function countCalls(rows: readonly CallRow[], numbers: readonly NumberRow[]): FilterCounts {
  let needsMatch = 0;
  const byId = new Map<string, number>();
  for (const num of numbers) byId.set(num.id, 0);
  for (const row of rows) {
    if (!row.contactId) needsMatch += 1;
    byId.set(row.numberId, (byId.get(row.numberId) ?? 0) + 1);
  }
  return {
    email: 0,
    sms: 0,
    call: rows.length,
    needsMatch,
    inboxes: numbers.map((num) => ({ id: num.id, title: num.title, count: byId.get(num.id) ?? 0 })),
  };
}

export function unreadCounts(rows: readonly Conversation[], mailboxIds: readonly string[], numberIds: readonly string[]): { byInbox: InboxCount[]; total: number; needsMatch: number } {
  const mail = new Map<string, number>();
  const nums = new Map<string, number>();
  for (const id of mailboxIds) mail.set(id, 0);
  for (const id of numberIds) nums.set(id, 0);
  let total = 0;
  let needsMatch = 0;
  for (const row of rows) {
    total += row.unreadCount;
    if (row.needsMatch) needsMatch += 1;
    for (const id of row.mailboxIds) if (mail.has(id)) mail.set(id, (mail.get(id) ?? 0) + row.unreadCount);
    for (const id of row.numberIds ?? []) if (nums.has(id)) nums.set(id, (nums.get(id) ?? 0) + row.unreadCount);
  }
  const byInbox: InboxCount[] = [];
  for (const [id, unread] of mail) byInbox.push({ kind: "mailbox", id, unread });
  for (const [id, unread] of nums) byInbox.push({ kind: "number", id, unread });
  return { byInbox, total, needsMatch };
}

export function windowOf<T>(rows: readonly T[], start: number): T[] {
  const from = Math.max(0, start);
  return rows.slice(from, from + SCROLL_WINDOW);
}

function unreadNote(preview: string, unread: number): string {
  if (unread <= 0) return preview;
  return `${preview} · ${unread} unread`;
}

export function contactModels(rows: readonly Conversation[]): RowModel[] {
  return rows.map((row) => {
    const model: RowModel = {
      id: row.id,
      title: row.displayName,
      note: unreadNote(row.lastPreview, row.unreadCount),
      conversationId: row.id,
    };
    if (row.contactId) model.contactId = row.contactId;
    return model;
  });
}

export function threadModels(rows: readonly ThreadRow[]): RowModel[] {
  return rows.map((row) => {
    const model: RowModel = {
      id: row.threadId,
      title: row.subject && row.subject.length > 0 ? row.subject : (row.participants[0] ?? "Thread"),
      note: unreadNote(channelLabel(row.channel), row.unread),
      conversationId: row.threadId,
    };
    if (row.contactId) model.contactId = row.contactId;
    return model;
  });
}

export function callModels(rows: readonly CallRow[], names: ReadonlyMap<string, string>): RowModel[] {
  return rows.map((row) => {
    const named = row.contactId ? names.get(row.contactId) : undefined;
    const party = named ?? (row.direction === "in" ? row.from : row.to);
    const direction = row.direction === "in" ? "Incoming" : "Outgoing";
    const model: RowModel = {
      id: row.id,
      title: party,
      note: `${direction}, ${row.state}`,
      conversationId: row.id,
    };
    if (row.contactId) model.contactId = row.contactId;
    return model;
  });
}

export function contactNames(rows: readonly Conversation[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) if (row.contactId && !names.has(row.contactId)) names.set(row.contactId, row.displayName);
  return names;
}

export function prefetchTarget(row: RowModel): Prefetch {
  const target: Prefetch = { screenId: "inbox.contact-tab" };
  if (row.conversationId) target.conversationId = row.conversationId;
  if (row.contactId) target.contactId = row.contactId;
  return target;
}

export function moveSelection(rows: readonly RowModel[], selectedId: string | undefined, key: "ArrowDown" | "ArrowUp" | "Enter"): { selectedId?: string; open: boolean } {
  if (key === "Enter") return selectedId ? { selectedId, open: true } : { open: false };
  if (rows.length === 0) return { open: false };
  const index = rows.findIndex((row) => row.id === selectedId);
  const step = key === "ArrowDown" ? 1 : -1;
  const next = index < 0 ? (key === "ArrowDown" ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, index + step));
  const row = rows[next];
  if (!row) return { open: false };
  return { selectedId: row.id, open: false };
}

/** Ten thousand contact rows for the scroll budget. Index 0 is the newest. */
export function manyConversations(count: number): Conversation[] {
  const rows: Conversation[] = [];
  for (let i = 0; i < count; i++) {
    const lastChannel: Channel = i % 3 === 0 ? "email" : i % 3 === 1 ? "sms" : "call";
    const row: Conversation = {
      id: `cnv_${i}`,
      address: `p${i}@example.com`,
      displayName: `Person ${i}`,
      lastMessageAt: 1_760_000_000_000 - i,
      lastChannel,
      lastPreview: "Hello",
      unreadCount: i % 5 === 0 ? 1 : 0,
      needsMatch: i % 17 === 0,
      mailboxIds: [i % 2 === 0 ? "mbx_work" : "mbx_support"],
      followed: false,
      alertOnReplies: false,
    };
    rows.push(row);
  }
  return rows;
}
