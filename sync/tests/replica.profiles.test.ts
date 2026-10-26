// Replica profiles: phone never mirrors Restricted rows (ARCH 5.11).
// Run with the other replica test file in one CI run so each shows its own ok line.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOB_BUDGET_BYTES, DEVICE_LABEL_CEILING, LABEL_RANK, RESTRICTED_RANK,
  admit, ceilingRank, createNodeDriver, fieldsAboveCeiling, labelRankOf, loadCatalog, openReplica,
} from "../src/replica/index.ts";
import type { AdmitRequest, EntityInfo } from "../src/replica/profile.ts";
import type { ReplicaStore } from "../src/replica/index.ts";

const ACTOR = "usr_ada";
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function hlc(ms: number): string {
  return `${ms.toString(16).padStart(12, "0")}-0001-dev1`;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

const sample = {
  kind: "record_type",
  key: "sample",
  table: "rt_sample",
  profile: { desktop: "all", phone: "window", web: "none" },
  window: { days: 90, starred: true },
  maxLabel: LABEL_RANK.confidential,
  fts: ["name"],
  ownerField: "owner",
  fieldLabels: { secret: LABEL_RANK.restricted, note: LABEL_RANK.confidential },
  datetimeFields: ["createdAt"],
} satisfies EntityInfo;

function decide(over: Partial<AdmitRequest> = {}) {
  return admit({
    deviceClass: over.deviceClass ?? "phone",
    phoneCeiling: over.phoneCeiling ?? "confidential",
    entity: over.entity ?? sample,
    rowLabel: over.rowLabel === undefined ? LABEL_RANK.public : over.rowLabel,
    at: over.at === undefined ? NOW : over.at,
    now: over.now ?? NOW,
    starred: over.starred ?? false,
    follows: over.follows ?? false,
    owner: over.owner === undefined ? "prs_me" : over.owner,
    personId: over.personId === undefined ? "prs_me" : over.personId,
    origin: over.origin ?? "mirror",
    exists: over.exists ?? false,
  });
}

test("ceiling, label rank and admit follow the profile rules", () => {
  assert.equal(RESTRICTED_RANK, 3);
  assert.equal(LABEL_RANK.restricted, 3);
  assert.equal(LABEL_RANK.confidential, 2);
  assert.equal(LABEL_RANK.internal, 1);
  assert.equal(LABEL_RANK.public, 0);
  assert.equal(DEVICE_LABEL_CEILING.desktop, LABEL_RANK.confidential);
  assert.equal(DEVICE_LABEL_CEILING.web, LABEL_RANK.confidential);
  assert.equal(DEVICE_LABEL_CEILING.phone, LABEL_RANK.confidential);
  assert.equal(BLOB_BUDGET_BYTES.phone, 300 * 1024 * 1024);
  assert.equal(BLOB_BUDGET_BYTES.desktop, 2 * 1024 * 1024 * 1024);
  assert.equal(BLOB_BUDGET_BYTES.web, BLOB_BUDGET_BYTES.desktop);

  assert.equal(labelRankOf("restricted"), 3);
  assert.equal(labelRankOf("confidential"), 2);
  assert.equal(labelRankOf(3), 3);
  assert.equal(labelRankOf(0), 0);
  assert.equal(labelRankOf(4), null);
  assert.equal(labelRankOf(1.5), null);
  assert.equal(labelRankOf("nope"), null);
  assert.equal(labelRankOf(null), null);

  assert.equal(ceilingRank("phone", "internal", null), LABEL_RANK.internal);
  assert.equal(ceilingRank("phone", "confidential", LABEL_RANK.internal), LABEL_RANK.internal);
  assert.equal(ceilingRank("phone", "restricted", null), LABEL_RANK.confidential);
  assert.equal(ceilingRank("desktop", "internal", null), LABEL_RANK.confidential);
  assert.equal(ceilingRank("web", "public", null), LABEL_RANK.confidential);

  assert.deepEqual(fieldsAboveCeiling(sample, "phone", "internal").sort(), ["note", "secret"]);
  assert.deepEqual(fieldsAboveCeiling(sample, "desktop", "confidential"), ["secret"]);
  assert.deepEqual(fieldsAboveCeiling(sample, "phone", "confidential"), ["secret"]);
  const plan = loadCatalog().get("client_plan");
  assert.ok(plan);
  assert.ok(fieldsAboveCeiling(plan, "phone", "confidential").includes("tax_id"));
  assert.equal(loadCatalog().get("file_version")?.profile.phone, "none");
  assert.equal(loadCatalog().get("message")?.window.days, 90);

  assert.deepEqual(decide({ deviceClass: "web" }), { ok: false, reason: "profile_none" });
  assert.deepEqual(decide({ rowLabel: LABEL_RANK.restricted }), { ok: false, reason: "restricted" });
  assert.deepEqual(decide({ rowLabel: LABEL_RANK.confidential, phoneCeiling: "internal" }), { ok: false, reason: "above_label" });
  assert.deepEqual(decide({ at: null }), { ok: false, reason: "outside_window" });
  assert.deepEqual(decide({ at: NOW - 91 * DAY }), { ok: false, reason: "outside_window" });
  assert.deepEqual(decide({ at: NOW - 91 * DAY, starred: true }), { ok: true });
  assert.deepEqual(decide({ at: null, origin: "local" }), { ok: true });
  assert.deepEqual(decide({ owner: "prs_other" }), { ok: false, reason: "not_owned" });
  assert.deepEqual(decide({ owner: "prs_other", follows: true }), { ok: true });
  assert.deepEqual(decide({ owner: "prs_other", origin: "local", exists: true }), { ok: true });
  assert.deepEqual(decide({ deviceClass: "desktop" }), { ok: true });
  assert.deepEqual(decide({ deviceClass: "desktop", rowLabel: LABEL_RANK.restricted }), { ok: false, reason: "restricted" });
});

test("phone profile never mirrors Restricted rows", async () => {
  const phone = openReplica({
    driver: createNodeDriver(),
    deviceClass: "phone",
    registryHash: "hash-phone",
    clock: () => NOW,
    personId: "prs_me",
  });
  let low: ReplicaStore | undefined;
  try {
    assert.equal(phone.write({ entity: "calendar", id: "cld_ok", fields: { title: "Ok" }, hlc: hlc(1), actor: ACTOR, origin: "mirror" }).applied, true);
    assert.equal(phone.read("calendar", "cld_ok")?.title, "Ok");

    const byName = phone.write({
      entity: "calendar", id: "cld_r", fields: { title: "Secret" }, hlc: hlc(2), actor: ACTOR, origin: "mirror", label: "restricted",
      op: { opId: "op-r", traceId: "trace-r", cap: "calendar.update", v: 1, input: "{}", baseSeq: "0" },
    });
    assert.deepEqual(byName, { applied: false, reason: "restricted" });
    assert.equal(phone.read("calendar", "cld_r"), null);
    assert.equal(phone.readFts("calendar", "cld_r"), null);
    assert.equal(phone.pendingCount(), 0);
    assert.equal(phone.write({ entity: "calendar", id: "cld_r2", fields: { title: "Secret" }, hlc: hlc(3), actor: ACTOR, origin: "mirror", label: 3 }).reason, "restricted");
    assert.equal(phone.write({ entity: "calendar", id: "cld_r3", fields: { title: "Secret" }, hlc: hlc(4), actor: ACTOR, label: "restricted" }).reason, "restricted");
    assert.equal(phone.read("calendar", "cld_r2"), null);
    assert.equal(phone.read("calendar", "cld_r3"), null);

    assert.equal(phone.write({ entity: "file_version", id: "ver_1", fields: { name: "a.txt", at: NOW }, hlc: hlc(5), actor: ACTOR, origin: "mirror" }).reason, "profile_none");
    assert.equal(phone.read("file_version", "ver_1"), null);

    // The message window is 90 days and does not keep starred rows past that window.
    assert.equal(phone.write({ entity: "message", id: "msg_old", fields: { body: "old", createdAt: NOW - 91 * DAY }, hlc: hlc(6), actor: ACTOR, origin: "mirror" }).reason, "outside_window");
    assert.equal(phone.write({ entity: "message", id: "msg_star", fields: { body: "old", createdAt: NOW - 91 * DAY }, hlc: hlc(7), actor: ACTOR, origin: "mirror", starred: true }).reason, "outside_window");
    assert.equal(phone.write({ entity: "message", id: "msg_bare", fields: { body: "bare" }, hlc: hlc(8), actor: ACTOR, origin: "mirror" }).reason, "outside_window");
    assert.equal(phone.write({ entity: "message", id: "msg_new", fields: { body: "new", createdAt: NOW - DAY }, hlc: hlc(9), actor: ACTOR, origin: "mirror" }).applied, true);
    assert.equal(phone.read("message", "msg_new")?.body, "new");
    assert.equal(phone.read("message", "msg_old"), null);

    assert.equal(phone.write({ entity: "contact", id: "rec_me", fields: { name: "Ada", owner: "prs_me" }, hlc: hlc(10), actor: ACTOR, origin: "mirror" }).applied, true);
    assert.equal(phone.write({ entity: "contact", id: "rec_other", fields: { name: "Bea", owner: "prs_other" }, hlc: hlc(11), actor: ACTOR, origin: "mirror" }).reason, "not_owned");
    assert.equal(phone.read("contact", "rec_other"), null);
    assert.equal(phone.write({ entity: "contact", id: "rec_follow", fields: { name: "Cy", owner: "prs_other" }, hlc: hlc(12), actor: ACTOR, origin: "mirror", follows: true }).applied, true);
    assert.equal(phone.write({ entity: "contact", id: "rec_star", fields: { name: "Di", owner: "prs_other" }, hlc: hlc(13), actor: ACTOR, origin: "mirror", starred: true }).applied, true);

    const kept = phone.write({ entity: "client_plan", id: "rec_plan", fields: { client: "Ada", tax_id: "99-9999999" }, hlc: hlc(14), actor: ACTOR, origin: "mirror", starred: true });
    assert.equal(kept.applied, true);
    assert.equal(phone.read("client_plan", "rec_plan")?.client, "Ada");
    assert.equal(phone.read("client_plan", "rec_plan")?.tax_id ?? null, null);
    assert.equal(phone.write({ entity: "client_plan", id: "rec_only", fields: { tax_id: "99-9999999" }, hlc: hlc(15), actor: ACTOR, origin: "mirror", starred: true }).reason, "above_label");
    assert.equal(phone.read("client_plan", "rec_only"), null);
    assert.equal(phone.write({ entity: "client_plan", id: "rec_rest", fields: { client: "Ada", label: 3 }, hlc: hlc(16), actor: ACTOR, origin: "mirror", starred: true }).reason, "restricted");
    assert.equal(phone.read("client_plan", "rec_rest"), null);

    low = openReplica({
      driver: createNodeDriver(),
      deviceClass: "phone",
      registryHash: "hash-phone-low",
      clock: () => NOW,
      phoneCeiling: "internal",
      personId: "prs_me",
    });
    assert.equal(low.write({ entity: "calendar", id: "cld_c", fields: { title: "C" }, hlc: hlc(17), actor: ACTOR, origin: "mirror", label: "confidential" }).reason, "above_label");
    assert.equal(low.read("calendar", "cld_c"), null);
    assert.equal(low.write({ entity: "calendar", id: "cld_i", fields: { title: "I" }, hlc: hlc(18), actor: ACTOR, origin: "mirror", label: "internal" }).applied, true);
    assert.equal(low.read("calendar", "cld_i")?.title, "I");
    assert.equal(low.write({ entity: "calendar", id: "cld_x", fields: { title: "X" }, hlc: hlc(19), actor: ACTOR, origin: "mirror", label: "restricted" }).reason, "restricted");
    assert.equal(low.read("calendar", "cld_x"), null);
  } finally {
    await phone.close();
    await low?.close();
  }
});

test("desktop and web mirror up to Confidential and still drop Restricted", async () => {
  const desktop = openReplica({ driver: createNodeDriver(), deviceClass: "desktop", registryHash: "hash-desktop", clock: () => NOW, personId: "prs_me" });
  try {
    assert.equal(desktop.write({ entity: "calendar", id: "cld_r", fields: { title: "Secret" }, hlc: hlc(1), actor: ACTOR, origin: "mirror", label: "restricted" }).reason, "restricted");
    assert.equal(desktop.read("calendar", "cld_r"), null);
    assert.equal(desktop.write({ entity: "contact", id: "rec_other", fields: { name: "Bea", owner: "prs_other" }, hlc: hlc(2), actor: ACTOR, origin: "mirror" }).applied, true);

    const kept = desktop.write({
      entity: "client_plan", id: "rec_c", fields: { client: "Ada", label: 2, tax_id: "secret" }, label: "confidential", hlc: hlc(3), actor: ACTOR, origin: "mirror",
    });
    assert.equal(kept.applied, true);
    const row = desktop.read("client_plan", "rec_c");
    assert.equal(row?.client, "Ada");
    assert.equal(num(row?.label), 2);
    assert.equal(row?.tax_id ?? null, null);
    assert.equal(desktop.write({ entity: "client_plan", id: "rec_r", fields: { client: "Ada", label: 3 }, hlc: hlc(4), actor: ACTOR, origin: "mirror" }).reason, "restricted");
    assert.equal(desktop.read("client_plan", "rec_r"), null);
    assert.equal(desktop.write({ entity: "client_plan", id: "rec_only", fields: { tax_id: "secret" }, hlc: hlc(5), actor: ACTOR, origin: "mirror" }).reason, "above_label");

    assert.equal(desktop.write({ entity: "file_version", id: "ver_old", fields: { name: "old.txt", at: NOW - 31 * DAY }, hlc: hlc(6), actor: ACTOR, origin: "mirror" }).reason, "outside_window");
    assert.equal(desktop.read("file_version", "ver_old"), null);
    assert.equal(desktop.write({ entity: "file_version", id: "ver_new", fields: { name: "new.txt", at: NOW - DAY }, hlc: hlc(7), actor: ACTOR, origin: "mirror" }).applied, true);
    assert.equal(desktop.read("file_version", "ver_new")?.name, "new.txt");
  } finally {
    await desktop.close();
  }
});
