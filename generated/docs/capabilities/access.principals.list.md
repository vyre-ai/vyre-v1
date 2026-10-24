# access.principals.list

List principals (people, agents, outside actors, services) with roles and groups

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
| HTTP | POST /v1/access/principals/list |
| MCP tool | access_principals_list (meta) |
| CLI | vyre access principals |
| Emits | none |

## Input

```ts
type In = {
  kind?: "person" | "agent" | "actor" | "service";
  status?: "invited" | "active" | "suspended" | "removed";
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  principals: Array<{
      id: string;
      kind: "person" | "agent" | "actor" | "service";
      name: string;
      owner?: string;
      status: "invited" | "active" | "suspended" | "removed";
      roles: Array<string>;
      groups: Array<string>;
      title?: string;
      createdAt: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "kind": "person",
    "limit": 1,
    "q": "example",
    "status": "invited"
  },
  "output": {
    "next": "example",
    "principals": [
      {
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
    ],
    "total": 1
  }
}
```
