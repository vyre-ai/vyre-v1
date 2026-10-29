import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createSampleSettings } from "../../places/settings/sample.ts";
import { ShellRuntimeProvider } from "./runtime.tsx";
import { sampleRuntime } from "./misc-test-runtime.tsx";
import SettingsShellPlace, { settingsData } from "./settings.tsx";
import { SettingsDataProvider } from "../../places/settings/data.tsx";
import { SettingsPlace } from "../../places/settings/SettingsPlace.tsx";
import { loadSecurity } from "./settings-security.ts";
import { PHOTO_MAX_BYTES, chooseProfilePhoto } from "./settings-photo.ts";

test("the Settings place draws its pages through the shell runtime", () => {
  const s = createSampleSettings();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const out = renderToStaticMarkup(<ShellRuntimeProvider value={rt}><SettingsShellPlace place="settings" /></ShellRuntimeProvider>);
  assert.ok(out.includes("Profile"));
  assert.ok(!out.includes("settings-loading"));
});

test("without a runtime Settings draws its loading frame", () => {
  assert.ok(renderToStaticMarkup(<SettingsShellPlace place="settings" />).includes("settings-loading"));
});

test("Settings leaves for the Vault and the Console through the shell's door", () => {
  const s = createSampleSettings();
  const opened: string[] = [];
  const d = settingsData(sampleRuntime({ screens: s.data.screens, call: s.data.call, opened }));
  d.nav.openVault();
  d.nav.openConsole();
  assert.deepEqual(opened, ["vault.layout", "console.overview"]);
  assert.equal(d.space.name, "Northwind");
});

test("the sign-in cards are filled from what this person's sign-in is in the open Space", async () => {
  const asked: string[] = [];
  const call = async (cap: string): Promise<unknown> => {
    asked.push(cap);
    if (cap === "identity.security.get") return { passwordChangedAt: Date.UTC(2026, 8, 3), github: "maya-chen", totp: true, passkeys: [] };
    if (cap === "identity.sign_in_options") return { secondFactorRequired: true, sso: [{ key: "google", title: "Google" }] };
    if (cap === "devices.mine") return { devices: [{}, {}, {}], sessions: [] };
    throw new Error(cap);
  };
  const sec = await loadSecurity(call, { id: "spc_nw", kind: "team" });
  assert.deepEqual(asked.sort(), ["devices.mine", "identity.security.get", "identity.sign_in_options"]);
  assert.equal(sec.account.github, "maya-chen");
  assert.match(sec.account.passwordChanged, /2026/);
  assert.deepEqual(sec.spaces["spc_nw"], { totp: true, passkeys: [], floor: "Required", floorBy: "your Space's admins", sso: "Google", devices: 3 });
  const bare = await loadSecurity(async (cap) => (cap === "identity.security.get" ? { passwordChangedAt: 0, totp: false, passkeys: [] } : cap === "devices.mine" ? { devices: [] } : { secondFactorRequired: false, sso: [] }), { id: "spc_me", kind: "personal" });
  assert.equal(bare.account.github, null);
  assert.deepEqual(bare.spaces["spc_me"], { totp: false, passkeys: [], floor: "Not required", floorBy: "your Space's admins", sso: "", devices: 0 });
  await assert.rejects(loadSecurity(async () => { throw new Error("offline"); }, { id: "x", kind: "team" }), /offline/, "a read that fails shows no card");
});

test("the Settings place passes the loaded sign-in to its pages", () => {
  const s = createSampleSettings();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const sec = { account: { passwordChanged: "3 Sep 2026", github: null }, spaces: { northwind: { totp: false, passkeys: [], floor: "Not required", floorBy: "your Space's admins", sso: "", devices: 1 } } };
  assert.deepEqual(settingsData(rt, undefined, sec).security, sec);
  assert.equal(settingsData(rt).security, undefined);
});

test("Choose a photo keeps the image in the person's own folder and answers the file id; too big or cancelled changes nothing", async () => {
  const calls: Array<{ cap: string; input: Record<string, unknown> }> = [];
  const rt = { call: async (cap: string, input: unknown) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    if (cap === "files.list") return { folders: [{ folderId: "fld_space", scope: "space" }, { folderId: "fld_home", scope: "personal" }, { folderId: "fld_sub", scope: "personal", parentId: "fld_home" }] };
    return { file: { fileId: "fil_photo" } };
  } };
  const img = { name: "me.png", mime: "image/png", size: 1000, base64: "AAAA" };
  assert.equal(await chooseProfilePhoto(rt, async () => img), "fil_photo");
  const made = calls.find((c) => c.cap === "files.create")!;
  assert.deepEqual([made.input["folderId"], made.input["name"], made.input["mime"], made.input["content"]], ["fld_home", "me.png", "image/png", { base64: "AAAA" }]);
  assert.equal(typeof made.input["idempotencyKey"], "string");
  assert.equal(await chooseProfilePhoto(rt, async () => null), null, "cancelled");
  await assert.rejects(chooseProfilePhoto(rt, async () => ({ ...img, size: PHOTO_MAX_BYTES + 1 })), /under 2 MB/);
  const before = calls.length;
  await assert.rejects(chooseProfilePhoto({ call: async () => ({ folders: [{ folderId: "fld_space", scope: "space" }] }) }, async () => img), /no personal folder/);
  assert.equal(calls.length, before, "nothing was written");
});

function SettingsDataProviderFor({ rt, totp }: { rt: Parameters<typeof settingsData>[0]; totp: boolean }) {
  const sec = { account: { passwordChanged: "3 Sep 2026", github: null }, spaces: { [rt.space.id]: { totp, passkeys: [], floor: "Not required", floorBy: "your Space's admins", sso: "", devices: 1 } } };
  return <SettingsDataProvider value={settingsData(rt, undefined, sec)}><SettingsPlace initialPage="signin" /></SettingsDataProvider>;
}

test("the open Space's sign-in card keeps the ids the real-app flow clicks: totp-setup before an authenticator, totp-remove after, and pw-change", () => {
  const s = createSampleSettings();
  const rt = sampleRuntime({ screens: s.data.screens, call: s.data.call });
  const draw = (totp: boolean): string => renderToStaticMarkup(<ShellRuntimeProvider value={rt}><SettingsDataProviderFor rt={rt} totp={totp} /></ShellRuntimeProvider>);
  const on = draw(true), off = draw(false);
  assert.match(off, /data-testid="totp-setup"/);
  assert.match(on, /data-testid="totp-remove"/);
  assert.match(on, /data-testid="pw-change"/);
});
