import test from "node:test";
import assert from "node:assert/strict";
import { checkTextInputKeys } from "./textinput-keys.ts";

test("textinput-keys fails an onKeyDown handed to a TextInput or TextField, directly or through webOnly", () => {
  assert.equal(checkTextInputKeys("a.tsx", `<TextInput value={v} {...webOnly({ onKeyDown: (e) => go(e) })} />`).length, 1);
  assert.equal(checkTextInputKeys("a.tsx", `<TextField onKeyDown={k} />`).length, 1);
});

test("textinput-keys allows onKeyPress, and onKeyDown on other elements", () => {
  assert.deepEqual(checkTextInputKeys("a.tsx", `<TextInput onKeyPress={k} onChangeText={(t) => t.length > 0} />`), []);
  assert.deepEqual(checkTextInputKeys("a.tsx", `<View {...webOnly({ onKeyDown: k })}><TextInput value="x" /></View>`), []);
});
