// Rows for the seeded Space. The small recipe imports every module seed by glob.
export const seed = {
  table: 'tasks_meta',
  rows: [
    {
      id: 'tsk_seedwork',
      kind: 'work',
      state: 'todo',
      title: 'Seed work',
      assigned: '{"kind":"person","id":"usr_a1b2c3"}',
      review_loops: 0,
      created_by: 'usr_a1b2c3',
      created_at: 1760000000000,
      updated_at: 1760000000000,
    },
  ],
};
