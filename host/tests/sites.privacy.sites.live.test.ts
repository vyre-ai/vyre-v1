// F48/F56/F62, sites privacy, part: a site's privacy: private, the Space's again, closed at start, an agent's and a person's own, a shared one. Real daemon, two people (shared pieces in sites.privacy.kit.ts).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OWNER, NOAH, seededDir, boot, raw, reachOf, make, names } from "./sites.privacy.kit.ts";

test("a site set private is private: a member is refused and cannot reach it, its owner can; set back to the Space it is the Space's again", async () => {
  const d = await boot(seededDir());
  try {
    const id = await make(d, "sp-live");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200, "a Space site is open to members");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.notEqual(
      (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
      200,
      "a member still reads a private site",
    );
    assert.equal(await reachOf(d, id, NOAH), "none");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, "its owner still does");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "space" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(
      (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
      200,
      "back to the Space, a member reads it again",
    );
  } finally {
    await d.stop();
  }
});

test("a site already private in the store before this build is closed when the daemon starts on it", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    id = await make(d, "sp-old");
    // the old state: the site's own row says private, the kernel still holds it under the Space, no event closed it
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
    assert.equal(await reachOf(d, id, NOAH), "edit", "the old state is open to members");
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await reachOf(d, id, NOAH), "none", "a member still reaches a site its owner set to private");
    assert.notEqual(await reachOf(d, id, OWNER), "none");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("what an agent makes for a person is theirs: private, the person opens and edits it, the agent that made it goes on working on it, another member has none, and it stays so after a restart", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  const AG = "tok-agent-olivia";
  let id = "";
  try {
    const r = await raw(
      d,
      "/v1/sites/create",
      { name: "Agent made", kind: "artifact", access: "space", idempotencyKey: "ag1" },
      AG,
    );
    assert.equal(r.status, 200, r.text);
    const site = (JSON.parse(r.text) as { data: { site: { siteId: string; owner: string } } }).data.site;
    id = site.siteId;
    assert.equal(site.owner, "usr_olivia", "the person the agent acted for owns it");
    // who may reach it is the person's to say (R1): the agent is refused, the person sets it
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "private" }, AG)).status,
      403,
      "an agent cannot change who may reach it",
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status,
      200,
      "the person sets it private",
    );
    await new Promise((r) => setTimeout(r, 1500));
    const check = async (when: string): Promise<void> => {
      assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, `${when}: the person opens it`);
      assert.equal(
        (await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" })).status,
        200,
        `${when}: the person edits it`,
      );
      const a = await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, AG);
      assert.equal(a.status, 200, `${when}: the agent that made it keeps working on it: ${a.text.slice(0, 200)}`);
      const other = await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, "tok-agent-noah");
      assert.notEqual(other.status, 200, `${when}: an agent working for another member got in`);
      assert.notEqual(
        (await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status,
        200,
        `${when}: another member is refused`,
      );
      assert.equal(await reachOf(d, id, NOAH), "none", `${when}: another member's reach`);
    };
    await check("after setting it");
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id })).status, 200, "after restart: the person opens it");
    assert.equal(await reachOf(d, id, NOAH), "none");
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Agent made" }, AG)).status,
      200,
      "after restart: the agent can update",
    );
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a private site shared with a named person keeps the share after the move out of the Space and after a restart; the other readers do not give a member its name", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let id = "";
  try {
    id = await make(d, "Shared one");
    const sh = await raw(d, "/v1/access/share", {
      idempotencyKey: "sh-noah",
      resource: { type: "site", id },
      subject: { kind: "person", id: "usr_noah" },
      level: "view",
    });
    assert.equal(sh.status, 200, sh.text);
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await reachOf(d, id, NOAH), "view", "the named person keeps view");
    assert.equal((await raw(d, "/v1/sites/get", { siteId: id }, NOAH)).status, 200);
    d.db!.run("UPDATE sites_site SET access = 'private' WHERE id = ?", id);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((r) => setTimeout(r, 2000));
    assert.equal(await reachOf(d, id, NOAH), "view", "after restart the share is still there");
    // and a private site with no share: the name does not reach a member through the list or the search
    const lone = await make(d, "Lonely site");
    assert.equal((await raw(d, "/v1/sites/update", { siteId: lone, access: "private" })).status, 200);
    await new Promise((r) => setTimeout(r, 2500));
    const seen = await names(d, NOAH, "Lonely site");
    assert.deepEqual(
      seen,
      { list: false, search: false },
      "a member gets the name of a private site from the list or the search",
    );
    assert.equal((await names(d, OWNER, "Lonely site")).list, true, "its owner still lists it");
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
