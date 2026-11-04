// Verify on the profile email and phone (lane l-chrome2a): "Not verified" with a Verify button when the Space can send, a code box after, the tick only after the code is confirmed, a wrong code said plainly,
// the tick gone when the value changes, and no Verify at all when there is no way to send (no telephony).
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import { ContactVerify } from "./ContactVerify.tsx";
import { createSampleSettings, northwind } from "./sample.ts";

installDom();

type St = { verified: boolean; canVerify: boolean; pending: boolean };
function world(over: { email?: Partial<St>; phone?: Partial<St>; wrong?: boolean } = {}) {
  const s = createSampleSettings(northwind);
  const calls: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  const st = { email: { verified: false, canVerify: true, pending: false, ...over.email } as St, phone: { verified: false, canVerify: false, pending: false, ...over.phone } as St };
  s.data.call = async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as never });
    if (cap === "settings.contact.status") return { ...st };
    if (cap === "settings.contact.verify_start") { st.email.pending = true; return { sent: true, verified: false, expiresAt: 1 }; }
    if (cap === "settings.contact.verify_confirm") {
      if (over.wrong) throw new Error("That is not the code.");
      st.email.verified = true; return { verified: true };
    }
    return {};
  };
  return { s, calls, st };
}
const view = (w: ReturnType<typeof world>, channel: "email" | "phone", value: string) => <SettingsDataProvider value={w.s.data}><ContactVerify channel={channel} value={value} /></SettingsDataProvider>;

test("Not verified with a Verify button; Verify sends the code; the tick shows only after Confirm", async () => {
  const w = world();
  const root = await mount(createRoot, view(w, "email", "ana@example.com"));
  await flush();
  assert.match(textOf(root), /Not verified/);
  assert.equal(find(root, "verified-email"), null);
  await press(find(root, "verify-open-email"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "settings.contact.verify_start")?.input, { channel: "email" });
  assert.match(textOf(root), /sent a 6-digit code/);
  assert.equal(find(root, "verified-email"), null, "sending is not verifying");
  await typeInto(find(root, "verify-code-email")!, "123456");
  await press(find(root, "verify-confirm-email"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "settings.contact.verify_confirm")?.input, { channel: "email", code: "123456" });
  assert.ok(find(root, "verified-email"), "now the tick");
  assert.match(textOf(root), /Verified/);
  assert.ok(!textOf(root).includes("Not verified"));
});

test("a wrong code is said in the module's words and the tick stays away", async () => {
  const w = world({ wrong: true });
  const root = await mount(createRoot, view(w, "email", "ana@example.com"));
  await flush();
  await press(find(root, "verify-open-email")); await flush();
  await typeInto(find(root, "verify-code-email")!, "000000");
  await press(find(root, "verify-confirm-email")); await flush();
  assert.match(textOf(find(root, "verify-note-email")), /That is not the code\./);
  assert.equal(find(root, "verified-email"), null);
});

test("with no way to text, Phone reads Not verified and gives no Verify", async () => {
  const w = world();
  const root = await mount(createRoot, view(w, "phone", "+14155550123"));
  await flush();
  assert.match(textOf(root), /Not verified/);
  assert.equal(find(root, "verify-open-phone"), null);
});

test("an empty field shows nothing, and a changed value asks again", async () => {
  const w = world({ email: { verified: true } });
  const root = await mount(createRoot, view(w, "email", ""));
  await flush();
  assert.equal(textOf(root).trim(), "");
  const calls0 = w.calls.length;
  await mount(createRoot, view(w, "email", "ana@example.com"));
  await flush();
  assert.ok(w.calls.length > calls0, "reads the status for the new value");
});
