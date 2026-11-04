import test from "node:test";
import assert from "node:assert/strict";
import { readUrlIntoHub, hubUrl } from "./url.ts";
import type { ShellHub } from "../spaces/hub.ts";
import { parseHash } from "../hash/hash.ts";

test("a copied item URL restores the hub hash and browser back clears it", () => {
  let state = { place: "records", hash: "" };
  const hub = { state: () => state, go: (place: string, hash: string) => { state = { place, hash }; } } as unknown as ShellHub;
  readUrlIntoHub(hub, { pathname: "/files", hash: "#subject=file:fil_saved" });
  assert.deepEqual(state, { place: "files", hash: "subject=file:fil_saved" });
  assert.equal(hubUrl(hub, "?space=https%3A%2F%2Fexample.test"), "/files?space=https%3A%2F%2Fexample.test#subject=file:fil_saved");
  readUrlIntoHub(hub, { pathname: "/records", hash: "" });
  assert.deepEqual(state, { place: "records", hash: "" });
  assert.equal(hubUrl(hub), "/records");
});

test("the link Vyre for Chrome opens for Watching lands in Automations with the Watching screen, and the same link is what the hub writes back", () => {
  let state = { place: "chats", hash: "" };
  const hub = { state: () => state, go: (place: string, hash: string) => { state = { place, hash }; } } as unknown as ShellHub;
  readUrlIntoHub(hub, { pathname: "/automations", hash: "#screen=watching" });
  assert.deepEqual(state, { place: "automations", hash: "screen=watching" });
  assert.equal(hubUrl(hub), "/automations#screen=watching");
  assert.deepEqual(parseHash("screen=watching").screen, "watching");
});
