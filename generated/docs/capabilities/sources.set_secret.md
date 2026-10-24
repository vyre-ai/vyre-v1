# sources.set_secret

Point a source at the Vault item holding its signing secret (name only, never the value)

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
| HTTP | POST /v1/sources/set_secret |
| MCP tool | sources_set_secret (records) |
| CLI | none |
| Emits | source.updated |

## Input

```ts
type In = {
  sourceId: string;
  secretName: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "secretName": "example",
    "sourceId": "src_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
