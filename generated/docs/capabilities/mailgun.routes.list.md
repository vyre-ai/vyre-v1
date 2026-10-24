# mailgun.routes.list

List Mailgun routes

| | |
|---|---|
| Module | mailgun |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | comms.domains |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mailgun/routes/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  routes: Array<{
      routeId: string;
      expression: string;
      forwardTo: Array<string>;
      priority: number;
      description?: string;
    }>;
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
  "input": {},
  "output": {
    "routes": [
      {
        "description": "example",
        "expression": "example",
        "forwardTo": [
          "example"
        ],
        "priority": 1,
        "routeId": "example"
      }
    ]
  }
}
```
