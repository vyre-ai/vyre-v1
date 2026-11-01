// The live card in a message (rc.9): live while the computer works for the chat, the last picture once it does not, and it opens the computer when pressed.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { LiveCard } from "./LiveCard.tsx";
import type { LiveCardConfig } from "./LiveCard.tsx";
import { cardLine } from "./model.ts";

function rig(state: string) {
  const calls: string[] = [];
  const opened: string[] = [];
  const cfg: LiveCardConfig = {
    call: async (cap) => {
      calls.push(cap);
      if (cap === "computers.get") return { computer: { state } };
      if (cap === "computers.stream") return { transport: "mjpeg", url: "/live/cmt_1", ticket: "tk", expiresAt: 1 };
      if (cap === "files.read") return { base64: "iVBORw0KGgo=", truncated: false };
      return {};
    },
    now: () => 1, openComputer: (id) => void opened.push(id), agentId: "agt_1",
  };
  return { cfg, calls, opened };
}

test("while the computer works the card is the live view; pressing it opens the computer", async () => {
  const restore = installDom();
  try {
    const r = rig("working");
    const root = await mount(createRoot, <LiveCard id="b1" computerId="cmt_1" fileId="fil_1" caption="Filling in the form" cfg={r.cfg} />);
    await flush();
    assert.ok(find(root, "live-card-stream-b1"), "the stream is drawn");
    assert.match(textOf(find(root, "live-card-b1")), /Live/);
    assert.ok(!r.calls.includes("files.read"), "no still is fetched while live");
    await press(find(root, "live-card-screen-b1"));
    assert.deepEqual(r.opened, ["agt_1"]);
  } finally { restore(); }
});

test("once the computer sleeps the card freezes to the last picture and says Done", async () => {
  const restore = installDom();
  try {
    const r = rig("asleep");
    const root = await mount(createRoot, <LiveCard id="b2" computerId="cmt_1" fileId="fil_1" caption="Filling in the form" cfg={r.cfg} />);
    await flush();
    await flush();
    assert.ok(r.calls.includes("files.read"), "the still is read from Files");
    assert.equal(find(root, "live-card-stream-b2"), null);
    assert.match(textOf(find(root, "live-card-b2")), /Done/);
    assert.ok(find(root, "live-card-still-b2"));
    assert.ok(!r.calls.includes("computers.stream"), "a sleeping computer is not streamed");
  } finally { restore(); }
});

test("a screenshot block marked live reads as a card titled by its caption", () => {
  const line = cardLine({ id: "b1", type: "screenshot", v: 1, state: "done", data: { computerId: "cmt_1", fileId: "fil_1", caption: "Opened the form", at: 1, live: true }, traceId: "t" } as never);
  assert.equal(line.title, "Opened the form");
  assert.equal(line.data["live"], true);
});
