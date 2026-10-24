# home.activity

See all: the full activity for the digest period on records I follow, my agents, and my routines

| | |
|---|---|
| Module | home |
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
| HTTP | POST /v1/home/activity |
| MCP tool | home_activity (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  since: number;
  until?: number;
  kinds?: Array<"decision" | "finished" | "record_change" | "routine" | "waiting">;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      kind: "decision" | "finished" | "record_change" | "routine" | "waiting";
      title: string;
      line: string;
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      at?: number;
      undo?: {
        cap: string;
        input: unknown;
      };
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
    "kinds": [
      "decision"
    ],
    "limit": 1,
    "since": 1760000000000,
    "until": 1760000000000
  },
  "output": {
    "items": [
      {
        "at": 1760000000000,
        "kind": "decision",
        "line": "example",
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "title": "example",
        "undo": {
          "cap": "runs.undo",
          "input": {}
        }
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
