# hooks.runs.latest

The newest run of each hook in one chat, one row per hook: what "Last ran" on a hook card reads. Only for a chat you can use

| | |
|---|---|
| Module | hooks |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/hooks/runs/latest |
| MCP tool | hooks_runs_latest (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
};
```

## Output

```ts
type Out = {
  runs: Array<{
      id: number;
      hookId: string;
      event: string;
      threadId?: string;
      agentId?: string;
      tool?: string;
      outcome: "ok" | "blocked" | "note" | "error" | "timeout" | "skipped" | "allowed_once" | "allowed_always";
      detail?: string;
      ms: number;
      at: number;
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "runs": [
      {
        "agentId": "example",
        "at": 1760000000000,
        "detail": "example",
        "event": "example",
        "hookId": "example",
        "id": 1,
        "ms": 1,
        "outcome": "ok",
        "threadId": "example",
        "tool": "example"
      }
    ]
  }
}
```
