// The one tooltip (tips.ts): shown on hover and on keyboard focus after 350 ms, hidden on blur, Escape, scroll and press, one at a time, described to a screen reader, two lines allowed,
// and for a cut name only when the text really is cut. Driven here with a fake window so no browser is needed.
import test from "node:test";
import assert from "node:assert/strict";
import { TIP_DELAY_MS, createTips } from "./tips.ts";

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function el(o: { tt?: string; cut?: boolean; scrollWidth?: number; clientWidth?: number; keyboard?: boolean } = {}) {
  const attrs: Record<string, string> = {};
  const self = {
    dataset: { tt: o.tt, ...(o.cut ? { ttCut: "1" } : {}) } as Record<string, string | undefined>,
    title: "",
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
  const doc = { createElement: () => label, body: { appendChild: () => undefined } };
  const tips = createTips({
    document: doc,
    innerWidth: 1000,
    addEventListener: (t: string, f: (e: never) => void) => handlers.set(t, f as (e: unknown) => void),
  });
  const fire = (type: string, e: unknown = {}): void => handlers.get(type)?.(e);
  return { tips, fire, label };
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
