# ci.sweep

Host only: every 2 minutes, delete any machine tagged vyre-ci that is too old or has no live run, and start queued jobs that now fit

| | |
|---|---|
| Module | ci |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ci/sweep |
| MCP tool | ci_sweep (engineer) |
| CLI | none |
| Emits | ci.run.swept, ci.run.started, ci.run.failed |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  deleted: number;
  started: number;
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
    "deleted": 1,
    "started": 1
  }
}
```
