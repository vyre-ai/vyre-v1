// ui/Overlay: one root layer at the end of the body holds every menu, popover and sheet, so nothing painted later in the page can cover them.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { OVERLAY_ROOT_CSS, OVERLAY_ROOT_ID, Overlay, ensureOverlayRoot } from "./index.tsx";
import type { OverlayDocument, OverlayElement } from "./index.tsx";
import { MenuPortal, ensureOverlayRoot as menuEnsure } from "../Menu/portal.tsx";
import { Menu } from "../Menu/index.tsx";

function fakeDoc(): { doc: OverlayDocument; appended: OverlayElement[]; made: () => number } {
  const byId = new Map<string, OverlayElement>();
  const appended: OverlayElement[] = [];
  let made = 0;
  const doc: OverlayDocument = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: () => {
      made += 1;
      const attrs: Record<string, string> = {};
      return { id: "", style: { cssText: "" }, setAttribute: (n, v) => { attrs[n] = v; } };
    },
    body: { appendChild: (el) => { appended.push(el); byId.set(el.id, el); } },
  };
  return { doc, appended, made: () => made };
}

test("the root layer is made once, at the end of the body, with the overlay id", () => {
  const { doc, appended, made } = fakeDoc();
  const a = ensureOverlayRoot(doc);
  const b = ensureOverlayRoot(doc);
  assert.ok(a);
  assert.equal(a, b, "the second call finds the first");
  assert.equal(made(), 1);
  assert.equal(appended.length, 1);
  assert.equal(a.id, OVERLAY_ROOT_ID);
});

test("the layer takes no room and blocks nothing: fixed, zero size, above every app layer", () => {
  const { doc } = fakeDoc();
  const root = ensureOverlayRoot(doc);
  assert.equal(root?.style.cssText, OVERLAY_ROOT_CSS);
  assert.match(OVERLAY_ROOT_CSS, /position:fixed/);
  assert.match(OVERLAY_ROOT_CSS, /width:0;height:0/);
  assert.match(OVERLAY_ROOT_CSS, /overflow:visible/);
  assert.match(OVERLAY_ROOT_CSS, /z-index:2147483000/);
  assert.doesNotMatch(OVERLAY_ROOT_CSS, /pointer-events/, "pointer events are not switched off, so children keep theirs");
});

test("with no document or no body there is no layer", () => {
  assert.equal(ensureOverlayRoot({ getElementById: () => null, createElement: () => ({ id: "", style: { cssText: "" }, setAttribute: () => {} }), body: null }), null);
  assert.equal(ensureOverlayRoot(undefined), null);
});

test("the menu portal and the overlay share one root", () => {
  assert.equal(menuEnsure, ensureOverlayRoot);
});

test("a server render draws the children in place, so tests and the static export see the plain tree", () => {
  const html = renderToStaticMarkup(<div><Overlay><span data-x="1">inside</span></Overlay></div>);
  assert.match(html, /<div><span data-x="1">inside<\/span><\/div>/);
  const viaMenu = renderToStaticMarkup(<MenuPortal><b>menu</b></MenuPortal>);
  assert.equal(viaMenu, "<b>menu</b>");
});

test("a menu keeps its layer, backdrop and panel when drawn through the overlay", () => {
  const html = renderToStaticMarkup(<Menu items={[{ label: "Rename" }, { label: "Delete" }]} x={20} y={30} source="context" />);
  assert.match(html, /data-testid="menu-layer"/);
  assert.match(html, /aria-label="Close menu"/);
  assert.match(html, /data-testid="menu"/);
  assert.match(html, /data-testid="menu-item-Rename"/);
});
