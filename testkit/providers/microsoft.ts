// Fake Microsoft Graph behind graph.microsoft.com (ARCH 8 table, 10.1).
// mailListMessages speaks GET /me/messages, the page connectors replay from tests/.
import { handledFetch, hostIs, recordingFetch, type FetchLike, type Handler, type ReplayTape, type SeenCall } from "./replay.ts";

export interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime?: string;
  conversationId?: string;
}

export interface GraphMessagePage {
  value: GraphMessage[];
  "@odata.nextLink"?: string;
}

export interface GraphListQuery {
  top?: number;
  skipToken?: string;
}

export interface MicrosoftProvider {
  readonly name: "microsoft";
  readonly calls: SeenCall[];
  readonly fetch: FetchLike;
  mailListMessages(query?: GraphListQuery): Promise<GraphMessagePage>;
  organization(): Promise<{ id: string; displayName: string }>;
}

export function graphMessagesUrl(query: GraphListQuery = {}): string {
  const u = new URL("https://graph.microsoft.com/v1.0/me/messages");
  if (query.top !== undefined) u.searchParams.set("$top", String(query.top));
  if (query.skipToken !== undefined) u.searchParams.set("$skiptoken", query.skipToken);
  return u.toString();
}

export function fakeMicrosoft(opts: { tape?: ReplayTape; fetch?: FetchLike } = {}): MicrosoftProvider {
  const calls: SeenCall[] = [];
  const handlers: Handler[] = [
    {
      method: "GET",
      match: (u) => hostIs(u, "graph.microsoft.com") && u.pathname === "/v1.0/me/messages",
      run: () => ({ body: { value: [] } }),
    },
    {
      method: "GET",
      match: (u) => hostIs(u, "graph.microsoft.com") && u.pathname === "/v1.0/organization",
      run: () => ({ body: { value: [{ id: "tenant-fake", displayName: "Fake Tenant" }] } }),
    },
  ];
  const fetch = recordingFetch(opts.fetch ?? handledFetch(handlers, opts.tape), calls);
  return {
    name: "microsoft",
    calls,
    fetch,
    async mailListMessages(query = {}) {
      const res = await fetch(graphMessagesUrl(query));
      if (res.status !== 200) throw new Error(`graph messages returned ${res.status}`);
      return asGraphPage(JSON.parse(await res.text()));
    },
    async organization() {
      const res = await fetch("https://graph.microsoft.com/v1.0/organization");
      if (res.status !== 200) throw new Error(`graph organization returned ${res.status}`);
      const body = JSON.parse(await res.text()) as { value?: { id?: string; displayName?: string }[] };
      const row = body.value?.[0];
      return { id: row?.id ?? "", displayName: row?.displayName ?? "" };
    },
  };
}

function asGraphPage(v: unknown): GraphMessagePage {
  if (!v || typeof v !== "object") throw new Error("graph page is not an object");
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.value)) throw new Error("graph page has no value array");
  const value: GraphMessage[] = [];
  for (const row of o.value) {
    if (!row || typeof row !== "object") continue;
    const m = row as Record<string, unknown>;
    if (typeof m.id !== "string") continue;
    const msg: GraphMessage = { id: m.id };
    if (typeof m.subject === "string") msg.subject = m.subject;
    if (typeof m.receivedDateTime === "string") msg.receivedDateTime = m.receivedDateTime;
    if (typeof m.conversationId === "string") msg.conversationId = m.conversationId;
    value.push(msg);
  }
  const page: GraphMessagePage = { value };
  const next = o["@odata.nextLink"];
  if (typeof next === "string") page["@odata.nextLink"] = next;
  return page;
}
