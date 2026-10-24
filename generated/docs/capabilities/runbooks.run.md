# runbooks.run

Run one block or all blocks of a runbook on a target; Run all stops at the first error

| | |
|---|---|
| Module | runbooks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | terminal.use |
| Grant level | use |
| Risk | high |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/runbooks/run |
| MCP tool | runbooks_run (terminal) |
| CLI | vyre runbook run |
| Emits | runbook.run_started, runbook.block_finished, runbook.run_finished |

## Input

```ts
type In = {
  fileId: string;
  blockId?: string;
  all?: boolean;
  target?: {
    kind: "server" | "computer";
    computerId?: string;
  };
  versionId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "all": true,
    "blockId": "b2_9fc1",
    "fileId": "fil_a1b2c3",
    "idempotencyKey": "idem_1",
    "target": {
      "computerId": "cmt_a1b2c3",
      "kind": "server"
    },
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
