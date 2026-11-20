import test from "node:test";
import assert from "node:assert/strict";
import { CapError } from "../shell/session/caps.ts";
import { isUnreachable } from "./failure.ts";

test("nothing that answered as a Space is unreachable, and an answer that was not a Space's is: it is asked again quietly like a call that got no answer", () => {
  assert.equal(isUnreachable(new TypeError("Failed to fetch")), true);
  assert.equal(
    isUnreachable(new CapError({ code: "gateway.bad_answer", message: "x", traceId: "", status: 200 })),
    true,
  );
  assert.equal(
    isUnreachable(new CapError({ code: "auth.bad_credentials", message: "x", traceId: "", status: 401 })),
    false,
  );
  assert.equal(
    isUnreachable(new CapError({ code: "internal.unexpected", message: "x", traceId: "", status: 500 })),
    false,
  );
});
