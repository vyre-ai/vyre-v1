# runs.finish

Finish a Run as succeeded, failed or stopped with cost and a one-line result

| | |
|---|---|
| Module | runs |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | run (/runId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runs/finish |
| MCP tool | none |
| CLI | none |
| Emits | run.succeeded, run.failed, run.stopped |

## Input

```ts
type In = {
  runId: string;
  status: "succeeded" | "failed" | "stopped";
  summary?: string;
  costMicros?: number;
  error?: {
    code: string;
    message: string;
    step?: string;
  };
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
    trigger?: {
      messageId: string;
      threadId: string;
      channelId?: string;
    };
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
    "costMicros": 1,
    "error": {
      "code": "example",
      "message": "example",
      "step": "example"
    },
    "runId": "run_a1b2c3",
    "status": "succeeded",
    "summary": "example"
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
      "trigger": {
        "channelId": "chn_a1b2c3",
        "messageId": "msg_a1b2c3",
        "threadId": "thr_a1b2c3"
      },
      "waitReason": "approval"
    }
  }
}
```
