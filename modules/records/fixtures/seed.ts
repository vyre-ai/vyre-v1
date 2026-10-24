// records: type fixtures for the write tests. The small recipe can import this seed later.
// Field kinds stay inside the kernel value checker. merge and write_once are records-module rules.

export const seed = {
  table: "records_row_meta",
  rows: [] as { type: string; id: string; holds: number }[],
};

export const ITEM = Object.freeze({
  name: "item",
  label: "Item",
  fields: [
    { name: "name", kind: "text", label: "Name", required: true },
    { name: "qty", kind: "number", label: "Qty" },
    { name: "status", kind: "choice", label: "Status", options: ["open", "closed", "done"], merge: "assistant" },
    { name: "code", kind: "text", label: "Code", write_once: true },
    { name: "note", kind: "text", label: "Note", protected: true },
  ],
});

/** A protected type: rows cannot be deleted and the type cannot be dropped. */
export const LEDGER = Object.freeze({
  name: "ledger",
  label: "Ledger",
  protected: true,
  fields: [{ name: "name", kind: "text", label: "Name", required: true }],
});

export const PERSON = Object.freeze({
  name: "person",
  label: "Person",
  fields: [
    { name: "name", kind: "text", label: "Name", required: true },
    { name: "ssn", kind: "sealed", label: "SSN" },
  ],
});
