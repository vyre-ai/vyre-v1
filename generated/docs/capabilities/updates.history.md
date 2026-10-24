# updates.history

List past updates with result and duration

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
| HTTP | POST /v1/updates/history |
| MCP tool | updates_history (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  updates: Array<{
      from: string;
      to: string;
      at: number;
      result: "ok" | "failed" | "rolled_back";
      seconds: number;
    }>;
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
    "updates": [
      {
        "at": 1760000000000,
        "from": "1.0.0",
        "result": "ok",
        "seconds": 1,
        "to": "1.0.0"
      }
    ]
  }
}
```
