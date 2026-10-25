// Route files. Loading expo-router needs the full React Native runtime, which plain node cannot do (a CJS require of react-native
// bypasses the web alias), so these are checked two ways: the type imports make the compiler check each route's exports, and the
// source is read for the exports Expo needs. The routes' behaviour is covered by the startup probe in the shots workflow.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type * as PlaceRoute from "../../app/[place].tsx";
import type * as Layout from "../../app/_layout.tsx";
import type * as Index from "../../app/index.tsx";
import type * as Html from "../../app/+html.tsx";

type RouteShape = { default: unknown };
const typed: RouteShape[] = [] as unknown as (typeof PlaceRoute | typeof Layout | typeof Index | typeof Html)[];
const read = (p: string) => fs.readFileSync(new URL(`../../app/${p}`, import.meta.url), "utf8");

test("each route file default-exports a component", () => {
  assert.equal(typed.length, 0);
  for (const f of ["[place].tsx", "_layout.tsx", "index.tsx", "+html.tsx"]) assert.match(read(f), /export default function \w+/, f);
});

test("[place] exports generateStaticParams so every place gets a page", () => {
  assert.match(read("[place].tsx"), /export function generateStaticParams/);
});

test("the document renders Expo's head and body nodes, or the export ships no JavaScript", () => {
  const src = read("+html.tsx");
  assert.match(src, /\{headNodes\}/);
  assert.match(src, /\{bodyNodes\}/);
});

test("a place is loaded with a dynamic import, so only the active place bundle loads", () => {
  assert.match(fs.readFileSync(new URL("./places.ts", import.meta.url), "utf8"), /import\("\.\/PlaceholderPlace\.tsx"\)/);
});
