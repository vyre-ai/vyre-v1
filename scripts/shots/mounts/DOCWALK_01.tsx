// Mount for lane r42-docs: the record page's Files tab with New document live. The record page is P-L9d_04's (Elena Rivera, ?tab=files); the signing door it needs is answered here with the documents and esign
// answers the real server gives for a Vyre document template, so the walk clicks through New document, the template, the fields, Make, Send for signature and the sent state in the real components.
import type { ReactNode } from "react";
import Records from "./P-L9d_04.tsx";
import { SignDataProvider } from "../../../apps/app/src/places/files/sign/data.tsx";
import type { SignData } from "../../../apps/app/src/places/files/sign/data.tsx";

export const title = "New document on a record";

const FIELDS = [
  { name: "firm.name", kind: "text", required: true },
  { name: "client.name", kind: "text", required: true },
  { name: "matter.fee", kind: "money", required: true },
  { name: "signing_date", kind: "date", required: true },
];
const LINES = [
  "Service agreement",
  "This agreement is between Northwind Traders and ______, dated 19 November 2026.",
  "The fee is ______ for the first year.",
];

const door: SignData = {
  call: async (cap, input) => {
    const i = (input ?? {}) as Record<string, unknown>;
    switch (cap) {
      case "documents.templates.list":
        return {
          templates: [
            { fileId: "fil_a", name: "Service agreement.md", fields: 4, recordType: "clients" },
            { fileId: "fil_b", name: "Mutual NDA.docx", fields: 3 },
          ],
        };
      case "documents.fields":
        return { fields: FIELDS, loops: [], problems: [], signers: ["client", "firm"] };
      case "documents.preview_fill": {
        const v = (i.values ?? {}) as { client?: { name?: string }; matter?: { fee?: number } };
        const missing = [...(v.client?.name ? [] : ["client.name"]), ...(v.matter?.fee ? [] : ["matter.fee"])];
        const name = v.client?.name ?? "______";
        return {
          excerpt: [
            { text: LINES[0], filled: [] },
            { text: LINES[1]!.replace("______", name), filled: [{ from: 28, to: 45, field: "firm.name" }] },
            { text: LINES[2]!, filled: [] },
          ],
          missing,
          unused: [],
        };
      }
      case "projects.files_folder":
        return { folderId: "fld_1" };
      case "documents.fill":
        return {
          file: { fileId: "fil_9", name: "Service agreement - Rivera.pdf", versionId: "ver_1" },
          missing: [],
          unused: [],
          signers: ["client", "firm"],
        };
      case "esign.send":
        return {
          envelopeId: "env_1",
          links: [
            {
              index: 0,
              name: "Elena Rivera",
              email: "elena@northwind.example",
              path: "/p/sign/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/",
            },
            { index: 1, name: "Imran Ibarra", path: "/p/sign/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/" },
          ],
          notice:
            "This Space has no sending mailbox yet, so nothing was emailed. Copy each link and send it to the person it is for.",
        };
      case "esign.list":
        return { envelopes: [] };
      default:
        return {};
    }
  },
  clock: () => ({ now: Date.UTC(2026, 10, 19, 12), offsetMin: 0 }),
  openFile: () => undefined,
};

export default function Mount(): ReactNode {
  return (
    <SignDataProvider value={door}>
      <Records />
    </SignDataProvider>
  );
}
