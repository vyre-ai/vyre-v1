# access.exceptions.list

Permission exceptions in force: who differs from their role, on what, Allowed or Not allowed, until when and why

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | access.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/access/exceptions/list |
| MCP tool | access_exceptions_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  subject?: {
    kind: "person" | "group";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  exceptions: Array<{
      exceptionId: string;
      subject: {
        kind: "person" | "group";
        id: string;
        name: string;
      };
      perms: Array<string>;
      area?: string;
      effect: "allow" | "deny";
      until?: number;
      why?: string;
      by: {
        id: string;
        name: string;
      };
      at: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "exceptions": [
      {
        "area": "example",
        "at": 1760000000000,
        "by": {
          "id": "example",
          "name": "example"
        },
        "effect": "allow",
        "exceptionId": "exc_a1b2c3",
        "perms": [
          "example"
        ],
        "subject": {
          "id": "example",
          "kind": "person",
          "name": "example"
        },
        "until": 1760000000000,
        "why": "example"
      }
    ]
  }
}
```
