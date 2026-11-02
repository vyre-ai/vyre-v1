// Local socket paths (sandbox/src/sock.ts): a long folder never breaks a socket. Windows gets a named pipe; a Mac or Linux socket stays in its folder and is reached through a short private link
// when the folder is too long; the network wall starts under a 120-character base and a long TMPDIR.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { MAX_SOCKET_PATH, localSocket, pipeName, shortTempRoot } from "../src/sock.ts";
import { startNetWall } from "../src/net/host.ts";

function longDir(): { base: string; dir: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vyre-sock-")));
  let dir = base;
  while (dir.length < 120) dir = path.join(dir, "a-long-folder-name");
  fs.mkdirSync(dir, { recursive: true });
  return { base, dir };
}

test("Windows gets a named pipe, never a file path", () => {
  const s = localSocket("C:\\Users\\someone-with-a-long-name\\AppData\\Roaming\\Vyre\\personal\\scratch\\usr_dana", "mcp-1.sock", "mcp", { platform: "win32" });
  assert.match(s.listen, /^\\\\\.\\pipe\\vyre-mcp-[0-9a-f]{16}$/);
  assert.equal(s.connect, s.listen);
  assert.notEqual(pipeName("mcp"), pipeName("mcp"), "two pipes never share a name");
});

test("a short folder keeps its socket in place", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(shortTempRoot(), "s-")));
  const s = localSocket(dir, "a.sock", "x");
  assert.equal(s.listen, path.join(dir, "a.sock"));
  assert.equal(s.real, s.listen);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a 120-character folder: the socket is made in the folder, through a short private link", { skip: process.platform === "win32" }, async () => {
  const { base, dir } = longDir();
  const s = localSocket(dir, "mcp-abc.sock", "mcp");
  assert.ok(Buffer.byteLength(s.listen) <= MAX_SOCKET_PATH, s.listen);
  assert.equal(s.real, path.join(dir, "mcp-abc.sock"));
  const link = path.dirname(path.dirname(s.listen));
  assert.equal(fs.statSync(link).mode & 0o777, 0o700, "the link folder is private");
  const server = net.createServer((c) => c.end("hi"));
  await new Promise<void>((ok) => server.listen(s.listen, ok));
  assert.ok(fs.existsSync(s.real), "the socket itself is in the long folder");
  const got = await new Promise<string>((ok) => { let b = ""; net.connect(s.connect).setEncoding("utf8").on("data", (d: string) => { b += d; }).on("close", () => ok(b)); });
  assert.equal(got, "hi");
  await new Promise<void>((ok) => server.close(() => ok()));
  s.remove();
  assert.ok(!fs.existsSync(s.real) && !fs.existsSync(link), "remove takes the socket and the link folder");
  fs.rmSync(base, { recursive: true, force: true });
});

test("the network wall starts under a 120-character base folder", { skip: process.platform === "win32" }, async () => {
  const { base, dir } = longDir();
  const wall = await startNetWall({ allow: ["allowed.test"], baseDir: dir });
  assert.ok(Buffer.byteLength(wall.socket) <= MAX_SOCKET_PATH, wall.socket);
  assert.ok(fs.existsSync(wall.socket));
  await wall.close();
  assert.ok(!fs.existsSync(wall.dir));
  fs.rmSync(base, { recursive: true, force: true });
});
