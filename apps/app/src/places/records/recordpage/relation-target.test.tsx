// The record page finds a relation's target type under the key the schema writes (options.target), and still under the older options.to.
import test from "node:test";
import assert from "node:assert/strict";
import { relationTarget } from "./model.ts";

test("a relation's target is read from options.target, the schema's key, and from the older options.to", () => {
  assert.equal(relationTarget({ key: "subject", type: "relation", title: "Subject", options: { target: "contact" } } as never), "contact");
  assert.equal(relationTarget({ key: "client", type: "relation", title: "Client", options: { to: "company" } } as never), "company");
  assert.equal(relationTarget({ key: "name", type: "text", title: "Name" } as never), null);
});
