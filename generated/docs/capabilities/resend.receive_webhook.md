# resend.receive_webhook

Record a verified Resend delivery event after dedupe and apply it with mail.status_update

| | |
|---|---|
| Module | resend |
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
| HTTP | POST /v1/resend/receive_webhook |
| MCP tool | none |
| CLI | none |
| Emits | resend.event_received |

## Input

```ts
type In = {
  eventId: string;
  type: "sent" | "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed" | "delayed";
  providerId: string;
  address?: string;
  bounceKind?: "hard" | "soft";
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
    "bounceKind": "hard",
    "eventId": "example",
    "providerId": "example",
    "reason": "example",
    "type": "sent",
    "url": "example"
  },
  "output": {
    "accepted": true
  }
}
```
