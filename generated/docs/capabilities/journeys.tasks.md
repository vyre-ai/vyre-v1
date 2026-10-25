# journeys.tasks

The tasks of one Journey record by stage, each with its state (todo, in review, blocked, done)

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/tasks |
| MCP tool | journeys_tasks (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordId: string;
  stage?: string;
};
```

## Output

```ts
type Out = {
  tasks: Array<{
      stage: string;
      taskKey: string;
      taskId: string;
      title: string;
      state: "todo" | "in_review" | "blocked" | "done";
      required: boolean;
      assigned?: {
        kind: "person" | "agent" | "group" | "role" | "automation";
        id: string;
      };
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
    "recordId": "rec_a1b2c3",
    "stage": "intake"
  },
  "output": {
    "tasks": [
      {
        "assigned": {
          "id": "usr_a1b2c3",
          "kind": "person"
        },
        "required": true,
        "stage": "intake",
        "state": "todo",
        "taskId": "tsk_a1b2c3",
        "taskKey": "example",
        "title": "example"
      }
    ]
  }
}
```
