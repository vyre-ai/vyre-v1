// The real flows behind Connect: the mailbox sheet calls mail.connect and the connector sheet calls connections.create, then each hands the new account back.
import test from "node:test";
import assert from "node:assert/strict";
import { createRoot } from "test-renderer";
import { find, flush, installDom, mount, press, typeInto } from "../../../../../ui/src/testing/dom.ts";
import ConnectSheets, { NumberSheet } from "./sheets.tsx";
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

function mailRuntime(calls: { cap: string; input: unknown }[], delegated: string | null): ShellRuntime {
  return {
    call: async (cap: string, input?: unknown) => {
      calls.push({ cap, input });
      if (cap === "google.dwd.my_account" || cap === "ms.consent.my_account") return delegated ? { email: delegated } : {};
      if (cap === "mail.connect") return { mailbox: { id: "mbx_9", address: (input as { address: string }).address, title: "" } };
      if (cap === "vault.folders.list") return { folders: [{ id: "vfd_1", name: "Accounts" }] };
      if (cap === "vault.item.put") return { item: { handle: "#Mail_ana_example_com" } };
      return {};
    },
    openUrl: () => undefined, open: (t: unknown) => { calls.push({ cap: "open", input: t }); },
  } as unknown as ShellRuntime;
}

test("Gmail: a Space with Google Workspace set up matches the person, and Connect makes the mailbox with mail.connect", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const done: Connected[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={mailRuntime(calls, "firm@example.com")} need={{ kind: "mailbox", provider: "google" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await flush();
  assert.ok(find(root, "connect-matched"), "the matched address is shown");
  await press(find(root, "connect-go"));
  await flush();
  const call = calls.find((c) => c.cap === "mail.connect")?.input as { provider: string; address: string; idempotencyKey: string };
  assert.deepEqual([call.provider, call.address], ["google", "firm@example.com"]);
  assert.ok(call.idempotencyKey);
  assert.deepEqual(done, [{ id: "mbx_9", title: "firm@example.com", app: "mail" }]);
});

test("Gmail and Outlook without a Workspace or Microsoft 365 set-up say so in one line and offer the app password, never a dead click", async () => {
  for (const [provider, word, space, host] of [["google", "Gmail", "Google Workspace", "imap.gmail.com"], ["microsoft", "Outlook", "Microsoft 365", "outlook.office365.com"]] as const) {
    const calls: { cap: string; input: unknown }[] = [];
    const root = await mount(createRoot, <ConnectSheets rt={mailRuntime(calls, null)} need={{ kind: "mailbox", provider }} onDone={() => undefined} onCancel={() => undefined} />);
    await flush();
    assert.equal(calls.some((c) => c.cap === "mail.connect"), false, "no half-made mailbox");
    const line = find(root, "connect-unavailable");
    assert.ok(line, `${word}: the line is there`);
    assert.match(JSON.stringify(line), new RegExp(`${word} sign-in needs a sign-in app, or ${space}, set up for your Space`));
    assert.equal(find(root, "connect-go"), null, "nothing to press that does nothing");
    await press(find(root, "connect-use-imap"));
    await flush();
    assert.equal((find(root, "connect-host")!.props as { value?: string }).value, host, "the app password path is pre-filled for the provider");
    assert.ok(find(root, "connect-password"));
  }
});

test("Gmail's set-up link leaves the sheet and opens Settings > Connections", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  let cancelled = 0;
  const root = await mount(createRoot, <ConnectSheets rt={mailRuntime(calls, null)} need={{ kind: "mailbox", provider: "google" }} onDone={() => undefined} onCancel={() => { cancelled++; }} />);
  await flush();
  await press(find(root, "connect-setup"));
  assert.equal(cancelled, 1);
  assert.deepEqual(calls.find((c) => c.cap === "open")!.input, { screen: "settings.page", args: { page: "connections" } });
});

test("Other email: the password goes to the Vault and the mailbox keeps only its handle; a refused sign-in says so", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const done: Connected[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={mailRuntime(calls, null)} need={{ kind: "mailbox", provider: "imap" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  assert.ok(find(root, "connect-host") && find(root, "connect-port") && find(root, "connect-password"), "the server form");
  assert.equal(find(root, "connect-go")!.props["aria-disabled"] ?? find(root, "connect-go")!.props.disabled, true, "Connect waits for the fields");
  await typeInto(find(root, "connect-address"), "ana@example.com");
  await typeInto(find(root, "connect-host"), "mail.example.com");
  await typeInto(find(root, "connect-password"), "app-pass-123");
  await press(find(root, "connect-go"));
  await flush();
  const put = calls.find((c) => c.cap === "vault.item.put")!.input as { folderId: string; kind: string; fields: Array<{ key: string; value: string; secret: boolean }> };
  assert.equal(put.folderId, "vfd_1");
  assert.deepEqual(put.fields, [{ key: "password", value: "app-pass-123", secret: true }]);
  const conn = calls.find((c) => c.cap === "mail.connect")!.input as { provider: string; address: string; imap: Record<string, unknown> };
  assert.equal(conn.provider, "imap");
  assert.deepEqual(conn.imap, { host: "mail.example.com", port: 993, secure: true, username: "ana@example.com", passwordHandle: "#Mail_ana_example_com.password" });
  assert.ok(!JSON.stringify(conn).includes("app-pass-123"), "the password never rides the mailbox call");
  assert.deepEqual(done, [{ id: "mbx_9", title: "ana@example.com", app: "mail" }]);
});

test("Other email: a server that refuses the sign-in says to check the address and app password and stays open", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const rt = mailRuntime(calls, null);
  const inner = rt.call;
  (rt as unknown as { call: unknown }).call = async (cap: string, input?: unknown) => { if (cap === "mail.connect") { calls.push({ cap, input }); throw Object.assign(new Error("x"), { code: "provider.auth_failed" }); } return inner(cap, input); };
  const done: Connected[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={rt} need={{ kind: "mailbox", provider: "imap" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await typeInto(find(root, "connect-address"), "ana@example.com");
  await typeInto(find(root, "connect-host"), "mail.example.com");
  await typeInto(find(root, "connect-password"), "wrong");
  await press(find(root, "connect-go"));
  await flush();
  assert.match(JSON.stringify(find(root, "connect-line")), /did not accept that sign-in/);
  assert.deepEqual(done, []);
});

test("Twilio: the account's own numbers come in and the first is claimed; with none, a search and a buy (a held purchase says it waits for a yes)", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const done: Connected[] = [];
  const own = { call: async (cap: string, input?: unknown) => { calls.push({ cap, input }); return cap === "telephony.number.import" ? { imported: 1, numbers: [{ numberId: "num_1", e164: "+14155550100" }] } : {}; }, openUrl: () => undefined, open: () => undefined } as unknown as ShellRuntime;
  await mount(createRoot, <NumberSheet rt={own} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await flush();
  assert.deepEqual(done, [{ id: "num_1", title: "+14155550100", app: "twilio" }]);
  const none: { cap: string; input: unknown }[] = [];
  const empty = { call: async (cap: string, input?: unknown) => { none.push({ cap, input }); if (cap === "telephony.number.import") return { imported: 0, numbers: [] }; if (cap === "telephony.number.list") return { numbers: [] }; if (cap === "telephony.number.search") return { available: [{ e164: "+14155550111" }] }; if (cap === "telephony.number.buy") return {}; return {}; }, openUrl: () => undefined, open: () => undefined } as unknown as ShellRuntime;
  const d2: Connected[] = [];
  const root = await mount(createRoot, <NumberSheet rt={empty} onDone={(a) => d2.push(a)} onCancel={() => undefined} />);
  await flush();
  await typeInto(find(root, "connect-area"), "415");
  await press(find(root, "connect-go"));
  await flush();
  assert.deepEqual(none.find((c) => c.cap === "telephony.number.search")!.input, { country: "US", areaCode: "415", capabilities: ["voice", "sms"], limit: 5 });
  await press(find(root, "connect-buy-+14155550111"));
  await flush();
  assert.match(JSON.stringify(find(root, "connect-line")), /Waiting for your approval/);
  assert.deepEqual(d2, []);
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

test("Twilio: a number the Space already has counts as claimed when nothing new comes in", async () => {
  const done: Connected[] = [];
  const rt = { call: async (cap: string) => (cap === "telephony.number.import" ? { imported: 0, numbers: [] } : cap === "telephony.number.list" ? { numbers: [{ numberId: "num_7", e164: "+14155550123" }] } : {}), openUrl: () => undefined, open: () => undefined } as unknown as ShellRuntime;
  await mount(createRoot, <NumberSheet rt={rt} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await flush();
  assert.deepEqual(done, [{ id: "num_7", title: "+14155550123", app: "twilio" }]);
});

function ownRuntime(calls: { cap: string; input: unknown }[], opened: string[], o: { signedIn: boolean; microsoft?: boolean }): ShellRuntime {
  return {
    call: async (cap: string, input?: unknown) => {
      calls.push({ cap, input });
      if (cap === "google.user.app_status") return { configured: true, clientId: "c", redirectUri: "https://space.test/oauth/callback" };
      if (cap === "ms.user.app_status") return { configured: o.microsoft === true };
      if (cap === "google.dwd.my_account" || cap === "ms.consent.my_account") return { email: "firm@example.com" };
      if (cap === "google.user.list") return { accounts: [{ accountId: "gua_old", email: "old@gmail.test" }, ...(o.signedIn ? [{ accountId: "gua_new", email: "me@gmail.test" }] : [])] };
      if (cap === "google.user.start") return { authUrl: "https://accounts.example.com/o/auth", state: "gos_1" };
      if (cap === "mail.mailbox.list") return { mailboxes: [{ id: "mbx_old", address: "old@gmail.test" }, { id: "mbx_new", address: "Me@gmail.test", title: "" }] };
      return {};
    },
    openUrl: (url: string) => { opened.push(url); },
    open: () => undefined,
  } as unknown as ShellRuntime;
}

test("with a Google sign-in app the mailbox sheet signs the person in (before the Workspace match), then hands back the mailbox it made", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const opened: string[] = [];
  const done: Connected[] = [];
  const state = { signedIn: false };
  const root = await mount(createRoot, <ConnectSheets rt={ownRuntime(calls, opened, state)} need={{ kind: "mailbox", provider: "google" }} onDone={(a) => done.push(a)} onCancel={() => undefined} />);
  await flush();
  assert.equal(find(root, "connect-go"), null, "no plain Connect: sign in replaces it");
  assert.equal(find(root, "connect-matched"), null, "the Workspace match gives way to the person's own sign-in");
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

test("the address typed becomes the sign-in hint; Outlook without an app keeps the Workspace match", async () => {
  const calls: { cap: string; input: unknown }[] = [];
  const root = await mount(createRoot, <ConnectSheets rt={ownRuntime(calls, [], { signedIn: false })} need={{ kind: "mailbox", provider: "google" }} onDone={() => undefined} onCancel={() => undefined} />);
  await flush();
  await typeInto(find(root, "connect-address"), "me@gmail.test");
  await press(find(root, "connect-signin"));
  await flush();
  assert.deepEqual(calls.find((c) => c.cap === "google.user.start")?.input, { loginHint: "me@gmail.test" });
  await press(find(root, "connect-microsoft"));
  await flush();
  assert.ok(find(root, "connect-matched"), "Outlook has no app here: the Workspace match is back");
  assert.equal(find(root, "connect-signin"), null);
});
