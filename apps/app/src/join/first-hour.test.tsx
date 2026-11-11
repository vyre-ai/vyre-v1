// The first hour (rc.22 client walk, journeys 2, 4 and 8): the recovery code says what it is, where it is shown and after it is used.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RECOVERY_WHAT } from "./kit.tsx";
import { RecoveryAccount } from "./RecoveryAccount.tsx";

test("the recovery code is explained: what it does, that it is shown once, where to keep it, and who else can use it", () => {
  assert.match(RECOVERY_WHAT, /password manager/);
  assert.match(RECOVERY_WHAT, /shown only now/);
  assert.match(RECOVERY_WHAT, /forget your password/);
  assert.match(RECOVERY_WHAT, /Anyone who has it/);
  // every place a code is shown carries it
  for (const f of ["../claim/ClaimOwner.tsx", "./AcceptInvite.tsx"]) assert.match(fs.readFileSync(new URL(f, import.meta.url), "utf8"), /sub=\{RECOVERY_WHAT\}/, f);
});

test("the forgot-password form says the saved code keeps working after it is used", () => {
  const out = renderToStaticMarkup(<RecoveryAccount space="Northwind" address="https://box.example" onBack={() => undefined} onAdminReset={() => undefined} onRecover={async () => undefined} />);
  assert.match(out, /It keeps working after you use it/);
});
