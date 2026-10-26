// What the URL and the browser tell the form (spec 2.11): prefill and hide by URL key, and attribution that is captured with no setup and holds back what consent has not allowed.
import test from "node:test";
import assert from "node:assert/strict";
import { captureAttribution, deviceClass, readUrlKeys } from "../src/attribution.js";
import { define } from "./fixtures.ts";

const wide = () => define({
  consentText: undefined, logic: undefined,
  fields: [
    { field: "name", label: "Name", type: "text", prefillKey: "n" }, { field: "email", label: "Email", type: "email" }, { field: "count", label: "Count", type: "number", min: 1, max: 5 },
    { field: "area", label: "Area", type: "choice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }, { field: "tags", label: "Tags", type: "multichoice", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
    { field: "agree", label: "Agree", type: "checkbox" }, { field: "tax", label: "Tax", type: "sealed" }, { field: "docs", label: "Docs", type: "files" }, { field: "note", label: "Note", type: "text", mode: "show", value: "fixed" },
  ],
});

test("prefill: a value fills the field whose prefill key or name it carries, in the field's own type, and anything the field would refuse is dropped", () => {
  const def = wide();
  const { prefill } = readUrlKeys("?n=Dana&email=dana%40example.com&count=3&area=b&tags=x,y&agree=1", def);
  assert.deepEqual(prefill, { name: "Dana", email: "dana@example.com", count: 3, area: "b", tags: ["x", "y"], agree: true });
  assert.deepEqual(readUrlKeys("?tags=x&tags=y", def).prefill, { tags: ["x", "y"] }, "a repeated key fills a list");
  assert.deepEqual(readUrlKeys("?agree=false", def).prefill, { agree: false });
  assert.deepEqual(readUrlKeys("?name=Dana", def).prefill, {}, "the field name is not the key when the field names another");
  assert.deepEqual(readUrlKeys("?email=nope&count=9&count=3&area=zzz&tags=q", def).prefill, {}, "invalid values are not filled (the first value of a repeated key is the one read)");
  assert.deepEqual(readUrlKeys("?tax=123&docs=x&note=changed&unknown=1&n=", def).prefill, {}, "sealed, file and read-only fields and unknown keys are never filled");
});

test("hide: ?hide= names prefill keys or field names; only fields that were filled can be hidden", () => {
  const def = wide();
  const r = readUrlKeys("?n=Dana&email=d%40example.com&hide=n,email,count,note", def);
  assert.deepEqual([...r.hide].sort(), ["email", "name"], "count was not filled and note is read-only");
  assert.deepEqual([...readUrlKeys("?n=Dana", def).hide], []);
  assert.deepEqual(readUrlKeys("", def), { prefill: {}, hide: new Set() });
  assert.deepEqual(readUrlKeys("?", def).prefill, {});
});

test("device class from the user agent", () => {
  assert.equal(deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148"), "mobile");
  assert.equal(deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Mobile Safari"), "mobile");
  assert.equal(deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
  assert.equal(deviceClass("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit Safari"), "tablet");
  assert.equal(deviceClass("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120"), "desktop");
  assert.equal(deviceClass(""), "desktop");
});

const base = { search: "?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=G1&fbclid=F1&msclkid=&other=1", referrer: "https://news.example/story?id=1#top", href: "https://example.com/f/intake?x=1#y", userAgent: "Mozilla/5.0 (iPhone) Mobile", timeZone: "Europe/Lisbon" };

test("attribution with consent: UTMs, click ids, the referrer's address without its query, the landing page, device and time zone", () => {
  assert.deepEqual(captureAttribution({ ...base, consent: true }), {
    consent: true, utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", referrer: "https://news.example/story", landingPage: "https://example.com/f/intake",
    clickIds: { gclid: "G1", fbclid: "F1" }, device: "mobile", location: "Europe/Lisbon",
  });
});

test("attribution without consent: only the UTMs and the referring host; no click id, landing page, device or place", () => {
  assert.deepEqual(captureAttribution({ ...base, consent: false }), { consent: false, utmSource: "google", utmMedium: "cpc", utmCampaign: "spring", referrer: "news.example" });
});

test("attribution survives missing or odd inputs: no referrer, a referrer that is not an address, no click ids, a very long UTM, a missing time zone", () => {
  assert.deepEqual(captureAttribution({ search: "", referrer: "", href: "https://example.com/f/a", userAgent: "x", consent: true }), { consent: true, landingPage: "https://example.com/f/a", device: "desktop" });
  assert.deepEqual(captureAttribution({ search: "", referrer: "not an address", href: "nonsense", userAgent: "x", consent: true }), { consent: true, device: "desktop" });
  const long = captureAttribution({ search: `?utm_source=${"a".repeat(900)}`, referrer: "", href: "", userAgent: "", consent: false });
  assert.equal((long.utmSource as string).length, 500);
  assert.deepEqual(captureAttribution({ search: "?utm_source=%20%20", referrer: "", href: "", userAgent: "", consent: false }), { consent: false });
});
