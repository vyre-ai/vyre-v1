# vault.connect_card.line

What anyone in the chat may read of a connect card: that a connection was asked of someone, and whether it was connected or not. The service, who asked and whom, and the state; nothing of keys or choices

| | |
|---|---|
| Module | vault-requests |
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
| HTTP | POST /v1/vault/connect_card/line |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  state: "asked" | "connected" | "declined";
  service: string;
  asker?: string;
  connectedBy?: string;
};
```

## Errors

- internal.not_implemented
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
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "asker": "usr_a1b2c3",
    "connectedBy": "usr_a1b2c3",
    "service": "example",
    "state": "asked"
  }
}
```
