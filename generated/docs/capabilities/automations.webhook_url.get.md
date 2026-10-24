# automations.webhook_url.get

The inbound webhook URL of an Automation that has a webhook trigger

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/automations/webhook_url/get |
| MCP tool | automations_webhook_url_get (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
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
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "automationId": "aut_a1b2c3"
  },
  "output": {
    "method": "POST",
    "url": "example"
  }
}
```
