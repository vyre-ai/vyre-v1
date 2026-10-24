// logs: rows for the seeded Space. Ids and a template key only.
export const seed = {
  table: "logs_row",
  rows: [
    {
      id: 1,
      at: 1760000000000,
      level: 20,
      space: "spc_seed",
      trace_id: "0123456789abcdef0123456789abcdef",
      actor: "usr_seed",
      on_behalf: "usr_seed",
      cap: "logs.query",
      entity: "record",
      entity_id: "rec_seed",
      result: "ok",
      dur_ms: 1,
      cost_micros: 0,
      msg: "cap.ok",
      attrs: "{\"n\":1}",
    },
  ],
};
