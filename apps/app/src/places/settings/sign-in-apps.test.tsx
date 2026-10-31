// Settings > Connections: the sign-in apps. The section shows what is set, gives the exact redirect address to register, and names the Vault item that holds the client; no secret is typed here.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { act } from "react";
import { find, flush, installDom, mount, press, textOf, typeInto } from "../../../../../ui/src/testing/dom.ts";
import { SettingsDataProvider } from "./data.tsx";
import type { SettingsData } from "./data.tsx";
import { SavedProvider, SavedBar } from "./saved.tsx";
import { SignInApps } from "./SignInApps.tsx";

installDom(); // stays up for the whole file: mounted rows clean up their listeners after a test ends

function world(o: { google?: object | null; microsoft?: object | null; setFails?: boolean } = {}) {
  const calls: { cap: string; input: unknown }[] = [];
  let google: object | null = o.google === undefined ? { configured: false, redirectUri: "https://space.test/oauth/callback" } : o.google;
  const data = {
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "google.user.app_status") { if (google === null) throw new Error("no such capability"); return google; }
      if (cap === "ms.user.app_status") { if (o.microsoft === null) throw new Error("no such capability"); return o.microsoft ?? { configured: true, clientId: "2222", vaultItem: "#Microsoft_Sign_In", redirectUri: "https://space.test/oauth/callback" }; }
      if (cap === "google.user.app_set") {
        if (o.setFails) throw new Error("#Nope has no client_id.");
        google = { configured: true, clientId: "client-1", vaultItem: (input as { vaultItem: string }).vaultItem, redirectUri: "https://space.test/oauth/callback" };
        return { configured: true, clientId: "client-1" };
      }
      return {};
    },
  } as unknown as SettingsData;
  return { calls, data };
}

const mountIt = (data: SettingsData) => mount(createRoot, <SavedProvider><SettingsDataProvider value={data}><SignInApps /><SavedBar /></SettingsDataProvider></SavedProvider>);
const commit = async (n: ReturnType<typeof find>): Promise<void> => { await act(async () => { (n!.props.onBlur as (e: unknown) => void)({ target: { value: "" }, nativeEvent: {} }); }); };

test("each provider shows whether its app is set; the redirect address appears when setting one up; the Vault item is saved with app_set", async () => {
  const w = world();
  const root = await mountIt(w.data);
  await flush();
  assert.match(textOf(root), /Google sign-in/);
  assert.match(textOf(root), /Not set up/);
  assert.match(textOf(root), /Client 2222 from #Microsoft_Sign_In/);
  assert.equal(find(root, "signin-google-redirect"), null, "the address shows only while setting up");
  await press(find(root, "signin-google"));
  assert.equal(textOf(find(root, "signin-google-redirect")), "https://space.test/oauth/callback");
  await typeInto(find(root, "signin-google-item"), "Google_Sign_In");
  await commit(find(root, "signin-google-item"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "google.user.app_set")?.input, { vaultItem: "#Google_Sign_In" });
  assert.match(textOf(root), /Client client-1 from #Google_Sign_In/);
  assert.equal(find(root, "signin-google-redirect"), null, "the form closes once saved");
});

test("a refused Vault item says why and keeps the form open; a provider this server lacks is not listed", async () => {
  const w = world({ setFails: true, microsoft: null });
  const root = await mountIt(w.data);
  await flush();
  assert.doesNotMatch(textOf(root), /Microsoft/);
  await press(find(root, "signin-google"));
  await typeInto(find(root, "signin-google-item"), "#Nope");
  await commit(find(root, "signin-google-item"));
  await flush();
  assert.match(textOf(root), /#Nope has no client_id/);
  assert.ok(find(root, "signin-google-redirect"));
});
