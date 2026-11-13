// Loadable (contract P3): one wrapper that turns a read into one of four things a person sees: the quiet mark while it waits, a plain error with Retry, a real empty state, or the content.
// An error is always drawn: a failed read cannot hide inside the frame as an endless "Loading".
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../testing/dom.ts";
import { Loadable } from "./Loadable.tsx";
import type { Load } from "./Loadable.tsx";

const failure = { message: "The server did not answer.", code: "internal.error", traceId: "tr_9" };
const body = (d: { rows: string[] }) => <>{`rows:${d.rows.join(",")}`}</>;

test("loading draws the quiet mark and never the content or the word Loading", async () => {
  const restore = installDom();
  try {
    const load: Load<{ rows: string[] }> = { state: "loading" };
    const root = await mount(
      createRoot,
      <Loadable load={load} what="the rows">
        {body}
      </Loadable>,
    );
    assert.ok(find(root, "quiet"), "the quiet mark");
    assert.equal(find(root, "load-failed"), null);
    assert.doesNotMatch(textOf(root), /rows:/);
    assert.doesNotMatch(
      textOf(root),
      /Loading/,
      "no word Loading is drawn: the mark carries it for a screen reader only",
    );
  } finally {
    restore();
  }
});

test("a place with a frame of the right size may draw it while it waits", async () => {
  const restore = installDom();
  try {
    const root = await mount(
      createRoot,
      <Loadable load={{ state: "loading" }} what="the rows" loading={<>frame</>}>
        {body}
      </Loadable>,
    );
    assert.match(textOf(root), /frame/);
    assert.equal(find(root, "quiet"), null);
  } finally {
    restore();
  }
});

test("failed draws Couldn't load <what>, the reason and Retry; Retry calls the load's retry once", async () => {
  const restore = installDom();
  let retried = 0;
  try {
    const load: Load<{ rows: string[] }> = { state: "failed", failure, retry: () => void retried++ };
    const root = await mount(
      createRoot,
      <Loadable load={load} what="the rows">
        {body}
      </Loadable>,
    );
    const text = textOf(find(root, "load-failed"));
    assert.match(text, /Couldn't load the rows/);
    assert.match(text, /The server did not answer\./);
    assert.doesNotMatch(textOf(root), /rows:/);
    await press(find(root, "state-retry"));
    await flush();
    assert.equal(retried, 1);
  } finally {
    restore();
  }
});

test("ready draws the content; ready with nothing draws the empty state with its action", async () => {
  const restore = installDom();
  let pressed = 0;
  try {
    const ready = await mount(
      createRoot,
      <Loadable
        load={{ state: "ready", data: { rows: ["a", "b"] } }}
        what="the rows"
        isEmpty={(d) => d.rows.length === 0}
      >
        {body}
      </Loadable>,
    );
    assert.match(textOf(ready), /rows:a,b/);
    assert.equal(find(ready, "state-action"), null);

    const empty = await mount(
      createRoot,
      <Loadable
        load={{ state: "ready", data: { rows: [] } }}
        what="the rows"
        isEmpty={(d) => d.rows.length === 0}
        empty={{ title: "No rows yet", action: { label: "Add a row", onPress: () => void pressed++ } }}
      >
        {body}
      </Loadable>,
    );
    assert.match(textOf(empty), /No rows yet/);
    assert.doesNotMatch(textOf(empty), /rows:/);
    await press(find(empty, "state-action"));
    assert.equal(pressed, 1);

    const bare = await mount(
      createRoot,
      <Loadable load={{ state: "ready", data: { rows: [] } }} what="rows" isEmpty={(d) => d.rows.length === 0}>
        {body}
      </Loadable>,
    );
    assert.match(textOf(bare), /No rows yet/, "a list that is simply empty says No <things> yet");
  } finally {
    restore();
  }
});

test("without isEmpty, ready always draws the content, even an empty list", async () => {
  const restore = installDom();
  try {
    const root = await mount(
      createRoot,
      <Loadable load={{ state: "ready", data: { rows: [] } }} what="rows">
        {body}
      </Loadable>,
    );
    assert.match(textOf(root), /rows:/);
  } finally {
    restore();
  }
});

test("a refused read is drawn by LoadFailed, not by an error of Loadable's own", async () => {
  const restore = installDom();
  try {
    const refused = { message: "That does not exist or is not yours.", code: "validation.not_found" };
    const root = await mount(
      createRoot,
      <Loadable load={{ state: "failed", failure: refused, retry: () => undefined }} what="this chat">
        {body}
      </Loadable>,
    );
    assert.ok(
      find(root, "load-failed"),
      "drawn by LoadFailed, with its test id, not by a second error of Loadable's own",
    );
  } finally {
    restore();
  }
});
