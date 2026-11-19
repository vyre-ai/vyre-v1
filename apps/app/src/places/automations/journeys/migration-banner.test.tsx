// The Journey page says when its Journey is moving onto its new form, and offers Retry when that stopped.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf } from "../../../../../../ui/src/testing/dom.ts";
import { AutomationsDataProvider } from "../canvas/data.tsx";
import { MigrationBanner, migrationLine } from "./MigrationBanner.tsx";
import type { Journey } from "./model.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const j = (over: Record<string, unknown> = {}): Journey =>
  ({ id: "jrn_1", name: "ATP", mode: "migrating", ...over }) as unknown as Journey;
const open = async (journey: Journey, call: (cap: string, i: any) => unknown, canDesign = true) => {
  installDom();
  const calls: { cap: string; input: any }[] = [];
  const data = {
    call: async (cap: string, input: any) => {
      calls.push({ cap, input });
      return call(cap, input);
    },
    name: (id: string) => id,
    me: { id: "usr_me", name: "Me" },
  };
  const root = await mount(
    createRoot,
    <AutomationsDataProvider value={data as never}>
      <MigrationBanner journey={journey} canDesign={canDesign} />
    </AutomationsDataProvider>,
  );
  await flush();
  return { root, calls };
};

test("the line: nothing for a Journey that has moved, how far while it moves, why it stopped with Retry", () => {
  assert.equal(migrationLine(null), null);
  assert.equal(migrationLine({ mode: "pipeline", total: 3, done: 3, failed: [] }), null);
  assert.deepEqual(migrationLine({ mode: "migrating", total: 5, done: 2, failed: [] }), {
    text: "Moving this Journey to its new form: 2 of 5 records done.",
    retry: false,
  });
  assert.deepEqual(migrationLine({ mode: "migrating", total: 5, done: 2, failed: [] }, "the records module is down"), {
    text: "Moving this Journey to its new form stopped: the records module is down",
    retry: true,
  });
});

test("a Journey that has moved shows no banner and asks nothing", async () => {
  const { root, calls } = await open(j({ mode: "pipeline" }), () => ({}));
  assert.equal(find(root, "migration-banner"), null);
  assert.equal(calls.length, 0);
});

test("a stopped move says why and Retry runs it again, then the banner follows what is left", async () => {
  let n = 0;
  const { root, calls } = await open(j({ migrateNote: "2 records could not be moved: down" }), (cap) => {
    if (cap === "journeys.migration_state")
      return n === 0
        ? { mode: "migrating", total: 2, done: 0, failed: [] }
        : { mode: "pipeline", total: 2, done: 2, failed: [] };
    n++;
    return { journey: {} };
  });
  assert.match(textOf(find(root, "migration-banner")!), /stopped: 2 records could not be moved: down/);
  await press(find(root, "migration-retry"));
  await flush();
  assert.equal(calls.filter((c) => c.cap === "journeys.to_pipeline").length, 1);
  assert.equal(find(root, "migration-banner"), null, "moved: the banner goes");
});

test("a person who cannot design sees the line and no Retry", async () => {
  const { root } = await open(
    j({ migrateNote: "down" }),
    () => ({ mode: "migrating", total: 1, done: 0, failed: [] }),
    false,
  );
  assert.ok(find(root, "migration-banner"));
  assert.equal(find(root, "migration-retry"), null);
});
