// What a CLI engine may touch on files and in the terminal (owner rulings 3 Nov: "Personal is personal and everything goes zero friction ... it cannot get access to the folder that contains vyre's
// secrets"; "it needs to be able to install packages and things in your computer using terminal too"). One builder, engineAccess, makes the list on the machine that runs the engine; Seatbelt
// (seatbelt.ts) and bwrap (net/bwrap.ts) both apply it, and the Windows WSL2 sandbox can take it as it is: it is plain JSON.
//
//   own     the person's own computer (a Personal Space, or a Team Space turn on a member's computer): the folders the person added to Vyre from this computer, read and write; the user-level
//           package locations (Homebrew, npm, pip --user, cargo, go, nvm, pyenv, bun, deno and their caches), read and write, so installs work and stay; ~/.gitconfig, ~/.npmrc and
//           ~/.ssh/known_hosts read only; the SSH agent's socket, so git over SSH signs with the person's keys without ever reading them.
//   server  a Space server: only the turn's work folder and the Space's own toolbox (a persistent folder under the Space's data folder that package managers install into), never the host's.
//
// Denied always, even inside a folder the person added: Vyre's data folder (Vault, databases, keys), private key files and the other key stores, other apps' credential stores and browser profiles.
// The turn's own work and scratch folders sit inside Vyre's data folder and are opened again after the deny.
import path from "node:path";

export type EngineWhere = "own" | "server";

export interface EngineAccess {
  where: EngineWhere;
  /** Read and write: the person's folders, the package locations, the toolbox. */
  rw: string[];
  /** Read only: single files (configs) and folders (known_hosts lives in a closed folder). */
  roFiles: string[];
  /** Never, even inside an rw folder. */
  deny: string[];
  /** Opened again after `deny` (the turn's own folders inside Vyre's data folder). */
  reopen: string[];
  /** The SSH agent's socket, when there is one. */
  sshAuthSock?: string;
  /** Variables that point the package managers at the locations above, and folders to put first on PATH. */
  env: Record<string, string>;
  pathAdd: string[];
}

export interface EngineAccessInput {
  where: EngineWhere;
  /** This machine's home folder. */
  home: string;
  /** Vyre's data folder on this machine. */
  dataDir: string;
  platform: NodeJS.Platform;
  /** The folders the person added to Vyre from this computer (mounts.engine_folders), absolute paths. Ignored on a server. */
  folders?: readonly string[];
  /** The turn's own folders inside the data folder (work, scratch), opened again after the data folder is denied. */
  own?: readonly string[];
  /** The Space's toolbox on a server. Default `<dataDir>/toolbox`. */
  toolbox?: string;
  sshAuthSock?: string;
  /** Windows: %SystemRoot% (default C:\\Windows), whose drive's system folders an added folder may not be in. */
  systemRoot?: string;
  exists?: (p: string) => boolean;
}

const BAD = /[\u0000-\u001f\u007f"\\]/u;
/** Windows: what may not be in a folder name (besides the drive's colon), and control characters. */
const WIN_BAD = /[\u0000-\u001f\u007f"<>|?*]/u;

/** The path rules of the machine that runs the engine: Windows paths there, POSIX elsewhere. Every builder below takes the platform, so a test on Linux can check a Windows machine's list. */
export const pathFor = (platform: NodeJS.Platform): path.PlatformPath => (platform === "win32" ? path.win32 : path.posix);

/**
 * A Windows path in its plain form, or null when it names no folder on a disk: a drive (C:\x, C:/x), a share (\\server\share\x) or the long forms (\\?\C:\x, \\?\UNC\server\share\x), normalized,
 * with backslashes and no trailing one (except a drive's root). A device (\\.\pipe\x, \\?\GLOBALROOT, NUL), a drive-relative (C:x) or rooted-without-drive (\x) path is null.
 */
export function winFolder(p: string): string | null {
  let s = p.replace(/\//g, "\\");
  if (/^\\\\\?\\UNC\\/i.test(s)) s = `\\\\${s.slice(8)}`;
  else if (/^\\\\\?\\[A-Za-z]:\\/.test(s)) s = s.slice(4);
  if (/^\\\\[.?]\\/.test(s)) return null;
  const drive = /^[A-Za-z]:\\/.test(s);
  const unc = /^\\\\[^\\]+\\[^\\]+/.test(s);
  if (!drive && !unc) return null;
  // a colon anywhere but the drive's is an alternate data stream; the reserved characters are never in a folder name
  if (WIN_BAD.test(s) || s.slice(drive ? 2 : 0).includes(":")) return null;
  const n = path.win32.normalize(s);
  const root = path.win32.parse(n).root;
  // a drive's root keeps its backslash (C:\); a share's root and every folder lose the trailing one
  return /^[A-Za-z]:\\$/.test(root) && n.length <= root.length ? root : n.replace(/\\+$/, "");
}

/** Inside `dir` or `dir` itself, by the platform's rules: on Windows case does not matter and either slash may be used. */
export function insideFolder(p: string, dir: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") return p === dir || p.startsWith(`${dir.replace(/\/+$/, "")}/`);
  const a = winFolder(p)?.toLowerCase(), b = winFolder(dir)?.toLowerCase();
  if (!a || !b) return false;
  return a === b || a.startsWith(b.endsWith("\\") ? b : `${b}\\`);
}

/** The Windows system folders an added folder may not be in (the engine may read them, as every program can; it never holds them). `systemRoot` is %SystemRoot%, by default C:\Windows. */
export function winSystemFolders(systemRoot = "C:\\Windows"): string[] {
  const drive = path.win32.parse(systemRoot).root || "C:\\";
  return [systemRoot, ...["Program Files", "Program Files (x86)", "ProgramData", "$Recycle.Bin", "System Volume Information", "Recovery", "Boot", "PerfLogs"].map((d) => path.win32.join(drive, d))];
}

/** A folder the person added, as the sandbox may hold it: absolute, normalized, not the root, not a system folder, and not inside Vyre's data folder. Null when it may not be held. */
export function addedFolder(p: string, dataDir: string, o: { platform?: NodeJS.Platform; systemRoot?: string } = {}): string | null {
  const platform = o.platform ?? process.platform;
  if (typeof p !== "string") return null;
  if (platform === "win32") {
    const n = winFolder(p);
    if (n === null) return null;
    // a drive's root is the whole disk, as / is on a Mac; a share's root (\\server\share) is one share and may be added
    if (/^[A-Za-z]:\\$/.test(n)) return null;
    if (winSystemFolders(o.systemRoot).some((d) => insideFolder(n, d, "win32"))) return null;
    if (insideFolder(n, dataDir, "win32")) return null;
    return n;
  }
  if (!path.posix.isAbsolute(p) || BAD.test(p)) return null;
  const n = path.posix.normalize(p).replace(/\/+$/, "") || "/";
  if (n === "/" || /^\/(usr|bin|sbin|etc|dev|proc|sys|boot|System|Library|private\/etc|private\/var|var|run|root)(\/|$)/.test(n)) return null;
  if (n === dataDir || n.startsWith(`${dataDir}/`)) return null;
  return n;
}

/** Key stores and the like under a home folder: never readable, even when the person added the whole home. */
export function homeDenies(home: string, platform: NodeJS.Platform): string[] {
  const h = (p: string): string => pathFor(platform).join(home, p);
  const common = [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gcloud", ".netrc", ".git-credentials", ".password-store", ".vyre-keys", ".vyre", ".local/share/keyrings", ".config/gh", ".mozilla", ".config/google-chrome", ".config/chromium", ".config/BraveSoftware"].map(h);
  if (platform === "win32") {
    // Windows keeps the user's keys and saved sign-ins under AppData: Credential Manager (Credentials, Vault), DPAPI's master keys (Protect), CryptoAPI and CNG private keys (Crypto), the
    // browsers' profiles (cookies, saved passwords), Firefox's profiles, 1Password, and the CLIs' Windows homes (gcloud, gh, Azure). %USERPROFILE%\.ssh is in the common list: Windows OpenSSH keeps
    // its keys there; PuTTY's keys live wherever the person put them and its agent (Pageant) is reached by the pipe, not read.
    return [...common, ...["AppData\\Roaming\\Microsoft\\Credentials", "AppData\\Roaming\\Microsoft\\Protect", "AppData\\Roaming\\Microsoft\\Crypto", "AppData\\Roaming\\Microsoft\\Vault",
      "AppData\\Roaming\\Microsoft\\SystemCertificates", "AppData\\Local\\Microsoft\\Credentials", "AppData\\Local\\Microsoft\\Vault",
      "AppData\\Local\\Google\\Chrome\\User Data", "AppData\\Local\\Microsoft\\Edge\\User Data", "AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data", "AppData\\Local\\Chromium\\User Data",
      "AppData\\Roaming\\Opera Software", "AppData\\Roaming\\Mozilla\\Firefox\\Profiles", "AppData\\Local\\Mozilla\\Firefox\\Profiles", "AppData\\Roaming\\Thunderbird\\Profiles",
      "AppData\\Local\\1Password", "AppData\\Roaming\\1Password", "AppData\\Roaming\\Bitwarden", "AppData\\Roaming\\KeePass", "AppData\\Roaming\\gcloud", "AppData\\Roaming\\GitHub CLI",
      "AppData\\Roaming\\ai.vyre.desktop", "AppData\\Local\\ai.vyre.desktop"].map(h)];
  }
  if (platform !== "darwin") return common;
  return [...common, ...["Library/Keychains", "Library/Cookies", "Library/Safari", "Library/Mail", "Library/Messages", "Library/Application Support/Google/Chrome", "Library/Application Support/BraveSoftware",
    "Library/Application Support/Firefox", "Library/Application Support/Microsoft Edge", "Library/Application Support/Arc", "Library/Application Support/com.apple.TCC", "Library/Application Support/1Password",
    "Library/Group Containers"].map(h)];
}

/** The user-level places package managers install into and cache in, under the home folder and the Homebrew prefixes. */
export function packageLocations(home: string, platform: NodeJS.Platform): string[] {
  const h = (p: string): string => pathFor(platform).join(home, p);
  const inHome = [".npm", ".npm-global", ".local", ".cache", ".nvm", ".fnm", ".volta", ".pyenv", ".cargo", ".rustup", "go", ".bun", ".deno", ".gem", ".rbenv", ".yarn", ".pnpm-store", ".config/configstore"].map(h);
  if (platform === "win32") {
    // npm's global prefix and cache, pip --user and its cache, Yarn, pnpm, Go's build cache, Volta and fnm, Scoop's per-user apps
    return [...inHome, ...["AppData\\Roaming\\npm", "AppData\\Local\\npm-cache", "AppData\\Roaming\\Python", "AppData\\Local\\pip", "AppData\\Local\\Yarn", "AppData\\Local\\pnpm", "AppData\\Local\\go-build",
      "AppData\\Local\\Volta", "AppData\\Roaming\\fnm", "AppData\\Local\\node-gyp", "scoop"].map(h)];
  }
  if (platform === "darwin") {
    return [...inHome, ...["Library/Caches/Homebrew", "Library/Caches/pip", "Library/Caches/pypoetry", "Library/Caches/go-build", "Library/Caches/Yarn", "Library/Caches/pnpm", "Library/pnpm", "Library/Logs/Homebrew", "Library/Caches/node-gyp"].map(h),
      "/opt/homebrew", "/usr/local/Homebrew", "/usr/local/Cellar", "/usr/local/Caskroom", "/usr/local/bin", "/usr/local/lib", "/usr/local/share", "/usr/local/include", "/usr/local/opt", "/usr/local/var", "/usr/local/etc", "/usr/local/sbin", "/private/tmp"];
  }
  return [...inHome, "/home/linuxbrew/.linuxbrew"];
}

/** Windows OpenSSH's agent: a named pipe, the default when SSH_AUTH_SOCK is not set. */
export const WIN_SSH_AGENT_PIPE = "\\\\.\\pipe\\openssh-ssh-agent";

/** The SSH agent's address as the sandbox may pass it: an absolute socket path, or on Windows a named pipe (\\.\pipe\name, either slash). */
export function agentSocket(p: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (typeof p !== "string" || p === "") return undefined;
  if (platform === "win32") {
    const s = p.replace(/\//g, "\\");
    if (/^\\\\\.\\pipe\\[^\\\u0000-\u001f"<>|*?]+$/i.test(s)) return s;
    // MSYS's agent (Git Bash's ssh-agent) is a socket file under a drive; Windows OpenSSH cannot use it, Git's own ssh can
    return winFolder(s) ?? undefined;
  }
  return path.posix.isAbsolute(p) && !BAD.test(p) ? p : undefined;
}

/** The one builder. */
export function engineAccess(i: EngineAccessInput): EngineAccess {
  const exists = i.exists ?? (() => true);
  const own = [...(i.own ?? [])];
  const P = pathFor(i.platform);
  if (i.where === "server") {
    const toolbox = i.toolbox ?? P.join(i.dataDir, "toolbox");
    const t = (p: string): string => P.join(toolbox, p);
    return {
      where: "server", rw: [toolbox], roFiles: [], deny: [], reopen: own,
      env: { npm_config_prefix: t("npm"), npm_config_cache: t("npm-cache"), PYTHONUSERBASE: t("python"), PIP_CACHE_DIR: t("pip-cache"), CARGO_HOME: t("cargo"), RUSTUP_HOME: t("rustup"), GOPATH: t("go"), GOCACHE: t("go-cache"), BUN_INSTALL: t("bun"), DENO_DIR: t("deno"), GEM_HOME: t("gem") },
      pathAdd: [t("npm/bin"), t("python/bin"), t("cargo/bin"), t("go/bin"), t("bun/bin"), t("gem/bin")],
    };
  }
  const win = i.platform === "win32";
  const folders = [...new Set((i.folders ?? []).map((f) => addedFolder(f, i.dataDir, { platform: i.platform, ...(i.systemRoot ? { systemRoot: i.systemRoot } : {}) })).filter((f): f is string => f !== null))];
  const h = (p: string): string => P.join(i.home, p);
  const cache = i.platform === "darwin" ? h("Library/Caches") : win ? h("AppData\\Local") : h(".cache");
  const sock = agentSocket(i.sshAuthSock, i.platform);
  return {
    where: "own",
    rw: [...folders, ...packageLocations(i.home, i.platform).filter((p) => insideFolder(p, i.home, i.platform) || exists(p))],
    roFiles: [h(".gitconfig"), h(".config/git"), h(".npmrc"), h(".ssh/known_hosts"), h(".ssh/known_hosts2"), h(".ssh/config")].filter(exists),
    deny: [i.dataDir, ...homeDenies(i.home, i.platform)],
    reopen: own,
    ...(sock ? { sshAuthSock: sock } : {}),
    // HOME stays the engine's own (its sign-in and sessions); these point the tools at the person's own install locations, so what they install is on the computer and there the next turn. A tool the
    // person has not set up yet (no ~/.cargo) keeps its default under the engine's home, which persists too; nothing is made in the person's home unasked.
    env: Object.fromEntries(Object.entries({
      GIT_CONFIG_GLOBAL: h(".gitconfig"), NPM_CONFIG_USERCONFIG: h(".npmrc"), npm_config_cache: win ? h("AppData\\Local\\npm-cache") : h(".npm"),
      PYTHONUSERBASE: win ? h("AppData\\Roaming\\Python") : h(".local"), PIP_CACHE_DIR: win ? P.join(cache, "pip", "Cache") : P.join(cache, "pip"), CARGO_HOME: h(".cargo"), RUSTUP_HOME: h(".rustup"), GOPATH: h("go"), GOCACHE: P.join(cache, "go-build"),
      BUN_INSTALL: h(".bun"), NVM_DIR: h(".nvm"), PYENV_ROOT: h(".pyenv"), ...(i.platform === "darwin" ? { HOMEBREW_CACHE: h("Library/Caches/Homebrew"), HOMEBREW_LOGS: h("Library/Logs/Homebrew") } : {}),
      ...(win ? { npm_config_prefix: h("AppData\\Roaming\\npm") } : {}),
    }).filter(([, p]) => exists(p))),
    pathAdd: [...(win ? [h("AppData\\Roaming\\npm")] : [h(".local/bin"), h(".npm-global/bin")]), h(".cargo/bin"), h("go/bin"), h(".bun/bin"), h(".deno/bin")].filter(exists),
  };
}

/** The variable a spawn carries what the Space decided in (the place and the person's folders), from the opener to the launcher. Removed before the engine starts. */
export const ACCESS_ENV = "VYRE_ENGINE_ACCESS";
export interface AccessAsked { where: EngineWhere; folders: string[] }

export function accessFromEnv(v: string | undefined): AccessAsked | null {
  if (v === undefined || v === "") return null;
  let o: unknown;
  try { o = JSON.parse(v); } catch { return null; }
  const r = o as { where?: unknown; folders?: unknown };
  if ((r.where !== "own" && r.where !== "server") || !Array.isArray(r.folders) || r.folders.length > 200 || !r.folders.every((f) => typeof f === "string")) return null;
  return { where: r.where, folders: r.folders as string[] };
}

/** ssh's known-hosts files and config inside the sandbox: the engine's own file first (where a new host is written), then the person's, read only; the person's config when it may be read. */
export function sshFiles(access: EngineAccess | undefined, ownKnownHosts: string): { knownHosts: string[]; config?: string } {
  const known = access?.roFiles.find((p) => /[\\/]\.ssh[\\/]known_hosts$/.test(p));
  const config = access?.roFiles.find((p) => /[\\/]\.ssh[\\/]config$/.test(p));
  return { knownHosts: [ownKnownHosts, ...(known ? [known] : [])], ...(config ? { config } : {}) };
}
