// ui/AppIcon: one tile for every app, with the brand's own mark from the shared set; apps without a mark get a clean letter.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AppIcon, BRANDS, brandForDomain, brandForName, brandForUrl, letterOf, markKey, markSize } from "./index.tsx";

test("the shared set carries the prototype's brands", () => {
  for (const k of ["github", "google", "gmail", "gcal", "gdrive", "slack", "notion", "linear", "zoom", "dropbox", "openai", "anthropic", "claude", "chrome", "opencode", "stripe", "hubspot", "twilio", "supabase", "resend", "vyre"]) {
    assert.ok(k in BRANDS, `${k} has a mark`);
    assert.ok(BRANDS[k]?.p || BRANDS[k]?.svg, `${k} draws something`);
  }
  assert.ok(Object.keys(BRANDS).length >= 30);
});

test("a branded tile draws the mark in the brand colour on the neutral ground with the ring", () => {
  const html = renderToStaticMarkup(<AppIcon brand="gmail" />);
  assert.match(html, /data-testid="appicon-gmail"/);
  assert.match(html, /data-appicon="gmail"/);
  assert.match(html, /<svg [^>]*viewBox="0 0 24 24"/);
  assert.match(html, /color:#EA4335/);
  assert.match(html, /background-color:var\(--sunk\)/);
  assert.match(html, /box-shadow:inset 0 0 0 1px var\(--line\)/);
  assert.match(html, /border-radius:28%/);
  assert.match(html, /width:28px/);
});

test("a black brand paints in ink", () => {
  const html = renderToStaticMarkup(<AppIcon brand="github" size={32} />);
  assert.match(html, /color:var\(--ink\)/);
  assert.match(html, /width="18"/, "the mark is 56 percent of a 32 px tile");
});

test("a small tile draws a bigger share so the mark stays readable", () => {
  assert.equal(markSize(20), 14);
  assert.equal(markSize(32), 18);
  assert.equal(markSize(24), 13);
});

test("stroke marks keep their strokes", () => {
  const html = renderToStaticMarkup(<AppIcon brand="opencode" />);
  assert.match(html, /stroke="currentColor"/);
});

test("db and aws reach the postgres and amazon marks; ghl has none and draws a letter", () => {
  assert.equal(markKey("db"), "postgresql");
  assert.equal(markKey("aws"), "amazonwebservices");
  assert.equal(markKey("ghl"), null);
  assert.match(renderToStaticMarkup(<AppIcon brand="db" />), /data-appicon="postgresql"/);
  const ghl = renderToStaticMarkup(<AppIcon brand="ghl" name="GoHighLevel" />);
  assert.match(ghl, /data-appicon="letter"/);
  assert.match(ghl, />G</);
  assert.doesNotMatch(ghl, /<svg/);
});

test("an unknown app draws the first letter of its name", () => {
  assert.equal(letterOf("rivera", "Rivera client portal"), "R");
  assert.equal(letterOf("xyz"), "X");
  assert.equal(letterOf("", ""), "?");
  assert.match(renderToStaticMarkup(<AppIcon brand="rivera" name="Rivera client portal" />), />R</);
});

test("the generic glyphs (card, login, blank) draw line icons on the same tile", () => {
  for (const g of ["card", "login", "blank"]) {
    const html = renderToStaticMarkup(<AppIcon brand={g} />);
    assert.match(html, new RegExp(`data-appicon="${g}"`));
    assert.match(html, /stroke="var\(--ink-2\)"/);
    assert.match(html, /background-color:var\(--sunk\)/);
  }
});

test("a web address or a name finds its brand", () => {
  assert.equal(brandForDomain("www.stripe.com"), "stripe");
  assert.equal(brandForDomain("dashboard.stripe.com"), "stripe");
  assert.equal(brandForDomain("accounts.google.com"), "google");
  assert.equal(brandForDomain("db.amazonaws.com"), "aws");
  assert.equal(brandForDomain("example.org"), null);
  assert.equal(brandForUrl("https://github.com/vyre-ai"), "github");
  assert.equal(brandForUrl("notion.so/login"), "notion");
  assert.equal(brandForUrl("not a url"), null);
  assert.equal(brandForName("Stripe webhooks"), "stripe");
  assert.equal(brandForName("Postgres · Northwind prod"), "db");
  assert.equal(brandForName("Rivera client portal"), null);
});

test("the tile takes the size it is given and carries a label", () => {
  const html = renderToStaticMarkup(<AppIcon brand="slack" size={40} name="Slack" />);
  assert.match(html, /width:40px/);
  assert.match(html, /height:40px/);
  assert.match(html, /aria-label="Slack"/);
});
