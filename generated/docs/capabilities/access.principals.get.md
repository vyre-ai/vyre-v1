# access.principals.get

Read one principal

| | |
|---|---|
| Module | access |
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
| HTTP | POST /v1/access/principals/get |
| MCP tool | access_principals_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  principal: {
    id: string;
    kind: "person" | "agent" | "actor" | "service";
    name: string;
    owner?: string;
    status: "invited" | "active" | "suspended" | "removed";
    roles: Array<string>;
    groups: Array<string>;
    title?: string;
    createdAt: number;
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
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "principal": {
      "createdAt": 1760000000000,
      "groups": [
        "grp_a1b2c3"
      ],
      "id": "usr_a1b2c3",
      "kind": "person",
      "name": "example",
      "owner": "usr_a1b2c3",
      "roles": [
        "rol_a1b2c3"
      ],
      "status": "invited",
      "title": "example"
    }
  }
}
```
