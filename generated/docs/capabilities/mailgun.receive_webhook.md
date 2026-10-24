# mailgun.receive_webhook

Record a verified Mailgun delivery event after dedupe and apply it with mail.status_update

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
| HTTP | POST /v1/mailgun/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | mailgun.event_received |

## Input

```ts
type In = {
  eventId: string;
  event: "accepted" | "delivered" | "failed" | "opened" | "clicked" | "complained" | "unsubscribed";
  providerId: string;
  address?: string;
  severity?: "permanent" | "temporary";
  reason?: string;
  url?: string;
  at: number;
};
```

## Output

```ts
type Out = {
  accepted: boolean;
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
    "at": 1760000000000,
    "event": "accepted",
    "eventId": "example",
    "providerId": "example",
    "reason": "example",
    "severity": "permanent",
    "url": "example"
  },
  "output": {
    "accepted": true
  }
}
```
