# access.reviews.get

Items of one review: who holds what, last used, decision so far

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
| HTTP | POST /v1/access/reviews/get |
| MCP tool | access_reviews_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  reviewId: string;
};
```

## Output

```ts
type Out = {
  review: {
    id: string;
    state: "open" | "closed";
    openedAt: number;
    closedAt?: number;
    items: number;
    decided: number;
  };
  items: Array<{
      grant: {
        id: string;
        subject: {
          kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
          id: string;
        };
        resource: {
          type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
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
      lastUsedAt?: number;
      decision?: "keep" | "remove";
    }>;
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
    "reviewId": "rvw_a1b2c3"
  },
  "output": {
    "items": [
      {
        "decision": "keep",
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
        },
        "lastUsedAt": 1760000000000
      }
    ],
    "review": {
      "closedAt": 1760000000000,
      "decided": 1,
      "id": "rvw_a1b2c3",
      "items": 1,
      "openedAt": 1760000000000,
      "state": "open"
    }
  }
}
```
