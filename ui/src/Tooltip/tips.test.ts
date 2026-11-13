// The one tooltip (tips.ts): shown on hover and on keyboard focus after 350 ms, hidden on blur, Escape, scroll and press, one at a time, described to a screen reader, two lines allowed,
// and for a cut name only when the text really is cut. Driven here with a fake window so no browser is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TIP_DELAY_MS, createTips } from "./tips.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function el(o: { tt?: string; title?: string; label?: string; cut?: boolean; scrollWidth?: number; clientWidth?: number; keyboard?: boolean; text?: string } = {}) {
  const attrs: Record<string, string> = o.label ? { "aria-label": o.label } : {};
  const self = {
    dataset: { tt: o.tt, ...(o.cut ? { ttCut: "1" } : {}) } as Record<string, string | undefined>,
    title: o.title ?? "",
    textContent: o.text ?? "",
    isConnected: true,
    getAttribute: (k: string) => attrs[k] ?? null,
    scrollWidth: o.scrollWidth ?? 50,
    clientWidth: o.clientWidth ?? 50,
    attrs,
    removeAttribute(k: string) {
      if (k === "title") self.title = "";
      delete attrs[k];
    },
    setAttribute(k: string, v: string) {
      attrs[k] = v;
    },
    matches: (q: string) => q === ":focus-visible" && o.keyboard !== false,
    closest: (_q: string) => self,
    getBoundingClientRect: () => ({ left: 100, top: 200, bottom: 220, width: 40, height: 20 }),
    firstElementChild: null as unknown,
  };
  return self;
}

function rig() {
  const handlers = new Map<string, (e: unknown) => void>();
  const label = {
    style: { display: "none" } as Record<string, string>,
    textContent: "",
    offsetWidth: 60,
    offsetHeight: 24,
    attrs: {} as Record<string, string>,
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
  };
  const into: string[] = [];
  const doc = { createElement: () => label, body: { appendChild: () => into.push("body") } };
  const layer = { appendChild: () => into.push("layer") };
  const tips = createTips({
    document: doc,
    layer: () => layer,
    innerWidth: 1000,
    addEventListener: (t: string, f: (e: never) => void) => handlers.set(t, f as (e: unknown) => void),
  });
  const fire = (type: string, e: unknown = {}): void => handlers.get(type)?.(e);
  return { tips, fire, label, into };
}

test("hover shows the tip after 350 ms and not before", async () => {
  assert.equal(TIP_DELAY_MS, 350);
  const { fire, label } = rig();
  fire("mouseover", { target: el({ tt: "Full name" }) });
  assert.equal(label.style["display"], "none");
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.style["display"], "block");
  assert.equal(label.textContent, "Full name");
});

test("keyboard focus shows it too, and the element is described by it while it shows", async () => {
  const { fire, label } = rig();
  const target = el({ tt: "Dana Whitfield\nWhitfield Group" });
  fire("focusin", { target });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.style["display"], "block");
  assert.equal(label.textContent, "Dana Whitfield\nWhitfield Group", "two lines");
  assert.match(label.style["whiteSpace"] ?? "", /pre/);
  assert.equal(label.attrs["role"], "tooltip");
  assert.equal(target.attrs["aria-describedby"], label.attrs["id"]);
  fire("focusout", { target });
  assert.equal(label.style["display"], "none");
  assert.equal(target.attrs["aria-describedby"], undefined);
});

test("a click focus (not the keyboard) does not show it", async () => {
  const { fire, label } = rig();
  fire("focusin", { target: el({ tt: "x", keyboard: false }) });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.style["display"], "none");
});

test("Escape, press and scroll hide it", async () => {
  for (const [type, ev] of [
    ["keydown", { key: "Escape" }],
    ["mousedown", {}],
    ["scroll", {}],
  ] as const) {
    const { fire, label } = rig();
    fire("mouseover", { target: el({ tt: "Full name" }) });
    await wait(TIP_DELAY_MS + 40);
    assert.equal(label.style["display"], "block");
    fire(type, ev);
    assert.equal(label.style["display"], "none", type);
  }
});

test("another key does not hide it", async () => {
  const { fire, label } = rig();
  fire("mouseover", { target: el({ tt: "Full name" }) });
  await wait(TIP_DELAY_MS + 40);
  fire("keydown", { key: "a" });
  assert.equal(label.style["display"], "block");
});

test("one at a time: moving to another element replaces the tip", async () => {
  const { fire, label } = rig();
  fire("mouseover", { target: el({ tt: "First" }) });
  await wait(TIP_DELAY_MS + 40);
  fire("mouseover", { target: el({ tt: "Second" }) });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.textContent, "Second");
});

test("a name marked for cut text shows only when it is cut", async () => {
  const fits = rig();
  fits.fire("mouseover", { target: el({ tt: "Short", cut: true, scrollWidth: 80, clientWidth: 80 }) });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(fits.label.style["display"], "none", "the whole name is on screen: no tooltip");
  const cut = rig();
  cut.fire("mouseover", { target: el({ tt: "A very long name", cut: true, scrollWidth: 160, clientWidth: 80 }) });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(cut.label.style["display"], "block");
});

test("a list whose cursor is a row asks for the tip itself, and takes it back", async () => {
  const { tips, label } = rig();
  const row = el();
  tips.show(row, "Row name\nWho");
  assert.equal(label.style["display"], "block");
  assert.equal(label.textContent, "Row name\nWho");
  tips.hide();
  assert.equal(label.style["display"], "none");
});

test("the tip is drawn through the overlay layer, above dialogs, sheets and menus", async () => {
  const { fire, label, into } = rig();
  fire("mouseover", { target: el({ tt: "A switch in a sheet" }) });
  await wait(TIP_DELAY_MS + 40);
  assert.deepEqual(into, ["layer"], "inside the overlay root, not the body below it");
  assert.match(label.attrs["style"] ?? "", /z-index:2147483647/, "above the menu layer (2147483000) and the dialog veil (99998) in that root");
});

test("when the element goes away while the tip shows, the tip goes too", async () => {
  const { fire, label } = rig();
  const target = el({ tt: "Delete" });
  fire("mouseover", { target });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.style["display"], "block");
  target.isConnected = false;
  await wait(260);
  assert.equal(label.style["display"], "none");
});

test("a Tooltip that unmounts takes its own tip away, and only its own", async () => {
  const { tips, label } = rig();
  const a = el();
  const b = el();
  tips.show(a, "A");
  tips.hideFor(b);
  assert.equal(label.style["display"], "block");
  tips.hideFor(a);
  assert.equal(label.style["display"], "none");
});

test("an icon-only button keeps its accessible name when its title becomes the tip", async () => {
  for (const name of ["Close", "Share", "More options"]) {
    const { fire } = rig();
    const button = el({ title: name });
    fire("mouseover", { target: button });
    assert.equal(button.title, "", `${name}: the title is taken for the tip`);
    assert.equal(button.attrs["aria-label"], name, `${name}: and kept as the name`);
  }
  const named = el({ title: "Owner can change this", label: "Quiet hours" });
  rig().fire("focusin", { target: named });
  assert.equal(named.attrs["aria-label"], "Quiet hours", "a name that was there stays");
});

test("the tip for one thing is gone the moment another is armed", async () => {
  const { fire, label } = rig();
  fire("mouseover", { target: el({ tt: "First" }) });
  await wait(TIP_DELAY_MS + 40);
  assert.equal(label.style["display"], "block");
  fire("mouseover", { target: el({ tt: "Second" }) });
  assert.equal(label.style["display"], "none", "First does not stay up while Second waits");
});

test("the tip's layer order is above the Dialog and full-size Sheet veil and above the Menu layer", () => {
  const src = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  const tipZ = Number(/z-index:(\d+)/.exec(src("./tips.ts"))![1]);
  const veilZ = Number(/veil: \{[^}]*zIndex: (\d+)/.exec(src("../Dialog/index.tsx"))![1]);
  const menuZ = Number(/layer: \{[^}]*zIndex: (\d+)/.exec(src("../Menu/index.tsx"))![1]);
  assert.ok(tipZ > veilZ && tipZ > menuZ, `tip ${tipZ} over veil ${veilZ} and menu ${menuZ}`);
});
