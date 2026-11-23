// F48/F56/F62, sites privacy, part: a calendar and an artifact: born personal, an agent publishing for a person, other readers, closed at start. Real daemon, two people (shared pieces in sites.privacy.kit.ts).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OWNER, NOAH, seededDir, boot, raw, reachOf } from "./sites.privacy.kit.ts";

test("a calendar born personal is private: a second member has no reach and does not get it listed", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/calendar/create_calendar", {
      title: "Olivia private",
      personal: true,
      idempotencyKey: "cal1",
    });
    assert.equal(r.status, 200, r.text);
    const id = (JSON.parse(r.text) as { data: { calendar: { id?: string; calendarId?: string } } }).data.calendar;
    const cid = id.calendarId ?? id.id ?? "";
    await new Promise((x) => setTimeout(x, 1500));
    const reach = async (who: string): Promise<string> =>
      (
        JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "calendar", id: cid }] }, who)).text) as {
          data: { items: { level: string }[] };
        }
      ).data.items[0]!.level;
    assert.equal(await reach(NOAH), "none", "a second member reaches a personal calendar");
    assert.notEqual(await reach(OWNER), "none");
    assert.equal(
      (await raw(d, "/v1/calendar/list_calendars", {}, NOAH)).text.includes("Olivia private"),
      false,
      "a second member sees it listed",
    );
  } finally {
    await d.stop();
  }
});

test("an artifact an agent publishes for a person: the agent can publish again and update it, the person too, another member's agent cannot", async () => {
  const d = await boot(seededDir());
  try {
    const AG = "tok-agent-olivia";
    const a = await raw(
      d,
      "/v1/sites/artifact_publish",
      { title: "Mine", html: "<p>one</p>", idempotencyKey: "k1" },
      AG,
    );
    assert.equal(a.status, 200, a.text);
    const id = (JSON.parse(a.text) as { data: { artifactId: string } }).data.artifactId;
    assert.equal(
      (
        await raw(
          d,
          "/v1/sites/artifact_publish",
          { title: "Mine", html: "<p>two</p>", artifactId: id, idempotencyKey: "k2" },
          AG,
        )
      ).status,
      200,
    );
    assert.equal(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" }, AG)).status,
      200,
      "the agent updates what it made",
    );
    assert.equal((await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" })).status, 200, "the person does too");
    assert.notEqual(
      (await raw(d, "/v1/sites/update", { siteId: id, name: "Mine" }, "tok-agent-noah")).status,
      200,
      "an agent working for another member cannot",
    );
    assert.equal(await reachOf(d, id, NOAH), "none");
  } finally {
    await d.stop();
  }
});

test("the other readers give a member neither the name nor the content of a private artifact: search by name and by content, the folder search, the Sites list", async () => {
  const d = await boot(seededDir());
  try {
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Zebra artifact",
      html: "<p>UNIQUEARTIFACTWORD</p>",
      idempotencyKey: "z1",
    });
    assert.equal(r.status, 200, r.text);
    await new Promise((x) => setTimeout(x, 2500));
    const probes: Record<string, string> = {
      "search by name": (await raw(d, "/v1/search/query", { q: "Zebra artifact" }, NOAH)).text,
      "search by content": (await raw(d, "/v1/search/query", { q: "UNIQUEARTIFACTWORD" }, NOAH)).text,
      "folder search": (await raw(d, "/v1/files/folder/search", { q: "Zebra" }, NOAH)).text,
      "sites list": (await raw(d, "/v1/sites/list", {}, NOAH)).text,
      "sites list (artifacts)": (await raw(d, "/v1/sites/list", { kind: "artifact" }, NOAH)).text,
    };
    for (const [what, text] of Object.entries(probes))
      assert.equal(
        /Zebra|UNIQUEARTIFACTWORD/.test(text),
        false,
        `${what} gave a member the private artifact: ${text.slice(0, 200)}`,
      );
    // and the owner does get it from the list, so the probe can see it
    assert.match((await raw(d, "/v1/sites/list", {})).text, /Zebra artifact/);
  } finally {
    await d.stop();
  }
});

test("an artifact made before this build, whose folder is still under the Space, is closed when the daemon starts", async () => {
  const dir = seededDir();
  let d = await boot(dir);
  let folderId = "";
  const folderReach = async (): Promise<string> =>
    (
      JSON.parse((await raw(d, "/v1/access/reach", { items: [{ type: "folder", id: folderId }] }, NOAH)).text) as {
        data: { items: { level: string }[] };
      }
    ).data.items[0]!.level;
  try {
    let f = { id: "", parent_id: "" };
    const r = await raw(d, "/v1/sites/artifact_publish", {
      title: "Giraffe artifact",
      html: "<p>OLDSTATEWORD</p>",
      idempotencyKey: "g1",
    });
    assert.equal(r.status, 200, r.text);
    const siteId = (JSON.parse(r.text) as { data: { artifactId: string } }).data.artifactId;
    f = d.db!.all(
      "SELECT id, parent_id FROM files_folder WHERE id = (SELECT target_folder FROM sites_site WHERE id = ?)",
      siteId,
    )[0] as { id: string; parent_id: string };
    folderId = f.id;
    await new Promise((x) => setTimeout(x, 2500));
    assert.equal(await folderReach(), "none", "closed when made");
    // the old state: the folder registered under the folder it sits in, as before this build
    await d.log!.append({
      id: "evt_old_artfolder",
      type: "resource.created",
      sv: 1,
      trace_id: "1".repeat(32),
      actor: "svc_seed",
      vis: "space",
      entity: "resource",
      entity_id: f.id,
      payload: { id: f.id, type: "folder", parent_id: f.parent_id, label: 0, owner_id: "svc_host", holds: 0 },
    } as never);
  } finally {
    await d.stop();
  }
  d = await boot(dir);
  try {
    await new Promise((x) => setTimeout(x, 2500));
    assert.equal(
      await folderReach(),
      "none",
      "a member still reaches a private artifact's folder after the start-up pass",
    );
    assert.equal(/OLDSTATEWORD/.test((await raw(d, "/v1/search/query", { q: "OLDSTATEWORD" }, NOAH)).text), false);
  } finally {
    await d.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
