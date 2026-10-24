# home.routines_today

Today's routines of my agents: scheduled, running, done or failed, one line each

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
| HTTP | POST /v1/home/routines_today |
| MCP tool | home_routines_today (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  routines: Array<{
      agentId: string;
      routineId: string;
      title: string;
      at: number;
      state: "scheduled" | "running" | "done" | "failed";
      runId?: string;
      resultLine?: string;
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
  "input": {},
  "output": {
    "routines": [
      {
        "agentId": "agt_a1b2c3",
        "at": 1760000000000,
        "resultLine": "example",
        "routineId": "example",
        "runId": "run_a1b2c3",
        "state": "scheduled",
        "title": "example"
      }
    ]
  }
}
```
