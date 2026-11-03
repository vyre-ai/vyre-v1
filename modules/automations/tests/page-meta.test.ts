// A link card's meta from a fetched page (Notes): Open Graph first, then Twitter tags, then <title> and the description; an image address is made absolute and kept only on https;
// read_link returns it beside the text for an HTML page, through the one shared fetcher.
import test from "node:test";
import assert from "node:assert/strict";
import { pageMeta } from "../page-meta.ts";
import { setDocumentNetwork } from "../document-network.ts";
import { readDocs } from "../handlers/read-docs.ts";
import type { AutoCtx } from "../projections.ts";

const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Free consultation | Bailey &amp; Galyen</title>
<meta property="og:title" content="Hurt in Texas? Talk to a lawyer today.">
<meta property="og:site_name" content="Bailey &amp; Galyen">
<meta content="/img/consult-card.jpg" property="og:image">
<meta name="description" content="Call us 24/7. No fee unless we win."></head><body><h1>Hurt in Texas?</h1></body></html>`;

test("Open Graph tags give the title, site name and an absolute image address", () => {
  assert.deepEqual(pageMeta(PAGE, new URL("https://baileyandgalyen.com/free-consultation")), {
    title: "Hurt in Texas? Talk to a lawyer today.", siteName: "Bailey & Galyen", description: "Call us 24/7. No fee unless we win.", image: "https://baileyandgalyen.com/img/consult-card.jpg",
  });
});

test("without Open Graph: the <title>; an image on http or a non-address is dropped; nothing at all is an empty meta", () => {
  assert.deepEqual(pageMeta(`<title>  Lab 8 &#8211; MLA  </title><meta name="twitter:image" content="http://x.example/a.png">`, new URL("https://x.example/")), { title: "Lab 8 – MLA" });
  assert.deepEqual(pageMeta("<p>no head</p>", new URL("https://x.example/")), {});
});

test("read_link returns the meta beside the text for an HTML page", async () => {
  setDocumentNetwork({ lookup: async () => ["93.184.216.34"], fetch: (async () => new Response(PAGE, { headers: { "content-type": "text/html" } })) as typeof fetch });
  try {
    const out = await readDocs({} as AutoCtx, { url: "https://baileyandgalyen.com/free-consultation" }) as { ok: boolean; meta?: { title?: string; siteName?: string } };
    assert.equal(out.ok, true);
    assert.deepEqual([out.meta?.title, out.meta?.siteName], ["Hurt in Texas? Talk to a lawyer today.", "Bailey & Galyen"]);
  } finally { setDocumentNetwork(null); }
});
