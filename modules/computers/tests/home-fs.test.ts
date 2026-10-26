// What the daemon reads from the computer's home (handlers/home-fs.ts): plain files and folders only. A symlink, a hardlink, a device or a name that climbs out is refused by name and never read.
import test from "node:test";
import assert from "node:assert/strict";
import { tarFiles } from "../../../sandbox/src/tar.ts";
import { readTar, relOf } from "../handlers/home-fs.ts";

/** One tar header of any type, the way a program inside the computer could leave it. */
function entry(name: string, type: string, linkname = "", size = 0): Uint8Array {
  const h = new Uint8Array(512);
  const put = (s: string, at: number): void => { h.set(new TextEncoder().encode(s), at); };
  put(name, 0); put("0000644\0", 100); put("0000000\0", 108); put("0000000\0", 116); put(`${size.toString(8).padStart(11, "0")}\0`, 124); put("00000000000\0", 136);
  put("        ", 148); put(type, 156); put(linkname, 157); put("ustar\0", 257); put("00", 263);
  let sum = 0; for (const b of h) sum += b;
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return h;
}
const join = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };

test("plain files and folders are read, with their bytes", () => {
  const snap = readTar(tarFiles([{ path: "notes/a.txt", data: new TextEncoder().encode("hello"), mode: 0o644, uid: 10001, gid: 10001, mtime: 1000 }]));
  assert.equal(snap.files.get("notes/a.txt")?.bytes.toString(), "hello");
  assert.ok(snap.dirs.has("notes"));
  assert.deepEqual(snap.refused, []);
});

test("a symlink, a hardlink, a device and a fifo are refused by name and never read", () => {
  const end = new Uint8Array(1024);
  const tar = join(entry("./", "5"), entry("./link.txt", "2", "/etc/passwd"), entry("./hard.txt", "1", "other.txt"), entry("./dev", "3"), entry("./pipe", "6"), entry("./ok.txt", "0"), end);
  const snap = readTar(tar);
  assert.deepEqual([...snap.files.keys()], ["ok.txt"]);
  assert.deepEqual(snap.refused.sort(), ["dev", "hard.txt", "link.txt", "pipe"]);
});

test("a name that climbs out or starts at the root is refused", () => {
  assert.equal(relOf("../etc/passwd"), null);
  assert.equal(relOf("/etc/passwd"), null);
  assert.equal(relOf("a/../../b"), null);
  assert.equal(relOf("./a//b/"), "a/b");
  assert.equal(relOf("./"), "");
  const snap = readTar(join(entry("../escape.txt", "0"), entry("/abs.txt", "0"), new Uint8Array(1024)));
  assert.equal(snap.files.size, 0);
  assert.equal(snap.refused.length, 2);
});
