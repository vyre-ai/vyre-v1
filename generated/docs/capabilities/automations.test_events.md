# automations.test_events

Real past starts of an Automation's trigger that a test can be tried on

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/test_events |
| MCP tool | automations_test_events (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  trigger?: string;
};
```

## Output

```ts
type Out = {
  events: Array<{
      runId: string;
      at: number;
      payload: unknown;
    }>;
  sample: Record<string, unknown>;
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
    "trigger": "example"
  },
  "output": {
    "events": [
      {
        "at": 1,
        "payload": {},
        "runId": "run_a1b2c3"
      }
    ],
    "sample": {}
  }
}
```
