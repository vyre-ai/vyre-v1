# mail.status_update

Apply a provider status (delivered, bounced, complained, opened, clicked, failed); hard bounces and complaints write the suppression list

| | |
|---|---|
| Module | mail |
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
| HTTP | POST /v1/mail/status_update |
| MCP tool | none |
| CLI | none |
| Emits | message.delivered, message.bounced, message.complained, message.opened, message.clicked, message.failed |

## Input

```ts
type In = {
  providerId: string;
  status: "delivered" | "bounced" | "complained" | "opened" | "clicked" | "failed";
  kind?: "hard" | "soft";
  reason?: string;
  address?: string;
  url?: string;
  at: number;
};
```

## Output

```ts
type Out = {
  messageId?: string;
  suppressed: boolean;
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
    "kind": "hard",
    "providerId": "example",
    "reason": "example",
    "status": "delivered",
    "url": "example"
  },
  "output": {
    "messageId": "eml_a1b2c3",
    "suppressed": true
  }
}
```
