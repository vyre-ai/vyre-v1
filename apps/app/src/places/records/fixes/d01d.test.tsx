// @reads ../../../../../../scripts/shots/mounts/P-L9d_01d.tsx
// P-L9d_01d: the last polish of the Records table. Five stars a row with the missing ones outlined, a leading dot on each status and choice chip, this year's dates as "23 Oct", and the Starred
// group of the sidebar from stars.list: a face for a person, the type's tile for the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { createFakeReplica, liveQuery } from "../../../../../../client/src/index.ts";
import { RecordsDataProvider, RecordsSidebar, RecordsStateProvider } from "../sidebar/index.ts";
import { RecordViews } from "../views-a/index.ts";
import { createViewsSample } from "../views-a/sample.ts";
import { dateText } from "../table/index.ts";
import { PROTO_CLIENT_HIDDEN, protoNorthwindSpace } from "../table/sample.ts";
import { StarredGroup, starKind } from "../starred/index.ts";
import type { StarsOut } from "../starred/index.ts";

const render = (child: ReactElement, type = "clients"): string => {
  const s = createViewsSample(protoNorthwindSpace);
  return renderToStaticMarkup(<RecordsDataProvider value={s.data}><RecordsStateProvider initial={{ type }}>{child}</RecordsStateProvider></RecordsDataProvider>).replaceAll("<!-- -->", "");
};
const has = (s: string, needle: string): boolean => s.includes(needle);
const table = (): string => render(<RecordViews kind="table" view={{ sort: [{ field: "since", dir: "desc" }], hidden: PROTO_CLIENT_HIDDEN }} />);

test("a rating is five stars: the ones it has filled and the rest outlined, and a row with none has five outlines", () => {
  const out = table();
  assert.ok(has(out, "\u2605\u2605\u2605\u2605") && has(out, "\u2606"), "four filled and one outlined for a rating of 4");
  assert.ok(has(out, `class="vrt-so">${"\u2606".repeat(5)}<`), "a row with no rating draws five outlines");
  assert.ok(has(out, 'aria-label="4 of 5"') && has(out, 'aria-label="0 of 5"'));
});

test("a status or choice chip has its colour dot in front, set by the chip's hue", () => {
  const out = table();
  assert.ok(/class="vrt-chip" style="[^"]*--h:\d+/.test(out), "the hue the dot is drawn in");
  assert.ok(has(out, "Consult booked") && has(out, "Paid search"));
});

test("this year's dates are short, another year's keep the year", () => {
  const now = Date.UTC(2026, 9, 26);
  assert.equal(dateText(Date.UTC(2026, 9, 23), false, now), "23 Oct");
  assert.equal(dateText(Date.UTC(2025, 9, 24), false, now), "Oct 24, 2025");
  assert.equal(dateText(Date.UTC(2026, 9, 23, 14, 5), true, now), "23 Oct, 2:05 PM");
});

const STARS: StarsOut = { stars: [
  { resource: { type: "record", id: "cl_c1" }, title: "Elena Rivera", at: 3 },
  { resource: { type: "record", id: "projects_0" }, title: "Rivera engagement", at: 2 },
  { resource: { type: "record", id: "mt_1" }, title: "Consult \u00b7 Elena Rivera", at: 1 },
] };
const typeOf = (id: string): string | undefined => (id.startsWith("cl_") ? "clients" : id.startsWith("projects_") ? "projects" : id.startsWith("mt_") ? "meetings" : undefined);
function starred(stars: StarsOut, closed = false): string {
  const replica = createFakeReplica("t");
  replica.resolve("stars.list", () => stars);
  return renderToStaticMarkup(<StarredGroup query={liveQuery(replica, "stars.list", {})} typeOf={typeOf} onOpen={() => undefined} closed={closed} />).replaceAll("<!-- -->", "");
}

test("the Starred group lists the stars newest first, a face for a person and a tile for the rest", () => {
  const out = starred(STARS);
  assert.ok(has(out, 'data-testid="records-starred"') && has(out, ">Starred<"));
  assert.ok(out.indexOf("Elena Rivera") < out.indexOf("Rivera engagement") && out.indexOf("Rivera engagement") < out.indexOf("Consult"), "in the order stars.list gives");
  assert.ok(has(out, 'data-testid="face-Elena Rivera"'), "a client is a face");
  assert.ok(!has(out, 'data-testid="face-Rivera engagement"') && !has(out, 'data-testid="face-Consult'), "a project and a meeting are tiles");
  assert.equal(starKind(STARS.stars[1]!, typeOf), "projects");
  assert.equal(starKind({ resource: { type: "file", id: "f1" }, title: "x", at: 0 }, typeOf), "file", "a thing that is not a record shows as its own kind");
});

test("no stars, no group; a folded group keeps its header and drops its rows", () => {
  assert.equal(starred({ stars: [] }), "");
  const folded = starred(STARS, true);
  assert.ok(has(folded, ">Starred<") && !has(folded, "Elena Rivera"));
});

test("the sidebar draws the Starred group between the record types and the saved views, and leaves it out when the runtime has no stars", () => {
  const replica = createFakeReplica("t");
  replica.resolve("stars.list", () => STARS);
  const withStars = render(<RecordsSidebar starred={<StarredGroup query={liveQuery(replica, "stars.list", {})} typeOf={typeOf} onOpen={() => undefined} />} />);
  assert.ok(withStars.indexOf('data-testid="sec-starred"') > withStars.indexOf("Booking widget") && withStars.indexOf('data-testid="sec-starred"') < withStars.indexOf('data-testid="sec-views"'), "after Sites, before Saved views");
  const plain = render(<RecordsSidebar />);
  assert.ok(!has(plain, 'data-testid="records-starred"'), "the sample runtime answers no stars, so no group");
  assert.ok(has(plain, 'data-testid="sec-views"') && has(plain, 'data-testid="sec-manage"'));
});
