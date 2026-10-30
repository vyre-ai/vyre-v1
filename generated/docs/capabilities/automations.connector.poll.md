# automations.connector.poll

Read a polling trigger now and start the automations waiting for each new item. The first read only records what exists.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/connector/poll |
| MCP tool | automations_connector_poll (automations) |
| CLI | none |
| Emits | app_event.received |

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
  polled: boolean;
  fired: number;
  status?: number;
  reason?: string;
  nextAt?: number;
  more?: boolean;
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
    "app": "stripe",
    "trigger": "list_customers"
  },
  "output": {
    "fired": 1,
    "more": true,
    "nextAt": 1760000000000,
    "polled": true,
    "reason": "example",
    "status": 1
  }
}
```
