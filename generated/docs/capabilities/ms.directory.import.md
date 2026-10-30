# ms.directory.import

Invite chosen people from the directory: one invitation each with their work address and role, returned as links to send once a person approves

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/ms/directory/import |
| MCP tool | ms_directory_import (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  people: Array<{
      email: string;
      role: string;
    }>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  invited: Array<{
      email: string;
      inviteId: string;
      link: string;
    }>;
  skipped: Array<{
      email: string;
      reason: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "people": [
      {
        "email": "maya@example.com",
        "role": "rol_a1b2c3"
      }
    ]
  },
  "output": {
    "invited": [
      {
        "email": "maya@example.com",
        "inviteId": "inv_a1b2c3",
        "link": "example"
      }
    ],
    "skipped": [
      {
        "email": "maya@example.com",
        "reason": "example"
      }
    ]
  }
}
```
