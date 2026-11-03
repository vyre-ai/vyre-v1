// ui/ArtifactCard: the one quiet line, the filter and sort, and the card as it draws (title, line, Open, Copy link, "...", a hover-ready press target).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactCard, emptyLine, filterArtifacts, linkOf, sharingLine, standIn, subline, whenLabel } from "./index.tsx";
import type { ArtifactInfo } from "./index.tsx";

const at = (y: number, m: number, d: number, h: number, min: number): number => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 11, 4, 16, 0);
const A: ArtifactInfo = { id: "sit_1", name: "Pricing comparison", owner: "me", access: "private", updatedAt: at(2026, 11, 4, 3, 53) };

test("the time says 3:53 today, yesterday, the weekday in the week, then the date", () => {
  assert.equal(whenLabel(at(2026, 11, 4, 3, 53), NOW), "3:53");
  assert.equal(whenLabel(at(2026, 11, 4, 15, 5), NOW), "15:05");
  assert.equal(whenLabel(at(2026, 11, 3, 23, 59), NOW), "yesterday");
  assert.equal(whenLabel(at(2026, 11, 2, 9, 0), NOW), "Monday");
  assert.equal(whenLabel(at(2026, 10, 1, 9, 0), NOW), new Date(at(2026, 10, 1, 9, 0)).toLocaleDateString());
  assert.equal(whenLabel(undefined, NOW), "");
});

test("the quiet line reads Page, who can see it, when it changed", () => {
  assert.equal(subline(A, "me", NOW), "Page · Private to you · updated 3:53");
  assert.equal(subline({ ...A, sharedWith: ["Sara", "Omar"] }, "me", NOW), "Page · Shared with Sara and Omar · updated 3:53");
  assert.equal(sharingLine({ ...A, sharedWith: ["Aliza"] }, "me"), "Shared with Aliza");
  assert.equal(sharingLine({ ...A, access: "space" }, "me"), "Shared with the Space");
  assert.equal(sharingLine({ ...A, owner: "sara" }, "me", () => "Sara"), "Shared by Sara");
  assert.equal(subline({ ...A, updatedAt: undefined }, "me", NOW), "Page · Private to you");
});

test("Mine, Shared with me and All filter by owner; the search matches the name; the newest update is first", () => {
  const rows: ArtifactInfo[] = [
    { id: "a", name: "Old one", owner: "me", updatedAt: 1 },
    { id: "b", name: "Launch timeline", owner: "sara", updatedAt: 5 },
    { id: "c", name: "Pricing comparison", owner: "me", updatedAt: 9 },
  ];
  assert.deepEqual(filterArtifacts(rows, "Mine", "", "me").map((r) => r.id), ["c", "a"]);
  assert.deepEqual(filterArtifacts(rows, "Shared with me", "", "me").map((r) => r.id), ["b"]);
  assert.deepEqual(filterArtifacts(rows, "All", "", "me").map((r) => r.id), ["c", "b", "a"]);
  assert.deepEqual(filterArtifacts(rows, "All", " PRIC ", "me").map((r) => r.id), ["c"]);
});

test("an empty list says why, in one line", () => {
  assert.equal(emptyLine("Mine", "", false), "Nothing published yet");
  assert.equal(emptyLine("Shared with me", "", true), "Nobody has shared an artifact with you yet");
  assert.equal(emptyLine("Mine", "zzz", true), "Nothing matches “zzz”");
});

test("an address is the full url as given, else the path on this app's origin; a card keeps its drawing", () => {
  assert.equal(linkOf({ path: "/x/1", url: "https://a.test/x/1" }, "https://app.test"), "https://a.test/x/1");
  assert.equal(linkOf({ path: "/a/s/" }, "https://app.test/"), "https://app.test/a/s/");
  assert.equal(standIn("sit_1"), standIn("sit_1"));
});

test("the card shows the title, the line, Open, Copy link and More, and is one link that opens the artifact", () => {
  const html = renderToStaticMarkup(<ArtifactCard info={A} meId="me" now={NOW} onOpen={() => undefined} onCopyLink={() => undefined} onShare={() => undefined} onBrowser={() => undefined} onDelete={() => undefined} />);
  assert.match(html, /Pricing comparison/);
  assert.match(html, /Page · Private to you · updated 3:53/);
  assert.match(html, /aria-label="Open Pricing comparison"/);
  for (const w of ["Open", "Copy link", "More"]) assert.match(html, new RegExp(`aria-label="${w}"`));
  assert.match(html, /artifact-thumb-drawn/);
  assert.doesNotMatch(html, /From /);
});

test("in the grid a card names the chat that made it, and a picture replaces the drawing", () => {
  const html = renderToStaticMarkup(<ArtifactCard grid info={{ ...A, thumb: "data:image/png;base64,AA", from: { id: "thr_1", title: "Monthly numbers" } }} meId="me" now={NOW} onOpen={() => undefined} onCopyLink={() => undefined} onShare={() => undefined} onBrowser={() => undefined} onFrom={() => undefined} />);
  assert.match(html, /From Monthly numbers/);
  assert.match(html, /artifact-thumb/);
  assert.doesNotMatch(html, /artifact-thumb-drawn/);
});
