# updates.status

Current version, channel, available version and last update result

| | |
|---|---|
| Module | updates |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.update |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/updates/status |
| MCP tool | updates_status (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  current: string;
  channel: "stable" | "beta" | "nightly";
  available?: string;
  lastResult?: "ok" | "failed" | "rolled_back";
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
  "input": {},
  "output": {
    "available": "1.0.0",
    "channel": "stable",
    "current": "1.0.0",
    "lastResult": "ok"
  }
}
```
