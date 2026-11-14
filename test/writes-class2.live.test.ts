// F50 (14 Nov 2026), the kinds that had no version in their contract: a goal, a Vault item, a site, a published page (artifact) and the cells of a sheet row each take an optional version
// (expectedUpdatedAt, expectedVersion or expect), checked where they are written. On a booted daemon: a write that names what it read lands once; the same write made again on the old one is refused and changes
// nothing; two made at the same moment on one version give one that lands. The tool layer fills these for an agent: agent/tests/tools.versions.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, call, clock, connect, seededDir } from "./memory-live-kit.ts";

let k = 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = { status: number; data: any };
const c = (d: Parameters<typeof call>[0], cap: string, input: Record<string, unknown>): Promise<R> =>
  call(d, cap, { idempotencyKey: `w2-${cap}-${++k}`, ...input });
const ok = async (d: Parameters<typeof call>[0], cap: string, input: Record<string, unknown>) => {
  const r = await c(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return r.data;
};

/** Time moves between steps: a thing's updatedAt differs from one write to the next, as it does in life. */
const tick = (): number => (clock.t += 5);

async function laterSecondWriteRefused(
  label: string,
  write: (expected: unknown, tag: string) => Promise<R>,
  expected: unknown,
  next: () => Promise<unknown>,
): Promise<void> {
  const first = await write(expected, "ANN");
  assert.equal(first.status, 200, `${label} first: ${JSON.stringify(first.data).slice(0, 300)}`);
  await next();
  const second = await write(expected, "BOB");
  assert.equal(
    second.status,
    409,
    `${label}: the same write on the old version is refused: ${JSON.stringify(second.data).slice(0, 300)}`,
  );
  console.log(`MEASURE ${label}: 200 then 409`);
}

test("goal, Vault item, sheet row: a write on a version that moved on is refused", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    clock.t = Date.now();
    // a goal
    const agent = (await ok(d, "agents.create", { name: "Lead", role: "You lead." })).agent.agentId as string;
    const goal = (
      await ok(d, "goals.create", {
        title: "Shared goal",
        start: false,
        finish: { kind: "owner", line: "done" },
        deadline: Date.now() + 5 * 86_400_000,
        leadAgentId: agent,
        rhythm: { every: "day" },
        quiet: null,
        zone: "UTC",
      })
    ).goal;
    tick();
    await laterSecondWriteRefused(
      "goals.update expectedUpdatedAt",
      (e, tag) => c(d, "goals.update", { goalId: goal.id, outcome: tag, expectedUpdatedAt: e }),
      goal.updatedAt,
      async () => {
        tick();
        const now = (await ok(d, "goals.get", { goalId: goal.id })).goal;
        assert.ok(now.updatedAt > goal.updatedAt, "the first update moved updatedAt on");
        assert.equal(now.outcome, "ANN");
      },
    );
    // a Vault item
    const folder = (await ok(d, "vault.folders.create", { name: "Keys", scope: "mine" })).folder.id as string;
    const item = (
      await ok(d, "vault.item.put", {
        folderId: folder,
        name: "Key",
        kind: "api_key",
        fields: [{ key: "token", value: "v1", secret: true }],
      })
    ).item;
    tick();
    await laterSecondWriteRefused(
      "vault.item.update expectedUpdatedAt",
      (e, tag) =>
        c(d, "vault.item.update", {
          itemId: item.id,
          fieldsSet: [{ key: "token", value: tag, secret: true }],
          expectedUpdatedAt: e,
        }),
      item.updatedAt,
      async () => tick(),
    );
    // a sheet row, by its cells
    const tree = await ok(d, "files.tree", {});
    const root = (tree.roots as Array<{ folderId?: string }>).find((r) => r.folderId)?.folderId;
    const sheet = (
      await ok(d, "sheets.create", { folderId: root, name: "People.csv", format: "csv", columns: ["name", "city"] })
    ).file.fileId as string;
    await ok(d, "sheets.append_rows", { fileId: sheet, rows: [{ name: "Dana", city: "Austin" }] });
    const row = (await ok(d, "sheets.read_rows", { fileId: sheet })).rows[0];
    await laterSecondWriteRefused(
      "sheets.update_row expect",
      (e, tag) => c(d, "sheets.update_row", { fileId: sheet, rowId: row.rowId, values: { city: tag }, expect: e }),
      { city: "Austin" },
      async () => undefined,
    );
    const cells = (await ok(d, "sheets.read_rows", { fileId: sheet })).rows[0].values;
    assert.equal(cells.city, "ANN", "the first change stands");
    // a change to another column of the same row is not held back by an expectation about this one
    const other = await c(d, "sheets.update_row", {
      fileId: sheet,
      rowId: row.rowId,
      values: { name: "Dana F." },
      expect: { name: "Dana" },
    });
    assert.equal(other.status, 200);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("two writes at once on one version: one lands (goal, Vault item)", async () => {
  const dir = seededDir();
  const d = await boot(dir);
  try {
    await connect(d);
    clock.t = Date.now();
    const agent = (await ok(d, "agents.create", { name: "Lead", role: "You lead." })).agent.agentId as string;
    const goal = (
      await ok(d, "goals.create", {
        title: "Shared goal",
        start: false,
        finish: { kind: "owner", line: "done" },
        deadline: Date.now() + 5 * 86_400_000,
        leadAgentId: agent,
        rhythm: { every: "day" },
        quiet: null,
        zone: "UTC",
      })
    ).goal;
    tick();
    const g = await Promise.all(
      ["ANN", "BOB"].map((tag) =>
        c(d, "goals.update", { goalId: goal.id, outcome: tag, expectedUpdatedAt: goal.updatedAt }),
      ),
    );
    assert.deepEqual(g.map((r) => r.status).sort(), [200, 409], "goals");
    const folder = (await ok(d, "vault.folders.create", { name: "Keys", scope: "mine" })).folder.id as string;
    const item = (
      await ok(d, "vault.item.put", {
        folderId: folder,
        name: "Key",
        kind: "api_key",
        fields: [{ key: "token", value: "v1", secret: true }],
      })
    ).item;
    tick();
    const v = await Promise.all(
      ["ANN", "BOB"].map((tag) =>
        c(d, "vault.item.update", {
          itemId: item.id,
          fieldsSet: [{ key: "token", value: tag, secret: true }],
          expectedUpdatedAt: item.updatedAt,
        }),
      ),
    );
    assert.deepEqual(v.map((r) => r.status).sort(), [200, 409], "vault");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
