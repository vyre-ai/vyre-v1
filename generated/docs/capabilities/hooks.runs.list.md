# hooks.runs.list

What hooks did lately: which ran, what they answered, and the ones that failed or ran out of time, newest first. since and outcomes narrow it before the limit; scope space is a Space admin's read of every Space hook's runs (anyone else gets only what they could see anyway)

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
| HTTP | POST /v1/hooks/runs/list |
| MCP tool | hooks_runs (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  hookId?: string;
  threadId?: string;
  limit?: number;
  since?: number;
  outcomes?: Array<"ok" | "blocked" | "note" | "error" | "timeout" | "skipped" | "allowed_once">;
  scope?: "space";
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
    "hookId": "example",
    "limit": 1,
    "outcomes": [
      "ok"
    ],
    "scope": "space",
    "since": 1760000000000,
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
