# access.join_share

System: the join step of an invite that picked an agent; the new member gets the level as the inviter's act, while the inviter could still give it

| | |
|---|---|
| Module | access |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/access/join_share |
| MCP tool | none |
| CLI | none |
| Emits | grant.created, access.changed |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  person: string;
  level: "view" | "use" | "edit" | "manage";
  inviter: string;
  source: string;
};
```

## Output

```ts
type Out = {
  grant: {
    id: string;
    subject: {
      kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
      id: string;
    };
    resource: {
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
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
      export?: boolean;
      reshare?: boolean;
    };
    by: string;
    source?: string;
    createdAt: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_contained
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "inviter": "usr_a1b2c3",
    "level": "view",
    "person": "usr_a1b2c3",
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    },
    "source": "invite:inv_a1b2c3"
  },
  "output": {
    "grant": {
      "by": "example",
      "conditions": {
        "expiresAt": 1760000000000,
        "export": true,
        "hiddenFields": [
          "example"
        ],
        "labelCeiling": "public",
        "reshare": true,
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
  }
}
```
