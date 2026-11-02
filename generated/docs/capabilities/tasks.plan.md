# tasks.plan

Break work into tasks in one step: a parent (new, or one that exists) and its children, each with its brief, what done means, who does it and which others it waits on. A child starts by itself when what it waits on is done; the parent hears only when all are done, or one is blocked or asks

| | |
|---|---|
| Module | tasks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | task (create under /parent/recordId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/tasks/plan |
| MCP tool | task_plan (tasks) |
| CLI | none |
| Emits | task.created, task.assigned, task.updated |

## Input

```ts
type In = {
  parentTaskId?: string;
  parent?: {
    title: string;
    brief?: string;
    doneMeans?: Array<string>;
    assigned?: {
      kind: "person" | "agent" | "group" | "role" | "automation";
      id: string;
    };
    recordId?: string;
    due?: number;
  };
  children: Array<{
      key: string;
      title: string;
      brief?: string;
      doneMeans?: Array<string>;
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
      dependsOn?: Array<string>;
      due?: number;
      priority?: "urgent" | "high" | "normal" | "low";
      worker?: "thread" | "crew";
      projectId?: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  parent: {
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
  };
  children: Array<{
      key: string;
      taskId: string;
      shortKey?: string;
      created: boolean;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "children": [
      {
        "approver": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "assigned": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "brief": "example",
        "dependsOn": [
          "example"
        ],
        "doneMeans": [
          "example"
        ],
        "due": 1760000000000,
        "key": "draft",
        "priority": "urgent",
        "projectId": "prj_a1b2c3",
        "reviewer": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "title": "example",
        "worker": "thread"
      }
    ],
    "idempotencyKey": "idem_1",
    "parent": {
      "assigned": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "brief": "example",
      "doneMeans": [
        "example"
      ],
      "due": 1760000000000,
      "recordId": "rec_a1b2c3",
      "title": "example"
    },
    "parentTaskId": "tsk_a1b2c3"
  },
  "output": {
    "children": [
      {
        "created": true,
        "key": "example",
        "shortKey": "example",
        "taskId": "tsk_a1b2c3"
      }
    ],
    "parent": {
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
  }
}
```
