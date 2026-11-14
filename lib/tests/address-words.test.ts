import test from "node:test";
import assert from "node:assert/strict";
import { addressWords, isLoopbackAddress } from "../address-words.ts";

test("a loopback address reads This computer for a person on it; any other address is shown as it is", () => {
  for (const a of ["127.0.0.1:41471", "http://127.0.0.1:41471", "localhost:3000", "[::1]:80", "http://localhost"]) {
    assert.equal(isLoopbackAddress(a), true, a);
    assert.equal(addressWords(a), "This computer", a);
    assert.equal(addressWords(a, { viewer: "localhost:5173" }), "This computer", a);
  }
  assert.equal(addressWords("northwind.vyre.run"), "northwind.vyre.run");
  assert.equal(addressWords("https://space.example.org", { viewer: "127.0.0.1:1" }), "https://space.example.org");
  assert.equal(addressWords(""), "This computer");
  assert.equal(addressWords(undefined, { fallback: "" }), "");
});

test("seen from another computer, a loopback address is the server's own: This server", () => {
  assert.equal(addressWords("127.0.0.1:41471", { viewer: "northwind.vyre.run" }), "This server");
  assert.equal(addressWords("localhost", { viewer: "192.168.1.20:8080" }), "This server");
});

test("the packaged app's own hosts are this computer: tauri.localhost (Windows), any *.localhost, and an empty host (a file or custom-scheme window)", () => {
  assert.equal(isLoopbackAddress("tauri.localhost"), true);
  assert.equal(isLoopbackAddress("http://tauri.localhost"), true);
  assert.equal(isLoopbackAddress("app.tauri.localhost:8080"), true);
  assert.equal(isLoopbackAddress("notlocalhost.example"), false);
  assert.equal(addressWords("127.0.0.1:41471", { viewer: "tauri.localhost" }), "This computer");
  assert.equal(addressWords("127.0.0.1:41471", { viewer: "" }), "This computer");
  assert.equal(addressWords("127.0.0.1:41471", { viewer: "northwind.vyre.run" }), "This server");
});
