// One Escape closes one layer (ui/Overlay/escape.ts): the topmost layer only, never the date picker and the dialog under it together; a key an inner field already handled is left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { escapeLayers, pushEscapeLayer } from "./escape.ts";

type Ev = { key?: string; defaultPrevented?: boolean; preventDefault?: () => void; stopPropagation?: () => void };
type Fn = (e: Ev) => void;
/** A document with the two phases a browser has: listeners added with capture run first, the others after, and a stopped key goes no further. */
function fakeDocument(): { press(key: string, defaultPrevented?: boolean): void; count(): number; restore(): void } {
  const g = globalThis as { document?: unknown };
  const had = g.document;
  const cap = new Set<Fn>(),
    bub = new Set<Fn>();
  g.document = {
    addEventListener: (_t: string, f: Fn, c?: boolean) => {
      (c ? cap : bub).add(f);
    },
    removeEventListener: (_t: string, f: Fn, c?: boolean) => {
      (c ? cap : bub).delete(f);
    },
  };
  return {
    press: (key, defaultPrevented = false) => {
      let stopped = false;
      const e: Ev = {
        key,
        defaultPrevented,
        preventDefault() {
          e.defaultPrevented = true;
        },
        stopPropagation() {
          stopped = true;
        },
      };
      for (const f of [...cap]) f(e);
      if (!stopped) for (const f of [...bub]) f(e);
    },
    count: () => cap.size + bub.size,
    restore: () => {
      if (had === undefined) delete g.document;
      else g.document = had;
    },
  };
}

test("Escape goes to the newest layer only; closing it hands the next Escape to the one under it", () => {
  const d = fakeDocument();
  try {
    const ran: string[] = [];
    const offDialog = pushEscapeLayer(() => ran.push("dialog"));
    const offPicker = pushEscapeLayer(() => ran.push("picker"));
    d.press("Escape");
    assert.deepEqual(ran, ["picker"], "the picker closes and the dialog stays");
    offPicker();
    d.press("Escape");
    assert.deepEqual(ran, ["picker", "dialog"]);
    offDialog();
    assert.equal(escapeLayers(), 0);
    assert.equal(d.count(), 0, "no layers, no listener left on the document");
  } finally {
    d.restore();
  }
});

test("other keys do nothing; a layer that asks leaves a key an inner field handled, and the others close whatever a field did with it", () => {
  const d = fakeDocument();
  try {
    const ran: string[] = [];
    const off = pushEscapeLayer(() => ran.push("layer"), { respectHandled: true });
    d.press("Enter");
    d.press("Escape", true);
    assert.deepEqual(ran, []);
    d.press("Escape");
    assert.deepEqual(ran, ["layer"]);
    off();
    const offPlain = pushEscapeLayer(() => ran.push("sheet"));
    d.press("Escape", true); // a search box in a sheet marks the key handled; the sheet still closes
    assert.deepEqual(ran, ["layer", "sheet"]);
    const offOver = pushEscapeLayer(() => ran.push("over"), { respectHandled: true });
    d.press("Escape");
    assert.deepEqual(ran, ["layer", "sheet", "over"], "a popover over a sheet closes first, on the way up");
    offOver();
    offPlain();
  } finally {
    d.restore();
  }
});

test("one listener serves any number of layers", () => {
  const d = fakeDocument();
  try {
    const offs = [pushEscapeLayer(() => undefined), pushEscapeLayer(() => undefined), pushEscapeLayer(() => undefined)];
    assert.equal(d.count(), 2, "one listener for each phase, whatever the number of layers");
    for (const o of offs) o();
    assert.equal(d.count(), 0);
  } finally {
    d.restore();
  }
});

test("when a layer goes, focus returns to the control that opened it (unless something else holds focus)", async () => {
  const g = globalThis as { document?: Record<string, unknown> };
  const had = g.document;
  const body = {};
  const opener = {
    isConnected: true,
    focused: 0,
    focus() {
      this.focused += 1;
    },
  };
  const doc: Record<string, unknown> = {
    body,
    activeElement: opener,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  g.document = doc;
  try {
    const close = pushEscapeLayer(() => undefined);
    doc["activeElement"] = body; // the layer drew and took focus, then went: nothing holds focus
    close();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(opener.focused, 1, "the opener has focus again");
    const other = { isConnected: true };
    const close2 = pushEscapeLayer(() => undefined);
    doc["activeElement"] = other; // a field in the page took focus on purpose
    close2();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(opener.focused, 1, "focus someone else holds is left alone");
  } finally {
    if (had === undefined) delete g.document;
    else g.document = had;
  }
});
