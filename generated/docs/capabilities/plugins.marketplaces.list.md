# plugins.marketplaces.list

Marketplaces added to this Space

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
| HTTP | POST /v1/plugins/marketplaces/list |
| MCP tool | plugins_marketplaces (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  marketplaces: Array<{
      marketplaceId: string;
      name: string;
      kind: "git" | "local";
      source: string;
      ref?: string;
      owner: string;
      description?: string;
      plugins: number;
      allowed: boolean;
      warnings: Array<string>;
      revision?: string;
      updatedAt: number;
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
    "marketplaces": [
      {
        "allowed": true,
        "description": "example",
        "kind": "git",
        "marketplaceId": "mkt_a1b2c3",
        "name": "acme-tools",
        "owner": "example",
        "plugins": 1,
        "ref": "example",
        "revision": "example",
        "source": "example",
        "updatedAt": 1760000000000,
        "warnings": [
          "example"
        ]
      }
    ]
  }
}
```
