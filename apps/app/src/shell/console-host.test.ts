import test from "node:test";
import assert from "node:assert/strict";
import { isConsoleHost } from "./console-host.ts";

test("the Console's own address is console. in front of a Space's address, and only that", () => {
  for (const h of ["console.acme.vyre.run", "CONSOLE.acme.vyre.run", "console.acme.com", "console.vyre.acme.com"]) assert.equal(isConsoleHost(h), true, h);
  for (const h of ["console.vyre.run", "acme.vyre.run", "consoles.acme.vyre.run", "acme.console.vyre.run", "console.localhost", "localhost", "127.0.0.1", "", undefined]) assert.equal(isConsoleHost(h), false, String(h));
});
