// The walk, part 3 of 4: an Automation of each of these step kinds opens with its step form and nothing is written (the kinds are every key of manifests/steps-core.ts, plus one per connector family).
import test from "node:test";
import assert from "node:assert/strict";
import { walk } from "./walk-kit.tsx";

test("an Automation of each of these step kinds opens with its form and writes nothing: send_email, send_sms, sheet.add_rows, sheet.create, sheet.de", async () => {
  assert.deepEqual(await walk(["send_email", "send_sms", "sheet.add_rows", "sheet.create", "sheet.delete_rows", "sheet.find_rows", "sheet.read_all", "sheet.update_rows", "sign"]), [], "no kind writes on open");
});
