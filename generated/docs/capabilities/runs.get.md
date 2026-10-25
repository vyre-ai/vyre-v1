# runs.get

Read one Run: status, owner, key and model used, cost, thread, trace

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
| HTTP | POST /v1/runs/get |
| MCP tool | runs_get (automations) |
| CLI | vyre runs get |
| Emits | none |

## Input

```ts
type In = {
  runId: string;
};
```

## Output

```ts
type Out = {
  run: {
    id: string;
    kind: "automation" | "automation_test" | "journey" | "journey_migrate" | "routine" | "campaign" | "deployment" | "connector_sync" | "connector_build" | "import" | "runbook" | "wait" | "terminal" | "replay" | "other";
    name?: string;
    owner: string;
    startedBy: string;
    subject?: {
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      id: string;
    };
    status: "queued" | "running" | "waiting" | "succeeded" | "failed" | "stopped";
    waitReason?: "approval" | "background" | "key";
    definitionVersion?: number;
    keyUsed?: string;
    modelUsed?: string;
    costMicros: number;
    startedAt: number;
    endedAt?: number;
    parentRun?: string;
    threadId?: string;
    traceId: string;
    summary?: string;
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
    "runId": "run_a1b2c3"
  },
  "output": {
    "run": {
      "costMicros": 1,
      "definitionVersion": 1,
      "endedAt": 1760000000000,
      "id": "run_a1b2c3",
      "keyUsed": "example",
      "kind": "automation",
      "modelUsed": "example",
      "name": "example",
      "owner": "usr_a1b2c3",
      "parentRun": "run_a1b2c3",
      "startedAt": 1760000000000,
      "startedBy": "example",
      "status": "queued",
      "subject": {
        "id": "rec_a1b2c3",
        "type": "space"
      },
      "summary": "example",
      "threadId": "thr_a1b2c3",
      "traceId": "0123456789abcdef0123456789abcdef",
      "waitReason": "approval"
    }
  }
}
```
