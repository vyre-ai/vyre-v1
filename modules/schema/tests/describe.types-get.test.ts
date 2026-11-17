// schema.types.get reads the one type it was asked for. It used to read and parse every type (twice) on each call, and on a Space whose types have 100 fields, every record a sync wrote made two such
// calls from the folder and file consumers: 17 Nov 2026, the server's whole CPU.
import test from "node:test";
import assert from "node:assert/strict";
import { openSchema } from "../impl.ts";

test("types.get parses one type's definition, however many types there are, and answers what describe says for it", async () => {
  const s = openSchema({ now: () => 1_800_000_000_000 });
  const ctx = { trace: { traceId: "0123456789abcdef0123456789abcdef" }, emit: () => undefined, actor: "usr_dana" };
  const all = await s.handlers["schema.describe"](ctx, {});
  assert.ok(all.types.length >= 8, "the manifests declare several types");
  const key = all.types[0]!.key;
  const real = JSON.parse;
  let parses = 0;
  JSON.parse = ((...a: Parameters<typeof JSON.parse>) => {
    parses++;
    return real(...a);
  }) as typeof JSON.parse;
  let one: Awaited<ReturnType<(typeof s.handlers)["schema.types.get"]>>;
  let every = 0;
  try {
    parses = 0;
    one = await s.handlers["schema.types.get"](ctx, { type: key });
    const forOne = parses;
    parses = 0;
    await s.handlers["schema.describe"](ctx, {});
    every = parses;
    assert.ok(forOne <= 3, `one type parsed ${forOne} definitions`);
    assert.ok(every > forOne * 4, `describing every type parses far more (${every}) than one (${forOne})`);
  } finally {
    JSON.parse = real;
  }
  assert.deepEqual(
    one.type,
    all.types.find((t) => t.key === key),
  );
  await assert.rejects(
    () => s.handlers["schema.types.get"](ctx, { type: "no_such_type" }),
    (e) => (e as { error?: { code?: string } }).error?.code === "validation.not_found",
  );
});
