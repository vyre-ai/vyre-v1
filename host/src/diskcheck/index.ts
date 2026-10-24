// Is the data directory on an encrypted volume? (lead ruling Q1, ARCH 7.13, spec 3.13). The installer refuses to continue without it, `vyre-server doctor` reports it and the
// `host.disk_encrypted` health check goes down without it. Everything here reads command output and files through a small port, so the parsers are tested against recorded
// `fdesetup`, `diskutil`, `lsblk`, `zfs` and /proc/mounts text and the real host passes `child_process` and `fs`.
//   macOS    FileVault covers the startup volume (`fdesetup status`); a data directory on another volume is read from `diskutil info`.
//   Linux    the mount that holds the directory (longest prefix in /proc/mounts) must be a dm-crypt/LUKS stack (`lsblk -s` lists a `crypt` row), an encrypted ZFS dataset, or ecryptfs.
//   Other    cannot be verified, so it is reported as unknown and counts as not encrypted for the installer.
export type DiskState = "healthy" | "degraded" | "down";

export interface DiskVerdict {
  /** true encrypted, false plainly not, null could not be told */
  encrypted: boolean | null;
  state: DiskState;
  /** one sentence for the person, with the next step when it is not healthy */
  detail: string;
  /** what was looked at, for the support bundle: the mount source, the volume, the method */
  evidence: { method: "filevault" | "diskutil" | "luks" | "zfs" | "ecryptfs" | "none"; volume?: string; fsType?: string };
}

export interface Probe {
  /** platform name as in process.platform */
  os: string;
  /** run a command; code 127 when it does not exist, 124 on timeout */
  run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }>;
  readFile(path: string): Promise<string | null>;
}

// ---- parsers (pure)

/** `fdesetup status` prints "FileVault is On." or "FileVault is Off." (also "FileVault is Off, but will be enabled after the next restart"). */
export function parseFdesetup(out: string): boolean | null {
  if (/FileVault is On/i.test(out)) return true;
  if (/FileVault is Off/i.test(out)) return false;
  return null;
}

/** `diskutil info <path>` on APFS prints a "FileVault:  Yes" line for an encrypted volume and "No" otherwise; an unencrypted HFS+/exFAT volume has "Encrypted: No" or neither. */
export function parseDiskutil(out: string): boolean | null {
  const fv = /^\s*FileVault:\s*(Yes|No)\b/im.exec(out);
  if (fv) return fv[1]!.toLowerCase() === "yes";
  const en = /^\s*Encrypted:\s*(Yes|No)\b/im.exec(out);
  if (en) return en[1]!.toLowerCase() === "yes";
  return /^\s*Volume Name:/im.test(out) ? false : null;
}

export interface Mount { source: string; target: string; fsType: string }

/** /proc/mounts: "source target fstype options 0 0", with spaces in paths written as \040. */
export function parseMounts(text: string): Mount[] {
  const unescape = (s: string): string => s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));
  const out: Mount[] = [];
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 3) continue;
    out.push({ source: unescape(f[0]!), target: unescape(f[1]!), fsType: f[2]! });
  }
  return out;
}

/** The mount that holds `path`: the longest target that is `path` or a parent of it. Later lines win a tie (a re-mount over the same target). */
export function mountFor(mounts: Mount[], path: string): Mount | null {
  const p = path.replace(/\/+$/, "") || "/";
  let best: Mount | null = null;
  for (const m of mounts) {
    const t = m.target.replace(/\/+$/, "") || "/";
    const holds = t === "/" || p === t || p.startsWith(`${t}/`);
    if (holds && (!best || t.length >= (best.target.replace(/\/+$/, "") || "/").length)) best = m;
  }
  return best;
}

/** `lsblk -s -n -o TYPE <device>` lists the device and everything beneath it: a `crypt` row means dm-crypt/LUKS sits in the stack. */
export function stackIsEncrypted(lsblkTypes: string): boolean {
  return lsblkTypes.split("\n").some((l) => l.trim().toLowerCase() === "crypt");
}

/** `zfs get -H -o value encryption <dataset>`: "off" or a cipher name such as aes-256-gcm. */
export function parseZfsEncryption(out: string): boolean | null {
  const v = out.trim().split("\n")[0]?.trim().toLowerCase() ?? "";
  if (!v || v === "-") return null;
  return v !== "off";
}

// ---- the check

const FIX_MAC = "Turn on FileVault in System Settings, Privacy and Security, then run vyre-server doctor.";
const FIX_LINUX = "Put the data directory on a LUKS or dm-crypt volume, then run vyre-server doctor.";

const verdict = (encrypted: boolean | null, detail: string, evidence: DiskVerdict["evidence"]): DiskVerdict => ({
  encrypted, state: encrypted === true ? "healthy" : encrypted === false ? "down" : "degraded", detail, evidence,
});

async function onMac(p: Probe, dataDir: string): Promise<DiskVerdict> {
  if (dataDir.startsWith("/Volumes/")) {
    const d = await p.run("diskutil", ["info", dataDir]);
    const enc = d.code === 0 ? parseDiskutil(d.stdout) : null;
    const vol = dataDir.split("/").slice(0, 3).join("/");
    if (enc === true) return verdict(true, `${vol} is an encrypted volume.`, { method: "diskutil", volume: vol });
    if (enc === false) return verdict(false, `${vol} is not encrypted. Encrypt the volume in Disk Utility or keep the data directory on the startup disk with FileVault on.`, { method: "diskutil", volume: vol });
    return verdict(null, `Could not read the encryption state of ${vol}.`, { method: "diskutil", volume: vol });
  }
  const r = await p.run("fdesetup", ["status"]);
  const on = r.code === 127 ? null : parseFdesetup(r.stdout);
  if (on === true) return verdict(true, "FileVault is on.", { method: "filevault" });
  if (on === false) return verdict(false, `FileVault is off. ${FIX_MAC}`, { method: "filevault" });
  return verdict(null, "Could not read the FileVault state.", { method: "filevault" });
}

async function onLinux(p: Probe, dataDir: string): Promise<DiskVerdict> {
  const text = await p.readFile("/proc/mounts");
  const m = text === null ? null : mountFor(parseMounts(text), dataDir);
  if (!m) return verdict(null, "Could not find the volume that holds the data directory.", { method: "none" });
  const ev = { volume: m.source, fsType: m.fsType };
  if (m.fsType === "ecryptfs" || m.fsType === "fuse.gocryptfs" || m.fsType === "fuse.encfs") return verdict(true, `${m.target} is an encrypted file system (${m.fsType}).`, { method: "ecryptfs", ...ev });
  if (m.fsType === "zfs") {
    const z = await p.run("zfs", ["get", "-H", "-o", "value", "encryption", m.source]);
    const enc = z.code === 0 ? parseZfsEncryption(z.stdout) : null;
    if (enc === true) return verdict(true, `${m.source} is an encrypted ZFS dataset.`, { method: "zfs", ...ev });
    if (enc === false) return verdict(false, `${m.source} is a ZFS dataset without encryption. Create an encrypted dataset for the data directory.`, { method: "zfs", ...ev });
    return verdict(null, `Could not read the encryption of ${m.source}.`, { method: "zfs", ...ev });
  }
  if (!m.source.startsWith("/dev/")) {
    // overlay, tmpfs, nfs, fuse: there is no block device to look under
    return verdict(null, `The data directory is on ${m.fsType} (${m.source}), which cannot be checked from here. Mount an encrypted volume at the data directory.`, { method: "none", ...ev });
  }
  const t = await p.run("lsblk", ["-s", "-n", "-o", "TYPE", m.source]);
  if (t.code !== 0) return verdict(null, `Could not inspect ${m.source}.`, { method: "luks", ...ev });
  return stackIsEncrypted(t.stdout)
    ? verdict(true, `${m.source} sits on an encrypted volume.`, { method: "luks", ...ev })
    : verdict(false, `${m.source} is not encrypted. ${FIX_LINUX}`, { method: "luks", ...ev });
}

export async function checkDiskEncryption(p: Probe, dataDir: string): Promise<DiskVerdict> {
  if (p.os === "darwin") return onMac(p, dataDir);
  if (p.os === "linux") return onLinux(p, dataDir);
  return verdict(null, `Disk encryption cannot be checked on ${p.os}. Vyre Server runs on Linux or Mac.`, { method: "none" });
}

/** The installer's gate: only a proven encrypted volume lets it continue. */
export const installerMayContinue = (v: DiskVerdict): boolean => v.encrypted === true;

/** The shape the health module's probe store takes (health_probe: state, detail). */
export function toProbeResult(v: DiskVerdict): { state: DiskState; detail: string } {
  return { state: v.state, detail: v.detail };
}
