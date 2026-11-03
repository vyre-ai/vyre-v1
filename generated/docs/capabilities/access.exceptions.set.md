# access.exceptions.set

Give a person or a group a permission exception: Allowed or Not allowed on a permission or a whole area, against their role. A person beats a group beats the role; the Owner is never restricted; you give only what you hold

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | access.manage |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/exceptions/set |
| MCP tool | access_exceptions_set (engineer) |
| CLI | none |
| Emits | access.exception_set, access.changed |

## Input

```ts
type In = {
  subject: {
    kind: "person" | "group";
    id: string;
  };
  perms?: Array<string>;
  area?: string;
  effect: "allow" | "deny";
  until?: number;
  why?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  exception: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "area": "example",
    "effect": "allow",
    "idempotencyKey": "idem_1",
    "perms": [
      "example"
    ],
    "subject": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "until": 1760000000000,
    "why": "example"
  },
  "output": {
    "exception": {
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
  }
}
```
