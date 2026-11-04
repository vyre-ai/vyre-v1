// The shots app draws a mount after hydration (scripts/shots/app/src/ClientOnly.tsx): the page the server draws twice is the same empty page whatever the mount is, so a mount that lays itself out by the
// window cannot differ from the page it hydrates (React error 418 on P-L9f_04 at 1440).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClientOnly } from "./app/src/ClientOnly.tsx";
import fs from "node:fs";

const wide = (width: number) => <ClientOnly><p data-width={width}>the Vault, laid out for {width}</p></ClientOnly>;

test("the server draws the same page twice, and for every window size: no mount content in it", () => {
  const first = renderToStaticMarkup(wide(1440));
  assert.equal(first, renderToStaticMarkup(wide(1440)), "rendered twice, the same");
  assert.equal(first, renderToStaticMarkup(wide(390)), "and the same at another size");
  assert.equal(first, "", "nothing of the mount is in the pre-rendered page");
});

test("the mount route wraps every mount in it", () => {
  const route = fs.readFileSync(new URL("./app/app/m/[id].tsx", import.meta.url), "utf8");
  assert.match(route, /<ClientOnly><Mount \/><\/ClientOnly>/);
});
