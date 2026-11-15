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
  const w = await bootWorld({
    prefix,
    api: (r) => drive.api(r) ?? rest(r),
    seam: drive.seam,
    members: [{ userId: "usr_noah", email: NOAH }],
    secrets: { "#Google_DWD": KEY_JSON },
    sign: (data) => createSign("RSA-SHA256").update(data).sign(privateKey, "base64url"),
  });
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
  return { w, drive, mount, fileNamed, sync };
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
