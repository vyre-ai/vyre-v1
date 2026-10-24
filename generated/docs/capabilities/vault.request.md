# vault.request

Ask for a missing key: creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status

| | |
|---|---|
| Module | vault-requests |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/request |
| MCP tool | vault_request (vault) |
| CLI | none |
| Emits | vault.requested |

## Input

```ts
type In = {
  name: string;
  fields?: Array<string>;
  reason: string;
  forRun?: string;
  folderId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  request: {
    id: string;
    name: string;
    fields: Array<string>;
    reason: string;
    requester: {
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    };
    forRun?: string;
    folderId?: string;
    state: "waiting" | "fulfilled" | "declined" | "canceled";
    itemId?: string;
    note?: string;
    taskId: string;
    at: number;
    decidedAt?: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "fields": [
      "api_key"
    ],
    "folderId": "vfd_a1b2c3",
    "forRun": "run_a1b2c3",
    "idempotencyKey": "idem_1",
    "name": "Dana_Lawmatics",
    "reason": "example"
  },
  "output": {
    "request": {
      "at": 1760000000000,
      "decidedAt": 1760000000000,
      "fields": [
        "api_key"
      ],
      "folderId": "vfd_a1b2c3",
      "forRun": "run_a1b2c3",
      "id": "vrq_a1b2c3",
      "itemId": "vit_a1b2c3",
      "name": "Dana_Lawmatics",
      "note": "example",
      "reason": "example",
      "requester": {
        "id": "usr_a1b2c3",
        "kind": "person"
      },
      "state": "waiting",
      "taskId": "tsk_a1b2c3"
    }
  }
}
```
