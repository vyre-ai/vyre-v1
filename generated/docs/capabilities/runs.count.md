# runs.count

Count Runs by status for badges (failed runs in Needs you, running now)

| | |
|---|---|
| Module | runs |
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
| HTTP | POST /v1/runs/count |
| MCP tool | runs_count (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  scope: "mine" | "all";
  statuses?: Array<"queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped">;
};
```

## Output

```ts
type Out = {
  count: number;
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
    "scope": "mine",
    "statuses": [
      "queued"
    ]
  },
  "output": {
    "count": 1
  }
}
```
