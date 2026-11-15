// A connected Drive folder when the daemon stops at the moment Drive has applied one write (shared by the restart walks).
import assert from "node:assert/strict";
import { MEMBER, bootWorld } from "../../fixtures/suite/world.ts";
import { bootDriveWorld } from "../mounts.drive.live.test.ts";

/**
 * The daemon is stopped at the moment Drive has applied one write and before it answers (a crash in the middle of an upload, a rename, a move, a delete or a create), started again over the same data, and
 * the passes run: nothing is lost and nothing is doubled.
 */
export async function crashMidWrite(
  prefix: string,
  o: {
    seed: (d: Parameters<NonNullable<Parameters<typeof bootDriveWorld>[1]>>[0]) => void;
    act: (
      w: Awaited<ReturnType<typeof bootDriveWorld>>["w"],
      added: { folderId: string; mountId: string },
      find: (n: string) => Promise<{ fileId: string } | undefined>,
    ) => Promise<void>;
    crashOn: (r: { method: string; path: string }) => boolean;
    check: (
      drive: Awaited<ReturnType<typeof bootDriveWorld>>["drive"],
      w: Awaited<ReturnType<typeof bootDriveWorld>>["w"],
      added: { folderId: string; mountId: string },
    ) => Promise<void>;
  },
): Promise<void> {
  const { w, drive, mount, fileNamed, opts } = await bootDriveWorld(prefix, o.seed);
  let w2: Awaited<ReturnType<typeof bootWorld>> | undefined;
  try {
    const added = await mount();
    await o.act(w, added, (n) => fileNamed(added.folderId, n));
    await w.d.hooks?.pump?.();
    let stopped: Promise<unknown> = Promise.resolve();
    drive.state.crashOn = {
      match: o.crashOn,
      stop: () => {
        stopped = Promise.race([w.stop(true), new Promise((ok) => setTimeout(ok, 4000))]);
        return stopped;
      },
    };
    void w.call(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: w.idem() }).catch(() => undefined);
    for (let i = 0; i < 100 && drive.state.crashOn !== null; i++) await new Promise((ok) => setTimeout(ok, 50));
    assert.equal(drive.state.crashOn, null, "the crash point was reached");
    await stopped;
    w2 = await bootWorld({ ...opts, dir: w.dir });
    await w2.d.hooks?.pump?.();
    for (let i = 0; i < 3; i++) {
      await w2.ok(MEMBER, "mounts.sync_now", { mountId: added.mountId, idempotencyKey: `again-${prefix}-${i}` });
      await w2.d.hooks?.pump?.();
    }
    await o.check(drive, w2 as never, added);
    const row = await w2.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await (w2 ?? w).stop();
  }
}

export const find = (d: { files: Map<string, { name: string; trashed: boolean; parents: string[] }> }, n: string) =>
  [...d.files.values()].filter((f) => f.name === n && !f.trashed);
