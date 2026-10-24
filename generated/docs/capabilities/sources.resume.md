# sources.resume

Resume a paused source

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
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sources/resume |
| MCP tool | sources_resume (records) |
| CLI | none |
| Emits | source.resumed |

## Input

```ts
type In = {
  sourceId: string;
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
    "sourceId": "src_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
