# access.groups.create

Create a group of people and agents

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
| HTTP | POST /v1/access/groups/create |
| MCP tool | access_groups_create (engineer) |
| CLI | none |
| Emits | access.changed |

## Input

```ts
type In = {
  name: string;
  members?: Array<{
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    }>;
  managers?: Array<{
      kind: "person" | "agent" | "actor" | "service";
      id: string;
    }>;
  idempotencyKey: string;
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
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
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
