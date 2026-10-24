# updates.channel_set

Choose the update channel

| | |
|---|---|
| Module | updates |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.update |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/updates/channel_set |
| MCP tool | updates_channel_set (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channel: "stable" | "beta" | "nightly";
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
    "channel": "stable"
  },
  "output": {
    "ok": true
  }
}
```
