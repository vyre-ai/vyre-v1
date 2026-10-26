// ui/Avatar: people get a marble, agents a Notionists face, the assistant the Vyre mark, automations and groups a glyph; one face per name, everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, faceKey, faceTint, hash, hueOf, kindOf, marbleInner, marbleSpec, initialsOf, notionistsSvg } from "./index.tsx";
import { marbleGradient } from "./faces.ts";
import { hslHex } from "./faces.ts";

test("the hash is the prototype's, so a name seeds the same face as the prototype draws", () => {
  assert.equal(hash("Maya Chen"), 1260685739);
  assert.equal(hash("Scheduler"), 467662964);
});

test("a person's marble takes the prototype's colours and turns for the name", () => {
  const m = marbleSpec("Maya Chen");
  assert.deepEqual([m.base, m.c1, m.c2], ["#C20D90", "#F0AB3D", "#C20D90"]);
  assert.deepEqual([m.t1.x, m.t1.y, m.t2.x, m.t2.y, m.t1.rot, m.t2.rot], [-1, 3, -2, 1, 299, 189]);
  const html = renderToStaticMarkup(<Avatar name="Maya Chen" size={24} />);
  assert.match(html, /data-testid="avatar-Maya Chen"/);
  assert.match(html, /data-avatar="person"/);
  assert.match(html, /<mask id="mb[0-9a-z]+m"/);
  assert.match(html, /fill="#C20D90"/);
  assert.match(html, /border-top-left-radius:12px/, "a person is round");
  assert.doesNotMatch(html, />MC</, "no letter tile");
});

test("the same name draws the same face and different names draw different ones", () => {
  const a1 = renderToStaticMarkup(<Avatar name="Maya Chen" />);
  const a2 = renderToStaticMarkup(<Avatar name="Maya Chen" />);
  const b = renderToStaticMarkup(<Avatar name="Omar Haddad" />);
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  const p1 = renderToStaticMarkup(<Avatar name="Scheduler" kind="agent" />);
  const p2 = renderToStaticMarkup(<Avatar name="Proofer" kind="agent" />);
  assert.notEqual(p1, p2);
});

test("an agent is a DiceBear Notionists face on a soft tint, with a 30 percent radius", () => {
  assert.equal(faceTint("Scheduler"), hslHex(hueOf("Scheduler"), 55, 86));
  assert.match(faceTint("Scheduler"), /^[0-9a-f]{6}$/);
  const html = renderToStaticMarkup(<Avatar name="Scheduler" kind="agent" size={20} />);
  assert.match(html, /data-avatar="agent"/);
  assert.match(html, /<svg[^>]* width="20" height="20"/, "drawn at the size it is given");
  assert.match(html, /viewBox="0 0 \d+ \d+"/);
  assert.ok(html.toLowerCase().includes(`#${faceTint("Scheduler")}`) || html.toLowerCase().includes(faceTint("Scheduler")), "the tint fills the ground");
  assert.match(html, /border-top-left-radius:30%/);
});

test("the prototype's hslHex turns hue, saturation and lightness into hex", () => {
  assert.equal(hslHex(0, 100, 50), "ff0000");
  assert.equal(hslHex(120, 100, 50), "00ff00");
  assert.equal(hslHex(240, 100, 50), "0000ff");
  assert.equal(hslHex(0, 0, 100), "ffffff");
});

test("one agent name draws one face, and two names draw two", () => {
  assert.equal(notionistsSvg("Scheduler"), notionistsSvg("Scheduler"));
  assert.notEqual(notionistsSvg("Scheduler"), notionistsSvg("Proofer"));
});

test("a Space is a letter on a tint, not a face", () => {
  const html = renderToStaticMarkup(<Avatar name="Northwind" kind="space" size={20} />);
  assert.match(html, /data-avatar="space"/);
  assert.match(html, />N</);
  assert.doesNotMatch(html, /<svg/);
});

test("the assistant is the Vyre mark on the neutral tile, whether asked for by kind or by name", () => {
  assert.equal(kindOf("Assistant", "agent"), "assistant");
  assert.equal(kindOf("Scout", "agent"), "agent");
  assert.equal(kindOf("Maya Chen"), "person");
  const html = renderToStaticMarkup(<Avatar name="Assistant" kind="agent" size={22} />);
  assert.match(html, /data-avatar="assistant"/);
  assert.match(html, /class="vmark"/);
  assert.match(html, /background-color:var\(--sunk\)/);
  assert.match(html, /var\(--beacon, #8B7CF6\)/);
});

test("an automation and a group draw a glyph on the neutral tile", () => {
  const a = renderToStaticMarkup(<Avatar name="Invoice reminders" kind="automation" size={22} />);
  const g = renderToStaticMarkup(<Avatar name="Admins" kind="group" size={22} />);
  assert.match(a, /data-avatar="automation"/);
  assert.match(g, /data-avatar="group"/);
  for (const html of [a, g]) {
    assert.match(html, /background-color:var\(--sunk\)/);
    assert.match(html, /<path /);
  }
  assert.notEqual(a, g);
});

test("a photo replaces the marble", () => {
  const html = renderToStaticMarkup(<Avatar name="Maya Chen" photo="https://example.test/maya.jpg" />);
  assert.match(html, /maya\.jpg/);
  assert.doesNotMatch(html, /<mask /);
});

test("running and present dots are drawn only when asked for", () => {
  const plain = renderToStaticMarkup(<Avatar name="Scout" kind="agent" />);
  assert.doesNotMatch(plain, /-running|-present/);
  const on = renderToStaticMarkup(<Avatar name="Scout" kind="agent" running present />);
  assert.match(on, /data-testid="avatar-Scout-running"/);
  assert.match(on, /data-testid="avatar-Scout-present"/);
});

test("the face carries its name as the accessible label and takes the size it is given", () => {
  const html = renderToStaticMarkup(<Avatar name="Omar Haddad" size={32} />);
  assert.match(html, /aria-label="Omar Haddad"/);
  assert.match(html, /role="img"/);
  assert.match(html, /width:32px/);
  assert.match(html, /height:32px/);
});

test("the letters used when a face cannot draw: two for a person from 24 px, else one", () => {
  assert.equal(initialsOf("Maya Chen", 24, true), "MC");
  assert.equal(initialsOf("Maya Chen", 20, true), "M");
  assert.equal(initialsOf("scheduler", 24, false), "S");
  assert.equal(initialsOf("  ", 24, true), "?");
});

test("the face cache keys a face by seed, kind, size and skin, and caches nothing where there is no browser", async () => {
  const { faceKey, cachedFace, cachedFaceCount, clearFaceCache, requestFace, wrapSvg } = await import("./cache.ts");
  const keys = new Set([faceKey("Maya", "person", 18, "paper"), faceKey("Maya", "person", 18, "graphite"), faceKey("Maya", "person", 24, "paper"), faceKey("Maya", "agent", 18, "paper"), faceKey("Omar", "person", 18, "paper")]);
  assert.equal(keys.size, 5, "seed, kind, size and skin each change the key");
  assert.equal(faceKey("Maya", "person", 18, "paper"), faceKey("Maya", "person", 18, "paper"));
  clearFaceCache();
  let called = 0;
  requestFace(faceKey("Maya", "person", 18, "paper"), wrapSvg("<g/>", "0 0 80 80", 18), 18, () => { called += 1; });
  assert.equal(called, 0, "no document, no draw");
  assert.equal(cachedFace(faceKey("Maya", "person", 18, "paper")), undefined);
  assert.equal(cachedFaceCount(), 0);
  assert.match(wrapSvg("<g/>", "0 0 80 80", 18), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 80 80" width="18" height="18"><g\/><\/svg>$/);
});

test("the marble as CSS is seeded like the svg: same name same string, different names differ, colours from marbleSpec, no filter or svg", () => {
  const a = marbleGradient("Maya Chen");
  assert.equal(a, marbleGradient("Maya Chen"));
  assert.notEqual(a, marbleGradient("Omar Haddad"));
  const m = marbleSpec("Maya Chen");
  for (const c of [m.base, m.c1, m.c2]) assert.ok(a.includes(c), c);
  assert.equal(a.match(/radial-gradient/g)?.length, 2);
  assert.ok(!/svg|filter|blur/i.test(a));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => marbleGradient(`Person ${i}`)));
  assert.ok(seen.size > 190, "200 names give about 200 faces");
});

test("server markup keeps the inline svg marble; only the browser draws the CSS marble", () => {
  assert.match(renderToStaticMarkup(<Avatar name="Maya Chen" kind="person" size={18} />), /<svg/);
});

test("the marble colours are three non-empty CSS colours, the same for the same name, so a table cell can paint a face from them without an svg", () => {
  const m = marbleSpec("Elena Rivera");
  for (const c of [m.base, m.c1, m.c2]) assert.ok(typeof c === "string" && c.length > 3, String(c));
  assert.deepEqual(marbleSpec("Elena Rivera"), m);
});

// One person, one face everywhere: the face is seeded by the id when there is one, by the name only as a fallback.
const faceOf = (html: string): string => (/<svg.*<\/svg>/s.exec(html) ?? [""])[0];

test("the same seedId with different names draws the same face", () => {
  const a = renderToStaticMarkup(<Avatar name="Maya Chen" seedId="usr_1" />);
  const b = renderToStaticMarkup(<Avatar name="Maya C." seedId="usr_1" />);
  assert.notEqual(faceOf(a), "");
  assert.equal(faceOf(a), faceOf(b));
  assert.ok(faceOf(a).includes(marbleInner("usr_1")), "the marble is the one the id seeds, the same function the Records table draws with");
  assert.match(a, /aria-label="Maya Chen"/, "the label still reads the name");
  const x = renderToStaticMarkup(<Avatar name="Scheduler" kind="agent" seedId="agt_1" />);
  const y = renderToStaticMarkup(<Avatar name="Scheduler 2" kind="agent" seedId="agt_1" />);
  assert.equal(faceOf(x), faceOf(y));
});

test("different seedIds with the same name draw different faces", () => {
  const a = renderToStaticMarkup(<Avatar name="Sam Lee" seedId="usr_1" />);
  const b = renderToStaticMarkup(<Avatar name="Sam Lee" seedId="usr_2" />);
  assert.notEqual(faceOf(a), faceOf(b));
  const x = renderToStaticMarkup(<Avatar name="Helper" kind="agent" seedId="agt_1" />);
  const y = renderToStaticMarkup(<Avatar name="Helper" kind="agent" seedId="agt_2" />);
  assert.notEqual(faceOf(x), faceOf(y));
});

test("with no seedId, or an empty one, the name seeds the face as before", () => {
  const plain = renderToStaticMarkup(<Avatar name="Maya Chen" />);
  assert.equal(faceOf(plain), faceOf(renderToStaticMarkup(<Avatar name="Maya Chen" seedId="" />)));
  assert.ok(faceOf(plain).includes(marbleInner("Maya Chen")));
  assert.equal(faceKey("usr_1", "person", 18, ""), "person|18||usr_1", "kind, size, skin (empty here) and seed, joined by bars");
});

test("the table's cell face and the Avatar are one function of one seed", () => {
  assert.match(marbleGradient("usr_1"), /^radial-gradient/);
  assert.equal(marbleGradient("usr_1"), marbleGradient("usr_1"));
  assert.ok(marbleInner("usr_1").includes(marbleSpec("usr_1").base));
});
