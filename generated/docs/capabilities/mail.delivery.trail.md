# mail.delivery.trail

What happened to a sent message: sent, delivered, opened, bounced and why, retries, and any address that is now blocked

| | |
|---|---|
| Module | mail |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | entity (/messageId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mail/delivery/trail |
| MCP tool | mail_delivery_trail (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  messageId: string;
};
```

## Output

```ts
type Out = {
  messageId: string;
  state: "waiting" | "sent" | "delivered" | "retrying" | "bounced" | "complained" | "failed";
  events: Array<{
      kind: "queued" | "held" | "sent" | "delivered" | "opened" | "clicked" | "soft_bounced" | "bounced" | "complained" | "failed" | "retry_scheduled" | "retried" | "gave_up";
      at: number;
      label: string;
      address?: string;
      detail?: string;
    }>;
  blocked: Array<{
      address: string;
      reason: string;
    }>;
  retry?: {
    address: string;
    attempt: number;
    of: number;
    nextAt?: number;
  };
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
    "messageId": "eml_a1b2c3"
  },
  "output": {
    "blocked": [
      {
        "address": "example",
        "reason": "example"
      }
    ],
    "events": [
      {
        "address": "example",
        "at": 1760000000000,
        "detail": "example",
        "kind": "queued",
        "label": "example"
      }
    ],
    "messageId": "eml_a1b2c3",
    "retry": {
      "address": "example",
      "attempt": 1,
      "nextAt": 1760000000000,
      "of": 1
    },
    "state": "waiting"
  }
}
```
