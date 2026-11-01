// Settings > Computers > Phone access: the rows for each state, the claim sheet, the QR sheet, and the model's small decisions.
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimSheet, PhoneBody, QrSheet } from "./PhoneAccess.tsx";
import { phoneDotHelp, phoneNameOf, phonePollMs, phoneSub, validPhoneName } from "./phone-model.ts";
import type { PhoneInfo } from "./phone-model.ts";

const noop = (): void => undefined;
const html = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el).replaceAll("<!-- -->", "");
const body = (phone: PhoneInfo, confirming = false, busy = false): string =>
  html(<PhoneBody phone={phone} confirming={confirming} busy={busy} onClaim={noop} onCopy={noop} onQr={noop} onAskRelease={noop} onRelease={noop} />);
const link = `https://alex.vyre.run/#box=${"k".repeat(43)}`;
const claimed: PhoneInfo = { state: "claimed", name: "alex", url: "https://alex.vyre.run", link, online: true };

test("a name is checked the way the host checks it, and a pasted .vyre.run is dropped", () => {
  assert.deepEqual(["alex", "Alex.vyre.run", "a-b", "al", "1alex", "al--", "a b", ""].map(validPhoneName), [true, true, true, false, false, false, false, false]);
  assert.equal(phoneNameOf("  Alex.vyre.run "), "alex");
});

test("with no name claimed, one row offers to claim", () => {
  const out = body({ state: "none", online: false });
  assert.ok(out.includes("Phone access") && out.includes('data-testid="phone-claim"') && out.includes("Claim a name"));
  assert.ok(!out.includes("phone-copy"));
});

test("while the host claims, there is no button and the row says so", () => {
  const out = body({ state: "claiming", name: "alex", online: false });
  assert.ok(out.includes("Claiming") && !out.includes('data-testid="phone-claim"'));
});

test("a claimed address shows its name, a status dot and Copy link, QR and Release", () => {
  const on = body(claimed);
  assert.ok(on.includes("alex.vyre.run") && on.includes("Online") && on.includes('data-testid="phone-dot-on"'));
  assert.ok(on.includes('data-testid="phone-copy"') && on.includes('data-testid="phone-qr"') && on.includes('data-testid="phone-release"'));
  const off = body({ ...claimed, online: false });
  assert.ok(off.includes("Offline") && off.includes('data-testid="phone-dot-off"'));
  assert.equal(phoneDotHelp({ ...claimed, online: false })?.includes("asleep"), true);
  assert.equal(phoneDotHelp(claimed), undefined);
});

test("Release asks first, then says Cancel and Release", () => {
  const out = body(claimed, true);
  assert.ok(out.includes('data-testid="phone-release-yes"') && !out.includes('data-testid="phone-release"') && !out.includes('data-testid="phone-copy"'));
});

test("a failed claim says why and offers Try again", () => {
  const out = body({ state: "failed", online: false, detail: "That name is taken. Try another." });
  assert.ok(out.includes("That name is taken. Try another.") && out.includes("Try again") && out.includes('role="alert"'));
  assert.equal(phoneSub({ state: "failed", online: false }), "Could not claim that name.");
});

test("the claim sheet takes a name with .vyre.run after it and keeps Claim off until the name works", () => {
  const sheet = (name: string, error = ""): string => html(<ClaimSheet name={name} busy={false} error={error} onName={noop} onClaim={noop} onClose={noop} />);
  const empty = sheet("");
  assert.ok(empty.includes('data-testid="phone-name"') && empty.includes(".vyre.run") && empty.includes('data-testid="phone-make"'));
  assert.ok(/data-testid="phone-make"[^>]*disabled/.test(empty) || /disabled[^>]*data-testid="phone-make"/.test(empty) || empty.includes('aria-disabled="true"'));
  assert.ok(sheet("alex", "Could not start. Try again.").includes('data-testid="phone-error"'));
});

test("the QR sheet draws the link", () => {
  assert.ok(html(<QrSheet link={link} onClose={noop} />).includes('data-testid="phone-qr-sheet"'));
});

test("the section asks quickly while the host works and slowly otherwise", () => {
  assert.deepEqual([phonePollMs(null), phonePollMs({ state: "claiming", online: false }), phonePollMs(claimed)], [10_000, 1000, 10_000]);
});
