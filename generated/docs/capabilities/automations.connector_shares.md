# automations.connector_shares

List connector actions another Space can start from. A key is not included.

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
| HTTP | POST /v1/automations/connector_shares |
| MCP tool | automations_connector_shares (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  connectors: Array<{
      appName: string;
      actions: Array<{
          key: string;
          title: string;
          level: "draft" | "tested";
        }>;
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
  "input": {},
  "output": {
    "connectors": [
      {
        "actions": [
          {
            "key": "example",
            "level": "draft",
            "title": "example"
          }
        ],
        "appName": "example"
      }
    ]
  }
}
```
