# plugins.uninstall

Remove an installed plugin and what it brought

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | agents.manage |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/plugins/uninstall |
| MCP tool | plugins_uninstall (agents) |
| CLI | none |
| Emits | plugin.uninstalled |

## Input

```ts
type In = {
  pluginId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: boolean;
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
    "idempotencyKey": "idem_1",
    "pluginId": "plg_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
