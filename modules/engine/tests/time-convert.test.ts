// engine.time_convert: the tool a model calls instead of doing zone arithmetic. The person's zone is their profile; "tomorrow 2pm PT" said at 05:41 PKT on Wednesday 4 Nov.
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeConvert } from "../handlers/time-convert.ts";
import { CORE_READ_TOOLS } from "../api-tools.ts";
import { registry } from "../../../generated/registry.ts";
import type { EngineCtx } from "../projections.ts";

const NOW = Date.parse("2026-11-04T00:41:00Z");
const ctx = (zone: unknown): EngineCtx => ({ now: () => NOW, call: async () => ({ row: { value: zone } }) }) as unknown as EngineCtx;

test("tomorrow 2pm PT, said at 05:41 PKT, is Thursday 2pm in Los Angeles and Friday 03:00 for the person", async () => {
  const r = await timeConvert(ctx("Asia/Karachi"), { when: "tomorrow 2pm", from: "PT", to: ["Asia/Karachi", "UTC"] });
  assert.equal(r["instant"], "2026-11-05T22:00:00.000Z");
  assert.equal(r["given"], "Thursday 5 November 2026, 14:00 (America/Los_Angeles, UTC-8)");
  assert.equal(r["inYourZone"], "Friday 6 November 2026, 03:00 (Asia/Karachi, UTC+5)");
  assert.deepEqual((r["zones"] as Array<{ zone: string }>).map((z) => z.zone), ["Asia/Karachi", "UTC"]);
  assert.equal(r["personZone"], "Asia/Karachi");
});

test("with no profile zone the person is on UTC, and a zone passed in wins; what cannot be read is a bad_input with words", async () => {
  assert.equal((await timeConvert(ctx(undefined), { when: "2026-11-05 14:00", from: "UTC" }))["personZone"], "UTC");
  assert.equal((await timeConvert(ctx("Asia/Karachi"), { when: "2026-11-05 14:00", from: "UTC", zone: "Europe/London" }))["inYourZone"], "Thursday 5 November 2026, 14:00 (Europe/London, UTC+0)");
  await assert.rejects(timeConvert(ctx("UTC"), { when: "banana" }), (e: Error & { code?: string }) => e.code === "validation.bad_input" && /could not read/.test(e.message));
});

test("it is a read tool named time_convert, and it is listed in every turn", () => {
  const cap = registry.capabilities.find((c) => c.name === "engine.time_convert") as unknown as { effects: string } | undefined;
  assert.equal(cap?.effects, "read");
  assert.ok(CORE_READ_TOOLS.includes("time_convert"));
});
