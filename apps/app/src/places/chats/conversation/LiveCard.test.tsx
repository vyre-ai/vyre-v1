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

// f-wire, 12 Nov: an agent's steps in its Space browser profile post a browser_screenshot block, which was drawn as a bare line with no picture and nothing to open. The same card now draws it,
// keyed by the agent: live from the browser while the agent uses it, its picture once it is done, the caption as it comes.
function browserRig(row: Record<string, unknown> | null) {
  const calls: Array<[string, unknown]> = [];
  const opened: string[] = [];
  const cfg: LiveCardConfig = {
    call: async (cap, input) => {
      calls.push([cap, input]);
      if (cap === "computers.browser.profiles") return { profiles: row ? [{ agentId: "agt_web", tabs: 1, viewers: 0, ...row }] : [] };
      if (cap === "computers.browser.stream") return { url: "/live/browser/agt_web" };
      if (cap === "files.read") return { base64: "iVBORw0KGgo=", truncated: false };
      return {};
    },
    now: () => 1, openComputer: (id) => void opened.push(id), agentId: "agt_lead",
  };
  return { cfg, calls, opened };
}

test("a browser step while the agent uses its browser is the browser's live view; pressing it opens that agent's Computer tab", async () => {
  const restore = installDom();
  try {
    const r = browserRig({ running: true, busy: true });
    const root = await mount(createRoot, <LiveCard id="b3" agentId="agt_web" fileId="fil_1" caption="Opened the pricing page" cfg={r.cfg} />);
    await flush(); await flush();
    assert.ok(find(root, "live-card-stream-b3"), "the browser's live view is drawn");
    assert.ok(r.calls.some(([c, i]) => c === "computers.browser.stream" && (i as { agentId?: string }).agentId === "agt_web"), "the stream is the agent's profile");
    assert.ok(!r.calls.some(([c]) => c === "computers.get"), "no computer is asked for");
    assert.match(textOf(find(root, "live-card-b3")), /Live/);
    await press(find(root, "live-card-screen-b3"));
    assert.deepEqual(r.opened, ["agt_web"], "the agent that browsed, not the chat's lead");
  } finally { restore(); }
});

test("a browser step once the browser is idle is its picture, Done, with the caption as it comes (a withheld picture says why)", async () => {
  const restore = installDom();
  try {
    const r = browserRig({ running: true, busy: false });
    const caption = "Opened the bank login · No picture: a Vault value is on this page";
    const root = await mount(createRoot, <LiveCard id="b4" agentId="agt_web" fileId="fil_1" caption={caption} cfg={r.cfg} />);
    await flush(); await flush();
    assert.ok(find(root, "live-card-still-b4"));
    assert.match(textOf(find(root, "live-card-b4")), /Done/);
    assert.ok(textOf(find(root, "live-card-b4")).includes(caption));
  } finally { restore(); }
});
