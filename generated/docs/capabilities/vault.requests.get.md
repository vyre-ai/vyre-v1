# vault.requests.get

One key request with its task and status

| | |
|---|---|
| Module | vault-requests |
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
| HTTP | POST /v1/vault/requests/get |
| MCP tool | vault_requests_get (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
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

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "vrq_a1b2c3"
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
