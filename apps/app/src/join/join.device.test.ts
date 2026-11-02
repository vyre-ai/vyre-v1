import test from "node:test";
import assert from "node:assert/strict";
import { deviceNameOf } from "./logic.ts";

test("joining names the device from the browser, so Continue is never dead on an empty field", () => {
  assert.equal(deviceNameOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/156.0 Safari/537.36"), "Chrome on Mac");
  assert.equal(deviceNameOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1 Version/18.0 Safari/604.1"), "Safari on iPhone");
  assert.equal(deviceNameOf("Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0"), "Firefox on Windows");
  assert.equal(deviceNameOf(""), "This device");
});
