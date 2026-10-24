// The disk encryption check against recorded fdesetup, diskutil, lsblk, zfs and /proc/mounts output (lead ruling Q1).
import test from "node:test";
import assert from "node:assert/strict";
import {
  checkDiskEncryption, installerMayContinue, mountFor, parseDiskutil, parseFdesetup, parseMounts, parseZfsEncryption, stackIsEncrypted, toProbeResult,
} from "./index.ts";
import type { Probe } from "./index.ts";

// ---- recorded output

const FDESETUP_ON = "FileVault is On.\n";
const FDESETUP_OFF = "FileVault is Off.\n";
const FDESETUP_PENDING = "FileVault is Off, but will be enabled after the next restart or login.\n";

const DISKUTIL_ENCRYPTED = `   Device Identifier:         disk5s1
   Device Node:               /dev/disk5s1
   Volume Name:               Vyre Data
   Mounted:                   Yes
   Mount Point:               /Volumes/Vyre Data
   Type (Bundle):             apfs
   File System Personality:   APFS
   FileVault:                 Yes (Unlocked)
   Encrypted:                 No
`;
const DISKUTIL_PLAIN = `   Device Identifier:         disk6s2
   Volume Name:               Backup
   Mounted:                   Yes
   Mount Point:               /Volumes/Backup
   Type (Bundle):             apfs
   FileVault:                 No
`;
const DISKUTIL_EXFAT = `   Device Identifier:         disk7s1
   Volume Name:               STICK
   Mount Point:               /Volumes/STICK
   Type (Bundle):             exfat
   File System Personality:   ExFAT
`;

const MOUNTS_LUKS = `sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
/dev/mapper/vg0-root / ext4 rw,relatime,errors=remount-ro 0 0
/dev/nvme0n1p2 /boot ext4 rw,relatime 0 0
/dev/mapper/luks-9f3c1a2e /srv/vyre ext4 rw,relatime 0 0
/dev/sda3 /home ext4 rw,relatime 0 0
/dev/mapper/crypt\\040data /mnt/my\\040files ext4 rw,relatime 0 0
tmpfs /run tmpfs rw,nosuid,nodev,size=1603268k,mode=755 0 0
`;
const MOUNTS_DOCKER = `overlay / overlay rw,relatime,lowerdir=/var/lib/docker/overlay2/l/ABC,upperdir=/var/lib/docker/overlay2/x/diff 0 0
proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0
tmpfs /dev tmpfs rw,nosuid,size=65536k,mode=755 0 0
`;
const MOUNTS_ZFS = `rpool/ROOT/ubuntu / zfs rw,relatime,xattr,noacl 0 0
tank/vyre /srv/vyre zfs rw,relatime,xattr,noacl 0 0
tank/plain /srv/plain zfs rw,relatime,xattr,noacl 0 0
`;
const MOUNTS_ECRYPTFS = `/home/.ecryptfs/alex/.Private /home/alex ecryptfs rw,nosuid,nodev,relatime,ecryptfs_sig=0123456789abcdef 0 0
/dev/sda2 / ext4 rw,relatime 0 0
`;

const LSBLK_LUKS = "crypt\npart\ndisk\n";
const LSBLK_LVM_ON_LUKS = "lvm\ncrypt\npart\ndisk\n";
const LSBLK_PLAIN = "part\ndisk\n";

function probe(o: { os: string; cmds?: Record<string, { code: number; stdout: string }>; files?: Record<string, string> }): Probe & { ran: string[] } {
  const ran: string[] = [];
  return {
    os: o.os, ran,
    run: async (cmd, args) => { const k = [cmd, ...args].join(" "); ran.push(k); return o.cmds?.[k] ?? { code: 127, stdout: "" }; },
    readFile: async (p) => o.files?.[p] ?? null,
  };
}

// ---- parsers

test("fdesetup: on, off, off-but-pending, and anything else", () => {
  assert.equal(parseFdesetup(FDESETUP_ON), true);
  assert.equal(parseFdesetup(FDESETUP_OFF), false);
  assert.equal(parseFdesetup(FDESETUP_PENDING), false, "enabled after a restart is not encrypted now");
  assert.equal(parseFdesetup("Error: something\n"), null);
  assert.equal(parseFdesetup(""), null);
});

test("diskutil: the FileVault line wins, then Encrypted, then a volume with neither is plain", () => {
  assert.equal(parseDiskutil(DISKUTIL_ENCRYPTED), true);
  assert.equal(parseDiskutil(DISKUTIL_PLAIN), false);
  assert.equal(parseDiskutil(DISKUTIL_EXFAT), false);
  assert.equal(parseDiskutil("   Encrypted:   Yes\n"), true);
  assert.equal(parseDiskutil("Could not find disk\n"), null);
});

test("/proc/mounts: fields, escaped spaces, and the mount that holds a path", () => {
  const mounts = parseMounts(MOUNTS_LUKS);
  assert.equal(mounts.length, 8);
  assert.deepEqual(mounts[2], { source: "/dev/mapper/vg0-root", target: "/", fsType: "ext4" });
  assert.deepEqual(mounts[6], { source: "/dev/mapper/crypt data", target: "/mnt/my files", fsType: "ext4" });
  assert.equal(mountFor(mounts, "/srv/vyre/data/events")?.source, "/dev/mapper/luks-9f3c1a2e");
  assert.equal(mountFor(mounts, "/srv/vyre")?.source, "/dev/mapper/luks-9f3c1a2e");
  assert.equal(mountFor(mounts, "/srv/vyre2/data")?.source, "/dev/mapper/vg0-root", "a longer name is not inside /srv/vyre");
  assert.equal(mountFor(mounts, "/var/lib/vyre")?.target, "/");
  assert.equal(mountFor(mounts, "/mnt/my files/x")?.source, "/dev/mapper/crypt data");
  assert.equal(mountFor([], "/x"), null);
  assert.deepEqual(parseMounts("garbage\n\n"), []);
});

test("lsblk: a crypt row anywhere in the stack means dm-crypt/LUKS", () => {
  assert.equal(stackIsEncrypted(LSBLK_LUKS), true);
  assert.equal(stackIsEncrypted(LSBLK_LVM_ON_LUKS), true);
  assert.equal(stackIsEncrypted(LSBLK_PLAIN), false);
  assert.equal(stackIsEncrypted(""), false);
});

test("zfs: off, a cipher, and no answer", () => {
  assert.equal(parseZfsEncryption("aes-256-gcm\n"), true);
  assert.equal(parseZfsEncryption("off\n"), false);
  assert.equal(parseZfsEncryption("-\n"), null);
  assert.equal(parseZfsEncryption(""), null);
});

// ---- the check

test("mac: FileVault on is healthy and off is down with the next step", async () => {
  const on = await checkDiskEncryption(probe({ os: "darwin", cmds: { "fdesetup status": { code: 0, stdout: FDESETUP_ON } } }), "/Users/me/vyre");
  assert.deepEqual([on.encrypted, on.state, on.evidence.method], [true, "healthy", "filevault"]);
  const off = await checkDiskEncryption(probe({ os: "darwin", cmds: { "fdesetup status": { code: 0, stdout: FDESETUP_OFF } } }), "/Users/me/vyre");
  assert.deepEqual([off.encrypted, off.state], [false, "down"]);
  assert.match(off.detail, /System Settings, Privacy and Security/);
  assert.match(off.detail, /vyre-server doctor/);
});

test("mac: fdesetup missing or unreadable is unknown, which does not pass the installer", async () => {
  const variants: Record<string, { code: number; stdout: string }>[] = [{}, { "fdesetup status": { code: 1, stdout: "Error: not permitted\n" } }];
  for (const cmds of variants) {
    const v = await checkDiskEncryption(probe({ os: "darwin", cmds }), "/Users/me/vyre");
    assert.deepEqual([v.encrypted, v.state, installerMayContinue(v)], [null, "degraded", false]);
  }
});

test("mac: a data directory on another volume is judged by that volume, not by the startup disk", async () => {
  const cmds = {
    "diskutil info /Volumes/Vyre Data/vyre": { code: 0, stdout: DISKUTIL_ENCRYPTED },
    "diskutil info /Volumes/Backup/vyre": { code: 0, stdout: DISKUTIL_PLAIN },
    "diskutil info /Volumes/Gone/vyre": { code: 1, stdout: "Could not find disk\n" },
    "fdesetup status": { code: 0, stdout: FDESETUP_ON },
  };
  const yes = probe({ os: "darwin", cmds });
  const a = await checkDiskEncryption(yes, "/Volumes/Vyre Data/vyre");
  assert.deepEqual([a.encrypted, a.evidence.method, a.evidence.volume], [true, "diskutil", "/Volumes/Vyre Data"]);
  assert.ok(!yes.ran.includes("fdesetup status"), "FileVault on the startup disk says nothing about another volume");
  const b = await checkDiskEncryption(probe({ os: "darwin", cmds }), "/Volumes/Backup/vyre");
  assert.deepEqual([b.encrypted, b.state], [false, "down"]);
  const c = await checkDiskEncryption(probe({ os: "darwin", cmds }), "/Volumes/Gone/vyre");
  assert.deepEqual([c.encrypted, c.state], [null, "degraded"]);
});

test("linux: a data directory on a LUKS volume is healthy and the evidence names the device", async () => {
  const p = probe({ os: "linux", files: { "/proc/mounts": MOUNTS_LUKS }, cmds: { "lsblk -s -n -o TYPE /dev/mapper/luks-9f3c1a2e": { code: 0, stdout: LSBLK_LUKS } } });
  const v = await checkDiskEncryption(p, "/srv/vyre/data");
  assert.deepEqual([v.encrypted, v.state, v.evidence], [true, "healthy", { method: "luks", volume: "/dev/mapper/luks-9f3c1a2e", fsType: "ext4" }]);
  assert.match(v.detail, /encrypted volume/);
  assert.equal(installerMayContinue(v), true);
});

test("linux: LVM on LUKS counts, a plain partition does not", async () => {
  const cmds = {
    "lsblk -s -n -o TYPE /dev/mapper/vg0-root": { code: 0, stdout: LSBLK_LVM_ON_LUKS },
    "lsblk -s -n -o TYPE /dev/sda3": { code: 0, stdout: LSBLK_PLAIN },
  };
  const root = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_LUKS }, cmds }), "/var/lib/vyre");
  assert.deepEqual([root.encrypted, root.evidence.volume], [true, "/dev/mapper/vg0-root"]);
  const home = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_LUKS }, cmds }), "/home/vyre");
  assert.deepEqual([home.encrypted, home.state, installerMayContinue(home)], [false, "down", false]);
  assert.match(home.detail, /LUKS or dm-crypt/);
  assert.match(home.detail, /\/dev\/sda3/);
});

test("linux: a path with a space in its mount is read from the escaped /proc/mounts line", async () => {
  const p = probe({ os: "linux", files: { "/proc/mounts": MOUNTS_LUKS }, cmds: { "lsblk -s -n -o TYPE /dev/mapper/crypt data": { code: 0, stdout: LSBLK_LUKS } } });
  assert.equal((await checkDiskEncryption(p, "/mnt/my files/vyre")).encrypted, true);
});

test("linux: a container root, a missing /proc/mounts and a failing lsblk are unknown", async () => {
  const docker = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_DOCKER } }), "/data");
  assert.deepEqual([docker.encrypted, docker.state, docker.evidence.fsType], [null, "degraded", "overlay"]);
  assert.match(docker.detail, /Mount an encrypted volume/);
  const none = await checkDiskEncryption(probe({ os: "linux" }), "/data");
  assert.deepEqual([none.encrypted, none.state], [null, "degraded"]);
  const broken = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_LUKS }, cmds: { "lsblk -s -n -o TYPE /dev/mapper/luks-9f3c1a2e": { code: 1, stdout: "" } } }), "/srv/vyre");
  assert.deepEqual([broken.encrypted, broken.state], [null, "degraded"]);
});

test("linux: ZFS datasets are judged by their encryption property", async () => {
  const cmds = {
    "zfs get -H -o value encryption tank/vyre": { code: 0, stdout: "aes-256-gcm\n" },
    "zfs get -H -o value encryption tank/plain": { code: 0, stdout: "off\n" },
  };
  const yes = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_ZFS }, cmds }), "/srv/vyre/data");
  assert.deepEqual([yes.encrypted, yes.evidence.method], [true, "zfs"]);
  const no = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_ZFS }, cmds }), "/srv/plain");
  assert.deepEqual([no.encrypted, no.state], [false, "down"]);
  const unknown = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_ZFS } }), "/srv/vyre");
  assert.deepEqual([unknown.encrypted, unknown.state], [null, "degraded"]);
});

test("linux: ecryptfs is an encrypted file system", async () => {
  const v = await checkDiskEncryption(probe({ os: "linux", files: { "/proc/mounts": MOUNTS_ECRYPTFS } }), "/home/alex/vyre");
  assert.deepEqual([v.encrypted, v.evidence.method], [true, "ecryptfs"]);
});

test("other systems cannot be checked", async () => {
  const v = await checkDiskEncryption(probe({ os: "win32" }), "C:\\vyre");
  assert.deepEqual([v.encrypted, v.state, installerMayContinue(v)], [null, "degraded", false]);
  assert.match(v.detail, /win32/);
});

test("the health probe result carries the state and the sentence", async () => {
  const v = await checkDiskEncryption(probe({ os: "darwin", cmds: { "fdesetup status": { code: 0, stdout: FDESETUP_OFF } } }), "/Users/me/vyre");
  assert.deepEqual(toProbeResult(v), { state: "down", detail: v.detail });
});

// P-L7b_04 final run.
