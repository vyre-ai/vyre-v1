// The Windows Personal Space sandbox's own parts (sandbox/src/win), on any computer: the compiler Windows ships is found, a folder is labelled Low once with inheritance, and the helper's argv
// carries the engine's command line after " -- " and its added variables in one base64 argument that cannot contain the separator.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cscPath, forgetLabels, labelLow, lowrunArgv, setLabelRunner } from "../src/win/lowrun.ts";

test("the compiler that ships with Windows, 64-bit first", () => {
  const there = new Set(["C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe", "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe"]);
  assert.equal(cscPath({ WINDIR: "C:\\Windows" }, (p) => there.has(p)), "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe");
  assert.equal(cscPath({ WINDIR: "C:\\Windows" }, () => false), null);
});

test("a folder is labelled Low once, with inheritance, and a refusal says which folder", () => {
  const calls: string[][] = [];
  setLabelRunner((cmd, args) => { calls.push([cmd, ...args]); return { status: 0, stdout: "" }; });
  forgetLabels();
  const dir = `${process.cwd()}/.lowrun-test-dir`;
  labelLow(dir); labelLow(dir);
  assert.deepEqual(calls, [["icacls.exe", dir, "/setintegritylevel", "(OI)(CI)low", "/T", "/C", "/Q"]]);
  setLabelRunner(() => ({ status: 5, stdout: "Access is denied." }));
  assert.throws(() => labelLow(`${dir}-other`), (e: { code?: string; message?: string }) => e.code === "sandbox.policy" && /-other/.test(e.message ?? ""));
  setLabelRunner(null);
  forgetLabels();
  for (const d of [dir, `${dir}-other`]) fs.rmSync(d, { recursive: true, force: true });
});

test("the helper's argv: the engine after --, its variables in one base64 argument", () => {
  const a = lowrunArgv("C:\\v\\vyre-lowrun-abc.exe", ["C:\\e\\claude.exe", "-p", "a -- b"], { HTTPS_PROXY: "http://127.0.0.1:9", HOME: "C:\\s\\home" });
  assert.deepEqual(a.slice(0, 2), ["C:\\v\\vyre-lowrun-abc.exe", "--env"]);
  assert.equal(a[3], "--");
  assert.deepEqual(a.slice(4), ["C:\\e\\claude.exe", "-p", "a -- b"]);
  assert.match(a[2] as string, /^[A-Za-z0-9+/=]+$/, "no space, no dash: the separator cannot appear in it");
  assert.deepEqual(Buffer.from(a[2] as string, "base64").toString("utf8").split("\0"), ["HTTPS_PROXY=http://127.0.0.1:9", "HOME=C:\\s\\home"]);
  assert.deepEqual(lowrunArgv("h.exe", ["x"], {}), ["h.exe", "--", "x"]);
});
