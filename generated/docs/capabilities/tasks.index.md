# tasks.index

The long list of a scope in one read: a light row per task with its rollup, ordered newest first; pass the last rev and an unchanged list answers nothing

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
| HTTP | POST /v1/tasks/index |
| MCP tool | tasks_index (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "mine" | "given" | "everyone";
  recordId?: string;
  parentTaskId?: string;
  done?: boolean;
  rev?: string;
};
```

## Output

```ts
type Out = {
  rev: string;
  unchanged: boolean;
  rows: Array<{
      id: string;
      key?: string;
      kind: "work" | "approve" | "review" | "answer" | "unblock" | "signature";
      title: string;
      state: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
      blocked: boolean;
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
      start?: number;
      effort?: number;
      priority?: "urgent" | "high" | "normal" | "low";
      labels: Array<string>;
      recordId?: string;
      parentTaskId?: string;
      dependsOn: Array<string>;
      threadId?: string;
      workerThread?: string;
      source?: {
        kind: "chat" | "run" | "gate" | "journey" | "manual";
        id: string;
      };
      snoozedUntil?: number;
      children?: {
        total: number;
        done: number;
      };
      createdBy: string;
      createdAt: number;
      updatedAt: number;
    }>;
  doneThisWeek: number;
  total: number;
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
    "done": true,
    "parentTaskId": "tsk_a1b2c3",
    "recordId": "rec_a1b2c3",
    "rev": "example",
    "scope": "mine"
  },
  "output": {
    "doneThisWeek": 1,
    "rev": "example",
    "rows": [
      {
        "approver": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "assigned": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "blocked": true,
        "children": {
          "done": 1,
          "total": 1
        },
        "createdAt": 1760000000000,
        "createdBy": "example",
        "dependsOn": [
          "tsk_a1b2c3"
        ],
        "due": 1760000000000,
        "effort": 1,
        "id": "tsk_a1b2c3",
        "key": "example",
        "kind": "work",
        "labels": [
          "example"
        ],
        "parentTaskId": "tsk_a1b2c3",
        "priority": "urgent",
        "recordId": "rec_a1b2c3",
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
        "takenBy": "example",
        "threadId": "thr_a1b2c3",
        "title": "example",
        "updatedAt": 1760000000000,
        "workerThread": "thr_a1b2c3"
      }
    ],
    "total": 1,
    "unchanged": true
  }
}
```
