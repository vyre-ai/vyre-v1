// One public document, opened through the shared fetcher.
// A host-installed network is used as given, including connect. Otherwise this uses platform fetch and DNS.
// The page text stays inside this call. It is not returned, and it is not a prompt.
import { lookup } from "node:dns/promises";
import { documentNetwork } from "../document-network.ts";
import { fetchPublicDocument } from "../public-fetch.ts";
import type { AutoCtx } from "../projections.ts";

type In = { url?: unknown };

async function lookupHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export async function openDocument(_ctx: AutoCtx, input: In): Promise<unknown> {
  const url = typeof input.url === "string" ? input.url : "";
  const installed = documentNetwork();
  const result = await fetchPublicDocument(url, installed ?? { fetch: globalThis.fetch, lookup: lookupHost });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, finalUrl: result.finalUrl };
}
