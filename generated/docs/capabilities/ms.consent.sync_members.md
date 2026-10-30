# ms.consent.sync_members

Match the people who have joined since setup (by the email their invitation went to) and connect their mail and calendar

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | connection_change when actor.kind != 'person' |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/consent/sync_members |
| MCP tool | ms_consent_sync_members (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  matched: number;
  connected: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.on_hold
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1"
  },
  "output": {
    "connected": 1,
    "matched": 1
  }
}
```
