# connectors.list

List connectors: built-in, installed and drafts

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/list |
| MCP tool | connectors_list (engineer) |
| CLI | vyre connector list |
| Emits | none |

## Input

```ts
type In = {
  state?: "live" | "draft" | "failing_tests";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  connectors: Array<{
      key: string;
      title: string;
      mode: "api" | "mcp" | "dwd" | "oauth_app" | "webhook_only";
      scope: "person" | "space";
      builtin: boolean;
      version: string;
      state: "live" | "draft" | "failing_tests";
      domains: Array<string>;
      secrets: Array<{
          name: string;
          description: string;
        }>;
      connections: number;
      syncedTypes: Array<string>;
      actions: Array<string>;
      sources: Array<string>;
      objects?: Record<string, {
          list?: string;
          listAfter?: string;
          create?: string;
          update?: string;
          delete?: string;
        }>;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1,
    "state": "live"
  },
  "output": {
    "connectors": [
      {
        "actions": [
          "example"
        ],
        "builtin": true,
        "connections": 1,
        "domains": [
          "example"
        ],
        "key": "hubspot",
        "mode": "api",
        "objects": {},
        "scope": "person",
        "secrets": [
          {
            "description": "example",
            "name": "example"
          }
        ],
        "sources": [
          "example"
        ],
        "state": "live",
        "syncedTypes": [
          "example"
        ],
        "title": "example",
        "version": "1.0.0"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
