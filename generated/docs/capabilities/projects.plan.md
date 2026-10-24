# projects.plan

The plan: stages, tasks, milestones, dependency links and a today marker; one payload for Timeline, Board, List and Calendar

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
| HTTP | POST /v1/projects/plan |
| MCP tool | projects_plan (tasks) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  projectId: string;
  stage?: string;
  assigned?: string;
};
```

## Output

```ts
type Out = {
  stages: Array<{
      key: string;
      title: string;
      order: number;
    }>;
  tasks: Array<{
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
  links: Array<{
      from: string;
      to: string;
    }>;
  today: number;
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
    "assigned": "usr_a1b2c3",
    "projectId": "prj_a1b2c3",
    "stage": "draft"
  },
  "output": {
    "links": [
      {
        "from": "tsk_a1b2c3",
        "to": "tsk_a1b2c3"
      }
    ],
    "stages": [
      {
        "key": "draft",
        "order": 1,
        "title": "example"
      }
    ],
    "tasks": [
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
    "today": 1760000000000
  }
}
```
