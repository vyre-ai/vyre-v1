// The Space image wherever the Space shows its face: the rail tile and the switcher (shell), and the screens about one Space before sign-in (sign-in, join, an invite). With an image set the
// letter never shows; without one it does. The open Space's image follows Console at once (hub.setFace).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SpaceTile, imageIcon, spaceMenuEntries } from "./SpaceSwitcher.tsx";
import { HARBOR, NORTHWIND, PERSONAL } from "./model.ts";
import { createShellHub } from "./hub.ts";
import { JoinFrame, Panel, SpaceImageContext, SpaceTile as EntryTile } from "../../join/kit.tsx";

const IMG = "data:image/png;base64,iVBORw0KGgo=";
const noop = (): void => undefined;
const withImage = { ...NORTHWIND, image: IMG, imageKey: "fil_logo" };

test("the rail tile shows the Space image in place of the letter, and the letter when there is none", () => {
  const html = renderToStaticMarkup(<SpaceTile spaces={[withImage, HARBOR]} openId="nw" away={false} onSwitch={noop} onAction={noop} />);
  assert.ok(html.includes('data-testid="space-tile-image"'), "the image");
  assert.ok(html.includes(IMG));
  assert.ok(!/>N</.test(html), "no letter");
  const plain = renderToStaticMarkup(<SpaceTile spaces={[NORTHWIND, HARBOR]} openId="nw" away={false} onSwitch={noop} onAction={noop} />);
  assert.ok(!plain.includes("space-tile-image"));
  assert.match(plain, />N</, "the letter");
});

test("the switcher shows each Space's image beside its name", () => {
  const entries = spaceMenuEntries({ spaces: [withImage, HARBOR, PERSONAL], openId: "nw", away: false, onSwitch: noop, onAction: noop });
  const mine = entries.find((e) => "label" in e && e.label === "Northwind") as { icon?: string };
  const other = entries.find((e) => "label" in e && e.label?.startsWith("Harbor Studio")) as { icon?: string };
  assert.match(mine.icon ?? "", /^<svg[^>]*data-space-image="space-face-nw"/, "the image is the row's icon, in the same 16 px slot");
  assert.ok(mine.icon?.includes(`href="${IMG}"`));
  assert.ok(!other.icon?.includes("<image"), "a Space without an image keeps its mark");
  // only a picture is drawn into the menu: anything else is the plain dot
  assert.ok(!imageIcon('data:image/png;base64,AA"><script>', "x").includes("script"));
  assert.ok(!imageIcon("https://evil.example/x.png", "x").includes("<image"));
});

test("the open Space's image follows Console: set, changed, removed; only a change redraws", () => {
  const hub = createShellHub({ spaces: [NORTHWIND, HARBOR], openId: "nw", personId: "p1", deviceId: "d1", storage: null });
  let draws = 0;
  hub.subscribe(() => { draws += 1; });
  hub.setFace({ image: IMG, imageKey: "fil_logo" });
  assert.deepEqual([hub.session().def.image, hub.session().def.imageKey], [IMG, "fil_logo"]);
  hub.setFace({ image: IMG, imageKey: "fil_logo" });
  assert.equal(draws, 1, "the same image again draws nothing");
  hub.setFace(null);
  assert.deepEqual([hub.session().def.image, hub.session().def.imageKey], [undefined, undefined]);
  assert.equal(hub.spaces().find((s) => s.spaceId === "hb")?.image, undefined, "another Space is untouched");
});

test("sign-in, join and invite screens show the Space image the gate provides, else the letter", () => {
  const panel = (image?: string): string => renderToStaticMarkup(
    <JoinFrame><SpaceImageContext.Provider value={image}><Panel space="My Legal Academy"><EntryTile name="unused" image={undefined} /></Panel></SpaceImageContext.Provider></JoinFrame>,
  );
  const shown = panel(IMG);
  assert.equal(shown.split('data-testid="entry-space-image"').length - 1, 2, "the Panel's tile (and any tile inside) shows it");
  assert.ok(!/>M</.test(shown));
  assert.match(panel(undefined), />M</, "no image: the letter");
});
