// A principal id that slips into a reply reads as the name it stands for.
import test from "node:test";
import assert from "node:assert/strict";
import { namedIds } from "./MessageView.tsx";

test("a known person's id in a reply shows as their name; an unknown one and plain text stay", () => {
  const nameOf = (id: string): string => (id === "usr_2191954f8e634c40c6" ? "Aliza Rizvi" : id);
  assert.equal(namedIds("I wrote to usr_2191954f8e634c40c6 about it", nameOf), "I wrote to Aliza Rizvi about it");
  assert.equal(namedIds("I wrote to usr_aaaaaaaaaaaaaaaaaa", nameOf), "I wrote to usr_aaaaaaaaaaaaaaaaaa");
  assert.equal(namedIds("nothing here", nameOf), "nothing here");
  assert.equal(namedIds("usr_2191954f8e634c40c6", undefined), "usr_2191954f8e634c40c6");
});
