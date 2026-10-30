# plugins.allow.set

Allow or stop allowing a whole marketplace, or one plugin of it

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/allow/set |
| MCP tool | plugins_allow (agents) |
| CLI | none |
| Emits | plugin.allowlist_changed |

## Input

```ts
type In = {
  kind: "marketplace" | "plugin";
  marketplace: string;
  plugin?: string;
  allowed: boolean;
  idempotencyKey: string;
};
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
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "allowed": true,
    "idempotencyKey": "idem_1",
    "kind": "marketplace",
    "marketplace": "example",
    "plugin": "example"
  },
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
