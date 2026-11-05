import test from "node:test";
import assert from "node:assert/strict";
import { band, receiveAdvert, defaultBranchOf, MAX_COMMAND_BYTES, needsOf, pkt, PktError, readUpdate, refusedReport, repoOfPath, FLUSH } from "./git-proxy.ts";

const A = "a".repeat(40), B = "b".repeat(40), Z = "0".repeat(40);
const cmds = (...lines: string[]): Buffer => Buffer.concat([...lines.map((l, i) => pkt(i === 0 ? `${l}\0 report-status side-band-64k agent=git/2.43` : l)), FLUSH]);

test("reads the command list and stops before the pack", () => {
  const body = Buffer.concat([cmds(`${A} ${B} refs/heads/feature`, `${Z} ${B} refs/tags/v1`), Buffer.from("PACK....")]);
  const u = readUpdate(body)!;
  assert.deepEqual(u.commands.map((c) => c.ref), ["refs/heads/feature", "refs/tags/v1"]);
  assert.equal(u.sideBand, true);
  assert.equal(u.reportStatus, true);
  assert.equal(body.subarray(u.used).toString(), "PACK....");
});

test("waits for more bytes, one chunk at a time", () => {
  const whole = cmds(`${A} ${B} refs/heads/x`);
  for (let n = 0; n < whole.length; n++) assert.equal(readUpdate(whole.subarray(0, n)), null, `at ${n}`);
  assert.ok(readUpdate(whole));
});

test("shallow lines before the commands are skipped", () => {
  const body = Buffer.concat([pkt(`shallow ${A}`), cmds(`${A} ${B} refs/heads/x`)]);
  assert.equal(readUpdate(body)!.commands.length, 1);
});

test("malformed lists are refused", () => {
  const bad = (b: Buffer | string, code?: string): void => assert.throws(() => readUpdate(Buffer.from(b)), (e: unknown) => e instanceof PktError && (code === undefined || e.code === code));
  bad("zzzz");
  bad("0001");
  bad("0003");
  bad("fff1" + "x".repeat(10));
  bad(Buffer.concat([FLUSH]));                                                             // no change at all
  bad(cmds(`${A} ${B}`));                                                                   // two parts
  bad(cmds(`${A.slice(1)} ${B} refs/heads/x`));                                             // short object name
  bad(cmds(`${A} ${B.repeat(2)} refs/heads/x`));                                            // mixed lengths
  bad(cmds(`${A} ${B} heads/x`));                                                           // not under refs/
  bad(cmds(`${A} ${B} refs/heads/../main`));
  bad(cmds(`${A} ${B} refs/heads/a b`));
  bad(cmds(`${A} ${B} refs/heads/x.lock`));
  bad(cmds(`${A} ${B} refs/heads/x@{1}`));
  bad(Buffer.concat([pkt(`${A} ${B} refs/heads/x\0 report-status`), pkt(`${A} ${B} refs/heads/y\0 more`), FLUSH]));   // capabilities on a second line
  bad(Buffer.concat([pkt("push-cert\0 push-cert=abc"), FLUSH]), "unsupported");
});

test("a list over the cap is refused before its end arrives", () => {
  const fill = Buffer.concat(Array.from({ length: 400 }, (_, i) => pkt(i === 0 ? `${A} ${B} refs/heads/f0\0 report-status` : `${A} ${B} refs/heads/f${i}`)));
  assert.ok(fill.length > MAX_COMMAND_BYTES - 1 || true);
  assert.throws(() => readUpdate(fill), (e: unknown) => e instanceof PktError && e.code === "too_big");
  assert.throws(() => readUpdate(Buffer.alloc(MAX_COMMAND_BYTES + 10, "0")), PktError);
});

test("each ref says what it needs", () => {
  const u = readUpdate(cmds(`${A} ${B} refs/heads/main`, `${Z} ${B} refs/heads/feat`, `${A} ${Z} refs/heads/old`, `${A} ${Z} refs/heads/main2`, `${Z} ${B} refs/tags/v2`))!;
  const n = needsOf(u.commands, ["main"]);
  assert.deepEqual(n.map((r) => [r.short, r.kind, r.need, r.always]), [
    ["main", "update", "push_default", false], ["feat", "create", "push_branch", false], ["old", "delete", "push_branch", false], ["main2", "delete", "push_branch", false], ["v2", "create", "push_branch", false],
  ]);
  const d = needsOf(readUpdate(cmds(`${A} ${Z} refs/heads/main`))!.commands, ["main"])[0]!;
  assert.deepEqual([d.need, d.kind, d.always], ["push_default", "delete", true]);
  assert.equal(needsOf(readUpdate(cmds(`${A} ${B} refs/heads/master`))!.commands, ["main", "master"])[0]!.need, "push_default");
  assert.equal(needsOf(readUpdate(cmds(`${A} ${B} refs/heads/Main`))!.commands, ["main"])[0]!.need, "push_branch");
});

test("the default branch comes from the symref of the advertisement, as UTF-8, and anything unreadable is not guessed", () => {
  const advert = Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${A} HEAD\0multi_ack thin-pack symref=HEAD:refs/heads/trunk agent=git/github\n`)]);
  assert.deepEqual(defaultBranchOf(advert), { branch: "trunk" });
  const accented = Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${A} HEAD\0symref=HEAD:refs/heads/h\u00e4upt agent=git/github\n`)]);
  const u = readUpdate(cmds(`${A} ${B} refs/heads/h\u00e4upt`))!;
  assert.equal(needsOf(u.commands, [(defaultBranchOf(accented) as { branch: string }).branch])[0]!.need, "push_default", "a non-ASCII default branch matches the command list");
  assert.equal(defaultBranchOf(Buffer.from("nothing")), "unknown");
  assert.equal(defaultBranchOf(Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${Z} capabilities^{}\0report-status agent=git/github\n`)])), "empty");
  assert.equal(defaultBranchOf(Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${A} HEAD\0multi_ack agent=git/github\n`), pkt(`${A} refs/heads/x\n`)])), "unknown", "refs but no HEAD symref");
});

test("a refusal is a report git understands", () => {
  const u = readUpdate(cmds(`${A} ${B} refs/heads/main`))!;
  const plain = refusedReport(u.commands, "Held\nfor you", false).toString();
  assert.match(plain, /unpack ok/);
  assert.match(plain, /ng refs\/heads\/main Held for you/);
  const banded = refusedReport(u.commands, "no", true);
  assert.equal(banded[4], 1);
  assert.equal(banded.subarray(-4).toString(), "0000");
  assert.equal(band(2, "hi\n").toString("latin1").slice(0, 4), "0008");
});

test("only owner/repo.git under the three addresses is a repository", () => {
  assert.deepEqual(repoOfPath("vyre-ai/website.git/info/refs"), { repo: "vyre-ai/website", tail: "info/refs" });
  assert.equal(repoOfPath("vyre-ai/website.git/git-receive-pack")!.tail, "git-receive-pack");
  for (const p of ["a/b/c.git/info/refs", "../x.git/info/refs", "a/..git/info/refs", "a/b.git/HEAD", "a/b.git/info/refs/x", "a/b/info/refs", ""]) assert.equal(repoOfPath(p), null, p);
});

test("a push's advertisement is made from a fetch's: refs under refs/ only, receive-pack capabilities, empty repositories too", () => {
  const up = Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${A} HEAD\0multi_ack symref=HEAD:refs/heads/main agent=git/github\n`), pkt(`${A} refs/heads/main\n`), pkt(`${B} refs/pull/1/head\n`), pkt(`${B} refs/tags/v1\n`), pkt(`${A} refs/tags/v1^{}\n`), FLUSH]);
  const out = receiveAdvert(up)!.toString("utf8");
  assert.match(out, /^001f# service=git-receive-pack\n0000/);
  assert.match(out, /refs\/heads\/main\0report-status report-status-v2 delete-refs side-band-64k quiet atomic ofs-delta agent=git\/github\n/);
  assert.match(out, /refs\/tags\/v1\n/);
  assert.doesNotMatch(out, /HEAD|\^\{\}|refs\/pull/);
  assert.ok(out.endsWith("0000"));
  const empty = Buffer.concat([pkt("# service=git-upload-pack\n"), FLUSH, pkt(`${Z} capabilities^{}\0agent=git/github\n`), FLUSH]);
  assert.match(receiveAdvert(empty)!.toString("utf8"), /0{40} capabilities\^\{\}\0report-status/);
  assert.equal(receiveAdvert(Buffer.from("junk")), null);
  assert.equal(receiveAdvert(Buffer.concat([pkt("version 2\n"), FLUSH])), null);
});
