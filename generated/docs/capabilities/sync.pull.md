# sync.pull

Pull changes after a cursor, already permission and label filtered for this person and device class, with hide rows for rows that left view

| | |
|---|---|
| Module | sync |
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
| HTTP | POST /sync/v1/pull |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor: number;
  epoch: number;
  limit?: number;
  entities?: Array<string>;
};
```

## Output

```ts
type Out = {
  epoch: number;
  changes: Array<{
      seq: number;
      entity: string;
      id: string;
      op: "upsert" | "patch" | "delete";
      fields: Record<string, {
          v: unknown;
          hlc: string;
          actor: string;
          enc?: {
            key: string;
            nonce: string;
          };
        }>;
      trace?: string;
    }>;
  hide: Array<{
      entity: string;
      id: string;
      seq: number;
    }>;
  next: number;
  more: boolean;
  serverHlc: string;
  conflicts?: Array<{
      conflictId: string;
      entity: string;
      id: string;
      field: string;
      state: "open" | "proposed" | "needs_you" | "resolved";
    }>;
  rejected?: Array<{
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
  reset?: "purge";
};
```

## Errors

- auth.device_revoked
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "cursor": 1,
    "entities": [
      "example"
    ],
    "epoch": 1,
    "limit": 1
  },
  "output": {
    "changes": [
      {
        "entity": "rt_contact",
        "fields": {},
        "id": "rec_a1b2c3",
        "op": "upsert",
        "seq": 1,
        "trace": "0123456789abcdef0123456789abcdef"
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
    "epoch": 1,
    "hide": [
      {
        "entity": "example",
        "id": "example",
        "seq": 1
      }
    ],
    "more": true,
    "next": 1,
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
    "reset": "purge",
    "serverHlc": "18f3a1b2c3d-0001-dev_a1b2c3"
  }
}
```
