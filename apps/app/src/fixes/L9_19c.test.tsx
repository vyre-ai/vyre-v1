// P-L9_19c: the shell's Home place draws the real Home body (greeting, Needs you with action buttons, My work, Quick start and the Ask box), not the sample rows.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SamplePlace } from "../shell/spaces/sample.tsx";
import { homePlace, homeVariantOf } from "../shell/spaces/sample-home.tsx";
import { StyleSheet } from "react-native";
import { ASK_DOCK } from "../places/home/sections-b/AskBox.tsx";
import { statusIcon } from "../places/home/sections-a/model.ts";
import type { PlaceContext } from "../shell/spaces/Shell.tsx";
import { kitById } from "../shell/rail/kits.ts";

const ctx = (spaceId: string, place: PlaceContext["place"]): PlaceContext => ({ spaceId, spaceName: spaceId, kind: spaceId === "me" ? "personal" : "team", place, hash: "", epoch: 1, kit: kitById("northwind") });
const html = (spaceId: string, place: PlaceContext["place"] = "home"): string => renderToStaticMarkup(<>{homePlace(ctx(spaceId, place))}</>).replaceAll("<!-- -->", "");
const at = (s: string, needle: string): number => { const i = s.indexOf(needle); assert.ok(i >= 0, `expected ${needle}`); return i; };

test("a shell Space id maps to its sample Home", () => {
  assert.equal(homeVariantOf("nw"), "northwind");
  assert.equal(homeVariantOf("hb"), "harbor");
  assert.equal(homeVariantOf("me"), "personal");
});

test("Northwind Home is the real page: greeting, Needs you, My work, then Quick start and the Ask box last", () => {
  const out = html("nw");
  assert.ok(out.includes('data-testid="home-place"'), "the Home place, not the sample list");
  assert.ok(!out.includes('data-testid="sample-home"'), "no router placeholder");
  assert.match(out, /Good (morning|afternoon|evening), Irfad/);
  const order = ["s-needs", "s-work", "s-ask"].map((id) => at(out, `data-testid="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(at(out, "Quick start") > at(out, 'data-testid="s-work"'));
  assert.ok(out.includes("Ask your assistant"));
});

test("Needs you carries its action buttons", () => {
  const out = html("nw");
  assert.ok(out.slice(at(out, 'data-testid="s-needs"'), at(out, 'data-testid="s-work"')).includes('data-testid="need-action-'), "an action button sits in Needs you");
});

test("Harbor Studio and Personal draw their own Home", () => {
  const harbor = html("hb");
  const personal = html("me");
  assert.ok(harbor.includes('data-testid="home-place"') && personal.includes('data-testid="home-place"'));
  assert.notEqual(harbor, personal);
});

test("every other place keeps its sample rows", () => {
  for (const place of ["chats", "inbox", "records", "files"] as const) {
    const el = homePlace(ctx("nw", place)) as ReactElement<{ ctx: PlaceContext }>;
    assert.equal(el.type, SamplePlace, place);
    assert.equal(el.props.ctx.place, place);
  }
});

test("My work carries the list/board toggle, the review mark and the project label as the prototype", () => {
  const out = html("nw");
  assert.ok(out.includes('data-testid="work-view-list"') && out.includes('data-testid="work-view-board"'), "the layout toggle");
  assert.ok(out.includes('aria-checked="true"'), "one layout is on");
  assert.ok(out.includes("ATP · Harlow &amp; Price") || out.includes("ATP · Harlow & Price"), "the project label is the whole name");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "review" }), "review");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "approve" }), "review");
  assert.equal(statusIcon({ state: "todo", blocked: false, kind: "work" }), "todo");
});

test("Quick start and the Ask composer are the last section, docked", () => {
  const out = html("nw");
  assert.ok(at(out, 'data-testid="s-ask"') > at(out, 'data-testid="s-work"'));
  const dock = StyleSheet.flatten(ASK_DOCK) as Record<string, unknown>;
  assert.equal(dock["position"], "sticky", "sticks to the foot of the place");
  assert.equal(dock["bottom"], 0);
});
