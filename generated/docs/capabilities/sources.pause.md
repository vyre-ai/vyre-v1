# sources.pause

Pause a source; deliveries are refused with a visible reason

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
| HTTP | POST /v1/sources/pause |
| MCP tool | sources_pause (records) |
| CLI | none |
| Emits | source.paused |

## Input

```ts
type In = {
  sourceId: string;
  reason?: string;
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
    "reason": "example",
    "sourceId": "src_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
