# home.at_risk

Projects at risk: overdue, blocked or slipped, with the counting rule

| | |
|---|---|
| Module | home |
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
| HTTP | POST /v1/home/at_risk |
| MCP tool | home_at_risk (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  limit?: number;
};
```

## Output

```ts
type Out = {
  rule: string;
  projects: Array<{
      recordId: string;
      type: string;
      title: string;
      reasons: Array<"overdue" | "blocked" | "slipped">;
      dueAt?: number;
      lead?: string;
      blockedTasks: number;
      overdueTasks: number;
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
    "limit": 1
  },
  "output": {
    "projects": [
      {
        "blockedTasks": 1,
        "dueAt": 1760000000000,
        "lead": "example",
        "overdueTasks": 1,
        "reasons": [
          "overdue"
        ],
        "recordId": "rec_a1b2c3",
        "title": "example",
        "type": "contact"
      }
    ],
    "rule": "A project is at risk when it is overdue, has a blocked task, or its plan has slipped past a milestone"
  }
}
```
