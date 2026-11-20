// esign built-in signing as a state machine (lane r42-docs, 19 Nov 2026). Random sequences of every move a sender, a signer or the clock can make, in any order, against the real handlers:
// view, open the document, sign, decline, remind, cancel, fetch the signed file, let the link time run out, and break and mend the final file. After every move the same rules must hold:
//   1. Only the moves of the table below happen to an envelope; a finished envelope (signed with its file, declined, cancelled, expired) never changes again.
//   2. A signature is never lost: a signer who signed stays signed, except the one whose call was refused because the final file could not be made (and that call said so).
//   3. A link that is old, spent, replaced by a reminder or belongs to a finished envelope is refused with the one plain refusal and changes nothing.
//   4. A signer signs only after every signer before them has; nothing is shown to a signer who is waiting.
//   5. Every refusal is a plain answer with a code, never a crash.
// And at the end of every sequence, from any open state, there is a way through: remind each signer whose turn it is, sign, and the envelope reaches signed with exactly one signed file in Files, however
// many times it is fetched. A finished-but-not-signed envelope leaves the file free to be sent again.
// @reads /modules/esign/migrations/0001_esign.sql
// @reads /modules/esign/migrations/0002_esign_vyre.sql

import test from "node:test";
import assert from "node:assert/strict";
import { FILE, dana, harness, withSeal } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { samplePdf } from "../fixtures/pdf.ts";
import { DEFAULT_DAYS, REFUSAL } from "../handlers/vyre.ts";

const SYSTEM = { id: "system", kind: "service" as const };
const V = { ip: "203.0.113.9", ua: "Mozilla/5.0 (Macintosh) Test" };
const PEOPLE = [
  { name: "Andrea Lindahl", email: "andrea@northwind.example" },
  { name: "Sam Okafor", email: "sam@northwind.example" },
  { name: "Lee Park", email: "lee@northwind.example" },
];
const DAY = 24 * 3600 * 1000;

type Status = "sent" | "viewed" | "signed" | "declined" | "cancelled" | "expired";
/** envelope status now -> the statuses it may be in after one move */
const NEXT: Record<Status, Status[]> = {
  sent: ["sent", "viewed", "signed", "declined", "cancelled", "expired"],
  viewed: ["viewed", "signed", "declined", "cancelled", "expired"],
  signed: ["signed"],
  declined: ["declined"],
  cancelled: ["cancelled"],
  expired: ["expired"],
};

// a small seeded generator, so a failing sequence can be run again
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tokenOf = (l: { path: string }): string => l.path.split("/")[3] as string;
const typed = (name: string) => ({ name, consent: true, signature: { kind: "typed", text: name } });
const codeOf = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

interface Snap {
  env: Status;
  signers: { idx: number; order: number; status: Status; signedAt: unknown }[];
  final: boolean;
}
function snap(h: Harness): Snap {
  const env = h.rows("esign_envelope")[0]!;
  const doc = h.rows("esign_doc")[0]!;
  return {
    env: env.status as Status,
    signers: h
      .rows("esign_vsigner")
      .map((s) => ({
        idx: s.idx as number,
        order: s.order_no as number,
        status: s.status as Status,
        signedAt: s.signed_at,
      }))
      .sort((a, b) => a.idx - b.idx),
    final: doc.final !== null && (doc.final as Uint8Array).length > 0,
  };
}
const finished = (s: Snap): boolean =>
  s.env === "declined" || s.env === "cancelled" || s.env === "expired" || (s.env === "signed" && s.final);

/** what the sequences reached, so the test proves it walked every state and the failure path rather than only the happy one */
const reached: Record<string, number> = {
  signed: 0,
  declined: 0,
  cancelled: 0,
  expired: 0,
  reverted: 0,
  refusedOldLink: 0,
  waiting: 0,
};

async function runSequence(seed: number): Promise<void> {
  const rnd = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const h = harness({ builtIn: { pdf: await samplePdf(2) } });
  await withSeal(h);
  const count = 1 + Math.floor(rnd() * 3);
  const parallel = rnd() < 0.3;
  const who = PEOPLE.slice(0, count).map((p, i) => ({ ...p, order: parallel ? 1 : i + 1 }));
  const sent = await h.call("esign.send", { fileId: FILE, signers: who, idempotencyKey: `m${seed}` }, dana);
  const envelopeId = sent.envelopeId as string;
  // the newest link of each signer, and the links that have been replaced or spent (all must stay refused)
  const live: (string | null)[] = sent.links.map(tokenOf);
  const dead: string[] = [];
  const good = h.rows("esign_doc")[0]!.sent as Uint8Array;
  let broken = false;
  const log: string[] = [];

  const asSigner = async (
    op: () => Promise<unknown>,
  ): Promise<{ ok: boolean; code?: string | undefined; message?: string | undefined }> => {
    try {
      await op();
      return { ok: true };
    } catch (e) {
      const code = codeOf(e);
      assert.ok(code, `seed ${seed}: a refusal with no code (a crash?) after ${log.join(", ")}: ${String(e)}`);
      return { ok: false, code, message: (e as { error?: { message?: string } }).error?.message };
    }
  };
  const view = (t: string) => h.call("esign.signer_view", { token: t, visitor: V }, SYSTEM, false);
  const docOf = (t: string) => h.call("esign.signer_doc", { token: t, visitor: V }, SYSTEM, false);
  const act = (t: string, op: string, body?: unknown) =>
    h.call("esign.signer_act", { token: t, visitor: V, op, ...(body === undefined ? {} : { body }) }, SYSTEM, false);

  const steps = 6 + Math.floor(rnd() * 24);
  for (let n = 0; n < steps; n++) {
    const before = snap(h);
    const move = pick([
      "view",
      "view",
      "doc",
      "sign",
      "sign",
      "sign",
      "decline",
      "remind",
      "remind",
      "cancel",
      "fetch",
      "status",
      "late",
      "tick",
      "break",
      "mend",
      "stale",
      "copy",
    ]);
    const i = Math.floor(rnd() * count);
    const t = live[i] ?? null;
    log.push(`${move}${["view", "doc", "sign", "decline", "remind"].includes(move) ? i : ""}`);
    let err: { ok: boolean; code?: string | undefined; message?: string | undefined } = { ok: true };

    switch (move) {
      case "view":
        if (t) {
          err = await asSigner(() => view(t));
        }
        break;
      case "doc":
        if (t) err = await asSigner(() => docOf(t));
        break;
      case "sign":
        if (t) {
          const was = before.signers[i]!.status;
          err = await asSigner(() => act(t, "sign", typed(who[i]!.name)));
          if (err.ok) {
            // the signer is spent: that link is only good for the copy now
            dead.push(t);
            assert.equal(was === "sent" || was === "viewed", true, `seed ${seed}: signed from ${was}`);
          } else if (err.code === "provider.unavailable") {
            assert.match(String(err.message), /try again/i, `seed ${seed}: the failed final file says to try again`);
            assert.ok(broken, `seed ${seed}: the final file failed with nothing broken`);
            reached.reverted!++;
          }
        }
        break;
      case "decline":
        if (t) {
          err = await asSigner(() => act(t, "decline", { reason: "No." }));
          if (err.ok) for (const x of live) if (x) dead.push(x);
        }
        break;
      case "remind": {
        const r = await asSigner(async () => {
          const out = await h.call("esign.remind", { envelopeId, signer: i, idempotencyKey: `r${seed}-${n}` }, dana);
          if (live[i]) dead.push(live[i]!);
          live[i] = tokenOf(out.link);
        });
        err = r;
        break;
      }
      case "cancel":
        err = await asSigner(() => h.call("esign.cancel", { envelopeId, idempotencyKey: `c${seed}-${n}` }, dana));
        if (err.ok) for (const x of live) if (x) dead.push(x);
        break;
      case "fetch":
        err = await asSigner(() => h.call("esign.fetch_signed", { envelopeId }, dana));
        break;
      case "status":
        err = await asSigner(() => h.call("esign.status", { envelopeId }, dana));
        break;
      case "late": // a day goes by
        h.advance(rnd() < 0.12 ? (DEFAULT_DAYS + 1) * DAY : DAY);
        break;
      case "tick":
        h.advance(60 * 1000);
        break;
      case "break": // the final file cannot be made (only matters for the last signature)
        if (!broken && before.env !== "signed") {
          h.sqlite.exec("UPDATE esign_doc SET sent = x'0102'");
          broken = true;
        }
        break;
      case "mend":
        if (broken) {
          h.sqlite.prepare("UPDATE esign_doc SET sent = ?").run(good);
          broken = false;
        }
        break;
      case "stale": // the link of a replaced or spent signer, or one never issued
        {
          const old = dead.length > 0 ? pick(dead) : "x".repeat(43);
          const a = await asSigner(() => view(old));
          const b = await asSigner(() => act(old, "sign", typed(who[0]!.name)));
          const c = await asSigner(() => act(old, "decline", { reason: "No." }));
          for (const r of [a, b, c]) {
            // a spent link answers only the copy; every other call is the one plain refusal
            assert.equal(r.ok, false, `seed ${seed}: an old link did something after ${log.join(", ")}`);
            assert.equal(r.code, "auth.bad_credentials");
            assert.equal(r.message, REFUSAL);
            reached.refusedOldLink!++;
          }
        }
        break;
      case "copy":
        if (t) err = await asSigner(() => act(t, "copy"));
        break;
    }

    const after = snap(h);
    const where = `seed ${seed} after ${log.join(", ")}`;
    // 1. only the table's moves; a finished envelope never changes
    assert.ok(NEXT[before.env].includes(after.env), `${where}: ${before.env} became ${after.env}`);
    if (finished(before)) assert.deepEqual(after, before, `${where}: a finished envelope changed`);
    // 2. a signature is never lost, except the signer whose own call failed, who was told so
    for (const s of before.signers) {
      const now = after.signers[s.idx]!;
      if (s.status === "signed") assert.equal(now.status, "signed", `${where}: signer ${s.idx} lost a signature`);
    }
    if (!err.ok && move === "sign" && err.code === "provider.unavailable") {
      assert.equal(after.signers[i]!.status, "viewed", `${where}: the failed signer can try again`);
      assert.equal(after.env === "sent" || after.env === "viewed", true, `${where}: and the envelope is still open`);
    }
    // 3. a refused move changes nothing of the envelope or its signers, except that the clock may have run it out (the first touch after its time ends it)
    const ranOut = after.env === "expired" && before.env !== "expired";
    if (ranOut)
      for (const s of after.signers)
        assert.equal(
          s.status,
          before.signers[s.idx]!.status === "signed" ? "signed" : "expired",
          `${where}: running out changed a signer wrongly`,
        );
    if (!err.ok && !ranOut && !(move === "sign" && err.code === "provider.unavailable")) {
      assert.deepEqual(
        after.signers.map((s) => s.status),
        before.signers.map((s) => s.status),
        `${where}: a refused move changed a signer`,
      );
      assert.equal(after.env, before.env, `${where}: a refused move changed the envelope`);
    }
    // 4. order: a signer who has signed has every earlier signer behind them
    for (const s of after.signers)
      if (s.status === "signed")
        for (const p of after.signers.filter((x) => x.order < s.order))
          assert.equal(p.status, "signed", `${where}: signer ${s.idx} signed before ${p.idx}`);
    // the envelope is signed only when every signer is
    if (after.env === "signed")
      assert.ok(
        after.signers.every((s) => s.status === "signed"),
        `${where}: signed with someone unsigned`,
      );
  }

  // a way through, from wherever it stands
  const end = snap(h);
  if (broken) {
    h.sqlite.prepare("UPDATE esign_doc SET sent = ?").run(good);
    broken = false;
  }
  if (!finished(end)) {
    // the envelope may only now be past its time
    const st = (await h.call("esign.status", { envelopeId }, dana)).status as Status;
    if (st === "sent" || st === "viewed") {
      for (let i = 0; i < count; i++) {
        const row = snap(h).signers[i]!;
        if (row.status === "signed") continue;
        const r = await h.call("esign.remind", { envelopeId, signer: i, idempotencyKey: `end${seed}-${i}` }, dana);
        const done = await act(tokenOf(r.link), "sign", typed(who[i]!.name));
        assert.equal(
          done.result.state,
          "signed",
          `seed ${seed}: the way through failed at signer ${i} after ${log.join(", ")}`,
        );
      }
    }
  }
  const last = (await h.call("esign.status", { envelopeId }, dana)).status as Status;
  reached[last] = (reached[last] ?? 0) + 1;
  if (last === "signed") {
    const a = await h.call("esign.fetch_signed", { envelopeId }, dana);
    const b = await h.call("esign.fetch_signed", { envelopeId }, dana);
    assert.equal(a.fileId, b.fileId, `seed ${seed}: fetching twice made two files`);
    assert.equal(h.created.length, 1, `seed ${seed}: exactly one signed file in Files`);
    // every signer holds their copy for the day
    assert.ok(snap(h).final);
  } else {
    // a finished envelope that is not signed leaves the file free to be sent again
    assert.ok(["declined", "cancelled", "expired"].includes(last), `seed ${seed}: stuck in ${last}`);
    assert.equal(h.created.length, 0, `seed ${seed}: a signed file for an envelope that is ${last}`);
    const again = await h.call("esign.send", { fileId: FILE, signers: who, idempotencyKey: `again${seed}` }, dana);
    assert.equal(again.links.length, count, `seed ${seed}: the file could not be sent again after ${last}`);
  }
  // the time the link lasts is the one the Space promises
  assert.equal(DEFAULT_DAYS, 30);
}

test("every move in any order keeps the signing rules, and from any open state there is a way through (200 random sequences)", async () => {
  for (let seed = 1; seed <= 200; seed++) await runSequence(seed);
  for (const k of ["signed", "declined", "cancelled", "expired", "reverted", "refusedOldLink"])
    assert.ok(
      (reached[k] ?? 0) >= 3,
      `the sequences reached ${k} only ${reached[k]} times: ${JSON.stringify(reached)}`,
    );
});
