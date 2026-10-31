// A record call that names a type by the other spelling (deal for deals, deals for deal) finds the one type that is meant, and never guesses between two.
import test from "node:test";
import assert from "node:assert/strict";
import { typeNamed } from "../impl.ts";

const t = (name: string) => ({ name, fields: [] }) as never;
const names = (list: string[], asked: string): string | undefined => (typeNamed(list.map(t), asked) as { name?: string } | undefined)?.name;

test("an exact name wins; the other spelling finds the one type that is meant", () => {
  assert.equal(names(["deal", "contact"], "deal"), "deal");
  assert.equal(names(["deals", "contact"], "deal"), "deals");
  assert.equal(names(["deal", "contact"], "deals"), "deal");
  assert.equal(names(["company"], "companies"), "company");
  assert.equal(names(["companies"], "company"), "companies");
  assert.equal(names(["status"], "statuses"), "status");
  assert.equal(names(["box"], "boxes"), "box");
});

test("no type, or two that could be meant, is no match", () => {
  assert.equal(names(["contact"], "deal"), undefined);
  assert.equal(names(["xs", "xes"], "x"), undefined, "two types could be meant");
  assert.equal(names(["deals", "deal_2"], "deal"), "deals");
});
