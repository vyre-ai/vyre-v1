import test from "node:test";
import assert from "node:assert/strict";
import { readUrlIntoHub, hubUrl } from "./url.ts";
import type { ShellHub } from "../spaces/hub.ts";

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
