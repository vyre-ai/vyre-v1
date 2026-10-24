# connectors.init

Scaffold a connector folder: connector.toml, transforms.js, tests, README

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (create under /key) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/init |
| MCP tool | connectors_init (engineer) |
| CLI | vyre connector init |
| Emits | connector.created |

## Input

```ts
type In = {
  key: string;
  title: string;
  mode: "api" | "mcp" | "dwd" | "oauth_app" | "webhook_only";
  docsUrl?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  key: string;
  folderId: string;
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
    "docsUrl": "example",
    "idempotencyKey": "idem_1",
    "key": "hubspot",
    "mode": "api",
    "title": "example"
  },
  "output": {
    "folderId": "fld_a1b2c3",
    "key": "hubspot"
  }
}
```
