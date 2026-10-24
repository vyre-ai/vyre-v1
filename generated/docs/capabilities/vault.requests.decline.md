# vault.requests.decline

Decline a key request with a note

| | |
|---|---|
| Module | vault-requests |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/requests/decline |
| MCP tool | vault_requests_decline (vault) |
| CLI | none |
| Emits | vault.request_declined |

## Input

```ts
type In = {
  requestId: string;
  note?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "note": "example",
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
