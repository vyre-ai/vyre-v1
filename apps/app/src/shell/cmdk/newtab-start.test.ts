// What the new tab's Enter sends: the same chat.start the first screen's composer sends (one function builds it), to the Assistant, on the model last picked, under the key made at the press.
import test from "node:test";
import assert from "node:assert/strict";
import { createGateSearch } from "./gate.ts";
import { chatStartInput } from "../../places/chats/landing/model.ts";
import { pendingFor, releasePending } from "../../places/chats/landing/pending.ts";

function world(o: { failStart?: boolean } = {}) {
  const opened: { subject?: unknown }[] = [];
  const went: { place: string; hash?: string }[] = [];
  const sent: { cap: string; input: Record<string, unknown> }[] = [];
  const titles: string[] = [];
  const filled: { place: string; hash: string; title: string }[] = [];
  const rt = {
    space: { name: "Northwind", kind: "team" },
    connection: { get: () => "online" },
    assistant: { id: "agt_a", name: "Assistant" },
    open: (t: { subject?: unknown }) => void opened.push(t),
    call: async (cap: string, input: Record<string, unknown>) => {
      sent.push({ cap, input });
      if (cap === "engine.last_pick.get") return { model: "m-1", provider: "p-1" };
      if (cap === "chat.start") {
        if (o.failStart) throw new Error("down");
        return { thread: { threadId: "thr_new" } };
      }
      return {};
    },
  };
  const data = createGateSearch({
    runtime: rt as never,
    nav: {
      go: (place: string, hash?: string) => void went.push({ place, ...(hash === undefined ? {} : { hash }) }),
      newTab: () => undefined,
      flash: () => undefined,
    } as never,
    state: { away: false, offline: false },
    recent: () => [],
    retitle: (t) => void titles.push(t),
    fill: (place, hash, title) => void filled.push({ place, hash, title }),
  });
  return { data, opened, sent, titles, went, filled };
}

test("Enter's chat is the first screen's: the Assistant, the words as the first message and the title, the last model, the key from the press; the tab is named in the same call and opens on the chat", async () => {
  const w = world();
  w.data.warm!();
  await new Promise((r) => setTimeout(r, 5));
  const { title, sent } = w.data.startChat!({ key: "k_press", text: "Heyy there, plan the week please" });
  assert.equal(title, "Heyy there, plan the week please");
  assert.deepEqual(w.titles, [title], "the tab is named before anything is awaited");
  await sent;
  const start = w.sent.find((s) => s.cap === "chat.start")!;
  assert.deepEqual(
    start.input,
    chatStartInput(
      {
        picked: [{ id: "agt_a", name: "Assistant", kind: "assistant" }],
        choice: { model: "m-1", provider: "p-1" },
        text: "Heyy there, plan the week please",
        title,
        hasFiles: false,
        slash: false,
        key: "k_press",
      },
      "agt_a",
    ),
  );
  assert.equal(start.input["first"], "Heyy there, plan the week please");
  assert.equal(start.input["idempotencyKey"], "k_press");
  assert.deepEqual(w.filled, [{ place: "chats", hash: "subject=thread:thr_new", title }], "this tab becomes the chat");
  assert.deepEqual(w.went, [], "and no other tab is opened for it");
  assert.deepEqual(w.opened, [], "no tab of its own is opened for it");
  assert.equal(pendingFor("thr_new")?.text, "Heyy there, plan the week please", "the chat opens on his held words");
  releasePending("thr_new");
});

test("a start that fails rejects `sent`, opens nothing and holds nothing; a retry sends the same key", async () => {
  const w = world({ failStart: true });
  await assert.rejects(w.data.startChat!({ key: "k_1", text: "Heyy" }).sent);
  assert.deepEqual(w.went, []);
  assert.equal(pendingFor("thr_new"), undefined);
  await assert.rejects(w.data.startChat!({ key: "k_1", text: "Heyy" }).sent);
  assert.deepEqual(
    w.sent.filter((s) => s.cap === "chat.start").map((s) => s.input["idempotencyKey"]),
    ["k_1", "k_1"],
  );
});

test("a retry sends exactly the input of the first press, even when the model pick loaded in between: the same key never meets different input", async () => {
  let pickReady = false;
  const sent: Record<string, unknown>[] = [];
  let failNext = true;
  const rt = {
    space: { name: "Northwind", kind: "team" },
    connection: { get: () => "online" },
    assistant: { id: "agt_a", name: "Assistant" },
    open: () => undefined,
    call: async (cap: string, input: Record<string, unknown>) => {
      if (cap === "engine.last_pick.get") return pickReady ? { model: "m-1" } : null;
      if (cap === "chat.start") {
        sent.push(input);
        if (failNext) {
          failNext = false;
          throw new Error("down");
        }
        return { thread: { threadId: "thr_r" } };
      }
      return {};
    },
  };
  const data = createGateSearch({
    runtime: rt as never,
    nav: { go: () => undefined, newTab: () => undefined, flash: () => undefined } as never,
    state: { away: false, offline: false },
    recent: () => [],
    fill: () => undefined,
  });
  await assert.rejects(data.startChat!({ key: "k_same", text: "Heyy" }).sent);
  pickReady = true;
  data.warm!();
  await new Promise((r) => setTimeout(r, 10));
  await data.startChat!({ key: "k_same", text: "Heyy" }).sent;
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0], "same key, same input");
  releasePending("thr_r");
});

test("the chat fills the tab the press came from (its key at the press), not the one that is selected when the answer comes", async () => {
  const w = world();
  const filled: { place: string; hash: string; title: string; tab?: string }[] = [];
  const data = createGateSearch({
    runtime: {
      space: { name: "N", kind: "team" },
      connection: { get: () => "online" },
      assistant: { id: "agt_a", name: "Assistant" },
      open: () => undefined,
      call: async (cap: string) => (cap === "chat.start" ? { thread: { threadId: "thr_t" } } : {}),
    } as never,
    nav: { go: () => undefined, newTab: () => undefined, flash: () => undefined } as never,
    state: { away: false, offline: false },
    recent: () => [],
    activeTab: () => "new:1",
    fill: (place, hash, title, tab) => void filled.push({ place, hash, title, ...(tab ? { tab } : {}) }),
  });
  void w;
  await data.startChat!({ key: "k_t", text: "Heyy" }).sent;
  assert.deepEqual(filled, [{ place: "chats", hash: "subject=thread:thr_t", title: "Heyy", tab: "new:1" }]);
  releasePending("thr_t");
});

test("a pasted link opened from a new tab fills that tab (the door gets the tab the press came from), it does not open a second one", () => {
  const opened: Record<string, unknown>[] = [];
  const rt = {
    space: { name: "N", kind: "team" },
    connection: { get: () => "online" },
    assistant: { id: "agt_a", name: "Assistant" },
    open: (t: Record<string, unknown>) => void opened.push(t),
    call: async () => ({}),
  };
  const data = createGateSearch({
    runtime: rt as never,
    nav: { go: () => undefined, newTab: () => undefined, flash: () => undefined } as never,
    state: { away: false, offline: false },
    recent: () => [],
    activeTab: () => "new:3",
    origins: () => ["https://space.example.test"],
  });
  assert.equal(data.openLink!("https://space.example.test/open/file/fil_9"), true);
  assert.deepEqual(opened, [{ subject: { type: "file", id: "fil_9" }, into: "new:3" }]);
  assert.equal(data.openLink!("Heyy"), false);
});
