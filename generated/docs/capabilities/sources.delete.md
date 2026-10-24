# sources.delete

Remove a source (records already created stay)

| | |
|---|---|
| Module | sources |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sources/delete |
| MCP tool | sources_delete (records) |
| CLI | none |
| Emits | source.deleted |

## Input

```ts
type In = {
  sourceId: string;
};
```

## Output

```ts
type Out = {
  deleted: boolean;
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
    "sourceId": "src_a1b2c3"
  },
  "output": {
    "deleted": true
  }
}
```
