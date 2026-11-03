# goals.list

Goals by scope: mine, the ones I help with, a project, a record, a task, or all I can see

| | |
|---|---|
| Module | goals |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/goals/list |
| MCP tool | goals_list (tasks) |
| CLI | vyre goals list |
| Emits | none |

## Input

```ts
type In = {
  scope: "mine" | "helping" | "project" | "record" | "task" | "all";
  projectId?: string;
  recordId?: string;
  taskId?: string;
  open?: boolean;
};
```

## Output

```ts
type Out = {
  goals: Array<{
      id: string;
      title: string;
      status: "draft" | "planning" | "active" | "waiting" | "stuck" | "paused" | "done" | "missed" | "stopped";
      statusReason?: string;
      owner: string;
      leadAgentId: string;
      threadId?: string;
      deadline: number;
      nextCheckinAt?: number;
      progress: {
        value?: number;
        target?: number;
        start?: number;
        percent?: number;
        readAt?: number;
        error?: string;
        itemsDone?: number;
        items?: number;
        tasksDone: number;
        tasks: number;
      };
      projectId?: string;
      updatedAt: number;
    }>;
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
    "open": true,
    "projectId": "prj_a1b2c3",
    "recordId": "rec_a1b2c3",
    "scope": "mine",
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "goals": [
      {
        "deadline": 1760000000000,
        "id": "gol_a1b2c3",
        "leadAgentId": "agt_a1b2c3",
        "nextCheckinAt": 1760000000000,
        "owner": "usr_a1b2c3",
        "progress": {
          "error": "example",
          "items": 1,
          "itemsDone": 1,
          "percent": 1,
          "readAt": 1760000000000,
          "start": 1,
          "target": 1,
          "tasks": 1,
          "tasksDone": 1,
          "value": 1
        },
        "projectId": "prj_a1b2c3",
        "status": "draft",
        "statusReason": "example",
        "threadId": "thr_a1b2c3",
        "title": "example",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
