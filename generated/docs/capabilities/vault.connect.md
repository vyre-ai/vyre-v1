# vault.connect

Is X connected, connect X (Fathom, Slack), or before saying you cannot reach X. The person gets one card; you get connected, waiting or declined.

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
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/connect |
| MCP tool | vault_connect (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  service: string;
  reason?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  status: "connected" | "waiting_person" | "waiting_admin" | "declined" | "no_connector";
  requestId?: string;
  tell: string;
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
    "idempotencyKey": "idem_1",
    "reason": "example",
    "service": "Fathom"
  },
  "output": {
    "requestId": "vrq_a1b2c3",
    "status": "connected",
    "tell": "example"
  }
}
```
