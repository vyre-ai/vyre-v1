# computers.browser.timeline

What an agent did in its Space browser, step by step with a picture each: the same timeline as a computer's, for the agent's profile. Only for a browser you may watch

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/timeline |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
  runId?: string;
  threadId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  steps: Array<{
      stepId: string;
      idx: number;
      at: number;
      caption: string;
      tool: string;
      frameFileId?: string;
      by: "agent" | "person";
      runId?: string;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3",
    "cursor": "example",
    "limit": 1,
    "runId": "run_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "next": "example",
    "steps": [
      {
        "at": 1760000000000,
        "by": "agent",
        "caption": "example",
        "frameFileId": "fil_a1b2c3",
        "idx": 1,
        "runId": "run_a1b2c3",
        "stepId": "stp_a1b2c3",
        "tool": "example"
      }
    ],
    "total": 1
  }
}
```
