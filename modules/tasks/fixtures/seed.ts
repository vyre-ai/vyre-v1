// tasks: rows for the seeded Space. The small recipe finds this file by glob and does not import it.

export const seed = {
  table: "tasks_item",
  rows: [
    {
      id: "tsk_seed_work",
      kind: "work",
      title: "Draft the brief",
      state: "todo",
      assigned: { kind: "person", id: "usr_ada" },
      createdBy: "usr_ada",
    },
    {
      id: "tsk_seed_approve",
      kind: "approve",
      title: "Approve the launch",
      state: "awaiting_approval",
      assigned: { kind: "agent", id: "agt_worker" },
      approver: { kind: "person", id: "usr_ada" },
      createdBy: "usr_ada",
    },
    {
      id: "tsk_seed_review",
      kind: "review",
      title: "Review the copy",
      state: "in_review",
      assigned: { kind: "person", id: "usr_ada" },
      reviewer: { kind: "person", id: "usr_ben" },
      createdBy: "usr_ada",
    },
  ],
};
