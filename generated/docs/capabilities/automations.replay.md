# automations.replay

Run a past run again on the same definition version or the current one

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/replay |
| MCP tool | automations_replay (automations) |
| CLI | none |
| Emits | automation.run_started |

## Input

```ts
type In = {
  automationId: string;
  runId: string;
  version: "same" | "current";
};
```

## Output

```ts
type Out = {
  runId: string;
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
    "automationId": "aut_a1b2c3",
    "runId": "run_a1b2c3",
    "version": "same"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
