# tasks.my_work

My work: the full list, with sections Open, Assigned by me, Done

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/my_work |
| MCP tool | tasks_my_work (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "open" | "assigned_by_me" | "done" | "all";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  tasks: Array<{
      id: string;
      key?: string;
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
      priority?: "urgent" | "high" | "normal" | "low";
      labels?: Array<string>;
      start?: number;
      fields?: Record<string, unknown>;
      recur?: {
        every: "day" | "week" | "month";
        n?: number;
      };
      workerThread?: string;
    }>;
  counts: {
    open: number;
    assignedByMe: number;
    done: number;
  };
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "section": "open"
  },
  "output": {
    "counts": {
      "assignedByMe": 1,
      "done": 1,
      "open": 1
    },
    "next": "example",
    "tasks": [
      {
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
        "fields": {},
        "fileIds": [
          "fil_a1b2c3"
        ],
        "followers": [
          "example"
        ],
        "id": "tsk_a1b2c3",
        "key": "VY-123",
        "kind": "work",
        "labels": [
          "example"
        ],
        "parentTaskId": "tsk_a1b2c3",
        "priority": "urgent",
        "recordId": "rec_a1b2c3",
        "recur": {
          "every": "day",
          "n": 1
        },
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
        "start": 1760000000000,
        "state": "todo",
        "summary": "example",
        "takenBy": "usr_a1b2c3",
        "threadId": "thr_a1b2c3",
        "title": "example",
        "updatedAt": 1760000000000,
        "why": "example",
        "workerThread": "thr_a1b2c3",
        "workingNotes": {}
      }
    ],
    "total": 1
  }
}
```
