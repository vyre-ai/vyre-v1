// Inline reducers run in the same transaction as the event append. They mirror status onto tasks_item.
// Consumers are async and none are due yet.

export interface ProjectionDb {
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface TransitionedEvent {
  payload: { taskId: string; to: string };
}

export interface SentBackEvent {
  payload: { taskId: string; reviewLoops: number };
}

export const inline = {
  "task.transitioned"(db: ProjectionDb, event: TransitionedEvent, at: number): void {
    db.run(
      "UPDATE tasks_item SET state = ?, updated_at = ?, doc = json_set(doc, '$.state', ?) WHERE id = ?",
      event.payload.to,
      at,
      event.payload.to,
      event.payload.taskId,
    );
  },
  "task.sent_back"(db: ProjectionDb, event: SentBackEvent, at: number): void {
    db.run(
      "UPDATE tasks_item SET state = ?, updated_at = ?, doc = json_set(doc, '$.state', ?, '$.reviewLoops', ?) WHERE id = ?",
      "doing",
      at,
      "doing",
      event.payload.reviewLoops,
      event.payload.taskId,
    );
  },
};

export const consumers = {};

export const projections = { inline, consumers };
