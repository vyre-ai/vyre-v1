# mailgun.receive_inbound

Record a verified inbound route delivery after dedupe and land it with mail.ingest

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mailgun/receive_inbound |
| MCP tool | none |
| CLI | none |
| Emits | mailgun.inbound_received |

## Input

```ts
type In = {
  messageId: string;
  recipient: string;
  sender: string;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
  mailMessageId?: string;
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
    "messageId": "example",
    "recipient": "example",
    "sender": "example"
  },
  "output": {
    "accepted": true,
    "mailMessageId": "eml_a1b2c3"
  }
}
```
