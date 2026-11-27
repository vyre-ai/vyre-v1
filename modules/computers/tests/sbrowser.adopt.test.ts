// The move of saved sign-ins into a Space's own browser volume (images/space-browser/browserd/adopt.ts): copy not move, provable Space only, the old volume untouched, a failed copy changes nothing and is retried.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { adoptProfiles, measure } from "../../../images/space-browser/browserd/adopt.ts";
import { createProfileManager } from "../../../images/space-browser/browserd/profiles.ts";

const COOKIES = "SQLite format 3\u0000 github.com session=abc123 logged_in=yes";

function volumes(): { old: string; next: string; done: () => void } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "adopt-"));
  const old = path.join(base, "shared");
  const next = path.join(base, "own");
  fs.mkdirSync(path.join(old, "profiles"), { recursive: true });
  return { old, next, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}
/** A profile folder as Chromium leaves it, with a saved sign-in in its cookie file. */
function profile(root: string, id: string, space?: string): void {
  const chrome = path.join(root, "profiles", id, "chrome", "Default", "Network");
  fs.mkdirSync(chrome, { recursive: true });
  fs.writeFileSync(path.join(chrome, "Cookies"), `${COOKIES} ${id}`);
  fs.writeFileSync(path.join(root, "profiles", id, "chrome", "Local State"), "{}");
  fs.symlinkSync("/nowhere", path.join(root, "profiles", id, "chrome", "SingletonLock"));
  if (space) fs.writeFileSync(path.join(root, "profiles", id, "space"), space);
}
const snapshot = (root: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of fs.readdirSync(d).sort()) {
      const p = path.join(d, n);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(`${path.relative(root, p)}:${st.isSymbolicLink() ? "link" : fs.readFileSync(p, "utf8")}`);
    }
  };
  walk(root);
  return out;
};

test("a profile whose folder names this Space is copied, the sign-in is in the copy, and the old volume is exactly as it was", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_dana", "spc_one");
    const before = snapshot(v.old);
    const r = adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    assert.deepEqual(r.copied, ["agt_dana"]);
    assert.equal(
      fs.readFileSync(path.join(v.next, "profiles", "agt_dana/chrome/Default/Network/Cookies"), "utf8"),
      `${COOKIES} agt_dana`,
    );
    assert.equal(
      fs.existsSync(path.join(v.next, "profiles", "agt_dana/chrome/SingletonLock")),
      false,
      "a lock of the old run is not carried",
    );
    assert.deepEqual(snapshot(v.old), before, "copy, not move: nothing on the old volume changed");
    assert.deepEqual(
      measure(path.join(v.next, "profiles", "agt_dana")),
      measure(path.join(v.old, "profiles", "agt_dana")),
    );
  } finally {
    v.done();
  }
});

test("the same site is still signed in for that agent: the new Space volume holds the profile the browser manager opens, cookie file and all", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_dana", "spc_one");
    adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    const m = createProfileManager({
      root: v.next,
      extensionDir: null,
      log: () => undefined,
      maxRunning: 1,
      idleMs: 60_000,
      tabLimit: 10,
    });
    const p = m.get("agt_dana");
    assert.equal(fs.readFileSync(path.join(p.dir, "chrome/Default/Network/Cookies"), "utf8"), `${COOKIES} agt_dana`);
    assert.equal(p.spaceId, "spc_one");
  } finally {
    v.done();
  }
});

test("on a host with several Spaces: other Spaces' profiles and profiles that name no Space stay, and are reported", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_mine", "spc_one");
    profile(v.old, "agt_theirs", "spc_two");
    profile(v.old, "agt_nobody");
    const r = adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    assert.deepEqual(r.copied, ["agt_mine"]);
    assert.deepEqual(r.other, ["agt_theirs"]);
    assert.deepEqual(r.unproven, ["agt_nobody"]);
    assert.equal(fs.existsSync(path.join(v.next, "profiles", "agt_theirs")), false);
    assert.equal(fs.existsSync(path.join(v.next, "profiles", "agt_nobody")), false);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(v.next, "profiles", "..", ".adopt-report.json"), "utf8")).unproven[0],
      "agt_nobody",
      "the doctor can read it",
    );
  } finally {
    v.done();
  }
});

test("on a host with one Space every profile that names no other Space is this Space's, and gets its name written", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_nobody");
    profile(v.old, "agt_theirs", "spc_two");
    const r = adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: true });
    assert.deepEqual(r.copied, ["agt_nobody"]);
    assert.deepEqual(r.other, ["agt_theirs"], "even then, a profile that names another Space is not taken");
    assert.equal(fs.readFileSync(path.join(v.next, "profiles", "agt_nobody/space"), "utf8"), "spc_one");
    assert.equal(
      fs.existsSync(path.join(v.old, "profiles", "agt_nobody/space")),
      false,
      "the old copy is not written to",
    );
  } finally {
    v.done();
  }
});

test("a failed copy leaves the new volume with no partial profile and the old one as it was; the next start copies it", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_dana", "spc_one");
    const before = snapshot(v.old);
    const r = adoptProfiles({
      from: v.old,
      to: v.next,
      spaceId: "spc_one",
      adoptAll: false,
      copy: (src, dst) => {
        fs.mkdirSync(dst, { recursive: true });
        fs.writeFileSync(path.join(dst, "half"), "x");
        throw new Error("disk full");
      },
    });
    assert.deepEqual(r.copied, []);
    assert.equal(r.failed[0]?.id, "agt_dana");
    assert.match(r.failed[0]!.why, /disk full/);
    assert.deepEqual(
      fs.readdirSync(path.join(v.next, "profiles")).filter((n) => !n.startsWith(".")),
      [],
      "no partial profile, not even the .adopting folder",
    );
    assert.deepEqual(snapshot(v.old), before);
    const again = adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    assert.deepEqual(again.copied, ["agt_dana"], "retried at the next start");
  } finally {
    v.done();
  }
});

test("a copy that differs from the original is refused (a truncated file is not a saved sign-in)", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_dana", "spc_one");
    const r = adoptProfiles({
      from: v.old,
      to: v.next,
      spaceId: "spc_one",
      adoptAll: false,
      copy: (src, dst) => {
        fs.cpSync(src, dst, { recursive: true });
        fs.writeFileSync(path.join(dst, "chrome/Default/Network/Cookies"), "cut");
      },
    });
    assert.equal(r.copied.length, 0);
    assert.match(r.failed[0]!.why, /differs/);
    assert.equal(fs.existsSync(path.join(v.next, "profiles", "agt_dana")), false);
  } finally {
    v.done();
  }
});

test("a profile already in the Space's own volume is never overwritten, and running it again changes nothing", () => {
  const v = volumes();
  try {
    profile(v.old, "agt_dana", "spc_one");
    adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    fs.writeFileSync(
      path.join(v.next, "profiles", "agt_dana/chrome/Default/Network/Cookies"),
      "newer sign-in made after the move",
    );
    const r = adoptProfiles({ from: v.old, to: v.next, spaceId: "spc_one", adoptAll: false });
    assert.deepEqual(r.already, ["agt_dana"]);
    assert.equal(
      fs.readFileSync(path.join(v.next, "profiles", "agt_dana/chrome/Default/Network/Cookies"), "utf8"),
      "newer sign-in made after the move",
    );
  } finally {
    v.done();
  }
});

test("no old volume, or an id that is not a Space id: nothing happens", () => {
  const v = volumes();
  try {
    assert.deepEqual(
      adoptProfiles({ from: path.join(v.old, "missing"), to: v.next, spaceId: "spc_one", adoptAll: true }).copied,
      [],
    );
    profile(v.old, "agt_dana");
    assert.deepEqual(adoptProfiles({ from: v.old, to: v.next, spaceId: "../x", adoptAll: true }).copied, []);
  } finally {
    v.done();
  }
});
