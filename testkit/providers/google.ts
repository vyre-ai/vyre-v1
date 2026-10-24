// Fake Google Workspace behind *.googleapis.com (ARCH 8 table, 10.1).
// gmailListMessages speaks users.messages.list, the page connectors replay from tests/.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface GmailListQuery {
  userId?: string;
  maxResults?: number;
  pageToken?: string;
  q?: string;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailListPage {
  messages: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GoogleProvider {
  readonly name: "google";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  gmailListMessages(query?: GmailListQuery): Promise<GmailListPage>;
}

export function gmailListUrl(query: GmailListQuery = {}): string {
  const user = query.userId && query.userId.length > 0 ? query.userId : "me";
  const u = new URL(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(user)}/messages`);
  if (query.maxResults !== undefined) u.searchParams.set("maxResults", String(query.maxResults));
  if (query.pageToken !== undefined) u.searchParams.set("pageToken", query.pageToken);
  if (query.q !== undefined) u.searchParams.set("q", query.q);
  return u.toString();
}

export function fakeGoogle(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): GoogleProvider {
  const calls: SeenCall[] = [];
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "googleapis.com") && /\/messages$/.test(u.pathname),
      run: () => ({ body: { messages: [], resultSizeEstimate: 0 } }),
    },
    {
      method: "GET",
      match: (u) => hostIs(u, "googleapis.com") && u.pathname.endsWith("/profile"),
      run: () => ({ body: { emailAddress: "ada@example.com", messagesTotal: 0, historyId: "1" } }),
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "google",
    calls,
    fetch,
    async gmailListMessages(query = {}) {
      const res = await fetch(gmailListUrl(query));
      if (res.status !== 200) throw new Error(`gmail list returned ${res.status}`);
      return asGmailPage(JSON.parse(await res.text()));
    },
  };
}

function asGmailPage(v: unknown): GmailListPage {
  if (!v || typeof v !== "object") throw new Error("gmail page is not an object");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.messages)) throw new Error("gmail page has no messages array");
  const messages: GmailMessageRef[] = [];
  for (const row of o.messages) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    if (typeof m.id === "string" && typeof m.threadId === "string") messages.push({ id: m.id, threadId: m.threadId });
  }
  const page: GmailListPage = { messages };
  if (typeof o.nextPageToken === "string") page.nextPageToken = o.nextPageToken;
  if (typeof o.resultSizeEstimate === "number") page.resultSizeEstimate = o.resultSizeEstimate;
  return page;
}
