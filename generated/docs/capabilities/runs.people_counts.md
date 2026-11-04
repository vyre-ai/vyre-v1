# runs.people_counts

How many Runs each person's own agents have, counted and never listed: an admin sees the number, not the work

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | runs.manage |
| Grant level | manage |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/people_counts |
| MCP tool | runs_people_counts (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  statuses?: Array<"queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped">;
};
```

## Output

```ts
type Out = {
  people: Array<{
      person: string;
      runs: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "statuses": [
      "queued"
    ]
  },
  "output": {
    "people": [
      {
        "person": "example",
        "runs": 1
      }
    ]
  }
}
```
