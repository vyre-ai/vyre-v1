// A connected Google Drive folder on a booted daemon, through the real host invoke path, against a stand-in Drive (test/support/drive-standin.ts). Nothing inside the daemon is faked: the
// Files module, the Mounts engine, the Google module and the gateway's idempotency rule are the real ones. What an edit, a rename, a move, a delete and a restore made in Vyre does at Drive.
import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { bootWorld, MEMBER, OWNER } from "../fixtures/suite/world.ts";
import type { ProviderApi } from "../fixtures/suite/world.ts";
import { driveStandIn } from "./support/drive-standin.ts";

const DOMAIN = "firm.test";
const NOAH = `noah@${DOMAIN}`;
const ADMIN = `olivia@${DOMAIN}`;
const CLIENT_EMAIL = "vyre@firm-prod.iam.gserviceaccount.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_JSON = JSON.stringify({
  type: "service_account",
  project_id: "firm-prod",
  client_id: "104857384729183746501",
  client_email: CLIENT_EMAIL,
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});

/** Boots a Space whose Noah has a Google connection, mounts the stand-in Drive's root-folder into his Files, and returns what a test needs. */
export async function bootDriveWorld(prefix: string, seed?: (d: ReturnType<typeof driveStandIn>) => void) {
  const drive = driveStandIn({ user: NOAH, clientEmail: CLIENT_EMAIL, publicKey });
  seed?.(drive);
  const rest: ProviderApi = ({ url, headers }) => {
    const u = new URL(url);
    if (!/^Bearer at\|/.test(headers["authorization"] ?? "")) return { status: 401, json: {} };
    if (u.hostname === "gmail.googleapis.com") return { json: { emailAddress: NOAH, historyId: "1", messages: [] } };
    if (u.hostname === "www.googleapis.com" && u.pathname.includes("/calendar/v3/"))
      return { json: { items: [], nextSyncToken: "s" } };
    if (u.hostname === "admin.googleapis.com")
      return { json: { users: [{ primaryEmail: NOAH, name: { fullName: "Noah Berg" } }] } };
    return undefined;
  };
  const opts = {
    prefix,
    api: (r: Parameters<ProviderApi>[0]) => drive.api(r) ?? rest(r),
    seam: drive.seam,
    members: [{ userId: "usr_noah", email: NOAH }],
    secrets: { "#Google_DWD": KEY_JSON },
    sign: (data: string) => createSign("RSA-SHA256").update(data).sign(privateKey, "base64url"),
  };
  const w = await bootWorld(opts);
  const folder = await w.ok(OWNER, "vault.folders.create", {
    name: "Company connections",
    scope: "shared",
    idempotencyKey: w.idem(),
  });
  await w.ok(OWNER, "access.labels.set", {
    resource: { type: "vault_folder", id: folder.folder.id },
    label: "restricted",
  });
  const item = await w.ok(OWNER, "vault.item.put", {
    folderId: folder.folder.id,
    name: "Google_DWD",
    kind: "other",
    fields: [{ key: "key", value: KEY_JSON, secret: true }],
    idempotencyKey: w.idem(),
  });
  await w.ok(OWNER, "access.labels.set", { resource: { type: "vault_item", id: item.item.id }, label: "restricted" });
  await w.ok(OWNER, "google.dwd.setup", { vaultItem: "#Google_DWD", adminEmail: ADMIN, idempotencyKey: w.idem() });
  await w.d.hooks!.runPeriodic("calendar.pull_provider");
  const cals = await w.ok(MEMBER, "calendar.list_calendars", {});
  const gcal = cals.calendars.find((c: { provider: string }) => c.provider === "google");
  assert.ok(gcal?.connectionId, "Noah has a Google connection");
  const tree = await w.ok(MEMBER, "files.tree", {});
  const into =
    tree.roots.find((r: { key: string; folderId?: string }) => r.key === "shared_knowledge" || r.key === "knowledge")
      ?.folderId ?? tree.roots.find((r: { folderId?: string }) => r.folderId)?.folderId;
  const mount = async (extra: Record<string, unknown> = {}) =>
    w.ok(MEMBER, "mounts.add", {
      into,
      source: { kind: "google_drive", connectionId: gcal.connectionId, ref: "root-folder" },
      name: "Firm Drive",
      idempotencyKey: w.idem(),
      ...extra,
    });
  const fileNamed = async (folderId: string, name: string) => {
    const l = await w.ok(MEMBER, "files.list", { section: "space", folder: folderId });
    return l.files.find((f: { name: string }) => f.name === name) as { fileId: string; name: string } | undefined;
  };
  /** the projections that mark a change run asynchronously after the commit; a pass is run once they have */
  const sync = async (mountId: string) => {
    await w.d.hooks?.pump?.();
    return w.ok(MEMBER, "mounts.sync_now", { mountId, idempotencyKey: w.idem() });
  };
  /** the daemon is stopped as it stands (its data kept) and started again over the same data directory, as after a crash and a restart */
  const reboot = async (from: typeof w) => {
    await from.stop(true);
    return bootWorld({ ...opts, dir: from.dir });
  };
  return { w, drive, mount, fileNamed, sync, reboot, opts };
}

test("an edit saved in Vyre to a connected Drive file reaches Drive as a new revision of the same file", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvedit", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f, "the Drive file is listed in Files");
    const read = await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    assert.equal(read.text, "first words");
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "second words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    await sync(added.mountId);
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(
      row.mount.state,
      "idle",
      `the mount is not failing: ${row.mount.error ?? ""} ${JSON.stringify(w.logsLike(/could not be sent/i).slice(-2))}`,
    );
    assert.equal(drive.text("d1"), "second words", "Drive holds the edit");
    assert.equal(drive.files.get("d1")!.head, 2, "as a new revision of the same file");
    assert.deepEqual(drive.creates, [], "no second file was made");
    assert.equal(drive.byName("Plan.txt")?.id, "d1");
  } finally {
    await w.stop();
  }
});

test("a rename, a move, a delete and a restore made in Vyre reach Drive as the same files: ids stay, nothing is made, the Trash is Drive's own", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvmove", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "plan");
    d.put({ id: "d2", name: "Notes.txt", mimeType: "text/plain" }, "notes");
    d.put({ id: "dir1", name: "Reports", mimeType: "application/vnd.google-apps.folder" }, "");
  });
  try {
    const added = await mount();
    const plan = await fileNamed(added.folderId, "Plan.txt");
    const notes = await fileNamed(added.folderId, "Notes.txt");
    assert.ok(plan && notes);
    const listed = await w.ok(MEMBER, "files.list", { section: "space", folder: added.folderId });
    const reports = (listed.folders ?? []).find((f: { name: string }) => f.name === "Reports");
    assert.ok(reports, `the Drive folder is a folder in Files: ${JSON.stringify(listed).slice(0, 300)}`);
    const sent = (): number => drive.requests.filter((r) => r.method !== "GET").length;

    await w.ok(MEMBER, "files.rename", { fileId: plan.fileId, name: "Plan 2026.txt", idempotencyKey: w.idem() });
    await sync(added.mountId);
    assert.equal(drive.files.get("d1")!.name, "Plan 2026.txt", "renamed at Drive");
    assert.equal(drive.files.get("d1")!.head, 1, "a rename is not a new revision");

    await w.ok(MEMBER, "files.move", {
      fileId: notes.fileId,
      toFolderId: reports.folderId,
      idempotencyKey: w.idem(),
    });
    await sync(added.mountId);
    assert.deepEqual(drive.files.get("d2")!.parents, ["dir1"], "moved at Drive, same file");

    await w.ok(MEMBER, "files.delete", { fileId: plan.fileId, idempotencyKey: w.idem() });
    await sync(added.mountId);
    assert.equal(drive.files.get("d1")!.trashed, true, "in Drive's own Trash, not gone");
    await w.ok(MEMBER, "files.restore", { fileId: plan.fileId, idempotencyKey: w.idem() });
    await sync(added.mountId);
    assert.equal(drive.files.get("d1")!.trashed, false, "taken back out of Drive's Trash");
    await sync(added.mountId);

    assert.deepEqual(drive.creates, [], "no file was ever made at Drive");
    assert.equal(drive.files.size, 3);
    const before = sent();
    await sync(added.mountId);
    assert.equal(sent(), before, "a pass with nothing changed sends nothing");
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.state, "idle", String(row.mount.error ?? ""));
  } finally {
    await w.stop();
  }
});

test("an edit made in Vyre to a file that changed at Drive is held: Drive is untouched, the choice is Keep both or Use theirs", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvstale", (d) => {
    d.put({ id: "d1", name: "Plan.txt", mimeType: "text/plain" }, "first words");
  });
  try {
    const added = await mount();
    const f = await fileNamed(added.folderId, "Plan.txt");
    assert.ok(f);
    await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: f.fileId,
      content: { text: "my words" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    drive.elsewhere("d1", "kim's words"); // Kim saves at Drive after the listing
    await sync(added.mountId);
    assert.equal(drive.text("d1"), "kim's words", "Drive was not overwritten");
    assert.deepEqual(drive.creates, []);
    const opened = await w.ok(MEMBER, "mounts.open", { fileId: f.fileId });
    assert.equal(opened.source.conflict, true);
    assert.equal(opened.source.changedThere.by.name, "Kim Ito", "who changed it there");
    assert.ok(opened.source.changedThere.at > 0, "and when");

    const done = await w.ok(MEMBER, "mounts.resolve", { fileId: f.fileId, choice: "keep_both" });
    assert.equal(done.resolved, true);
    assert.match(done.copyName, /^Plan \(.+'s edit\)\.txt$/);
    const copy = drive.byName(done.copyName);
    assert.ok(copy, "the person's version is saved beside it at Drive");
    assert.equal(drive.text(copy.id), "my words");
    assert.equal(drive.text("d1"), "kim's words", "their file is still theirs");
    const read = await w.ok(MEMBER, "files.read", { fileId: f.fileId });
    assert.equal(read.text, "kim's words", "the file in Vyre is their version now");
  } finally {
    await w.stop();
  }
});

test("a Drive file the person may not edit opens as view only before they type; a mount made Read only never sends", async () => {
  const { w, drive, mount, fileNamed, sync } = await bootDriveWorld("drvview", (d) => {
    d.put({ id: "d1", name: "Locked.txt", mimeType: "text/plain", canEdit: false }, "theirs");
    d.put({ id: "d2", name: "Mine.txt", mimeType: "text/plain" }, "mine");
  });
  try {
    const added = await mount({ readOnly: true });
    const locked = await fileNamed(added.folderId, "Locked.txt");
    const mine = await fileNamed(added.folderId, "Mine.txt");
    assert.ok(locked && mine);
    const a = await w.ok(MEMBER, "mounts.open", { fileId: locked.fileId });
    assert.equal(a.source.viewOnly, true);
    const row = await w.ok(MEMBER, "mounts.get", { mountId: added.mountId });
    assert.equal(row.mount.readOnly, true);
    await w.ok(MEMBER, "files.read", { fileId: mine.fileId });
    await w.ok(MEMBER, "files.write", {
      fileId: mine.fileId,
      content: { text: "changed" },
      reason: "Edit",
      idempotencyKey: w.idem(),
    });
    await sync(added.mountId);
    assert.equal(drive.text("d2"), "mine", "a Read only folder sends nothing");
    await w.ok(OWNER, "mounts.update", { mountId: added.mountId, pullOnly: false });
    const b = await w.ok(MEMBER, "mounts.open", { fileId: locked.fileId });
    assert.equal(b.source.viewOnly, true, "a file the provider locks stays view only even in a two-way folder");
  } finally {
    await w.stop();
  }
});
