// The rail of the 13 Nov design (2.7): one word under each place, a number only by the one rule, a dot in the accent (coral stays "something is working"), the foot's button says "More".
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { PLACE_TITLE, kitById, railFor } from "./kits.ts";
import { RAIL_WIDTH, RAIL_DOT_COLOR, RAIL_WORD_PX, Rail } from "./Rail.tsx";
import { NORTHWIND } from "../spaces/model.ts";

const html = (counts: Record<string, number> = {}, dots: Record<string, boolean> = {}, active = "files"): string =>
  renderToStaticMarkup(
    <Rail
      groups={railFor({ kit: kitById(NORTHWIND.kit), console: true, counts, dots, active: active as never })}
      active={active as never}
      onSelect={() => undefined}
    />,
  ).replaceAll("<!-- -->", "");

test("each of the five places has its word under the icon", () => {
  const out = html();
  for (const p of ["chats", "inbox", "records", "files", "automations"] as const) {
    const at = out.indexOf(`data-testid="rail-${p}`);
    assert.ok(at >= 0, `${p} button`);
    const button = out.slice(at, out.indexOf("</button>", at));
    assert.match(button, new RegExp(`>${PLACE_TITLE[p]}<`), `${p} has its word`);
  }
});

test("the foot's button is labelled More and holds Apps, Vault, Settings and Console", () => {
  const out = html();
  const at = out.indexOf('data-testid="rail-isle-more"');
  assert.ok(at >= 0);
  assert.match(out.slice(at, out.indexOf("</button>", at)), />More</);
});

test("the rail is wide enough for its longest word at 10 px", () => {
  assert.equal(RAIL_WIDTH, 68);
  assert.equal(RAIL_WORD_PX, 10);
});

test("the dot is the accent, never the live coral; the count keeps its badge", () => {
  assert.equal(RAIL_DOT_COLOR, "var(--accent)");
  const out = html({ chats: 3 }, { inbox: true });
  assert.match(out, /data-testid="rail-dot-inbox"/);
  assert.match(out, /data-testid="rail-count-chats"/);
  assert.match(out, /aria-label="Chats, 3 waiting"/);
});
