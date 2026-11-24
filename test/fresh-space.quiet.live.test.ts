// The class guard: a brand-new Space (Personal and Team), booted the way the app's own walks boot one (a real daemon process, apps/app/tests/real-app-harness.test.ts), claimed and signed in over HTTP, seeded the way
// the walk seeds it (a project, its Files folder and a file in it), and let to settle, holds nothing for its owner: Needs you is empty, its count is zero, and no task of any kind exists. (The wait is polled, not fixed: it ends when the events that matter have not changed for four rounds.) Any lane that files
// a task into a fresh Space (a folder that could not follow its record, a setup nag, a seed side effect) fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { bootFreshSpace } from "../apps/app/tests/support/fresh-space.ts";
import type { Space } from "../apps/app/tests/support/fresh-space.ts";

const KEYS = {
  personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk",
  publicKey: "cHVibGljLWtleQ==",
  privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk",
  spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }],
};
const PASSWORD = "correct horse battery staple 9";
type Json = { data?: any; error?: { code?: string } }; // eslint-disable-line @typescript-eslint/no-explicit-any

for (const kind of ["personal", "team"] as const) {
  test(`a fresh ${kind} Space, claimed and settled, holds nothing for its owner: no Needs-you item, a zero count, no task at all`, async () => {
    const d: Space = await bootFreshSpace(kind === "personal" ? "personal" : undefined);
    const post = async (token: string | null, p: string, body: unknown): Promise<{ status: number; body: Json }> => {
      const r = await fetch(`${d.url}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      const text = await r.text();
      return { status: r.status, body: text ? (JSON.parse(text) as Json) : {} };
    };
    try {
      assert.ok(d.claim, "a fresh Space prints a claim link");
      const code = decodeURIComponent(new URL(d.claim).pathname.split("/").pop() ?? "");
      const claimed = await post(null, "/v1/identity/claim_owner", {
        code,
        spaceId: d.space,
        username: "olivia",
        displayName: "Olivia",
        password: PASSWORD,
        deviceName: "Mac",
        deviceClass: "desktop",
        keys: KEYS,
      });
      assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
      const signedIn = await post(null, "/v1/identity/sign_in", {
        username: "olivia",
        password: PASSWORD,
        deviceName: "Laptop",
        deviceClass: "desktop",
      });
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
      const owner = signedIn.body.data.session.token as string;
      // what a first hour makes, the way the app's own walk seeds it (apps/app/tests/spaces.switch.live.test.ts seedFile): a project, its Files folder, and a file in that folder
      const made = await post(owner, "/v1/projects/create", {
        type: "project",
        title: `${kind} private project`,
        idempotencyKey: `quiet-${kind}-project`,
      });
      assert.equal(made.status, 200, JSON.stringify(made.body));
      const file = await post(owner, "/v1/files/create", {
        folderId: made.body.data.folderId,
        name: `${kind}.md`,
        content: { text: `# ${kind} exclusive content` },
        idempotencyKey: `quiet-${kind}-file`,
      });
      assert.equal(file.status, 200, JSON.stringify(file.body));
      // let the first run finish: pump every consumer and sweep until the events that matter here (a task made, a folder that could not follow) have not changed for four rounds in a row, at least 12 rounds and at
      // most 120 (the log itself never stops: the daemon's own timers write to it), so a slow consumer cannot hide
      const marks = async (): Promise<number> =>
        (
          (
            await post(owner, "/v1/events/since", {
              after: 0,
              types: ["task.created", "project.folder_unfollowed"],
              limit: 1000,
            })
          ).body.data?.events as unknown[] | undefined
        )?.length ?? -1;
      let seen = -2,
        still = 0,
        rounds = 0;
      for (; rounds < 120 && (still < 4 || rounds < 12); rounds++) {
        await new Promise((r) => setTimeout(r, 100));
        const now = await marks();
        assert.ok(
          now >= 0,
          `${kind}: the events probe answered (a failed probe is a failed test, not a settled Space)`,
        );
        still = now === seen ? still + 1 : 0;
        seen = now;
      }
      assert.ok(still >= 4, `${kind}: the first run settled`);
      // the seed really made what the guard is about: the project's Files folder exists, and in a Team Space it follows its record (the follow was attempted and worked); a Personal Space has no sharing, so
      // there the answer is that nothing can follow, not a failure
      const folder = await post(owner, "/v1/files/folder/get", { folderId: made.body.data.folderId });
      assert.equal(folder.status, 200, `${kind}: the project's folder exists: ${JSON.stringify(folder.body)}`);
      const shares = await post(owner, "/v1/access/shares_of", {
        resource: { type: "folder", id: made.body.data.folderId },
      });
      if (kind === "team") {
        assert.equal(shares.status, 200, JSON.stringify(shares.body));
        assert.equal(shares.body.data.inherits, made.body.data.recordId, "team: the folder follows its record");
      } else {
        assert.ok(
          shares.status === 200 || shares.body.error?.code === "permission.needs_team",
          `personal: no failure other than "no sharing here": ${JSON.stringify(shares.body)}`,
        );
      }
      const needs = await post(owner, "/v1/tasks/needs_you", {});
      assert.equal(needs.status, 200, JSON.stringify(needs.body));
      assert.deepEqual(
        (needs.body.data.items as { task: { title: string } }[]).map((i) => i.task.title),
        [],
        `${kind}: Needs you is empty`,
      );
      assert.equal(needs.body.data.total, 0);
      const count = await post(owner, "/v1/tasks/count_needs_you", {});
      assert.equal(count.body.data.count, 0, `${kind}: the badge count is zero`);
      const all = await post(owner, "/v1/tasks/list", { scope: "all" });
      assert.equal(all.status, 200, JSON.stringify(all.body));
      assert.deepEqual(
        ((all.body.data.tasks ?? all.body.data.items ?? []) as { title: string }[]).map((t) => t.title),
        [],
        `${kind}: no task of any kind exists`,
      );
    } finally {
      await d.stop();
    }
  });
}
