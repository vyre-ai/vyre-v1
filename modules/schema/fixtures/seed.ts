// schema: type definitions the tests start from.
import type { SchemaOp } from "../handlers/index.ts";

/** A small CRM: companies and people, with a title field and a status. */
export const COMPANY: SchemaOp = {
  op: "type.create", type: "acme_company",
  def: { title: "Company", plural: "Companies", icon: "building", titleField: "name", fields: [{ key: "name", type: "text", title: "Name", required: true }, { key: "industry", type: "text", title: "Industry" }] },
};
export const PERSON: SchemaOp = {
  op: "type.create", type: "acme_person",
  def: {
    title: "Person", plural: "People", icon: "user", titleField: "name", statusField: "stage",
    fields: [
      { key: "name", type: "text", title: "Name", required: true },
      { key: "email", type: "email", title: "Email" },
      { key: "age", type: "text", title: "Age" },
      { key: "stage", type: "status", title: "Stage", options: { stages: [{ key: "new", title: "New" }, { key: "won", title: "Won" }] } },
      { key: "notes", type: "longtext", title: "Notes" },
    ],
  },
};
