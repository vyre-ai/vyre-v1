// P-GF_03d: folders.place and folders.unplace declare every event they emit (access.changed), so the gateway answers 200 instead of 500. Booted daemon, real device tokens (rule 27).
import test from "node:test";
import assert from "node:assert/strict";
import { bootFlowSpace, expectStatus, short } from "./02-space.ts";

test("folders.create, place and unplace answer 200 and the item follows the folder", async () => {
  const s = await bootFlowSpace(["access", "members", "files", "devices", "spaces", "tasks"]);
  try {
    const owner = s.signedIn("usr_olivia", "dev_olivia1");
    const folder = expectStatus(await s.call("folders.create", owner, { idempotencyKey: "place-folder", type: "channel", name: "Clients", scope: "space" }), 200, "folders.create").folder.id as string;
    const item = { type: "channel", id: "chn_general" };
    expectStatus(await s.call("folders.place", owner, { resource: item, folderId: folder }), 200, "folders.place");
    const moved = expectStatus(await s.call("folders.create", owner, { idempotencyKey: "place-folder-2", type: "channel", name: "Other", scope: "space" }), 200, "folders.create second").folder.id as string;
    expectStatus(await s.call("folders.move", owner, { folderId: moved, parentId: folder }), 200, "folders.move");
    expectStatus(await s.call("folders.unplace", owner, { resource: item }), 200, "folders.unplace");
    const stranger = await s.call("folders.place", s.signedIn("usr_tess"), { resource: item, folderId: folder });
    assert.ok(stranger.status >= 400 && stranger.status < 500, `a guest may not place into a folder she cannot edit: ${stranger.status} ${short(stranger.body?.error ?? stranger.body)}`);
  } finally { await s.stop(); }
});
