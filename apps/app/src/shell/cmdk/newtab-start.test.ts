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
    space: { name: "Northwind", kind: "team" }, connection: { get: () => "online" }, assistant: { id: "agt_a", name: "Assistant" },
    open: (t: { subject?: unknown }) => void opened.push(t),
    call: async (cap: string, input: Record<string, unknown>) => {
      sent.push({ cap, input });
      if (cap === "engine.last_pick.get") return { model: "m-1", provider: "p-1" };
      if (cap === "chat.start") { if (o.failStart) throw new Error("down"); return { thread: { threadId: "thr_new" } }; }
      return {};
    },
  };
  const data = createGateSearch({ runtime: rt as never, nav: { go: (place: string, hash?: string) => void went.push({ place, ...(hash === undefined ? {} : { hash }) }), newTab: () => undefined, flash: () => undefined } as never, state: { away: false, offline: false }, recent: () => [], retitle: (t) => void titles.push(t), fill: (place, hash, title) => void filled.push({ place, hash, title }) });
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
  assert.deepEqual(start.input, chatStartInput({ picked: [{ id: "agt_a", name: "Assistant", kind: "assistant" }], choice: { model: "m-1", provider: "p-1" }, text: "Heyy there, plan the week please", title, hasFiles: false, slash: false, key: "k_press" }, "agt_a"));
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
  assert.deepEqual(w.sent.filter((s) => s.cap === "chat.start").map((s) => s.input["idempotencyKey"]), ["k_1", "k_1"]);
});
