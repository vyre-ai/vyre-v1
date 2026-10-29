import test from "node:test";
import assert from "node:assert/strict";
import { factsLine, removalNote } from "../pages/Computers.tsx";

test("a waiting computer is described by what it is, what it runs on and its fingerprint", () => {
  assert.equal(factsLine({ facts: { os: "linux", arch: "x64", docker: true, version: "1.0.0" }, fingerprint: "K7QD-4M2X" }), "Linux x64 · Docker ready · Fingerprint K7QD-4M2X");
  assert.equal(factsLine({ facts: { os: "darwin", arch: "arm64", docker: false, version: "1.0.0" }, fingerprint: "AB2C-D3EF" }), "Mac arm64 · No Docker (sandboxed CLI turns only) · Fingerprint AB2C-D3EF");
  assert.equal(factsLine({}), "");
});

test("removing a computer that hosts agent computers names them", () => {
  assert.equal(removalNote("Office box", []), "Remove Office box? Its access ends at once and it must be admitted again to come back.");
  assert.match(removalNote("Office box", ["Scout", "Intake"]), /It is hosting 2 agent computers: Scout, Intake\. They stop/);
  assert.match(removalNote("Office box", ["Scout"]), /1 agent computer: Scout/);
});
