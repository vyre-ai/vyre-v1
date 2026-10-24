# mailgun.routes.create

Create a route that forwards inbound mail for an address to /hooks/mail/mailgun

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | comms.domains |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/mailgun/routes/create |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  expression: string;
  priority?: number;
  description?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  route: {
    routeId: string;
    expression: string;
    forwardTo: Array<string>;
    priority: number;
    description?: string;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "description": "example",
    "expression": "match_recipient(\"hello@example.com\")",
    "idempotencyKey": "idem_1",
    "priority": 1
  },
  "output": {
    "route": {
      "description": "example",
      "expression": "example",
      "forwardTo": [
        "example"
      ],
      "priority": 1,
      "routeId": "example"
    }
  }
}
```
