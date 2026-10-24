// The route files render to markup in plain node (react-native mapped to react-native-web, ruling 21) and export what Expo needs.
import test from "node:test";
import assert from "node:assert/strict";
import * as placeRoute from "../../app/[place].tsx";
import * as layout from "../../app/_layout.tsx";
import * as index from "../../app/index.tsx";
import * as html from "../../app/+html.tsx";
import { PLACES } from "./places.ts";

test("[place] exports a default route and static params for every place", () => {
  assert.equal(typeof placeRoute.default, "function");
  assert.deepEqual(placeRoute.generateStaticParams().map((p: { place: string }) => p.place), [...PLACES]);
});

test("the layout, index and document are default-exported components", () => {
  for (const m of [layout, index, html]) assert.equal(typeof m.default, "function");
});
