# tasks.transition

Move a task to a new status (the only writer of status); checks the 4.7 state table and the reviewer/approver rules

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | task (/taskId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/transition |
| MCP tool | tasks_transition (tasks) |
| CLI | none |
| Emits | task.transitioned, task.completed, task.sent_back, task.approved, task.rejected, task.updated |

## Input

```ts
type In = {
  taskId: string;
  to: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
  note?: string;
  expectedFrom?: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
};
```

## Output

```ts
type Out = {
  task: {
    id: string;
    kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
    title: string;
    summary?: string;
    why?: string;
    state: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
    blocked: boolean;
    blocks: Array<{
        type: string;
        v?: number;
        data: unknown;
      }>;
    actions: Array<{
        key: string;
        label: string;
        note?: "required" | "optional";
      }>;
    assigned: {
      kind: "person" | "agent" | "group" | "role" | "automation";
      id: string;
    };
    reviewer?: {
      kind: "person" | "agent" | "group" | "role" | "automation";
      id: string;
    };
    approver?: {
      kind: "person" | "agent" | "group" | "role" | "automation";
      id: string;
    };
    takenBy?: string;
    due?: number;
    effort?: number;
    recordId?: string;
    fileIds: Array<string>;
    source?: {
      kind: "chat" | "run" | "gate" | "journey" | "manual";
      id: string;
    };
    parentTaskId?: string;
    dependsOn: Array<string>;
    followers: Array<string>;
    workingNotes: Record<string, string>;
    threadId?: string;
    reviewLoops: number;
    snoozedUntil?: number;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.field_locked
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "expectedFrom": "todo",
    "note": "example",
    "taskId": "tsk_a1b2c3",
    "to": "todo"
  },
  "output": {
    "task": {
      "actions": [
        {
          "key": "approve",
          "label": "Approve",
          "note": "required"
        }
      ],
      "approver": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "assigned": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "blocked": true,
      "blocks": [
        {
          "data": {},
          "type": "record_card",
          "v": 1
        }
      ],
      "createdAt": 1760000000000,
      "createdBy": "example",
      "dependsOn": [
        "tsk_a1b2c3"
      ],
      "due": 1760000000000,
      "effort": 1,
      "fileIds": [
        "fil_a1b2c3"
      ],
      "followers": [
        "example"
      ],
      "id": "tsk_a1b2c3",
      "kind": "work",
      "parentTaskId": "tsk_a1b2c3",
      "recordId": "rec_a1b2c3",
      "reviewLoops": 1,
      "reviewer": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "snoozedUntil": 1760000000000,
      "source": {
        "id": "run_a1b2c3",
        "kind": "chat"
      },
      "state": "todo",
      "summary": "example",
      "takenBy": "usr_a1b2c3",
      "threadId": "thr_a1b2c3",
      "title": "example",
      "updatedAt": 1760000000000,
      "why": "example",
      "workingNotes": {}
    }
  }
}
```
