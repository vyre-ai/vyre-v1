# automations.connector.webhook_url.get

The address a connector's webhook trigger takes deliveries at

| | |
|---|---|
| Module | automations |
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
| Team Space only | yes |
| HTTP | POST /v1/automations/connector/webhook_url/get |
| MCP tool | automations_connector_webhook_url_get (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  app: string;
  trigger: string;
};
```

## Output

```ts
type Out = {
  url: string;
  method: "POST";
  lastDeliveryAt?: number;
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
    "trigger": "list_customers"
  },
  "output": {
    "lastDeliveryAt": 1760000000000,
    "method": "POST",
    "url": "example"
  }
}
```
