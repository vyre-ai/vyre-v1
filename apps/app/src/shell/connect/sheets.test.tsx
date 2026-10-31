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
