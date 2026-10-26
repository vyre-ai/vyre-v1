# sync.push

Push outbox ops in order; each op runs through invoke as the person; concurrent field edits merge by the field policy

| | |
|---|---|
| Module | sync |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /sync/v1/push |
| MCP tool | none |
| CLI | none |
| Emits | conflict.opened, sync.op_rejected |

## Input

```ts
type In = {
  deviceId: string;
  epoch: number;
  ops: Array<{
      opId: string;
      traceId: string;
      hlc: string;
      cap: string;
      v: number;
      entity?: string;
      id?: string;
      input: unknown;
      baseSeq: Record<string, number>;
      enc?: {
        key: string;
        nonce: string;
      };
    }>;
};
```

## Output

```ts
type Out = {
  applied: Array<{
      opId: string;
      seq: number;
    }>;
  rejected: Array<{
      opId: string;
      error: {
        code: string;
        message: string;
        next: Array<{
            kind: string;
            label: string;
            action?: unknown;
          }>;
        retryable: boolean;
        traceId: string;
        details?: Record<string, unknown>;
      };
      copyOut: unknown;
    }>;
  conflicts: Array<{
      conflictId: string;
      entity: string;
      id: string;
      field: string;
      state: "open" | "proposed" | "needs_you" | "resolved";
    }>;
  held: Array<{
      opId: string;
      taskId: string;
    }>;
  serverHlc: string;
};
```

## Errors

- auth.device_revoked
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.too_large
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "deviceId": "dev_a1b2c3",
    "epoch": 1,
    "ops": [
      {
        "baseSeq": {},
        "cap": "records.update",
        "enc": {
          "key": "example",
          "nonce": "example"
        },
        "entity": "example",
        "hlc": "18f3a1b2c3d-0001-dev_a1b2c3",
        "id": "example",
        "input": {},
        "opId": "0192f3a0-7b1c-7000-8000-000000000001",
        "traceId": "0123456789abcdef0123456789abcdef",
        "v": 1
      }
    ]
  },
  "output": {
    "applied": [
      {
        "opId": "example",
        "seq": 1
      }
    ],
    "conflicts": [
      {
        "conflictId": "cfl_a1b2c3",
        "entity": "example",
        "field": "example",
        "id": "example",
        "state": "open"
      }
    ],
    "held": [
      {
        "opId": "example",
        "taskId": "tsk_a1b2c3"
      }
    ],
    "rejected": [
      {
        "copyOut": {},
        "error": {
          "code": "permission.no_grant",
          "details": {},
          "message": "example",
          "next": [
            {
              "action": {},
              "kind": "example",
              "label": "example"
            }
          ],
          "retryable": true,
          "traceId": "0123456789abcdef0123456789abcdef"
        },
        "opId": "example"
      }
    ],
    "serverHlc": "18f3a1b2c3d-0001-dev_a1b2c3"
  }
}
```
