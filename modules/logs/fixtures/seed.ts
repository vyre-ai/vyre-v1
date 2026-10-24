// Rows for the seeded Space. Ids and counts only; no message content.
export const seed = {
  table: "logs_row",
  rows: [
    {
      id: 1,
      at: 1760000000000,
      level: 20,
      space: "spc_seed",
      trace_id: "0123456789abcdef0123456789abcdef",
      actor: "usr_owner",
      on_behalf: "usr_ana",
      cap: "records.update",
      entity: "record",
      entity_id: "rec_seed",
      result: "ok",
      dur_ms: 4,
      cost_micros: 0,
      label: 1,
      msg: "record.updated",
      attrs: "{\"count\":1}",
    },
  ],
};
