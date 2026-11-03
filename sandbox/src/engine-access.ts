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
  exists?: (p: string) => boolean;
}

const BAD = /[\u0000-\u001f\u007f"\\]/u;

/** A folder the person added, as the sandbox may hold it: absolute, normalized, not the root, not a system folder, and not inside Vyre's data folder. Null when it may not be held. */
export function addedFolder(p: string, dataDir: string): string | null {
  if (typeof p !== "string" || !path.isAbsolute(p) || BAD.test(p)) return null;
  const n = path.normalize(p).replace(/\/+$/, "") || "/";
  if (n === "/" || /^\/(usr|bin|sbin|etc|dev|proc|sys|boot|System|Library|private\/etc|private\/var|var|run|root)(\/|$)/.test(n)) return null;
  if (n === dataDir || n.startsWith(`${dataDir}/`)) return null;
  return n;
}

/** Key stores and the like under a home folder: never readable, even when the person added the whole home. */
export function homeDenies(home: string, platform: NodeJS.Platform): string[] {
  const h = (p: string): string => path.join(home, p);
  const common = [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gcloud", ".netrc", ".git-credentials", ".password-store", ".vyre-keys", ".vyre", ".local/share/keyrings", ".config/gh", ".mozilla", ".config/google-chrome", ".config/chromium", ".config/BraveSoftware"].map(h);
  if (platform !== "darwin") return common;
  return [...common, ...["Library/Keychains", "Library/Cookies", "Library/Safari", "Library/Mail", "Library/Messages", "Library/Application Support/Google/Chrome", "Library/Application Support/BraveSoftware",
    "Library/Application Support/Firefox", "Library/Application Support/Microsoft Edge", "Library/Application Support/Arc", "Library/Application Support/com.apple.TCC", "Library/Application Support/1Password",
    "Library/Group Containers"].map(h)];
}

/** The user-level places package managers install into and cache in, under the home folder and the Homebrew prefixes. */
export function packageLocations(home: string, platform: NodeJS.Platform): string[] {
  const h = (p: string): string => path.join(home, p);
  const inHome = [".npm", ".npm-global", ".local", ".cache", ".nvm", ".fnm", ".volta", ".pyenv", ".cargo", ".rustup", "go", ".bun", ".deno", ".gem", ".rbenv", ".yarn", ".pnpm-store", ".config/configstore"].map(h);
  if (platform === "darwin") {
    return [...inHome, ...["Library/Caches/Homebrew", "Library/Caches/pip", "Library/Caches/pypoetry", "Library/Caches/go-build", "Library/Caches/Yarn", "Library/Caches/pnpm", "Library/pnpm", "Library/Logs/Homebrew", "Library/Caches/node-gyp"].map(h),
      "/opt/homebrew", "/usr/local/Homebrew", "/usr/local/Cellar", "/usr/local/Caskroom", "/usr/local/bin", "/usr/local/lib", "/usr/local/share", "/usr/local/include", "/usr/local/opt", "/usr/local/var", "/usr/local/etc", "/usr/local/sbin", "/private/tmp"];
  }
  return [...inHome, "/home/linuxbrew/.linuxbrew"];
}

/** The one builder. */
export function engineAccess(i: EngineAccessInput): EngineAccess {
  const exists = i.exists ?? (() => true);
  const own = [...(i.own ?? [])];
  if (i.where === "server") {
    const toolbox = i.toolbox ?? path.join(i.dataDir, "toolbox");
    const t = (p: string): string => path.join(toolbox, p);
    return {
      where: "server", rw: [toolbox], roFiles: [], deny: [], reopen: own,
      env: { npm_config_prefix: t("npm"), npm_config_cache: t("npm-cache"), PYTHONUSERBASE: t("python"), PIP_CACHE_DIR: t("pip-cache"), CARGO_HOME: t("cargo"), RUSTUP_HOME: t("rustup"), GOPATH: t("go"), GOCACHE: t("go-cache"), BUN_INSTALL: t("bun"), DENO_DIR: t("deno"), GEM_HOME: t("gem") },
      pathAdd: [t("npm/bin"), t("python/bin"), t("cargo/bin"), t("go/bin"), t("bun/bin"), t("gem/bin")],
    };
  }
  const folders = [...new Set((i.folders ?? []).map((f) => addedFolder(f, i.dataDir)).filter((f): f is string => f !== null))];
  const h = (p: string): string => path.join(i.home, p);
  const cache = i.platform === "darwin" ? h("Library/Caches") : h(".cache");
  return {
    where: "own",
    rw: [...folders, ...packageLocations(i.home, i.platform).filter((p) => p.startsWith(i.home) || exists(p))],
    roFiles: [h(".gitconfig"), h(".config/git"), h(".npmrc"), h(".ssh/known_hosts"), h(".ssh/known_hosts2"), h(".ssh/config")].filter(exists),
    deny: [i.dataDir, ...homeDenies(i.home, i.platform)],
    reopen: own,
    ...(i.sshAuthSock && path.isAbsolute(i.sshAuthSock) && !BAD.test(i.sshAuthSock) ? { sshAuthSock: i.sshAuthSock } : {}),
    // HOME stays the engine's own (its sign-in and sessions); these point the tools at the person's own install locations, so what they install is on the computer and there the next turn. A tool the
    // person has not set up yet (no ~/.cargo) keeps its default under the engine's home, which persists too; nothing is made in the person's home unasked.
    env: Object.fromEntries(Object.entries({
      GIT_CONFIG_GLOBAL: h(".gitconfig"), NPM_CONFIG_USERCONFIG: h(".npmrc"), npm_config_cache: h(".npm"),
      PYTHONUSERBASE: h(".local"), PIP_CACHE_DIR: path.join(cache, "pip"), CARGO_HOME: h(".cargo"), RUSTUP_HOME: h(".rustup"), GOPATH: h("go"), GOCACHE: path.join(cache, "go-build"),
      BUN_INSTALL: h(".bun"), NVM_DIR: h(".nvm"), PYENV_ROOT: h(".pyenv"), ...(i.platform === "darwin" ? { HOMEBREW_CACHE: h("Library/Caches/Homebrew"), HOMEBREW_LOGS: h("Library/Logs/Homebrew") } : {}),
    }).filter(([, p]) => exists(p))),
    pathAdd: [h(".local/bin"), h(".npm-global/bin"), h(".cargo/bin"), h("go/bin"), h(".bun/bin"), h(".deno/bin")].filter(exists),
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
export function sshFiles(access: EngineAccess | undefined, ownKnownHosts: string): { knownHosts: string; config?: string } {
  const known = access?.roFiles.find((p) => p.endsWith("/.ssh/known_hosts"));
  const config = access?.roFiles.find((p) => p.endsWith("/.ssh/config"));
  return { knownHosts: [ownKnownHosts, ...(known && !/\s/.test(known) ? [known] : [])].join(" "), ...(config ? { config } : {}) };
}
