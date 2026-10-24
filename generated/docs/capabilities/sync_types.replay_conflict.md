# sync_types.replay_conflict

Replay a conflict on a copy to see what each rule would have produced

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/replay_conflict |
| MCP tool | sync_types_replay_conflict (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  conflictId: string;
};
```

## Output

```ts
type Out = {
  results: Array<{
      rule: "newest" | "source" | "vyre" | "ask";
      value: unknown;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "conflictId": "cfl_a1b2c3"
  },
  "output": {
    "results": [
      {
        "rule": "newest",
        "value": {}
      }
    ]
  }
}
```
