import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "./hello.mjs";

test("hello greets", () => assert.equal(hello("vyre"), "hello vyre"));
