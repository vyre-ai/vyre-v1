// Inbox > Connect a channel on a booted daemon (Personal-style Space, no Workspace): each tile's server side works against fake provider endpoints.
//   Gmail and Outlook: with no Google Workspace or Microsoft 365 set-up there is no sign-in to offer, and the capabilities the sheet checks say so (no address), so the sheet offers the app password.
//   Other email (and the app-password path of Gmail and Outlook): the password goes to the Vault, mail.connect probes a fake IMAP server with it and keeps only the handle; a refused sign-in is provider.auth_failed.
//   Twilio: the Account SID and Auth Token go to the Vault, telephony.number.import brings in the numbers a fake Twilio API lists, and a number is claimed.
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { boot, call, connect, seededDir } from "./memory-live-kit.ts";

/** A tiny IMAP server: greets, answers CAPABILITY, ID, LOGIN (the user bo@ is refused), NOOP and LOGOUT. */
function fakeImap(): Promise<{ port: number; logins: string[]; close(): void }> {
  const logins: string[] = [];
  const server = net.createServer((sock) => {
    sock.write("* OK IMAP4rev1 fake ready\r\n");
    let buf = "";
    sock.on("data", (b) => {
      buf += b.toString();
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [tag, cmd = "", ...rest] = line.split(" ");
        const c = cmd.toUpperCase();
        if (c === "CAPABILITY") sock.write(`* CAPABILITY IMAP4rev1 ID\r\n${tag} OK done\r\n`);
        else if (c === "ID") sock.write(`* ID NIL\r\n${tag} OK done\r\n`);
        else if (c === "LOGIN") {
          const pass = (rest[1] ?? "").replace(/^"|"$/g, "");
          logins.push(`${(rest[0] ?? "").replace(/^"|"$/g, "")}:${pass}`);
          sock.write(/^"?bo@/.test(rest[0] ?? "") ? `${tag} NO [AUTHENTICATIONFAILED] refused\r\n` : `${tag} OK [CAPABILITY IMAP4rev1] logged in\r\n`);
        } else if (c === "LOGOUT") { sock.write(`* BYE\r\n${tag} OK bye\r\n`); sock.end(); }
        else sock.write(`${tag} OK done\r\n`);
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as net.AddressInfo).port, logins, close: () => server.close() })));
}

const ok = async (d: Awaited<ReturnType<typeof boot>>, cap: string, input: unknown): Promise<any> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await call(d, cap, input);
  assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
  return r.data;
};

async function mineFolder(d: Awaited<ReturnType<typeof boot>>): Promise<string> {
  const have = (await ok(d, "vault.folders.list", { scope: "mine" })).folders as Array<{ id: string; name: string }>;
  return have[0]?.id ?? (await ok(d, "vault.folders.create", { name: "Accounts", scope: "mine", idempotencyKey: "ic-folder" })).folder.id;
}

test("Gmail and Outlook: with no Workspace or Microsoft 365 set-up the sheet's check finds no address, so it offers the app password", async () => {
  const d = await boot(seededDir());
  try {
    await connect(d);
    for (const cap of ["google.dwd.my_account", "ms.consent.my_account"]) {
      const r = await call(d, cap, {});
      assert.equal(r.status, 200, `${cap}: ${JSON.stringify(r.data)}`);
      assert.equal((r.data as { email?: string }).email, undefined, `${cap}: nobody is matched, so no sign-in to offer`);
    }
  } finally { await d.stop(); }
});

test("Other email: the app password goes to the Vault, mail.connect signs in to the server with it and keeps only the handle; a refused sign-in is auth_failed and makes no mailbox", async () => {
  const imap = await fakeImap();
  const d = await boot(seededDir());
  try {
    await connect(d);
    const folderId = await mineFolder(d);
    const put = await ok(d, "vault.item.put", { folderId, name: "Mail_ana_example_com", kind: "login", fields: [{ key: "password", value: "app-pass-123", secret: true }], idempotencyKey: "ic-item" });
    const handle = `${put.item.handle as string}.password`;
    const made = await call(d, "mail.connect", { provider: "imap", address: "ana@example.com", idempotencyKey: "ic-conn", imap: { host: "127.0.0.1", port: imap.port, secure: false, username: "ana@example.com", passwordHandle: handle } });
    assert.equal(made.status, 200, JSON.stringify(made.data));
    assert.equal(made.data.mailbox.address, "ana@example.com");
    assert.ok(imap.logins.some((l) => l.startsWith("ana@example.com:")), `the server saw the sign-in: ${imap.logins.join(",")}`);
    assert.ok(!JSON.stringify(made.data).includes("app-pass-123"), "the password is not in the answer");
    const list = (await ok(d, "mail.mailbox.list", {})).mailboxes as Array<{ address: string }>;
    assert.ok(list.some((m) => m.address === "ana@example.com"), "the mailbox is listed: the Inbox has a channel");

    const bad = await ok(d, "vault.item.put", { folderId, name: "Mail_bo_example_com", kind: "login", fields: [{ key: "password", value: "bad", secret: true }], idempotencyKey: "ic-item2" });
    const refused = await call(d, "mail.connect", { provider: "imap", address: "bo@example.com", idempotencyKey: "ic-conn2", imap: { host: "127.0.0.1", port: imap.port, secure: false, username: "bo@example.com", passwordHandle: `${bad.item.handle as string}.password` } });
    assert.notEqual(refused.status, 200);
    assert.match(JSON.stringify(refused.data), /provider.auth_failed/);
    const after = (await ok(d, "mail.mailbox.list", {})).mailboxes as Array<{ address: string }>;
    assert.ok(!after.some((m) => m.address === "bo@example.com"), "a refused sign-in leaves no mailbox behind");
  } finally { await d.stop(); imap.close(); }
});

test("Twilio: the account goes to the Vault, the numbers the Twilio API lists come in, and the first is claimed", async () => {
  const seen: string[] = [];
  const fetchImpl = ((url: string, init?: { method?: string; headers?: Record<string, string> }) => {
    seen.push(`${init?.method ?? "GET"} ${url}`);
    if (/api\.twilio\.com\/2010-04-01\/Accounts\/[^/]+\/IncomingPhoneNumbers\.json/.test(url)) {
      const body = JSON.stringify({ incoming_phone_numbers: [{ sid: "PN0001", phone_number: "+14155550777", friendly_name: "Main", capabilities: { voice: true, sms: true, mms: false } }], next_page_uri: null });
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve(body) });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
  }) as never;
  const d = await boot(seededDir(), undefined, fetchImpl);
  try {
    await connect(d);
    const folderId = await mineFolder(d);
    await ok(d, "vault.item.put", { folderId, name: "Twilio_Account", kind: "login", fields: [{ key: "value", value: "AC" + "0".repeat(32), secret: true }], idempotencyKey: "tw-a" });
    await ok(d, "vault.item.put", { folderId, name: "Twilio_Auth", kind: "login", fields: [{ key: "value", value: "auth-token-xyz", secret: true }], idempotencyKey: "tw-b" });
    const out = await call(d, "telephony.number.import", { idempotencyKey: "tw-import" });
    assert.equal(out.status, 200, JSON.stringify(out.data) + seen.join("|"));
    assert.equal(out.data.imported, 1);
    assert.equal(out.data.numbers[0].e164, "+14155550777");
    const list = (await ok(d, "telephony.number.list", {})).numbers as Array<{ e164: string }>;
    assert.ok(list.some((n) => n.e164 === "+14155550777"), "the number is claimed: the Inbox has a channel");
  } finally { await d.stop(); }
});
