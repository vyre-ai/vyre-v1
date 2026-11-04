# install.remove

Take back an install: its skill, plugin or connection is removed

| | |
|---|---|
| Module | agents |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/install/remove |
| MCP tool | install_remove (agents) |
| CLI | none |
| Emits | skill.mine_changed, plugin.uninstalled |

## Input

```ts
type In = {
  installId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "installId": "ins_a1b2c3"
  },
  "output": {
    "removed": true
  }
}
```
