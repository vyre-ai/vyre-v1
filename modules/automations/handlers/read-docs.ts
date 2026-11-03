// An agent reads one public API docs page, read only: https, a public host, a GET with no key and no cookies. It returns the page as plain text (or one line per operation for an OpenAPI document),
// the links on the same host, and nothing else. The text is data, not instructions; the skill tells the agent so. A private, loopback or metadata address is refused by the shared fetcher.
import { lookup } from "node:dns/promises";
import { logLink } from "../../../lib/grants.ts";
import { docsView } from "../docs-text.ts";
import { documentNetwork } from "../document-network.ts";
import { fetchPublicDocument, fetchPublicImage } from "../public-fetch.ts";
import { pageMeta } from "../page-meta.ts";
import type { AutoCtx } from "../projections.ts";

type In = { url?: unknown; focus?: unknown; preview?: unknown };

async function lookupHost(host: string): Promise<string[]> {
  const rows = await lookup(host, { all: true, verbatim: true });
  return rows.map((row) => row.address);
}

export async function readDocs(ctx: AutoCtx, input: In): Promise<unknown> {
  const url = typeof input.url === "string" ? input.url : "";
  const net = documentNetwork() ?? { fetch: globalThis.fetch, lookup: lookupHost };
  const fetched = await fetchPublicDocument(url, net);
  // the query string is where a link carries data, so a log line never has it
  ctx.log?.info("link read", { link: logLink(url), ok: fetched.ok });
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  const view = docsView(fetched.text, new URL(fetched.finalUrl), typeof input.focus === "string" ? input.focus : undefined);
  const meta = view.kind === "html" ? pageMeta(fetched.text, new URL(fetched.finalUrl)) : null;
  // a link card's picture, fetched here so no browser asks the third-party site for it: the page image, else the site's icon, else none
  let preview: { contentType: string; data: string; from: "image" | "icon" } | null = null;
  if (input.preview === true && meta) {
    for (const [from, src] of [["image", meta.image], ["icon", meta.icon]] as const) {
      if (!src) continue;
      const got = await fetchPublicImage(src, net);
      if (got.ok) { preview = { contentType: got.contentType, data: Buffer.from(got.bytes).toString("base64"), from }; break; }
    }
  }
  return { ok: true, finalUrl: fetched.finalUrl, kind: view.kind, text: view.text, links: view.links, truncated: view.truncated, ...(meta && Object.keys(meta).length ? { meta } : {}), ...(preview ? { preview } : {}) };
}
