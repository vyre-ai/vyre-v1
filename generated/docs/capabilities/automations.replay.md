# automations.replay

Live rerun of a past run on the same definition version or the current one, not a sandbox replay

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
| Audit | always |
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
  confirm: true;
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
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "confirm": true,
    "runId": "run_a1b2c3",
    "version": "same"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
