# automations.webhook_url.rotate

Rotate the secret in the webhook URL; the old URL stops working

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | high |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/automations/webhook_url/rotate |
| MCP tool | automations_webhook_url_rotate (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  confirm: true;
};
```

## Output

```ts
type Out = {
  url: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3",
    "confirm": true
  },
  "output": {
    "url": "example"
  }
}
```
