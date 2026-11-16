// @tsx
// Send for signature, the screens and the calls: the sheet empty and with a person in it, the sent state with each link and the server's own sentence about mail, the status line a file wears in each state,
// and the calls (send, remind, cancel) against a fake of the server's answers (SIGN-CONTRACT-R33 section 2).
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SignDataProvider } from "./data.tsx";
import type { SignData } from "./data.tsx";
import { SignBar } from "./SignBar.tsx";
import { LinkRows, SignSheet } from "./SignSheet.tsx";
import { cancelRequest, remind, requestsOf, sendForSignature } from "./actions.ts";
import { envelopeOf } from "./model.ts";

const NOW = Date.UTC(2026, 10, 17, 12);
const calls: { cap: string; input: Record<string, unknown> }[] = [];
const server: Record<string, (i: Record<string, unknown>) => unknown> = {};
const data: SignData = {
  call: async (cap, input) => {
    calls.push({ cap, input: input as Record<string, unknown> });
    const f = server[cap];
    if (!f) throw new Error(`no ${cap}`);
    return f(input as Record<string, unknown>);
  },
  clock: () => ({ now: NOW, offsetMin: 0 }),
  openFile: () => undefined,
};
const html = (el: ReactElement): string =>
  renderToStaticMarkup(<SignDataProvider value={data}>{el}</SignDataProvider>).replaceAll("<!-- -->", "");
const noop = (): void => undefined;

test("the sheet opens on who signs with one empty row, a message, and Send; nothing about a service or a plan", () => {
  const out = html(<SignSheet fileId="fil_1" fileName="Northwind NDA.pdf" onClose={noop} />);
  for (const want of [
    "Send for signature",
    "Northwind NDA.pdf",
    "Who signs",
    "Add another",
    "Message (optional)",
    "Send",
    "Cancel",
  ])
    assert.ok(out.includes(want), `missing ${want}`);
  assert.ok(out.includes('data-testid="sign-name-0"'));
  assert.ok(!out.includes('data-testid="sign-name-1"'));
  assert.ok(!out.includes("One after another"), "the order switch only shows with two people");
  assert.ok(!/legally binding/i.test(out));
});

test("people the caller knows start the list, and a second person offers the order switch", () => {
  const out = html(
    <SignSheet
      fileId="fil_1"
      fileName="Northwind NDA.pdf"
      suggest={[{ name: "Imran Ibarra", email: "imran@northwind.example" }, { name: "Andrea Lindahl" }]}
      onClose={noop}
    />,
  );
  assert.ok(out.includes("Imran Ibarra") && out.includes("imran@northwind.example") && out.includes("Andrea Lindahl"));
  assert.ok(out.includes("One after another"));
});

test("the sent links list each person with the address and a Copy that names them", () => {
  const out = html(
    <LinkRows
      links={[
        {
          index: 0,
          name: "Imran Ibarra",
          email: "imran@northwind.example",
          url: "https://northwind.vyre.run/p/sign/abc/",
        },
        { index: 1, name: "Andrea Lindahl", url: "https://northwind.vyre.run/p/sign/def/" },
      ]}
    />,
  );
  assert.ok(
    out.includes("https://northwind.vyre.run/p/sign/abc/") && out.includes("https://northwind.vyre.run/p/sign/def/"),
  );
  assert.ok(out.includes('aria-label="Copy Imran&#x27;s link"') || out.includes("Copy Imran"));
  assert.ok(out.includes('data-testid="sign-copy-Andrea"'));
});

const env = (o: Record<string, unknown>) => envelopeOf({ envelopeId: "env_1", title: "Northwind NDA.pdf", ...o })!;

test("a file waiting for signature says who, and offers Remind and Copy link (Cancel is in the menu)", () => {
  const out = html(
    <SignBar
      env={env({
        status: "sent",
        signers: [
          { name: "Imran Ibarra", status: "signed" },
          { name: "Andrea Lindahl", status: "sent" },
        ],
      })}
      onChange={noop}
    />,
  );
  assert.ok(out.includes("Waiting for Andrea"));
  for (const w of ["Remind", "Copy link"]) assert.ok(out.includes(w), w);
});

test("a signed file says the day and offers the signed copy; a declined one says who and can be sent again", () => {
  const signed = html(
    <SignBar
      env={env({
        status: "signed",
        signedFileId: "fil_2",
        signers: [{ name: "Imran Ibarra", status: "signed", signedAt: Date.UTC(2026, 10, 14, 9) }],
      })}
      onChange={noop}
    />,
  );
  assert.ok(signed.includes("Signed on 14 Nov") && signed.includes("Open signed copy"));
  assert.ok(!signed.includes("Cancel request"));
  const declined = html(
    <SignBar
      env={env({
        status: "declined",
        declinedReason: "Wrong date",
        signers: [{ name: "Andrea Lindahl", status: "declined" }],
      })}
      onChange={noop}
      onSendAgain={noop}
    />,
  );
  assert.ok(declined.includes("Andrea declined") && declined.includes("Wrong date") && declined.includes("Send again"));
});

test("send: the input goes to esign.send as given, and the answer becomes links and the mail sentence", async () => {
  calls.length = 0;
  server["esign.send"] = () => ({
    envelopeId: "env_9",
    links: [{ index: 0, name: "Imran Ibarra", path: "/p/sign/tok/" }],
    notice: "This Space has no sending mailbox, so nothing was emailed. Copy each link and send it yourself.",
  });
  const r = await sendForSignature(
    data.call,
    { fileId: "fil_1", signers: [{ name: "Imran Ibarra", order: 1 }], idempotencyKey: "k" },
    "https://northwind.vyre.run",
  );
  assert.equal(calls[0]?.cap, "esign.send");
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.sent.links[0]?.url, "https://northwind.vyre.run/p/sign/tok/");
    assert.ok(r.sent.notice?.startsWith("This Space has no sending mailbox"));
  }
});

test("send: a refusal shows the server's own sentence, nothing added", async () => {
  server["esign.send"] = () => {
    throw {
      error: {
        code: "validation.bad_input",
        message: "Word documents cannot be signed yet. Export it as a PDF first.",
      },
    };
  };
  const r = await sendForSignature(data.call, { fileId: "fil_1", signers: [], idempotencyKey: "k" }, "");
  assert.deepEqual(r, { ok: false, error: "Word documents cannot be signed yet. Export it as a PDF first." });
});

test("remind mints one new link for one person; cancel and the list are plain calls", async () => {
  calls.length = 0;
  server["esign.remind"] = () => ({ link: { index: 1, name: "Andrea Lindahl", path: "/p/sign/new/" }, emailed: false });
  server["esign.cancel"] = () => ({ cancelled: true });
  server["esign.list"] = () => ({
    envelopes: [{ envelopeId: "env_1", title: "Northwind NDA.pdf", status: "sent", fileId: "fil_1" }],
  });
  const s = await remind(data.call, "env_1", 1, "https://x.vyre.run");
  assert.equal(s?.links[0]?.url, "https://x.vyre.run/p/sign/new/");
  assert.equal(calls[0]?.input.signer, 1);
  await cancelRequest(data.call, "env_1");
  assert.equal(calls[1]?.cap, "esign.cancel");
  const list = await requestsOf(data.call, { fileId: "fil_1" });
  assert.equal(list[0]?.fileId, "fil_1");
  assert.deepEqual(calls[2], { cap: "esign.list", input: { fileId: "fil_1" } });
});
