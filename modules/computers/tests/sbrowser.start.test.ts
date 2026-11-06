// The start page of a Space browser profile (browserd/start.ts) and the agent's drawn face (sbrowser/face.ts): the page names the agent, draws its face from the stored SVG with nothing to fetch, escapes
// what it shows, and one profile's browser cannot read another's.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRecentSites, startPageHtml, startStartServer } from "../../../images/space-browser/browserd/start.ts";
import { faceSvg, faceTint } from "../sbrowser/face.ts";

test("the page shows the agent's name, face and recent sites, in the app's light or graphite colours, and escapes what it was given", async () => {
  const svg = await faceSvg("dex");
  const html = startPageHtml({ name: "Dex <b>", face: "dex", ...(svg ? { faceSvg: svg } : {}), recent: [{ host: "www.nytimes.com", url: "https://www.nytimes.com/", title: "NYT", at: 1 }] }, "graphite");
  assert.match(html, /<h1>Dex &lt;b&gt;<\/h1>/);
  assert.ok(!html.includes("<b>"));
  assert.match(html, /#161617/, "Graphite's window colour");
  assert.match(html, /nytimes\.com/);
  assert.match(html, /<title>Dex &lt;b&gt;<\/title>/);
  assert.ok(!/https?:\/\/[^"' )]*\.(svg|png|js|css)/.test(html), "nothing to fetch when it is viewed");
  if (svg) assert.match(html, /<img alt="" src="data:image\/svg\+xml;base64,/);
  assert.match(startPageHtml({ name: "Dana's Assistant", face: "", recent: [] }, "light"), /Sites Dana&#39;s Assistant opens will show up here/);
  assert.match(startPageHtml({ name: "A", face: "", recent: [] }, "light"), /#FFFFFF/);
  assert.match(startPageHtml({ name: "A", face: "", recent: [] }), /prefers-color-scheme:dark/, "without a choice it follows the browser");
});

test("the face is the app's tint on a Notionists drawing, the same for the same seed, and nothing without a seed", async () => {
  assert.match(faceTint("dex"), /^[0-9a-f]{6}$/);
  assert.equal(faceTint("dex"), faceTint("dex"));
  assert.equal(await faceSvg(""), null);
  const a = await faceSvg("dex");
  if (a) { assert.ok(a.startsWith("<svg")); assert.equal(await faceSvg("dex"), a); assert.notEqual(await faceSvg("scout"), a); }
});

test("recent sites keep one per host, newest first, six at most, and never the browser's own addresses", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-recent-"));
  try {
    let t = 1;
    const r = createRecentSites(dir, () => t++);
    assert.deepEqual(r.list(), []);
    for (const h of ["a.com", "b.com", "c.com", "d.com", "e.com", "f.com", "g.com", "a.com"]) r.add(`https://${h}/page?x=1`, h);
    r.add("http://127.0.0.1:7004/start", "start"); r.add("about:blank", ""); r.add("not a url", "");
    assert.deepEqual(r.list().map((x) => x.host), ["a.com", "g.com", "f.com", "e.com", "d.com", "c.com"]);
    assert.equal(r.list()[0]!.url, "https://a.com/", "the address of the site, not of the page");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the server gives a profile's page only to the browser that carries that profile's cookie", async () => {
  const names: Record<string, string> = { agt_dex: "Dex", agt_scout: "Scout" };
  const s = await startStartServer({ port: 0, data: (id) => ({ name: names[id] ?? "?", face: "", recent: [] }) });
  try {
    const get = async (cookie?: string) => (await fetch(s.url(), { headers: cookie ? { cookie } : {} })).text();
    const dex = s.token("agt_dex"), scout = s.token("agt_scout");
    assert.match(await get(`vyre_start=${dex}`), /<h1>Dex<\/h1>/);
    assert.match(await get(`vyre_start=${scout}`), /<h1>Scout<\/h1>/);
    assert.match(await get(), /<h1>Vyre<\/h1>/, "no cookie: no name");
    assert.match(await get(`vyre_start=${"0".repeat(48)}`), /<h1>Vyre<\/h1>/, "a guess");
    const again = s.token("agt_dex");
    assert.match(await get(`vyre_start=${dex}`), /<h1>Vyre<\/h1>/, "a new token when the browser starts again ends the old one");
    assert.match(await get(`vyre_start=${again}`), /<h1>Dex<\/h1>/);
    assert.equal((await fetch(s.url().replace("/start", "/other"))).status, 404);
  } finally { s.close(); }
});
