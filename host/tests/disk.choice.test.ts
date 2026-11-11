// What the Console says about disk encryption, from what the host script reports (VYRE_DISK_ENCRYPTION, VYRE_DOCKER_ROOT_*): each state has its own words and its own next step, and Docker's data root (where agent browser
// sign-ins live) is a finding of its own that only reports.
import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/daemon/config.ts";
import { diskNext, dockerRootFinding } from "../src/daemon/doctor.ts";
import { diskChoiceResult } from "../src/platform/probes.ts";
import { NEXT } from "../src/daemon/doctor-next.ts";

test("each recorded or seen state of the data disk has its own words and its own next step", () => {
  const plain = diskChoiceResult({ kind: "plain", since: "2026-11-11" })!;
  assert.equal(plain.state, "degraded");
  assert.match(plain.detail!, /^The data is NOT encrypted at rest\. You chose to install on a plain disk on 2026-11-11/);
  assert.equal(diskNext(plain.detail), NEXT.diskPlain, "not told to enable what was chosen not to");
  const prov = diskChoiceResult({ kind: "provider", since: "2026-11-11" })!;
  assert.equal(prov.state, "degraded");
  assert.match(prov.detail!, /^Not verified: your provider's encryption, as you stated on 2026-11-11/);
  assert.equal(diskNext(prov.detail), "Confirm with your provider that encryption at rest is on for the data volume.");
  const seen = diskChoiceResult({ kind: "detected" })!;
  assert.equal(seen.state, "healthy");
  const file = diskChoiceResult({ kind: "detected_file" })!;
  assert.equal(file.state, "degraded", "an encryption layer on a file: the host cannot tell where the key is");
  assert.match(file.detail!, /a key on this same disk protects nothing/);
  assert.equal(diskChoiceResult({ kind: "luks" }), null, "a value this version does not know is not trusted");
  assert.equal(diskNext("Could not find the volume"), NEXT.disk, "anything else keeps the old step");
});

test("Docker's data root: verified is healthy; the Space's data encrypted and Docker's root not is a finding of its own; the person's choice says agent browser sign-ins sit on that disk; never down", () => {
  const dir = "/var/lib/docker";
  assert.equal(dockerRootFinding(undefined, true, "detected"), null, "an older host script reports nothing, and doctor says nothing");
  const ok = dockerRootFinding({ dir, state: "encrypted" }, false, undefined)!;
  assert.equal(ok.state, "healthy");
  const mixed = dockerRootFinding({ dir, state: "plain" }, true, "detected")!;
  assert.equal(mixed.state, "degraded");
  assert.equal(mixed.key, "host.docker_root");
  assert.match(mixed.detail, /Docker's data root \(\/var\/lib\/docker\) is not on an encrypted volume, but the Space's data is\. Agent browser sign-ins \(agent computers' and the Space browser's Chrome profiles\) are stored unsealed in Docker volumes there, so they are not encrypted at rest\./);
  assert.equal(mixed.next, "Move Docker's data root onto the encrypted volume, or encrypt its disk.");
  assert.match(dockerRootFinding({ dir, state: "plain" }, false, "plain")!.detail, /are stored unsealed in Docker volumes on Docker's disk \(\/var\/lib\/docker\), which is not encrypted at rest \(the plain-disk choice you made covers it\)/);
  assert.match(dockerRootFinding({ dir, state: "plain" }, false, "provider")!.detail, /^Not verified: agent browser sign-ins .* stored unsealed in Docker volumes on Docker's disk/);
  assert.match(dockerRootFinding({ dir, state: "plain" }, false, undefined)!.detail, /not verified encrypted/);
  // "cannot tell" is its own state and is not called plain
  const unknown = dockerRootFinding({ dir, state: "unknown" }, true, "detected")!;
  assert.equal(unknown.state, "degraded");
  assert.match(unknown.detail, /^Could not tell whether Docker's data root \(\/var\/lib\/docker\) is encrypted: it is not a disk this server can look at \(as when Docker runs in a virtual machine, as on a Mac, where FileVault covers that machine's disk image\)\./);
  assert.doesNotMatch(unknown.detail, /not encrypted at rest|not on an encrypted volume/);
  assert.equal(unknown.next, "Check the encryption of the disk Docker's data lives on yourself.");
  assert.match(ok.detail, /stored unsealed in Docker volumes there; that disk's encryption protects them/);
  for (const state of ["plain", "unknown", "encrypted"]) for (const [data, choice] of [[true, "detected"], [false, "plain"], [false, "provider"], [false, undefined]] as const) assert.notEqual(dockerRootFinding({ dir, state }, data, choice)!.state, "down", "it reports; it never stops an existing server");
});

test("the daemon reads what the host script reports about the disk and Docker's data root", () => {
  const cfg = loadConfig(["--data-dir", "/tmp/x"], { VYRE_DISK_ENCRYPTION: "provider", VYRE_DISK_ENCRYPTION_SINCE: "2026-11-11", VYRE_DOCKER_ROOT_DIR: "/var/lib/docker", VYRE_DOCKER_ROOT_STATE: "plain" }, "1.0.0");
  assert.deepEqual(cfg.diskChoice, { kind: "provider", since: "2026-11-11" });
  assert.deepEqual(cfg.dockerRoot, { dir: "/var/lib/docker", state: "plain" });
  assert.equal(loadConfig(["--data-dir", "/tmp/x"], {}, "1.0.0").dockerRoot, undefined);
});
