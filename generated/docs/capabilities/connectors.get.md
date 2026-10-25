# connectors.get

Read one connector: auth, egress domains, secret names, sources, synced types and actions

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/get |
| MCP tool | connectors_get (engineer) |
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
  connector: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "key": "hubspot"
  },
  "output": {
    "connector": {
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
  }
}
```
