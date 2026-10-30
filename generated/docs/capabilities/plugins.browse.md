# plugins.browse

Plugins the marketplaces offer, with whether each is on the allowlist and where it is installed

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/plugins/browse |
| MCP tool | plugins_browse (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  marketplaceId?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  plugins: Array<{
      marketplaceId: string;
      marketplace: string;
      name: string;
      description?: string;
      version?: string;
      category?: string;
      source: string;
      allowed: boolean;
      installed: Array<{
          pluginId: string;
          scope: "space" | "agent";
          agentId?: string;
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
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": "example",
    "limit": 1,
    "marketplaceId": "mkt_a1b2c3",
    "q": "example"
  },
  "output": {
    "next": "example",
    "plugins": [
      {
        "allowed": true,
        "category": "example",
        "description": "example",
        "installed": [
          {
            "agentId": "agt_a1b2c3",
            "pluginId": "plg_a1b2c3",
            "scope": "space"
          }
        ],
        "marketplace": "example",
        "marketplaceId": "mkt_a1b2c3",
        "name": "example",
        "source": "example",
        "version": "example"
      }
    ],
    "total": 1
  }
}
```
