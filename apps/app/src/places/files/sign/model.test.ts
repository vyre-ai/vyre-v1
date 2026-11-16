// @tsx
// Send for signature: the sheet's rows, what stops Send, the input the server gets, and the one set of status words a file and a record share.
import test from "node:test";
import assert from "node:assert/strict";
import {
  blankSigner,
  canSignFile,
  changeWords,
  current,
  dayWords,
  envelopeOf,
  mailWords,
  names,
  problemsOf,
  sendInput,
  sentOf,
  statusLine,
} from "./model.ts";

const NOW = Date.UTC(2026, 10, 17, 12);

test("an empty sheet cannot send; it asks for a person, not a form field", () => {
  assert.deepEqual(problemsOf([blankSigner()]), [{ key: null, text: "Add the person who signs." }]);
});

test("a name is needed, an email is optional, a typed email must be one", () => {
  const ok = blankSigner("Imran Ibarra");
  assert.deepEqual(problemsOf([ok]), []);
  const noName = blankSigner("", "imran@northwind.example");
  assert.equal(problemsOf([noName])[0]?.text, "Give this person a name.");
  const bad = blankSigner("Andrea Lindahl", "andrea@");
  assert.equal(problemsOf([bad])[0]?.text, "Andrea's email needs another look.");
  assert.equal(problemsOf([bad])[0]?.key, bad.key);
});

test("an empty extra row is ignored, not an error", () => {
  assert.deepEqual(problemsOf([blankSigner("Imran Ibarra", "imran@northwind.example"), blankSigner()]), []);
});

test("the input signs everyone at once by default, in a row when asked, trims, and leaves out an empty email and message", () => {
  const a = blankSigner(" Imran Ibarra ", " imran@northwind.example ");
  const b = blankSigner("Andrea Lindahl");
  assert.deepEqual(sendInput("fil_1", undefined, [a, blankSigner(), b], "  ", "k1"), {
    fileId: "fil_1",
    signers: [
      { name: "Imran Ibarra", email: "imran@northwind.example", order: 1 },
      { name: "Andrea Lindahl", order: 1 },
    ],
    idempotencyKey: "k1",
  });
  assert.deepEqual(
    sendInput("fil_1", undefined, [a, b], "", "k1", true).signers.map((x) => x.order),
    [1, 2],
  );
  const withRecord = sendInput("fil_1", "rec_9", [a], "Please sign by Friday.", "k2");
  assert.equal(withRecord.recordId, "rec_9");
  assert.equal(withRecord.message, "Please sign by Friday.");
});

test("an envelope reads from whatever the server returned, and says Waiting for the people who have not signed", () => {
  const e = envelopeOf({
    envelopeId: "env_1",
    title: "Northwind NDA.pdf",
    status: "sent",
    signers: [
      { name: "Imran Ibarra", status: "signed" },
      { name: "Andrea Lindahl", status: "sent" },
    ],
  });
  assert.ok(e);
  assert.deepEqual(statusLine(e, NOW), { tone: "quiet", label: "Waiting for Andrea" });
});

test("once someone has opened it the line still says who it waits for, and the note says who opened it", () => {
  const e = envelopeOf({
    envelopeId: "env_1",
    status: "viewed",
    signers: [
      { name: "Imran Ibarra", status: "signed" },
      { name: "Andrea Lindahl", status: "viewed" },
    ],
  })!;
  assert.deepEqual(statusLine(e, NOW), { tone: "quiet", label: "Waiting for Andrea", note: "Andrea opened it" });
});

test("signed says the day and by whom; declined names the person; the other ends are plain", () => {
  const signed = envelopeOf({
    envelopeId: "env_2",
    status: "signed",
    signedAt: Date.UTC(2026, 10, 14, 9),
    signers: [
      { name: "Imran Ibarra", status: "signed" },
      { name: "Andrea Lindahl", status: "signed" },
    ],
  })!;
  assert.deepEqual(statusLine(signed, NOW), { tone: "ok", label: "Signed on 14 Nov", note: "By Imran and Andrea" });
  assert.equal(
    statusLine({ ...signed, state: "declined", declinedBy: "Andrea Lindahl" }, NOW).label,
    "Andrea declined",
  );
  assert.equal(statusLine({ ...signed, state: "cancelled" }, NOW).label, "Cancelled");
  assert.equal(statusLine({ ...signed, state: "expired" }, NOW).label, "Not signed in time");
  assert.equal(statusLine({ ...signed, state: "approval" }, NOW).label, "Waiting for approval");
});

test("an unknown status falls to Sent and a row with no id is not an envelope", () => {
  assert.equal(envelopeOf({ envelopeId: "env_3", status: "weird" })?.state, "sent");
  assert.equal(envelopeOf({ status: "sent" }), null);
  assert.equal(envelopeOf(null), null);
});

test("the open request is the one a person cares about, even when an older one ended", () => {
  const old = envelopeOf({ envelopeId: "a", status: "cancelled" })!;
  const live = envelopeOf({ envelopeId: "b", status: "sent" })!;
  assert.equal(current([old, live])?.id, "b");
  assert.equal(current([old])?.id, "a");
  assert.equal(current([]), null);
});

test("names stay short", () => {
  assert.equal(names(["Imran Ibarra"]), "Imran");
  assert.equal(names(["Imran Ibarra", "Andrea Lindahl"]), "Imran and Andrea");
  assert.equal(names(["Imran Ibarra", "Andrea Lindahl", "Sam Reyes", "Lee Park"]), "Imran, Andrea and 2 more");
});

test("a day in another year carries the year; the Space's zone decides the day", () => {
  assert.equal(dayWords(Date.UTC(2025, 11, 31, 23), NOW), "31 Dec 2025");
  assert.equal(dayWords(Date.UTC(2026, 10, 14, 23), NOW, 120), "15 Nov");
});

test("the server's answer to a send gives each link, who was emailed, and its own sentence when none was", () => {
  const s = sentOf(
    {
      envelopeId: "env_1",
      links: [
        {
          index: 0,
          name: "Imran Ibarra",
          email: "imran@northwind.example",
          url: "https://x.vyre.run/p/sign/abc/",
          path: "/p/sign/abc/",
        },
        { index: 1, name: "Andrea Lindahl", path: "/p/sign/def/" },
      ],
      notice: "This Space has no sending mailbox, so nothing was emailed. Copy each link and send it yourself.",
    },
    "https://x.vyre.run/",
  )!;
  assert.equal(s.id, "env_1");
  assert.equal(s.links[0]?.url, "https://x.vyre.run/p/sign/abc/");
  assert.equal(s.links[1]?.url, "https://x.vyre.run/p/sign/def/");
  assert.deepEqual(s.emailed, []);
  assert.equal(
    mailWords(s.emailed, s.notice, 2),
    "This Space has no sending mailbox, so nothing was emailed. Copy each link and send it yourself.",
  );
  assert.equal(
    mailWords(["imran@northwind.example"], null, 1),
    "Emailed to imran@northwind.example. The link below works too.",
  );
  assert.equal(mailWords([], null, 2), "Copy each link and send it to the person it is for.");
  assert.equal(sentOf({ ok: true }), null);
});

test("a remind answers with one link and no envelope id", () => {
  const s = sentOf(
    { link: { index: 1, name: "Andrea Lindahl", path: "/p/sign/zzz/" }, emailed: false },
    "https://x.vyre.run",
  );
  assert.equal(s?.id, null);
  assert.equal(s?.links[0]?.url, "https://x.vyre.run/p/sign/zzz/");
});

test("a PDF can be sent", () => {
  assert.equal(canSignFile("Northwind NDA.pdf"), true);
  assert.equal(canSignFile("notes.txt"), false);
});

test("a request that finishes while it is open says so once; nothing else does", () => {
  const open = envelopeOf({ envelopeId: "env_1", title: "Northwind NDA.pdf", status: "sent" })!;
  const signed = envelopeOf({ envelopeId: "env_1", title: "Northwind NDA.pdf", status: "signed" })!;
  const declined = envelopeOf({
    envelopeId: "env_1",
    title: "Northwind NDA.pdf",
    status: "declined",
    signers: [{ name: "Andrea Lindahl", status: "declined" }],
  })!;
  assert.equal(changeWords(open, signed), "Northwind NDA was signed");
  assert.equal(changeWords(open, declined), "Andrea declined Northwind NDA");
  assert.equal(changeWords(signed, signed), null, "already over");
  assert.equal(changeWords(null, signed), null, "first read");
  assert.equal(changeWords(open, open), null);
});
