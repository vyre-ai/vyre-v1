# access.groups.add_member

Add a person or agent to a group (groups hold no groups)

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
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/groups/add_member |
| MCP tool | access_groups_add_member (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  groupId: string;
  member: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  group: {
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
  };
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
    "groupId": "grp_a1b2c3",
    "member": {
      "id": "usr_a1b2c3",
      "kind": "person"
    }
  },
  "output": {
    "group": {
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
  }
}
```
