// The walk, part 4 of 4: an Automation of each of these step kinds opens with its step form and nothing is written (the kinds are every key of manifests/steps-core.ts, plus one per connector family).
import test from "node:test";
import assert from "node:assert/strict";
import { walk } from "./walk-kit.tsx";

test("an Automation of each of these step kinds opens with its form and writes nothing: start_journey, stop, transform, wait_stage, wait, google.dri", async () => {
  assert.deepEqual(await walk(["start_journey", "stop", "transform", "wait_stage", "wait", "google.drive.create_folder", "google.gmail.send", "microsoft.mail.send"]), [], "no kind writes on open");
});
