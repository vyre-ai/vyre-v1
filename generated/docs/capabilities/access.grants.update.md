# access.grants.update

Change the level, conditions or expiry of a grant

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
| Team Space only | yes |
| HTTP | POST /v1/access/grants/update |
| MCP tool | access_grants_update (meta) |
| CLI | none |
| Emits | grant.updated, access.changed |

## Input

```ts
type In = {
  grantId: string;
  level?: "view" | "use" | "edit" | "manage";
  conditions?: {
    rowFilter?: unknown;
    hiddenFields?: Array<string>;
    labelCeiling?: "public" | "internal" | "confidential" | "restricted";
    window?: {
      from: number;
      to: number;
    };
    expiresAt?: number;
  };
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.not_contained
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
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
    "grantId": "gnt_a1b2c3",
    "level": "view"
  },
  "output": {
    "grant": {
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
  }
}
```
