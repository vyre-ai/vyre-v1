// r40 (a scanner's `//` ended a client's daemon): a booted daemon is sent malformed request lines and upgrades over a raw socket. It answers or closes each one and is still up afterwards
// (/healthz 200); the paths that used to throw "Invalid URL" out of a route answer 400.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { bootCore } from "../../fixtures/seed/core/index.ts";
import { requestTargetOk, safeUrl } from "../src/safe-url.ts";
import { boot, seededDirFrom } from "./daemon-boot-rig.ts";

const seededDir = seededDirFrom(bootCore);

/** What the daemon sent back to these exact bytes (first line), or "closed" when it just closed the socket. Never waits more than 3 s. */
const rawSend = (port: number, bytes: Buffer): Promise<string> =>
  new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const done = (): void => {
      s.destroy();
      const t = Buffer.concat(chunks).toString("latin1");
      resolve(t.length ? (t.split("\r\n")[0] ?? "") : "closed");
    };
    s.setTimeout(3000, done);
    s.on("connect", () => s.write(bytes));
    s.on("data", (c: Buffer) => {
      chunks.push(c);
      if (Buffer.concat(chunks).includes("\r\n\r\n")) done();
    });
    s.on("error", done);
    s.on("close", done);
  });

const line = (method: string, target: string, extra = ""): Buffer =>
  Buffer.from(`${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${extra}\r\n`, "latin1");

test("safeUrl never throws and requestTargetOk accepts only origin-form paths", () => {
  for (const bad of [
    "//",
    "//[",
    "http://[::1",
    "%zz",
    "*",
    "",
    "\\\\x",
    "/\u0000",
    "/a b",
    "http://evil.test/x",
    "//evil.test/x",
  ])
    assert.equal(requestTargetOk(bad), false, JSON.stringify(bad));
  for (const good of ["/", "/healthz", "/v1/x?a=1&b=%20", "/a%zz/b", "/?q=//"])
    assert.equal(requestTargetOk(good), true, good);
  assert.equal(requestTargetOk("/" + "a".repeat(20_000)), false);
  for (const raw of ["//", "//[", "%zz", undefined, "http://[::1"])
    assert.equal(typeof safeUrl(raw, "http://vyred").pathname, "string");
  assert.equal(typeof safeUrl("//", "http://[bad").pathname, "string");
});

test("a booted daemon answers or closes every malformed request and stays up", async () => {
  const d = await boot(seededDir());
  try {
    const targets = [
      "//",
      "///",
      "//[",
      "//evil.test/healthz",
      "http://[::1",
      "http://example.test/healthz",
      "%zz",
      "/%zz",
      "/%",
      "*",
      "/\u0000",
      "/a\u0000b",
      "\\\\",
      "/" + "a".repeat(100_000),
      "/healthz?" + "a=%zz&".repeat(500),
      "/v1/identity/sign_in_options//",
      "/mcp//",
      "/s/%zz",
      "/browser/%zz/view",
      "/compute/%zz",
    ];
    for (const method of ["GET", "POST", "OPTIONS", "HEAD", "PUT", "FOO"]) {
      for (const t of targets) {
        const r = await rawSend(d.port, line(method, t));
        assert.ok(
          r === "closed" || /^HTTP\/1\.1 [1-5]\d\d/.test(r),
          `${method} ${JSON.stringify(t.slice(0, 40))} -> ${r}`,
        );
        const hz = await fetch(`${d.url}/healthz`);
        assert.equal(hz.status, 200, `daemon down after ${method} ${JSON.stringify(t.slice(0, 40))}`);
      }
    }
    // the exact incident request
    assert.match(await rawSend(d.port, line("GET", "//")), /^HTTP\/1\.1 400/);
    assert.match(await rawSend(d.port, line("GET", "http://[::1")), /^HTTP\/1\.1 400/);
    // garbage that is not HTTP at all, and the websocket upgrade with a bad address
    for (const junk of [
      Buffer.from("\u0000\u0001\u0002\r\n\r\n", "latin1"),
      Buffer.from("GET\r\n\r\n"),
      Buffer.alloc(70_000, 0x41),
    ]) {
      const r = await rawSend(d.port, junk);
      assert.ok(r === "closed" || /^HTTP\/1\.1 [1-5]\d\d/.test(r), r);
    }
    for (const t of ["//", "//[", "%zz", "/live?deviceClass=%zz", "/%zz"]) {
      const r = await rawSend(
        d.port,
        line(
          "GET",
          t,
          "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
        ),
      );
      assert.ok(r === "closed" || /^HTTP\/1\.1 [1-5]\d\d/.test(r), `upgrade ${t} -> ${r}`);
    }
    assert.equal((await fetch(`${d.url}/healthz`)).status, 200);
  } finally {
    await d.stop();
  }
});
