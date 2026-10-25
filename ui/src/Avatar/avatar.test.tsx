// ui/Avatar: people get a marble, agents a pixel face, the assistant the Vyre mark, automations and groups a glyph; one face per name, everywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar, hash, kindOf, marbleSpec, pixelInner, pixelSpec, initialsOf } from "./index.tsx";

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
  assert.match(html, /border-radius:12px/, "a person is round");
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

test("an agent is a pixel face on a soft tint, with a 30 percent radius", () => {
  const spec = pixelSpec("Scheduler");
  assert.match(spec.tint, /^hsl\(\d+ 55% 86%\)$/);
  const html = renderToStaticMarkup(<Avatar name="Scheduler" kind="agent" size={20} />);
  assert.match(html, /data-avatar="agent"/);
  assert.match(html, /viewBox="0 0 12 12"/);
  assert.match(html, /shape-rendering="crispEdges"/);
  assert.ok(html.includes(`fill="${spec.tint}"`), "the tint fills the ground");
  assert.ok(html.includes(`fill="${spec.skin}"`), "the head is skin coloured");
  assert.match(html, /border-radius:30%/);
  assert.ok((html.match(/<rect /g) ?? []).length >= 6, "a head, hair, eyes and a mouth are drawn");
});

test("a pixel face is eight pixels wide and sits inside the 12 pixel ground", () => {
  for (const name of ["Scheduler", "Proofer", "Intake", "Billing", "Research", "Docs", "Scout", "Ines", "Theo"]) {
    const svg = pixelInner(name);
    for (const m of svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)"/g)) {
      const [x, y, w, h] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      assert.ok(x >= 0 && y >= 0 && x + w <= 12 && y + h <= 12, `${name}: ${m[0]} stays on the ground`);
    }
  }
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
