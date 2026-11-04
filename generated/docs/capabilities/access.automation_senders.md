# access.automation_senders

A person's press gives a Space Automation use of the mailboxes and numbers its send steps name, inside that person's own access, and takes back what no step names any more

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
| HTTP | POST /v1/access/automation_senders |
| MCP tool | none |
| CLI | none |
| Emits | grant.created, grant.revoked, access.changed |

## Input

```ts
type In = {
  automationId: string;
  give: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
      id: string;
    }>;
  keep: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
      id: string;
    }>;
};
```

## Output

```ts
type Out = {
  granted: Array<{
      id: string;
      subject: {
        kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
        id: string;
      };
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
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
    }>;
  revoked: number;
  refused: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
      id: string;
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
    "automationId": "aut_a1b2c3",
    "give": [
      {
        "id": "rec_a1b2c3",
        "type": "space"
      }
    ],
    "keep": [
      {
        "id": "rec_a1b2c3",
        "type": "space"
      }
    ]
  },
  "output": {
    "granted": [
      {
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
    ],
    "refused": [
      {
        "id": "rec_a1b2c3",
        "type": "space"
      }
    ],
    "revoked": 1
  }
}
```
