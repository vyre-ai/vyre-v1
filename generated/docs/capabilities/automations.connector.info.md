# automations.connector.info

What a step key stands for: the app, the action, whether it reads or changes something, and its level

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
| Team Space only | no |
| HTTP | POST /v1/automations/connector/info |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  found: boolean;
  app?: string;
  action?: string;
  title?: string;
  effect?: "read" | "outward";
  level?: "draft" | "tested" | "published";
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
    "key": "example"
  },
  "output": {
    "action": "list_customers",
    "app": "stripe",
    "effect": "read",
    "found": true,
    "level": "draft",
    "title": "example"
  }
}
```
