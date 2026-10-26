// Golden flow 11: backup restore with tombstones (spec 2.26, 5 Backups; ARCH 7.10). A contact is created, backed up, erased (a tombstone is written), and the Space is restored from the backup:
// the erased contact must not come back, because the tombstones are replayed before the Space opens. Through the gateway, real tokens; the restore is held by the Gate and a person approves it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bootFlowSpace, expectStatus, short, Trail } from "./02-space.ts";
import type { Gap } from "./02-space.ts";
import type { Observed } from "../harness/index.ts";

export const LIVE_FOR_RESTORE = ["backup", "governance", "devices", "access", "spaces", "tasks", "gate", "search", "inbox", "contacts-link", "files"];

const CONTACT = {
  op: "type.create", type: "contact",
  def: { title: "Contact", plural: "Contacts", icon: "user", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "email", type: "text", title: "Email" }] },
};

/** Why this flow is a todo today (ruling 53). */
export const GAPS: Gap[] = [
  { packet: "P-L11_04", lane: "L11", what: "no authorization resource exists for the built-in contact record type, so records.create answers 404 permission.not_found even for the owner (the seed has rt_contact, the module uses contact)" },
  { packet: "P-L7b_LIVE", lane: "L7b", what: "backup.* answer 503: configureBackup is never called by the host, so there is no Space source, export sink or S3 driver" },
  { packet: "P-L7_LIVE", lane: "L7", what: "governance migrations create gov_* tables; a live module may only use governance_*, so erase and tombstones answer 403" },
];

export async function runRestore(live: readonly string[]): Promise<{ events: Observed[]; trail: Trail }> {
  const s = await bootFlowSpace(live);
  const trail = new Trail();
  try {
    const admin = s.d.token;
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-golden-backup-"));
    await trail.step("the contact type exists", async () => {
      // the records module ships a built-in contact type; make it only when this Space has none
      const r = await s.call("schema.apply", admin, { idempotencyKey: "golden-11-type", ops: [CONTACT] });
      if (r.status !== 422 || r.body?.error?.code !== "validation.duplicate") expectStatus(r, 200, "schema.apply");
    });
    const rec = await trail.step("a contact is created", async () =>
      expectStatus(await s.call("records.create", admin, { idempotencyKey: "golden-11-rec", type: "contact", fields: { name: "Ann Example", email: "ann@example.com" } }), 200, "records.create").record.id as string,
    ["the contact type exists"]);
    await trail.step("backups go to a local target", async () => {
      expectStatus(await s.call("backup.config_set", admin, { target: { kind: "local", path: target }, schedule: "0 3 * * *", enabled: true }), 200, "backup.config_set");
    });
    const backupId = await trail.step("a backup runs", async () => {
      const out = expectStatus(await s.call("backup.run", admin, { idempotencyKey: "golden-11-run" }), 200, "backup.run");
      assert.ok(out.backupId, `backup.run answers a backup id: ${short(out)}`);
      return out.backupId as string;
    }, ["backups go to a local target", "a contact is created"]);
    await trail.step("the backup is listed", async () => {
      const list = expectStatus(await s.call("backup.list", admin, {}), 200, "backup.list").backups as { backupId: string }[];
      assert.ok(list.some((b) => b.backupId === backupId), `backup.list has ${backupId}: ${short(list)}`);
    }, ["a backup runs"]);
    const finding = await trail.step("the contact is found for erasure", async () => {
      const out = expectStatus(await s.call("governance.erase.find", admin, { subject: { recordId: rec! } }), 200, "governance.erase.find");
      const g = (out.groups as { kind: string; count: number }[]).find((x) => x.kind === "records");
      assert.equal(g?.count, 1, `the finding lists the record: ${short(out.groups)}`);
      return out.findingId as string;
    }, ["a contact is created"]);
    await trail.step("the contact is erased and a tombstone is written", async () => {
      expectStatus(await s.call("governance.erase.apply", admin, { findingId: finding! }), 200, "governance.erase.apply");
      const r = await s.call("records.get", admin, { type: "contact", recordId: rec! });
      assert.equal(r.status, 404, `records.get after the erase: ${r.status}`);
      const t = expectStatus(await s.call("governance.tombstones.list", admin, {}), 200, "governance.tombstones.list").tombstones as unknown[];
      assert.ok(t.length >= 1, "a tombstone is listed");
    }, ["the contact is found for erasure"]);
    await trail.step("the restore preview counts the tombstone", async () => {
      const p = expectStatus(await s.call("backup.restore_preview", admin, { backupId: backupId! }), 200, "backup.restore_preview");
      assert.ok(p.tombstones >= 1, `preview ${short(p)}`);
    }, ["the contact is erased and a tombstone is written", "a backup runs"]);
    await trail.step("refusal: a Member cannot restore", async () => {
      const r = await s.call("backup.restore", s.signedIn("usr_noah"), { backupId: backupId!, confirm: true });
      assert.equal(r.status, 403, `backup.restore as a Member: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["a backup runs"]);
    await trail.step("the admin restores; the Gate holds it and a person approves", async () => {
      const r = await s.call("backup.restore", admin, { backupId: backupId!, confirm: true });
      let out = r.body?.data;
      if (r.status < 300 && out?.status === "held" && out.taskId) {
        out = expectStatus(await s.call("tasks.act", admin, { taskId: out.taskId, action: "approve" }), 200, "tasks.act");
      } else expectStatus(r, 200, "backup.restore");
    }, ["the restore preview counts the tombstone"]);
    await trail.step("the erased contact did not come back", async () => {
      const r = await s.call("records.get", admin, { type: "contact", recordId: rec! });
      assert.equal(r.status, 404, `records.get after the restore: ${r.status} ${short(r.body?.error ?? r.body)}`);
    }, ["the admin restores; the Gate holds it and a person approves"]);
    return { events: await s.events(), trail };
  } finally { await s.stop(); }
}

export default async function steps(): Promise<Observed[]> {
  const { events, trail } = await runRestore([]);
  if (trail.failures.length) throw new Error(`flow 11 failed:\n${trail.report()}`);
  return events;
}
