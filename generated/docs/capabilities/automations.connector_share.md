# automations.connector_share

Offer tested connector actions to another Space as a draft. The reply is the app name and the action names. A key is not stored.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/connector_share |
| MCP tool | automations_connector_share (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  appName: string;
  actions: Array<{
      key: string;
      title: string;
    }>;
};
```

## Output

```ts
type Out = {
  appName: string;
  actions: Array<{
      key: string;
      title: string;
      level: "draft" | "tested";
    }>;
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
    "actions": [
      {
        "key": "example",
        "title": "example"
      }
    ],
    "appName": "example"
  },
  "output": {
    "actions": [
      {
        "key": "example",
        "level": "draft",
        "title": "example"
      }
    ],
    "appName": "example"
  }
}
```
