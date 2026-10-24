# logs.replay_start

Replay a failed Run or sync conflict on a copy of the Space with outward capabilities stubbed and sealed values replaced

| | |
|---|---|
| Module | logs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | server.logs |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/logs/replay_start |
| MCP tool | logs_replay_start (engineer) |
| CLI | none |
| Emits | replay.started, replay.finished |

## Input

```ts
type In = {
  atSeq: number;
  runId?: string;
  conflictId?: string;
};
```

## Output

```ts
type Out = {
  replayId: string;
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
    "atSeq": 1,
    "conflictId": "cfl_a1b2c3",
    "runId": "run_a1b2c3"
  },
  "output": {
    "replayId": "rpl_a1b2c3"
  }
}
```
