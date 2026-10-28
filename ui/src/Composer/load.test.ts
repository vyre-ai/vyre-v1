import test from "node:test";
import assert from "node:assert/strict";
import * as module from "./load.ts";

test("the deferred module shares one in-flight load and retries after a transient rejection", async () => {
  const create = (module as typeof module & { createRetryableLoader?: <T>(importer: () => Promise<T>) => { load: () => Promise<T> } }).createRetryableLoader;
  assert.equal(typeof create, "function", "the Composer loader needs a reusable retryable state machine");
  if (!create) return;

  let attempts = 0;
  let accept: ((value: string) => void) | undefined;
  const loader = create(() => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error("chunk network error"));
    return new Promise<string>((resolve) => { accept = resolve; });
  });

  await assert.rejects(loader.load(), /chunk network error/);
  const retry = loader.load();
  assert.equal(loader.load(), retry, "concurrent retries share one import");
  accept?.("Composer");
  assert.equal(await retry, "Composer");
  assert.equal(attempts, 2);
});
