// K14 (13 Nov 2026): a Needs you row from the system does not say "Vyre" as if Vyre were the person who blocked it.
import test from "node:test";
import assert from "node:assert/strict";
import { needsLine } from "./needs-row.ts";

const names: Record<string, string> = { usr_maya: "Maya Lin", svc_host: "Vyre" };
const nameOf = (id: string): string => names[id] ?? id;

test("a row a person asked for names them; a row the system raised starts with what happened", () => {
  assert.equal(
    needsLine({ kind: "Approve", requester: "usr_maya", sub: "Send the invoice" }, nameOf),
    "Approve · Maya Lin · Send the invoice",
  );
  assert.equal(
    needsLine({ kind: "Blocked", requester: "svc_host", sub: "The agent stopped and is waiting for you" }, nameOf),
    "Blocked · The agent stopped and is waiting for you",
  );
  assert.equal(needsLine({ kind: "Blocked", requester: "svc_host", sub: "" }, nameOf), "Blocked");
});
