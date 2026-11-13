# runs.states

System: the status of many Runs at once (up to 200); every id asked gets an answer: its status, or "gone" for a Run that is not there. For the host's sweeps, so a pass over open fires costs one call, not one per fire

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
| HTTP | POST /v1/runs/states |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runIds: Array<string>;
};
```

## Output

```ts
type Out = {
  states: Array<{
      runId: string;
      status: string;
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
    "runIds": [
      "run_a1b2c3"
    ]
  },
  "output": {
    "states": [
      {
        "runId": "run_a1b2c3",
        "status": "example"
      }
    ]
  }
}
```
