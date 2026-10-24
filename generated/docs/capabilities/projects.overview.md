# projects.overview

The Overview: brief and goal, status with its update, next three milestones, what is late or waiting, recent decisions, people, linked records, pinned files, recent threads

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/overview |
| MCP tool | projects_overview (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
};
```

## Output

```ts
type Out = {
  project: {
    projectId: string;
    recordId: string;
    type: string;
    title: string;
    summary?: string;
    status: string;
    lead?: string;
    start?: number;
    due?: number;
    channelId: string;
    folderId: string;
    memberCount: number;
    openTasks: number;
    lateTasks: number;
  };
  goal?: string;
  statusUpdate?: {
    text: string;
    at: number;
    by: string;
    drafted: boolean;
  };
  milestones: Array<{
      taskId: string;
      title: string;
      stage?: string;
      start?: number;
      due?: number;
      milestone: boolean;
      status: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
      assigned?: string;
      reviewer?: string;
      approver?: string;
      ring?: "review" | "approval";
      threadId?: string;
      order?: number;
    }>;
  late: Array<{
      taskId: string;
      title: string;
      stage?: string;
      start?: number;
      due?: number;
      milestone: boolean;
      status: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
      assigned?: string;
      reviewer?: string;
      approver?: string;
      ring?: "review" | "approval";
      threadId?: string;
      order?: number;
    }>;
  waiting: Array<{
      taskId: string;
      title: string;
      stage?: string;
      start?: number;
      due?: number;
      milestone: boolean;
      status: "todo" | "doing" | "in_review" | "awaiting_approval" | "done" | "canceled";
      assigned?: string;
      reviewer?: string;
      approver?: string;
      ring?: "review" | "approval";
      threadId?: string;
      order?: number;
    }>;
  decisions: Array<{
      decisionId: string;
      summary: string;
      at: number;
    }>;
  people: Array<{
      principal: string;
      role: "lead" | "member" | "reviewer" | "guest";
      kind: "person" | "agent" | "group";
      since: number;
    }>;
  linked: Array<{
      type: string;
      recordId: string;
      title: string;
    }>;
  pinnedFiles: Array<string>;
  recentThreads: Array<{
      threadId: string;
      title: string;
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "projectId": "prj_a1b2c3"
  },
  "output": {
    "decisions": [
      {
        "at": 1760000000000,
        "decisionId": "dec_a1b2c3",
        "summary": "example"
      }
    ],
    "goal": "example",
    "late": [
      {
        "approver": "usr_a1b2c3",
        "assigned": "usr_a1b2c3",
        "due": 1760000000000,
        "milestone": true,
        "order": 1,
        "reviewer": "usr_a1b2c3",
        "ring": "review",
        "stage": "draft",
        "start": 1760000000000,
        "status": "todo",
        "taskId": "tsk_a1b2c3",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ],
    "linked": [
      {
        "recordId": "rec_a1b2c3",
        "title": "example",
        "type": "contact"
      }
    ],
    "milestones": [
      {
        "approver": "usr_a1b2c3",
        "assigned": "usr_a1b2c3",
        "due": 1760000000000,
        "milestone": true,
        "order": 1,
        "reviewer": "usr_a1b2c3",
        "ring": "review",
        "stage": "draft",
        "start": 1760000000000,
        "status": "todo",
        "taskId": "tsk_a1b2c3",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ],
    "people": [
      {
        "kind": "person",
        "principal": "usr_a1b2c3",
        "role": "lead",
        "since": 1760000000000
      }
    ],
    "pinnedFiles": [
      "fil_a1b2c3"
    ],
    "project": {
      "channelId": "chn_a1b2c3",
      "due": 1760000000000,
      "folderId": "fld_a1b2c3",
      "lateTasks": 1,
      "lead": "usr_a1b2c3",
      "memberCount": 1,
      "openTasks": 1,
      "projectId": "prj_a1b2c3",
      "recordId": "rec_a1b2c3",
      "start": 1760000000000,
      "status": "active",
      "summary": "example",
      "title": "example",
      "type": "contact"
    },
    "recentThreads": [
      {
        "at": 1760000000000,
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ],
    "statusUpdate": {
      "at": 1760000000000,
      "by": "example",
      "drafted": true,
      "text": "example"
    },
    "waiting": [
      {
        "approver": "usr_a1b2c3",
        "assigned": "usr_a1b2c3",
        "due": 1760000000000,
        "milestone": true,
        "order": 1,
        "reviewer": "usr_a1b2c3",
        "ring": "review",
        "stage": "draft",
        "start": 1760000000000,
        "status": "todo",
        "taskId": "tsk_a1b2c3",
        "threadId": "thr_a1b2c3",
        "title": "example"
      }
    ]
  }
}
```
