// The Linux that Vyre imports into WSL2 to sandbox CLI engines on Windows (docs/windows-engine-sandbox.md, option B). Pinned like the engines (modules/engine/engine-pins.ts): the vendor's own file,
// its size and SHA-256, checked before anything is imported. Alpine's minirootfs is small (3 MB) and its package manager checks every package against the signing keys inside that pinned file.
// The packages are pinned to their minor version (`~`): Alpine keeps only the newest -rN of a version, so an exact -rN would stop installing on its first security rebuild.

export interface DistroBuild { url: string; size: number; sha256: string }

export interface DistroPin {
  /** The name the distribution is imported under; one per Windows user. */
  name: string;
  version: string;
  /** Written to /etc/vyre-sandbox once set up: a pin change sets the distribution up again. */
  stamp: string;
  /** The unprivileged user the agent and every sandbox run as (never root: an engine refuses some modes as root, and a sandbox never needs it). */
  user: string;
  builds: Readonly<Partial<Record<"x64" | "arm64", DistroBuild>>>;
  /** What the sandbox needs inside: bubblewrap, Node (the net wall, the guest bridge, the MCP shim), and what Claude Code needs on musl (bash, ripgrep, libgcc, libstdc++). */
  packages: readonly string[];
}

export const DISTRO_PIN: DistroPin = Object.freeze({
  name: "vyre-sandbox",
  user: "vyre",
  version: "alpine-3.22.7",
  stamp: "alpine-3.22.7+bwrap0.12+node22+2",
  builds: {
    x64: { url: "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/alpine-minirootfs-3.22.7-x86_64.tar.gz", size: 3_647_472, sha256: "57e364a241bab0699cd8a760c0fd7b270e9cbcbd3cee822cb2b07ca6d925c16c" },
    arm64: { url: "https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/aarch64/alpine-minirootfs-3.22.7-aarch64.tar.gz", size: 3_971_679, sha256: "7e9b34ff3304381909e566e2c93de450664ccc724191261423974fc121c11623" },
  },
  packages: ["bubblewrap~0.12", "nodejs~22", "bash", "git", "ripgrep", "libgcc", "libstdc++", "ca-certificates"],
});

/** The only hosts the distribution's download may touch. */
export const DISTRO_HOSTS: readonly string[] = ["dl-cdn.alpinelinux.org"];
