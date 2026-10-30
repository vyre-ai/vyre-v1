# automations.connector.send

Run a connector action that changes something in the app, as a step does. The action must be tested. An agent or a service is held for approval.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/connector/send |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  input?: Record<string, unknown>;
  dryRun?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  output: unknown;
  status: number;
  dryRun: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.network
- provider.rate_limited
- provider.unavailable
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "dryRun": true,
    "idempotencyKey": "idem_1",
    "input": {},
    "key": "example"
  },
  "output": {
    "dryRun": true,
    "output": {},
    "status": 1
  }
}
```
