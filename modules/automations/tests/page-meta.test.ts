// A link card's meta from a fetched page (Notes): Open Graph first, then Twitter tags, then <title> and the description; an image address is made absolute and kept only on https;
// read_link returns it beside the text for an HTML page, through the one shared fetcher.
import test from "node:test";
import assert from "node:assert/strict";
import { pageMeta } from "../page-meta.ts";
import { fetchPublicImage, sniffImage } from "../public-fetch.ts";
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

// ---- the card picture, fetched on the server


const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
type Route = { body: Uint8Array | string; type: string; status?: number; location?: string };
const site = (routes: Record<string, Route>, ips: Record<string, string> = {}) => ({
  lookup: async (host: string) => [ips[host] ?? "93.184.216.34"],
  fetch: (async (u: string) => {
    const r = routes[u];
    if (!r) return new Response("missing", { status: 404 });
    return new Response(r.body as BodyInit, { status: r.status ?? 200, headers: { "content-type": r.type, ...(r.location ? { location: r.location } : {}) } });
  }) as typeof fetch,
});
const HEAD = (extra: string) => `<html><head><title>Lab 8</title>${extra}</head><body></body></html>`;

test("a card picture is fetched on the server: PNG, JPEG, GIF or WebP by type and first bytes, capped; SVG, HTML, a large file or a private host are refused", async () => {
  assert.equal(sniffImage(new Uint8Array(PNG)), "image/png");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  const net = site({
    "https://cdn.example/a.png": { body: new Uint8Array(PNG), type: "image/png" },
    "https://cdn.example/a.svg": { body: "<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", type: "image/svg+xml" },
    "https://cdn.example/lies.png": { body: "<html>not a picture</html>", type: "image/png" },
    "https://cdn.example/page": { body: "<html></html>", type: "text/html" },
    "https://cdn.example/big.png": { body: new Uint8Array(2_000_000).fill(1).map((x, i) => (i < 8 ? PNG[i]! : x)), type: "image/png" },
    "https://cdn.example/hop.png": { body: "", type: "text/plain", status: 302, location: "https://inside.example/a.png" },
  }, { "inside.example": "10.0.0.5" });
  const ok = await fetchPublicImage("https://cdn.example/a.png", net);
  assert.ok(ok.ok && ok.contentType === "image/png" && ok.bytes.byteLength === PNG.byteLength);
  for (const u of ["https://cdn.example/a.svg", "https://cdn.example/lies.png", "https://cdn.example/page", "https://cdn.example/big.png", "https://cdn.example/hop.png", "http://cdn.example/a.png", "https://10.0.0.5/a.png"]) {
    assert.equal((await fetchPublicImage(u, net)).ok, false, u);
  }
});

test("read_link with preview returns the page image as bytes, else the site icon, else nothing; without preview it fetches no picture", async () => {
  const calls: string[] = [];
  const routes: Record<string, Route> = {
    "https://lu.ma/lab-8": { body: HEAD('<meta property="og:image" content="https://cdn.example/card.png"><link rel="icon" href="/icon.png">'), type: "text/html" },
    "https://cdn.example/card.png": { body: new Uint8Array(PNG), type: "image/png" },
    "https://skool.com/labs": { body: HEAD('<meta property="og:image" content="https://cdn.example/gone.png"><link rel="apple-touch-icon" href="/touch.png">'), type: "text/html" },
    "https://skool.com/touch.png": { body: new Uint8Array(PNG), type: "image/png" },
    "https://plain.example/": { body: HEAD(""), type: "text/html" },
  };
  const net = site(routes);
  setDocumentNetwork({ lookup: net.lookup, fetch: (async (u: string, init?: RequestInit) => { calls.push(u); return net.fetch(u, init); }) as typeof fetch });
  try {
    const a = await readDocs({} as AutoCtx, { url: "https://lu.ma/lab-8", preview: true }) as { preview?: { contentType: string; data: string; from: string }; meta?: { icon?: string } };
    assert.deepEqual([a.preview?.contentType, a.preview?.from, a.preview?.data], ["image/png", "image", PNG.toString("base64")]);
    assert.equal(a.meta?.icon, "https://lu.ma/icon.png");
    const b = await readDocs({} as AutoCtx, { url: "https://skool.com/labs", preview: true }) as { preview?: { from: string } };
    assert.equal(b.preview?.from, "icon", "the page image failed, the site icon is the picture");
    const c = await readDocs({} as AutoCtx, { url: "https://plain.example/", preview: true }) as { preview?: unknown };
    assert.equal(c.preview, undefined, "a plain card");
    calls.length = 0;
    const d = await readDocs({} as AutoCtx, { url: "https://lu.ma/lab-8" }) as { preview?: unknown };
    assert.deepEqual([d.preview, calls], [undefined, ["https://lu.ma/lab-8"]], "without preview, only the page is read");
  } finally { setDocumentNetwork(null); }
});
