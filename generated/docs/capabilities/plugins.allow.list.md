# plugins.allow.list

The marketplaces and plugins the admin allows

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
| HTTP | POST /v1/plugins/allow/list |
| MCP tool | plugins_allowlist (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  allowed: Array<{
      kind: "marketplace" | "plugin";
      marketplace: string;
      plugin?: string;
      by: string;
      at: number;
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
    "allowed": [
      {
        "at": 1760000000000,
        "by": "example",
        "kind": "marketplace",
        "marketplace": "example",
        "plugin": "example"
      }
    ]
  }
}
```
