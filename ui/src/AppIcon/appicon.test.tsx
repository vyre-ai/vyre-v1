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
  assert.match(html, /border-top-left-radius:28%/);
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

test("db and aws reach the postgres and amazon marks; ghl draws its own icon file", () => {
  assert.equal(markKey("db"), "postgresql");
  assert.equal(markKey("aws"), "amazonwebservices");
  assert.equal(markKey("ghl"), null, "no inline mark; the tools file is used");
  assert.match(renderToStaticMarkup(<AppIcon brand="db" />), /data-appicon="postgresql"/);
  const ghl = renderToStaticMarkup(<AppIcon brand="ghl" name="GoHighLevel" />);
  assert.match(ghl, /data-appicon="gohighlevel"/);
  assert.match(ghl, /src="\/tools\/gohighlevel\.png"/);
  assert.doesNotMatch(ghl, />G</);
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
  assert.equal(brandForUrl("https://www.dropbox.com/home/Sales"), "dropbox");
  assert.equal(brandForName("Dropbox"), "dropbox");
  assert.equal(brandForUrl("notion.so/login"), "notion");
  assert.equal(brandForUrl("not a url"), null);
  assert.equal(brandForName("Stripe webhooks"), "stripe");
  assert.equal(brandForName("Postgres · Northwind prod"), "db");
  assert.equal(brandForName("Rivera client portal"), null);
  // every AI provider in Add an AI provider draws its own mark, never a letter
  for (const [name, key] of [["Codex", "openai"], ["ChatGPT", "openai"], ["Grok", "grok"], ["xAI", "xai"], ["OpenRouter", "openrouter"], ["Google Gemini", "googlegemini"], ["OpenCode Go", "opencode"], ["Local model", "localmodel"], ["Claude Code", "claude"], ["Anthropic", "anthropic"], ["OpenAI", "openai"]] as const) {
    assert.equal(brandForName(name), key, name);
    assert.ok(markKey(key), `${name} has a mark`);
  }
});

test("the tile takes the size it is given and carries a label", () => {
  const html = renderToStaticMarkup(<AppIcon brand="slack" size={40} name="Slack" />);
  assert.match(html, /width:40px/);
  assert.match(html, /height:40px/);
  assert.match(html, /aria-label="Slack"/);
});

test("an app that ships only as a file in public/tools is found by name, and an ordinary word inside a longer name is not", async () => {
  const { brandForName, toolKey } = await import("./index.tsx");
  assert.equal(brandForName("Clio"), "clio");
  assert.equal(brandForName("Clio Manage key"), "clio");
  assert.equal(toolKey("clio"), "clio");
  assert.equal(brandForName("Postgres box"), "db", "the postgres mark wins");
  assert.equal(brandForName("Spare box key"), null, "box is an ordinary word here");
  assert.equal(brandForName("Box"), "box", "but the whole name is the app");
  assert.match(renderToStaticMarkup(<AppIcon brand="clio" name="Clio" />), /\/tools\/clio\.png/);
});

test("the app hubs have a mark, so a hub row never shows a bare letter", () => {
  for (const k of ["composio", "pipedream"]) assert.ok(BRANDS[k]?.svg, `${k} draws something`);
});
