# mail.setup.test_send

Send one short test email to an address you type, from an address on the default verified domain. It goes through mail.send, so limits, suppression and the Gate apply

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.domains |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mail/setup/test_send |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  to: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  messageId?: string;
  status: "queued" | "sent" | "held" | "suppressed";
  from: string;
  note?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "to": "maya@example.com"
  },
  "output": {
    "from": "maya@example.com",
    "messageId": "eml_a1b2c3",
    "note": "example",
    "status": "queued"
  }
}
```
