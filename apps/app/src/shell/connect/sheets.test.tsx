// The real flows behind Connect: the mailbox sheet calls mail.connect and the connector sheet calls connections.create, then each hands the new account back.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../ui/src/testing/dom.ts";
import ConnectSheets from "./sheets.tsx";
import type { Connected } from "./model.ts";
import type { ShellRuntime } from "../providers/runtime.tsx";

installDom(); // stays up for the whole file: mounted rows clean up their listeners after a test ends

function runtime(calls: { cap: string; input: unknown }[], opened: string[]): ShellRuntime {
  return {
    call: async (cap: string, input?: unknown) => {
      calls.push({ cap, input });
      if (cap === "mail.connect") return { mailbox: { id: "mbx_9", address: "firm@example.com", title: "" } };
      if (cap === "connections.create") return { connection: { connectionId: "con_9", title: "Google", state: "pending" }, authUrl: "https://accounts.example.com/auth" };
      if (cap === "connections.get") return { connection: { connectionId: "con_9", state: "active" } };
      return {};
    },
    openUrl: (url: string) => { opened.push(url); },
    open: () => undefined,
  } as unknown as ShellRuntime;
}

test("the mailbox sheet connects the address with mail.connect and hands the mailbox back", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const done: Connected[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={runtime(calls, [])} need={{ kind: "mailbox" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  assert.ok(find(root, "connect-go"), "the connect button is there");
  await typeInto(find(root, "connect-address"), "firm@example.com");
  await press(find(root, "connect-go"));
  await flush();
  const call = calls.find((c) => c.cap === "mail.connect")?.input as { provider: string; address: string; idempotencyKey: string };
  assert.equal(call.provider, "google");
  assert.equal(call.address, "firm@example.com");
  assert.ok(call.idempotencyKey, "the call carries its idempotency key");
  assert.deepEqual(done, [{ id: "mbx_9", title: "firm@example.com", app: "mail" }]);
});

test("the connector sheet signs in, then finishes once the connection is active", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const done: Connected[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={runtime(calls, opened)} need={{ kind: "connector", service: "google" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await press(find(root, "connect-go"));
  await flush();
  assert.deepEqual(opened, ["https://accounts.example.com/auth"], "the provider's sign-in opened");
  assert.deepEqual(done, [], "not finished until the person says so and the connection is active");
  await press(find(root, "connect-signed-in"));
  await flush();
  assert.deepEqual(done, [{ id: "con_9", title: "Google", app: "google" }]);
});

test("the Dropbox sheet starts the sign-in with its own capability, opens the address, and hands the account back once it is listed", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const done: Connected[] = [];
  const rt = {
    call: async (cap: string, input?: unknown) => {
      calls.push({ cap, input });
      if (cap === "dropbox.connect.start") return { authUrl: "https://www.dropbox.com/oauth2/authorize?state=dbs_1", state: "dbs_1" };
      if (cap === "dropbox.account.list") return { connections: [{ connectionId: "con_dbx1", ownerKind: "person", accountId: "dbid:A", email: "maya@firm.example" }] };
      return {};
    },
    openUrl: (url: string) => { opened.push(url); },
    open: () => undefined,
  } as unknown as ShellRuntime;
  const root = await mount(createRoot, <ConnectSheets rt={rt} need={{ kind: "connector", service: "dropbox" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  assert.ok(find(root, "connect-dropbox"), "the Dropbox sheet, not the generic one");
  await press(find(root, "connect-go"));
  await flush();
  assert.deepEqual(opened, ["https://www.dropbox.com/oauth2/authorize?state=dbs_1"]);
  assert.equal(calls.some((c) => c.cap === "connections.create"), false, "the connectors module is not involved");
  assert.deepEqual(done, []);
  await press(find(root, "connect-signed-in"));
  await flush();
  assert.deepEqual(done, [{ id: "con_dbx1", title: "maya@firm.example", app: "dropbox" }]);
});

function ownRuntime(calls: { cap: string; input: unknown }[], opened: string[], o: { signedIn: boolean }): ShellRuntime {
  return {
    call: async (cap: string, input?: unknown) => {
      calls.push({ cap, input });
      if (cap === "google.user.app_status") return { configured: true, clientId: "c", redirectUri: "https://space.test/oauth/callback" };
      if (cap === "google.user.list") return { accounts: [{ accountId: "gua_old", email: "old@gmail.test" }, ...(o.signedIn ? [{ accountId: "gua_new", email: "me@gmail.test" }] : [])] };
      if (cap === "google.user.start") return { authUrl: "https://accounts.example.com/o/auth", state: "gos_1" };
      if (cap === "mail.mailbox.list") return { mailboxes: [{ id: "mbx_old", address: "old@gmail.test" }, { id: "mbx_new", address: "Me@gmail.test", title: "" }] };
      return {};
    },
    openUrl: (url: string) => { opened.push(url); },
    open: () => undefined,
  } as unknown as ShellRuntime;
}

test("with a Google sign-in app the mailbox sheet signs the person in, then hands back the mailbox it made", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const done: Connected[] = [];
  const state = { signedIn: false };
  const root = await mount(createRoot, <ConnectSheets rt={ownRuntime(calls, opened, state)} need={{ kind: "mailbox" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await flush();
  assert.equal(find(root, "connect-go"), null, "no address form submit: sign in replaces it");
  await press(find(root, "connect-signin"));
  await flush();
  assert.deepEqual(opened, ["https://accounts.example.com/o/auth"]);
  assert.equal(calls.some((c) => c.cap === "mail.connect"), false, "the mailbox is made by the sign-in, not by the sheet");
  await press(find(root, "connect-signed-in"));
  await flush();
  assert.deepEqual(done, [], "the account is not there yet");
  assert.ok(find(root, "connect-line"), "the person is told it is not finished");
  state.signedIn = true;
  await press(find(root, "connect-signed-in"));
  await flush();
  assert.deepEqual(done, [{ id: "mbx_new", title: "Me@gmail.test", app: "mail" }]);
});

test("the address typed becomes the sign-in hint; Outlook without an app keeps the address form", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={ownRuntime(calls, [], { signedIn: false })} need={{ kind: "mailbox" }} onDone={() => undefined} onCancel={() => undefined} />);
  await flush();
  await typeInto(find(root, "connect-address"), "me@gmail.test");
  await press(find(root, "connect-signin"));
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "google.user.start")?.input, { loginHint: "me@gmail.test" });
  await press(find(root, "connect-microsoft"));
  await flush();
  assert.ok(find(root, "connect-go"), "Outlook has no app here: the address form is back");
  assert.equal(find(root, "connect-signin"), null);
});
