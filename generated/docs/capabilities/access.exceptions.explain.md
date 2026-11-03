# access.exceptions.explain

May this person (or the agent acting for them) do what a permission covers, and why, in plain words: the Owner, their own exception, a group exception or their role

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
| HTTP | POST /v1/access/exceptions/explain |
| MCP tool | access_exceptions_explain (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  principal: string;
  perm: string;
};
```

## Output

```ts
type Out = {
  allowed: boolean;
  source: "owner" | "person" | "group" | "role";
  words: string;
  exception?: {
    exceptionId: string;
    subject: {
      kind: "person" | "group";
      id: string;
      name: string;
    };
    perms: Array<string>;
    own?: Array<string>;
    area?: string;
    effect: "allow" | "deny" | "own" | "ask";
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

## Example

```json
{
  "name": "example",
  "input": {
    "perm": "example",
    "principal": "example"
  },
  "output": {
    "allowed": true,
    "exception": {
      "area": "example",
      "at": 1760000000000,
      "by": {
        "id": "example",
        "name": "example"
      },
      "effect": "allow",
      "exceptionId": "exc_a1b2c3",
      "own": [
        "example"
      ],
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
    },
    "source": "owner",
    "words": "example"
  }
}
```
