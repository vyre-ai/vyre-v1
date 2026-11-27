// Per-Space browser container, the move of saved sign-ins (rc.44, owner rule: a saved sign-in is never lost in an update). The new container of a Space has a volume of its own at ROOT; the old shared volume
// (every Space of the host in one) is mounted read-only beside it at FROM. A profile is COPIED into the Space's own volume, never moved, and only when it provably belongs to this Space:
//   - its folder says so (the `space` file holds this Space's id), or
//   - the host has one Space only (adoptAll), and the folder names no other Space.
// A profile that names another Space, or names none on a host with several Spaces, stays where it is and is reported (the doctor shows the report). The old volume is never written to, here or later in this release.
// A copy goes to `<id>.adopting` beside the target, is checked against the source (file count and bytes), and only then renamed to `<id>`; a failure removes the partial copy and leaves everything as it was, and the
// next start tries again. A profile already present in the Space's own volume is never overwritten.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";

const SPACE_FILE = "space";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,79}$/;
const SPACE_ID = /^[A-Za-z0-9_-]{3,80}$/;
/** Chromium's per-run lock files: never copied (a copy of a lock names a process that is not there). */
const LOCKS = /^Singleton(Lock|Socket|Cookie)$/;

export interface AdoptOptions {
  /** The old shared volume as mounted (read-only); its profiles are in `<from>/profiles/<id>`. */
  from: string;
  /** This Space's own volume (the browser manager's root); profiles go to `<to>/profiles/<id>`. */
  to: string;
  spaceId: string;
  /** The host has one Space only: a profile that names no Space is this Space's. */
  adoptAll: boolean;
  /** Tests: make a copy fail part way. */
  copy?: (src: string, dst: string) => void;
  log?: (m: string) => void;
}

export interface AdoptReport {
  at: number;
  spaceId: string;
  copied: string[];
  already: string[];
  /** On the old volume with no Space named, on a host with several Spaces: left where they are. */
  unproven: string[];
  /** Named another Space: not ours. */
  other: string[];
  failed: Array<{ id: string; why: string }>;
}

const spaceOf = (dir: string): string | undefined => {
  try {
    const s = readFileSync(join(dir, SPACE_FILE), "utf8").trim();
    return SPACE_ID.test(s) ? s : undefined;
  } catch {
    return undefined;
  }
};

/** Files and bytes of a folder (locks left out), for the check after a copy. */
export function measure(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      if (LOCKS.test(n)) continue;
      const p = join(d, n);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else {
        files++;
        bytes += st.isSymbolicLink() ? 0 : st.size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

const defaultCopy = (src: string, dst: string): void =>
  cpSync(src, dst, {
    recursive: true,
    preserveTimestamps: true,
    errorOnExist: true,
    force: false,
    filter: (s) => !LOCKS.test(s.slice(s.lastIndexOf("/") + 1)),
  });

export function adoptProfiles(o: AdoptOptions): AdoptReport {
  const report: AdoptReport = {
    at: Date.now(),
    spaceId: o.spaceId,
    copied: [],
    already: [],
    unproven: [],
    other: [],
    failed: [],
  };
  const fromDir = join(o.from, "profiles");
  const toDir = join(o.to, "profiles");
  if (!SPACE_ID.test(o.spaceId) || !existsSync(fromDir)) return report;
  mkdirSync(toDir, { recursive: true });
  const copy = o.copy ?? defaultCopy;
  let ids: string[];
  try {
    ids = readdirSync(fromDir).filter((n) => ID.test(n) && statSync(join(fromDir, n)).isDirectory());
  } catch {
    return report;
  }
  for (const id of ids.sort()) {
    const src = join(fromDir, id);
    const named = spaceOf(src);
    if (named !== undefined && named !== o.spaceId) {
      report.other.push(id);
      continue;
    }
    if (named === undefined && !o.adoptAll) {
      report.unproven.push(id);
      continue;
    }
    const dst = join(toDir, id);
    if (existsSync(dst)) {
      report.already.push(id);
      continue;
    }
    const part = `${dst}.adopting`;
    try {
      rmSync(part, { recursive: true, force: true });
      copy(src, part);
      const a = measure(src);
      const b = measure(part);
      if (a.files !== b.files || a.bytes !== b.bytes)
        throw new Error(
          `the copy differs from the original (${b.files}/${a.files} files, ${b.bytes}/${a.bytes} bytes)`,
        );
      if (spaceOf(part) === undefined) writeFileSync(join(part, SPACE_FILE), o.spaceId);
      renameSync(part, dst);
      report.copied.push(id);
    } catch (e) {
      rmSync(part, { recursive: true, force: true });
      report.failed.push({ id, why: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
      o.log?.(
        `adopt: ${id} not copied (${report.failed.at(-1)!.why}); it stays on the old volume and is tried again at the next start`,
      );
    }
  }
  try {
    writeFileSync(join(o.to, ".adopt-report.json"), JSON.stringify(report));
  } catch {
    /* the report is for the doctor; the copy stands without it */
  }
  return report;
}
