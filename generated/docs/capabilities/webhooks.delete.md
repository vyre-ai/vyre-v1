# webhooks.delete

Delete a webhook; pending deliveries are dropped

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/webhooks/delete |
| MCP tool | webhooks_delete (engineer) |
| CLI | none |
| Emits | webhook.deleted |

## Input

```ts
type In = {
  webhookId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "webhookId": "whk_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
