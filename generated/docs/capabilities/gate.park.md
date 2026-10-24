# gate.park

Park a call that authorize held: render the exact preview, create the Approve task, park the call (called by invoke)

| | |
|---|---|
| Module | gate |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/gate/park |
| MCP tool | none |
| CLI | none |
| Emits | gate.requested |

## Input

```ts
type In = {
  capName: string;
  capVersion: number;
  input: unknown;
  payloadHash: string;
  act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  actingFor?: string;
  decisionId: string;
  runId?: string;
  threadId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  holdId: string;
  taskId: string;
  runId?: string;
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
    "act": "send",
    "actingFor": "example",
    "capName": "mail.send",
    "capVersion": 1,
    "decisionId": "example",
    "idempotencyKey": "idem_1",
    "input": {},
    "payloadHash": "example",
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "runId": "run_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "holdId": "hld_a1b2c3",
    "runId": "run_a1b2c3",
    "taskId": "tsk_a1b2c3"
  }
}
```
