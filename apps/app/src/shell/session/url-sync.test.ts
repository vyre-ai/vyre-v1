import test from "node:test";
import assert from "node:assert/strict";
import { readUrlIntoHub, hubUrl } from "./url.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { parseHash } from "../hash/hash.ts";

test("a copied item URL restores the hub hash and browser back clears it", () => {
  let state = { place: "records", hash: "" };
  const hub = {
    state: () => state,
    go: (place: string, hash: string) => {
      state = { place, hash };
    },
  } as unknown as ShellHub;
  readUrlIntoHub(hub, { pathname: "/files", hash: "#subject=file:fil_saved" });
  assert.deepEqual(state, { place: "files", hash: "subject=file:fil_saved" });
  assert.equal(
    hubUrl(hub, "?space=https%3A%2F%2Fexample.test"),
    "/files?space=https%3A%2F%2Fexample.test#subject=file:fil_saved",
  );
  readUrlIntoHub(hub, { pathname: "/records", hash: "" });
  assert.deepEqual(state, { place: "records", hash: "" });
  assert.equal(hubUrl(hub), "/records");
});

test("the link Vyre for Chrome opens for Watching lands in Automations with the Watching screen, and the same link is what the hub writes back", () => {
  let state = { place: "chats", hash: "" };
  const hub = {
    state: () => state,
    go: (place: string, hash: string) => {
      state = { place, hash };
    },
  } as unknown as ShellHub;
  readUrlIntoHub(hub, { pathname: "/automations", hash: "#screen=watching" });
  assert.deepEqual(state, { place: "automations", hash: "screen=watching" });
  assert.equal(hubUrl(hub), "/automations#screen=watching");
  assert.deepEqual(parseHash("screen=watching").screen, "watching");
});

test("a popover or sheet address read at page load lands on the place; any other address is kept", () => {
  const read = (hash: string, load: boolean): { place: string; hash: string } => {
    let state = { place: "records", hash: "" };
    const hub = {
      state: () => state,
      go: (place: string, h: string) => {
        state = { place, hash: h };
      },
    } as unknown as ShellHub;
    readUrlIntoHub(hub, { pathname: "/chat", hash }, { load });
    return state;
  };
  for (const screen of ["chats.terminal-list", "chats.all-agents", "chats.terminal-rules"]) {
    assert.deepEqual(read(`#screen=${screen}&at=1`, true), { place: "chats", hash: "" }, screen);
    // a link followed inside the app (not a load) still opens it
    assert.deepEqual(read(`#screen=${screen}&at=1`, false), { place: "chats", hash: `screen=${screen}&at=1` });
  }
  assert.deepEqual(read("#subject=thread:thr_1", true), { place: "chats", hash: "subject=thread:thr_1" });
  assert.deepEqual(read("#screen=chats.recording&recordingId=r1", true), {
    place: "chats",
    hash: "screen=chats.recording&recordingId=r1",
  });
});

test("the bar's form of an address (a colon) and the hub's form (escaped) are one address: reading the bar back is not a link", () => {
  const calls: string[] = [];
  const hub = {
    state: () => ({ place: "chats", hash: "subject=thread%3Athr_a" }),
    go: (place: string, hash: string) => void calls.push(`${place} ${hash}`),
  } as unknown as ShellHub;
  readUrlIntoHub(hub, { pathname: "/chat", hash: "#subject=thread:thr_a" });
  assert.deepEqual(
    calls,
    [],
    "the same address in another escaping is not read as a link (the first press of a cold load did)",
  );
  readUrlIntoHub(hub, { pathname: "/chat", hash: "#subject=thread:thr_b" });
  assert.deepEqual(calls, ["chats subject=thread:thr_b"], "another address still is");
});
