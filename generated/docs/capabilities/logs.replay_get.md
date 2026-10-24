# logs.replay_get

Result of a replay: steps, recorded outward calls, differences from the original

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | server.logs |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/logs/replay_get |
| MCP tool | logs_replay_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  replayId: string;
};
```

## Output

```ts
type Out = {
  state: "running" | "done" | "failed";
  recordedOutward: number;
  steps: Array<{
      name: string;
      ok: boolean;
      detail?: string;
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
  "input": {
    "replayId": "rpl_a1b2c3"
  },
  "output": {
    "recordedOutward": 1,
    "state": "running",
    "steps": [
      {
        "detail": "example",
        "name": "example",
        "ok": true
      }
    ]
  }
}
```
