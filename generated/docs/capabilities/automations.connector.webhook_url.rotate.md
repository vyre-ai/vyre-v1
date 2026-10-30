# automations.connector.webhook_url.rotate

Rotate the secret in a connector webhook address; the old address stops working

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/automations/connector/webhook_url/rotate |
| MCP tool | automations_connector_webhook_url_rotate (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app: string;
  trigger: string;
  confirm: true;
};
```

## Output

```ts
type Out = {
  url: string;
  method: "POST";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "app": "stripe",
    "confirm": true,
    "trigger": "list_customers"
  },
  "output": {
    "method": "POST",
    "url": "example"
  }
}
```
