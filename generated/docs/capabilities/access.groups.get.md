# access.groups.get

Read one group with members, managers, roles and grants given to it

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
| HTTP | POST /v1/access/groups/get |
| MCP tool | access_groups_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  groupId: string;
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
  roles: Array<string>;
  grants: Array<{
      id: string;
      subject: {
        kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
        id: string;
      };
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      level: "view" | "use" | "edit" | "manage";
      conditions: {
        rowFilter?: unknown;
        hiddenFields?: Array<string>;
        labelCeiling?: "public" | "internal" | "confidential" | "restricted";
        window?: {
          from: number;
          to: number;
        };
        expiresAt?: number;
      };
      by: string;
      source?: string;
      createdAt: number;
    }>;
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
    "groupId": "grp_a1b2c3"
  },
  "output": {
    "grants": [
      {
        "by": "example",
        "conditions": {
          "expiresAt": 1760000000000,
          "hiddenFields": [
            "example"
          ],
          "labelCeiling": "public",
          "rowFilter": {},
          "window": {
            "from": 1760000000000,
            "to": 1760000000000
          }
        },
        "createdAt": 1760000000000,
        "id": "gnt_a1b2c3",
        "level": "view",
        "resource": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "source": "example",
        "subject": {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      }
    ],
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
    },
    "roles": [
      "rol_a1b2c3"
    ]
  }
}
```
