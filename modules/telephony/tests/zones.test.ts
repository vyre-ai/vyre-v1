// The recipient's zone, read from their number: the US and Canada by area code, one-zone countries by prefix, and nothing guessed for the rest.
import test from "node:test";
import assert from "node:assert/strict";
import { zoneOfNumber } from "../handlers/zones.ts";

test("a number says its zone, and a number that does not stays null", () => {
  const cases: [string, string | null][] = [
    ["+14155550100", "America/Los_Angeles"], ["+13035550100", "America/Denver"], ["+16025550100", "America/Phoenix"], ["+13125550100", "America/Chicago"], ["+12125550100", "America/New_York"],
    ["+19075550100", "America/Anchorage"], ["+18085550100", "Pacific/Honolulu"], ["+923001234567", "Asia/Karachi"], ["+447700900000", "Europe/London"], ["+5511999990000", null],
  ];
  for (const [number, zone] of cases) assert.equal(zoneOfNumber(number), zone, number);
});
