# runs.events.list

A tree's events since a cursor, in order (one node's with runId)

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/events/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
  since?: number;
  limit?: number;
  only?: string;
};
```

## Output

```ts
type Out = {
  events: Array<{
      rootRun: string;
      seq: number;
      runId: string;
      at: number;
      type: string;
      actor?: string;
      key?: string;
      payload: unknown;
    }>;
  lastSeq: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "limit": 1,
    "only": "run_a1b2c3",
    "runId": "run_a1b2c3",
    "since": 1
  },
  "output": {
    "events": [
      {
        "actor": "example",
        "at": 1760000000000,
        "key": "example",
        "payload": {},
        "rootRun": "run_a1b2c3",
        "runId": "run_a1b2c3",
        "seq": 1,
        "type": "state"
      }
    ],
    "lastSeq": 1
  }
}
```
