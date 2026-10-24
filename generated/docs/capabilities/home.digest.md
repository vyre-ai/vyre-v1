# home.digest

My While you were away digest: three lines, then at most seven ranked items, each decision with Undo

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
| HTTP | POST /v1/home/digest |
| MCP tool | home_digest (meta) |
| CLI | vyre home digest |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  digest: ({
    id: string;
    person: string;
    periodStart: number;
    periodEnd: number;
    headline: Array<string>;
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
    seenAt?: number;
    builtBy: string;
  }) | null;
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
  "input": {},
  "output": {
    "digest": {
      "builtBy": "example",
      "headline": [
        "example"
      ],
      "id": "dgs_a1b2c3",
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
      "periodEnd": 1760000000000,
      "periodStart": 1760000000000,
      "person": "usr_a1b2c3",
      "seenAt": 1760000000000
    }
  }
}
```
