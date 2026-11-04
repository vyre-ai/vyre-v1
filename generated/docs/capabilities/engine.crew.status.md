# engine.crew.status

Everything that works for a chat, in one read for the Island, the header chip and the Crew pane: each helper and teammate with its state, the step it is on, model, account, branch, files changed, tokens and cost, and the totals for the crew. Only what is known; nothing is estimated

| | |
|---|---|
| Module | engine |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/engine/crew/status |
| MCP tool | engine_crew_status (chats) |
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
  members: Array<{
      kind: "helper" | "teammate";
      id: string;
      jobId?: string;
      parentThreadId: string;
      title: string;
      name?: string;
      agentId: string;
      state: "working" | "done" | "needs_you" | "failed" | "stopped";
      holdTaskId?: string;
      step?: string;
      found?: string;
      startedAt: number;
      endedAt?: number;
      elapsedMs: number;
      model?: string;
      provider?: string;
      accountLabel?: string;
      why?: string;
      fellBackFrom?: string;
      branch?: string;
      files?: Array<{
          path: string;
          added: number;
          deleted: number;
        }>;
      added?: number;
      deleted?: number;
      merged?: boolean;
      tokensIn: number;
      tokensOut: number;
      costMicros: number;
      tests?: {
        state: "running" | "passing" | "failing";
        passed?: number;
        failed?: number;
      };
    }>;
  totals: {
    members: number;
    working: number;
    done: number;
    needsYou: number;
    failed: number;
    stopped: number;
    tokensIn: number;
    tokensOut: number;
    costMicros: number;
    filesChanged: number;
    added: number;
    deleted: number;
    elapsedMs: number;
  };
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
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "members": [
      {
        "accountLabel": "example",
        "added": 1,
        "agentId": "agt_a1b2c3",
        "branch": "example",
        "costMicros": 1,
        "deleted": 1,
        "elapsedMs": 1,
        "endedAt": 1760000000000,
        "fellBackFrom": "example",
        "files": [
          {
            "added": 1,
            "deleted": 1,
            "path": "example"
          }
        ],
        "found": "example",
        "holdTaskId": "tsk_a1b2c3",
        "id": "thr_a1b2c3",
        "jobId": "example",
        "kind": "helper",
        "merged": true,
        "model": "example",
        "name": "example",
        "parentThreadId": "thr_a1b2c3",
        "provider": "example",
        "startedAt": 1760000000000,
        "state": "working",
        "step": "example",
        "tests": {
          "failed": 1,
          "passed": 1,
          "state": "running"
        },
        "title": "example",
        "tokensIn": 1,
        "tokensOut": 1,
        "why": "example"
      }
    ],
    "totals": {
      "added": 1,
      "costMicros": 1,
      "deleted": 1,
      "done": 1,
      "elapsedMs": 1,
      "failed": 1,
      "filesChanged": 1,
      "members": 1,
      "needsYou": 1,
      "stopped": 1,
      "tokensIn": 1,
      "tokensOut": 1,
      "working": 1
    }
  }
}
```
