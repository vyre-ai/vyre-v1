// ui/InlineConfirm: the in-place confirmation. The machine is tested pure (every transition), the strip through the fake DOM (a double-press on the button that opened it never deletes; Cancel is focused; Escape cancels).
import test from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { escapeLayers } from "../Overlay/escape.ts";
import { useState } from "react";
import { setReportProblemHandler } from "../Menu/index.tsx";
import { InlineConfirm, step } from "./index.tsx";
import type { ConfirmEvent, ConfirmState } from "./logic.ts";

test("the machine: confirm does nothing while wary or spent, fires when armed, then waits to arm again; cancel works in every live state and ends it", () => {
  const states: ConfirmState[] = ["wary", "armed", "spent", "gone"];
  const events: ConfirmEvent[] = ["arm", "confirm", "cancel"];
  const want: Record<string, string> = {
    "wary arm": "armed/-",
    "wary confirm": "wary/-",
    "wary cancel": "gone/cancel",
    "armed arm": "armed/-",
    "armed confirm": "spent/confirm",
    "armed cancel": "gone/cancel",
    "spent arm": "armed/-",
    "spent confirm": "spent/-",
    "spent cancel": "gone/cancel",
    "gone arm": "gone/-",
    "gone confirm": "gone/-",
    "gone cancel": "gone/-",
  };
  for (const st of states)
    for (const ev of events) {
      const r = step(st, ev);
      assert.equal(`${r.state}/${r.fire ?? "-"}`, want[`${st} ${ev}`], `${st} + ${ev}`);
    }
});

test("no sequence of events fires before it is armed, or twice without an arm between, or after a cancel", () => {
  const events: ConfirmEvent[] = ["arm", "confirm", "cancel"];
  let seed = 7;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let run = 0; run < 500; run++) {
    let st: ConfirmState = "wary";
    let armed = false;
    let cancelled = false;
    for (let i = 0; i < 14; i++) {
      const ev = events[Math.floor(rnd() * 3)]!;
      if (ev === "arm" && !cancelled) armed = true;
      const r = step(st, ev);
      if (r.fire === "confirm") {
        assert.ok(armed, "fired before it was armed (or twice without an arm between)");
        assert.ok(!cancelled, "fired after a cancel");
        armed = false;
      }
      if (r.fire === "cancel") cancelled = true;
      st = r.state;
    }
  }
});

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test("the double-press: the press that opened the strip, pressed again at once, does not land on Delete; after the wait it deletes once", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete “Q3 plan”?"
        confirmLabel="Delete"
        armMs={80}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, [], "two quick presses delete nothing");
    await wait(120);
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "once armed, one delete, however many presses");
  } finally {
    restore();
  }
});

test("a delete that failed and left the strip open can be tried again: press, fail, the wait, press fires again; a double-press in between fires nothing", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={60}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await wait(100);
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "three quick presses delete once");
    await wait(120);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete"], "the strip is still there and armed again: the retry fires");
    await press(find(root, "ic-cancel"));
    await wait(120);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete", "cancel"], "after Cancel nothing fires, however long it waits");
  } finally {
    restore();
  }
});

test("a slow action never fires twice: with a promise the strip arms again only when it settles", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={40}
        onConfirm={() => {
          log.push("delete");
          return new Promise<void>((r) => setTimeout(r, 250)); // a request that takes much longer than the wait
        }}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await wait(80);
    await press(find(root, "ic-go"));
    await wait(120); // past the wait, the request still running
    await press(find(root, "ic-go"));
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "a second press during the request fires nothing");
    await wait(300);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete"], "the request ended and the strip is still here: it can be tried again");
  } finally {
    restore();
  }
});

test("a rejected confirm shows its own line, opens nothing by itself, re-arms, and Report is the person's choice with only a safe code in it", async () => {
  const restore = installDom();
  const reports: string[] = [];
  const off = setReportProblemHandler((c) => void reports.push(c.label ?? ""));
  const thrown: unknown[] = [];
  const onThrow = (e: unknown): void => void thrown.push(e);
  process.on("uncaughtException", onThrow);
  try {
    const log: string[] = [];
    const root = await mount(
      createRoot,
      <InlineConfirm
        testID="ic"
        question="Delete?"
        confirmLabel="Delete"
        armMs={30}
        onConfirm={() => {
          log.push("delete");
          // a gateway-shaped rejection: a plain object with a message that names a record
          return Promise.reject({ error: { code: "access.denied", message: "Cannot delete Ada Lovelace (rec_123)" } });
        }}
        onCancel={() => undefined}
        confirmTestID="ic-go"
      />,
    );
    await wait(60);
    await press(find(root, "ic-go"));
    await wait(100);
    assert.deepEqual(reports, [], "nothing opens by itself");
    const line = textOf(find(root, "ic-failed"));
    assert.match(line, /You don't have access to delete this\./, "the person reads what the gateway said");
    assert.doesNotMatch(line, /object Object/);
    await press(find(root, "ic-go"));
    await wait(100);
    assert.deepEqual(log, ["delete", "delete"], "armed again after the failure");
    await press(find(root, "ic-report"));
    assert.deepEqual(
      reports,
      ["Delete failed (access.denied)"],
      "one report, by choice, with the code and no names or ids",
    );
    assert.deepEqual(thrown, [], "nothing global is thrown");
  } finally {
    process.off("uncaughtException", onThrow);
    off();
    restore();
  }
});

test("the failure line is plain words chosen from the code, never the server's message", async () => {
  const restore = installDom();
  try {
    for (const [err, want] of [
      [
        { error: { code: "access.denied", message: "no grant for rec_9 on 10.0.0.4:5432" } },
        /^You don't have access to delete this\.\s*$/,
      ],
      [
        { error: { code: "conflict.stale", message: "version 4 != 5 (select * from t)" } },
        /^It changed first\. Try again\.\s*$/,
      ],
      [new Error("connect ECONNREFUSED 10.0.0.4:5432"), /^Couldn't reach the Space\.\s*$/],
      [new TypeError("Failed to fetch"), /^Couldn't reach the Space\.\s*$/],
      [{ error: { code: "internal.sql", message: "syntax error at or near" } }, /^That did not work\.\s*$/],
      ["boom for Ada Lovelace", /^That did not work\.\s*$/],
    ] as const) {
      const root = await mount(
        createRoot,
        <InlineConfirm
          testID="ic"
          question="Delete?"
          confirmLabel="Delete"
          armMs={20}
          onConfirm={() => Promise.reject(err)}
          onCancel={() => undefined}
          confirmTestID="ic-go"
        />,
      );
      await wait(50);
      await press(find(root, "ic-go"));
      await wait(60);
      const line = textOf(find(root, "ic-failed")).replace(/Report\s*$/, "");
      assert.match(line, want);
      assert.doesNotMatch(line, /10\.0\.0\.4|rec_9|select|Lovelace|object Object/, "no server text reaches the screen");
    }
  } finally {
    restore();
  }
});

test("in the compact row the failure line is one line that gives way (ellipsis), so Delete and Cancel stay on the strip", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");
  assert.match(
    src,
    /compact: \{ flexDirection: "row", flexWrap: "nowrap"/,
    "the compact row does not wrap its buttons off",
  );
  assert.match(src, /<Text numberOfLines=\{1\} style=\{s\.failed\}>/, "one line, ellipsised");
  assert.match(src, /failedRow: \{[^}]*flexShrink: 1[^}]*minWidth: 0/, "the line shrinks");
  assert.match(src, /failed: \{ flexShrink: 1, minWidth: 0/);
});

test("a compact strip shows the failure line too", async () => {
  const restore = installDom();
  try {
    const root = await mount(
      createRoot,
      <InlineConfirm
        compact
        testID="ic"
        question="Delete?"
        confirmLabel="Delete"
        armMs={20}
        onConfirm={() => Promise.reject(new Error("x"))}
        onCancel={() => undefined}
        confirmTestID="ic-go"
      />,
    );
    await wait(50);
    await press(find(root, "ic-go"));
    await wait(60);
    assert.ok(find(root, "ic-failed"));
  } finally {
    restore();
  }
});

test("a caller that shows its work with busy holds the strip until busy ends", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    function Host(): ReturnType<typeof InlineConfirm> {
      const [busy, setBusy] = useState(false);
      return (
        <InlineConfirm
          question="Delete?"
          confirmLabel="Delete"
          armMs={40}
          busy={busy}
          onConfirm={() => {
            log.push("delete");
            setBusy(true);
            setTimeout(() => setBusy(false), 250);
          }}
          onCancel={() => log.push("cancel")}
          confirmTestID="ic-go"
        />
      );
    }
    const root = await mount(createRoot, <Host />);
    await wait(80);
    await press(find(root, "ic-go"));
    await wait(120);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete"], "still busy after the wait: no second delete");
    await wait(300);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["delete", "delete"], "busy ended: armed again");
  } finally {
    restore();
  }
});

test("Cancel stops the arm timer: afterwards Delete stays disabled however long the strip is left mounted", async () => {
  const restore = installDom();
  try {
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={80}
        onConfirm={() => undefined}
        onCancel={() => undefined}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    await press(find(root, "ic-cancel")); // cancelled while still wary
    await wait(200);
    assert.equal(find(root, "ic-go")?.props["aria-disabled"], true, "Delete never looks live after a cancel");
  } finally {
    restore();
  }
});

test("when the strip goes, focus returns to the button that opened it, found again by its test id when the strip replaced it (even a hover-only button)", async () => {
  const restore = installDom();
  const doc = (globalThis as unknown as { document: Record<string, unknown> }).document;
  const was = { active: doc["activeElement"], query: doc["querySelector"] };
  try {
    const focused: string[] = [];
    const opener = {
      tagName: "BUTTON",
      isConnected: true,
      getAttribute: () => "row-act",
      focus: () => focused.push("old"),
    };
    doc["activeElement"] = opener; // the press on the opener: it holds focus while the strip renders
    const again = { focus: () => focused.push("new") };
    doc["querySelector"] = (q: string) => (q.includes("row-act") ? again : null);
    const r = createRoot();
    await act(async () => {
      r.render(
        <InlineConfirm
          question="Delete?"
          confirmLabel="Delete"
          armMs={50}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    opener.isConnected = false; // the strip replaced the opener in the page
    doc["activeElement"] = { tagName: "BODY" }; // the strip's own Cancel went with it
    await act(async () => {
      r.render(<></>);
    });
    await wait(30);
    assert.deepEqual(focused, ["new"], "the button that is there now takes focus, not the old node");
    // something else holds focus: it is left alone
    focused.length = 0;
    doc["activeElement"] = opener;
    opener.isConnected = true;
    const r2 = createRoot();
    await act(async () => {
      r2.render(
        <InlineConfirm
          question="Delete?"
          confirmLabel="Delete"
          armMs={50}
          onConfirm={() => undefined}
          onCancel={() => undefined}
        />,
      );
    });
    doc["activeElement"] = { tagName: "INPUT", isConnected: true };
    await act(async () => {
      r2.render(<></>);
    });
    await wait(30);
    assert.deepEqual(focused, [], `a person who moved on keeps their place`);
  } finally {
    doc["activeElement"] = was.active;
    doc["querySelector"] = was.query;
    restore();
  }
});

test("the confirm tells why it is off", () => {
  const html = renderToStaticMarkup(
    <InlineConfirm
      question="Delete the Space?"
      confirmLabel="Delete"
      disabled
      why="Type the Space's name exactly"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(html.includes("Type the Space&#x27;s name exactly") || html.includes("Type the Space's name exactly"));
});

test("Cancel works at once and takes the strip out of play; Escape cancels through its own layer", async () => {
  const restore = installDom();
  try {
    const log: string[] = [];
    const before = escapeLayers();
    const root = await mount(
      createRoot,
      <InlineConfirm
        question="Delete?"
        confirmLabel="Delete"
        armMs={20}
        onConfirm={() => log.push("delete")}
        onCancel={() => log.push("cancel")}
        confirmTestID="ic-go"
        cancelTestID="ic-cancel"
      />,
    );
    assert.equal(escapeLayers(), before + 1, "the strip is an Escape layer while it shows");
    await press(find(root, "ic-cancel"));
    await wait(60);
    await press(find(root, "ic-go"));
    await flush();
    assert.deepEqual(log, ["cancel"], "after a cancel the strip never deletes");
  } finally {
    restore();
  }
});

test("it reads the question and the note, Cancel then the danger button, and a non-destructive ask uses the accent", () => {
  const html = renderToStaticMarkup(
    <InlineConfirm
      question="Delete “Q3 plan”?"
      note="It cannot be undone."
      confirmLabel="Delete"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(html.includes("Delete “Q3 plan”?") && html.includes("It cannot be undone."));
  assert.ok(html.indexOf('aria-label="Cancel"') < html.indexOf('aria-label="Delete"'), "Cancel first");
  assert.ok(html.includes("var(--danger)"));
  const calm = renderToStaticMarkup(
    <InlineConfirm
      danger={false}
      question="Leave?"
      confirmLabel="Leave"
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  );
  assert.ok(!calm.includes("var(--danger)") && calm.includes("var(--accent)"));
});
