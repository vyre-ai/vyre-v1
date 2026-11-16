// esign (lane L8): one Signature step and task kind over providers behind one interface (spec 3.6 b19, ARCH 8.4).
import { defineManifest, ev, health, outward, read, rtype, field, t, write } from "../packages/contracts/src/index.ts";
import { id } from "./_common.ts";

const envelopeId = t.id("env");
const provider = t.enm("vyre", "documenso", "dropbox_sign", "docusign");
const status = t.enm("sent", "viewed", "signed", "declined", "cancelled", "expired");
const signer = t.obj({ name: t.str(), email: t.opt(t.str()), order: t.opt(t.int()) });
const link = t.obj({ index: t.int(), name: t.str(), email: t.opt(t.str()), url: t.opt(t.str()), path: t.opt(t.str()) });
const visitor = t.obj({ ip: t.opt(t.str()), ua: t.opt(t.str()) });

export default defineManifest({
  id: "esign",
  title: "E-signature",
  owner: "L8",
  events: [
    ev("signature.sent", "An envelope was sent for signature", {
      p: { envelopeId, recordId: t.opt(id.record), provider },
      subject: ["entity", "/envelopeId"],
      replay: "stub",
      trigger: { title: "A document is sent for signature" },
    }),
    ev("signature.viewed", "A signer opened the envelope", {
      p: { envelopeId, signer: t.str() },
      subject: ["entity", "/envelopeId"],
    }),
    ev("signature.signed", "All signers signed; the signed PDF and audit certificate were saved as a new version", {
      p: { envelopeId, fileId: id.file },
      subject: ["entity", "/envelopeId"],
      trigger: { title: "A document is signed" },
    }),
    ev("signature.cancelled", "The sender cancelled an envelope; every link stopped working", {
      p: { envelopeId },
      subject: ["entity", "/envelopeId"],
    }),
    ev("signature.declined", "A signer declined", {
      p: { envelopeId, signer: t.str(), reason: t.opt(t.str()) },
      subject: ["entity", "/envelopeId"],
      trigger: { title: "A signature is declined" },
    }),
  ],
  recordTypes: [
    rtype(
      "envelope",
      "Envelope",
      "Envelopes",
      "signature",
      [
        field("title", "text", "Title", { required: true }),
        field("status", "status", "Status", {
          options: {
            stages: [
              { key: "sent", title: "Sent" },
              { key: "viewed", title: "Viewed" },
              { key: "signed", title: "Signed" },
              { key: "declined", title: "Declined" },
              { key: "cancelled", title: "Cancelled" },
              { key: "expired", title: "Expired" },
            ],
          },
        }),
        field("provider", "choice", "Provider"),
        field("subject", "relation", "Record"),
        field("signed", "files", "Signed PDF"),
      ],
      { system: true, statusField: "status", group: "Documents" },
    ),
  ],
  capabilities: [
    outward(
      "esign.send",
      "Send a PDF for signature; built-in signing returns a link per signer and emails it when the Space can",
      {
        in: {
          fileId: id.file,
          recordId: t.opt(id.record),
          signers: t.arr(signer),
          provider: t.opt(provider),
          message: t.opt(t.str()),
          places: t.opt(t.arr(t.json())),
          expiresInDays: t.opt(t.int()),
        },
        out: {
          envelopeId,
          links: t.opt(t.arr(link)),
          emailed: t.opt(t.arr(t.str())),
          notice: t.opt(t.str()),
        },
        on: ["file", "/fileId"],
        perm: "comms.shared_send",
        gate: "signature_send",
        emits: ["signature.sent"],
        tool: "files",
        team: true,
        run: { kind: "signature", stoppable: true },
      },
    ),
    read("esign.status", "Envelope status and signers", {
      in: { envelopeId },
      out: {
        status,
        expiresAt: t.opt(t.ts()),
        declinedReason: t.opt(t.str()),
        signedFileId: t.opt(id.file),
        finalSha256: t.opt(t.str()),
        sealed: t.opt(t.bool()),
        sealFingerprint: t.opt(t.str()),
        signers: t.arr(
          t.obj({
            name: t.str(),
            email: t.opt(t.str()),
            status,
            order: t.opt(t.int()),
            openedAt: t.opt(t.ts()),
            signedAt: t.opt(t.ts()),
          }),
        ),
      },
      tool: "files",
    }),
    outward("esign.cancel", "Cancel an envelope; every signer link stops", {
      in: { envelopeId },
      out: { cancelled: t.bool() },
      perm: "comms.shared_send",
      gate: "signature_send",
      emits: ["signature.cancelled"],
      tool: "files",
      team: true,
    }),
    write("esign.fetch_signed", "Save the signed PDF to Files", {
      in: { envelopeId },
      out: { fileId: id.file },
      emits: ["signature.signed"],
      tool: "files",
    }),
    outward("esign.remind", "New link for a signer; the old one stops", {
      in: { envelopeId, signer: t.int() },
      out: { link: t.opt(link), emailed: t.bool(), notice: t.opt(t.str()) },
      perm: "comms.shared_send",
      gate: "signature_send",
      team: true,
    }),
    read("esign.verify", "Is this file sealed, unchanged since, and sealed by this Space", {
      in: { fileId: id.file },
      out: {
        sealed: t.bool(),
        intact: t.bool(),
        signedAt: t.opt(t.ts()),
        fingerprint: t.opt(t.str()),
        bySpace: t.bool(),
      },
      on: ["file", "/fileId"],
    }),
    read("esign.list", "List envelopes", {
      in: { recordId: t.opt(id.record), fileId: t.opt(id.file), status: t.opt(t.str()) },
      out: {
        envelopes: t.arr(
          t.obj({
            envelopeId,
            title: t.str(),
            status,
            provider,
            recordId: t.opt(id.record),
            fileId: id.file,
            signedFileId: t.opt(id.file),
            createdAt: t.ts(),
            expiresAt: t.opt(t.ts()),
          }),
        ),
      },
      tool: "files",
    }),
    read("esign.providers", "Signing services and the default", {
      out: {
        providers: t.arr(
          t.obj({ key: provider, title: t.str(), default: t.bool(), connected: t.bool(), why: t.opt(t.str()) }),
        ),
      },
      tool: "files",
    }),
    write("esign.provider_set", "Choose the default provider; Automations do not change", {
      in: { provider },
      out: { ok: t.bool() },
      perm: "connectors.manage",
      level: "manage",
      tool: "files",
    }),
    write("esign.hook", "Inbound provider webhook: sent, viewed, signed, declined", {
      in: { provider, payload: t.json() },
      out: { ok: t.bool() },
      emits: ["signature.viewed", "signature.signed", "signature.declined"],
      http: { method: "POST", path: "/hooks/esign" },
      team: true,
    }),
    read("esign.health", "Probe: the default signing service is ready (built-in signing always is)", {
      out: { state: t.enm("healthy", "degraded", "down"), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) },
    }),
    // The three public calls behind /p/sign/<token>/. The token is the credential; the host runs them as itself, like forms.submit. No tool: an agent never signs for a person.
    write("esign.signer_view", "Public: open a signing link. Records the open and returns what the signer sees", {
      in: { token: t.str(), visitor },
      out: { session: t.json() },
      emits: ["signature.viewed"],
      team: true,
      errors: ["auth.bad_credentials"],
    }),
    read("esign.signer_doc", "Public: the PDF a signer signs, for a live link only", {
      in: { token: t.str(), visitor },
      out: { base64: t.str() },
      team: true,
      errors: ["auth.bad_credentials"],
    }),
    write("esign.signer_act", "Public: sign, decline or take a copy, by a signing link", {
      in: { token: t.str(), visitor, op: t.enm("sign", "decline", "copy"), body: t.opt(t.json()) },
      out: { result: t.json() },
      emits: ["signature.signed", "signature.declined"],
      team: true,
      errors: ["auth.bad_credentials", "validation.bad_input"],
    }),
  ],
  health: [
    health(
      "esign.documenso",
      "Signing ready",
      "esign.health",
      "Connect the default signing service again in Settings, Connections, or choose built-in signing.",
      { pauses: ["automations"] },
    ),
  ],
});
