# access.groups.list

List groups

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
| HTTP | POST /v1/access/groups/list |
| MCP tool | access_groups_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  groups: Array<{
      id: string;
      name: string;
      members: Array<{
          kind: "person" | "agent" | "actor" | "service";
          id: string;
        }>;
      managers: Array<{
          kind: "person" | "agent" | "actor" | "service";
          id: string;
        }>;
      builtIn: boolean;
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
    "limit": 1,
    "q": "example"
  },
  "output": {
    "groups": [
      {
        "builtIn": true,
        "id": "grp_a1b2c3",
        "managers": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "members": [
          {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        ],
        "name": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
