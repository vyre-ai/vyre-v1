# mail.delivery.retry

Scheduled by Vyre after a soft bounce: send the message again to the one address that bounced, once per attempt, never to a suppressed address

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | entity (/messageId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/delivery/retry |
| MCP tool | none |
| CLI | none |
| Emits | message.bounced, message.delivered |

## Input

```ts
type In = {
  messageId: string;
  address: string;
  attempt: number;
};
```

## Output

```ts
type Out = {
  outcome: "sent" | "skipped" | "gave_up" | "rescheduled";
  messageId?: string;
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
    "address": "example",
    "attempt": 1,
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "messageId": "eml_a1b2c3",
    "outcome": "sent"
  }
}
```
