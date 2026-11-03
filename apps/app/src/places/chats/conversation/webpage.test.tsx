// The page card and the quote a message brings from Vyre for Chrome.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { QuoteCard, WebPageCard, quoteOf, webPageOf } from "./webpage.tsx";

const SHOT = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

test("a web_page block reads its title, host and the extension's masked screenshot, and nothing it should not", () => {
  assert.deepEqual(webPageOf({ url: "https://www.app.gohighlevel.com/c/1", title: "Marisol Vega · Contacts", shot: SHOT, text: "page text" }), { url: "https://www.app.gohighlevel.com/c/1", host: "app.gohighlevel.com", title: "Marisol Vega · Contacts", shot: SHOT });
  assert.equal(webPageOf({ url: "javascript:alert(1)", title: "x" }), null);
  assert.equal(webPageOf({ url: "https://a.test/", shot: "https://tracker.test/pixel.png" })?.shot, null, "a screenshot is only ever the extension's own data image");
  assert.equal(webPageOf({ url: "https://a.test/" })?.title, "a.test");
});

test("a quote block is the selected text and the site it came from", () => {
  assert.deepEqual(quoteOf({ text: "  after 5 PM  ", url: "https://linkedin.com/in/priya" }), { text: "after 5 PM", host: "linkedin.com", url: "https://linkedin.com/in/priya" });
  assert.equal(quoteOf({ text: " " }), null);
  assert.equal(quoteOf({ text: "x", url: "file:///etc" })?.host, "");
});

test("the cards render the page and the quote as text", () => {
  const page = renderToStaticMarkup(<WebPageCard id="b1" data={{ url: "https://app.gohighlevel.com/c/1", title: "Marisol <b>Vega</b>", shot: SHOT }} />);
  assert.match(page, /Marisol &lt;b&gt;Vega&lt;\/b&gt;/);
  assert.match(page, /app\.gohighlevel\.com · with screenshot/);
  assert.match(page, /webpage-b1-shot/);
  const bare = renderToStaticMarkup(<WebPageCard id="b2" data={{ url: "https://lu.ma/x", title: "AI Lab 8" }} />);
  assert.match(bare, />L</, "no screenshot: the site's initial");
  assert.equal(renderToStaticMarkup(<WebPageCard id="b3" data={{ url: "nope" }} />), "");
  const q = renderToStaticMarkup(<QuoteCard id="q1" data={{ text: "We doubled consults in 2025", url: "https://linkedin.com/in/priya" }} />);
  assert.match(q, /We doubled consults in 2025/);
  assert.match(q, /Selected on linkedin\.com/);
});
