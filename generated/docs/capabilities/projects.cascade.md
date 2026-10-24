# projects.cascade

Propose the cascade after something slips: which later tasks move and which dates still hold (an agent may call this too)

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/cascade |
| MCP tool | projects_cascade (tasks) |
| CLI | none |
| Emits | project.cascade_proposed |

## Input

```ts
type In = {
  projectId: string;
  taskId: string;
  start?: number;
  due?: number;
};
```

## Output

```ts
type Out = {
  proposalId: string;
  moves: Array<{
      taskId: string;
      fromStart?: number;
      toStart?: number;
      fromDue?: number;
      toDue?: number;
    }>;
  holds: Array<{
      taskId: string;
      reason: string;
    }>;
  summary: string;
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
    "due": 1760000000000,
    "projectId": "prj_a1b2c3",
    "start": 1760000000000,
    "taskId": "tsk_a1b2c3"
  },
  "output": {
    "holds": [
      {
        "reason": "example",
        "taskId": "tsk_a1b2c3"
      }
    ],
    "moves": [
      {
        "fromDue": 1760000000000,
        "fromStart": 1760000000000,
        "taskId": "tsk_a1b2c3",
        "toDue": 1760000000000,
        "toStart": 1760000000000
      }
    ],
    "proposalId": "csc_a1b2c3",
    "summary": "3 later tasks move, the Tuesday consult still holds"
  }
}
```
