# plugins.files

The text files of an installed plugin, for the sandbox to be given (its MCP servers and hooks run from them)

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
| HTTP | POST /v1/plugins/files |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  pluginId: string;
};
```

## Output

```ts
type Out = {
  files: Record<string, string>;
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
    "pluginId": "plg_a1b2c3"
  },
  "output": {
    "files": {}
  }
}
```
