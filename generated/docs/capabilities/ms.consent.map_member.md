# ms.consent.map_member

Match a Microsoft address to a person in the Space (or, with no person, take the match away), so their mail, calendar and Teams come in

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
| HTTP | POST /v1/ms/consent/map_member |
| MCP tool | ms_consent_map_member (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  email: string;
  userId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  email: string;
  userId?: string;
  mapped: boolean;
  connected: boolean;
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
    "email": "maya@example.com",
    "idempotencyKey": "idem_1",
    "userId": "usr_a1b2c3"
  },
  "output": {
    "connected": true,
    "email": "maya@example.com",
    "mapped": true,
    "userId": "usr_a1b2c3"
  }
}
```
