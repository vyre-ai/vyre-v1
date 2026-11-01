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

function world(o: { google?: object | null; microsoft?: object | null; putFails?: string[]; setFails?: boolean } = {}) {
  const calls: { cap: string; input: unknown }[] = [];
  let google: object | null = o.google === undefined ? { configured: false, redirectUri: "https://space.test/oauth/callback" } : o.google;
  const taken = new Set(o.putFails ?? []);
  const data = {
    call: async (cap: string, input: unknown) => {
      calls.push({ cap, input });
      if (cap === "google.user.app_status") { if (google === null) throw new Error("no such capability"); return google; }
      if (cap === "ms.user.app_status") { if (o.microsoft === null) throw new Error("no such capability"); return o.microsoft ?? { configured: true, clientId: "2222", vaultItem: "#Microsoft_Sign_In", redirectUri: "https://space.test/oauth/callback" }; }
      if (cap === "vault.folders.list") return { folders: [] };
      if (cap === "vault.folders.create") return { folder: { id: "vfd_apps" } };
      if (cap === "vault.item.put") {
        const name = (input as { name: string }).name;
        if (taken.has(name)) throw Object.assign(new Error("exists"), { code: "validation.duplicate" });
        return { item: { handle: `#${name}` } };
      }
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
const fill = async (root: Parameters<typeof find>[0], id: string, value: string): Promise<void> => { await typeInto(find(root, id), value); await commit(find(root, id)); };

test("each provider shows whether its app is set; setting one up shows the steps and the exact redirect address", async () => {
  const w = world();
  const root = await mountIt(w.data);
  await flush();
  assert.match(textOf(root), /Google sign-in/);
  assert.match(textOf(root), /Not set up/);
  assert.match(textOf(root), /Client 2222 from #Microsoft_Sign_In/);
  assert.equal(find(root, "signin-google-redirect"), null, "the guide shows only while setting up");
  await press(find(root, "signin-google"));
  assert.match(textOf(root), /1\. Open Credentials in Google Cloud/);
  assert.match(textOf(root), /Publish the consent screen/);
  assert.equal(textOf(find(root, "signin-google-redirect")), "https://space.test/oauth/callback");
});

test("Save files the id and secret in a Shared Apps folder and names that item to the module; the secret is never put in the module call", async () => {
  const w = world();
  const root = await mountIt(w.data);
  await flush();
  await press(find(root, "signin-google"));
  assert.equal(find(root, "signin-google-save")!.props["disabled"], true, "nothing to save yet");
  await fill(root, "signin-google-id", "client-1.apps.googleusercontent.com");
  await fill(root, "signin-google-secret", "GOCSPX-live-secret");
  await press(find(root, "signin-google-save"));
  await flush();
  assert.deepEqual(w.calls.find((c) => c.cap === "vault.folders.create")?.input && { ...(w.calls.find((c) => c.cap === "vault.folders.create")!.input as object), idempotencyKey: undefined }, { name: "Apps", scope: "shared", idempotencyKey: undefined });
  const put = w.calls.find((c) => c.cap === "vault.item.put")!.input as { folderId: string; name: string; fields: { key: string; value: string; secret: boolean }[] };
  assert.deepEqual([put.folderId, put.name], ["vfd_apps", "Google_Sign_In"]);
  assert.deepEqual(put.fields, [{ key: "client_id", value: "client-1.apps.googleusercontent.com", secret: false }, { key: "client_secret", value: "GOCSPX-live-secret", secret: true }]);
  const set = w.calls.find((c) => c.cap === "google.user.app_set")!.input;
  assert.deepEqual(set, { vaultItem: "#Google_Sign_In" });
  assert.match(textOf(root), /Client client-1 from #Google_Sign_In/);
  assert.equal(find(root, "signin-google-redirect"), null, "the guide closes once saved");
});

test("a Vault name already taken gets the next number; Microsoft also takes a tenant", async () => {
  const w = world({ putFails: ["Google_Sign_In"] });
  const root = await mountIt(w.data);
  await flush();
  await press(find(root, "signin-google"));
  await fill(root, "signin-google-id", "c");
  await fill(root, "signin-google-secret", "s");
  await press(find(root, "signin-google-save"));
  await flush();
  assert.deepEqual(w.calls.filter((c) => c.cap === "vault.item.put").map((c) => (c.input as { name: string }).name), ["Google_Sign_In", "Google_Sign_In_2"]);
  assert.deepEqual(w.calls.find((c) => c.cap === "google.user.app_set")!.input, { vaultItem: "#Google_Sign_In_2" });
  await press(find(root, "signin-microsoft"));
  assert.ok(find(root, "signin-microsoft-tenant"), "Microsoft has a tenant field");
  assert.equal(find(root, "signin-google-tenant"), null);
});

test("a refused app says why and keeps the guide open; a provider this server lacks is not listed", async () => {
  const w = world({ setFails: true, microsoft: null });
  const root = await mountIt(w.data);
  await flush();
  assert.doesNotMatch(textOf(root), /Microsoft/);
  await press(find(root, "signin-google"));
  await fill(root, "signin-google-id", "c");
  await fill(root, "signin-google-secret", "s");
  await press(find(root, "signin-google-save"));
  await flush();
  assert.match(textOf(root), /#Nope has no client_id/);
  assert.ok(find(root, "signin-google-redirect"));
});
