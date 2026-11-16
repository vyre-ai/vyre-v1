# esign.cancel

Cancel an envelope; every signer link stops

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.shared_send |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | signature_send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/esign/cancel |
| MCP tool | esign_cancel (files) |
| CLI | none |
| Emits | signature.cancelled |

## Input

```ts
type In = {
  envelopeId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  cancelled: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "envelopeId": "env_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "cancelled": true
  }
}
```
