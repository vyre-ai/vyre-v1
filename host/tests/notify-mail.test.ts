// The notifications module's email through the Space's own mail (host/src/seams/notify-mail.ts): from a service mailbox on a verified sending domain, to the person's address (their
// accepted invitation), with the Space's name in the subject and one link the desktop app opens (vyre://open with the Space's address), or nothing with the reason. A stand-in for the mail
// module answers mail.mailbox.list, mail.domain.list and mail.send. Admins hear of an email that could not go from the notifications module (modules/notifications/tests/email.copy.test.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNotifyMailer, noticeLink } from "../src/seams/notify-mail.ts";

interface World {
  mailboxes: Array<{ id: string; address: string }>;
  verified: boolean;
  sendStatus: string;
  members: Array<{ userId: string; email: string }>;
  address: string | null;
}
function rig(w: Partial<World> = {}) {
  const world: World = {
    mailboxes: [{ id: "mbx_service", address: "notices@northwind.test" }],
    verified: true,
    sendStatus: "queued",
    members: [{ userId: "usr_bob", email: "bob@northwind.test" }],
    address: "https://northwind.vyre.run",
    ...w,
  };
  const sent: Array<Record<string, unknown>> = [];
  const seeds: unknown[] = [];
  const mailer = createNotifyMailer({
    space: "spc_core",
    owner: () => "usr_olivia",
    emails: async () => world.members,
    address: () => world.address,
    spaceName: async () => "Northwind",
    invoke: async (cap, input, seed) => {
      seeds.push(seed);
      if (cap === "mail.mailbox.list") return { status: "ok", output: { mailboxes: world.mailboxes } };
      if (cap === "mail.domain.list")
        return {
          status: "ok",
          output: {
            domains: [
              { name: "other.test", verified: false },
              { name: "northwind.test", verified: world.verified },
            ],
          },
        };
      if (cap === "mail.send") {
        sent.push(input as Record<string, unknown>);
        return { status: "ok", output: { messageId: "eml_1", status: world.sendStatus, suppressed: [] } };
      }
      throw new Error(`unexpected ${cap}`);
    },
  });
  return { mailer, sent, seeds, world };
}
const msg = {
  to: "usr_bob",
  subject: "Scheduled for deletion on 18 November 2026",
  line: "Everything in this Space is removed on 18 November 2026. An admin can cancel the deletion in Console until then.",
  open: { kind: "place", id: "console" },
  key: "ntf_1",
};
const LINK = "vyre://open?address=https%3A%2F%2Fnorthwind.vyre.run&kind=place&id=console";

test("one email from the service mailbox to the person's address: the Space's name in the subject, the fixed line, and a link the app opens", async () => {
  const r = rig();
  assert.equal(await r.mailer.email(msg), "sent");
  assert.deepEqual(r.sent, [
    {
      mailboxId: "mbx_service",
      route: "space_domain",
      to: [{ address: "bob@northwind.test" }],
      subject: "Northwind: Scheduled for deletion on 18 November 2026",
      text: `${msg.line}\n\nOpen it in the Vyre app: ${LINK}\nOr go to https://northwind.vyre.run in a browser.`,
      idempotencyKey: "notify:usr_bob:ntf_1",
    },
  ]);
  assert.deepEqual(
    r.seeds[0],
    { space: "spc_core", principal: { kind: "person", id: "usr_olivia" }, origin: "notify" },
    "as the Space owner, an ordinary authorized call, the way portal links go",
  );
});

/** links.rs parse, line for line: the scheme, the action before ?, the action in ACTIONS (read from the Rust file itself), each key and value decoded and within its limits. */
function rustParse(url: string): { action: string; params: Record<string, string> } | null {
  const rs = readFileSync(new URL("../../apps/desktop/src-tauri/src/links.rs", import.meta.url), "utf8");
  const actions = [
    ...(/pub const ACTIONS: \[&str; \d+\] = \[([^\]]*)\]/.exec(rs)?.[1] ?? "").matchAll(/"([a-z]+)"/g),
  ].map((m) => m[1]!);
  const num = (name: string): number => Number(new RegExp(`pub const ${name}: usize = (\\d+);`).exec(rs)?.[1]);
  if (url.length > num("MAX_LEN") || /[\u0000-\u001f\u007f]/.test(url) || !url.startsWith("vyre://")) return null;
  const rest = url.slice("vyre://".length);
  const [head, query = ""] = rest.includes("?")
    ? [rest.slice(0, rest.indexOf("?")), rest.slice(rest.indexOf("?") + 1)]
    : [rest, ""];
  const action = head.replace(/\/+$/, "").toLowerCase();
  if (!actions.includes(action)) return null;
  const params: Record<string, string> = {};
  for (const pair of query.split("#")[0]!.split("&").filter(Boolean)) {
    const i = pair.indexOf("=");
    const k = decodeURIComponent(i < 0 ? pair : pair.slice(0, i)),
      v = decodeURIComponent(i < 0 ? "" : pair.slice(i + 1));
    if (
      !k ||
      k.length > num("MAX_PARAM_KEY_LEN") ||
      v.length > num("MAX_PARAM_VALUE_LEN") ||
      k in params ||
      Object.keys(params).length >= num("MAX_PARAMS")
    )
      return null;
    params[k] = v;
  }
  return { action, params };
}

test("the link is one links.rs takes (action open, the Space's address, a place or a thing); the old links were refused", () => {
  assert.equal(noticeLink("https://northwind.vyre.run", { kind: "place", id: "console" }), LINK);
  assert.deepEqual(rustParse(LINK), {
    action: "open",
    params: { address: "https://northwind.vyre.run", kind: "place", id: "console" },
  });
  assert.deepEqual(rustParse(noticeLink("https://northwind.vyre.run", { kind: "task", id: "tsk_5" })!)?.params, {
    address: "https://northwind.vyre.run",
    kind: "task",
    id: "tsk_5",
  });
  for (const old of ["vyre://console/spacedel", "vyre://inbox", "vyre://task/tsk_x"])
    assert.equal(rustParse(old), null, old);
  assert.equal(noticeLink(null, { kind: "place", id: "console" }), null, "no address: no link");
  assert.equal(
    noticeLink("https://northwind.vyre.run", { kind: "place", id: "bad id&x=1" }),
    null,
    "only ids the app's link router takes",
  );
});

test("a Space with no address the app can reach: the email says to open Vyre, with no link", async () => {
  const r = rig({ address: null });
  assert.equal(await r.mailer.email(msg), "sent");
  assert.equal(r.sent[0]!["text"], `${msg.line}\n\nOpen Vyre to see it.`);
});

test("the sending mailbox is a service mailbox on a verified domain, not the first one listed", async () => {
  const r = rig({
    mailboxes: [
      { id: "mbx_other", address: "x@other.test" },
      { id: "mbx_service", address: "notices@northwind.test" },
    ],
  });
  assert.equal(await r.mailer.email(msg), "sent");
  assert.equal(r.sent[0]!["mailboxId"], "mbx_service");
});

test("no service mailbox, or none on a verified domain: nothing is sent and the answer is no_mailbox (never sent)", async () => {
  for (const w of [{ mailboxes: [] }, { verified: false }]) {
    const r = rig(w);
    assert.equal(await r.mailer.email(msg), "no_mailbox");
    assert.equal(r.sent.length, 0);
  }
});

test("a person with no address in this Space (often the owner, who claimed it and was never invited), or one who left or was suspended: no_address; a re-invited person gets the newest address", async () => {
  assert.equal(await rig({ members: [] }).mailer.email({ ...msg, to: "usr_olivia" }), "no_address");
  const r = rig({
    members: [
      { userId: "usr_bob", email: "old@northwind.test" },
      { userId: "usr_bob", email: "bob@northwind.test" },
    ],
  });
  await r.mailer.email(msg);
  assert.deepEqual(r.sent[0]!["to"], [{ address: "bob@northwind.test" }]);
});

test("a suppressed address and a held send are said as such, never as sent; any other answer is a failure to try again", async () => {
  assert.equal(await rig({ sendStatus: "suppressed" }).mailer.email(msg), "suppressed");
  assert.equal(await rig({ sendStatus: "held" }).mailer.email(msg), "held");
  await assert.rejects(() => rig({ sendStatus: "bounced" }).mailer.email(msg), /not sent/);
});
