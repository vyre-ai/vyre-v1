import test from "node:test";
import assert from "node:assert/strict";
import { hello, shout } from "./hello.mjs";

test("hello greets", () => assert.equal(hello("vyre"), "hello vyre"));

test("shout upper-cases", () => assert.equal(shout("vyre"), "HELLO VYRE"));
