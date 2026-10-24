# updates.check

Check for a newer server version and the apps it supports

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
| HTTP | POST /v1/updates/check |
| MCP tool | updates_check (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  available?: string;
  notes?: string;
  supportedApps: Array<string>;
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
    "notes": "example",
    "supportedApps": [
      "example"
    ]
  }
}
```
