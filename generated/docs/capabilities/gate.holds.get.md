# gate.holds.get

Read one hold

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/holds/get |
| MCP tool | gate_holds_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  holdId: string;
};
```

## Output

```ts
type Out = {
  hold: {
    id: string;
    act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
    capName: string;
    taskId: string;
    runId?: string;
    principal: {
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    };
    actingFor?: string;
    state: "held" | "approved" | "denied" | "expired";
    payloadHash: string;
    createdAt: number;
    expiresAt: number;
  };
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
    "holdId": "hld_a1b2c3"
  },
  "output": {
    "hold": {
      "act": "send",
      "actingFor": "example",
      "capName": "mail.send",
      "createdAt": 1760000000000,
      "expiresAt": 1760000000000,
      "id": "hld_a1b2c3",
      "payloadHash": "example",
      "principal": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "runId": "run_a1b2c3",
      "state": "held",
      "taskId": "tsk_a1b2c3"
    }
  }
}
```
