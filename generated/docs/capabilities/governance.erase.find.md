# governance.erase.find

Find everything about one contact across records, files, chats, inbox, mail, calls, memory and runs, and show it

| | |
|---|---|
| Module | governance |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | policy.manage |
| Grant level | view |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/governance/erase/find |
| MCP tool | governance_erase_find (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  subject: {
    recordId?: string;
    email?: string;
    phone?: string;
    name?: string;
  };
};
```

## Output

```ts
type Out = {
  findingId: string;
  groups: Array<{
      kind: "records" | "files" | "chats" | "inbox" | "mail" | "calls" | "memory" | "runs";
      count: number;
      onHold: number;
      samples: Array<{
          type: string;
          id: string;
          title: string;
        }>;
    }>;
  expiresAt: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "subject": {
      "email": "maya@example.com",
      "name": "example",
      "phone": "example",
      "recordId": "rec_a1b2c3"
    }
  },
  "output": {
    "expiresAt": 1760000000000,
    "findingId": "fnd_a1b2c3",
    "groups": [
      {
        "count": 1,
        "kind": "records",
        "onHold": 1,
        "samples": [
          {
            "id": "example",
            "title": "example",
            "type": "example"
          }
        ]
      }
    ]
  }
}
```
